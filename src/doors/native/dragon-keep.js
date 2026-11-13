'use strict';
/*
 * DRAGON'S KEEP — a native door for The Gate BBS.
 * Original content. 80x25 ANSI, keyboard only, no dependencies.
 *
 * State lives at ctx.db.data.doors['dragon-keep'].users[handle].
 * Every meaningful change calls ctx.save().
 */

const TURNS_PER_DAY = 12;
const DAY_MS = 86400000;
const DOOR_ID = 'dragon-keep';
const MAX_LEVEL = 30;

const WEAPONS = [
  { name: 'Bare Fists', power: 0, cost: 0 },
  { name: 'Rusty Shortsword', power: 3, cost: 25 },
  { name: 'Iron Mace', power: 6, cost: 90 },
  { name: 'Ash Longbow', power: 9, cost: 220 },
  { name: 'Silver Warhammer', power: 13, cost: 480 },
  { name: 'Runed Greatsword', power: 18, cost: 950 },
  { name: 'Blade of the Dawn', power: 24, cost: 1800 },
];

const ARMOR = [
  { name: 'Rags', def: 0, cost: 0 },
  { name: 'Leather Jerkin', def: 2, cost: 30 },
  { name: 'Chain Mail', def: 4, cost: 110 },
  { name: 'Scale Hauberk', def: 7, cost: 260 },
  { name: 'Plate Harness', def: 10, cost: 560 },
  { name: 'Dragonhide Coat', def: 14, cost: 1100 },
];

const MONSTERS = [
  {
    name: 'Field Rat', lvl: 1, hp: 6, dmg: 2, exp: 6, gold: 4,
    taunt: 'A field rat bares yellow teeth at your boots.',
    art: ['  /\\  /\\', ' ( o.o )__', '  > ^ <  \\', '   |   |'],
  },
  {
    name: 'Cave Bat', lvl: 1, hp: 7, dmg: 3, exp: 7, gold: 5,
    taunt: 'A cave bat drops from the dark and shrieks.',
    art: [' /\\   /\\', '/  \\_/  \\', '\\  o o  /', ' \\  ^  /', '  \\/ \\/'],
  },
  {
    name: 'Rabid Fox', lvl: 2, hp: 10, dmg: 3, exp: 9, gold: 7,
    taunt: 'A rabid fox circles, low and growling.',
    art: ['  /\\_/\\', ' ( o.o )___', '  > ^ <    \\', '  /|   |\\'],
  },
  {
    name: 'Goblin Scavenger', lvl: 2, hp: 13, dmg: 4, exp: 12, gold: 10,
    taunt: 'A goblin scavenger grins through broken teeth.',
    art: ['  ______', ' / o  o \\', ' |   ^  |', " \\  '-' /", '  /|  |\\'],
  },
  {
    name: 'Road Bandit', lvl: 3, hp: 16, dmg: 5, exp: 16, gold: 16,
    taunt: 'A road bandit draws a notched blade. "Purse or blood."',
    art: ['  ______', ' /      \\', ' | o  o |', ' |  --  |', ' /|____|\\'],
  },
  {
    name: 'Bog Lurker', lvl: 4, hp: 20, dmg: 6, exp: 20, gold: 20,
    taunt: 'Something wet stands up out of the bog.',
    art: [' ~~~~~~~~~', '( o     o )', '(    ^    )', ' \\_______/'],
  },
  {
    name: 'Skeleton Archer', lvl: 5, hp: 24, dmg: 8, exp: 26, gold: 24,
    taunt: 'A skeleton archer nocks a splintered arrow.',
    art: ['  ______', ' / o  o \\', ' | ==== |', ' | /|\\ |', '  / | \\'],
  },
  {
    name: 'Orc Raider', lvl: 6, hp: 30, dmg: 9, exp: 34, gold: 32,
    taunt: 'An orc raider slaps the flat of his axe.',
    art: [' ,------,', ' | o  o |', ' |  >>  |', " '--v---'", '  /|  |\\'],
  },
  {
    name: 'Wyvern Whelp', lvl: 8, hp: 38, dmg: 11, exp: 48, gold: 50,
    taunt: 'A wyvern whelp lands heavily and bares its teeth.',
    art: ['   /\\     /\\', '  /  \\___/  \\', ' ( o       o )', '  \\   /\\   /', '   \\_/  \\_/'],
  },
  {
    name: 'Troll Brute', lvl: 10, hp: 50, dmg: 14, exp: 65, gold: 70,
    taunt: 'A troll brute cracks a knuckle the size of your head.',
    art: ['  ______', ' / o  o \\', ' |   ^  |', ' | ==== |', '/|      |\\'],
  },
];

const CASTLE = [
  '       ▄              █  █  █  █                 ▄',
  '      ▄▄▄             ████████████              ▄▄▄',
  '   ██▄▄▄▄▄█           ████████████           ██▄▄▄▄▄█',
  '   ██▓▓████           ██▓▓████▓▓██           ██▓▓████',
  '   █████████  ██  ██  ██████████████  ██  ██ ████████',
  '   ███████████████████████▓▓▓▓███████████████████████',
  '   ██████████████████████████████████████████████████',
];

const TOWN = [
  '     ▄▄            ▄▄          ▄▄',
  '  ▄▄▄▄▄▄▄▄      ▄▄▄▄▄▄▄▄    ▄▄▄▄▄▄▄▄',
  ' ███████████  █████████████ █████████',
  ' █▓▓█████▓▓█  █▓▓███████▓▓█ █▓▓███▓▓█',
  ' ███████████  █████████████ █████████',
  ' ████▓▓█████  █████▓▓██████ ███▓▓████',
  '▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄',
];

const DRAGON_ART = [
  '        /\\                    /\\',
  '       /  \\__              __/  \\',
  '      /      \\__        __/      \\',
  '     |   /\\     \\______/     /\\   |',
  '     |  /  \\____/  \\  / \\____/  \\  |',
  '     |  \\  / o  \\  /\\/\\  /  o \\  /  |',
  '      \\  \\/   \\  \\/  \\/  /   \\/  /  /',
  '       \\__    /  /\\  /\\  \\    __/',
  '          \\__/__/  \\/  \\__\\__/',
];

// Compact head used in the fight screen (6 rows, so the hp bars stay clear).
const DRAGON_FIGHT_ART = [
  '    /\\                  /\\',
  '   /  \\__            __/  \\',
  '  /      \\__      __/      \\',
  ' |   /\\    \\____/    /\\   |',
  ' |  /  \\__/ o    o \\__/  \\  |',
  '  \\_/    \\_/  \\__/  \\_/    \\_/',
];

const RUMORS = [
  'The wyrm took the miller\'s son. Nobody says his name now.',
  'Bank your gold, friend. The Keep takes everything else.',
  'A knight went up at dawn. Only his shield came back.',
  'Twelve turns of the sun a day. No more, no less.',
  'Buy iron before you buy courage. Iron is cheaper.',
  'Ten percent a day in the strongbox. The gnome pays on time.',
  'The wardens at the Keep turn back anyone under the fourth rank.',
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

function expNeed(level) {
  return Math.round(50 * Math.pow(1.55, level - 1));
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

// ------------------------------------------------------------------- state

function doorRoot(ctx) {
  const data = ctx.db.data;
  if (!data.doors || typeof data.doors !== 'object') data.doors = {};
  const door = data.doors[DOOR_ID];
  if (!door || typeof door !== 'object') data.doors[DOOR_ID] = { users: {} };
  if (!data.doors[DOOR_ID].users || typeof data.doors[DOOR_ID].users !== 'object') {
    data.doors[DOOR_ID].users = {};
  }
  return data.doors[DOOR_ID];
}

function freshRecord() {
  return {
    level: 1,
    exp: 0,
    gold: 60,
    hp: 20,
    maxhp: 20,
    weapon: 0,
    armor: 0,
    banked: 0,
    turns: TURNS_PER_DAY,
    lastTurnDay: todayKey(),
    kills: 0,
    gems: 0,
    pvpWins: 0,
    seenIntro: false,
  };
}

function normalize(p) {
  p.level = clampInt(p.level, 1, MAX_LEVEL, 1);
  p.exp = Math.max(0, Math.floor(num(p.exp)));
  p.gold = Math.max(0, Math.floor(num(p.gold)));
  p.maxhp = clampInt(p.maxhp, 10, 9999, 20);
  p.hp = clampInt(p.hp, 0, p.maxhp, p.maxhp);
  p.weapon = clampInt(p.weapon, 0, WEAPONS.length - 1, 0);
  p.armor = clampInt(p.armor, 0, ARMOR.length - 1, 0);
  p.banked = Math.max(0, Math.floor(num(p.banked)));
  p.turns = clampInt(p.turns, 0, TURNS_PER_DAY, TURNS_PER_DAY);
  p.kills = Math.max(0, Math.floor(num(p.kills)));
  p.gems = Math.max(0, Math.floor(num(p.gems)));
  p.pvpWins = Math.max(0, Math.floor(num(p.pvpWins)));
  p.seenIntro = !!p.seenIntro;
  if (typeof p.lastTurnDay !== 'string' || !p.lastTurnDay) p.lastTurnDay = todayKey();
}

// Roll the day: restores turns, compounds bank interest at 10% per day.
function rollDay(p) {
  const today = todayKey();
  if (p.lastTurnDay === today) return false;
  const days = Math.max(1, daysBetween(p.lastTurnDay, today));
  if (p.banked > 0) {
    let b = p.banked;
    for (let i = 0; i < Math.min(days, 30); i++) b = Math.floor(b * 1.1);
    p.banked = b;
  }
  p.turns = TURNS_PER_DAY;
  p.lastTurnDay = today;
  return true;
}

function awardExp(p, amount) {
  const ups = [];
  p.exp += Math.max(0, Math.floor(amount));
  while (p.level < MAX_LEVEL && p.exp >= expNeed(p.level)) {
    p.exp -= expNeed(p.level);
    p.level += 1;
    const gain = 3 + rnd(4);
    p.maxhp += gain;
    p.hp = p.maxhp;
    ups.push(`You reach level ${p.level}!  +${gain} max hp, wounds closed.`);
  }
  return ups;
}

// ----------------------------------------------------------------- drawing

function hud(term, handle, p) {
  const W = Math.min(term.cols || 80, 80);
  term.print(1, 1, ' '.repeat(W), 15, 1);
  term.print(1, 2, "DRAGON'S KEEP", 15, 1);
  const right = 'THE GATE BBS';
  term.print(1, Math.max(1, W - right.length - 1), right, 11, 1);
  term.print(2, 1, ' '.repeat(W), 7);
  const low = p.hp <= Math.max(1, Math.floor(p.maxhp * 0.34));
  const parts = [
    [' ' + String(handle).slice(0, 14) + ' ', 15],
    [' Lv ' + p.level + ' ', 11],
    [' HP ' + p.hp + '/' + p.maxhp + ' ', low ? 12 : 10],
    [' Gold ' + fmt(p.gold) + ' ', 14],
    [' Bank ' + fmt(p.banked) + ' ', 14],
    [' Turns ' + p.turns + '/' + TURNS_PER_DAY + ' ', p.turns > 0 ? 11 : 8],
  ];
  let col = 1;
  for (const [txt, fg] of parts) {
    if (col + txt.length - 1 > W) break;
    term.print(2, col, txt, fg);
    col += txt.length + 1;
  }
  term.print(3, 1, '─'.repeat(W), 8);
}

function frame(term, handle, p, title, subtitle) {
  term.cls();
  hud(term, handle, p);
  if (title) term.center(5, title, 14);
  if (subtitle) term.center(6, subtitle, 8);
  term.print(25, 1, ' '.repeat(Math.min(term.cols, 80)), 7);
}

function say(term, row, text, color, width) {
  const w = width || Math.min(74, (term.cols || 80) - 6);
  let r = row;
  for (const line of term.wrap(text, w)) {
    term.print(r, 4, line, color == null ? 7 : color);
    r += 1;
  }
  return r;
}

async function note(term, msg, color) {
  term.print(23, 1, ' '.repeat(Math.min(term.cols, 80)), 7);
  term.print(23, 2, String(msg).slice(0, Math.min(76, (term.cols || 80) - 4)), color == null ? 14 : color);
  await term.pause('Press any key');
}

// ----------------------------------------------------------------- screens

async function titleScreen(term, handle) {
  term.cls();
  const W = Math.min(term.cols || 80, 80);
  term.print(2, 1, ' '.repeat(W), 15, 1);
  term.center(2, 'THE GATE BBS   ·   NODE 1   ·   14400 BAUD', 15, 1);
  term.print(4, 1, '─'.repeat(W), 8);
  let row = 6;
  for (const line of CASTLE) term.center(row++, line, 11);
  term.center(15, "D R A G O N ' S   K E E P", 14);
  term.center(16, 'a legend of sword and scale', 7);
  term.print(18, 1, '─'.repeat(W), 8);
  term.center(19, 'Hunt the crags.  Bank your gold.  Face the wyrm.', 15);
  term.print(21, 2, 'Caller: ' + String(handle).slice(0, 24), 8);
  term.gotoxy(22, 1);
  await term.pause(' Press any key to enter the realm');
}

async function introScreen(term, handle, p) {
  const pages = [
    [
      'Beyond the last fence of Emberford the road climbs into slate and mist,',
      'and at the top of the road sits the Keep: a black tooth of stone that has',
      'outlived four kings and every knight who went up to it.',
    ],
    [
      'Three nights ago the wyrm Vharzul woke. The mill burned. The well turned',
      'to steam. The aldermen have posted a purse, and every sellsword for thirty',
      'miles is drinking in the tavern and eyeing the hill.',
    ],
    [
      'You have a rusted blade, sixty gold, and twelve turns of daylight.',
      'The rest is up to you.',
      '',
      'Pick letters to choose. ESC backs out of any screen. Q leaves the game.',
    ],
  ];
  for (let i = 0; i < pages.length; i++) {
    frame(term, handle, p, 'THE LEGEND', `page ${i + 1} of ${pages.length}`);
    let r = 9;
    for (const line of pages[i]) {
      term.print(r++, 6, line, i === 2 && r > 12 ? 10 : 7);
    }
    term.print(20, 6, i < pages.length - 1 ? '-- more --' : 'The gate creaks open.', 11);
    await term.pause(i < pages.length - 1 ? 'Press any key' : 'Press any key to begin');
  }
}

function drawTown(term, handle, p, notice) {
  term.cls();
  hud(term, handle, p);

  term.box(2, 5, 46, 15, { fg: 8 });
  term.print(5, 5, '┤ EMBERFORD ├', 11);

  let row = 6;
  for (const line of TOWN) term.print(row++, 4, line, 9);

  term.print(13, 4, 'Woodsmoke, wet wool, and a dog', 7);
  term.print(14, 4, 'barking at the dark.', 7);
  term.print(15, 4, 'Above the village the crags glow.', 7);
  const rumour = pick(RUMORS);
  const wrapped = term.wrap('* ' + rumour, 40);
  wrapped.slice(0, 2).forEach((l, i) => term.print(17 + i, 4, l, 13));

  term.box(49, 5, 31, 15, { fg: 8 });
  term.print(5, 51, '┤ THE SQUARE ├', 11);
  const menu = [
    ['  (F)orest .... Hunt beasts', 15],
    ['  (S)hop ...... Arms & mail', 15],
    ['  (B)ank ...... Guard gold', 15],
    ['  (I)nn ....... Heal up', 15],
    ['  (D)ragon K... The wyrm', p.level >= 4 ? 12 : 8],
    ['  (H)ealer .... Your legend', 15],
    ['  (Q)uit ...... Leave', 15],
  ];
  menu.forEach(([txt, fg], i) => term.print(8 + i, 50, txt, fg));
  term.print(17, 51, `Turns left today: ${padL(p.turns, 2)}`, p.turns ? 11 : 12);
  term.print(18, 51, `Purse: ${fmt(p.gold)} gold`, 14);

  term.print(21, 2, 'Fight, shop, bank, rest, or climb to the Keep.', 8);
  term.print(22, 2, notice || '', 10);
  term.print(25, 2, 'ESC backs out  ·  Q leaves the game', 8);
  term.gotoxy(24, 2);
}

async function town(term, ctx, handle, p, save, noticeIn) {
  let notice = noticeIn || '';
  for (;;) {
    drawTown(term, handle, p, notice);
    notice = '';
    const k = await term.menu({ prompt: ' Command: ', valid: 'FSBIDHQ' });
    if (k == null) return;
    if (k === 'ESC') continue;
    if (k === 'Q') return;
    if (k === 'F') notice = await forest(term, handle, p, save);
    else if (k === 'S') await shop(term, handle, p, save);
    else if (k === 'B') await bank(term, handle, p, save);
    else if (k === 'I') await inn(term, handle, p, save);
    else if (k === 'H') await statusScreen(term, handle, p);
    else if (k === 'D') notice = await keep(term, handle, p, save);
  }
}

// ---------------------------------------------------------------- the shop

async function shop(term, handle, p, save) {
  let tab = 'weapon';
  for (;;) {
    const list = tab === 'weapon' ? WEAPONS : ARMOR;
    const cur = tab === 'weapon' ? p.weapon : p.armor;
    frame(
      term,
      handle,
      p,
      tab === 'weapon' ? "GLYNN'S SMITHY" : 'THE TANNER & ARMOURER',
      tab === 'weapon' ? 'Steel for the hand. No refunds.' : 'Hide and iron for the ribs.'
    );
    term.print(8, 4, '#', 8);
    term.print(8, 8, tab === 'weapon' ? 'WEAPON' : 'ARMOUR', 8);
    term.print(8, 32, tab === 'weapon' ? 'POW' : 'DEF', 8);
    term.print(8, 39, 'COST', 8);

    list.forEach((it, i) => {
      const equipped = i === cur;
      const fg = equipped ? 15 : i < cur ? 8 : 7;
      if (i > 0) term.print(9 + i, 4, String(i), 11);
      term.print(9 + i, 6, equipped ? '>' : ' ', 10);
      term.print(9 + i, 8, pad(it.name, 23), fg);
      term.print(9 + i, 32, padL(tab === 'weapon' ? it.power : it.def, 3), 14);
      term.print(9 + i, 39, i === 0 ? '   ---' : padL(fmt(it.cost), 6), 14);
    });

    term.print(17, 3, 'Equipped: ' + (tab === 'weapon' ? WEAPONS[p.weapon].name : ARMOR[p.armor].name), 11);
    term.print(19, 3, 'Purse: ' + fmt(p.gold) + ' gold', 14);
    term.print(21, 3, '[#] Buy    [' + (tab === 'weapon' ? 'A' : 'W') + '] ' + (tab === 'weapon' ? 'Armour' : 'Weapons') + '    [ESC] Leave', 10);
    term.print(25, 2, 'Higher numbers hit harder and turn more blades.', 8);
    term.gotoxy(23, 1);

    const k = await term.menu({ prompt: ' Choice: ', valid: '1234567AW' });
    if (k == null || k === 'ESC') return;
    if (k === 'A') {
      tab = 'armor';
      continue;
    }
    if (k === 'W') {
      tab = 'weapon';
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
      await note(term, 'You cannot afford that. Come back with gold.', 12);
      continue;
    }
    p.gold -= it.cost;
    if (tab === 'weapon') p.weapon = idx;
    else p.armor = idx;
    save();
    await note(term, `You buy the ${it.name} for ${it.cost} gold.`, 10);
  }
}

// ---------------------------------------------------------------- the bank

async function readNumber(term, prompt, maxDigits) {
  term.write(prompt);
  let v = '';
  for (;;) {
    const k = await term.readKey({ timeoutMs: 300000 });
    if (k == null) return null;
    if (k === 'ESC') {
      term.write('\r\n');
      return null;
    }
    if (k === 'ENTER') {
      term.write('\r\n');
      return v.length ? Number(v) : 0;
    }
    if (/^[0-9]$/.test(k)) {
      if (v.length < maxDigits) {
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

async function bank(term, handle, p, save) {
  for (;;) {
    frame(term, handle, p, 'THE EMBERFORD STRONGBOX', 'Ten percent a day, compounded. The gnome is honest. Mostly.');
    term.print(9, 6, 'On hand', 8);
    term.print(9, 24, fmt(p.gold) + ' gold', 14);
    term.print(11, 6, 'Banked', 8);
    term.print(11, 24, fmt(p.banked) + ' gold', 11);
    term.print(13, 6, 'Interest at dawn', 8);
    term.print(13, 24, fmt(Math.floor(p.banked * 1.1) - p.banked) + ' gold', 10);
    term.print(16, 5, 'Gold in the strongbox cannot be taken from you in the field.', 7);
    term.print(18, 5, '(D)eposit    (W)ithdraw    [ESC] Back', 15);
    term.print(25, 2, 'One deposit, one sleep, ten percent.', 8);
    term.gotoxy(20, 1);

    const k = await term.menu({ prompt: ' Choice: ', valid: 'DW' });
    if (k == null || k === 'ESC') return;

    if (k === 'D') {
      if (p.gold <= 0) {
        await note(term, 'Your purse is empty.', 12);
        continue;
      }
      const amt = await readNumber(term, ` Deposit how much (have ${p.gold})? `, 7);
      if (amt == null) continue;
      const real = Math.max(0, Math.min(p.gold, Math.floor(amt)));
      if (!real) {
        await note(term, 'Nothing deposited.', 12);
        continue;
      }
      p.gold -= real;
      p.banked += real;
      save();
      await note(term, `The gnome locks away ${fmt(real)} gold.`, 10);
    } else {
      if (p.banked <= 0) {
        await note(term, 'The strongbox is empty.', 12);
        continue;
      }
      const amt = await readNumber(term, ` Withdraw how much (have ${p.banked})? `, 7);
      if (amt == null) continue;
      const real = Math.max(0, Math.min(p.banked, Math.floor(amt)));
      if (!real) {
        await note(term, 'Nothing withdrawn.', 12);
        continue;
      }
      p.banked -= real;
      p.gold += real;
      save();
      await note(term, `The gnome counts out ${fmt(real)} gold.`, 10);
    }
  }
}

// ----------------------------------------------------------------- the inn

async function inn(term, handle, p, save) {
  const missing = p.maxhp - p.hp;
  const cost = Math.max(5, missing * 2);
  frame(term, handle, p, 'THE CROOKED LANTERN', 'Beds, stew, and a poultice that stings.');
  term.print(9, 5, 'The innkeeper looks at your wounds and names a price.', 7);
  term.print(11, 5, 'Missing health', 8);
  term.print(11, 28, String(missing), 12);
  term.print(12, 5, 'Cost to be made whole', 8);
  term.print(12, 28, fmt(cost) + ' gold', 14);
  term.print(15, 5, 'You have ' + fmt(p.gold) + ' gold on hand.', 7);

  if (missing <= 0) {
    term.print(18, 5, 'You are already whole. Go find trouble.', 10);
    await term.pause('Press any key');
    return;
  }
  if (p.gold < cost) {
    term.print(18, 5, 'You cannot afford a bed tonight.', 12);
    await term.pause('Press any key');
    return;
  }
  term.gotoxy(18, 5);
  const yn = await term.yesno(`Pay ${cost} gold for a night's rest?`, true);
  if (!yn) return;
  p.gold -= cost;
  p.hp = p.maxhp;
  save();
  frame(term, handle, p, 'REST', null);
  term.print(9, 6, 'You sleep like the dead and wake like the living.', 10);
  term.print(11, 6, 'Your wounds are closed. The road is waiting.', 7);
  await term.pause('Press any key');
}

// ------------------------------------------------------------- status page

async function statusScreen(term, handle, p) {
  frame(term, handle, p, "THE HEALER'S TENT", 'She reads scars the way scholars read books.');
  const rows = [
    ['Name', handle, 15],
    ['Level', String(p.level), 11],
    ['Experience', `${fmt(p.exp)} / ${fmt(expNeed(p.level))}`, 14],
    ['Health', `${p.hp} / ${p.maxhp}`, p.hp < p.maxhp ? 12 : 10],
    ['Gold on hand', fmt(p.gold), 14],
    ['Banked', fmt(p.banked), 14],
    ['Weapon', WEAPONS[p.weapon].name, 11],
    ['Armour', ARMOR[p.armor].name, 11],
    ['Monsters slain', fmt(p.kills), 15],
    ['Gems', fmt(p.gems), 13],
    ['Duels won', fmt(p.pvpWins), 15],
    ['Turns left', `${p.turns} / ${TURNS_PER_DAY}`, p.turns ? 11 : 12],
  ];
  rows.forEach(([label, val, fg], i) => {
    const r = 8 + i;
    term.print(r, 6, pad(label, 16), 8);
    term.print(r, 23, String(val), fg);
  });
  term.print(21, 6, 'Experience to next level:', 8);
  term.print(21, 33, fmt(Math.max(0, expNeed(p.level) - p.exp)), 10);
  await term.pause('Press any key');
}

// ------------------------------------------------------------------ combat

function makeMonster(p) {
  const lo = Math.max(1, p.level - 2);
  const pool = MONSTERS.filter((m) => m.lvl <= p.level + 2 && m.lvl >= lo);
  const m = pick(pool.length ? pool : [MONSTERS[0]]);
  const scaleHp = (p.level - m.lvl) * 4;
  const hp = Math.max(5, m.hp + Math.max(0, scaleHp));
  return {
    name: m.name,
    lvl: m.lvl,
    hp,
    maxhp: hp,
    dmg: m.dmg + Math.floor(p.level / 3),
    exp: m.exp + p.level * 2,
    gold: m.gold + p.level * 2,
    art: m.art,
    taunt: m.taunt,
    boss: false,
  };
}

function makeDragon(p) {
  const hp = 45 + p.level * 11;
  return {
    name: 'Vharzul the Ashen',
    lvl: p.level + 2,
    hp,
    maxhp: hp,
    dmg: 5 + Math.round(p.level * 1.5),
    exp: 150 + p.level * 25,
    gold: 200 + p.level * 35,
    art: DRAGON_FIGHT_ART,
    taunt: 'The wyrm uncoils. The whole Keep smells of hot iron.',
    boss: true,
  };
}

// "the Goblin Scavenger" but never "the Vharzul the Ashen".
function foeName(m) {
  return m.boss ? m.name : 'the ' + m.name;
}

function foeCap(m) {
  return m.boss ? m.name : 'The ' + m.name;
}

function drawBars(term, p, m) {
  const foeColor = m.hp / m.maxhp < 0.34 ? 10 : 12;
  term.print(14, 4, 'FOE', 12);
  term.print(14, 8, '[' + bar(m.hp, m.maxhp, 26) + ']', foeColor);
  term.print(14, 37, pad(`${Math.max(0, m.hp)}/${m.maxhp}`, 10), foeColor);
  term.print(15, 4, 'YOU', 10);
  term.print(15, 8, '[' + bar(p.hp, p.maxhp, 26) + ']', p.hp / p.maxhp < 0.34 ? 12 : 10);
  term.print(15, 37, pad(`${p.hp}/${p.maxhp}`, 10), 7);
}

function drawLog(term, log) {
  const lines = [];
  for (const entry of log) {
    for (const line of term.wrap(entry, 72)) lines.push(line);
  }
  const tail = lines.slice(-5);
  while (tail.length < 5) tail.unshift('');
  tail.forEach((line, i) => term.print(17 + i, 4, pad(line, 72), i === 4 ? 15 : 7));
}

function drawFight(term, handle, p, m, log) {
  term.cls();
  hud(term, handle, p);
  term.print(3, 1, '─'.repeat(Math.min(term.cols, 80)), 8);
  term.center(5, m.name.toUpperCase(), m.boss ? 12 : 14);
  term.center(6, m.taunt, 8);
  let row = 8;
  for (const line of m.art) term.center(row++, line, m.boss ? 12 : 9);
  drawBars(term, p, m);
  term.print(16, 1, '─'.repeat(Math.min(term.cols, 80)), 8);
  drawLog(term, log);
  term.print(25, 2, 'A attacks. D guards and recovers. ESC or R runs.', 8);
}

function updateFight(term, p, m, log) {
  drawBars(term, p, m);
  drawLog(term, log);
}

function clearPrompt(term) {
  const W = Math.min(term.cols || 80, 80);
  term.print(23, 1, ' '.repeat(W), 7);
  term.print(24, 1, ' '.repeat(W), 7);
}

async function fight(term, handle, p, m, save) {
  const log = [m.taunt];
  drawFight(term, handle, p, m, log);

  for (;;) {
    term.gotoxy(23, 3);
    const k = await term.menu({ prompt: ' (A)ttack   (D)efend   (R)un : ', valid: 'ADR' });
    clearPrompt(term);
    if (k == null) return 'fled';

    if (k === 'ESC' || k === 'R') {
      const chance = Math.max(15, Math.min(85, 45 + p.level * 4 - m.lvl * 3));
      if (m.boss && Math.random() < 0.25) {
        log.push('The wyrm spreads its wings. There is nowhere to run.');
      } else if (rnd(100) <= chance) {
        log.push('You break away and run for the treeline.');
        updateFight(term, p, m, log);
        await term.pause('Press any key');
        return 'fled';
      } else {
        log.push(`You turn to run — ${foeName(m)} cuts you off!`);
      }
      const back = Math.max(1, m.dmg + rnd(2) - Math.floor(ARMOR[p.armor].def / 2));
      p.hp -= back;
      log.push(`It strikes your back for ${back}.`);
      if (p.hp <= 0) return death(term, handle, p, save, m);
      save();
      updateFight(term, p, m, log);
      continue;
    }

    if (k === 'A') {
      const crit = Math.random() < 0.12;
      let dmg = WEAPONS[p.weapon].power + Math.round(p.level * 1.5) + rnd(6) - Math.floor(m.lvl / 2) - rnd(2);
      dmg = Math.max(2, dmg);
      if (crit) dmg *= 2;
      m.hp -= dmg;
      log.push(crit ? `CRITICAL — you tear ${foeName(m)} for ${dmg}!` : `You strike ${foeName(m)} for ${dmg}.`);
    } else {
      log.push('You set your guard and wait for an opening.');
    }

    if (m.hp <= 0) {
      return victory(term, handle, p, m, save);
    }

    let md = m.dmg + rnd(2) - (ARMOR[p.armor].def + Math.floor(p.level / 2) + 1);
    md = Math.max(1, md);
    if (k === 'D') md = Math.max(1, Math.round(md * 0.4));
    p.hp -= md;
    log.push(`${m.name} hits you for ${md}.`);
    if (k === 'D') {
      const heal = 1 + rnd(2);
      p.hp = Math.min(p.maxhp, p.hp + heal);
      log.push(`You catch your breath (+${heal} hp).`);
    }
    if (p.hp <= 0) return death(term, handle, p, save, m);
    save();
    updateFight(term, p, m, log);
  }
}

async function victory(term, handle, p, m, save) {
  p.kills += 1;
  p.gold += m.gold;
  const gem = m.boss || Math.random() < 0.12;
  if (gem) p.gems += 1;
  const ups = awardExp(p, m.exp);
  if (m.boss) {
    p.maxhp += 3;
    p.hp = p.maxhp;
  }
  save();

  term.cls();
  hud(term, handle, p);
  term.print(3, 1, '─'.repeat(Math.min(term.cols, 80)), 8);
  term.center(6, m.boss ? 'THE WYRM FALLS' : 'VICTORY', 10);
  term.center(8, m.boss ? 'Vharzul the Ashen crashes down and is still.' : `${m.name} lies still.`, 15);
  term.print(11, 8, 'Experience', 8);
  term.print(11, 30, '+' + fmt(m.exp), 14);
  term.print(12, 8, 'Gold', 8);
  term.print(12, 30, '+' + fmt(m.gold), 14);
  if (gem) {
    term.print(13, 8, 'Gem', 8);
    term.print(13, 30, '+1  (a hard, green spark)', 13);
  }
  let row = 15;
  for (const line of ups) {
    term.print(row++, 8, line, 11);
  }
  if (m.boss) {
    term.print(row + 1, 8, 'The hoard is yours. Your name will be sung in Emberford.', 13);
    term.print(row + 2, 8, 'Permanent: +3 max hp.', 10);
  } else if (!ups.length) {
    term.print(15, 8, 'You bind your wounds and take stock.', 7);
  }
  await term.pause('Press any key');
  return 'win';
}

async function death(term, handle, p, save, m) {
  const lost = Math.floor(p.gold / 2);
  p.gold -= lost;
  p.exp = Math.max(0, Math.floor(p.exp * 0.85));
  p.hp = 1;
  save();

  term.cls();
  hud(term, handle, p);
  term.print(3, 1, '─'.repeat(Math.min(term.cols, 80)), 8);
  term.center(7, 'YOU HAVE FALLEN', 12);
  term.center(9, `${foeCap(m)} stands over you.`, 7);
  term.center(11, 'Cold water. A cart. The temple bell at Emberford.', 15);
  term.print(14, 8, 'Lost to the road', 8);
  term.print(14, 30, fmt(lost) + ' gold', 12);
  term.print(15, 8, 'Scattered experience', 8);
  term.print(15, 30, '15%', 12);
  term.print(16, 8, 'You wake at 1 hp, weapon still in hand.', 10);
  term.print(18, 8, 'Banked gold is untouched. Bank more next time.', 8);
  await term.pause('Press any key');
  return 'dead';
}

async function forest(term, handle, p, save) {
  if (p.turns <= 0) {
    frame(term, handle, p, 'NO TURNS LEFT', 'The sun is down and the gate is shut.');
    say(term, 9, 'You have used all twelve turns of daylight. Sleep, and the road will be there tomorrow.', 12);
    await term.pause('Press any key');
    return 'You are out of turns until tomorrow.';
  }
  p.turns -= 1;
  save();

  const m = makeMonster(p);
  const res = await fight(term, handle, p, m, save);
  if (res === 'dead') return 'They carried you back from the forest.';
  if (res === 'fled') return 'You ran. The forest keeps what it caught.';
  return '';
}

// ------------------------------------------------------------- the Keep

async function keep(term, handle, p, save) {
  if (p.level < 4) {
    frame(term, handle, p, 'THE PATH IS BARRED', 'Two wardens block the switchback road.');
    say(term, 9, '"The Keep is no place for a first-season sword," the warden says. "Come back at the fourth rank."', 12);
    term.print(14, 5, 'You need level 4.', 15);
    await term.pause('Press any key');
    return 'The wardens turn you back. Level 4 required.';
  }
  if (p.turns < 3) {
    frame(term, handle, p, 'THE PATH IS BARRED', 'Too little daylight left for the climb.');
    say(term, 9, 'The climb and the fight will take three turns. You do not have them.', 12);
    await term.pause('Press any key');
    return 'You need 3 turns to climb the Keep.';
  }

  frame(term, handle, p, "THE DRAGON'S KEEP", 'The black tooth of stone above Emberford.');
  let row = 8;
  for (const line of DRAGON_ART) term.print(row++, 6, line, 12);
  term.print(18, 6, 'The stench of sulphur rolls down the stair.', 7);
  term.print(19, 6, 'Somewhere above, something enormous shifts in its sleep.', 7);
  term.print(21, 6, 'The climb costs 3 turns. There is no shame in turning back.', 10);
  term.gotoxy(22, 6);

  const yn = await term.yesno('Climb to the wyrm?', false);
  if (!yn) return 'You leave the Keep to braver swords.';

  p.turns -= 3;
  save();
  const m = makeDragon(p);
  const res = await fight(term, handle, p, m, save);
  if (res === 'win') {
    return 'The wyrm is dead. Emberford will not forget.';
  }
  if (res === 'dead') return 'The Keep keeps what it kills.';
  return 'You fled the Keep with your life. Barely.';
}

// -------------------------------------------------------------------- run

module.exports = {
  id: DOOR_ID,
  name: "DRAGON'S KEEP",
  author: 'Gate Software',
  category: 'RPG',
  description: 'Hunt the crags above Emberford, bank your gold, and face the wyrm of Dragon\'s Keep.',
  minLevel: 0,

  async run(term, ctx) {
    const handle = String((ctx.user && ctx.user.handle) || 'Caller');

    if ((term.cols || 80) < 76 || (term.cols || 80) > 84 || (term.rows || 25) < 24) {
      term.cls();
      term.write("DRAGON'S KEEP plays in 80 columns. Set your client to 80x25 and call again.\r\n");
      await term.pause('Press any key');
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

    const save = () => {
      try {
        ctx.save();
      } catch {
        /* a save failure must never kill the game */
      }
    };
    save();

    await titleScreen(term, handle);

    if (isNew || !p.seenIntro) {
      await introScreen(term, handle, p);
      p.seenIntro = true;
      save();
    }

    const notice = rolled && !isNew ? 'A new day. Turns restored, bank interest paid.' : '';
    await town(term, ctx, handle, p, save, notice);

    term.cls();
    hud(term, handle, p);
    term.print(3, 1, '─'.repeat(Math.min(term.cols, 80)), 8);
    term.center(8, 'YOU LEAVE THE REALM', 11);
    term.center(10, `Level ${p.level}  ·  ${fmt(p.kills)} kills  ·  ${fmt(p.gold)} gold`, 15);
    term.center(12, 'The gate closes behind you. Your record is safe.', 7);
    await term.pause('Press any key');
  },
};
