'use strict';
/*
 * WASTELAND: OVERKILL — a native door for The Gate BBS.
 * Post-apocalyptic exploration with a 3x3 infrared scanner and timing-bar combat.
 * Original content. 80x25 ANSI, keyboard only, no dependencies.
 *
 * State lives at ctx.db.data.doors.overkill.users[handle].
 * The wasteland is generated from a per-user seed, so the map never moves.
 */

const DOOR_ID = 'overkill';
const MAP = 24;
const VIEW = 15;
const MAX_LEVEL = 15;

// terrain codes
const ASH = 0;
const RUBBLE = 1;
const RUIN = 2;
const BUNKER = 3;
const RAD = 4;

const GLYPH = { [ASH]: '·', [RUBBLE]: '▓', [RUIN]: 'r', [BUNKER]: 'b', [RAD]: '%' };
const TCOLOR = { [ASH]: 8, [RUBBLE]: 8, [RUIN]: 11, [BUNKER]: 14, [RAD]: 10 };

const MOB_TYPES = [
  { k: 'D', name: 'Feral Dog', hp: 10, dmg: 3, xp: 7, credits: 4, seq: 4, art: ['   /\\_/\\', '  ( o.o )', '   > ^ <'] },
  { k: 'R', name: 'Road Raider', hp: 16, dmg: 5, xp: 12, credits: 18, seq: 5, art: ['   ,---,', '  | o o |', "  |  ^  |", "  '-----'"] },
  { k: 'M', name: 'Rad Mutant', hp: 20, dmg: 4, xp: 14, credits: 12, seq: 6, art: ['  ,-----,', ' ( o   o )', '  \\  ~  /', '   |/ \\|'] },
  { k: 'G', name: 'Ghoul Pack', hp: 24, dmg: 3, xp: 16, credits: 9, seq: 7, art: ['   .---.', '  ( x x )', '   \\ - /', '   /| |\\'] },
  { k: 'W', name: 'Warlord Scout', hp: 30, dmg: 7, xp: 28, credits: 35, seq: 8, art: ['   ,---,', '  | # # |', '  |  =  |', '  /|   |\\'] },
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

function xpNeed(level) {
  return 40 + level * 35;
}

// Deterministic PRNG so the wasteland is the same every time you walk it.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
    seed: (Math.floor(Math.random() * 0x7fffffff) || 7),
    x: 12,
    y: 12,
    hp: 44,
    maxhp: 44,
    ammo: 18,
    medkits: 1,
    armor: 0,
    xp: 0,
    level: 1,
    kills: 0,
    credits: 60,
    moves: 0,
    mobs: [],
    seenIntro: false,
  };
}

function normalize(p) {
  p.seed = clampInt(p.seed, 1, 0x7fffffff, 7);
  p.x = clampInt(p.x, 0, MAP - 1, 12);
  p.y = clampInt(p.y, 0, MAP - 1, 12);
  p.level = clampInt(p.level, 1, MAX_LEVEL, 1);
  p.maxhp = clampInt(p.maxhp, 20, 999, 44 + (p.level - 1) * 4);
  p.hp = clampInt(p.hp, 1, p.maxhp, p.maxhp);
  p.ammo = Math.max(0, Math.floor(num(p.ammo)));
  p.medkits = Math.max(0, Math.floor(num(p.medkits)));
  p.armor = clampInt(p.armor, 0, 4, 0);
  p.xp = Math.max(0, Math.floor(num(p.xp)));
  p.kills = Math.max(0, Math.floor(num(p.kills)));
  p.credits = Math.max(0, Math.floor(num(p.credits)));
  p.moves = Math.max(0, Math.floor(num(p.moves)));
  if (!Array.isArray(p.mobs)) p.mobs = [];
  p.mobs = p.mobs
    .filter((m) => m && typeof m === 'object')
    .slice(0, 6)
    .map((m) => {
      const hp = clampInt(m.hp, 1, 200, 10);
      return {
        k: typeof m.k === 'string' ? m.k[0] : 'D',
        x: clampInt(m.x, 0, MAP - 1, 0),
        y: clampInt(m.y, 0, MAP - 1, 0),
        hp,
        max: clampInt(m.max, 1, 200, hp),
      };
    });
  p.seenIntro = !!p.seenIntro;
}

function power(p) {
  return 5 + p.level * 2 + p.armor;
}

// ------------------------------------------------------------------- world

function genWorld(seed) {
  const rand = mulberry32(seed);
  const g = [];
  for (let y = 0; y < MAP; y++) {
    const row = [];
    for (let x = 0; x < MAP; x++) {
      const r = rand();
      let t = ASH;
      if (r < 0.08) t = RUBBLE;
      else if (r < 0.13) t = RUIN;
      else if (r < 0.19) t = RAD;
      row.push(t);
    }
    g.push(row);
  }
  // Clear a landing pad around the drop point.
  for (let y = 11; y <= 13; y++) {
    for (let x = 11; x <= 13; x++) g[y][x] = ASH;
  }
  // Four traders, well spread out and never on the drop pad.
  let placed = 0;
  for (let i = 0; i < 4000 && placed < 4; i++) {
    const x = Math.floor(rand() * MAP);
    const y = Math.floor(rand() * MAP);
    if (Math.abs(x - 12) < 4 && Math.abs(y - 12) < 4) continue;
    if (g[y][x] === BUNKER) continue;
    g[y][x] = BUNKER;
    placed += 1;
  }
  return g;
}

function walkable(world, x, y) {
  if (x < 0 || y < 0 || x >= MAP || y >= MAP) return false;
  return world[y][x] !== RUBBLE;
}

function mobHere(p, x, y) {
  return p.mobs.find((m) => m.x === x && m.y === y) || null;
}

function spawnMob(p, world, awayFrom) {
  for (let i = 0; i < 300; i++) {
    const x = Math.floor(Math.random() * MAP);
    const y = Math.floor(Math.random() * MAP);
    if (!walkable(world, x, y)) continue;
    if (world[y][x] === BUNKER) continue;
    if (Math.abs(x - awayFrom.x) + Math.abs(y - awayFrom.y) < 6) continue;
    if (mobHere(p, x, y)) continue;
    const t = pick(MOB_TYPES);
    const hp = t.hp + rnd(4);
    return { k: t.k, x, y, hp, max: hp };
  }
  return null;
}

function typeOf(k) {
  return MOB_TYPES.find((m) => m.k === k) || MOB_TYPES[0];
}

// ------------------------------------------------------------------ header

function hud(term, p) {
  put(term, 1, 1, ' '.repeat(80), 15, 1);
  put(term, 1, 2, 'WASTELAND: OVERKILL', 15, 1);
  put(term, 1, 69, 'THE GATE BBS', 11, 1);
  put(term, 2, 1, ' '.repeat(80), 7, 0);
  const low = p.hp <= Math.max(1, Math.floor(p.maxhp * 0.34));
  const segs = [
    [' ' + clip(p.handle || 'WANDERER', 14) + ' ', 15],
    ['LV ' + p.level + ' ', 11],
    ['HP ' + p.hp + '/' + p.maxhp + ' ', low ? 12 : 10],
    ['AMMO ' + p.ammo + ' ', p.ammo > 0 ? 14 : 12],
    ['XP ' + p.xp + '/' + xpNeed(p.level) + ' ', 11],
    ['KILLS ' + p.kills + ' ', 13],
    ['CR ' + fmt(p.credits) + ' ', 14],
  ];
  let col = 2;
  for (const [txt, fg] of segs) {
    if (col + txt.length - 1 > 80) break;
    put(term, 2, col, txt, fg);
    col += txt.length + 1;
  }
  put(term, 3, 1, '─'.repeat(80), 8);
}

// ------------------------------------------------------------------ screens

function drawMap(term, p, world) {
  term.box(2, 4, 17, 17, { fg: 8 });
  for (let vy = 0; vy < VIEW; vy++) {
    for (let vx = 0; vx < VIEW; vx++) {
      const mx = p.x - 7 + vx;
      const my = p.y - 7 + vy;
      const row = 5 + vy;
      const col = 3 + vx;
      if (mx < 0 || my < 0 || mx >= MAP || my >= MAP) {
        put(term, row, col, ' ', 8, 0);
        continue;
      }
      const m = mobHere(p, mx, my);
      if (mx === p.x && my === p.y) {
        put(term, row, col, '@', 15);
      } else if (m) {
        put(term, row, col, m.k, 12);
      } else {
        const t = world[my][mx];
        put(term, row, col, GLYPH[t], TCOLOR[t]);
      }
    }
  }
  put(term, 4, 4, '┤ WASTELAND ├', 11);
}

function scanCell(term, row, col, p, world, dx, dy) {
  const mx = p.x + dx;
  const my = p.y + dy;
  if (mx < 0 || my < 0 || mx >= MAP || my >= MAP) {
    put(term, row, col, '▒', 8);
    return;
  }
  const m = mobHere(p, mx, my);
  if (m) {
    put(term, row, col, m.k, 12);
    return;
  }
  const t = world[my][mx];
  put(term, row, col, GLYPH[t], TCOLOR[t]);
}

function drawScanner(term, p, world) {
  term.box(20, 5, 21, 5, { fg: 8 });
  put(term, 5, 23, '┤ INFRARED SCAN ├', 11);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const row = 6 + (dy + 1);
      const col = 23 + (dx + 1) * 5;
      if (dx === 0 && dy === 0) put(term, row, col, '@', 15);
      else scanCell(term, row, col, p, world, dx, dy);
    }
  }
}

function drawPanel(term, p, world, journal, contact) {
  term.box(20, 4, 59, 17, { fg: 8 });
  drawScanner(term, p, world);

  put(term, 6, 45, 'LEGEND', 8);
  put(term, 7, 45, '· ash   ▓ rubble', 7);
  put(term, 8, 45, 'r ruins  b bunker', 11);
  put(term, 9, 45, '% radiation', 10);

  put(term, 11, 22, 'SECTOR', 8);
  put(term, 11, 30, `${p.x},${p.y}  of ${MAP}x${MAP}`, 15);
  put(term, 11, 52, 'MOVES', 8);
  put(term, 11, 59, String(p.moves), 11);

  if (contact) {
    const t = typeOf(contact.k);
    put(term, 13, 22, 'CONTACT', 8);
    put(term, 13, 31, `${t.name}  [${contact.hp} hp]`, 12);
  } else {
    put(term, 13, 22, 'CONTACT', 8);
    put(term, 13, 31, 'no movement in scan range', 8);
  }

  for (let i = 0; i < 3; i++) {
    put(term, 15 + i, 21, ' '.repeat(56));
    const line = journal[journal.length - 3 + i];
    if (line) put(term, 15 + i, 22, clip(line, 54), i === 2 ? 15 : 7);
  }
}

async function press(term, msg, row = 23) {
  wipe(term, row);
  put(term, row, 3, msg || 'Press any key', 11);
  const k = await term.readKey({ timeoutMs: 0 });
  wipe(term, row);
  return k;
}

function drawWorld(term, p, world, journal, notice) {
  term.cls();
  hud(term, p);
  drawMap(term, p, world);
  const contact = [].concat(
    p.mobs.filter((m) => Math.abs(m.x - p.x) <= 1 && Math.abs(m.y - p.y) <= 1)
  )[0];
  drawPanel(term, p, world, journal, contact);
  wipe(term, 21);
  wipe(term, 22);
  put(term, 21, 3, clip(notice || 'The wind carries grit and the smell of ozone.', 76), 10);
  put(term, 23, 3, 'Arrows/HJKL move  ·  YUBN diagonals  ·  M medkit  ·  ESC back', 8);
  put(term, 24, 3, 'Step into a bunker to trade. Step into a contact to fight.', 8);
}

// ------------------------------------------------------------------ combat

function seqFor(t) {
  const letters = String(t.name).toUpperCase().replace(/[^A-Z]/g, '');
  const out = [];
  for (let i = 0; i < t.seq; i++) out.push(letters[i % letters.length]);
  return out;
}

function drawCombatFrame(term, p, mob, t) {
  term.cls();
  hud(term, p);
  ctr(term, 5, 'C O N T A C T', 12);
  ctr(term, 6, t.name.toUpperCase(), 15);
  t.art.forEach((line, i) => ctr(term, 8 + i, line, 12));
  put(term, 13, 22, 'FOE', 12);
  put(term, 13, 26, '[' + bar(Math.max(0, mob.hp), t.hp + 4, 24) + ']', 12);
  put(term, 13, 54, `${Math.max(0, mob.hp)} hp`, 12);
  put(term, 14, 22, 'YOU', 10);
  put(term, 14, 26, '[' + bar(Math.max(0, p.hp), p.maxhp, 24) + ']', p.hp / p.maxhp < 0.34 ? 12 : 10);
  put(term, 14, 54, `${p.hp}/${p.maxhp}`, 7);
  put(term, 16, 22, 'AIM AT THE YELLOW MARK. SPACE FIRES. ANY OTHER KEY DRIFTS.', 8);
  put(term, 24, 3, 'ESC breaks contact (they get a free shot)', 8);
}

function drawBar(term, seq, marked, marker) {
  wipe(term, 18);
  wipe(term, 19);
  wipe(term, 20);
  const base = 26;
  for (let i = 0; i < seq.length; i++) {
    put(term, 19, base + i * 3, seq[i], i === marked ? 14 : 7);
  }
  put(term, 18, base + marked * 3, '▼', 14);
  put(term, 20, base + marker * 3, '^', 12);
  put(term, 20, base + seq.length * 3 + 3, 'MARKER', 8);
}

async function combat(term, p, mob, t, save, journal) {
  const seq = seqFor(t);
  const marked = Math.floor(seq.length / 2);
  let marker = 0;
  let swings = 0;
  const maxhp = mob.max || t.hp + 4;

  term.cls();
  drawCombatFrame(term, p, mob, t);
  let msg = 'The contact is on you. Fire when the marker crosses the mark.';
  put(term, 22, 3, clip(msg, 76), 11);
  drawBar(term, seq, marked, marker);

  for (;;) {
    if (swings > 40) {
      put(term, 22, 3, 'You break contact and run. The wasteland keeps its dead.', 12);
      await press(term, 'Press any key');
      return 'fled';
    }
    const k = await term.readKey({ timeoutMs: 140 });
    if (k == null) {
      marker = (marker + 1) % seq.length;
      drawBar(term, seq, marked, marker);
      continue;
    }
    if (k === 'ESC') {
      const dmg = Math.max(1, t.dmg - p.armor);
      p.hp -= dmg;
      journal.push(`You broke contact; ${t.name} caught you for ${dmg}.`);
      save();
      put(term, 22, 3, `You run. It costs you ${dmg} hp.`, 12);
      await press(term, 'Press any key');
      if (p.hp <= 0) return 'down';
      return 'fled';
    }
    if (k !== 'SPACE') {
      marker = (marker + 1) % seq.length;
      drawBar(term, seq, marked, marker);
      continue;
    }

    // FIRE
    swings += 1;
    const dist = Math.abs(marker - marked);
    const missAt = Math.floor(seq.length / 2);
    const ammo = p.ammo > 0;
    let line;
    if (dist > missAt) {
      const dmg = Math.max(1, t.dmg + rnd(2) - 1 - p.armor);
      p.hp -= dmg;
      line = ammo ? `Wide left. ${t.name} answers for ${dmg}.` : `You swing wild. It costs you ${dmg} hp.`;
    } else {
      const scale = 1 - dist / (seq.length + 1);
      let dmg = Math.max(1, Math.round(power(p) * scale));
      if (!ammo) dmg = Math.max(1, Math.round(dmg * 0.4));
      mob.hp -= dmg;
      line = !ammo
        ? `No rounds left — you club it for ${dmg}.`
        : dist === 0
          ? `PERFECT SHOT — ${dmg} damage.`
          : `Hit for ${dmg}.`;
    }
    if (ammo) p.ammo -= 1;
    journal.push(line);
    put(term, 22, 3, clip(line, 76), 11);
    put(term, 13, 26, '[' + bar(Math.max(0, mob.hp), maxhp, 24) + ']', 12);
    put(term, 13, 54, `${Math.max(0, mob.hp)} hp`, 12);
    put(term, 14, 26, '[' + bar(Math.max(0, p.hp), p.maxhp, 24) + ']', p.hp / p.maxhp < 0.34 ? 12 : 10);
    put(term, 14, 54, `${p.hp}/${p.maxhp}`, 7);
    save();

    if (mob.hp <= 0) {
      drawBar(term, seq, marked, marker);
      put(term, 22, 3, clip(`${t.name} drops.`, 76), 10);
      await press(term, 'Press any key');
      return 'win';
    }
    if (p.hp <= 0) {
      await press(term, 'Press any key');
      return 'down';
    }
    marker = (marker + 1) % seq.length;
    drawBar(term, seq, marked, marker);
  }
}

function awardKill(p, t, journal) {
  p.kills += 1;
  p.xp += t.xp;
  p.credits += t.credits;
  const ups = [];
  while (p.level < MAX_LEVEL && p.xp >= xpNeed(p.level)) {
    p.xp -= xpNeed(p.level);
    p.level += 1;
    p.maxhp += 4;
    p.hp = p.maxhp;
    ups.push(`LEVEL ${p.level} — max hp ${p.maxhp}.`);
  }
  const loot = [];
  if (Math.random() < 0.45) {
    const n = 2 + rnd(5);
    p.ammo += n;
    loot.push(`+${n} rounds`);
  }
  if (Math.random() < 0.2) {
    p.medkits += 1;
    loot.push('+1 medkit');
  }
  journal.push(`Kill #${p.kills}. +${t.xp} xp, +${t.credits} cr${loot.length ? ', ' + loot.join(', ') : ''}.`);
  ups.forEach((u) => journal.push(u));
}

// ------------------------------------------------------------------ trader

async function trader(term, p, save, journal) {
  for (;;) {
    term.cls();
    hud(term, p);
    ctr(term, 5, 'B U N K E R   S E V E N', 14);
    ctr(term, 6, '"CASH ONLY. NO REFUNDS. NO EXCEPTIONS."', 8);
    put(term, 9, 8, 'ITEM', 8);
    put(term, 9, 34, 'PRICE', 8);
    put(term, 9, 46, 'YOU HAVE', 8);
    put(term, 11, 8, '[1] 10 rounds of ammo', 15);
    put(term, 11, 34, '15 cr', 14);
    put(term, 11, 46, String(p.ammo) + ' rounds', 7);
    put(term, 12, 8, '[2] Field medkit', 15);
    put(term, 12, 34, '30 cr', 14);
    put(term, 12, 46, String(p.medkits) + ' kits', 7);
    const armorCost = 70 + p.armor * 90;
    const healCost = Math.max(0, (p.maxhp - p.hp) * 3);
    put(term, 13, 8, p.armor >= 4 ? '[3] armour plating (max)' : '[3] armour plating +1', p.armor >= 4 ? 8 : 15);
    put(term, 13, 34, p.armor >= 4 ? '---' : armorCost + ' cr', 14);
    put(term, 13, 46, 'plate ' + p.armor + '/4', 7);
    put(term, 14, 8, '[4] Patch up (full heal)', 15);
    put(term, 14, 34, p.hp >= p.maxhp ? '---' : fmt(healCost) + ' cr', 14);
    put(term, 14, 46, p.hp + '/' + p.maxhp + ' hp', p.hp < p.maxhp ? 12 : 10);
    put(term, 16, 8, 'Credits: ' + fmt(p.credits), 14);
    put(term, 18, 8, 'Ammo is life out there. So is a door you can bolt.', 7);
    put(term, 22, 8, '[1-4] Buy      [ESC] Leave the bunker', 15);
    put(term, 24, 3, 'The proprietor watches your hands, not your face.', 8);
    term.gotoxy(20, 8);

    const k = await term.menu({ prompt: '', valid: '1234', allowEmpty: true });
    if (k == null || k === 'ESC' || k === '') return;
    let ok = true;
    let why = 'Not enough credits.';
    if (k === '1') {
      if (p.credits < 15) ok = false;
      else { p.credits -= 15; p.ammo += 10; journal.push('Bought 10 rounds for 15 cr.'); }
    } else if (k === '2') {
      if (p.credits < 30) ok = false;
      else { p.credits -= 30; p.medkits += 1; journal.push('Bought a medkit for 30 cr.'); }
    } else if (k === '3') {
      if (p.armor >= 4) { ok = false; why = 'Your plating is already bolted tight.'; }
      else if (p.credits < armorCost) ok = false;
      else {
        p.credits -= armorCost;
        p.armor += 1;
        p.maxhp += 6;
        p.hp += 6;
        journal.push(`Bolted on plating (${p.armor}/4) for ${armorCost} cr.`);
      }
    } else if (k === '4') {
      const cost = healCost;
      if (p.hp >= p.maxhp) { ok = false; why = 'Nothing to patch. You are whole.'; }
      else if (p.credits < cost) ok = false;
      else {
        p.credits -= cost;
        p.hp = p.maxhp;
        journal.push(`Patched up for ${cost} cr.`);
      }
    }
    if (!ok) {
      put(term, 20, 8, why, 12);
      await press(term, 'Press any key', 23);
      continue;
    }
    save();
  }
}

// ------------------------------------------------------------------- world

function dirOf(k) {
  if (typeof k !== 'string') return null;
  const u = k.toUpperCase();
  const map = {
    UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0],
    W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
    K: [0, -1], J: [0, 1], H: [-1, 0], L: [1, 0],
    Y: [-1, -1], U: [1, -1], B: [1, 1], N: [-1, 1],
  };
  return map[u] || null;
}

function useMedkit(term, p, save, journal) {
  if (p.medkits <= 0) {
    journal.push('No medkits left.');
    return 'No medkits in the pack.';
  }
  if (p.hp >= p.maxhp) {
    journal.push('You are already whole.');
    return 'Nothing to patch.';
  }
  p.medkits -= 1;
  const heal = Math.min(p.maxhp - p.hp, 18 + p.level * 2);
  p.hp += heal;
  journal.push(`Medkit: +${heal} hp.`);
  save();
  return `You patch ${heal} hp and pocket the empty wrapper.`;
}

module.exports = {
  id: DOOR_ID,
  name: 'WASTELAND: OVERKILL',
  author: 'Gate Software',
  category: 'RPG',
  description: 'Cross a seeded 24x24 wasteland, scan with infrared, trade in bunkers, and win timing-bar firefights.',
  minLevel: 10,

  async run(term, ctx) {
    const handle = String((ctx.user && ctx.user.handle) || 'Caller');

    if ((term.cols || 80) < 76 || (term.cols || 80) > 84 || (term.rows || 25) < 24) {
      term.cls();
      put(term, 2, 2, 'WASTELAND: OVERKILL plays in 80 columns. Set your client to 80x25.', 12);
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
    p.handle = handle;
    normalize(p);
    const world = genWorld(p.seed);

    while (p.mobs.length < 4) {
      const m = spawnMob(p, world, p);
      if (!m) break;
      p.mobs.push(m);
    }

    const save = () => {
      try {
        ctx.save();
      } catch {
        /* a save failure must never kill the game */
      }
    };
    save();

    const journal = ['You come up out of the shelter. The sky is the colour of a bruise.'];

    if (isNew || !p.seenIntro) {
      term.cls();
      put(term, 1, 1, ' '.repeat(80), 15, 1);
      put(term, 1, 2, 'WASTELAND: OVERKILL', 15, 1);
      put(term, 1, 69, 'THE GATE BBS', 11, 1);
      put(term, 3, 1, '─'.repeat(80), 8);
      ctr(term, 6, 'W A S T E L A N D :  O V E R K I L L', 14);
      ctr(term, 7, 'ninety years after the last bad day', 7);
      const art = [
        '        ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄',
        '     ▄█████████████████████████████▄',
        '   ▄█████▓▓▓▓███████████▓▓▓▓████████▄',
        '  ████▓▓▓▓▓▓▓▓▓████████▓▓▓▓▓▓▓▓████████',
        '  ████▓▓▓▓▓▓▓▓▓████████▓▓▓▓▓▓▓▓████████',
        '   ▀███████████████████████████████▀',
        '     ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀',
      ];
      art.forEach((line, i) => put(term, 10 + i, 21, line, 8));
      const lines = [
        'You have a pistol, eighteen rounds, one medkit and a bunker number you',
        'can no longer read. Somewhere north there is a trader who does not ask',
        'questions, and between here and there the wasteland is very interested',
        'in what you are carrying.',
      ];
      lines.forEach((l, i) => put(term, 18 + i, 4, l, 7));
      put(term, 22, 4, 'Move with arrows or HJKL (YUBN for diagonals). Press SPACE in a fight.', 11);
      await press(term, ' Press any key to climb out', 24);
      p.seenIntro = true;
      save();
    }

    let notice = 'The wind carries grit and the smell of ozone.';

    for (;;) {
      drawWorld(term, p, world, journal, notice);
      notice = '';
      const k = await term.readKey({ timeoutMs: 0 });

      if (k === 'ESC') {
        const yn = await press(term, 'Leave the wasteland?  [Y]es / any other key to stay', 22);
        if (yn && String(yn).toUpperCase() === 'Y') break;
        notice = 'You stay. The door of the shelter bangs shut behind you.';
        continue;
      }

      if (k === 'M') {
        notice = useMedkit(term, p, save, journal);
        continue;
      }

      const d = dirOf(k);
      if (!d) {
        term.beep();
        continue;
      }

      const nx = p.x + d[0];
      const ny = p.y + d[1];
      if (nx < 0 || ny < 0 || nx >= MAP || ny >= MAP) {
        notice = 'The edge of the sector. Nothing out there but glass.';
        continue;
      }
      if (world[ny][nx] === RUBBLE) {
        notice = 'A wall of fused rubble. No way through.';
        continue;
      }

      p.x = nx;
      p.y = ny;
      p.moves += 1;
      save();

      const mob = mobHere(p, nx, ny);
      if (mob) {
        const t = typeOf(mob.k);
        journal.push(`${t.name} in sector ${nx},${ny}.`);
        const res = await combat(term, p, mob, t, save, journal);
        p.mobs = p.mobs.filter((m) => m !== mob);
        if (res === 'win') {
          awardKill(p, t, journal);
          notice = `${t.name} down. ${p.kills} kills on the belt.`;
        } else if (res === 'down') {
          const lost = Math.floor(p.credits * 0.25);
          p.credits -= lost;
          p.hp = Math.max(1, Math.floor(p.maxhp * 0.25));
          p.ammo = Math.floor(p.ammo / 2);
          journal.push(`You wake in a ditch. -${lost} cr, half your rounds gone.`);
          notice = 'You wake in a ditch, lighter by ' + lost + ' credits.';
        } else {
          notice = 'You broke contact and kept moving.';
        }
        while (p.mobs.length < 4) {
          const m = spawnMob(p, world, p);
          if (!m) break;
          p.mobs.push(m);
        }
        save();
        continue;
      }

      const t = world[ny][nx];
      if (t === BUNKER) {
        journal.push('A bunker door, painted with a number that has faded.');
        await trader(term, p, save, journal);
        save();
        notice = 'You shoulder the bunker door shut behind you.';
        continue;
      }
      if (t === RAD) {
        const dmg = Math.max(1, 2 + rnd(3) - p.armor);
        p.hp -= dmg;
        journal.push(`Radiation burns through your collar: -${dmg} hp.`);
        save();
        notice = `The geiger counter screams. -${dmg} hp.`;
        if (p.hp <= 0) {
          p.hp = Math.max(1, Math.floor(p.maxhp * 0.2));
          p.credits = Math.floor(p.credits * 0.4);
          journal.push('You crawl out of the hot zone half dead.');
          notice = 'You crawl out of the hot zone, bleeding and poorer.';
          save();
        }
        continue;
      }
      if (t === RUIN) {
        if (Math.random() < 0.55) {
          const find = Math.random();
          if (find < 0.45) {
            const n = 3 + rnd(6);
            p.ammo += n;
            journal.push(`Ruin: ${n} rounds in a footlocker.`);
            notice = `You find ${n} rounds in a rusted footlocker.`;
          } else if (find < 0.75) {
            const c = 8 + rnd(25);
            p.credits += c;
            journal.push(`Ruin: ${c} credits in a dead man's coat.`);
            notice = `You pull ${c} credits off a corpse that no longer needs them.`;
          } else {
            p.medkits += 1;
            journal.push('Ruin: a sealed medkit.');
            notice = 'A sealed medkit, still sterile.';
          }
          save();
          continue;
        }
        const m = spawnMob(p, world, { x: nx, y: ny });
        if (m) {
          m.x = nx;
          m.y = ny;
          p.mobs.push(m);
          const tt = typeOf(m.k);
          journal.push(`Something moves in the ruin: ${tt.name}.`);
          const res = await combat(term, p, m, tt, save, journal);
          p.mobs = p.mobs.filter((x) => x !== m);
          if (res === 'win') {
            awardKill(p, tt, journal);
            notice = `${tt.name} down in the rubble.`;
          } else if (res === 'down') {
            p.hp = Math.max(1, Math.floor(p.maxhp * 0.25));
            p.credits = Math.floor(p.credits * 0.75);
            notice = 'It leaves you for dead. You prove it wrong, barely.';
            journal.push('Left for dead in the ruin. You crawl out.');
          } else {
            notice = 'You back out of the ruin.';
          }
          save();
          continue;
        }
        notice = 'The ruin is empty. Only bones and dust.';
        continue;
      }

      notice = 'Open ground. Boots, grit, and a long walk.';

      // The contacts drift while you walk.
      for (const m of p.mobs) {
        if (Math.random() < 0.45) continue;
        const dx = Math.sign(p.x - m.x);
        const dy = Math.sign(p.y - m.y);
        const far = Math.abs(p.x - m.x) + Math.abs(p.y - m.y) > 6;
        let sx = dx;
        let sy = dy;
        if (far) {
          sx = pick([-1, 0, 1]);
          sy = pick([-1, 0, 1]);
        }
        const tx = m.x + sx;
        const ty = m.y + sy;
        if (walkable(world, tx, ty) && !mobHere(p, tx, ty)) {
          m.x = tx;
          m.y = ty;
        }
        if (m.x === p.x && m.y === p.y) {
          const tt = typeOf(m.k);
          journal.push(`${tt.name} ambushes you.`);
          const res = await combat(term, p, m, tt, save, journal);
          p.mobs = p.mobs.filter((x) => x !== m);
          if (res === 'win') {
            awardKill(p, tt, journal);
            notice = 'You put it down at arm\u2019s length.';
          } else if (res === 'down') {
            p.hp = Math.max(1, Math.floor(p.maxhp * 0.25));
            p.credits = Math.floor(p.credits * 0.75);
            notice = 'You go down. You wake up with less.';
            journal.push('Ambushed and left for dead.');
          } else {
            notice = 'You break contact.';
          }
          save();
          break;
        }
      }
      save();
    }

    term.cls();
    hud(term, p);
    put(term, 3, 1, '─'.repeat(80), 8);
    ctr(term, 8, 'YOU WALK BACK INTO THE DARK', 11);
    ctr(term, 10, `Level ${p.level}  ·  ${p.kills} kills  ·  ${fmt(p.credits)} credits  ·  ${p.moves} moves`, 15);
    ctr(term, 12, 'The wasteland keeps your coordinates. It always does.', 7);
    save();
    await press(term, ' Press any key', 18);
  },
};
