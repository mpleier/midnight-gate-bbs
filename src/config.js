'use strict';
// Configuration: defaults live in code, overrides in config.json, edits via admin UI.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'config.json');

const DEFAULTS = {
  bbs: {
    name: 'THE MIDNIGHT GATE',
    shortName: 'Midnight Gate',
    sysop: 'SysOp',
    location: 'Portland, Oregon',
    tagline: 'Where the night never ends...',
    origin: '1:105/42',
    software: 'GATE BBS v1.0',
    maxNodes: 4,
    timeLimit: 60,
    newUserTime: 30,
    allowNewUsers: true,
    newUserLevel: 10,
    minPassword: 4,
    sysopPassword: 'sysop',
    dialNumbers: ['555-0113', '867-5309'],
    // one of these is picked per call: the CONNECT banner, the status bar and
    // the handshake audio all follow it
    modems: [
      { bps: 2400, connect: '2400/ARQ/V22BIS/LAPM', name: 'USR Sportster 2400' },
      { bps: 9600, connect: '9600/ARQ/V32/LAPM/V42BIS', name: 'USR Sportster 9600' },
      { bps: 14400, connect: '14400/ARQ/V32BIS/LAPM/V42BIS', name: 'USR Sportster 14,400' },
      { bps: 28800, connect: '28800/ARQ/V34/LAPM/V42BIS', name: 'Zoom V.34 28.8' },
      { bps: 33600, connect: '33600/ARQ/V34/LAPM/V42BIS', name: 'USR Courier 33.6' },
      { bps: 56000, connect: '56000/V90/V42BIS', name: 'USR Sportster 56K' },
    ],
    idleTimeout: 300,
    requireValidation: false,
  },
  network: {
    host: '0.0.0.0',
    httpPort: 8080,
    telnetPort: 2323,
    telnetEnabled: true,
    publicHost: 'localhost',
  },
  web: {
    crtEffect: true,
    dialupSound: true,
    palette: 'cga',
    fontSize: 17,
  },
  ansi: {
    artDir: 'art',
    welcomeArt: 'WELCOME.ANS',
    mainArt: 'MAIN.ANS',
    loginArt: 'LOGIN.ANS',
    goodbyeArt: 'GOODBYE.ANS',
    newUserArt: 'NEWUSER.ANS',
  },
  admin: {
    user: 'sysop',
    passwordHash: '',
    salt: '',
  },
  llm: {
    enabled: true,
    endpoint: 'http://127.0.0.1:11434/api/chat',
    model: 'llama3.1:8b',
    timeoutMs: 20000,
  },
  doors: {
    autoScan: true,
    scanIntervalSec: 20,
    installDir: 'doors/install',
    dosboxPath: '',
    tcpBridgePort: 2444,
  },
  files: {
    uploadDir: 'files',
    maxUploadMB: 32,
  },
  moderation: {
    wordFilter: [],
  },
};

function deepMerge(base, over) {
  if (Array.isArray(base)) return over === undefined ? base : over;
  if (base && typeof base === 'object') {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
      out[k] = k in base ? deepMerge(base[k], v) : v;
    }
    return out;
  }
  return over === undefined ? base : over;
}

class Config {
  constructor() {
    this.root = ROOT;
    this.data = null;
    this.load();
    if (!this.data.admin.passwordHash) this.setAdminPassword(process.env.BBS_ADMIN_PASSWORD || 'sysop');
  }

  load() {
    let disk = {};
    try {
      disk = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
      disk = {};
    }
    this.data = deepMerge(DEFAULTS, disk);
    return this.data;
  }

  save() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.data, null, 2));
  }

  get(pathStr) {
    return pathStr.split('.').reduce((o, k) => (o == null ? o : o[k]), this.data);
  }

  set(pathStr, value) {
    const parts = pathStr.split('.');
    const last = parts.pop();
    let node = this.data;
    for (const p of parts) {
      if (typeof node[p] !== 'object' || node[p] === null) node[p] = {};
      node = node[p];
    }
    node[last] = value;
    this.save();
    return value;
  }

  setAdminPassword(pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    this.data.admin.salt = salt;
    this.data.admin.passwordHash = hashPassword(pw, salt);
    this.save();
  }

  checkAdminPassword(pw) {
    if (!this.data.admin.passwordHash) return false;
    const h = hashPassword(pw, this.data.admin.salt || '');
    return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(this.data.admin.passwordHash));
  }

  artPath(name) {
    return path.join(ROOT, this.get('ansi.artDir'), name);
  }
}

function hashPassword(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString('hex');
}

const config = new Config();
module.exports = config;
module.exports.hashPassword = hashPassword;
module.exports.ROOT = ROOT;
