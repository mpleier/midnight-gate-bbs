'use strict';
// Door harness: loads every native door, drives it with a scripted keyboard,
// and fails on exceptions or any write outside the 80x25 cell grid.
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const db = require('../src/db');

const DIR = path.join(__dirname, '..', 'src', 'doors', 'native');

function makeTerm(keys) {
  const queue = keys.slice();
  const cycle = ['q', '\x1b', 'y', 'q', 'q', '\x1b', 'y', 'q', 'Q'];
  let reads = 0;
  const stats = { prints: 0, writes: 0, maxCol: 0, minRow: 1, maxRow: 0, overflows: [] };
  const next = () => {
    if (++reads > 600) throw new Error('input cap reached — the door never exited');
    const k = queue.length ? queue.shift() : cycle[reads % cycle.length];
    if (k === '\x1b') return 'ESC';
    if (k === ' ') return 'SPACE';
    return /^[a-z]$/.test(k) ? k.toUpperCase() : k;
  };
  const check = (row, text, col) => {
    const s = String(text);
    if (col != null) {
      const end = col + s.length - 1;
      if (end > 80) stats.overflows.push(`col ${col}..${end}: ${s.slice(0, 24)}`);
      stats.maxCol = Math.max(stats.maxCol, end);
    }
    if (row != null) {
      if (row < 1 || row > 25) stats.overflows.push(`row ${row}: ${s.slice(0, 24)}`);
      stats.maxRow = Math.max(stats.maxRow, row);
      stats.minRow = Math.min(stats.minRow, row);
    }
  };
  const term = {
    cols: 80,
    rows: 25,
    kind: 'test',
    node: 1,
    carrier: true,
    user: { handle: 'Harness', name: 'Harness Caller', level: 100, city: 'Test', state: 'XX', credits: 500, timeBank: 30 },
    session: { timeLimit: 60, minutesLeft: 60, node: 1, uploads: 0, downloads: 0, posts: 0 },
    activity: '',
    write(s) {
      stats.writes++;
      const text = String(s);
      // count the columns the raw stream would reach without ANSI
      const plain = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
      for (const line of plain.split(/\r\n|\n/)) if (line.length > 80) stats.overflows.push(`write ${line.length} cols`);
    },
    writeRaw() {},
    art() {},
    cls() {},
    color() {},
    reset() {},
    gotoxy() {},
    beep() {},
    hrule() {},
    box() {},
    banner() {},
    print(row, col, text) {
      stats.prints++;
      check(row, text, col);
    },
    center(row, text) {
      stats.prints++;
      const s = String(text);
      check(row, s, Math.max(1, Math.floor((80 - s.length) / 2) + 1));
    },
    right(row, text) {
      stats.prints++;
      const s = String(text);
      check(row, s, Math.max(1, 80 - s.length + 1));
    },
    wrap(text) {
      return String(text).split('\n');
    },
    async readLine() {
      return next();
    },
    async readKey() {
      return next();
    },
    async menu() {
      return next();
    },
    async pause() {},
    async yesno() {
      return true;
    },
  };
  return { term, stats };
}

async function runDoor(file) {
  const full = path.join(DIR, file);
  delete require.cache[require.resolve(full)];
  const mod = require(full);
  if (!mod || typeof mod.run !== 'function') return { file, ok: false, why: 'no run()' };
  const { term, stats } = makeTerm(['q', 'q', 'q', 'q', 'q', 'q', '\x1b', 'q', 'q']);
  const ctx = { db, config, user: term.user, screens: require('../src/flow/screens'), save: () => {}, door: { id: mod.id } };
  let error = null;
  try {
    await Promise.race([
      mod.run(term, ctx),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout — door did not return')), 8000)),
    ]);
  } catch (e) {
    error = e;
  }
  const ok = !error && stats.overflows.length === 0;
  return {
    file,
    name: mod.name,
    category: mod.category,
    ok,
    why: error ? error.message : stats.overflows.slice(0, 2).join('; '),
    prints: stats.prints,
    maxCol: stats.maxCol,
    maxRow: stats.maxRow,
  };
}

(async () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort();
  const rows = [];
  for (const f of files) rows.push(await runDoor(f));
  let bad = 0;
  for (const r of rows) {
    if (!r.ok) bad++;
    console.log(
      `${(r.ok ? 'PASS' : 'FAIL').padEnd(5)} ${String(r.name || r.file).padEnd(26)} ${String(r.category || '').padEnd(9)} prints=${String(r.prints || 0).padStart(4)} maxCol=${r.maxCol || 0} maxRow=${r.maxRow || 0}${r.why ? '  ' + r.why : ''}`
    );
  }
  console.log(`\n${rows.length - bad}/${rows.length} doors clean`);
  process.exitCode = bad ? 1 : 0;
})();
