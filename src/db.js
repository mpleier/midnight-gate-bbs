'use strict';
// Tiny JSON document store with atomic writes. No native deps, no SQL server.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.BBS_DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'bbs.json');

const now = () => Date.now();
const uid = (prefix = 'id') => prefix + '_' + crypto.randomBytes(6).toString('hex');

function seed() {
  return {
    users: [
      {
        id: 'user_sysop',
        handle: 'SysOp',
        name: 'The System Operator',
        pass: null,
        salt: null,
        level: 100,
        city: 'Portland',
        state: 'OR',
        email: '',
        sig: '--- The Gate is always open. ---',
        ansi: true,
        credits: 9999,
        timeBank: 9999,
        calls: 1,
        posts: 0,
        uploads: 0,
        downloads: 0,
        firstCall: now(),
        lastCall: now(),
        notes: 'System operator account.',
        bot: false,
      },
    ],
    boards: [
      { id: 'board_general', name: 'General Discussion', desc: 'Anything and everything. Mind the sysop.', level: 10, art: '', order: 1 },
      { id: 'board_doors', name: 'Door Games', desc: 'Tips, tricks and trash talk for the door games.', level: 10, art: '', order: 2 },
      { id: 'board_tech', name: 'Tech & Retro', desc: 'Modems, 8-bit iron, and the lost art of the BBS.', level: 10, art: '', order: 3 },
      { id: 'board_sysop', name: 'SysOp Roundtable', desc: 'For sysops only. Knock first.', level: 90, art: '', order: 4 },
    ],
    messages: [],
    fileAreas: [
      { id: 'area_util', name: 'Utilities & Texfiles', desc: 'Docs, textfiles, and the occasional gem.', path: 'files/util', level: 10 },
      { id: 'area_doors', name: 'Door Games', desc: 'Door game archives.', path: 'files/doors', level: 10 },
    ],
    files: [],
    callers: [],
    votes: [
      {
        id: 'vote_1',
        question: 'What killed the BBS?',
        options: ['The World Wide Web', 'AOL free disks', 'Cheap ISDN', 'It never died, you just stopped calling'],
        open: true,
        ballots: {},
      },
    ],
    bulletins: [
      {
        id: 'bul_1',
        title: 'Welcome to the Gate',
        body: 'This board runs 24 hours a day, 4 nodes, 14.4k and up.\nLeave a message, play a door, and tell your friends.\n\nThe SysOp',
        date: now(),
      },
    ],
    stats: { callsTotal: 0, postsTotal: 0, bytesDl: 0, startedAt: now() },
    chat: [],
    oneliners: [
      'SysOp: No, you cannot have a second account. I can see your modem signature.',
      'Phiber: any board with more than 3 nodes is just asking for trouble',
      'The Gate: 14.4k feels like flying.',
    ],
    rumors: [
      'Rumour has it the sysop has a 9600 baud modem on order.',
      'Someone saw a 486 in the dumpster behind the post office. It boots.',
    ],
    news: [],
  };
}

class DB {
  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.data = this.read();
    this.dirty = false;
    this.timer = null;
    this.listeners = new Set();
    this.schedule();
  }

  read() {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...seed(), ...parsed };
    } catch {
      const s = seed();
      fs.writeFileSync(DB_FILE, JSON.stringify(s, null, 2));
      return s;
    }
  }

  schedule() {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), 1500);
    this.timer.unref?.();
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, DB_FILE);
    for (const fn of this.listeners) {
      try {
        fn(this.data);
      } catch {}
    }
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // --- helpers -------------------------------------------------------------
  get users() { return this.data.users; }
  get boards() { return this.data.boards; }
  get messages() { return this.data.messages; }
  get files() { return this.data.files; }
  get fileAreas() { return this.data.fileAreas; }
  get callers() { return this.data.callers; }
  get bulletins() { return this.data.bulletins; }
  get votes() { return this.data.votes; }
  get stats() { return this.data.stats; }

  findUser(handle) {
    const h = String(handle || '').trim().toLowerCase();
    return this.data.users.find((u) => u.handle.toLowerCase() === h) || null;
  }

  boardMessages(boardId) {
    return this.data.messages.filter((m) => m.boardId === boardId);
  }

  addCaller(entry) {
    this.data.callers.unshift({ id: uid('call'), when: now(), ...entry });
    if (this.data.callers.length > 800) this.data.callers.length = 800;
    this.data.stats.callsTotal++;
    this.dirty = true;
  }

  addMessage(msg) {
    const m = {
      id: uid('msg'),
      date: now(),
      replies: 0,
      ...msg,
    };
    this.data.messages.push(m);
    this.data.stats.postsTotal++;
    const author = this.findUser(m.from);
    if (author) author.posts = (author.posts || 0) + 1;
    this.dirty = true;
    return m;
  }

  save() {
    this.dirty = true;
    this.flush();
  }
}

module.exports = new DB();
module.exports.uid = uid;
module.exports.DB_FILE = DB_FILE;
