'use strict';
// HTTP front end: landing page, web terminal websocket, downloads, public + admin APIs.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const nodes = require('./nodes');
const Terminal = require('./terminal');
const { attachWebSocket } = require('./ws');
const adminApi = require('./admin-api');
const filesFlow = require('./flow/files');
const screens = require('./flow/screens');
const { runSession } = require('./flow/bbs');

const PUBLIC = path.join(config.root, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ans': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, headers);
  res.end(body);
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'not found', { 'content-type': 'text/plain' });
    send(res, 200, data, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': data.length,
      'cache-control': ['.html', '.js', '.css', '.json'].includes(ext) ? 'no-store' : 'public, max-age=300',
    });
  });
}

function statusPayload() {
  const st = db.stats;
  return {
    name: config.get('bbs.name'),
    tagline: config.get('bbs.tagline'),
    sysop: config.get('bbs.sysop'),
    location: config.get('bbs.location'),
    software: config.get('bbs.software'),
    online: nodes.count(),
    maxNodes: config.get('bbs.maxNodes'),
    telnet: `${config.get('network.publicHost')}:${config.get('network.telnetPort')}`,
    dialNumbers: config.get('bbs.dialNumbers') || [],
    modems: config.get('bbs.modems') || [],
    nodes: nodes.online(),
    callers: db.callers.slice(0, 10).map((c) => ({ handle: c.handle, when: c.when, location: c.location })),
    chat: (db.data.chat || []).slice(-8),
    stats: {
      users: db.users.length,
      calls: st.callsTotal,
      posts: db.messages.filter((m) => m.boardId).length,
      files: db.files.length,
    },
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error('too big'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('bad json'));
      }
    });
  });
}

function createServer(onLog = console.log) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    try {
      if (p === '/healthz') return send(res, 200, 'ok');
      if (p === '/api/status') return send(res, 200, JSON.stringify(statusPayload()), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      if (p === '/api/chat/recent') {
        const limit = Math.min(50, Number(url.searchParams.get('limit')) || 20);
        return send(res, 200, JSON.stringify({ messages: (db.data.chat || []).slice(-limit) }), { 'content-type': 'application/json; charset=utf-8' });
      }
      if (p.startsWith('/api/admin')) {
        await adminApi.handle(req, res, url);
        return;
      }
      const dl = p.match(/^\/dl\/([a-f0-9]+)\/(.+)$/);
      if (dl) {
        const file = filesFlow.takeTicket(dl[1]);
        if (!file) return send(res, 404, 'link expired — request the file again from the BBS', { 'content-type': 'text/plain' });
        const full = path.isAbsolute(file.path) ? file.path : path.join(config.root, file.path);
        if (!fs.existsSync(full)) return send(res, 404, 'file missing');
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': fs.statSync(full).size,
          'content-disposition': `attachment; filename="${path.basename(full).replace(/"/g, '')}"`,
        });
        return fs.createReadStream(full).pipe(res);
      }
      if (req.method === 'POST') {
        const body = await readJson(req).catch(() => ({}));
        void body;
      }

      // static
      let rel = p;
      if (rel === '/' || rel === '') rel = '/index.html';
      if (rel === '/terminal') rel = '/terminal.html';
      if (rel === '/admin' || rel === '/admin/') rel = '/admin/index.html';
      const filePath = path.normalize(path.join(PUBLIC, rel));
      if (!filePath.startsWith(PUBLIC)) return send(res, 403, 'forbidden');
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return serveStatic(res, filePath);
      return send(res, 404, 'not found', { 'content-type': 'text/plain' });
    } catch (err) {
      onLog(`http error ${p}: ${err.message}`);
      if (!res.headersSent) send(res, 500, JSON.stringify({ error: err.message }), { 'content-type': 'application/json' });
    }
  });

  attachWebSocket(server, '/ws', (conn, url) => {
    const term = new Terminal({
      kind: 'web',
      cols: 80,
      rows: 25,
      ansi: true,
      remote: conn.req.socket.remoteAddress || 'web',
      send: (s) => conn.send(s),
      close: () => conn.close(),
    });
    const dial = url && url.searchParams.get('dial');
    if (dial) term.dialNumber = String(dial).slice(0, 24);
    const modem = url && url.searchParams.get('modem');
    if (modem) term.modemBps = Number(String(modem).replace(/\D/g, '')) || null;
    conn.onMessage = (txt) => {
      // a resize ping from the client is ignored: the board is 80x25, as it should be
      if (txt.startsWith('\x00resize')) return;
      term.feed(txt);
    };
    conn.onClose = () => term.hangup('CARRIER LOST');
    term.on('hangup', () => conn.close());
    runSession(term).catch((e) => {
      onLog(`web session error: ${e.message}`);
      try {
        term.write('\r\n+++ CARRIER LOST +++\r\n');
      } catch {}
    });
  });

  return server;
}

module.exports = { createServer, statusPayload, PUBLIC };
