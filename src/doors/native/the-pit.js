'use strict';
/*
 * THE PIT — a native door for The Gate BBS.
 * Gladiator arena combat. Original content. 80x25 ANSI, keyboard only, no deps.
 *
 * State lives at ctx.db.data.doors['the-pit'].users[handle].
 * Every meaningful change calls ctx.save().
 */

const DOOR_ID = 'the-pit';
const FIGHTS_PER_DAY = 8;
const TURN_LIMIT = 30;
const DAY_MS = 86400000;

const WEAPONS = [
  { name: 'Wooden Practice Sword', power: 3, cost: 0 },
  { name: 'Pit Gladius', power: 6, cost: 45 },
  { name: 'Notched Falx', power: 9, cost: 120 },
  { name: 'Iron Trident', power: 13, cost: 280 },
  { name: 'Twin Blades', power: 17, cost: 560 },
  { name: "Champion's Spatha", power: 22, cost: 980 },
];

const ARMOR = [
  { name: 'Loincloth', def: 0, cost: 0 },
  { name: 'Leather Straps', def: 2, cost: 40 },
  { name: 'Bronze Cuirass', def: 4, cost: 130 },
  { name: 'Chain Harness', def: 6, cost: 300 },
  { name: 'Segmented Plate', def: 9, cost: 600 },
  { name: "Champion's Mail", def: 12, cost: 1050 },
];

const RANKS = [
  'Sand Scrap', 'Novice', 'Blooded', 'Bladehand', 'Pit Fighter',
  'Veteran', 'Executioner', 'Warlord', 'Champion', 'Legend',
];

const FOES = [
  { name: 'Slave of the Sands', letter: 'S', hp: 16, dmg: 2, purse: 15, minRank: 1, tier: 1 },
  { name: 'Pit Dog Handler', letter: 'D', hp: 20, dmg: 3, purse: 24, minRank: 1, tier: 1 },
  { name: 'Bronze Myrmillo', letter: 'M', hp: 26, dmg: 4, purse: 38, minRank: 2, tier: 2 },
  { name: 'Veteran Retiarius', letter: 'R', hp: 32, dmg: 5, purse: 55, minRank: 3, tier: 2 },
  { name: 'The Black Shield', letter: 'K', hp: 40, dmg: 7, purse: 78, minRank: 4, tier: 3 },
  { name: 'Butcher of Ostia', letter: 'B', hp: 52, dmg: 9, purse: 110, minRank: 6, tier: 4 },
  { name: 'Champion of the Pit', letter: 'C', hp: 66, dmg: 11, purse: 165, minRank: 8, tier: 5 },
];

const ART = [
  '      ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄',
  '    ▄█████████████████████▄',
  '   ████░░░░░░░░░░░░░░░░░████',
  '   ████░░░░░░░░@░░░░░░░░████',
  '   ████░░░░░░░░░░░░░░░░░████',
  '    ▀█████████████████████▀',
  '      ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀',
];

// ---------------------------------------------------------------- utilities

const rnd = (n) => Math.floor(Math.random() * n) + 1;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clampInt(v, lo, hi, fallback) {
  const raw = Number(v);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(lo, Math.min(hi, Math.floor(raw)));
}

function fmt(n) {
  return String(Math.max(0, Math.round(num(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pad(s, n) {
  const t = String(s == null ? '' : s);
  return t.length >= n ? t.slice(0, n) : t + ' '.repeat(n - t.length);
}

function padL(s, n) {
  const t = String(s == null ? '' : s);
  return t.length >= n ? t.slice(0, n) : ' '.repeat(n - t.length) + t;
}

function bar(cur, max, width) {
  const w = Math.max(1, width);
  const pct = Math.max(0, Math.min(1, cur / Math.max(1, max)));
  const filled = Math.round(pct * w);
  return '█'.repeat(filled) + '░'.repeat(w - filled);
}

function clip(s, n) {
  const t = String(s == null ? '' : s);
  return t.length > n ? t.slice(0, n) : t;
}

// All output funnels through here so nothing can land past column 80 or row 25.
function put(term, row, col, text, fg, bg) {
  if (!(row >= 1 && row <= 25 && col >= 1 && col <= 80)) return;
  const room = 81 - col;
  const t = clip(String(text == null ? '' : text).replace(/[\r\n]/g, ' '), room);
  if (!t.length) return;
  term.print(row, col, t, fg, bg);
}

function ctr(term, row, text, fg, bg) {
  const t = clip(String(text == null ? '' : text), 80);
  put(term, row, Math.max(1, Math.floor((80 - t.length) / 2) + 1), t, fg, bg);
}

function wipe(term, row) {
  put(term, row, 1, ' '.repeat(80));
}

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(from, to) {
  const a = Date.parse(from + 'T00:00:00');
  const b = Date.parse(to + 'T00:00:00');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

function rankNeed(rank) {
  return 10 + rank * 6;
}

function maxHpFor(p) {
  return 30 + p.rank * 2 + ARMOR[p.armor].def * 4;
}

// ------------------------------------------------------------------- state

function doorRoot(ctx) {
  const data = ctx.db.data;
  if (!data.doors || typeof data.doors !== 'object') data.doors = {};
  if (!data.doors[DOOR_ID] || typeof data.doors[DOOR_ID] !== 'object') data.doors[DOOR_ID] = { users: {} };
  if (!data.doors[DOOR_ID].users || typeof data.doors[DOOR_ID].users !== 'object') data.doors[DOOR_ID].users = {};
  return data.doors[DOOR_ID];
}

function freshRecord() {
  return {
    wins: 0,
    losses: 0,
    rank: 1,
    rankExp: 0,
    purse: 120,
    weapon: 0,
    armor: 0,
    hp: 32,
    maxhp: 32,
    stamina: FIGHTS_PER_DAY,
    day: todayKey(),
    stake: 0,
    streak: 0,
    best: 0,
    seenIntro: false,
  };
}

function normalize(p) {
  p.wins = Math.max(0, Math.floor(num(p.wins)));
  p.losses = Math.max(0, Math.floor(num(p.losses)));
  p.rank = clampInt(p.rank, 1, RANKS.length, 1);
  p.rankExp = Math.max(0, Math.floor(num(p.rankExp)));
  p.purse = Math.max(0, Math.floor(num(p.purse)));
  p.weapon = clampInt(p.weapon, 0, WEAPONS.length - 1, 0);
  p.armor = clampInt(p.armor, 0, ARMOR.length - 1, 0);
  p.stamina = clampInt(p.stamina, 0, FIGHTS_PER_DAY, FIGHTS_PER_DAY);
  p.streak = Math.floor(num(p.streak));
  p.best = Math.max(0, Math.floor(num(p.best)));
  p.maxhp = maxHpFor(p);
  p.hp = clampInt(p.hp, 0, p.maxhp, p.maxhp);
  p.stake = clampInt(p.stake, 0, p.purse, 0);
  p.seenIntro = !!p.seenIntro;
  if (typeof p.day !== 'string' || !p.day) p.day = todayKey();
}

// Daily reset of the fight card.
function rollDay(p) {
  const today = todayKey();
  if (p.day === today) return false;
  const days = Math.max(1, daysBetween(p.day, today));
  p.stamina = FIGHTS_PER_DAY;
  p.day = today;
  // A long absence lets the purse earn a little gate money.
  if (days >= 2) p.purse += 10 * Math.min(days, 7);
  p.maxhp = maxHpFor(p);
  p.hp = p.maxhp;
  return true;
}

function rankUp(p, amount) {
  const ups = [];
  p.rankExp += Math.max(0, Math.floor(amount));
  while (p.rank < RANKS.length && p.rankExp >= rankNeed(p.rank)) {
    p.rankExp -= rankNeed(p.rank);
    p.rank += 1;
    p.maxhp = maxHpFor(p);
    p.hp = Math.min(p.maxhp, p.hp + 6);
    ups.push(`RANK UP — you are now ${RANKS[p.rank - 1]} (rank ${p.rank}).`);
  }
  return ups;
}

// ----------------------------------------------------------------- drawing

function hud(term, handle, p) {
  put(term, 1, 1, ' '.repeat(80), 15, 1);
  put(term, 1, 2, 'THE PIT', 15, 1);
  put(term, 1, 69, 'THE GATE BBS', 11, 1);
  put(term, 2, 1, ' '.repeat(80), 7, 0);
  const low = p.hp <= Math.max(1, Math.floor(p.maxhp * 0.34));
  const segs = [
    [' ' + clip(handle, 14) + ' ', 15],
    ['RANK ' + p.rank + ' ' + RANKS[p.rank - 1] + ' ', 11],
    ['HP ' + p.hp + '/' + p.maxhp + ' ', low ? 12 : 10],
    ['PURSE ' + fmt(p.purse) + ' ', 14],
    ['CARD ' + p.stamina + '/' + FIGHTS_PER_DAY + ' ', p.stamina > 0 ? 11 : 8],
    ['W-L ' + p.wins + '-' + p.losses + ' ', 8],
  ];
  let col = 2;
  for (const [txt, fg] of segs) {
    if (col + txt.length - 1 > 80) break;
    put(term, 2, col, txt, fg);
    col += txt.length + 1;
  }
  put(term, 3, 1, '─'.repeat(80), 8);
}

function frame(term, handle, p, title, subtitle) {
  term.cls();
  hud(term, handle, p);
  if (title) ctr(term, 5, title, 14);
  if (subtitle) ctr(term, 6, subtitle, 8);
}

function say(term, row, text, color, width) {
  const w = width || 70;
  let r = row;
  for (const line of term.wrap(String(text), w)) {
    if (r > 23) break;
    put(term, r, 5, line, color == null ? 7 : color);
    r += 1;
  }
  return r;
}

// A prompt that never scrolls the screen off its bottom row.
async function press(term, msg, row = 23) {
  wipe(term, row);
  put(term, row, 3, msg || 'Press any key', 11);
  const k = await term.readKey({ timeoutMs: 0 });
  wipe(term, row);
  return k;
}

function note(term, msg, color) {
  return press(term, msg, 23);
}

// -------------------------------------------------------------------- hub

async function hub(term, ctx, handle, p, save, noticeIn) {
  let notice = noticeIn || '';
  for (;;) {
    term.cls();
    hud(term, handle, p);
    term.box(2, 5, 42, 15, { fg: 8 });
    put(term, 5, 4, '┤ THE LUDUS ├', 11);
    let r = 7;
    for (const line of ART) put(term, r++, 4, line, 9);
    put(term, 14, 4, 'Sand, iron, and the smell of the crowd.', 7);
    put(term, 15, 4, `Purse ${fmt(p.purse)}   ·   Rank ${p.rank} ${RANKS[p.rank - 1]}`, 14);
    put(term, 16, 4, `Progress ${p.rankExp}/${rankNeed(p.rank)} to the next rank`, 10);
    put(term, 17, 4, `Record ${p.wins}W-${p.losses}L   ·   Best streak ${p.best}`, 7);
    put(term, 18, 4, `Fights left today: ${p.stamina} of ${FIGHTS_PER_DAY}`, p.stamina ? 10 : 12);

    term.box(46, 5, 32, 15, { fg: 8 });
    put(term, 5, 48, '┤ THE GATE ├', 11);
    const menu = [
      ['  (F)ight ..... enter the sand', p.stamina > 0 ? 15 : 8],
      ['  (S)hop ...... steel & mail', 15],
      ['  (H)eal ...... the infirmary', 15],
      ['  (L)adder .... top ten', 15],
      ['  (W)ager ..... side bet', 15],
      ['  (Q)uit ...... leave the pit', 15],
    ];
    menu.forEach(([txt, fg], i) => put(term, 8 + i, 47, txt, fg));
    put(term, 15, 47, 'Next bout stake: ' + fmt(p.stake), p.stake ? 13 : 8);
    put(term, 17, 47, 'Bump to attack. The sands', 8);
    put(term, 18, 47, 'do not forgive hesitation.', 8);

    put(term, 21, 3, notice || 'The editor wants blood. Give him a show.', 10);
    put(term, 24, 3, 'Arrows / WASD / HJKL move  ·  bump to attack  ·  ESC backs out', 8);
    wipe(term, 23);
    term.gotoxy(23, 3);

    const k = await term.menu({ prompt: '', valid: 'FSHLWQ', allowEmpty: true });
    notice = '';
    if (k == null || k === 'Q' || k === 'ESC' || k === '') return 'quit';
    if (k === 'F') notice = await card(term, ctx, handle, p, save);
    else if (k === 'S') await shop(term, handle, p, save);
    else if (k === 'H') await infirmary(term, handle, p, save);
    else if (k === 'L') await ladder(term, ctx, handle, p);
    else if (k === 'W') await wager(term, handle, p, save);
  }
}

// ------------------------------------------------------------------- shop

async function shop(term, handle, p, save) {
  let tab = 'weapon';
  for (;;) {
    const list = tab === 'weapon' ? WEAPONS : ARMOR;
    const cur = tab === 'weapon' ? p.weapon : p.armor;
    frame(term, handle, p, tab === 'weapon' ? 'THE ARMOURER' : 'THE TANNERY',
      tab === 'weapon' ? 'Steel for the hand. No refunds.' : 'Hide and bronze for the ribs.');
    put(term, 8, 5, '#', 8);
    put(term, 8, 9, tab === 'weapon' ? 'WEAPON' : 'ARMOUR', 8);
    put(term, 8, 40, tab === 'weapon' ? 'POW' : 'DEF', 8);
    put(term, 8, 47, 'COST', 8);

    list.forEach((it, i) => {
      const equipped = i === cur;
      const fg = equipped ? 15 : i < cur ? 8 : 7;
      const row = 9 + i;
      put(term, row, 5, String(i), 11);
      put(term, row, 7, equipped ? '>' : ' ', 10);
      put(term, row, 9, pad(it.name, 28), fg);
      put(term, row, 40, padL(tab === 'weapon' ? it.power : it.def, 3), 14);
      put(term, row, 47, i === 0 ? '   ---' : padL(fmt(it.cost), 6), 14);
    });

    put(term, 17, 5, 'Equipped: ' + (tab === 'weapon' ? WEAPONS[p.weapon].name : ARMOR[p.armor].name), 11);
    put(term, 19, 5, 'Purse: ' + fmt(p.purse) + ' gold', 14);
    put(term, 21, 5, '[#] Buy   [' + (tab === 'weapon' ? 'A' : 'W') + '] ' + (tab === 'weapon' ? 'Armour' : 'Weapons') + '   [ESC] Leave', 10);
    put(term, 24, 3, 'A better blade kills faster. Better mail keeps you breathing.', 8);
    wipe(term, 23);
    term.gotoxy(23, 3);

    const k = await term.menu({ prompt: '', valid: '012345AW', allowEmpty: true });
    if (k == null || k === 'ESC' || k === '') return;
    if (k === 'A') { tab = 'armor'; continue; }
    if (k === 'W') { tab = 'weapon'; continue; }
    const idx = Number(k);
    const it = list[idx];
    if (!it) continue;
    if (idx <= cur) { await note(term, 'You already carry as good or better.'); continue; }
    if (it.cost > p.purse) { await note(term, 'Not enough in the purse. Win a bout.'); continue; }
    p.purse -= it.cost;
    if (tab === 'weapon') p.weapon = idx;
    else {
      p.armor = idx;
      const oldMax = p.maxhp;
      p.maxhp = maxHpFor(p);
      p.hp = Math.min(p.maxhp, p.hp + (p.maxhp - oldMax));
    }
    save();
    await note(term, 'You buy the ' + it.name + ' for ' + it.cost + ' gold.', 10);
  }
}

// -------------------------------------------------------------- infirmary

async function infirmary(term, handle, p, save) {
  const missing = Math.max(0, p.maxhp - p.hp);
  const cost = missing > 0 ? Math.max(8, missing * 3) : 0;
  frame(term, handle, p, 'THE INFIRMARY', 'The surgeon drinks while he stitches.');
  put(term, 9, 6, 'Wounds', 8);
  put(term, 9, 26, `${p.hp} / ${p.maxhp}`, missing ? 12 : 10);
  put(term, 11, 6, 'Cost to close them', 8);
  put(term, 11, 26, cost ? fmt(cost) + ' gold' : 'nothing', 14);
  put(term, 13, 6, 'Purse', 8);
  put(term, 13, 26, fmt(p.purse) + ' gold', 14);

  if (missing <= 0) {
    put(term, 16, 6, 'You are whole. Go and get broken again.', 10);
    await note(term, 'Press any key');
    return;
  }
  if (p.purse < cost) {
    put(term, 16, 6, 'You cannot pay. He waves you off with a bloody hand.', 12);
    await note(term, 'Press any key');
    return;
  }
  put(term, 16, 6, 'Pay for the needle?  [Y]es / [N]o', 15);
  term.gotoxy(17, 6);
  const k = await term.readKey({ timeoutMs: 0 });
  if (!k || String(k).toUpperCase() !== 'Y') return;
  p.purse -= cost;
  p.hp = p.maxhp;
  save();
  frame(term, handle, p, 'STITCHED', null);
  put(term, 9, 6, 'It hurts worse going in than coming out. You are whole.', 10);
  await note(term, 'Press any key');
}

// ----------------------------------------------------------------- ladder

async function ladder(term, ctx, handle, p) {
  const users = doorRoot(ctx).users;
  const rows = Object.keys(users)
    .map((k) => {
      const u = users[k] || {};
      return {
        handle: k,
        wins: Math.max(0, Math.floor(num(u.wins))),
        losses: Math.max(0, Math.floor(num(u.losses))),
        rank: clampInt(u.rank, 1, RANKS.length, 1),
      };
    })
    .sort((a, b) => b.wins * 3 + b.rank * 5 - a.wins * 3 - a.rank * 5)
    .slice(0, 10);

  frame(term, handle, p, 'THE LADDER', 'Ten names the crowd still shouts.');
  put(term, 8, 6, '#', 8);
  put(term, 8, 9, 'GLADIATOR', 8);
  put(term, 8, 30, 'RANK', 8);
  put(term, 8, 50, 'W', 8);
  put(term, 8, 55, 'L', 8);
  rows.forEach((u, i) => {
    const row = 9 + i;
    const me = u.handle === String(handle).toLowerCase();
    put(term, row, 6, String(i + 1), 11);
    put(term, row, 9, pad(u.handle, 19), me ? 14 : 15);
    put(term, row, 30, pad(`${u.rank} ${RANKS[u.rank - 1]}`, 18), 11);
    put(term, row, 50, padL(u.wins, 3), 10);
    put(term, row, 55, padL(u.losses, 3), 12);
  });
  if (!rows.length) put(term, 9, 6, 'No names yet. Be the first.', 8);
  put(term, 21, 6, `You are ranked ${p.rank} ${RANKS[p.rank - 1]} with ${p.wins} wins.`, 10);
  await note(term, 'Press any key');
}

// ------------------------------------------------------------------ wager

async function wager(term, handle, p, save) {
  frame(term, handle, p, 'THE BOOKMAKER', 'A thin man with a slate and no loyalties.');
  put(term, 9, 6, 'Purse', 8);
  put(term, 9, 24, fmt(p.purse) + ' gold', 14);
  put(term, 11, 6, 'Stake on the next bout', 8);
  put(term, 11, 32, fmt(p.stake) + ' gold', p.stake ? 13 : 8);
  put(term, 13, 6, 'A winning bout pays the stake back double.', 7);
  put(term, 15, 6, '(1) 10%   (2) 25%   (3) 50%   (4) All in   (0) Clear', 15);
  put(term, 17, 6, 'ESC leaves the stake as it stands.', 8);
  wipe(term, 23);
  term.gotoxy(19, 6);

  const k = await term.menu({ prompt: '', valid: '01234', allowEmpty: true });
  if (k == null || k === '' || k === 'ESC') return;
  const pct = { 0: 0, 1: 0.1, 2: 0.25, 3: 0.5, 4: 1 }[k];
  p.stake = pct === 0 ? 0 : Math.max(1, Math.floor(p.purse * pct));
  p.stake = Math.min(p.stake, p.purse);
  save();
  await note(term, p.stake ? `${fmt(p.stake)} gold on the slate.` : 'The slate is wiped clean.', 10);
}

// ------------------------------------------------------------------- arena

function buildArena() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const grid = [];
    for (let y = 0; y < 5; y++) grid.push(['.', '.', '.', '.', '.']);
    const spots = [];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        if ((x === 0 && y === 4) || (x === 4 && y === 0)) continue;
        spots.push([x, y]);
      }
    }
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = spots[i];
      spots[i] = spots[j];
      spots[j] = t;
    }
    const walls = 3 + rnd(2);
    for (let i = 0; i < walls && i < spots.length; i++) {
      const [x, y] = spots[i];
      grid[y][x] = '#';
    }
    for (let i = walls; i < walls + 2 && i < spots.length; i++) {
      const [x, y] = spots[i];
      grid[y][x] = '^';
    }
    if (reachable(grid)) return grid;
  }
  return [
    ['.', '.', '.', '.', '.'],
    ['.', '.', '.', '.', '.'],
    ['.', '.', '.', '.', '.'],
    ['.', '.', '.', '.', '.'],
    ['.', '.', '.', '.', '.'],
  ];
}

function reachable(grid) {
  const seen = new Set(['0,4']);
  const q = [[0, 4]];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === 4 && y === 0) return true;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx > 4 || ny > 4) continue;
      if (grid[ny][nx] === '#') continue;
      const key = nx + ',' + ny;
      if (seen.has(key)) continue;
      seen.add(key);
      q.push([nx, ny]);
    }
  }
  return false;
}

function makeFoe(p) {
  const pool = FOES.filter((f) => f.minRank <= p.rank);
  const eligible = pool.slice(-3).length ? pool.slice(-3) : [FOES[0]];
  const f = pick(eligible);
  const hp = f.hp + Math.max(0, p.rank - f.minRank) * 2 + rnd(4);
  return {
    name: f.name,
    letter: f.letter,
    hp,
    maxhp: hp,
    dmg: f.dmg + Math.floor(Math.max(0, p.rank - f.minRank) / 2),
    purse: f.purse + Math.max(0, p.rank - f.minRank) * 6,
    tier: f.tier,
  };
}

function dirOf(k) {
  if (typeof k !== 'string') return null;
  const u = k.toUpperCase();
  if (u === 'UP' || u === 'W' || u === 'K') return [0, -1];
  if (u === 'DOWN' || u === 'S' || u === 'J') return [0, 1];
  if (u === 'LEFT' || u === 'A' || u === 'H') return [-1, 0];
  if (u === 'RIGHT' || u === 'D' || u === 'L') return [1, 0];
  if (u === '.') return [0, 0];
  return null;
}

function drawArena(term, st) {
  term.box(3, 6, 27, 7, { fg: 8 });
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const c = st.grid[y][x];
      const row = 7 + y;
      const col = 4 + x * 5;
      if (c === '#') put(term, row, col, '▓', 8);
      else if (c === '^') put(term, row, col, '▲', 12);
      else put(term, row, col, '·', 8);
    }
  }
  put(term, 7 + st.fy, 4 + st.fx * 5, st.foe.letter, 12);
  put(term, 7 + st.py, 4 + st.px * 5, '@', 14);
}

function drawFight(term, handle, p, st) {
  term.cls();
  hud(term, handle, p);
  term.center(5, 'T H E   S A N D S', 14);

  drawArena(term, st);

  term.box(30, 6, 48, 12, { fg: 8 });
  put(term, 6, 32, '┤ ' + clip(st.foe.name.toUpperCase(), 36) + ' ├', 14);
  const fr = st.foe.hp / st.foe.maxhp;
  put(term, 8, 32, 'FOE  ', 12);
  put(term, 8, 37, '[' + bar(Math.max(0, st.foe.hp), st.foe.maxhp, 24) + ']', fr < 0.34 ? 10 : 12);
  put(term, 8, 64, padL(Math.max(0, st.foe.hp) + '/' + st.foe.maxhp, 12), fr < 0.34 ? 10 : 12);
  const pr = p.hp / p.maxhp;
  put(term, 9, 32, 'YOU  ', 10);
  put(term, 9, 37, '[' + bar(Math.max(0, p.hp), p.maxhp, 24) + ']', pr < 0.34 ? 12 : 10);
  put(term, 9, 64, padL(Math.max(0, p.hp) + '/' + p.maxhp, 12), pr < 0.34 ? 12 : 10);
  put(term, 11, 32, 'BOUT   ' + Math.min(st.turns, TURN_LIMIT) + ' / ' + TURN_LIMIT, st.turns > TURN_LIMIT - 6 ? 12 : 11);
  put(term, 12, 32, 'STAKE  ' + (st.stake ? fmt(st.stake) + ' gold' : 'none'), st.stake ? 13 : 8);
  put(term, 13, 32, 'BLADE  ' + clip(WEAPONS[p.weapon].name, 20), 7);
  put(term, 14, 32, 'MAIL   ' + clip(ARMOR[p.armor].name, 20), 7);
  put(term, 16, 32, '▓ wall   ▲ spikes   · sand', 8);

  for (let i = 0; i < 4; i++) {
    wipe(term, 19 + i);
    const line = st.log[st.log.length - 4 + i];
    if (line) put(term, 19 + i, 4, line, i === 3 ? 15 : 7);
  }
  wipe(term, 23);
  wipe(term, 24);
  put(term, 24, 3, 'Move: arrows/WASD/HJKL   Bump the foe to strike   ESC yields', 8);
}

async function fightLoop(term, handle, p, st, save) {
  for (;;) {
    drawFight(term, handle, p, st);
    const k = await term.readKey({ timeoutMs: 0 });
    if (k === 'ESC') return 'yield';
    const d = dirOf(k);
    if (!d) {
      term.beep();
      continue;
    }
    st.turns += 1;

    const nx = st.px + d[0];
    const ny = st.py + d[1];
    if (nx === st.fx && ny === st.fy) {
      const dmg = Math.max(1, WEAPONS[p.weapon].power + rnd(4) - 2);
      st.foe.hp -= dmg;
      st.log.push(`You open ${st.foe.name} for ${dmg}.`);
      if (st.foe.hp <= 0) {
        save();
        return 'win';
      }
    } else if (nx >= 0 && ny >= 0 && nx <= 4 && ny <= 4 && st.grid[ny][nx] !== '#') {
      st.px = nx;
      st.py = ny;
      if (st.grid[ny][nx] === '^') {
        const hz = 2 + rnd(2);
        p.hp -= hz;
        st.log.push(`Spikes tear your leg for ${hz}.`);
      }
    } else {
      st.log.push('You shoulder the wall. The crowd jeers.');
    }

    if (p.hp <= 0) {
      save();
      return 'loss';
    }

    // The foe always closes on the player and strikes when adjacent.
    const dx = st.px - st.fx;
    const dy = st.py - st.fy;
    if (Math.abs(dx) + Math.abs(dy) === 1) {
      const md = Math.max(1, st.foe.dmg + rnd(2) - 1 - Math.round(ARMOR[p.armor].def * 0.7));
      p.hp -= md;
      st.log.push(`${st.foe.name} cuts you for ${md}.`);
      if (p.hp <= 0) {
        save();
        return 'loss';
      }
    } else {
      const stepX = Math.sign(dx);
      const stepY = Math.sign(dy);
      const tries = Math.abs(dx) >= Math.abs(dy) ? [[stepX, 0], [0, stepY]] : [[0, stepY], [stepX, 0]];
      for (const [mx, my] of tries) {
        if (!mx && !my) continue;
        const tx = st.fx + mx;
        const ty = st.fy + my;
        if (tx < 0 || ty < 0 || tx > 4 || ty > 4) continue;
        if (st.grid[ty][tx] === '#') continue;
        if (tx === st.px && ty === st.py) continue;
        st.fx = tx;
        st.fy = ty;
        break;
      }
    }

    if (st.turns >= TURN_LIMIT) {
      save();
      return 'time';
    }
    save();
  }
}

async function card(term, ctx, handle, p, save) {
  if (p.stamina <= 0) {
    frame(term, handle, p, 'THE CARD IS FULL', 'Eight bouts a day. The gate is shut until dawn.');
    say(term, 9, 'Your body has nothing left to give today. Come back tomorrow and the sand will be waiting.', 12);
    await note(term, 'Press any key');
    return 'Out of fights until tomorrow.';
  }

  const foe = makeFoe(p);
  const stake = Math.min(p.stake, p.purse);
  p.purse -= stake;
  p.stake = 0;
  p.stamina -= 1;
  save();

  const st = {
    grid: buildArena(),
    px: 0,
    py: 4,
    fx: 4,
    fy: 0,
    foe,
    turns: 0,
    stake,
    log: [`The gate rises. ${foe.name} steps onto the sand.`],
  };

  const res = await fightLoop(term, handle, p, st, save);
  return finish(term, handle, p, st, res, save);
}

async function finish(term, handle, p, st, res, save) {
  const foe = st.foe;
  const stake = st.stake;
  let lines = [];

  if (res === 'win') {
    p.wins += 1;
    p.streak += 1;
    p.best = Math.max(p.best, p.streak);
    p.purse += foe.purse + stake * 2;
    const ups = rankUp(p, 3 + foe.tier);
    lines = [
      `The ${foe.name} falls and the sand drinks it.`,
      `Purse +${fmt(foe.purse)} gold` + (stake ? `   ·   stake +${fmt(stake * 2)}` : ''),
      `Rank progress +${3 + foe.tier}`,
      ...ups,
    ];
    save();
    term.cls();
    hud(term, handle, p);
    term.center(6, 'V I C T O R Y', 10);
    term.center(8, `The ${foe.name} does not get up.`, 15);
    lines.slice(1).forEach((l, i) => put(term, 11 + i, 8, l, i === 0 ? 14 : 11));
    put(term, 18, 8, `Record ${p.wins}W-${p.losses}L  ·  streak ${p.streak}`, 7);
    await note(term, 'Press any key');
    return '';
  }

  const penalty = res === 'yield' ? Math.floor(foe.purse / 4) : Math.floor(foe.purse / 2);
  const lost = Math.min(p.purse, penalty);
  p.purse -= lost;
  p.losses += 1;
  p.streak = 0;
  if (res !== 'yield') p.hp = 1;
  else p.hp = Math.max(1, Math.floor(p.maxhp * 0.2));
  save();

  term.cls();
  hud(term, handle, p);
  term.center(6, res === 'yield' ? 'Y O U   Y I E L D' : res === 'time' ? 'T I M E   I S   C A L L E D' : 'Y O U   F A L L', 12);
  term.center(8, res === 'yield'
    ? 'You drop your blade and the crowd spits.'
    : res === 'time'
      ? 'The editor waves it off. The bout is lost.'
      : `The ${foe.name} stands over you.`, 7);
  put(term, 11, 8, `Purse -${fmt(lost)} gold  ·  the surgeon will want more`, 12);
  put(term, 13, 8, res === 'yield' ? 'You walk out. Bruised, poorer, alive.' : 'They drag you out by the heels.', 10);
  put(term, 15, 8, `Record ${p.wins}W-${p.losses}L`, 7);
  await note(term, 'Press any key');
  return res === 'yield' ? 'You yielded. The crowd remembers.' : 'They carried you out of the Pit.';
}

// -------------------------------------------------------------------- run

module.exports = {
  id: DOOR_ID,
  name: 'THE PIT',
  author: 'Gate Software',
  category: 'Arcade',
  description: 'Gladiator arena combat on a 5x5 sand grid. Win the crowd, climb ten ranks, keep your purse.',
  minLevel: 10,

  async run(term, ctx) {
    const handle = String((ctx.user && ctx.user.handle) || 'Caller');

    if ((term.cols || 80) < 76 || (term.cols || 80) > 84 || (term.rows || 25) < 24) {
      term.cls();
      put(term, 2, 2, 'THE PIT plays in 80 columns. Set your client to 80x25 and call again.', 12);
      await term.readKey({ timeoutMs: 60000 });
      return;
    }

    const users = doorRoot(ctx).users;
    const key = handle.toLowerCase();

    let p = users[key];
    let isNew = false;
    if (!p || typeof p !== 'object') {
      p = freshRecord();
      users[key] = p;
      isNew = true;
    }
    normalize(p);
    const rolled = rollDay(p);
    normalize(p);

    const save = () => {
      try {
        ctx.save();
      } catch {
        /* a save failure must never kill the game */
      }
    };
    save();

    if (isNew || !p.seenIntro) {
      term.cls();
      put(term, 1, 1, ' '.repeat(80), 15, 1);
      put(term, 1, 2, 'THE PIT', 15, 1);
      put(term, 1, 69, 'THE GATE BBS', 11, 1);
      put(term, 3, 1, '─'.repeat(80), 8);
      ctr(term, 6, 'T H E   P I T', 14);
      ctr(term, 7, 'five paces of sand and no way out but forward', 7);
      let r = 10;
      for (const line of ART) put(term, r++, 27, line, 9);
      say(term, 18, 'You signed the ledger with your own name. The editor took it, smiled, and pointed at the gate. Eight bouts a day is all a body can stand.', 7);
      put(term, 22, 6, 'Arrows or WASD/HJKL to move. Walk into your opponent to strike.', 11);
      await press(term, ' Press any key to take the sand', 24);
      p.seenIntro = true;
      save();
    }

    const notice = rolled && !isNew ? 'A new day. The card is full again.' : '';
    const why = await hub(term, ctx, handle, p, save, notice);

    term.cls();
    hud(term, handle, p);
    put(term, 3, 1, '─'.repeat(80), 8);
    ctr(term, 8, 'YOU LEAVE THE PIT', 11);
    ctr(term, 10, `Rank ${p.rank} ${RANKS[p.rank - 1]}   ·   ${p.wins}W-${p.losses}L   ·   ${fmt(p.purse)} gold`, 15);
    ctr(term, 12, why === 'quit' ? 'The gate closes behind you. Your record is safe.' : 'The crowd forgets you before the next bout.', 7);
    save();
    await press(term, ' Press any key', 20);
  },
};
