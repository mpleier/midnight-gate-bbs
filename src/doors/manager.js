'use strict';
// Door manager: scans doors/ (native JS doors + installed zips), builds the menu,
// writes drop files, launches native doors in-process and external ones via a pipe.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const cp437 = require('../cp437');
const config = require('../config');
const db = require('../db');
const s = require('../flow/screens');
const dropfiles = require('./dropfiles');
const zip = require('./zip');

const DOORS_DIR = path.join(config.root, 'doors');
const INSTALL_DIR = path.join(config.root, config.get('doors.installDir') || 'doors/install');
const NATIVE_DIR = path.join(__dirname, 'native');
const ARCHIVE_DIR = path.join(DOORS_DIR, 'archives');

const CATEGORIES = ['RPG', 'Strategy', 'Casino', 'Trivia', 'Arcade', 'Utility', 'Other'];

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/\.zip$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'door-' + Date.now();
}

function readTextSafe(file) {
  try {
    const buf = fs.readFileSync(file);
    const utf8 = buf.toString('utf8');
    return utf8.includes('\uFFFD') ? buf.toString('latin1') : utf8;
  } catch {
    return '';
  }
}

function prettyName(base) {
  return String(base || '')
    .replace(/\.(zip|rar|7z)$/i, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b(dos|en|eng|english|full|shareware|registered|v?\d+(\.\d+)?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function sniffMeta(dir, fallbackName) {
  const files = [];
  const walk = (d, depth = 0) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth < 2) walk(p, depth + 1);
      } else files.push(p);
    }
  };
  try {
    walk(dir);
  } catch {}

  let name = fallbackName;
  let description = '';
  let author = '';
  const diz = files.find((f) => /file_id\.diz$/i.test(f));
  if (diz) {
    const t = readTextSafe(diz).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').trim();
    const [first, ...rest] = t.split('\n');
    name = first.replace(/[^\x20-\x7e]/g, '').trim() || name;
    description = rest.join(' ').replace(/\s+/g, ' ').trim();
  }
  const doc = files.find((f) => /(readme|\.nfo|\.doc|\.txt)$/i.test(f));
  if (doc) {
    const t = readTextSafe(doc).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
    if (!description) {
      description = t
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 30 && !/^[-=*_\s]+$/.test(l))[0] || '';
    }
    const am = t.match(/(?:author|written by|programmed by|copyright \(c\)|\(c\))\s*[:\-]?\s*([A-Za-z0-9 .'\-]{3,40})/i);
    if (am) author = am[1].trim();
  }
  // DOS doors are launched by their BAT wrapper; the EXE is the game itself and
  // LORDCFG.EXE / SETUP.EXE must never be picked as the entry point
  const bat = files.find((f) => /\.bat$/i.test(f) && /(start|run|door|play|go)/i.test(f)) || files.find((f) => /\.bat$/i.test(f) && !/(install|setup)/i.test(f));
  const exe = files.find((f) => /\.exe$/i.test(f) && !/(install|setup|cfg|config|readme|order|register|uninst)/i.test(f));
  const js = files.find((f) => /(^|[\\/])door\.js$/i.test(f));
  return {
    name,
    description: description.slice(0, 160),
    author,
    exe: exe ? path.relative(dir, exe) : null,
    bat: bat ? path.relative(dir, bat) : null,
    js: js ? path.relative(dir, js) : null,
  };
}

function pickPort(cmd) {
  const m = String(cmd || '').match(/port:(\d+)/i);
  return m ? Number(m[1]) : 0;
}

// DOSBox is not a dependency: use the configured path, or find a normal install
function findDosbox() {
  const configured = config.get('doors.dosboxPath');
  if (configured && fs.existsSync(configured)) return configured;
  const candidates = [
    'C:/Program Files (x86)/DOSBox-0.74-3/DOSBox.exe',
    'C:/Program Files/DOSBox-0.74-3/DOSBox.exe',
    'C:/Program Files/DOSBox-X/dosbox-x.exe',
    'C:/Program Files (x86)/DOSBox-X/dosbox-x.exe',
    'C:/Program Files/DOSBox Staging/dosbox.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return '';
}

function defaultManifest(slug, meta, extra = {}) {
  const type = meta.js ? 'native' : meta.exe || meta.bat ? 'dos' : 'external';
  return {
    id: slug,
    name: meta.name || slug,
    author: meta.author || 'Unknown',
    description: meta.description || 'No description available. Drop a FILE_ID.DIZ in the archive next time.',
    category: meta.category || 'Other',
    type,
    exec: meta.exe || meta.bat || '',
    args: [],
    dropType: type === 'native' ? '' : 'DOOR.SYS',
    cmd: '',
    minLevel: 10,
    enabled: true,
    art: '',
    note: '',
    installedAt: Date.now(),
    ...extra,
  };
}

class DoorManager {
  constructor() {
    this.doors = [];
    this.log = [];
    this.menu = this.menu.bind(this);
    fs.mkdirSync(DOORS_DIR, { recursive: true });
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    this.refresh();
    if (config.get('doors.autoScan')) {
      this.timer = setInterval(() => {
        try {
          this.scanInstallFolder();
        } catch (e) {
          this.pushLog(`scan error: ${e.message}`);
        }
      }, Math.max(5, config.get('doors.scanIntervalSec') || 20) * 1000);
      this.timer.unref?.();
    }
  }

  pushLog(msg) {
    this.log.unshift({ when: Date.now(), msg });
    if (this.log.length > 200) this.log.length = 200;
  }

  // ---- discovery ----------------------------------------------------------
  refresh() {
    const found = [];
    // native doors shipped with the BBS (or dropped into src/doors/native)
    for (const f of fs.existsSync(NATIVE_DIR) ? fs.readdirSync(NATIVE_DIR) : []) {
      if (!f.endsWith('.js')) continue;
      const full = path.join(NATIVE_DIR, f);
      try {
        delete require.cache[require.resolve(full)];
        const mod = require(full);
        if (!mod || typeof mod.run !== 'function') continue;
        found.push({
          id: 'native:' + (mod.id || path.basename(f, '.js')),
          name: mod.name || path.basename(f, '.js'),
          author: mod.author || 'Built-in',
          description: mod.description || '',
          category: mod.category || 'Other',
          type: 'native',
          minLevel: mod.minLevel || 10,
          enabled: mod.enabled !== false,
          builtin: true,
          module: full,
          players: mod.players || 'multi',
          installedAt: 0,
        });
      } catch (e) {
        this.pushLog(`native door ${f} failed to load: ${e.message}`);
      }
    }
    // installed doors
    for (const e of fs.existsSync(DOORS_DIR) ? fs.readdirSync(DOORS_DIR, { withFileTypes: true }) : []) {
      if (!e.isDirectory()) continue;
      if (['install', 'archives', 'tmp', 'native'].includes(e.name)) continue;
      const dir = path.join(DOORS_DIR, e.name);
      const manifestPath = path.join(dir, 'door.json');
      let manifest;
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch {
          manifest = null;
        }
      }
      if (!manifest) {
        manifest = defaultManifest(e.name, sniffMeta(dir, e.name));
        try {
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        } catch {}
      }
      const modulePath = manifest.type === 'native' ? path.join(dir, manifest.entry || 'door.js') : null;
      found.push({
        ...manifest,
        id: manifest.id || e.name,
        dir,
        module: modulePath && fs.existsSync(modulePath) ? modulePath : null,
        installed: true,
      });
    }
    found.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
    // built-in doors can be tweaked (name/level/enabled) without editing source
    const overrides = db.data.doorOverrides || {};
    this.doors = found.map((d) => {
      const o = overrides[d.id];
      if (!o) return d;
      return { ...d, ...o, id: d.id, module: d.module, dir: d.dir, builtin: d.builtin, type: d.type };
    });
    return this.doors;
  }

  scanInstallFolder() {
    if (!fs.existsSync(INSTALL_DIR)) return [];
    const installed = [];
    for (const f of fs.readdirSync(INSTALL_DIR)) {
      const full = path.join(INSTALL_DIR, f);
      if (!fs.statSync(full).isFile()) continue;
      if (!/\.zip$/i.test(f) || !zip.isZip(full)) continue;
      try {
        const manifest = this.installZip(full, { moveArchive: true });
        installed.push(manifest);
      } catch (e) {
        this.pushLog(`failed to install ${f}: ${e.message}`);
        try {
          fs.renameSync(full, path.join(ARCHIVE_DIR, 'FAILED-' + f));
        } catch {}
      }
    }
    if (installed.length) this.refresh();
    return installed;
  }

  installZip(zipPath, opts = {}) {
    const base = path.basename(zipPath, path.extname(zipPath));
    let slug = slugify(base);
    let dir = path.join(DOORS_DIR, slug);
    let n = 2;
    while (fs.existsSync(path.join(dir, 'door.json'))) {
      slug = slugify(base) + '-' + n++;
      dir = path.join(DOORS_DIR, slug);
    }
    fs.mkdirSync(dir, { recursive: true });
    const files = zip.extractZip(zipPath, dir);
    if (!files.length) throw new Error('archive is empty');
    const meta = sniffMeta(dir, prettyName(base));
    const manifest = defaultManifest(slug, meta, { sourceZip: path.basename(zipPath), files: files.length });
    fs.writeFileSync(path.join(dir, 'door.json'), JSON.stringify(manifest, null, 2));
    this.pushLog(`installed ${manifest.name} -> doors/${slug} (${files.length} files)`);
    if (opts.moveArchive) {
      try {
        fs.renameSync(zipPath, path.join(ARCHIVE_DIR, path.basename(zipPath)));
      } catch {}
    }
    this.refresh();
    return manifest;
  }

  saveManifest(door, patch) {
    const dir = door.dir || path.join(DOORS_DIR, door.id.replace(/^native:/, ''));
    const p = path.join(dir, 'door.json');
    const merged = { ...door, ...patch, dir: undefined, module: undefined };
    fs.writeFileSync(p, JSON.stringify(merged, null, 2));
    this.refresh();
    return merged;
  }

  byId(id) {
    return this.doors.find((d) => d.id === id) || null;
  }

  // ---- terminal UI --------------------------------------------------------
  async menu(term) {
    const doors = this.doors.filter((d) => d.enabled !== false && (term.user.level || 0) >= (d.minLevel || 0));
    for (;;) {
      const top = s.frame(term, 'DOORS.ANS', 'DOOR GAMES');
      if (!doors.length) {
        term.color(8);
        term.write('  No doors installed yet.\r\n');
        term.write('  Sysop: drop a .zip into the doors/install folder and it will appear here.\r\n');
        term.reset();
        await term.pause();
        return;
      }
      term.print(top, 3, '  #   Door                             Category   Author', 8);
      term.print(top + 1, 3, '─'.repeat(Math.min(term.cols - 6, 74)), 8);
      const perPage = Math.max(4, term.rows - (top + 5));
      doors.slice(0, perPage).forEach((d, i) => {
        const row = top + 2 + i;
        term.print(row, 3, String(i + 1).padStart(2), 10);
        term.print(row, 7, s.pad(d.name, 32), 15);
        term.print(row, 40, s.pad(d.category, 10), 14);
        term.print(row, 51, s.pad(d.author || '', Math.max(8, term.cols - 54)), 8);
      });
      term.print(term.rows - 3, 3, 'Number to play, [I]nfo, [Q]uit', 14);
      term.gotoxy(term.rows - 2, 1);
      term.reset();
      const k = await term.menu({ prompt: '\x1b[0;36mChoice: \x1b[0m', valid: '123456789IQ', allowEmpty: true });
      if (k == null || k === 'Q' || k === 'ESC' || k === '') return;
      if (k === 'I') {
        const n = await term.readLine({ prompt: 'Door number: ', max: 2 });
        const d = doors[Number(n) - 1];
        if (d) await this.info(term, d);
        continue;
      }
      const door = doors[Number(k) - 1];
      if (!door) continue;
      await this.launch(term, door);
    }
  }

  async info(term, door) {
    term.cls();
    s.header(term, 'DOOR INFORMATION', 11);
    term.write('\r\n');
    const rows = [
      ['Name', door.name],
      ['Author', door.author || 'Unknown'],
      ['Category', door.category],
      ['Type', door.type],
      ['Executable', door.exec || (door.type === 'native' ? '(javascript)' : '?')],
      ['Drop file', door.dropType || '(none)'],
      ['Minimum level', door.minLevel],
      ['Installed', door.installed ? s.fmtDate(door.installedAt || 0) : 'built in'],
    ];
    rows.forEach(([k, v], i) => {
      term.print(5 + i, 5, s.pad(k, 16) + ':', 8);
      term.print(5 + i, 22, String(v), 15);
    });
    term.write('\r\n');
    for (const l of term.wrap(door.description || '', term.cols - 8)) term.write('    ' + l + '\r\n');
    await term.pause();
  }

  // ---- launching ----------------------------------------------------------
  async launch(term, door) {
    term.cls();
    term.color(15);
    term.center(2, door.name, 15);
    term.center(3, door.author || '', 8);
    term.reset();
    term.write('\r\n');
    term.activity = 'Playing ' + door.name;

    if (door.type === 'native') {
      const modPath = door.module || door.modulePath;
      if (!modPath || !fs.existsSync(modPath)) {
        s.error(term, 'This door is missing its door.js. Reinstall the archive.');
        await term.pause();
        return;
      }
      try {
        delete require.cache[require.resolve(modPath)];
        const mod = require(modPath);
        await mod.run(term, {
          config,
          db,
          user: term.user,
          screens: s,
          save: () => db.save(),
          door,
        });
      } catch (err) {
        if (err && (err.name === 'AbortInput' || err.name === 'Hangup')) throw err;
        console.error(`door ${door.name} crashed:`, err);
        this.pushLog(`door ${door.name} crashed: ${err.message}`);
        s.error(term, 'The door crashed. The sysop has been notified.');
        await term.pause();
      }
      term.reset();
      term.write('\r\n');
      s.info(term, 'Returning to the BBS...', 8);
      await term.pause();
      term.activity = 'Main menu';
      return;
    }

    // DOS / external: write the drop file, then run or explain.
    const dir = door.dir || path.join(DOORS_DIR, door.id);
    const dropRel = door.dropType || 'DOOR.SYS';
    let dropPath = '';
    try {
      dropPath = dropfiles.writeDrop(term, dropRel, dir);
    } catch (e) {
      this.pushLog(`drop file failed: ${e.message}`);
    }
    const cmdTemplate = door.cmd || '';
    const dosbox = config.get('doors.dosboxPath') || findDosbox();
    if (door.type === 'dos' && !cmdTemplate && dosbox) {
      await this.runDos(term, door, dir, dosbox);
      return;
    }
    if (!cmdTemplate && !dosbox) {
      term.color(14);
      term.write(`  This is a DOS door: ${door.exec || '(no executable detected)'}\r\n\r\n`);
      term.reset();
      term.write('  The archive is installed and the drop file has been written:\r\n');
      term.write(`  ${dropPath || '(none)'}\r\n\r\n`);
      term.write('  To run DOS doors, install DOSBox-X and set doors.dosboxPath in config.json,\r\n');
      term.write('  or set a runner command in the door manifest (door.json -> "cmd").\r\n');
      term.write('  Example: dosbox-x -c "mount c {dir}" -c "c:" -c "{exec}"\r\n\r\n');
      term.write('  See docs/DOORS.md for the serial/FOSSIL bridge notes.\r\n');
      await term.pause();
      return;
    }
    const cmd = (cmdTemplate || `${dosbox} -noconsole -c "mount c {dir}" -c "c:" -c "{exec}"`)
      .replace(/\{dir\}/g, dir)
      .replace(/\{exec\}/g, door.exec || '')
      .replace(/\{dropfile\}/g, dropPath)
      .replace(/\{node\}/g, String(term.node))
      .replace(/\{port\}/g, String(config.get('doors.tcpBridgePort')));
    await this.runExternal(term, cmd, dir, door);
  }

  // DOS doors: DOSBox draws to a screen nobody sees, so the game talks to the
  // caller over an emulated serial port that we bridge onto the terminal.
  async runDos(term, door, dir, exe) {
    return require('./dosbox').runDos(this, term, door, dir, exe);
  }

  runExternal(term, cmd, cwd, door, opts = {}) {
    return new Promise((resolve) => {
      this.pushLog(`launch: ${cmd}`);
      const port = opts.serialPort || pickPort(cmd);
      const isSerial = !!port || /\{port\}|nullmodem|serial/i.test(cmd);
      let child;
      const env = { ...process.env, BBS_NODE: String(term.node), BBS_HANDLE: term.user ? term.user.handle : '' };
      if (door.type === 'dos') {
        // DOS doors draw to a "screen" we never show; the caller only sees COM1
        env.SDL_VIDEODRIVER = env.SDL_VIDEODRIVER || 'dummy';
        env.SDL_AUDIODRIVER = env.SDL_AUDIODRIVER || 'dummy';
      }
      try {
        child = spawn(cmd, { cwd, shell: true, env });
      } catch (e) {
        s.error(term, `Could not start the door: ${e.message}`);
        return resolve();
      }
      let finished = false;
      let timer = null;
      let sock = null;
      let bridge = null;
      const done = () => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        try {
          sock?.destroy();
          bridge?.close();
        } catch {}
        term.rawHandler = null;
        term.reset();
        term.write('\r\n');
        resolve();
      };
      // A serial door talks over a TCP bridge. DOSBox's nullmodem is set up as a
      // server, but in practice it dials out to whoever is listening on that port,
      // so the board listens and DOSBox connects.
      if (isSerial) {
        const target = port || Number(config.get('doors.tcpBridgePort')) || 2444;
        let sawData = false;
        let probeTail = '';
        let carry = '';
        const net = require('node:net');
        bridge = net.createServer((s) => {
          sock = s;
          this.pushLog(`${door.name} serial bridge up on ${target}`);
          s.on('data', (b) => {
            if (!sawData) {
              sawData = true;
              if (timer) clearTimeout(timer);
            }
            const chunk = b.toString('latin1');
            // a screen scraper asks the terminal who it is before handing over;
            // xterm and telnet clients are inconsistent, so the bridge answers
            probeTail = (probeTail + chunk).slice(-32);
            if (probeTail.includes('[6n')) {
              probeTail = probeTail.split('[6n').join('');
              try { s.write('[1;1R'); } catch {}
            }
            if (probeTail.includes('[c')) {
              probeTail = probeTail.split('[c').join('');
              try { s.write('[?1;0c'); } catch {}
            }
            // DOSBox's nullmodem opens with 0xFF 0x00 sync pairs; they are not
            // terminal output and show up as rubbish glyphs if passed through.
            // A pair can straddle two packets, so hold back a trailing 0xFF.
            const FF = String.fromCharCode(255);
            let data = carry + chunk;
            carry = '';
            if (data.endsWith(FF)) {
              carry = FF;
              data = data.slice(0, -1);
            }
            const clean = data.split(FF + String.fromCharCode(0)).join('');
            // the door writes CP437: telnet clients expect it raw, the web
            // terminal needs it as UTF-8 or the box drawing turns to mojibake
            term.writeRaw(term.kind === 'web' ? cp437.decode(Buffer.from(clean, 'latin1')) : clean);
          });
          s.on('close', () => setTimeout(done, 400));
          s.on('error', () => {});
          term.rawHandler = (chunk) => {
            try {
              s.write(String(chunk), 'binary');
            } catch {}
          };
          try { bridge.close(); } catch {}
        });
        bridge.on('error', (e) => {
          s.error(term, 'Serial bridge failed: ' + e.message);
          done();
        });
        bridge.listen(target, '127.0.0.1', () => this.pushLog(`${door.name} waiting for COM1 on ${target}`));
        timer = setTimeout(() => {
          if (sawData || finished) return;
          term.writeRaw(String.fromCharCode(13, 10) + String.fromCharCode(13, 10));
          const hint = [
            '  This game started but sent nothing to COM1.',
            '  A DOS door has to be told to use the serial port before it will',
            '  talk to a caller: run its setup program once (for LORD that is',
            '  LORDCFG.EXE, option (S)etup Nodes -> COM1, 14400, DOOR.SYS).',
            '  Press any key to go back.',
          ];
          for (const line of hint) term.write(line + String.fromCharCode(13, 10));
        }, 30000);
      } else {
        term.rawHandler = (chunk) => {
          try {
            child.stdin.write(chunk);
          } catch {}
        };
      }
      if (isSerial) {
        // DOSBox chatters on stderr about SDL and BIOS calls; that is sysop
        // material, not something a caller should see scroll past
        const logFile = path.join(cwd, 'dosbox.log');
        const logStream = fs.createWriteStream(logFile, { flags: 'a' });
        child.stdout?.on('data', (b) => logStream.write(b));
        child.stderr?.on('data', (b) => logStream.write(b));
        child.on('exit', () => logStream.end());
      } else {
        child.stdout?.on('data', (b) => term.writeRaw(b.toString('utf8')));
        child.stderr?.on('data', (b) => term.writeRaw(b.toString('utf8')));
      }
      child.on('error', (e) => {
        s.error(term, `Door error: ${e.message}`);
        done();
      });
      child.on('exit', (code) => {
        this.pushLog(`door ${door.name} exited with ${code}`);
        done();
      });
      timer = setTimeout(() => {
        if (!finished) {
          s.info(term, 'Time is up. Closing the door.', 8);
          try {
            child.kill();
          } catch {}
        }
      }, Math.max(2, term.session.minutesLeft) * 60000);
      term.on('hangup', () => {
        try {
          child.kill();
        } catch {}
        done();
      });
    });
  }
}

module.exports = new DoorManager();
module.exports.DOORS_DIR = DOORS_DIR;
module.exports.INSTALL_DIR = INSTALL_DIR;
module.exports.CATEGORIES = CATEGORIES;
module.exports.slugify = slugify;
