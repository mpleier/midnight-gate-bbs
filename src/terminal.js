'use strict';
// Terminal: one connected caller. Transport agnostic (telnet socket or websocket),
// ANSI output, line/key input, echo, cursor control, art display.
const { EventEmitter } = require('node:events');
const cp437 = require('./cp437');

const ESC = '\x1b';
const CSI = ESC + '[';

const KEY_NAMES = {
  '\x1b[A': 'UP',
  '\x1b[B': 'DOWN',
  '\x1b[C': 'RIGHT',
  '\x1b[D': 'LEFT',
  '\x1b[H': 'HOME',
  '\x1b[F': 'END',
  '\x1b[1~': 'HOME',
  '\x1b[4~': 'END',
  '\x1b[5~': 'PGUP',
  '\x1b[6~': 'PGDN',
  '\x1b[2~': 'INSERT',
  '\x1b[3~': 'DELETE',
  '\x1bOP': 'F1',
  '\x1bOQ': 'F2',
  '\x1bOR': 'F3',
  '\x1bOS': 'F4',
  '\x1b[15~': 'F5',
  '\x1b[17~': 'F6',
  '\x1b[18~': 'F7',
  '\x1b[19~': 'F8',
  '\x1b[20~': 'F9',
  '\x1b[21~': 'F10',
};

class AbortInput extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortInput';
  }
}

class Hangup extends Error {
  constructor() {
    super('carrier lost');
    this.name = 'Hangup';
  }
}

class Terminal extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.id = opts.id || 1;
    this.kind = opts.kind || 'telnet';
    this.remote = opts.remote || '';
    this.cols = opts.cols || 80;
    this.rows = opts.rows || 25;
    this.ansi = opts.ansi !== false;
    this.carrier = true;
    this.connectedAt = Date.now();
    this.lastActivity = Date.now();
    this._send = opts.send || (() => {});
    this._closer = opts.close || (() => {});
    this._buffer = '';
    this._waiter = null;
    this._closed = false;
    this.user = null;
    this.session = {
      node: this.id,
      start: Date.now(),
      minutesLeft: 0,
      timeLimit: 0,
      uploads: 0,
      downloads: 0,
      posts: 0,
      isNew: false,
      idleWarned: false,
    };
    this.onlineMsgs = 0;
  }

  // ---------------------------------------------------------------- output
  write(text) {
    if (!this.carrier || text == null) return;
    let s = String(text);
    s = s.replace(/\r?\n/g, '\r\n').replace(/\r(?!\n)/g, '\r\n');
    if (!this.ansi) s = s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b[()][0-9A-B]/g, '');
    this._send(s);
    this.lastActivity = Date.now();
  }

  writeRaw(s) {
    if (!this.carrier) return;
    this._send(String(s));
    this.lastActivity = Date.now();
  }

  // bytes of a CP437 art file -> unicode line art
  art(buf, x = 1, y = 1) {
    const text = typeof buf === 'string' ? buf : cp437.decode(buf);
    const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\x00/g, '');
    if (x > 1 || y > 1) this.gotoxy(y, x);
    this.writeRaw(clean.replace(/\n/g, '\r\n'));
    this.lastActivity = Date.now();
  }

  cls() {
    this.writeRaw(CSI + '0m' + CSI + '2J' + CSI + 'H');
  }

  clear() {
    this.writeRaw(CSI + '2J' + CSI + 'H');
  }

  gotoxy(row, col) {
    this.writeRaw(CSI + Math.max(1, row) + ';' + Math.max(1, col) + 'H');
  }

  color(fg, bg) {
    const f = fg == null ? 39 : 30 + (fg & 7) + (fg > 7 ? 60 : 0);
    let s = CSI + '0;' + f + 'm';
    if (bg != null) s = CSI + '0;' + f + ';' + (40 + (bg & 7) + (bg > 7 ? 60 : 0)) + 'm';
    this.writeRaw(s);
  }

  reset() {
    this.writeRaw(CSI + '0m');
  }

  beep() {
    this.writeRaw('\x07');
  }

  print(row, col, text, fg, bg) {
    this.gotoxy(row, col);
    if (fg != null) this.color(fg, bg);
    this.write(text);
    if (fg != null) this.reset();
    return this;
  }

  center(row, text, fg, bg) {
    const t = String(text);
    const col = Math.max(1, Math.floor((this.cols - t.length) / 2) + 1);
    this.print(row, col, t, fg, bg);
    return this;
  }

  right(row, text, fg, bg) {
    const t = String(text);
    this.print(row, Math.max(1, this.cols - t.length + 1), t, fg, bg);
    return this;
  }

  hrule(row, ch = '─', fg) {
    this.print(row, 1, ch.repeat(this.cols), fg);
    return this;
  }

  box(x, y, w, h, opts = {}) {
    const { fg = 7, double = false, bg = null } = opts;
    const c = double
      ? { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' }
      : { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' };
    if (fg != null) this.color(fg, bg);
    this.print(y, x, c.tl + c.h.repeat(Math.max(0, w - 2)) + c.tr);
    for (let i = 1; i < h - 1; i++) {
      this.print(y + i, x, c.v, fg, bg);
      this.print(y + i, x + w - 1, c.v, fg, bg);
    }
    this.print(y + h - 1, x, c.bl + c.h.repeat(Math.max(0, w - 2)) + c.br);
    if (fg != null) this.reset();
    return this;
  }

  banner(text, opts = {}) {
    const { fg = 15, bg = 1, row = 2 } = opts;
    this.print(row, 1, ' '.repeat(this.cols), fg, bg);
    this.center(row, ' ' + text + ' ', fg, bg);
    return this;
  }

  statusBar(text) {
    if (this.rows < 2) return this;
    this.print(this.rows, 1, ' '.repeat(this.cols), 0, 7);
    this.print(this.rows, 1, ` ${text}`.slice(0, this.cols), 0, 7);
    this.reset();
    return this;
  }

  wrap(text, width = this.cols - 4) {
    const out = [];
    for (const para of String(text).split(/\n/)) {
      if (!para.length) {
        out.push('');
        continue;
      }
      let line = '';
      for (const word of para.split(/\s+/)) {
        if (!line.length) line = word;
        else if (line.length + 1 + word.length <= width) line += ' ' + word;
        else {
          out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  }

  // ----------------------------------------------------------------- input
  feed(chunk) {
    if (!this.carrier) return;
    let s;
    if (typeof chunk === 'string') s = chunk;
    else s = cp437.decode(chunk);
    if (this.rawHandler) {
      // external door in control: hand every byte straight through
      this.lastActivity = Date.now();
      try {
        this.rawHandler(s);
      } catch {}
      return;
    }
    // Normalise CR/LF and DEL, drop other control noise except tab/esc/ctrl keys.
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    this._buffer += s;
    this.lastActivity = Date.now();
    this._pump();
    this.emit('data');
  }

  _pump() {
    if (!this._waiter) return;
    const { resolve, timer } = this._waiter;
    this._waiter = null;
    if (timer) clearTimeout(timer);
    const buf = this._buffer;
    this._buffer = '';
    resolve(buf);
  }

  _next(timeoutMs = 0) {
    if (this._buffer.length) {
      const ch = this._buffer[0];
      this._buffer = this._buffer.slice(1);
      return Promise.resolve(ch);
    }
    if (!this.carrier) return Promise.reject(new Hangup());
    return new Promise((resolve, reject) => {
      let done = false;
      let timer = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (this._waiter && this._waiter.resolve === wrapped) this._waiter = null;
        this.removeListener('hangup', onHangup);
      };
      const finish = (v) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(v);
      };
      const fail = (e) => {
        if (done) return;
        done = true;
        cleanup();
        reject(e);
      };
      const wrapped = (buf) => {
        this._buffer = buf;
        if (!this._buffer.length) return finish(null);
        const ch = this._buffer[0];
        this._buffer = this._buffer.slice(1);
        finish(ch);
      };
      const onHangup = () => fail(new Hangup());
      if (timeoutMs > 0) timer = setTimeout(() => finish(null), timeoutMs);
      this._waiter = { resolve: wrapped, timer };
      this.on('hangup', onHangup);
    });
  }

  async readKey(opts = {}) {
    const ch = await this._next(opts.timeoutMs || 0);
    if (ch == null) return null;
    if (ch === '\x1b') {
      const seq = await this._readEscape();
      return KEY_NAMES[seq] || 'ESC';
    }
    if (ch === '\n') return 'ENTER';
    if (ch === '\x7f' || ch === '\x08') return 'BACKSPACE';
    if (ch === '\t') return 'TAB';
    if (ch === '\x03') return 'CTRL-C';
    if (ch === ' ') return 'SPACE';
    return ch;
  }

  async _readEscape() {
    let seq = '\x1b';
    const c1 = await this._next(60);
    if (c1 == null) return seq;
    seq += c1;
    if (c1 !== '[' && c1 !== 'O') return seq;
    for (let i = 0; i < 6; i++) {
      const c = await this._next(60);
      if (c == null) break;
      seq += c;
      if (/[A-Za-z~]/.test(c)) break;
    }
    return seq;
  }

  async readLine(opts = {}) {
    const {
      prompt = '',
      max = 60,
      upper = false,
      mask = false,
      allowEmpty = true,
      min = 0,
      defaultVal = null,
      validate = null,
    } = opts;
    if (prompt) this.write(prompt);
    let value = '';
    for (;;) {
      const ch = await this._next(0);
      if (ch === '\x03') {
        this.write('^C\r\n');
        throw new AbortInput();
      }
      if (ch === '\x1b') {
        const seq = await this._readEscape();
        if (seq === '\x1b') {
          this.write('\r\n');
          throw new AbortInput();
        }
        const named = KEY_NAMES[seq];
        if (named === 'HOME' || named === 'END' || named === 'LEFT' || named === 'RIGHT' || named === 'DELETE') {
          continue;
        }
        continue;
      }
      if (ch === '\n') {
        if (!value.length && defaultVal != null) value = String(defaultVal);
        this.write('\r\n');
        if (value.length < min) {
          this.write(`Minimum length is ${min} characters.\r\n`);
          if (prompt) this.write(prompt);
          value = '';
          continue;
        }
        if (!allowEmpty && !value.length) {
          this.write('Required, no way around it.\r\n');
          if (prompt) this.write(prompt);
          continue;
        }
        return upper ? value.toUpperCase() : value;
      }
      if (ch === '\x7f' || ch === '\x08') {
        if (value.length) {
          value = value.slice(0, -1);
          this.write('\b \b');
        }
        continue;
      }
      if (ch === '\x15') {
        // ctrl-U: wipe the line
        this.write('\b \b'.repeat(value.length));
        value = '';
        continue;
      }
      if (ch === '\t') continue;
      const code = ch.charCodeAt(0);
      if (code < 32 || code === 127) continue;
      if (value.length >= max) {
        this.beep();
        continue;
      }
      const piece = upper ? ch.toUpperCase() : ch;
      value += piece;
      this.write(mask ? '*' : piece);
    }
  }

  async pause(msg = 'Press any key to continue') {
    this.write(`\r\n${msg}... `);
    await this.readKey({ timeoutMs: 0 });
    this.write('\r\n');
  }

  async yesno(prompt, defaultVal = false) {
    const suffix = defaultVal ? ' [Y/n]? ' : ' [y/N]? ';
    this.write(prompt + suffix);
    for (;;) {
      const k = await this.readKey({ timeoutMs: 120000 });
      if (k == null) return defaultVal;
      if (k === 'ENTER') {
        this.write(defaultVal ? 'Yes\r\n' : 'No\r\n');
        return defaultVal;
      }
      const ch = String(k).toLowerCase();
      if (ch === 'y') {
        this.write('Yes\r\n');
        return true;
      }
      if (ch === 'n') {
        this.write('No\r\n');
        return false;
      }
      if (k === 'ESC') return false;
    }
  }

  async menu(opts = {}) {
    const { prompt = 'Selection: ', valid = null, defaultVal = null, allowEmpty = false } = opts;
    if (prompt) this.write(prompt);
    for (;;) {
      const k = await this.readKey({ timeoutMs: this.session.idleMs || 180000 });
      if (k == null) return null;
      if (k === 'ENTER') {
        if (defaultVal) {
          this.write(defaultVal + '\r\n');
          return defaultVal.toUpperCase();
        }
        if (allowEmpty) {
          this.write('\r\n');
          return '';
        }
        continue;
      }
      const ch = String(k).toUpperCase();
      if (ch.length === 1 && (!valid || valid.includes(ch))) {
        this.write(ch + '\r\n');
        return ch;
      }
      if (k === 'ESC') {
        this.write('\r\n');
        return 'ESC';
      }
      this.beep();
    }
  }

  // --------------------------------------------------------------- lifecycle
  hangup(reason = 'NO CARRIER') {
    if (this._closed) return;
    this._closed = true;
    this.carrier = false;
    this.emit('hangup', reason);
    try {
      this._closer(reason);
    } catch {}
  }

  get alive() {
    return this.carrier && !this._closed;
  }
}

module.exports = Terminal;
module.exports.AbortInput = AbortInput;
module.exports.Hangup = Hangup;
module.exports.KEY_NAMES = KEY_NAMES;
