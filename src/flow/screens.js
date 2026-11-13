'use strict';
// Screen helpers: art loading, headers/footers, alerts. Art is drop-in: .ans/.asc/.txt
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const cp437 = require('../cp437');

const artCache = new Map();

function artDir() {
  return path.join(config.root, 'art');
}

function loadArt(name) {
  if (!name) return null;
  const key = name.toLowerCase();
  if (artCache.has(key)) return artCache.get(key);
  const dir = artDir();
  const candidates = [
    name,
    name.toUpperCase(),
    name.toLowerCase(),
    name.toUpperCase() + '.ANS',
    name.toUpperCase() + '.ASC',
    name.toUpperCase() + '.TXT',
  ];
  let found = null;
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      found = p;
      break;
    }
  }
  if (!found) {
    artCache.set(key, null);
    return null;
  }
  const buf = fs.readFileSync(found);
  let text;
  const utf8 = buf.toString('utf8');
  if (utf8.includes('\uFFFD')) text = cp437.decode(buf);
  else text = utf8;
  // Some classic art has no CR; normalise and keep hard 80-col lines intact.
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  artCache.set(key, text);
  return text;
}

function invalidateArtCache() {
  artCache.clear();
}

function listArt() {
  const dir = artDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(ans|asc|txt)$/i.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const RAMP = [1, 9, 1, 9, 13, 13, 12, 12, 10, 10, 14, 14, 15, 15, 7];

function banner(term, title, subtitle) {
  const name = (title || config.get('bbs.name')).toUpperCase();
  const w = Math.min(term.cols - 2, 72);
  const x = Math.max(1, Math.floor((term.cols - w) / 2) + 1);
  const line = '═'.repeat(w - 2);
  term.color(11);
  term.print(1, x, '╔' + line + '╗');
  term.print(2, x, '║' + ' '.repeat(w - 2) + '║');
  term.print(3, x, '╚' + line + '╝');
  term.center(2, name, 15);
  if (subtitle) term.center(4, subtitle, 7);
  term.reset();
  return 5;
}

// Renders art at top-left. If missing, falls back to a generated banner.
function showArt(term, name, opts = {}) {
  term.cls();
  const text = loadArt(name);
  if (text) {
    term.art(text, 1, 1);
  } else if (opts.fallback !== false) {
    banner(term, opts.title || config.get('bbs.name'), opts.subtitle || config.get('bbs.tagline'));
  }
  return !!text;
}

function status(term, extra = '') {
  if (term.rows < 12) return;
  const user = term.user;
  const left = ` ${user ? user.handle : 'New caller'} `;
  const mid = extra || term.activity || '';
  const mins = term.session.timeLimit ? `Time left: ${term.session.minutesLeft} min` : '';
  term.print(term.rows - 1, 1, ' '.repeat(term.cols), 0, 7);
  term.print(term.rows - 1, 1, left.slice(0, 22), 0, 7);
  const midCol = Math.max(24, Math.floor((term.cols - mid.length) / 2));
  term.print(term.rows - 1, midCol, mid, 0, 7);
  term.print(term.rows - 1, Math.max(1, term.cols - mins.length), mins, 0, 7);
  term.reset();
}

function line(term, text = '', color = 7) {
  term.color(color);
  term.write(text + '\r\n');
  term.reset();
}

function info(term, text, color = 14) {
  term.write('\r\n');
  for (const l of term.wrap(text, term.cols - 6)) {
    term.color(color);
    term.write('  ' + l + '\r\n');
    term.reset();
  }
}

function error(term, text) {
  term.beep();
  info(term, text, 12);
}

function ok(term, text) {
  info(term, text, 10);
}

function rule(term, ch = '─', color = 8) {
  term.color(color);
  term.write(ch.repeat(Math.min(term.cols - 2, 78)) + '\r\n');
  term.reset();
}

function header(term, title, color = 11) {
  term.write('\r\n');
  term.color(color);
  const t = ` ${title} `;
  const pad = Math.max(0, Math.floor((Math.min(term.cols - 2, 76) - t.length) / 2));
  term.write('─'.repeat(pad) + t + '─'.repeat(Math.max(0, Math.min(term.cols - 2, 76) - pad - t.length)) + '\r\n');
  term.reset();
}

// Draws the section art (or a fallback banner), then a titled rule underneath it.
// Returns the first free row, so tables never overlap the art.
function frame(term, artName, title, opts = {}) {
  term.cls();
  const text = loadArt(artName);
  let artLines = 0;
  if (text) {
    term.art(text, 1, 1);
    artLines = text.replace(/\n+$/, '').split('\n').length;
  } else {
    banner(term, opts.title || config.get('bbs.name'), opts.subtitle || config.get('bbs.tagline'));
    artLines = 4;
  }
  const ruleRow = Math.min(artLines + 2, term.rows - 12);
  term.print(ruleRow, 1, '─'.repeat(Math.min(term.cols - 2, 78)), 8);
  if (title) {
    const label = ` ${title} `;
    const col = Math.max(1, Math.floor((term.cols - label.length) / 2) + 1);
    term.print(ruleRow, col, label, 11);
  }
  term.reset();
  return ruleRow + 1;
}

function prompt(term, text = 'Choice: ') {
  term.color(14);
  term.write(text);
  term.reset();
}

function fmtDate(ts) {
  const d = new Date(ts);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(2)} ${hh}:${mm}`;
}

function fmtSize(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + 'M';
  return Math.max(1, Math.round(bytes / 1024)) + 'K';
}

function pad(str, len, right = false) {
  const s = String(str ?? '');
  if (s.length >= len) return s.slice(0, len);
  return right ? ' '.repeat(len - s.length) + s : s + ' '.repeat(len - s.length);
}

function clock() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function nodeBadge(term) {
  return `Node ${term.node}/${config.get('bbs.maxNodes')}`;
}

module.exports = {
  artDir,
  loadArt,
  invalidateArtCache,
  listArt,
  banner,
  showArt,
  frame,
  status,
  line,
  info,
  error,
  ok,
  rule,
  header,
  prompt,
  fmtDate,
  fmtSize,
  pad,
  clock,
  nodeBadge,
  RAMP,
};
