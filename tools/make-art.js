'use strict';
/**
 * make-art.js -- THE MIDNIGHT GATE ANSI art pack.
 *
 * Every file in ../art is generated from this script, so the screens are
 * reproducible and easy to tweak. Run from the project root:
 *
 *     node tools/make-art.js
 *
 * Design contract (see src/flow/screens.js):
 *   - screens are drawn at row 1, col 1 on an 80x25 ANSI terminal after cls()
 *   - 80 columns max, 25 rows max, CP437 glyphs only, no tabs
 *   - full screens (WELCOME / MAIN) leave their lower rows EMPTY because the
 *     running code prints login info / the menu box into that space
 *   - section banners are exactly 4 rows so nothing below them is repainted
 *
 * The script also validates its own output and prints a table.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp437 = require('../src/cp437');

const ART_DIR = path.join(__dirname, '..', 'art');
const W = 80;
const H = 25;
const DEF_FG = 7;
const DEF_BG = -1;

/* ------------------------------------------------------------------ colour */

// bold-on / dimmed variants of the 16 ANSI colours (bevel + shading)
const BRIGHT = { 0: 8, 1: 9, 2: 10, 3: 11, 4: 12, 5: 13, 6: 14, 7: 15, 8: 7, 9: 15, 10: 14, 11: 15, 12: 15, 13: 15, 14: 15, 15: 15 };
const DARK = { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 8, 7: 8, 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 6, 15: 7 };

function sgr(fg, bg) {
  const bold = fg > 7 ? '1' : '0';
  let s = `\x1b[${bold};${30 + (fg & 7)}`;
  if (bg >= 0) s += `;${bg > 7 ? 100 + (bg & 7) : 40 + bg}`;
  return s + 'm';
}

// piecewise-linear ramp over colour stops: ramp([11, 15, 13])(t)
function ramp(stops) {
  return (t) => {
    const p = Math.max(0, Math.min(1, t)) * (stops.length - 1);
    return stops[Math.round(p)];
  };
}

/* ------------------------------------------------------------------ canvas */

class Screen {
  constructor(w = W, h = H) {
    this.w = w;
    this.h = h;
    this.ch = [];
    this.fg = [];
    this.bg = [];
    for (let y = 0; y < h; y++) {
      this.ch.push(new Array(w).fill(' '));
      this.fg.push(new Array(w).fill(DEF_FG));
      this.bg.push(new Array(w).fill(DEF_BG));
    }
  }

  // public coordinates are 1-based screen cells (col 1..80, row 1..25)
  inside(x, y) {
    return x >= 1 && y >= 1 && x <= this.w && y <= this.h;
  }

  get(x, y) {
    return this.inside(x, y) ? this.ch[y - 1][x - 1] : ' ';
  }

  rowEmpty(y) {
    const row = this.ch[y - 1];
    for (let x = 0; x < this.w; x++) {
      if (row[x] !== ' ' || this.fg[y - 1][x] !== DEF_FG || this.bg[y - 1][x] !== DEF_BG) return false;
    }
    return true;
  }

  set(x, y, c, fg = DEF_FG, bg = DEF_BG) {
    if (!this.inside(x, y)) return this;
    this.ch[y - 1][x - 1] = c;
    this.fg[y - 1][x - 1] = fg;
    this.bg[y - 1][x - 1] = bg;
    return this;
  }

  text(x, y, str, fg = DEF_FG, bg = DEF_BG) {
    let i = 0;
    for (const c of String(str)) {
      this.set(x + i, y, c, fg, bg);
      i++;
    }
    return this;
  }

  fill(x, y, w, h, c, fg = DEF_FG, bg = DEF_BG) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, fg, bg);
    return this;
  }

  hline(x, y, w, c, fg = DEF_FG, bg = DEF_BG) {
    for (let i = 0; i < w; i++) this.set(x + i, y, c, fg, bg);
    return this;
  }

  vline(x, y, h, c, fg = DEF_FG, bg = DEF_BG) {
    for (let j = 0; j < h; j++) this.set(x, y + j, c, fg, bg);
    return this;
  }

  // trim trailing default cells, emit SGR only on attribute changes
  toString() {
    let lastRow = this.h;
    while (lastRow >= 1 && this.rowEmpty(lastRow)) lastRow--;
    const rows = [];
    for (let y = 1; y <= lastRow; y++) {
      let end = this.w - 1;
      while (end >= 0 && this.ch[y - 1][end] === ' ' && this.fg[y - 1][end] === DEF_FG && this.bg[y - 1][end] === DEF_BG) end--;
      let line = '';
      let curFg = null;
      let curBg = null;
      for (let x = 0; x <= end; x++) {
        const fg = this.fg[y - 1][x];
        const bg = this.bg[y - 1][x];
        if (fg !== curFg || bg !== curBg) {
          line += sgr(fg, bg);
          curFg = fg;
          curBg = bg;
        }
        line += this.ch[y - 1][x];
      }
      if (curFg !== null && (curFg !== DEF_FG || curBg !== DEF_BG)) line += '\x1b[0m';
      rows.push(line);
    }
    return rows.join('\r\n') + '\r\n';
  }
}

/* ------------------------------------------------------------------- fonts */

// 5-row logo face. '#' is solid; every glyph row must be the same width.
const BIG = {
  A: [' ### ', '#   #', '#####', '#   #', '#   #'],
  B: ['#### ', '#   #', '#### ', '#   #', '#### '],
  C: [' ####', '#    ', '#    ', '#    ', ' ####'],
  D: ['#### ', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#### ', '#    ', '#####'],
  F: ['#####', '#    ', '#### ', '#    ', '#    '],
  G: [' ####', '#    ', '# ###', '#   #', ' ####'],
  H: ['#   #', '#   #', '#####', '#   #', '#   #'],
  I: ['###', ' # ', ' # ', ' # ', '###'],
  J: ['   ##', '    #', '    #', '#   #', ' ### '],
  K: ['#   #', '#  # ', '###  ', '#  # ', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '#   #', '#   #'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
  P: ['#### ', '#   #', '#### ', '#    ', '#    '],
  Q: [' ### ', '#   #', '# # #', '#  # ', ' ## #'],
  R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
  S: [' ####', '#    ', ' ### ', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', ' ### '],
  V: ['#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
  X: ['#   #', ' # # ', '  #  ', ' # # ', '#   #'],
  Y: ['#   #', ' # # ', '  #  ', '  #  ', '  #  '],
  Z: ['#####', '   # ', '  #  ', ' #   ', '#####'],
  ' ': ['   ', '   ', '   ', '   ', '   '],
  0: [' ### ', '#  ##', '# # #', '##  #', ' ### '],
  1: ['  #  ', ' ##  ', '  #  ', '  #  ', ' ### '],
  2: [' ### ', '#   #', '  ## ', ' #   ', '#####'],
  3: ['#### ', '    #', ' ### ', '    #', '#### '],
  4: ['#  # ', '#  # ', '#####', '   # ', '   # '],
  5: ['#####', '#    ', '#### ', '    #', '#### '],
  6: [' ### ', '#    ', '#### ', '#   #', ' ### '],
  7: ['#####', '    #', '   # ', '  #  ', '  #  '],
  8: [' ### ', '#   #', ' ### ', '#   #', ' ### '],
  9: [' ### ', '#   #', ' ####', '    #', ' ### '],
  '-': ['   ', '   ', '###', '   ', '   '],
  '.': [' ', ' ', ' ', ' ', '#'],
  "'": ['#', '#', ' ', ' ', ' '],
};

// 3-row header face, with half-block roundovers so it reads as art, not ASCII.
const MID = {
  A: ['▄█▀█▄', '█   █', '▀   ▀'],
  B: ['█▀▀▄ ', '█▀▀▄ ', '▀▀▀▀ '],
  C: ['▄▀▀▀▀', '█    ', '▀▀▀▀▀'],
  D: ['█▀▀▄ ', '█  █ ', '▀▀▀▀ '],
  E: ['█▀▀▀▀', '█▀▀▀ ', '▀▀▀▀▀'],
  F: ['█▀▀▀▀', '█▀▀▀ ', '▀    '],
  G: ['▄▀▀▀▀', '█ ▀▀█', '▀▀▀▀▀'],
  H: ['█   █', '█▀▀▀█', '▀   ▀'],
  I: [' ▀█▀ ', '  █  ', ' ▄█▄ '],
  J: ['   █ ', '   █ ', '▀▀▀▀▀'],
  K: ['█  █ ', '█▀▀█ ', '▀  ▀ '],
  L: ['█    ', '█    ', '▀▀▀▀▀'],
  M: ['█▄ ▄█', '█ █ █', '▀   ▀'],
  N: ['█▄  █', '█ ▀▄█', '▀   ▀'],
  O: ['▄▀▀▄', '█  █', '▀▀▀▀'],
  P: ['█▀▀▄', '█▀▀ ', '▀   '],
  Q: ['▄▀▀▄', '█ ▀█', '▀▀▀▀'],
  R: ['█▀▀▄', '█▀▀ ', '▀  ▀'],
  S: ['▄▀▀▀▀', '▀▀▀▄ ', '▀▀▀▀ '],
  T: ['▀▀█▀▀', '  █  ', ' ▄█▄ '],
  U: ['█   █', '█   █', '▀▀▀▀▀'],
  V: ['█   █', '▀▄ ▄▀', '  ▀  '],
  W: ['█   █', '█ █ █', '▀▄▀▄▀'],
  X: ['█   █', ' ▀▄▀ ', '▄▀ ▀▄'],
  Y: ['█   █', ' ▀▄▀ ', '  █  '],
  Z: ['▀▀▀▀█', ' ▄▀▀ ', '█▄▄▄▄'],
  ' ': ['  ', '  ', '  '],
  '.': [' ', ' ', '▄'],
  '-': ['   ', '▀▀▀', '   '],
  "'": ['▀', ' ', ' '],
};

function bigWidth(str) {
  // every glyph is padded to a fixed 5-column cell plus a 1-column gap, so
  // narrow letters (I, J, 1) don't knock the logo out of alignment
  const n = str.length;
  return n ? n * (BIG_CELL + 1) - 1 : 0;
}

function midWidth(str) {
  let w = 0;
  for (const c of str.toUpperCase()) w += (MID[c] || MID[' '])[0].length + 1;
  return w - 1;
}

/**
 * Draw 5-row block letters with a horizontal colour ramp plus a bevel:
 * the top row is brightened, the bottom row darkened, and an optional
 * one-column dark extrusion on the right edge gives it depth.
 */
const BIG_CELL = 5;

function bigText(s, x, y, str, opts = {}) {
  const { color = ramp([11, 15, 13]), bevel = true } = opts;
  let cx = x;
  const total = bigWidth(str);
  for (const c of str.toUpperCase()) {
    const g = BIG[c] || BIG[' '];
    for (let r = 0; r < g.length; r++) {
      const row = g[r];
      const pad = Math.max(0, BIG_CELL - row.length);
      const left = Math.floor(pad / 2);
      const cell = ' '.repeat(left) + row + ' '.repeat(pad - left);
      for (let i = 0; i < cell.length; i++) {
        if (cell[i] !== '#') continue;
        let fg = color((cx + i - x) / Math.max(1, total));
        if (bevel) {
          if (r === 0) fg = BRIGHT[fg];
          else if (r === g.length - 1) fg = DARK[fg];
        }
        s.set(cx + i, y + r, '█', fg);
      }
    }
    cx += BIG_CELL + 1;
  }
  return cx - 1 - x;
}

function midText(s, x, y, str, opts = {}) {
  const { color = ramp([11, 15, 13]), bevel = true } = opts;
  const glyphs = [];
  let cx = x;
  for (const c of str.toUpperCase()) {
    glyphs.push({ g: MID[c] || MID[' '], x: cx });
    cx += (MID[c] || MID[' '])[0].length + 1;
  }
  const total = cx - 1 - x;
  for (const { g, x: gx } of glyphs) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < g[r].length; c++) {
        if (g[r][c] === ' ') continue;
        let fg = color((gx + c - x) / Math.max(1, total));
        if (bevel) {
          if (r === 0) fg = BRIGHT[fg];
          else if (r === 2) fg = DARK[fg];
        }
        s.set(gx + c, y + r, g[r][c], fg);
      }
    }
  }
  return total;
}

/* ------------------------------------------------------------------ pieces */

function frame(s, x, y, w, h, fg = 11) {
  s.hline(x + 1, y, w - 2, '═', fg);
  s.hline(x + 1, y + h - 1, w - 2, '═', fg);
  s.vline(x, y + 1, h - 2, '║', fg);
  s.vline(x + w - 1, y + 1, h - 2, '║', fg);
  s.set(x, y, '╔', fg);
  s.set(x + w - 1, y, '╗', fg);
  s.set(x, y + h - 1, '╚', fg);
  s.set(x + w - 1, y + h - 1, '╝', fg);
}

// overlay "[ label ]" onto an existing horizontal border row, centred
function borderLabel(s, y, label, fgLabel = 15, fgRule = 11) {
  const inner = ` ${label} `;
  const total = inner.length + 2;
  const x = Math.floor((s.w - total) / 2);
  s.set(x, y, '╡', fgRule);
  s.text(x + 1, y, inner, fgLabel);
  s.set(x + 1 + inner.length, y, '╞', fgRule);
}

function stars(s, x, y, w, h, rnd, fg = 8) {
  const glyphs = ['·', '·', '·', '°'];
  const n = Math.round((w * h) / 9);
  for (let i = 0; i < n; i++) {
    const px = x + Math.floor(rnd() * w);
    const py = y + Math.floor(rnd() * h);
    if (s.get(px, py) !== ' ') continue;
    s.set(px, py, glyphs[Math.floor(rnd() * glyphs.length)], fg);
  }
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// crescent moon, 9 wide x 4 tall, lit on the left
function moon(s, x, y) {
  const art = ['  ▄███▄ ', ' ██████▀', ' ██████▄', '  ▀███▀ '];
  art.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] !== ' ') s.set(x + c, y + r, row[c], r === 3 ? 7 : 15);
  });
}

// distant skyline: hand-placed silhouettes so the horizon reads as a city,
// with lit windows on a grid instead of random speckle
function skyline(s, rnd, baseRow, buildings) {
  for (const b of buildings) {
    const { x, w, h } = b;
    for (let i = 0; i < w; i++) {
      for (let r = 0; r < h; r++) s.set(x + i, baseRow - r, '█', 8);
      s.set(x + i, baseRow - h + 1, '▄', 7);
    }
    // windows: every other column/row, mostly lit
    for (let r = 1; r < h - 1; r++) {
      for (let i = 1; i < w - 1; i += 2) {
        if (rnd() < 0.62) s.set(x + i, baseRow - h + 1 + r, '·', rnd() < 0.55 ? 14 : 11);
      }
    }
    if (b.antenna) {
      const ax = x + Math.floor(w / 2);
      s.set(ax, baseRow - h, '│', 8);
      s.set(ax, baseRow - h - 1, '·', 15);
    }
    if (b.spire) s.set(x + Math.floor(w / 2), baseRow - h, '▄', 7);
  }
}

// telephone handset: two thick cups joined by a thin handle, 3 rows tall
function handset(s, x, y, fg = 11) {
  s.hline(x, y, 8, '▄', fg);
  s.hline(x + 24, y, 8, '▄', fg);
  s.hline(x, y + 1, 8, '█', fg);
  s.hline(x + 8, y + 1, 16, '▄', fg);
  s.hline(x + 24, y + 1, 8, '█', fg);
  s.hline(x, y + 2, 8, '▀', fg);
  s.hline(x + 24, y + 2, 8, '▀', fg);
}

// modem box with a row of status lamps, 3 rows tall
function modemBox(s, x, y, label) {
  s.text(x, y, '╔═══════════════════╗', 11);
  s.set(x, y, '╔', 11);
  s.text(x, y + 1, '║', 11);
  s.text(x + 2, y + 1, '■', 12);
  s.text(x + 4, y + 1, '■', 14);
  s.text(x + 6, y + 1, '■', 10);
  s.text(x + 9, y + 1, label, 15);
  s.text(x + 19, y + 1, '║', 11);
  s.text(x, y + 2, '╚═══════════════════╝', 11);
}

/* ----------------------------------------------------------------- screens */

const LOGO_RAMP = ramp([11, 11, 15, 15, 15, 13, 13]);
const WARM_RAMP = ramp([14, 14, 15, 15, 13, 13, 5]);

// WELCOME: rows 1-11 only; login block is printed underneath by login.js
function welcome() {
  const s = new Screen();
  frame(s, 1, 1, 80, 11, 11);
  borderLabel(s, 1, 'T H E   M I D N I G H T   G A T E', 15, 11);

  const logo = 'MIDNIGHT GATE';
  const lw = bigWidth(logo);
  bigText(s, Math.floor((80 - lw) / 2) + 1, 2, logo, { color: LOGO_RAMP });

  // tagline with dither flanks
  const tag = 'WHERE THE NIGHT NEVER ENDS';
  const tx = Math.floor((80 - tag.length) / 2) + 1;
  s.text(tx - 5, 7, '░▒▓', 3);
  s.text(tx, 7, tag, 15);
  s.text(tx + tag.length + 2, 7, '▓▒░', 3);

  handset(s, 4, 8, 11);
  for (let x = 38; x <= 52; x += 3) s.set(x, 9, '·', 8);
  modemBox(s, 56, 8, '1 4 4 0 0');

  borderLabel(s, 11, 'EST. 1990 · PORTLAND, OREGON · NODE 01', 7, 11);
  return s;
}

// LOGIN: minimalist strip + an open panel for the logon prompts
function login() {
  const s = new Screen(80, 10);
  s.hline(1, 1, 78, '═', 11);
  s.set(1, 1, '■', 13);
  s.set(79, 1, '■', 13);

  const logo = 'CALLER LOGON';
  const lw = midWidth(logo);
  midText(s, Math.floor((80 - lw) / 2) + 1, 2, logo, { color: LOGO_RAMP });

  s.hline(1, 5, 78, '─', 8);
  s.text(3, 6, '░▒▓', 3);
  s.text(7, 6, 'MEMBERS AND FIRST-TIME CALLERS WELCOME', 7);
  s.text(70, 6, '▓▒░', 3);

  // panel outline the prompt lines drop into
  frame(s, 12, 7, 56, 4, 11);
  s.text(14, 7, '╡ LOGON ╞', 13);
  return s;
}

// NEWUSER: header plate; rows 2-3 stay clear on the left because login.js
// prints its own heading at (2,2) and (3,2) once the art is down
function newuser() {
  const s = new Screen(80, 6);
  frame(s, 1, 1, 80, 6, 11);
  borderLabel(s, 1, 'N E W   C A L L E R S', 15, 11);

  // right-hand badge keeps clear of the code's title text
  badge(s, 56, 2, 21, '· GATE ·', 9);

  s.text(4, 4, '░ MEMBERSHIP IS FREE', 8);
  s.text(4, 5, '░▒▓█', 3);
  s.hline(9, 5, 63, '─', 8);
  s.text(73, 5, '█▓▒░', 3);
  return s;
}

// MAIN: rows 1-12; the menu box is drawn from row 13 down
function mainScreen() {
  const s = new Screen();
  frame(s, 1, 1, 80, 12, 11);
  borderLabel(s, 1, 'T H E   M I D N I G H T   G A T E', 15, 11);

  const logo = 'MIDNIGHT GATE';
  const lw = bigWidth(logo);
  bigText(s, Math.floor((80 - lw) / 2) + 1, 2, logo, { color: LOGO_RAMP });

  // night sky, crescent moon, then the city in front of it
  const rnd = mulberry32(20261112);
  stars(s, 3, 7, 60, 2, rnd, 8);
  moon(s, 67, 7);

  skyline(s, rnd, 11, [
    { x: 3, w: 6, h: 2 },
    { x: 10, w: 5, h: 3 },
    { x: 16, w: 8, h: 2 },
    { x: 25, w: 5, h: 3, antenna: true },
    { x: 31, w: 9, h: 2 },
    { x: 41, w: 6, h: 3 },
    { x: 48, w: 4, h: 4, spire: true },
    { x: 53, w: 7, h: 2 },
    { x: 61, w: 6, h: 2 },
    { x: 75, w: 3, h: 1 },
  ]);

  borderLabel(s, 12, 'S I N C E   1 9 9 0', 7, 11);
  return s;
}

// GOODBYE: full 80x25. Rows 12/14/15/17/20 are left clear in the middle
// because bbs.js centres the caller's logoff stats into them.
function goodbye() {
  const s = new Screen();
  frame(s, 1, 1, 80, 25, 11);
  borderLabel(s, 1, 'T H E   G A T E', 15, 11);

  const l1 = 'THANKS FOR';
  bigText(s, Math.floor((80 - bigWidth(l1)) / 2) + 1, 2, l1, { color: WARM_RAMP });
  const l2 = 'CALLING';
  bigText(s, Math.floor((80 - bigWidth(l2)) / 2) + 1, 7, l2, { color: LOGO_RAMP });

  // side rails frame the console block that bbs.js prints into
  s.vline(3, 12, 9, '░', 8);
  s.vline(78, 12, 9, '░', 8);
  s.hline(6, 13, 68, '░', 8);
  s.hline(6, 16, 68, '░', 8);
  s.set(3, 12, '■', 8);
  s.set(78, 12, '■', 8);

  // NO CARRIER plate; bbs.js prints the words at row 20 centre
  frame(s, 28, 19, 25, 3, 11);

  // modem with its cord pulled out of the wall jack
  const mx = 7;
  s.text(mx, 22, '╔══════════════════╗', 11);
  s.text(mx, 23, '║', 11);
  s.text(mx + 1, 23, ' ░▒▓  M O D E M  ', 15);
  s.set(mx + 19, 23, '║', 11);
  s.text(mx, 24, '╚══════════════════╝', 11);
  s.hline(mx + 20, 23, 14, '═', 8);
  s.text(mx + 34, 22, '▄▄', 7);
  s.text(mx + 34, 23, '▐██▌', 7);
  s.text(mx + 34, 24, '▀▀', 7);

  // spark gap, then the wall jack the plug came out of
  s.text(48, 22, '·', 14);
  s.text(50, 22, '*', 14);
  s.text(52, 23, '*', 14);
  s.text(49, 24, '·', 14);
  s.text(57, 22, '╔══════╗', 11);
  s.text(57, 23, '║ ▐██▌ ║', 15);
  s.text(57, 24, '╚══════╝', 11);
  s.text(67, 23, '░▒▓', 8);
  s.text(71, 22, '░', 8);
  s.text(74, 24, '░', 8);

  borderLabel(s, 25, 'N O   C A R R I E R', 8, 11);
  return s;
}

/* ---------------------------------------------------------------- banners */

function envelope(s, x, y) {
  s.text(x, y, '▄▄▄▄▄▄▄▄▄▄▄▄▄', 11);
  s.text(x, y + 1, '█\\░░░░░░░░░/█', 7);
  s.text(x, y + 2, '▀▀▀▀▀▀▀▀▀▀▀▀▀', 11);
}

// inset badge: solid cap, centred label, solid foot
function badge(s, x, y, w, label, fg = 9, bg = -1) {
  s.hline(x, y, w, '▄', fg, bg);
  s.set(x, y + 1, '█', fg, bg);
  const inner = w - 2;
  const pad = Math.max(0, Math.floor((inner - label.length) / 2));
  s.text(x + 1, y + 1, ' '.repeat(inner), fg, bg);
  s.text(x + 1 + pad, y + 1, label, 15, bg);
  s.set(x + w - 1, y + 1, '█', fg, bg);
  s.hline(x, y + 2, w, '▀', fg, bg);
}

function floppy(s, x, y) {
  s.text(x, y, '▄▄▄▄▄▄▄▄▄▄', 11);
  s.text(x, y + 1, '█ ▄▄▄▄ ░░ █', 15);
  s.text(x, y + 2, '█▄▄▄▄▄▄▄▄▄█', 11);
}

function doorIcon(s, x, y) {
  s.text(x, y, '▄▄▄▄▄▄▄▄', 11);
  s.text(x, y + 1, '█░░░░░■█', 14);
  s.text(x, y + 2, '█░░░░░░█', 11);
}

function bubbles(s, x, y) {
  s.text(x, y, '▄▄▄▄▄▄      ▄▄▄▄', 11);
  s.text(x, y + 1, '█░▒▓░█▄▄▄▄██░▒▓█', 15);
  s.text(x, y + 2, '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀', 11);
}

function bars(s, x, y) {
  s.text(x, y, '        ▄', 13);
  s.text(x, y + 1, '  ▄   ▄ █', 13);
  s.text(x, y + 2, '▄ █ ▄ █ █', 13);
}

function pin(s, x, y) {
  s.text(x, y, '▄▄▄▄▄▄▄▄▄▄▄▄', 13);
  s.text(x, y + 1, '█ ░▒▓▓▒░ ░ █', 15);
  s.text(x, y + 2, '▀▀▀▀▀▀▀▀▀▀▀▀', 13);
}

function pages(s, x, y) {
  s.text(x, y, '▄▄▄▄▄▄▄▄▄▄▄▄▄▄', 11);
  s.text(x, y + 1, '█ ░░░░░░░░░░ █▌', 15);
  s.text(x, y + 2, '▀▀▀▀▀▀▀▀▀▀▀▀▀▀', 11);
}

// 4-row house style: gradient cap, 3-row block name, section motif at right
function banner(name, icon, iconX = 62) {
  const s = new Screen(80, 4);
  const cap = ramp([11, 15, 13, 5]);
  for (let x = 1; x <= 80; x++) s.set(x, 1, '▄', cap((x - 1) / 79));

  const w = midText(s, 3, 2, name, { color: LOGO_RAMP });
  s.set(3 + w + 1, 4, '·', 8);
  s.hline(3 + w + 3, 4, Math.max(0, iconX - 4 - (3 + w)), '─', 8);
  icon(s, iconX, 2);
  return s;
}

/* --------------------------------------------------------------- validate */

function stripSgr(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function validate(files) {
  const rows = [];
  let bad = 0;
  for (const { name, text } of files) {
    const lines = text.split('\r\n');
    if (lines[lines.length - 1] === '') lines.pop();
    let maxW = 0;
    let over = 0;
    let badChars = new Set();
    let tabs = 0;
    for (const line of lines) {
      const plain = stripSgr(line);
      maxW = Math.max(maxW, plain.length);
      if (plain.length > 80) over++;
      if (plain.includes('\t')) tabs++;
      for (const c of plain) {
        if (!cp437.FROM_UNICODE.has(c)) badChars.add(c);
      }
    }
    const ok = over === 0 && lines.length <= 25 && badChars.size === 0 && tabs === 0;
    if (!ok) bad++;
    rows.push({
      file: name,
      lines: lines.length,
      maxW,
      over,
      tabs,
      bad: [...badChars].map((c) => JSON.stringify(c)).join(',') || '-',
      bytes: Buffer.byteLength(text, 'utf8'),
      ok,
    });
  }
  return { rows, bad };
}

/* -------------------------------------------------------------------- main */

function main() {
  fs.mkdirSync(ART_DIR, { recursive: true });

  const screens = [
    ['WELCOME.ANS', welcome()],
    ['LOGIN.ANS', login()],
    ['NEWUSER.ANS', newuser()],
    ['MAIN.ANS', mainScreen()],
    ['GOODBYE.ANS', goodbye()],
    ['MSG.ANS', banner('MESSAGES', pages)],
    ['FILES.ANS', banner('FILES', floppy)],
    ['DOORS.ANS', banner('DOORS', doorIcon)],
    ['CHAT.ANS', banner('CHAT', bubbles, 62)],
    ['BULL.ANS', banner('BULLETINS', pin, 63)],
    ['STATS.ANS', banner('STATS', bars, 66)],
    ['MAIL.ANS', banner('MAIL', envelope, 64)],
  ];

  const written = [];
  for (const [name, screen] of screens) {
    const text = screen.toString();
    fs.writeFileSync(path.join(ART_DIR, name), text, 'utf8');
    written.push({ name, text });
  }

  const { rows, bad } = validate(written);
  const pad = (v, n) => String(v).padEnd(n);
  console.log('file          lines  maxw  >80  tabs  bytes  cp437  status');
  console.log('------------  -----  ----  ---  ----  -----  -----  ------');
  for (const r of rows) {
    console.log(
      `${pad(r.file, 12)}  ${pad(r.lines, 5)}  ${pad(r.maxW, 4)}  ${pad(r.over, 3)}  ${pad(r.tabs, 4)}  ${pad(r.bytes, 5)}  ${pad(r.bad, 5)}  ${r.ok ? 'ok' : 'FAIL'}`,
    );
  }
  console.log(`\n${rows.length} screens written to ${ART_DIR}`);
  if (bad) {
    console.error(`${bad} file(s) failed validation`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { Screen, bigText, midText, banner, BIG, MID, welcome, login, newuser, mainScreen, goodbye, validate };

