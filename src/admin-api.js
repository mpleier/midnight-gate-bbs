'use strict';
// Sysop REST API. Contract: docs/ADMIN_API.md
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');
const nodes = require('./nodes');
const auth = require('./auth');
const doors = require('./doors/manager');
const bots = require('./bots/bots');
const screens = require('./flow/screens');
const cp437 = require('./cp437');

const sessions = new Map(); // token -> {user, exp}  (also marks logged-out tokens)
const revoked = new Set();

function signToken(user, exp) {
  const secret = config.data.admin.passwordHash || 'gate';
  const payload = Buffer.from(`${user}|${exp}`).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 32);
  return `${sig}.${payload}`;
}

function verifyToken(token) {
  if (!token || revoked.has(token)) return null;
  const [sig, payload] = String(token).split('.');
  if (!sig || !payload) return null;
  const secret = config.data.admin.passwordHash || 'gate';
  const want = crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 32);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  let user;
  let exp;
  try {
    const [u, e] = Buffer.from(payload, 'base64url').toString().split('|');
    user = u;
    exp = Number(e);
  } catch {
    return null;
  }
  if (!user || !exp || exp < Date.now()) return null;
  return { user, exp, token };
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentSession(req) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const cookieToken = parseCookies(req).bbs_admin;
  for (const token of [bearer, cookieToken]) {
    if (!token) continue;
    const s = sessions.get(token);
    if (s && s.exp > Date.now()) return { ...s, token };
    const stateless = verifyToken(token); // survives a server restart
    if (stateless) {
      sessions.set(token, { user: stateless.user, exp: stateless.exp });
      return stateless;
    }
  }
  return null;
}

function cleanup() {
  const t = Date.now();
  for (const [k, v] of sessions) if (v.exp < t) sessions.delete(k);
}
setInterval(cleanup, 60000).unref?.();

function redactedConfig() {
  const copy = JSON.parse(JSON.stringify(config.data));
  if (copy.admin) {
    copy.admin.passwordHash = copy.admin.passwordHash ? '***' : '';
    copy.admin.salt = '';
  }
  return copy;
}

function overview() {
  const st = db.stats;
  return {
    bbs: { name: config.get('bbs.name'), sysop: config.get('bbs.sysop'), software: config.get('bbs.software'), maxNodes: config.get('bbs.maxNodes') },
    nodes: nodes.online(),
    stats: {
      users: db.users.length,
      calls: st.callsTotal,
      posts: db.messages.filter((m) => m.boardId).length,
      files: db.files.length,
      doors: doors.doors.length,
      uptimeSec: Math.floor((Date.now() - st.startedAt) / 1000),
    },
    pages: (db.data.pages || []).filter((p) => !p.handled).slice(-8),
    log: doors.log.slice(0, 12),
  };
}

async function handle(req, res, url) {
  const p = url.pathname;
  if (!p.startsWith('/api/admin')) return false;

  if (p === '/api/admin/login' && req.method === 'POST') {
    const body = await readBody(req);
    const user = String(body.user || '').trim();
    const password = String(body.password || '');
    const okUser = user === config.get('admin.user') || db.findUser(user)?.level >= 100;
    if (okUser && config.checkAdminPassword(password)) {
      const exp = Date.now() + 12 * 3600 * 1000;
      const token = signToken(user, exp);
      sessions.set(token, { user, exp });
      res.setHeader(
        'set-cookie',
        `bbs_admin=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}`
      );
      return json(res, 200, { ok: true, user, token });
    }
    return json(res, 401, { error: 'bad credentials' });
  }

  const sess = currentSession(req);
  if (!sess) return json(res, 401, { error: 'not logged in' });

  // ---- auth -------------------------------------------------------------
  if (p === '/api/admin/me' && req.method === 'GET') return json(res, 200, { user: sess.user });
  if (p === '/api/admin/logout' && req.method === 'POST') {
    sessions.delete(sess.token);
    revoked.add(sess.token);
    res.setHeader('set-cookie', 'bbs_admin=; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/password' && req.method === 'POST') {
    const b = await readBody(req);
    if (!config.checkAdminPassword(String(b.current || ''))) return json(res, 400, { error: 'current password wrong' });
    if (String(b.next || '').length < 4) return json(res, 400, { error: 'too short' });
    config.setAdminPassword(String(b.next));
    return json(res, 200, { ok: true });
  }

  // ---- overview ---------------------------------------------------------
  if (p === '/api/admin/overview') return json(res, 200, overview());

  // ---- users ------------------------------------------------------------
  if (p === '/api/admin/users' && req.method === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const users = db.users
      .filter((u) => !q || u.handle.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q))
      .map((u) => ({
        id: u.id,
        handle: u.handle,
        name: u.name,
        level: u.level,
        calls: u.calls,
        posts: u.posts,
        credits: u.credits,
        timeBank: u.timeBank,
        city: u.city,
        state: u.state,
        email: u.email,
        banned: !!u.banned,
        bot: !!u.bot,
        notes: u.notes,
        lastCall: u.lastCall,
      }));
    return json(res, 200, { users });
  }
  let m = p.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (m && req.method === 'PATCH') {
    const u = db.users.find((x) => x.id === m[1]);
    if (!u) return json(res, 404, { error: 'no such user' });
    const b = await readBody(req);
    const allowed = ['handle', 'name', 'level', 'credits', 'timeBank', 'city', 'state', 'email', 'banned', 'notes', 'sig'];
    for (const k of allowed) if (k in b) u[k] = b[k];
    db.save();
    return json(res, 200, { user: u });
  }
  if (m && req.method === 'DELETE') {
    const u = db.users.find((x) => x.id === m[1]);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (u.level >= 100) return json(res, 400, { error: 'refusing to delete a sysop' });
    db.users.splice(db.users.indexOf(u), 1);
    db.save();
    return json(res, 200, { ok: true });
  }
  m = p.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
  if (m && req.method === 'POST') {
    const u = db.users.find((x) => x.id === m[1]);
    if (!u) return json(res, 404, { error: 'no such user' });
    const b = await readBody(req);
    auth.setPassword(u, String(b.password || ''));
    db.save();
    return json(res, 200, { ok: true });
  }

  // ---- boards / messages ------------------------------------------------
  if (p === '/api/admin/boards' && req.method === 'GET') {
    return json(res, 200, {
      boards: db.boards.map((b) => ({ ...b, messages: db.messages.filter((mm) => mm.boardId === b.id).length })),
    });
  }
  if (p === '/api/admin/boards' && req.method === 'POST') {
    const b = await readBody(req);
    const board = {
      id: 'board_' + crypto.randomBytes(4).toString('hex'),
      name: String(b.name || 'Untitled').slice(0, 40),
      desc: String(b.desc || '').slice(0, 120),
      level: Number(b.level) || 10,
      order: (db.boards.length || 0) + 1,
    };
    db.boards.push(board);
    db.save();
    return json(res, 200, { board });
  }
  m = p.match(/^\/api\/admin\/boards\/([^/]+)$/);
  if (m && req.method === 'PATCH') {
    const board = db.boards.find((x) => x.id === m[1]);
    if (!board) return json(res, 404, { error: 'no such board' });
    const b = await readBody(req);
    for (const k of ['name', 'desc', 'level', 'order']) if (k in b) board[k] = b[k];
    db.save();
    return json(res, 200, { board });
  }
  if (m && req.method === 'DELETE') {
    const board = db.boards.find((x) => x.id === m[1]);
    if (!board) return json(res, 404, { error: 'no such board' });
    db.boards.splice(db.boards.indexOf(board), 1);
    db.data.messages = db.messages.filter((mm) => mm.boardId !== board.id);
    db.save();
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/messages' && req.method === 'GET') {
    const boardId = url.searchParams.get('boardId');
    const list = db.messages
      .filter((mm) => !boardId || mm.boardId === boardId)
      .slice(-200)
      .reverse();
    return json(res, 200, { messages: list });
  }
  m = p.match(/^\/api\/admin\/messages\/([^/]+)$/);
  if (m && req.method === 'PATCH') {
    const msg = db.messages.find((x) => x.id === m[1]);
    if (!msg) return json(res, 404, { error: 'no such message' });
    const b = await readBody(req);
    for (const k of ['subject', 'body', 'to']) if (k in b) msg[k] = b[k];
    db.save();
    return json(res, 200, { message: msg });
  }
  if (m && req.method === 'DELETE') {
    const i = db.messages.findIndex((x) => x.id === m[1]);
    if (i < 0) return json(res, 404, { error: 'no such message' });
    db.messages.splice(i, 1);
    db.save();
    return json(res, 200, { ok: true });
  }

  // ---- file areas / files ----------------------------------------------
  if (p === '/api/admin/fileareas' && req.method === 'GET') {
    return json(res, 200, {
      areas: db.fileAreas.map((a) => ({ ...a, files: db.files.filter((f) => f.areaId === a.id).length })),
    });
  }
  if (p === '/api/admin/fileareas' && req.method === 'POST') {
    const b = await readBody(req);
    const area = {
      id: 'area_' + crypto.randomBytes(4).toString('hex'),
      name: String(b.name || 'Untitled').slice(0, 40),
      desc: String(b.desc || '').slice(0, 120),
      level: Number(b.level) || 10,
      path: '',
    };
    area.path = path.join('files', area.id);
    db.fileAreas.push(area);
    db.save();
    return json(res, 200, { area });
  }
  m = p.match(/^\/api\/admin\/fileareas\/([^/]+)$/);
  if (m && req.method === 'PATCH') {
    const area = db.fileAreas.find((x) => x.id === m[1]);
    if (!area) return json(res, 404, { error: 'no such area' });
    const b = await readBody(req);
    for (const k of ['name', 'desc', 'level']) if (k in b) area[k] = b[k];
    db.save();
    return json(res, 200, { area });
  }
  if (m && req.method === 'DELETE') {
    const area = db.fileAreas.find((x) => x.id === m[1]);
    if (!area) return json(res, 404, { error: 'no such area' });
    db.fileAreas.splice(db.fileAreas.indexOf(area), 1);
    db.data.files = db.files.filter((f) => f.areaId !== area.id);
    db.save();
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/files' && req.method === 'GET') {
    const areaId = url.searchParams.get('areaId');
    return json(res, 200, { files: db.files.filter((f) => !areaId || f.areaId === areaId) });
  }
  if (p === '/api/admin/files' && req.method === 'POST') {
    const b = await readBody(req);
    const area = db.fileAreas.find((a) => a.id === b.areaId);
    if (!area) return json(res, 400, { error: 'unknown area' });
    const name = String(b.name || 'file.bin').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 64);
    const dir = path.join(config.root, 'files', area.id);
    fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(String(b.contentBase64 || ''), 'base64');
    if (!buf.length) return json(res, 400, { error: 'empty file' });
    fs.writeFileSync(path.join(dir, name), buf);
    const file = {
      id: 'file_' + crypto.randomBytes(4).toString('hex'),
      areaId: area.id,
      name,
      desc: String(b.desc || '').slice(0, 80),
      size: buf.length,
      date: Date.now(),
      path: path.join('files', area.id, name),
      downloads: 0,
    };
    db.files.push(file);
    db.save();
    return json(res, 200, { file });
  }
  m = p.match(/^\/api\/admin\/files\/([^/]+)$/);
  if (m && req.method === 'DELETE') {
    const i = db.files.findIndex((x) => x.id === m[1]);
    if (i < 0) return json(res, 404, { error: 'no such file' });
    const f = db.files[i];
    try {
      fs.unlinkSync(path.join(config.root, f.path));
    } catch {}
    db.files.splice(i, 1);
    db.save();
    return json(res, 200, { ok: true });
  }

  // ---- doors ------------------------------------------------------------
  if (p === '/api/admin/doors' && req.method === 'GET') {
    return json(res, 200, {
      doors: doors.refresh(),
      installDir: doors.INSTALL_DIR,
      log: doors.log,
      categories: doors.CATEGORIES,
    });
  }
  if (p === '/api/admin/doors/scan' && req.method === 'POST') {
    const installed = doors.scanInstallFolder();
    return json(res, 200, { installed, doors: doors.refresh(), log: doors.log });
  }
  if (p === '/api/admin/doors/upload' && req.method === 'POST') {
    const b = await readBody(req);
    const name = String(b.filename || 'door.zip').replace(/[^A-Za-z0-9._-]+/g, '_');
    const buf = Buffer.from(String(b.zipBase64 || ''), 'base64');
    if (!buf.length) return json(res, 400, { error: 'empty upload' });
    const target = path.join(doors.INSTALL_DIR, name.endsWith('.zip') ? name : name + '.zip');
    fs.writeFileSync(target, buf);
    const manifest = doors.installZip(target, { moveArchive: true });
    return json(res, 200, { installed: manifest, doors: doors.refresh() });
  }
  m = p.match(/^\/api\/admin\/doors\/([^/]+)$/);
  if (m && req.method === 'PATCH') {
    const door = doors.byId(decodeURIComponent(m[1]));
    if (!door) return json(res, 404, { error: 'no such door' });
    const b = await readBody(req);
    if (door.builtin) {
      // built-ins can only be hidden / re-levelled: keep an override list
      db.data.doorOverrides = db.data.doorOverrides || {};
      db.data.doorOverrides[door.id] = { ...(db.data.doorOverrides[door.id] || {}), ...b };
      db.save();
      const merged = doors.refresh().find((d) => d.id === door.id);
      return json(res, 200, { door: merged });
    }
    const saved = doors.saveManifest(door, b);
    return json(res, 200, { door: saved });
  }
  if (m && req.method === 'DELETE') {
    const door = doors.byId(decodeURIComponent(m[1]));
    if (!door) return json(res, 404, { error: 'no such door' });
    if (door.builtin) return json(res, 400, { error: 'cannot delete a built-in door' });
    fs.rmSync(door.dir, { recursive: true, force: true });
    doors.refresh();
    return json(res, 200, { ok: true });
  }

  // ---- art --------------------------------------------------------------
  if (p === '/api/admin/art' && req.method === 'GET') {
    return json(res, 200, { art: screens.listArt(), dir: screens.artDir(), slots: config.data.ansi });
  }
  m = p.match(/^\/api\/admin\/art\/([^/]+)\/preview$/);
  if (m && req.method === 'GET') {
    const text = screens.loadArt(decodeURIComponent(m[1]));
    if (text == null) return json(res, 404, { error: 'no such art' });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(text);
  }
  if (p === '/api/admin/art/upload' && req.method === 'POST') {
    const b = await readBody(req);
    const name = String(b.name || '').replace(/[^A-Za-z0-9._-]+/g, '_');
    if (!/\.(ans|asc|txt)$/i.test(name)) return json(res, 400, { error: 'name must end .ans/.asc/.txt' });
    const buf = Buffer.from(String(b.contentBase64 || ''), 'base64');
    if (!buf.length) return json(res, 400, { error: 'empty art' });
    fs.mkdirSync(screens.artDir(), { recursive: true });
    fs.writeFileSync(path.join(screens.artDir(), name), buf);
    screens.invalidateArtCache();
    return json(res, 200, { art: screens.listArt() });
  }
  if (p === '/api/admin/art/assign' && req.method === 'POST') {
    const b = await readBody(req);
    const slot = String(b.slot || '');
    if (!['welcomeArt', 'mainArt', 'loginArt', 'goodbyeArt', 'newUserArt'].includes(slot))
      return json(res, 400, { error: 'unknown slot' });
    config.set('ansi.' + slot, String(b.name || ''));
    screens.invalidateArtCache();
    return json(res, 200, { slots: config.data.ansi });
  }
  m = p.match(/^\/api\/admin\/art\/([^/]+)$/);
  if (m && req.method === 'DELETE') {
    const name = decodeURIComponent(m[1]).replace(/[^A-Za-z0-9._-]+/g, '_');
    try {
      fs.unlinkSync(path.join(screens.artDir(), name));
    } catch {
      return json(res, 404, { error: 'no such art' });
    }
    screens.invalidateArtCache();
    return json(res, 200, { ok: true });
  }

  // ---- bots -------------------------------------------------------------
  if (p === '/api/admin/bots' && req.method === 'GET') return json(res, 200, { bots: bots.list() });
  if (p === '/api/admin/bots' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b.handle) return json(res, 400, { error: 'handle required' });
    return json(res, 200, { bot: bots.add(b) });
  }
  m = p.match(/^\/api\/admin\/bots\/([^/]+)$/);
  if (m && req.method === 'PATCH') {
    const bot = bots.update(m[1], await readBody(req));
    if (!bot) return json(res, 404, { error: 'no such bot' });
    return json(res, 200, { bot });
  }
  if (m && req.method === 'DELETE') {
    if (!bots.remove(m[1])) return json(res, 404, { error: 'no such bot' });
    return json(res, 200, { ok: true });
  }

  // ---- config -----------------------------------------------------------
  if (p === '/api/admin/config' && req.method === 'GET') return json(res, 200, { config: redactedConfig() });
  if (p === '/api/admin/config' && req.method === 'PUT') {
    const b = await readBody(req);
    const patch = b.patch || b;
    for (const [k, v] of Object.entries(patch)) {
      if (!k.includes('.')) continue;
      if (k.startsWith('admin.')) continue;
      config.set(k, v);
    }
    return json(res, 200, { config: redactedConfig() });
  }

  // ---- bulletins --------------------------------------------------------
  if (p === '/api/admin/bulletins' && req.method === 'GET') return json(res, 200, { bulletins: db.bulletins });
  if (p === '/api/admin/bulletins' && req.method === 'POST') {
    const b = await readBody(req);
    const rec = { id: 'bul_' + crypto.randomBytes(4).toString('hex'), title: String(b.title || 'Untitled'), body: String(b.body || ''), date: Date.now() };
    db.bulletins.push(rec);
    db.save();
    return json(res, 200, { bulletin: rec });
  }
  m = p.match(/^\/api\/admin\/bulletins\/([^/]+)$/);
  if (m && req.method === 'PATCH') {
    const rec = db.bulletins.find((x) => x.id === m[1]);
    if (!rec) return json(res, 404, { error: 'no such bulletin' });
    const b = await readBody(req);
    for (const k of ['title', 'body']) if (k in b) rec[k] = b[k];
    db.save();
    return json(res, 200, { bulletin: rec });
  }
  if (m && req.method === 'DELETE') {
    const i = db.bulletins.findIndex((x) => x.id === m[1]);
    if (i < 0) return json(res, 404, { error: 'no such bulletin' });
    db.bulletins.splice(i, 1);
    db.save();
    return json(res, 200, { ok: true });
  }

  // ---- sysop pages ------------------------------------------------------
  m = p.match(/^\/api\/admin\/pages\/([^/]+)\/handled$/);
  if (m && req.method === 'POST') {
    const page = (db.data.pages || []).find((x) => x.id === m[1]);
    if (!page) return json(res, 404, { error: 'no such page' });
    page.handled = true;
    db.save();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'unknown admin endpoint' });
}

module.exports = { handle, sessions, redactedConfig };
