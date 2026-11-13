'use strict';
// Who's online / user list / last callers / stats.
const config = require('../config');
const db = require('../db');
const auth = require('../auth');
const nodes = require('../nodes');
const s = require('./screens');

function drawOnline(term) {
  term.cls();
  s.header(term, 'WHO IS ONLINE', 11);
  const rows = nodes.online();
  const bbs = config.data.bbs;
  term.print(4, 3, `${bbs.name} — ${bbs.location}`, 11);
  term.print(5, 3, `Node capacity: ${bbs.maxNodes}   Callers on: ${rows.length}   ${s.clock()}`, 8);
  term.write('\r\n');
  term.color(8);
  term.write('  Node  Handle               Activity                        Min  Location\r\n');
  term.write('  ' + '─'.repeat(Math.min(term.cols - 4, 74)) + '\r\n');
  term.reset();
  rows.forEach((r, i) => {
    const row = 9 + i;
    if (row > term.rows - 4) return;
    term.print(row, 3, String(r.node), 10);
    term.print(row, 9, s.pad(r.handle + (r.bot ? ' [bot]' : ''), 20), r.bot ? 8 : 14);
    term.print(row, 30, s.pad(r.activity, 30), 7);
    term.print(row, 61, s.pad(r.minutes, 3, true), 8);
    term.print(row, 66, s.pad(r.location, Math.max(6, term.cols - 68)), 8);
  });
  term.write('\r\n');
  term.color(8);
  term.write('  (screens refresh themselves — press any key to go back)\r\n');
  term.reset();
}

async function online(term) {
  let stop = false;
  const redraw = () => {
    if (stop || !term.alive) return;
    try {
      drawOnline(term);
    } catch {}
  };
  redraw();
  const onChange = () => redraw();
  nodes.bus.on('node-change', onChange);
  try {
    for (;;) {
      const k = await term.readKey({ timeoutMs: 4000 });
      if (k != null) break;
      redraw();
    }
  } finally {
    stop = true;
    nodes.bus.off('node-change', onChange);
  }
}

async function userList(term) {
  const users = [...db.users].sort((a, b) => (b.calls || 0) - (a.calls || 0));
  term.cls();
  s.header(term, 'USER LIST', 11);
  term.write('\r\n');
  term.color(8);
  term.write('  #   Handle               Level       Calls  Posts  Last call\r\n');
  term.write('  ' + '─'.repeat(Math.min(term.cols - 4, 74)) + '\r\n');
  term.reset();
  const max = term.rows - 12;
  users.slice(0, max).forEach((u, i) => {
    term.print(6 + i, 3, String(i + 1).padStart(2), 10);
    term.print(6 + i, 7, s.pad(u.handle, 20), u.level >= 90 ? 12 : 15);
    term.print(6 + i, 28, s.pad(auth.levelName(u.level), 11), 7);
    term.print(6 + i, 40, s.pad(u.calls || 0, 5, true), 14);
    term.print(6 + i, 47, s.pad(u.posts || 0, 6, true), 7);
    term.print(6 + i, 54, s.fmtDate(u.lastCall || 0), 8);
  });
  term.write('\r\n');
  term.color(8);
  term.write(`  ${db.users.length} accounts on file.\r\n`);
  term.reset();
  await term.pause();
}

async function lastCallers(term) {
  const list = db.callers.slice(0, Math.max(8, term.rows - 12));
  term.cls();
  s.header(term, 'LAST CALLERS', 11);
  term.write('\r\n');
  term.color(8);
  term.write('  When             Handle               Node  Min  Where\r\n');
  term.write('  ' + '─'.repeat(Math.min(term.cols - 4, 74)) + '\r\n');
  term.reset();
  list.forEach((c, i) => {
    const row = 6 + i;
    if (row > term.rows - 4) return;
    term.print(row, 3, s.fmtDate(c.when), 8);
    term.print(row, 20, s.pad(c.handle, 20), c.bot ? 8 : 14);
    term.print(row, 42, s.pad(c.node || '-', 4, true), 7);
    term.print(row, 48, s.pad(c.minutes || 0, 3, true), 7);
    term.print(row, 53, s.pad(c.location || 'unknown', Math.max(8, term.cols - 55)), 9);
  });
  await term.pause();
}

async function stats(term) {
  const st = db.stats;
  const users = db.users.length;
  const online = nodes.count();
  const days = Math.max(1, (Date.now() - st.startedAt) / 86400000);
  term.cls();
  s.showArt(term, 'STATS.ANS', { fallback: false });
  s.header(term, 'SYSTEM STATISTICS', 11);
  const rows = [
    ['System name', config.get('bbs.name')],
    ['SysOp', config.get('bbs.sysop')],
    ['Software', config.get('bbs.software')],
    ['Nodes', `${online} in use / ${config.get('bbs.maxNodes')}`],
    ['Total calls', st.callsTotal],
    ['Calls per day', (st.callsTotal / days).toFixed(1)],
    ['Users on file', users],
    ['Messages posted', db.messages.filter((m) => m.boardId).length],
    ['Files online', `${db.files.length} (${s.fmtSize(db.files.reduce((t, f) => t + (f.size || 0), 0))})`],
    ['Bytes downloaded', s.fmtSize(st.bytesDl || 0)],
    ['Door games', `${db.doors ? db.doors.length : 'see menu'}`],
    ['Time', new Date().toString().slice(0, 24)],
  ];
  term.write('\r\n');
  rows.forEach(([k, v], i) => {
    term.print(6 + i, 5, s.pad(k, 24) + ':', 8);
    term.print(6 + i, 30, String(v), 15);
  });
  // ASCII bar chart of last 7 days of calls
  const chartRow = 6 + rows.length + 1;
  if (chartRow < term.rows - 4) {
    term.print(chartRow, 5, 'Calls, last 7 days', 11);
    const buckets = new Array(7).fill(0);
    for (const c of db.callers) {
      const d = Math.floor((Date.now() - c.when) / 86400000);
      if (d >= 0 && d < 7) buckets[6 - d]++;
    }
    const maxV = Math.max(1, ...buckets);
    buckets.forEach((v, i) => {
      const h = Math.round((v / maxV) * 4);
      term.print(chartRow + 1, 7 + i * 8, '█'.repeat(Math.max(0, h)) || '·', v ? 10 : 8);
      term.print(chartRow + 2, 6 + i * 8, s.pad(v, 5, true), 7);
    });
  }
  await term.pause();
}

module.exports = { online, userList, lastCallers, stats };
