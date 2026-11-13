'use strict';
/*
 * LEGEND OF THE RED DRAGON — a native door for The Gate BBS.
 *
 * A mechanics homage to the 1989 Seth Robinson classic: one forest hunt at a
 * time, a purse you can lose, a bank you cannot, a girl on Rose Lane, and a
 * wyrm that ends the story one way or the other.
 *
 * Every line of prose and every glyph here is original. Keyboard only, 80x25,
 * no dependencies, no network, no child processes.
 *
 * State lives at ctx.db.data.doors.lord.users[handle]. Saved after every
 * meaningful change so a carrier drop costs the caller nothing.
 */

const DOOR_ID = 'lord';
const GAME_NAME = 'LEGEND OF THE RED DRAGON';
const MAX_LEVEL = 12;
const SW = 80;
const DAY_MS = 86400000;
const BANK_RATE = 1.1;
const GEM_PRICE = 120;
const CHARM_CAP = 40;

// ------------------------------------------------------------------- tables

const WEAPONS = [
  { name: 'Bare Hands', power: 0, cost: 0 },
  { name: "Woodcutter's Axe", power: 4, cost: 40 },
  { name: 'Militia Spear', power: 9, cost: 160 },
  { name: 'Cold Iron Mace', power: 14, cost: 420 },
  { name: "Warden's Halberd", power: 20, cost: 900 },
  { name: 'Grave-Iron Blade', power: 27, cost: 1800 },
  { name: 'Sunforged Sabre', power: 35, cost: 3400 },
];

const ARMOR = [
  { name: 'Road Rags', def: 0, cost: 0 },
  { name: 'Boiled Leather', def: 3, cost: 50 },
  { name: 'Riveted Mail', def: 7, cost: 190 },
  { name: "Warden's Plate", def: 12, cost: 480 },
  { name: 'Dragonhide Coat', def: 17, cost: 1050 },
  { name: 'Nightiron Harness', def: 23, cost: 2300 },
];

const MONSTERS = [
  {
    name: 'Gutter Rat', lvl: 1, hp: 9, atk: 2, def: 0, exp: 6, gold: 4,
    taunt: 'A gutter rat drags a stolen crust into the dark and bares its teeth.',
    art: ['  .--.  ', ' ( o.o ) ', '  > ^ <  ', '   " "   '],
  },
  {
    name: 'Briar Wolf', lvl: 1, hp: 12, atk: 3, def: 0, exp: 8, gold: 6,
    taunt: 'A briar wolf steps out of the hedge, ribs showing, eyes steady.',
    art: ['  /\\    ', ' /  \\__ ', '( o  o )', ' \\  ^  /', '  \\||/  '],
  },
  {
    name: 'Mire Toad', lvl: 2, hp: 16, atk: 3, def: 1, exp: 11, gold: 8,
    taunt: 'Something the size of a dog hauls itself out of the ditch and croaks.',
    art: [' .-""-. ', '( o  o )', '(  ..  )', " `-..-' "],
  },
  {
    name: 'Cutpurse', lvl: 2, hp: 15, atk: 4, def: 1, exp: 12, gold: 14,
    taunt: '"Coin or teeth," the cutpurse says, and means either one.',
    art: ['  _____ ', ' /     \\', '| o   o |', '|   ^   |', ' \\_____/'],
  },
  {
    name: 'Bog Hag', lvl: 3, hp: 20, atk: 5, def: 1, exp: 16, gold: 15,
    taunt: 'A bog hag straightens up out of the reeds, smiling at something.',
    art: [' .-~~~-. ', '( o   o )', ' \\  ~  /', ' /|   |\\ '],
  },
  {
    name: 'Ash Hound', lvl: 4, hp: 24, atk: 6, def: 2, exp: 20, gold: 18,
    taunt: 'An ash hound trots out of the burned orchard, coat grey as a shovel.',
    art: [' /\\    /\\', '( o    o )', ' \\  --  /', '  \\/  \\/ '],
  },
  {
    name: 'Gallows Crow', lvl: 4, hp: 22, atk: 7, def: 1, exp: 21, gold: 20,
    taunt: 'A crow the size of a child drops from the gallows beam and screams.',
    art: ['    __   ', '   (o )  ', '  /)  )\\ ', '   \\  /  ', '    \\/   '],
  },
  {
    name: 'Stone Troll', lvl: 5, hp: 30, atk: 8, def: 3, exp: 26, gold: 26,
    taunt: 'A stone troll unfolds from the cairn it was pretending to be.',
    art: ['  ____  ', ' / oo \\ ', '|  __  |', ' \\/  \\/ ', ' /|  |\\ '],
  },
  {
    name: 'Bone Piper', lvl: 6, hp: 32, atk: 9, def: 2, exp: 30, gold: 30,
    taunt: 'A bone piper plays one note, and the note is somehow about you.',
    art: ['   ___   ', '  / o \\  ', ' | === | ', '  \\/|\\/  ', '   | |   '],
  },
  {
    name: 'Iron Boar', lvl: 7, hp: 38, atk: 10, def: 4, exp: 36, gold: 36,
    taunt: 'An iron boar paws the road; its hide rings like a struck pot.',
    art: [' ______ ', '(o    o)', ' \\ == / ', '  \\/\\/  '],
  },
  {
    name: 'Nightmare Stag', lvl: 8, hp: 44, atk: 12, def: 3, exp: 44, gold: 46,
    taunt: 'A stag with too many points watches you from the treeline, unafraid.',
    art: ['\\ / \\ /', ' \\   / ', ' (o o) ', '  \\ /  ', '  /|\\  '],
  },
  {
    name: 'Wyrmling', lvl: 9, hp: 52, atk: 14, def: 5, exp: 54, gold: 60,
    taunt: 'A wyrmling drops off the crag and hangs there, wings beating once.',
    art: [' /\\   /\\', '/  \\_/  \\', '\\  o o  /', ' \\_/ \\_/ '],
  },
  {
    name: 'Ogre Warden', lvl: 10, hp: 60, atk: 16, def: 5, exp: 66, gold: 72,
    taunt: 'An ogre in a rusted badge lifts a club that used to be a tree.',
    art: ['  ____  ', ' |o  o| ', ' | __ | ', '/|    |\\', ' |    | '],
  },
  {
    name: 'Barrens Wight', lvl: 11, hp: 66, atk: 18, def: 6, exp: 78, gold: 84,
    taunt: 'A wight stands in the road with the patience of something already dead.',
    art: ['  ____  ', ' / oo \\ ', '|  ||  |', ' \\ || / ', '  \\||/  '],
  },
];

const VIOLET_STAGES = ['stranger', 'acquaintance', 'friend', 'betrothed', 'married'];

const EVENTS = [
  {
    tag: 'MARKET DAY',
    text: 'The square smells of fried bread and wet wool. Merchants shout each other down for the pleasure of it.',
  },
  {
    tag: 'COLD SNAP',
    text: 'Frost on the troughs. The old men say the crags breathe ice when the wyrm is restless.',
  },
  {
    tag: 'A FUNERAL',
    text: 'Four men carry a covered cart up the hill. Nobody meets your eye. Nobody says whose son it was.',
  },
  {
    tag: 'BARD IN TOWN',
    text: 'A bard is singing about a knight who went up the mountain. The song has no last verse yet.',
  },
  {
    tag: 'MUSTER',
    text: 'The reeve is nailing a notice to the post: a purse for the wyrm, paid on proof. The nails go in crooked.',
  },
  {
    tag: 'THIN SMOKE',
    text: 'The mill chimney is cold again. The miller has taken to drinking at noon and staring uphill.',
  },
  {
    tag: 'PILGRIMS',
    text: 'A line of pilgrims passes through, bound for somewhere holier. They do not stop to drink.',
  },
  {
    tag: 'WOLF WEATHER',
    text: 'Dogs will not leave the hearth. The foresters say the treeline has moved a little closer.',
  },
  {
    tag: 'A WEDDING',
    text: 'Somebody is marrying somebody in the square. There is dancing, and one empty chair at the head table.',
  },
  {
    tag: 'THE BELL',
    text: 'The old bell rings itself once at noon. The priest pretends not to hear it. Everyone else pretends too.',
  },
  {
    tag: 'DEBT COLLECTED',
    text: 'A bailiff is counting a farmer\'s stock out loud in the street. The farmer counts along, quietly.',
  },
  {
    tag: 'STILL AIR',
    text: 'Not a leaf moves. The smoke goes straight up the hill, toward the crag, as if called.',
  },
];

const RUMORS = [
  'Bank it or lose it. The road does not give change.',
  'They say Violet keeps a lamp lit on Rose Lane for whoever comes back.',
  'A master may climb the crag. Only one try a day, the wardens say.',
  'Steel first, courage after. Courage is free; steel is not.',
  'The strongbox pays ten in the hundred every dawn. The gnome has never missed.',
  'Six men went up last season. The mountain kept five of them.',
  'Train, sleep, train. The forest never runs out of teeth.',
];

// --------------------------------------------------------------------- art

const TOWN_ART = [
  '        /\\        |        /\\',
  '   ____/  \\_______|_______/  \\____',
  '  / ~~~  ~~~  ~~~ | ~~~  ~~~  ~~~ \\',
  ' |  ___      ___  |  ___      ___  |',
  ' | |   |    |   | | |   |    |   | |',
  '_|_|___|____|___|_|_|___|____|___|_|',
];

const DRAGON_ART = [
  '          /\\                  /\\',
  '         /  \\__            __/  \\',
  '        /      \\__      __/      \\',
  '       |   /\\     \\____/     /\\   |',
  '       |  /  \\___/  \\  /  \\___/  \\  |',
  '       |  \\  /  o  \\/\\/\\  /  o \\  /  |',
  '        \\  \\/    \\/    \\/    \\/  /',
  '         \\__    /\\      /\\    __/',
  '            \\__/  \\    /  \\__/',
  '                  \\  /',
  '                   \\/',
];

const DRAGON_FIGHT_ART = [
  '      /      \\__      __/      \\',
  '     |   /\\     \\____/     /\\   |',
  '     |  /  \\___/  \\  /  \\___/  \\  |',
  '     |  \\  /  o  \\/\\/\\  /  o \\  /  |',
  '      \\  \\/    \\/    \\/    \\/  /',
  '       \\__    /\\      /\\    __/',
];

const VIOLET_ART = [
  '       /\\',
  '      /  \\______',
  '     /  o   o   \\',
  '    |   __   __  |',
  '    |__|__|_|__|_|',
  '     ~  ~  ~  ~  ~',
];

const SWORD_ART = [
  '        /\\        ',
  '       |  |       ',
  '       |  |  DUNHAVEN',
  '       |  |       ',
  '   ____|__|____   ',
  '       |  |       ',
  '       |__|       ',
];

// ----------------------------------------------------------------- helpers

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
  const pct = Math.max(0, Math.min(1, num(cur) / Math.max(1, num(max))));
  const filled = Math.round(pct * w);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(Math.max(0, w - filled));
}

// exp needed to leave `level` behind
function expNeed(level) {
  const l = Math.max(0, level - 1);
  return 24 + 32 * l + 9 * l * l;
}

function todayKey(d) {
  const dt = d || new Date();
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

function daysBetween(from, to) {
  const a = Date.parse(from + 'T00:00:00');
  const b = Date.parse(to + 'T00:00:00');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

function fightsForLevel(level) {
  return Math.min(8, 3 + Math.floor(level / 3));
}

// Same day, same event, for every caller on the board.
function dayEvent(key) {
  const k = key || todayKey();
  let h = 2166136261 >>> 0;
  for (let i = 0; i < k.length; i++) {
    h ^= k.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return EVENTS[h % EVENTS.length];
}

function dayRumor(key) {
  const k = key || todayKey();
  let h = 5381 >>> 0;
  for (let i = 0; i < k.length; i++) h = (Math.imul(h, 33) + k.charCodeAt(i)) >>> 0;
  return RUMORS[h % RUMORS.length];
}

// Draw with a hard right margin. Nothing can escape column 80 through this.
function put(term, row, col, text, fg, maxW) {
  if (row < 1 || row > 25) return;
  const c = Math.max(1, Math.floor(col));
  let t = String(text == null ? '' : text).replace(/[\r\n]+/g, ' ');
  const room = maxW == null ? SW - c + 1 : Math.min(maxW, SW - c + 1);
  if (room <= 0) return;
  if (t.length > room) t = t.slice(0, room);
  if (!t.length) return;
  term.print(row, c, t, fg);
}

function ctr(term, row, text, fg) {
  let t = String(text == null ? '' : text).replace(/[\r\n]+/g, ' ').replace(/\s+$/, '');
  if (t.length > SW) t = t.slice(0, SW);
  put(term, row, Math.floor((SW - t.length) / 2) + 1, t, fg);
}

function rule(term, row, color) {
  put(term, row, 1, '\u2500'.repeat(SW), color == null ? 8 : color);
}

function clearRows(term, from, to) {
  for (let r = from; r <= to; r++) put(term, r, 1, ' '.repeat(SW), 7);
}

function wrapAt(term, text, width) {
  return term.wrap(String(text), Math.max(10, Math.min(SW - 4, width)));
}

// ------------------------------------------------------------------- state

function doorRoot(ctx) {
  const data = ctx.db.data;
  if (!data.doors || typeof data.doors !== 'object') data.doors = {};
  let door = data.doors[DOOR_ID];
  if (!door || typeof door !== 'object') {
    door = { users: {} };
    data.doors[DOOR_ID] = door;
  }
  if (!door.users || typeof door.users !== 'object') door.users = {};
  return door;
}

function freshRecord(handle) {
  const maxhp = 24;
  return {
    handle: String(handle || 'Caller').slice(0, 24),
    level: 1,
    exp: 0,
    hp: maxhp,
    maxhp,
    strength: 4,
    defense: 2,
    gold: 40,
    bank: 0,
    gems: 0,
    weapon: 0,
    armor: 0,
    charm: 0,
    fightsLeft: fightsForLevel(1),
    violetStage: 0,
    marriedTo: null,
    lastDay: todayKey(),
    violetDay: '',
    dragonDay: '',
    kills: 0,
    deaths: 0,
    pvpWins: 0,
    pvpLosses: 0,
    master: false,
    dragonSlain: false,
    seenIntro: false,
  };
}

function normalize(p) {
  p.level = clampInt(p.level, 1, MAX_LEVEL, 1);
  p.exp = clampInt(p.exp, 0, 999999, 0);
  p.maxhp = clampInt(p.maxhp, 10, 9999, 24);
  p.hp = clampInt(p.hp, 0, p.maxhp, p.maxhp);
  p.strength = clampInt(p.strength, 1, 999, 4);
  p.defense = clampInt(p.defense, 0, 999, 2);
  p.gold = clampInt(p.gold, 0, 9999999, 0);
  p.bank = clampInt(p.bank, 0, 9999999, 0);
  p.gems = clampInt(p.gems, 0, 9999, 0);
  p.weapon = clampInt(p.weapon, 0, WEAPONS.length - 1, 0);
  p.armor = clampInt(p.armor, 0, ARMOR.length - 1, 0);
  p.charm = clampInt(p.charm, 0, CHARM_CAP, 0);
  p.fightsLeft = clampInt(p.fightsLeft, 0, 8, fightsForLevel(p.level));
  p.violetStage = clampInt(p.violetStage, 0, 4, 0);
  p.kills = clampInt(p.kills, 0, 999999, 0);
  p.deaths = clampInt(p.deaths, 0, 999999, 0);
  p.pvpWins = clampInt(p.pvpWins, 0, 999999, 0);
  p.pvpLosses = clampInt(p.pvpLosses, 0, 999999, 0);
  p.master = !!p.master || p.level >= MAX_LEVEL;
  p.dragonSlain = !!p.dragonSlain;
  p.seenIntro = !!p.seenIntro;
  if (typeof p.handle !== 'string' || !p.handle) p.handle = 'Caller';
  if (typeof p.lastDay !== 'string' || !p.lastDay) p.lastDay = todayKey();
  if (typeof p.violetDay !== 'string') p.violetDay = '';
  if (typeof p.dragonDay !== 'string') p.dragonDay = '';
  if (typeof p.marriedTo !== 'string') p.marriedTo = null;
  return p;
}

// A new local day: fights restored, bank interest paid, Violet and the lair open again.
function rollDay(p) {
  const today = todayKey();
  if (p.lastDay === today) return null;
  const days = Math.max(1, daysBetween(p.lastDay, today));
  let interest = 0;
  if (p.bank > 0) {
    let b = p.bank;
    for (let i = 0; i < Math.min(days, 30); i++) b = Math.floor(b * BANK_RATE);
    interest = b - p.bank;
    p.bank = b;
  }
  p.lastDay = today;
  p.fightsLeft = fightsForLevel(p.level);
  p.violetDay = '';
  p.dragonDay = '';
  return { days, interest };
}

function weaponOf(p) {
  return WEAPONS[clampInt(p.weapon, 0, WEAPONS.length - 1, 0)];
}

function armorOf(p) {
  return ARMOR[clampInt(p.armor, 0, ARMOR.length - 1, 0)];
}

// Marriage is a live bonus derived from the record, never baked into stats,
// so re-entering the door can't stack it twice.
function atkPower(p) {
  const wed = p.violetStage >= 4 ? 4 : 0;
  return num(p.strength) + weaponOf(p).power + wed;
}

function defPower(p) {
  const wed = p.violetStage >= 4 ? 3 : 0;
  return num(p.defense) + armorOf(p).def + wed;
}

function titleFor(p) {
  if (p.dragonSlain) return 'DRAGONSBANE';
  if (p.master) return 'MASTER OF DUNHAVEN';
  if (p.violetStage >= 4) return 'THE ROSE\'S OWN';
  if (p.level >= 8) return 'SEASONED BLADE';
  return '';
}

function awardExp(p, amount) {
  const ups = [];
  p.exp += Math.max(0, Math.floor(num(amount)));
  while (p.level < MAX_LEVEL && p.exp >= expNeed(p.level)) {
    p.exp -= expNeed(p.level);
    p.level += 1;
    const hpGain = 6 + rnd(6);
    const stGain = 2 + rnd(2);
    const dfGain = 1 + rnd(2);
    p.maxhp += hpGain;
    p.strength += stGain;
    p.defense += dfGain;
    p.hp = p.maxhp;
    ups.push(`LEVEL ${p.level}   +${hpGain} hp  +${stGain} str  +${dfGain} def`);
    if (p.level >= MAX_LEVEL) {
      p.master = true;
      ups.push('You are a MASTER of Dunhaven. The crag is open to you.');
    }
  }
  if (p.level >= MAX_LEVEL) p.exp = Math.min(p.exp, 99999);
  return ups;
}

function violetStageFromCharm(charm) {
  if (charm >= 10) return 2;
  if (charm >= 3) return 1;
  return 0;
}

function syncViolet(p) {
  if (p.violetStage >= 3) return false;
  const want = violetStageFromCharm(p.charm);
  if (want > p.violetStage) {
    p.violetStage = want;
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ chrome

function hud(term, handle, p) {
  put(term, 1, 1, ' '.repeat(SW), 15, SW);
  put(term, 1, 2, GAME_NAME, 15, 40);
  put(term, 1, 51, 'THE GATE BBS  \u00b7  NODE 1', 11, 29);

  put(term, 2, 1, ' '.repeat(SW), 7, SW);
  const low = p.hp <= Math.max(1, Math.floor(p.maxhp * 0.34));
  const parts = [
    [' ' + String(handle).slice(0, 16) + ' ', 15],
    [' Lv ' + p.level + (p.master ? '*' : '') + ' ', 11],
    [' HP ' + p.hp + '/' + p.maxhp + ' ', low ? 12 : 10],
    [' Gold ' + fmt(p.gold) + ' ', 14],
    [' Bank ' + fmt(p.bank) + ' ', 14],
    [' Fights ' + p.fightsLeft + '/' + fightsForLevel(p.level) + ' ', p.fightsLeft ? 11 : 8],
  ];
  let col = 1;
  for (const [txt, fg] of parts) {
    if (col + txt.length - 1 > SW) break;
    put(term, 2, col, txt, fg);
    col += txt.length + 1;
  }
  rule(term, 3, 8);
}

function frame(term, handle, p, title, subtitle) {
  term.cls();
  hud(term, handle, p);
  if (title) ctr(term, 5, title, 14);
  if (subtitle) ctr(term, 6, subtitle, 8);
}

function footer(term, text) {
  put(term, 25, 2, text == null ? 'ESC backs out one screen  \u00b7  Q leaves the game at the square' : text, 8, 76);
}

async function note(term, msg, color, row) {
  const r = row == null ? 23 : row;
  put(term, r, 1, ' '.repeat(SW), 7);
  put(term, r, 2, String(msg).slice(0, 76), color == null ? 14 : color, 76);
  clearRows(term, r + 1, 24);
  term.gotoxy(Math.min(23, r), 1);
  await term.pause('Press any key');
}

async function readAmount(term, prompt, max, row) {
  put(term, row, 1, ' '.repeat(SW), 7);
  put(term, row, 3, prompt, 11, 74);
  term.gotoxy(row, Math.min(77, 3 + String(prompt).length));
  let v = '';
  for (;;) {
    const k = await term.readKey({ timeoutMs: 300000 });
    if (k == null) return null;
    if (k === 'ESC') {
      term.write('\r\n');
      return null;
    }
    if (k === 'A' || k === 'a') {
      term.write('\r\n');
      return max;
    }
    if (k === 'ENTER') {
      term.write('\r\n');
      return v.length ? Number(v) : 0;
    }
    if (/^[0-9]$/.test(k)) {
      if (v.length < 7) {
        v += k;
        term.write(k);
      } else {
        term.beep();
      }
      continue;
    }
    if (k === 'BACKSPACE') {
      if (v.length) {
        v = v.slice(0, -1);
        term.write('\b \b');
      }
    }
  }
}

// ------------------------------------------------------------------ screens

async function titleScreen(term, handle, p) {
  term.cls();
  put(term, 2, 1, ' '.repeat(SW), 15, SW);
  ctr(term, 2, `THE GATE BBS   \u00b7   NODE ${term.node || 1}   \u00b7   ${(term.modem && term.modem.bps) || 14400} BAUD`, 15);
  rule(term, 4, 8);
  let row = 6;
  for (const line of DRAGON_ART) ctr(term, row++, line, 12);
  ctr(term, 18, 'L E G E N D   O F   T H E   R E D   D R A G O N', 14);
  ctr(term, 19, 'a tale of Dunhaven, told one day at a time', 7);
  rule(term, 21, 8);
  put(term, 22, 3, 'Caller: ' + String(handle).slice(0, 22), 11);
  put(term, 22, 50, 'Rank: ' + (titleFor(p) || 'unproven'), 13, 28);
  put(term, 23, 3, 'Fight the forest. Court the girl. Face the wyrm.', 7, 74);
  term.gotoxy(24, 1);
  await term.pause(' Press any key to take the road');
}

async function introScreen(term, handle, p) {
  const pages = [
    [
      'Dunhaven sits where the road gives up and the mountain begins:',
      'a hundred roofs, one well, one bell that rings itself at noon.',
      'Above the last chimney the crag leans out over the valley like a',
      'closed fist, and for nine years nothing up there moved.',
    ],
    [
      'Nine years is a long time for a mountain to hold its breath.',
      'Three nights ago the mill burned from the inside out. The well',
      'came back hot. Something walked the ridge at dusk with a wingspan',
      'that put the whole orchard in shadow, and the reeve has posted a',
      'purse nobody has lived long enough to collect.',
    ],
    [
      'You have a good pair of boots, forty gold, and the sort of sense',
      'that gets a person killed in the first week. The forest is full of',
      'things with teeth. The bank pays ten in the hundred. Rose Lane has',
      'a lamp in the window, and a girl who has not yet learned your name.',
      '',
      'Letters choose. ESC backs out one screen. Q leaves at the square.',
    ],
  ];
  for (let i = 0; i < pages.length; i++) {
    frame(term, handle, p, 'THE TALE', 'page ' + (i + 1) + ' of ' + pages.length);
    let r = 9;
    for (const line of pages[i]) {
      put(term, r++, 6, line, i === 2 && line.indexOf('Letters') === 0 ? 10 : 7, 72);
    }
    put(term, 20, 6, i < pages.length - 1 ? '-- more --' : 'The gate creaks open.', 11, 60);
    term.gotoxy(22, 2);
    await term.pause(i < pages.length - 1 ? 'Press any key' : 'Press any key to begin');
  }
}

function drawTown(term, handle, p, notice) {
  term.cls();
  hud(term, handle, p);

  term.box(2, 5, 46, 15, { fg: 8 });
  put(term, 5, 3, '\u2524 DUNHAVEN \u251c', 11, 20);
  let r = 6;
  for (const line of TOWN_ART) {
    put(term, r++, 4, line, 9, 43);
  }
  put(term, 13, 4, 'Woodsmoke, wet stone, a dog barking', 7, 42);
  put(term, 14, 4, 'at nothing in particular.', 7, 42);

  const ev = dayEvent();
  put(term, 15, 4, "TODAY'S EVENT  \u00b7  " + ev.tag, 13, 42);
  let er = 16;
  for (const line of wrapAt(term, ev.text, 42)) {
    if (er > 18) break;
    put(term, er++, 4, line, 7, 42);
  }

  term.box(49, 5, 31, 15, { fg: 8 });
  put(term, 5, 50, '\u2524 THE SQUARE \u251c', 11, 20);
  const menu = [
    [p.master ? '  (F)orest ..... The crag' : '  (F)orest ..... Hunt', p.master ? 12 : 15],
    ['  (I)nn ........ Heal', 15],
    ['  (B)ank ....... Interest', 15],
    ['  (S)hop ....... Steel', 15],
    ['  (V)iolet ..... Rose Lane', 15],
    ['  (A)ttack ..... A caller', 15],
    ['  (H)ealer ..... Your legend', 15],
    ['  (T)oday\'s event', 15],
    ['  (Q)uit ....... Leave', 15],
  ];
  menu.forEach((it, i) => put(term, 7 + i, 50, it[0], it[1], 29));
  put(term, 17, 50, 'Fights left  ' + padL(p.fightsLeft, 2) + ' / ' + fightsForLevel(p.level), p.fightsLeft ? 11 : 12, 29);
  put(term, 18, 50, 'Purse ' + fmt(p.gold) + ' g   Bank ' + fmt(p.bank) + ' g', 14, 29);

  put(term, 21, 2, dayRumor(), 8, 76);
  put(term, 22, 2, notice || '', 10, 76);
  footer(term);
  term.gotoxy(24, 2);
}

async function town(term, ctx, handle, p, save, noticeIn) {
  let notice = noticeIn || '';
  for (;;) {
    drawTown(term, handle, p, notice);
    notice = '';
    const k = await term.menu({ prompt: ' Command: ', valid: 'FIBSVAHTQ' });
    if (k == null) return 'timeout';
    if (k === 'ESC' || k === 'Q') return 'quit';
    if (k === 'F') notice = await forest(term, handle, p, save);
    else if (k === 'I') notice = await inn(term, handle, p, save);
    else if (k === 'B') notice = await bank(term, handle, p, save);
    else if (k === 'S') notice = await shop(term, handle, p, save);
    else if (k === 'V') notice = await violet(term, handle, p, save);
    else if (k === 'A') notice = await pvp(term, ctx, handle, p, save);
    else if (k === 'H') notice = await statusScreen(term, handle, p);
    else if (k === 'T') notice = await eventScreen(term, handle, p);
  }
}

// --------------------------------------------------------------------- shop

async function shop(term, handle, p, save) {
  let tab = 'weapon';
  for (;;) {
    const list = tab === 'weapon' ? WEAPONS : ARMOR;
    const cur = tab === 'weapon' ? p.weapon : p.armor;
    frame(
      term,
      handle,
      p,
      tab === 'weapon' ? "HALBRECHT'S FORGE" : 'THE ARMOURER\'S YARD',
      tab === 'weapon' ? '"Steel first. Courage is free."' : '"Ribs are hard to replace."'
    );

    put(term, 8, 4, '#', 8);
    put(term, 8, 7, tab === 'weapon' ? 'WEAPON' : 'ARMOUR', 8);
    put(term, 8, 36, tab === 'weapon' ? 'POW' : 'DEF', 8);
    put(term, 8, 43, 'COST', 8);
    rule(term, 9, 8);

    list.forEach((it, i) => {
      const equipped = i === cur;
      const fg = equipped ? 15 : i < cur ? 8 : 7;
      const row = 10 + i;
      put(term, row, 4, i === 0 ? '-' : String(i), 11);
      put(term, row, 6, equipped ? '>' : ' ', 10);
      put(term, row, 8, pad(it.name, 25), fg, 26);
      put(term, row, 36, padL(tab === 'weapon' ? it.power : it.def, 3), 14);
      put(term, row, 43, i === 0 ? '    ---' : padL(fmt(it.cost), 7), 14);
    });

    put(term, 18, 3, 'Wearing: ' + (tab === 'weapon' ? weaponOf(p).name : armorOf(p).name), 11, 60);
    put(term, 19, 3, 'Purse ' + fmt(p.gold) + ' gold    Gems ' + fmt(p.gems), 14, 60);
    put(term, 21, 3, '[#] Buy   [' + (tab === 'weapon' ? 'A' : 'W') + '] ' + (tab === 'weapon' ? 'Armour' : 'Weapons') + '   [G] Sell gem   [ESC] Back', 10, 76);
    footer(term, 'Better steel hits harder. Better mail turns the hit.');
    term.gotoxy(23, 1);

    const k = await term.menu({ prompt: ' Choice: ', valid: '123456AWG' });
    if (k == null || k === 'ESC') return '';
    if (k === 'A') {
      tab = 'armor';
      continue;
    }
    if (k === 'W') {
      tab = 'weapon';
      continue;
    }
    if (k === 'G') {
      if (p.gems <= 0) {
        await note(term, 'You have no gems to sell.', 12);
        continue;
      }
      p.gems -= 1;
      p.gold += GEM_PRICE;
      save();
      await note(term, 'The gem cutter weighs it, grunts, and pays ' + GEM_PRICE + ' gold.', 10);
      continue;
    }
    const idx = Number(k);
    const it = list[idx];
    if (!it) continue;
    if (idx <= cur) {
      await note(term, 'You already carry as good or better.', 12);
      continue;
    }
    if (it.cost > p.gold) {
      await note(term, 'Not enough gold. The forge does not extend credit.', 12);
      continue;
    }
    p.gold -= it.cost;
    if (tab === 'weapon') p.weapon = idx;
    else p.armor = idx;
    save();
    await note(term, 'You buy the ' + it.name + ' for ' + fmt(it.cost) + ' gold.', 10);
  }
}

// --------------------------------------------------------------------- bank

async function bank(term, handle, p, save) {
  for (;;) {
    frame(term, handle, p, 'THE DUNHAVEN STRONGBOX', 'Ten in the hundred, every dawn. The gnome has never missed one.');
    put(term, 9, 6, 'Carried', 8);
    put(term, 9, 26, fmt(p.gold) + ' gold', 14);
    put(term, 11, 6, 'In the box', 8);
    put(term, 11, 26, fmt(p.bank) + ' gold', 11);
    put(term, 13, 6, 'Interest at dawn', 8);
    put(term, 13, 26, fmt(Math.floor(p.bank * BANK_RATE) - p.bank) + ' gold', 10);
    put(term, 15, 6, 'The box cannot be robbed. Your pockets can.', 7, 70);
    put(term, 17, 6, 'Gems in your coat: ' + fmt(p.gems), 13, 60);
    put(term, 19, 5, '(D)eposit     (W)ithdraw     [ESC] Back', 15, 60);
    footer(term, 'Type a number and press ENTER, or A for all of it.');
    term.gotoxy(21, 1);

    const k = await term.menu({ prompt: ' Choice: ', valid: 'DW' });
    if (k == null || k === 'ESC') return '';

    if (k === 'D') {
      if (p.gold <= 0) {
        await note(term, 'Your purse is empty.', 12);
        continue;
      }
      const amt = await readAmount(term, 'Deposit how much (carried ' + fmt(p.gold) + ')? ', p.gold, 20);
      if (amt == null) continue;
      const real = Math.max(0, Math.min(p.gold, Math.floor(amt)));
      if (!real) {
        await note(term, 'Nothing deposited.', 12);
        continue;
      }
      p.gold -= real;
      p.bank += real;
      save();
      await note(term, 'The gnome locks away ' + fmt(real) + ' gold and writes it in the book.', 10);
    } else {
      if (p.bank <= 0) {
        await note(term, 'The strongbox is empty.', 12);
        continue;
      }
      const amt = await readAmount(term, 'Withdraw how much (banked ' + fmt(p.bank) + ')? ', p.bank, 20);
      if (amt == null) continue;
      const real = Math.max(0, Math.min(p.bank, Math.floor(amt)));
      if (!real) {
        await note(term, 'Nothing withdrawn.', 12);
        continue;
      }
      p.bank -= real;
      p.gold += real;
      save();
      await note(term, 'The gnome counts out ' + fmt(real) + ' gold, coin by coin.', 10);
    }
  }
}

// ---------------------------------------------------------------------- inn

async function inn(term, handle, p, save) {
  const missing = Math.max(0, p.maxhp - p.hp);
  const cost = Math.max(4, missing * 3);
  frame(term, handle, p, 'THE LANTERN & LAST', 'Beds, barley, and a poultice that stings like a wasp.');
  put(term, 9, 5, 'The innkeeper looks at your wounds and names her price.', 7, 72);
  put(term, 11, 5, 'Missing health', 8);
  put(term, 11, 28, String(missing), missing ? 12 : 10);
  put(term, 12, 5, 'A bed and a bandage', 8);
  put(term, 12, 28, fmt(cost) + ' gold', 14);
  put(term, 14, 5, 'Purse: ' + fmt(p.gold) + ' gold', 7, 60);

  if (missing <= 0) {
    put(term, 17, 5, 'You are already whole. Go and get hurt again.', 10, 70);
    term.gotoxy(19, 2);
    await term.pause('Press any key');
    return '';
  }
  if (p.gold < cost) {
    put(term, 17, 5, 'You cannot afford a bed tonight. The stable is cheaper.', 12, 70);
    term.gotoxy(19, 2);
    await term.pause('Press any key');
    return 'The innkeeper turned you away. You need ' + fmt(cost) + ' gold.';
  }
  term.gotoxy(17, 5);
  const yn = await term.yesno('Pay ' + fmt(cost) + ' gold to be made whole?', true);
  if (!yn) return '';
  p.gold -= cost;
  p.hp = p.maxhp;
  save();
  frame(term, handle, p, 'REST', null);
  put(term, 9, 6, 'You sleep like the dead and wake up on the right side of it.', 10, 70);
  put(term, 11, 6, 'The innkeeper leaves a bowl of barley and a bill.', 7, 70);
  term.gotoxy(13, 2);
  await term.pause('Press any key');
  return '';
}

// ------------------------------------------------------------------- status

async function statusScreen(term, handle, p) {
  frame(term, handle, p, "THE HEALER'S TENT", 'She reads scars the way scholars read books.');
  const nextExp = p.level >= MAX_LEVEL ? 'MASTER' : fmt(expNeed(p.level) - p.exp);
  const stage = VIOLET_STAGES[clampInt(p.violetStage, 0, 4, 0)];
  const left = [
    ['Name', String(handle).slice(0, 22), 15],
    ['Rank', titleFor(p) || 'unproven', 13],
    ['Level', String(p.level) + (p.master ? '  (master)' : ''), 11],
    ['Experience', fmt(p.exp) + ' / ' + (p.level >= MAX_LEVEL ? 'max' : fmt(expNeed(p.level))), 14],
    ['To next', nextExp, 10],
    ['Health', p.hp + ' / ' + p.maxhp, p.hp < p.maxhp ? 12 : 10],
    ['Strength', String(p.strength), 11],
    ['Defense', String(p.defense), 11],
  ];
  const right = [
    ['Gold carried', fmt(p.gold), 14],
    ['Banked', fmt(p.bank), 14],
    ['Gems', fmt(p.gems), 13],
    ['Weapon', weaponOf(p).name, 11],
    ['Armour', armorOf(p).name, 11],
    ['Charm', String(p.charm), 13],
    ['Violet', stage, p.violetStage >= 4 ? 14 : 15],
    ['Fights left', p.fightsLeft + ' / ' + fightsForLevel(p.level), p.fightsLeft ? 11 : 12],
  ];

  left.forEach((row, i) => {
    put(term, 8 + i, 4, pad(row[0], 13), 8, 13);
    put(term, 8 + i, 18, pad(row[1], 20), row[2], 20);
  });
  right.forEach((row, i) => {
    put(term, 8 + i, 42, pad(row[0], 12), 8, 12);
    put(term, 8 + i, 55, pad(row[1], 24), row[2], 24);
  });

  put(term, 17, 4, 'Slain', 8);
  put(term, 17, 18, fmt(p.kills), 15, 10);
  put(term, 17, 42, 'Duels W/L', 8);
  put(term, 17, 55, fmt(p.pvpWins) + ' / ' + fmt(p.pvpLosses), 15, 20);
  put(term, 18, 4, 'Deaths', 8);
  put(term, 18, 18, fmt(p.deaths), 12, 10);
  put(term, 18, 42, 'Red Dragon', 8);
  put(term, 18, 55, p.dragonSlain ? 'SLAIN' : p.master ? 'waiting' : 'unmet', p.dragonSlain ? 14 : 12, 20);

  if (p.violetStage >= 3 && p.marriedTo) {
    const line = p.violetStage >= 4
      ? 'Wed to ' + p.marriedTo + ' \u2014 the bards have started a verse about it.'
      : 'Betrothed to ' + p.marriedTo + ' \u2014 the wedding has not been paid for yet.';
    put(term, 20, 4, line, 13, 74);
  } else {
    put(term, 20, 4, 'Sleep, eat, and bank. Everything else is luck.', 7, 74);
  }
  footer(term, 'The inn heals. The bank protects. The forest teaches.');
  term.gotoxy(22, 2);
  await term.pause('Press any key');
  return '';
}

async function eventScreen(term, handle, p) {
  const ev = dayEvent();
  frame(term, handle, p, "TODAY'S EVENT", ev.tag);
  let row = 9;
  for (const line of wrapAt(term, ev.text, 66)) {
    put(term, row++, 7, line, 7, 66);
  }
  row += 1;
  put(term, row++, 7, 'The whole valley is having the same day you are.', 8, 66);
  put(term, row + 1, 7, 'Events turn over at local midnight.', 10, 66);
  footer(term);
  term.gotoxy(21, 2);
  await term.pause('Press any key');
  return '';
}

// ------------------------------------------------------------------- violet

function violetLine(p) {
  const stage = clampInt(p.violetStage, 0, 4, 0);
  if (stage === 0) {
    return 'She is sweeping the step and does not look up. "If you are selling something, the market is the other way."';
  }
  if (stage === 1) {
    return '"You again," she says, and the corner of her mouth gives her away. "Sit, then. The step is clean enough."';
  }
  if (stage === 2) {
    return '"I saved you the crust," she says. "Do not make a thing of it." She makes a thing of it.';
  }
  if (stage === 3) {
    return '"The priest is asking when," she says, and looks at the mountain instead of you.';
  }
  return 'The lamp is lit and the door is unlatched. She is arguing with the cat about the fire.';
}

async function violet(term, handle, p, save) {
  const today = todayKey();
  const stage0 = clampInt(p.violetStage, 0, 4, 0);

  if (p.violetDay === today) {
    frame(term, handle, p, 'ROSE LANE', 'The lamp is out. She has already bolted the door.');
    put(term, 9, 6, stage0 >= 4
      ? 'You have already been home today. She kissed you at the gate and told you to eat something.'
      : 'You have already called on Violet today. One visit a day is all she will allow.', 7, 68);
    put(term, 12, 6, 'Come back tomorrow.', 10, 68);
    footer(term);
    term.gotoxy(15, 2);
    await term.pause('Press any key');
    return 'Violet has already seen you today.';
  }

  p.violetDay = today;
  save();

  let notice = '';
  for (;;) {
    const stage = clampInt(p.violetStage, 0, 4, 0);
    frame(term, handle, p, 'THE COTTAGE ON ROSE LANE', 'Violet, and the lamp in the window.');
    let row = 8;
    for (const line of VIOLET_ART) put(term, row++, 8, line, 13, 40);

    let trow = 14;
    for (const line of wrapAt(term, violetLine(p), 66)) {
      if (trow > 16) break;
      put(term, trow++, 7, line, 7, 66);
    }
    put(term, 17, 6, 'stage: ' + VIOLET_STAGES[stage] + '     charm: ' + p.charm, 13, 60);

    const opts = [
      ['  (T)alk to her', 'free', 15],
      ['  (F)lowers', '20 g', 15],
      ['  (S)ong for her', '40 g', stage >= 1 ? 15 : 8],
      ['  (R)ing', '140 g', stage >= 1 ? 15 : 8],
    ];
    if (stage === 2) opts.push(['  (P)ropose', 'charm 18+', p.charm >= 18 ? 14 : 8]);
    if (stage === 3) opts.push(['  (W)edding feast', '250 g', 14]);
    opts.push(['  (L)eave', '', 15]);
    opts.forEach((o, i) => {
      const col = i < 3 ? 6 : 42;
      const row = 19 + (i % 3);
      put(term, row, col, pad(o[0], 24), o[2], 26);
      put(term, row, col + 24, o[1], 8, 9);
    });
    put(term, 23, 5, notice || 'She waits, and the kettle waits with her.', notice ? 10 : 7, 74);
    footer(term);
    term.gotoxy(24, 4);

    const valid = stage === 2 ? 'TFSRPL' : stage === 3 ? 'TFSRWL' : 'TFSRL';
    const k = await term.menu({ prompt: ' Choice: ', valid });
    if (k == null || k === 'ESC' || k === 'L') return notice || '';
    notice = '';

    if (k === 'T') {
      if (stage >= 4) {
        const heal = Math.min(3, p.maxhp - p.hp);
        p.hp += heal;
        save();
        notice = heal > 0
          ? 'You split a loaf at your own table. She sends you out fed (+' + heal + ' hp).'
          : 'You split a loaf at your own table and argue about the cat.';
        continue;
      }
      p.charm = Math.min(CHARM_CAP, p.charm + 1);
      const grew = syncViolet(p);
      save();
      notice = grew
        ? 'You talk until the light goes orange. Something between you has shifted.'
        : 'You talk about nothing much, which is somehow the best part of the day.';
      continue;
    }

    const cost = k === 'F' ? 20 : k === 'S' ? 40 : k === 'R' ? 140 : 0;
    if ((k === 'S' || k === 'R') && stage < 1) {
      notice = 'She does not know you well enough for that. Talk first.';
      continue;
    }
    if (cost > p.gold) {
      notice = 'You cannot afford that. She notices, and says nothing.';
      continue;
    }

    if (k === 'F') {
      p.gold -= cost;
      p.charm = Math.min(CHARM_CAP, p.charm + 1);
      syncViolet(p);
      save();
      notice = 'You bring flowers. She calls them impractical, then finds a jar.';
    } else if (k === 'S') {
      p.gold -= cost;
      p.charm = Math.min(CHARM_CAP, p.charm + 2);
      syncViolet(p);
      save();
      notice = 'The minstrel plays the road-home song. She hums it after.';
    } else if (k === 'R') {
      p.gold -= cost;
      p.charm = Math.min(CHARM_CAP, p.charm + 3);
      syncViolet(p);
      save();
      notice = 'Tin ring, glass stone. She wears it on her thumb and keeps it there.';
    } else if (k === 'P') {
      if (p.charm < 18) {
        notice = 'Not yet. She would laugh, and you would deserve it.';
        continue;
      }
      if (p.marriedTo === 'Violet') {
        notice = 'You are already promised to her. She reminds you of this at length.';
        continue;
      }
      const chance = Math.min(92, 35 + p.charm * 3);
      if (rnd(100) <= chance) {
        p.violetStage = 3;
        p.marriedTo = 'Violet';
        save();
        notice = 'She says yes before you finish, then makes you say it all anyway.';
      } else {
        p.charm = Math.max(0, p.charm - 5);
        save();
        notice = '"Ask me when the mountain is quiet," she says, and lets go of your hand.';
      }
    } else if (k === 'W') {
      if (p.marriedTo !== 'Violet' || p.violetStage < 3) {
        notice = 'There is no wedding to pay for.';
        continue;
      }
      if (p.gold < 250) {
        notice = 'A feast for the whole lane costs 250 gold. You have ' + fmt(p.gold) + '.';
        continue;
      }
      p.gold -= 250;
      p.violetStage = 4;
      p.marriedTo = 'Violet';
      p.maxhp += 4;
      p.hp = p.maxhp;
      save();
      frame(term, handle, p, 'THE WEDDING', 'A barn, a borrowed fiddle, and every lamp on Rose Lane.');
      put(term, 9, 6, 'The reeve does the reading badly. The cat attends under protest.', 7, 68);
      put(term, 11, 6, 'She keeps your hand the whole evening and does not let go once.', 13, 68);
      put(term, 13, 6, 'Permanent: +4 attack, +3 defense, +4 max health while she is yours.', 10, 70);
      put(term, 15, 6, 'Title earned: THE ROSE\'S OWN', 14, 60);
      footer(term);
      term.gotoxy(17, 2);
      await term.pause('Press any key');
      return 'You are married. The lane will talk about it for a year.';
    }
  }
}

// ---------------------------------------------------------------------- pvp

async function pvp(term, ctx, handle, p, save) {
  const users = doorRoot(ctx).users;
  const me = handle.toLowerCase();
  const rows = [];
  for (const key of Object.keys(users)) {
    if (key === me) continue;
    const rec = normalize(users[key]);
    if (String(rec.handle || '').toLowerCase() === me) continue;  // never list yourself
    if (rec.level < 3) continue;              // a duel needs a reputation
    if (rec.level * 2 < p.level) continue;    // no sport in farming the weak
    rows.push(rec);
  }
  rows.sort((a, b) => b.level - a.level || num(b.gold) - num(a.gold));
  const shown = rows.slice(0, 8);

  frame(term, handle, p, 'THE DUELING STONE', 'Names carved in it, and a few carved out again.');
  put(term, 8, 4, '  CALLER', 8);
  put(term, 8, 28, 'LV', 8);
  put(term, 8, 34, 'PURSE', 8);
  put(term, 8, 48, 'RECORD', 8);
  rule(term, 9, 8);

  if (!shown.length) {
    put(term, 11, 5, 'No one worth fighting is on the rolls right now.', 12, 70);
    put(term, 13, 5, 'Duels open at level 3, and only against callers at least half your rank.', 7, 72);
    footer(term);
    term.gotoxy(16, 2);
    await term.pause('Press any key');
    return '';
  }

  shown.forEach((rec, i) => {
    const letter = String.fromCharCode(65 + i);
    put(term, 10 + i, 4, '(' + letter + ') ' + pad(rec.handle || 'Caller', 20), 15, 24);
    put(term, 10 + i, 28, padL(rec.level, 3), 11);
    put(term, 10 + i, 34, padL(fmt(rec.gold), 9) + ' g', 14, 12);
    put(term, 10 + i, 48, fmt(rec.pvpWins) + 'W / ' + fmt(rec.pvpLosses) + 'L', 7, 18);
  });

  if (rows.length > shown.length) {
    put(term, 18, 4, 'and ' + (rows.length - shown.length) + ' more further down the rolls.', 8, 70);
  }

  put(term, 20, 4, 'The winner takes a share of what the loser is carrying. The bank is safe.', 7, 74);
  footer(term, 'Duelling costs no forest fight. ESC steps back.');
  term.gotoxy(22, 1);

  const valid = shown.map((_, i) => String.fromCharCode(65 + i)).join('');
  const k = await term.menu({ prompt: ' Challenge: ', valid });
  if (k == null || k === 'ESC') return '';
  const idx = k.charCodeAt(0) - 65;
  const foe = shown[idx];
  if (!foe) return '';

  if (foe.level * 2 < p.level) return 'Not worth your steel.';
  if (p.hp < 4) return 'You are too hurt to pick a fight. Heal first.';

  const res = duel(p, foe);
  const rows2 = res.log.slice(-6);

  // Apply the outcome to both records.
  p.hp = Math.max(1, Math.min(p.maxhp, res.ahp));
  foe.hp = Math.max(1, Math.min(foe.maxhp, res.dhp));
  if (res.won) {
    p.pvpWins += 1;
    foe.pvpLosses += 1;
    const take = Math.max(1, Math.floor(foe.gold * (0.15 + Math.random() * 0.15)));
    const real = Math.min(foe.gold, take);
    foe.gold -= real;
    p.gold += real;
    res.take = real;
  } else {
    p.pvpLosses += 1;
    foe.pvpWins += 1;
    const take = Math.max(1, Math.floor(p.gold * (0.15 + Math.random() * 0.15)));
    const real = Math.min(p.gold, take);
    p.gold -= real;
    foe.gold += real;
    res.take = real;
  }
  save();

  frame(term, handle, p, res.won ? 'YOU WIN THE STONE' : 'YOU LOSE THE STONE', 'word travels fast in a town this size');
  let row = 8;
  for (const line of rows2) {
    put(term, row++, 5, line, 7, 70);
  }
  put(term, 16, 5, res.won ? 'You leave ' + foe.handle + ' in the road and take ' + fmt(res.take) + ' gold.' : foe.handle + ' takes ' + fmt(res.take) + ' gold off you and walks away.', res.won ? 14 : 12, 70);
  put(term, 18, 5, 'Record: ' + fmt(p.pvpWins) + ' won / ' + fmt(p.pvpLosses) + ' lost.', 10, 50);
  footer(term);
  term.gotoxy(20, 2);
  await term.pause('Press any key');
  return res.won ? 'You won at the stone. ' + foe.handle + ' will remember it.' : 'You lost at the stone and paid for the lesson.';
}

// Automated duel: stored stats only, defender offline, 14 rounds maximum.
function duel(att, def) {
  const log = [];
  let ahp = Math.max(1, att.hp);
  let dhp = Math.max(1, def.hp);
  const aatk = atkPower(att);
  const adef = defPower(att);
  const datk = atkPower(def);
  const ddef = defPower(def);
  const an = String(att.handle || 'You');
  const dn = String(def.handle || 'the other');
  let round = 0;

  log.push(an + ' and ' + dn + ' meet at the dueling stone.');

  while (ahp > 0 && dhp > 0 && round < 14) {
    round += 1;
    const d1 = Math.max(2, aatk + rnd(5) - Math.round(ddef * 0.4));
    dhp -= d1;
    log.push('Round ' + round + ': ' + an + ' hits for ' + d1 + '.');
    if (dhp <= 0) break;
    const d2 = Math.max(1, datk + rnd(4) - Math.round(adef * 0.4));
    ahp -= d2;
    log.push('Round ' + round + ': ' + dn + ' answers for ' + d2 + '.');
  }

  if (ahp <= 0 && dhp <= 0) {
    // Both down: whoever is standing closer to upright takes it.
    if (ahp > dhp - 1) dhp = 0;
    else ahp = 0;
  }
  return { won: dhp <= 0 && ahp > 0, ahp: Math.max(1, ahp), dhp: Math.max(1, dhp), log };
}

// ------------------------------------------------------------------- combat

function makeMonster(p) {
  const lo = Math.max(1, p.level - 3);
  const hi = p.level + 2;
  const pool = MONSTERS.filter((m) => m.lvl >= lo && m.lvl <= hi);
  const base = pick(pool.length ? pool : [MONSTERS[0]]);
  const bump = Math.max(0, p.level - base.lvl);
  const hp = base.hp + bump * 3;
  return {
    name: base.name,
    lvl: base.lvl,
    hp,
    maxhp: hp,
    atk: base.atk + Math.floor(p.level / 2),
    def: base.def,
    exp: base.exp + p.level * 6,
    gold: base.gold + p.level * 3,
    art: base.art,
    taunt: base.taunt,
    boss: false,
  };
}

function makeDragon(p) {
  const hp = 260 + p.level * 7;
  return {
    name: 'THE RED DRAGON',
    lvl: p.level + 3,
    hp,
    maxhp: hp,
    atk: 30 + Math.floor(p.level / 2),
    def: 9,
    exp: 400,
    gold: 600,
    art: DRAGON_FIGHT_ART,
    taunt: 'The crag shifts. Something the colour of a forge opens one eye.',
    boss: true,
  };
}

function drawBars(term, p, m) {
  const foeColor = m.hp / m.maxhp < 0.34 ? 10 : 12;
  put(term, 15, 3, 'FOE', 12);
  put(term, 15, 7, '[' + bar(m.hp, m.maxhp, 28) + ']', foeColor, 30);
  put(term, 15, 38, pad(String(Math.max(0, m.hp)) + '/' + m.maxhp, 12), foeColor, 12);
  put(term, 16, 3, 'YOU', 10);
  put(term, 16, 7, '[' + bar(p.hp, p.maxhp, 28) + ']', p.hp / p.maxhp < 0.34 ? 12 : 10, 30);
  put(term, 16, 38, pad(String(Math.max(0, p.hp)) + '/' + p.maxhp, 12), 7, 12);
}

function drawLog(term, log) {
  const lines = [];
  for (const entry of log) {
    for (const line of wrapAt(term, entry, 70)) lines.push(line);
  }
  const tail = lines.slice(-4);
  while (tail.length < 4) tail.unshift('');
  tail.forEach((line, i) => put(term, 18 + i, 4, pad(line, 70), i === tail.length - 1 ? 15 : 7, 70));
}

function drawFight(term, handle, p, m, log) {
  term.cls();
  hud(term, handle, p);
  ctr(term, 6, m.name, m.boss ? 12 : 14);
  ctr(term, 7, m.taunt, 8);
  let row = 8;
  for (const line of m.art) ctr(term, row++, line, m.boss ? 12 : 9);
  rule(term, 14, 8);
  drawBars(term, p, m);
  rule(term, 17, 8);
  drawLog(term, log);
  put(term, 25, 2, 'A attacks. D guards and recovers. R or ESC runs.', 8, 76);
}

function updateFight(term, p, m, log) {
  drawBars(term, p, m);
  drawLog(term, log);
}

function hitFoe(p, m) {
  const crit = Math.random() < 0.1;
  let dmg = atkPower(p) + rnd(5) - Math.floor(m.def / 2);
  dmg = Math.max(2, dmg);
  if (crit) dmg = Math.round(dmg * 1.8);
  return { dmg, crit };
}

function hitPlayer(p, m, guarding) {
  let dmg = m.atk + rnd(3) - Math.round(defPower(p) * 0.55);
  dmg = Math.max(1, dmg);
  if (guarding) dmg = Math.max(1, Math.round(dmg * 0.45));
  return dmg;
}

async function fight(term, handle, p, m, save) {
  const log = [m.taunt];
  drawFight(term, handle, p, m, log);

  for (;;) {
    clearRows(term, 22, 23);
    term.gotoxy(23, 3);
    const k = await term.menu({ prompt: ' (A)ttack   (D)efend   (R)un : ', valid: 'ADR' });
    clearRows(term, 22, 23);
    if (k == null) return 'timeout';

    if (k === 'ESC' || k === 'R') {
      const chance = Math.max(15, Math.min(85, 45 + p.level * 4 - m.lvl * 3));
      if (m.boss && Math.random() < 0.25) {
        log.push('The wyrm spreads a wing. There is nowhere on this crag to run to.');
        updateFight(term, p, m, log);
        continue;
      }
      if (rnd(100) <= chance) {
        log.push('You break away and run for the treeline.');
        updateFight(term, p, m, log);
        term.gotoxy(23, 3);
        await term.pause('Press any key');
        return 'fled';
      }
      log.push('You turn to run \u2014 ' + m.name + ' cuts you off!');
      const back = Math.max(1, m.atk + rnd(2) - Math.round(defPower(p) * 0.55));
      p.hp -= back;
      log.push('It strikes your back for ' + back + '.');
      if (p.hp <= 0) return death(term, handle, p, save, m);
      save();
      updateFight(term, p, m, log);
      continue;
    }

    if (k === 'A') {
      const hit = hitFoe(p, m);
      m.hp -= hit.dmg;
      log.push(hit.crit ? 'CRITICAL \u2014 you open ' + m.name + ' for ' + hit.dmg + '!' : 'You strike ' + m.name + ' for ' + hit.dmg + '.');
    } else {
      log.push('You set your guard and wait for an opening.');
    }

    if (m.hp <= 0) return victory(term, handle, p, m, save);

    const md = hitPlayer(p, m, k === 'D');
    p.hp -= md;
    log.push(m.name + ' hits you for ' + md + '.');
    if (k === 'D') {
      const heal = 1 + rnd(3);
      p.hp = Math.min(p.maxhp, p.hp + heal);
      log.push('You catch your breath (+' + heal + ' hp).');
    }
    if (p.hp <= 0) return death(term, handle, p, save, m);
    save();
    updateFight(term, p, m, log);
  }
}

async function victory(term, handle, p, m, save) {
  p.kills += 1;
  p.gold += m.gold;
  const gem = m.boss || Math.random() < 0.1;
  if (gem) p.gems += m.boss ? 5 : 1;
  const ups = awardExp(p, m.exp);
  if (m.boss) {
    p.dragonSlain = true;
    p.maxhp += 8;
    p.hp = p.maxhp;
  }
  save();

  term.cls();
  hud(term, handle, p);
  rule(term, 3, 8);
  ctr(term, 6, m.boss ? 'THE DRAGON FALLS' : 'VICTORY', m.boss ? 14 : 10);
  ctr(term, 8, m.boss ? 'The Red Dragon comes down off the crag and does not get up.' : m.name + ' lies still.', 15);

  put(term, 11, 10, 'Experience', 8);
  put(term, 11, 32, '+' + fmt(m.exp), 14);
  put(term, 12, 10, 'Gold', 8);
  put(term, 12, 32, '+' + fmt(m.gold), 14);
  if (gem) {
    put(term, 13, 10, 'Gems', 8);
    put(term, 13, 32, '+' + (m.boss ? 5 : 1), 13);
  }
  let row = 15;
  for (const line of ups) {
    if (row > 19) break;
    put(term, row++, 10, line, 11, 68);
  }
  if (m.boss) {
    put(term, row, 10, 'The purse is yours. Dunhaven will argue about the details for years.', 13, 68);
    put(term, row + 1, 10, 'Permanent: +8 max health. Title: DRAGONSBANE.', 10, 68);
  } else if (!ups.length) {
    put(term, 15, 10, 'You bind the wound and take stock.', 7, 68);
  }
  footer(term);
  term.gotoxy(21, 2);
  await term.pause('Press any key');
  return m.boss ? 'The Red Dragon is dead. The mountain is quiet.' : 'win';
}

async function death(term, handle, p, save, m) {
  const lost = Math.floor(p.gold / 2);
  p.gold -= lost;
  p.exp = Math.floor(p.exp * 0.9);
  p.hp = 1;
  p.deaths += 1;
  save();

  term.cls();
  hud(term, handle, p);
  rule(term, 3, 8);
  ctr(term, 7, 'YOU HAVE FALLEN', 12);
  ctr(term, 9, m.name + ' stands over you and then loses interest.', 7);
  ctr(term, 11, 'Cold water. A cart. The bell at Dunhaven.', 15);

  put(term, 14, 10, 'Lost to the road', 8);
  put(term, 14, 32, fmt(lost) + ' gold', 12);
  put(term, 15, 10, 'Scattered wit', 8);
  put(term, 15, 32, '10% of your experience', 12);
  put(term, 16, 10, 'You wake at the healer with 1 hp and your weapon still in hand.', 10, 68);
  put(term, 18, 10, 'Banked gold is untouched. Bank more of it.', 8, 68);
  footer(term);
  term.gotoxy(20, 2);
  await term.pause('Press any key');
  return 'They carried you back from the forest.';
}

// ------------------------------------------------------------------- forest

async function forest(term, handle, p, save) {
  if (p.master) return lair(term, handle, p, save);
  return hunt(term, handle, p, save);
}

async function hunt(term, handle, p, save) {
  if (p.fightsLeft <= 0) {
    frame(term, handle, p, 'THE FOREST IS CLOSED TO YOU', 'The sun is down and the gate is barred.');
    put(term, 9, 5, 'You have used every fight today. Sleep, and the forest will be there tomorrow.', 12, 70);
    put(term, 11, 5, 'Fights reset at local midnight: ' + fightsForLevel(p.level) + ' for a caller of your rank.', 7, 70);
    footer(term);
    term.gotoxy(14, 2);
    await term.pause('Press any key');
    return 'You are out of fights until tomorrow.';
  }

  frame(term, handle, p, 'THE FOREST EDGE', 'Beyond the fence the trees close ranks.');
  put(term, 9, 6, 'The foresters mark the trails with white stones. The stones', 7, 70);
  put(term, 10, 6, 'keep moving further in, which nobody likes to talk about.', 7, 70);
  put(term, 12, 6, 'Fights left today: ' + p.fightsLeft + ' / ' + fightsForLevel(p.level), 11, 50);
  put(term, 14, 6, 'You have ' + fmt(p.gold) + ' gold carried and ' + fmt(p.bank) + ' banked.', 10, 70);
  put(term, 16, 6, pick(RUMORS), 8, 70);
  footer(term, 'ESC turns back for the square.');
  term.gotoxy(19, 6);

  const yn = await term.yesno('Step into the trees?', true);
  if (!yn) return '';

  p.fightsLeft -= 1;
  save();

  const m = makeMonster(p);
  const res = await fight(term, handle, p, m, save);
  save();
  if (res === 'dead') return 'They carried you back from the forest.';
  if (res === 'fled') return 'You ran. The forest keeps what it caught.';
  if (res === 'timeout') return '';
  return '';
}

async function lair(term, handle, p, save) {
  const today = todayKey();
  const tried = p.dragonDay === today;
  const canTry = !tried && p.fightsLeft > 0;

  frame(term, handle, p, 'THE CRAG ABOVE DUNHAVEN', 'Where the road gives up.');
  let row = 8;
  for (const line of DRAGON_FIGHT_ART) put(term, row++, 27, line, p.dragonSlain ? 8 : 12, 44);

  if (p.dragonSlain) {
    put(term, 16, 6, 'The crag is cold and empty. The bones are still up there,', 7, 68);
    put(term, 17, 6, 'and children dare each other to go and look at them.', 7, 68);
    footer(term, 'You can still hunt the forest below.');
    term.gotoxy(19, 6);
    const yn = await term.yesno('Hunt the forest below?', true);
    if (!yn) return '';
    return hunt(term, handle, p, save);
  }

  put(term, 16, 6, 'The crag breathes. One climb a day, and a climb costs a hunt.', 13, 70);
  put(term, 17, 6, tried
    ? 'You have already climbed today. Come back at dawn.'
    : p.fightsLeft <= 0
      ? 'No daylight left for the climb. The crag will wait.'
      : 'Fights left today: ' + p.fightsLeft + '. Steel, mail, and a full skin of courage.', tried ? 12 : 10, 70);
  footer(term, 'ESC returns to the square. H hunts the forest instead.');

  if (!canTry) {
    if (p.fightsLeft <= 0) {
      term.gotoxy(19, 6);
      await term.pause('Press any key');
      return '';
    }
    term.gotoxy(19, 6);
    const yn = await term.yesno('Hunt the forest below instead?', true);
    if (!yn) return '';
    return hunt(term, handle, p, save);
  }

  term.gotoxy(19, 6);
  const key = await term.menu({ prompt: ' (C)hallenge the wyrm  (H)unt below  [ESC] Back : ', valid: 'CH' });
  if (key == null || key === 'ESC') return '';
  if (key === 'H') return hunt(term, handle, p, save);

  const yn = await term.yesno('Climb, and do not come down until it is finished?', false);
  if (!yn) return '';
  p.dragonDay = today;
  p.fightsLeft = Math.max(0, p.fightsLeft - 1);
  save();
  const m = makeDragon(p);
  await fight(term, handle, p, m, save);
  save();
  return '';
}

// ---------------------------------------------------------------------- run

module.exports = {
  id: DOOR_ID,
  name: GAME_NAME,
  author: 'Gate Software',
  category: 'RPG',
  description: 'Legend of the Red Dragon: daily forest fights, a bank that pays, a girl on Rose Lane, and the wyrm on the crag.',
  minLevel: 10,

  async run(term, ctx) {
    const handle = String((ctx.user && ctx.user.handle) || 'Caller').slice(0, 24);

    if ((term.cols || 80) < 80 || (term.rows || 25) < 25) {
      term.cls();
      put(term, 2, 2, 'This door plays in 80 columns by 25 rows.', 15, 76);
      put(term, 4, 2, 'Set your client to 80x25 and call again.', 7, 76);
      term.gotoxy(6, 2);
      await term.pause('Press any key');
      return;
    }

    const users = doorRoot(ctx).users;
    const key = handle.toLowerCase();

    let p = users[key];
    let isNew = false;
    if (!p || typeof p !== 'object') {
      p = freshRecord(handle);
      users[key] = p;
      isNew = true;
    }
    normalize(p);
    p.handle = handle;

    const rolled = rollDay(p);
    normalize(p);

    const save = () => {
      try {
        ctx.save();
      } catch {
        /* a failed save must never kill the caller's game */
      }
    };
    save();

    await titleScreen(term, handle, p);

    if (isNew || !p.seenIntro) {
      await introScreen(term, handle, p);
      p.seenIntro = true;
      save();
    }

    let notice = '';
    if (rolled && !isNew) {
      notice = 'A new day. Fights restored' + (rolled.interest ? ', bank paid ' + fmt(rolled.interest) + ' gold.' : '.');
    } else if (isNew) {
      notice = 'New in town. The forest edge is south of the well.';
    }

    const why = await town(term, ctx, handle, p, save, notice);

    term.cls();
    hud(term, handle, p);
    rule(term, 3, 8);
    ctr(term, 8, 'YOU LEAVE THE ROAD', 11);
    ctr(term, 10, 'Level ' + p.level + '  \u00b7  ' + fmt(p.kills) + ' slain  \u00b7  ' + fmt(p.gold) + ' gold carried  \u00b7  ' + fmt(p.bank) + ' banked', 15);
    ctr(term, 12, titleFor(p) || 'Dunhaven will remember you as a face at the well.', 13);
    ctr(term, 14, 'Your record is written down. The mountain waits either way.', 7);
    footer(term);
    term.gotoxy(18, 2);
    await term.pause('Press any key');
    if (why === 'timeout') return;
  },
};
