'use strict';
// TRADE WARS 3001 — native BBS door (CommonJS, zero dependencies).
//
// The galaxy is generated deterministically from a stored seed, so every
// caller on the board sees the same sixty sectors, ports and prices.
// Per-pilot state lives in ctx.db.data.doors['trade-wars'].users[handle].

// --------------------------------------------------------------- constants

const DOOR_ID = 'trade-wars';
const GAME_NAME = 'TRADE WARS 3001';
const SECTOR_COUNT = 60;
const TURNS_PER_DAY = 60;
const START_CREDITS = 2000;
const MAX_HOPS = 3;
const SW = 80; // design width; anything wider would wrap on an 80-column caller

const GOODS = [
  { key: 'fuelOre', name: 'Fuel Ore', short: 'Fuel' },
  { key: 'organics', name: 'Organics', short: 'Org' },
  { key: 'equipment', name: 'Equipment', short: 'Equip' },
];

const PORT_NAMES = [
  'Cygnus Freeport', 'Kepler Exchange', 'Draco Merc', 'Vega Supply',
  'Rigel Outpost', 'Altair Bazaar', 'Nyx Market', 'Sol Waystation',
  'Titan Yards', 'Carina Depot', 'Orion Spur', 'Lyra Cartel',
];

const PLANET_NAMES = [
  'New Gomorrah', 'Kepler Verge', 'Tharsis Landing', 'Port Arthur', 'Icaria',
  'Belt Haven', 'Nova Scotia', 'Dry Well', 'Last Chance', 'Gibraltar Rock',
];

const ENEMY_NAMES = [
  'Corsair Raider', 'Krell Marauder', 'Void Pirate', 'Rogue Gunboat',
  'Syndicate Enforcer', 'Belt Scavenger', 'Hull Ghoul', 'Red Wake',
];

const RUMOURS = [
  'A freighter out of Rigel swears there is a port buying equipment at 40.',
  'They say the Corsairs pay a toll in the Altair corridor now.',
  'Half the colony has never seen a ship with holds this small.',
  'Somebody hid a fortune in a dead hull out past sector 50. Somebody.',
  'The StarDock yard hands are on strike again. Prices never move, though.',
  'A courier came through with news: the war is going badly, everywhere.',
];

// ----------------------------------------------------------------- helpers

const pad = (s, n) => {
  let t = String(s == null ? '' : s);
  if (t.length > n) t = t.slice(0, n);
  return t + ' '.repeat(Math.max(0, n - t.length));
};
const padl = (s, n) => {
  let t = String(s == null ? '' : s);
  if (t.length > n) t = t.slice(0, n);
  return ' '.repeat(Math.max(0, n - t.length)) + t;
};
const comma = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Deterministic 32-bit mix: same seed + coordinates -> same galaxy, always.
function mix(seed, a, b) {
  let x = (seed >>> 0) ^ Math.imul((a | 0) + 1, 0x9e3779b1) ^ Math.imul((b | 0) + 1, 0x85ebca6b);
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

function dayKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function listWords(words) {
  if (!words.length) return 'nothing';
  if (words.length === 1) return words[0];
  return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
}

// ------------------------------------------------------------------ galaxy

function buildLanes() {
  const adj = new Array(SECTOR_COUNT + 1);
  for (let i = 1; i <= SECTOR_COUNT; i++) adj[i] = new Set();
  const link = (a, b) => {
    if (a < 1 || b < 1 || a > SECTOR_COUNT || b > SECTOR_COUNT || a === b) return;
    adj[a].add(b);
    adj[b].add(a);
  };
  for (let i = 2; i <= SECTOR_COUNT; i++) link(i, i === SECTOR_COUNT ? 2 : i + 1);
  for (let i = 1; i <= 6; i++) link(1, i); // StarDock sits in a hub of six lanes
  for (let i = 2; i <= SECTOR_COUNT; i++) {
    if (i % 5 === 0) link(i, i + 11);
    if (i % 7 === 0) link(i, i + 17);
    if (i % 3 === 0) link(i, i + 5);
  }
  return adj;
}

function buildGalaxy(seed) {
  const sectors = new Array(SECTOR_COUNT + 1);
  sectors[1] = { id: 1, kind: 'dock', name: 'The Old Yard', cls: '', prices: {} };
  for (let i = 2; i <= SECTOR_COUNT; i++) {
    const roll = mix(seed, i, 7) % 100;
    if (roll < 58) {
      let bits = mix(seed, i, 11) & 7;
      // Keep the pure SSS / BBB ports rare: they are trade dead ends.
      if ((bits === 0 || bits === 7) && mix(seed, i, 12) % 4 !== 0) bits = (bits + 1 + (mix(seed, i, 13) % 6)) & 7;
      const cls = GOODS.map((g, gi) => ((bits >> gi) & 1 ? 'S' : 'B')).join('');
      const prices = {};
      GOODS.forEach((g, gi) => {
        const base = 10 + (mix(seed, i, 20 + gi) % 27); // 10..36 credits
        prices[g.key] = cls[gi] === 'S'
          ? { side: 'S', price: Math.ceil(base * 1.12) }
          : { side: 'B', price: Math.floor(base * 0.84) };
      });
      sectors[i] = { id: i, kind: 'port', name: PORT_NAMES[mix(seed, i, 31) % PORT_NAMES.length], cls, prices };
    } else if (roll < 78) {
      sectors[i] = {
        id: i,
        kind: 'planet',
        name: PLANET_NAMES[mix(seed, i, 33) % PLANET_NAMES.length],
        level: 2 + (mix(seed, i, 34) % 6),
      };
    } else {
      sectors[i] = { id: i, kind: 'empty', name: 'Deep space' };
    }
  }
  return { seed, sectors, adj: buildLanes() };
}

// Breadth-first route over the lane graph; returns array of sectors or null.
function route(adj, from, to, maxHops) {
  if (from === to) return [from];
  const seen = new Set([from]);
  const parent = new Map();
  let frontier = [from];
  for (let d = 1; d <= maxHops; d++) {
    const next = [];
    for (const s of frontier) {
      for (const n of adj[s] || []) {
        if (seen.has(n)) continue;
        seen.add(n);
        parent.set(n, s);
        if (n === to) {
          const path = [to];
          let cur = to;
          while (parent.has(cur)) {
            cur = parent.get(cur);
            path.unshift(cur);
          }
          return path;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

// ------------------------------------------------------------------- state

function storeOf(ctx) {
  const data = ctx.db.data;
  if (!data.doors) data.doors = {};
  let store = data.doors[DOOR_ID];
  if (!store || typeof store !== 'object') store = data.doors[DOOR_ID] = { seed: 3001, users: {} };
  if (!store.users || typeof store.users !== 'object') store.users = {};
  if (!store.seed) store.seed = 3001;
  return store;
}

const maxFuel = (ship) => 20 + ship.warp * 10;
const cargoUsed = (u) => GOODS.reduce((n, g) => n + (u.cargo[g.key] || 0), 0);

function scoreOf(u) {
  const cargo = GOODS.reduce((n, g) => n + ((u.cargo && u.cargo[g.key]) || 0) * 14, 0);
  const ship = u.ship || {};
  const shipVal = (ship.holds || 0) * 18 + (ship.fighters || 0) * 16 + (ship.shields || 0) * 10 + (ship.warp || 0) * 400;
  return Math.round((u.credits || 0) + cargo + shipVal);
}

function newUser(handle) {
  return {
    handle,
    ship: { name: 'Merchant Cruiser', holds: 20, fighters: 10, shields: 20, warp: 2, fuel: 40 },
    credits: START_CREDITS,
    cargo: { fuelOre: 0, organics: 0, equipment: 0 },
    turns: TURNS_PER_DAY,
    day: dayKey(),
    sector: 1,
    kills: 0,
    deaths: 0,
    trades: 0,
    warps: 0,
    created: Date.now(),
    played: Date.now(),
  };
}

// Daily turn grant. Returns true when it fired.
function ensureTurns(u) {
  const today = dayKey();
  if (u.day !== today) {
    u.day = today;
    u.turns = TURNS_PER_DAY;
    return true;
  }
  return false;
}

// --------------------------------------------------------------- rendering

function put(term, row, col, text, fg, bg) {
  if (row < 1 || row > (term.rows || 25) || col > SW) return;
  const max = SW - col + 1;
  let s = String(text == null ? '' : text);
  if (s.length > max) s = s.slice(0, max);
  term.print(row, col, s, fg, bg);
}

function line(term, row, text, fg) {
  put(term, row, 1, pad(text, SW), fg);
}

function rule(term, row, ch, fg) {
  put(term, row, 1, String(ch || '─').repeat(SW), fg);
}

function bar(term, row, left, right, bg) {
  put(term, row, 1, ' '.repeat(SW), 15, bg || 4);
  put(term, row, 2, left, 15, bg || 4);
  if (right) put(term, row, SW - String(right).length - 1, right + ' ', 15, bg || 4);
}

function status(term, u, extra) {
  const t = ' ' + GAME_NAME + '  ·  ' + u.handle + '  ·  sector ' + u.sector +
    '  ·  ' + u.turns + ' turns  ·  ESC backs out' + (extra ? '  ·  ' + extra : '');
  put(term, term.rows || 25, 1, pad(t, SW), 0, 7);
}

function describe(sec) {
  if (sec.kind === 'dock') {
    return [
      'StarDock: fuel, holds, fighters, shields and warp drives. The only',
      'safe harbour in the cluster, and the only yard that sells a tow.',
    ];
  }
  if (sec.kind === 'port') {
    const sells = GOODS.filter((g) => sec.prices[g.key].side === 'S').map((g) => g.name);
    const buys = GOODS.filter((g) => sec.prices[g.key].side === 'B').map((g) => g.name);
    return [
      'Docking clamps engage. The port SELLS ' + listWords(sells) + '.',
      'It BUYS ' + listWords(buys) + ', cash on the ramp.',
    ];
  }
  if (sec.kind === 'planet') {
    return [
      'A class-' + sec.level + ' colony clings to the rock here.',
      'Nothing to trade but rumours, bad coffee and a weak transmitter.',
    ];
  }
  return [
    'Nothing but dust, dead relays and the odd frozen hull.',
    'Long-range sensors read empty all the way out.',
  ];
}

// ------------------------------------------------------------------ input

const IDLE_MS = 180000; // idle callers time out of a key read; carrier loss raises Hangup

async function pick(term, valid) {
  for (;;) {
    const k = await term.readKey({ timeoutMs: IDLE_MS });
    if (k == null) continue;
    if (k === 'ENTER') return 'ENTER';
    if (k === 'ESC') return 'ESC';
    const ch = String(k).toUpperCase();
    if (ch.length === 1 && (!valid || valid.indexOf(ch) >= 0)) {
      term.write(ch);
      return ch;
    }
    term.beep();
  }
}

async function askInt(term, row, label, lo, hi) {
  for (let tries = 0; tries < 5; tries++) {
    put(term, row, 1, ' ' + pad(label, SW - 2), 14);
    let raw;
    try {
      raw = await term.readLine({ prompt: '', max: 5, allowEmpty: true });
    } catch (e) {
      if (e && e.name === 'AbortInput') return null;
      throw e;
    }
    const s = String(raw || '').trim();
    if (!s) return null;
    if (!/^\d+$/.test(s)) {
      put(term, row + 1, 1, pad('  Numbers only, please.', SW - 1), 12);
      continue;
    }
    const n = parseInt(s, 10);
    if (n < lo || n > hi) {
      put(term, row + 1, 1, pad('  Enter a number from ' + lo + ' to ' + hi + '.', SW - 1), 12);
      continue;
    }
    put(term, row + 1, 1, pad('', SW - 1), 7);
    return n;
  }
  return null;
}

async function press(term, row, label) {
  put(term, row, 1, pad('  ' + label, SW - 1), 8);
  const k = await term.readKey({ timeoutMs: IDLE_MS });
  return k === 'ESC' ? 'ESC' : 'OK';
}

// ----------------------------------------------------------------- screens

function drawSector(term, u, gal, msg) {
  const sec = gal.sectors[u.sector];
  term.cls();
  bar(term, 1, GAME_NAME, 'SECTOR ' + u.sector, 4);
  put(term, 2, 2, `CALLER ${u.handle}`, 14);
  put(term, 2, 26, `TURNS ${u.turns}/${TURNS_PER_DAY}`, u.turns > 5 ? 11 : 12);
  put(term, 2, 45, `CREDITS ${comma(u.credits)}`, 10);
  put(term, 2, 66, `SCORE ${comma(scoreOf(u))}`, 13);
  rule(term, 3, '═', 11);

  put(term, 4, 2, 'SHIP', 8);
  put(term, 4, 8, u.ship.name, 15);
  put(term, 4, 40, `HOLDS ${cargoUsed(u)}/${u.ship.holds}`, 11);
  put(term, 5, 2, `FIGHTERS ${u.ship.fighters}`, 12);
  put(term, 5, 20, `SHIELDS ${u.ship.shields}`, 12);
  put(term, 5, 38, `WARP ${u.ship.warp}`, 12);
  put(term, 5, 52, `FUEL ${u.ship.fuel}/${maxFuel(u.ship)}`, 12);
  put(term, 6, 2, 'CARGO', 8);
  GOODS.forEach((g, i) => {
    put(term, 6, 10 + i * 20, `${g.short} ${u.cargo[g.key]}`, 15);
  });
  put(term, 6, 70, `VAL ${comma(GOODS.reduce((n, g) => n + u.cargo[g.key] * 14, 0))}`, 8);
  rule(term, 7, '─', 8);

  const kind = sec.kind === 'dock' ? 'STARDOCK'
    : sec.kind === 'port' ? 'PORT ' + sec.cls
      : sec.kind === 'planet' ? 'PLANET' : 'EMPTY SPACE';
  put(term, 8, 2, `SECTOR ${u.sector}`, 15);
  put(term, 8, 15, kind, 11);
  put(term, 8, 32, String(sec.name).toUpperCase(), 14);
  describe(sec).forEach((t, i) => put(term, 10 + i, 4, t, 7));

  put(term, 13, 2, '[P] Trade at the port', sec.kind === 'port' ? 15 : 8);
  put(term, 13, 28, '[W] Warp (up to 3 hops)', 15);
  put(term, 13, 56, '[S] StarDock yard', 15);
  put(term, 14, 2, '[I] Ship & rules', 15);
  put(term, 14, 28, '[M] Galactic map', 15);
  put(term, 14, 56, '[H] Hall of fame', 15);
  put(term, 15, 2, sec.kind === 'planet' ? '[L] Hail the colony' : '[L] Hail (no answer)', sec.kind === 'planet' ? 15 : 8);
  put(term, 15, 28, '[Q] Quit the lanes', 15);

  rule(term, 17, '─', 8);
  put(term, 18, 2, '>', 11);
  const wrapped = term.wrap(msg || '', SW - 6).slice(0, 3);
  wrapped.forEach((t, i) => put(term, 18 + i, 5, t, 11));

  status(term, u);
  put(term, 22, 2, 'Command: ', 14);
}

function drawPort(term, u, sec, msg) {
  term.cls();
  bar(term, 1, 'PORT OF ' + String(sec.name).toUpperCase(), 'SECTOR ' + sec.id, 6);
  put(term, 2, 2, `CLASS ${sec.cls}`, 11);
  put(term, 2, 18, `CLASSES: S = port sells, B = port buys`, 8);
  put(term, 2, 62, `TURNS ${u.turns}`, 11);
  rule(term, 3, '═', 11);

  put(term, 4, 2, 'GOOD', 8);
  put(term, 4, 18, 'CLASS', 8);
  put(term, 4, 27, 'UNIT', 8);
  put(term, 4, 36, 'IN HOLD', 8);
  put(term, 4, 48, 'TRADE', 8);
  rule(term, 5, '─', 8);

  GOODS.forEach((g, i) => {
    const p = sec.prices[g.key];
    const row = 6 + i;
    const yours = u.cargo[g.key] || 0;
    put(term, row, 2, g.name, 15);
    put(term, row, 18, p.side === 'S' ? 'S  sells' : 'B  buys', p.side === 'S' ? 11 : 10);
    put(term, row, 27, padl(p.price + ' cr', 8), 14);
    put(term, row, 36, padl(String(yours), 6), 15);
    if (p.side === 'S') {
      const room = u.ship.holds - cargoUsed(u);
      const can = Math.min(room, Math.floor(u.credits / p.price));
      put(term, row, 48, can > 0 ? `[${i + 1}] buy ${can}` : 'holds/credits full', can > 0 ? 15 : 8);
    } else {
      put(term, row, 48, yours > 0 ? `[${i + 1}] sell ${yours}` : 'nothing to sell', yours > 0 ? 15 : 8);
    }
  });

  rule(term, 9, '─', 8);
  put(term, 10, 2, `HOLDS ${cargoUsed(u)}/${u.ship.holds}`, 11);
  put(term, 10, 20, `CREDITS ${comma(u.credits)}`, 10);
  put(term, 10, 40, `CARGO VALUE ${comma(GOODS.reduce((n, g) => n + u.cargo[g.key] * 14, 0))}`, 8);
  rule(term, 11, '─', 8);

  const w = term.wrap(msg || 'The broker nods. "Buy low, sell high, pilot."', SW - 6).slice(0, 2);
  w.forEach((t, i) => put(term, 12 + i, 4, t, 11));

  put(term, 15, 4, '[1] Fuel Ore   [2] Organics   [3] Equipment', 14);
  put(term, 16, 4, '[ESC] Undock and return to the sector view', 8);
  status(term, u);
  put(term, 22, 2, 'Trade: ', 14);
}

function drawDock(term, u, msg) {
  const fuelCost = (maxFuel(u.ship) - u.ship.fuel) * 1;
  const warpCost = 400 * (u.ship.warp + 1);
  term.cls();
  bar(term, 1, 'STARDOCK SHIPYARD', 'SECTOR 1', 4);
  put(term, 2, 2, `CALLER ${u.handle}`, 14);
  put(term, 2, 26, `TURNS ${u.turns}/${TURNS_PER_DAY}`, 11);
  put(term, 2, 46, `CREDITS ${comma(u.credits)}`, 10);
  rule(term, 3, '═', 11);

  put(term, 4, 2, 'SHIP', 8);
  put(term, 4, 8, u.ship.name, 15);
  put(term, 4, 34, `HOLDS ${u.ship.holds}`, 11);
  put(term, 5, 2, `FIGHTERS ${u.ship.fighters}`, 12);
  put(term, 5, 24, `SHIELDS ${u.ship.shields}`, 12);
  put(term, 5, 46, `WARP ${u.ship.warp}`, 12);
  put(term, 5, 60, `FUEL ${u.ship.fuel}/${maxFuel(u.ship)}`, 12);
  rule(term, 7, '─', 8);
  put(term, 8, 2, 'YARD SERVICES', 14);

  const rows = [
    ['F', 'Refuel to full', fuelCost > 0 ? comma(fuelCost) + ' cr' : 'tanks are full'],
    ['H', 'Fit 5 more holds', u.ship.holds >= 100 ? 'hull is maxed' : '120 cr'],
    ['G', 'Load 10 fighters', u.ship.fighters >= 200 ? 'bays are full' : '200 cr'],
    ['S', 'Fit 10 more shields', u.ship.shields >= 150 ? 'no room left' : '150 cr'],
    ['W', 'Warp drive +1 (more fuel, better odds)', u.ship.warp >= 6 ? 'drive is maxed' : comma(warpCost) + ' cr'],
    ['E', 'Emergency tow to sector 1', u.sector === 1 ? 'you are already here' : '250 cr'],
  ];
  rows.forEach((r, i) => {
    put(term, 9 + i, 3, `[${r[0]}]`, 14);
    put(term, 9 + i, 7, pad(r[1], 44), 15);
    put(term, 9 + i, 52, padl(r[2], 24), 8);
  });

  rule(term, 16, '─', 8);
  const w = term.wrap(msg || 'The yard boss spits. "Cash first, pilot."', SW - 6).slice(0, 2);
  w.forEach((t, i) => put(term, 17 + i, 4, t, 11));
  put(term, 20, 4, '[ESC] Leave the dock and return to the sector view', 8);
  status(term, u);
  put(term, 22, 2, 'Service: ', 14);
}

async function dockScreen(term, ctx, u, msg) {
  for (;;) {
    drawDock(term, u, msg);
    msg = '';
    const k = await pick(term, 'FHGSWE');
    if (k === 'ESC') return 'Left the yard.';
    const fuelCost = maxFuel(u.ship) - u.ship.fuel;
    if (k === 'F') {
      if (fuelCost <= 0) { msg = 'Tanks are already full.'; continue; }
      if (u.credits < fuelCost) { msg = 'Not enough credits for a full load. You need ' + comma(fuelCost) + '.'; continue; }
      u.credits -= fuelCost;
      u.ship.fuel = maxFuel(u.ship);
      ctx.save();
      msg = 'Tanks topped off for ' + comma(fuelCost) + ' credits.';
      continue;
    }
    if (k === 'H') {
      if (u.ship.holds >= 100) { msg = 'The hull will not take another hold.'; continue; }
      if (u.credits < 120) { msg = 'Holds cost 120 credits. Come back with more.'; continue; }
      u.credits -= 120;
      u.ship.holds += 5;
      ctx.save();
      msg = 'Yard hands weld in five new holds. Capacity ' + u.ship.holds + '.';
      continue;
    }
    if (k === 'G') {
      if (u.ship.fighters >= 200) { msg = 'Fighter bays are full.'; continue; }
      if (u.credits < 200) { msg = 'Fighters run 200 credits for ten.'; continue; }
      u.credits -= 200;
      u.ship.fighters = Math.min(200, u.ship.fighters + 10);
      ctx.save();
      msg = 'Ten fighters sign on. ' + u.ship.fighters + ' in the bays.';
      continue;
    }
    if (k === 'S') {
      if (u.ship.shields >= 150) { msg = 'Shield emitters are maxed.'; continue; }
      if (u.credits < 150) { msg = 'Shield work costs 150 credits.'; continue; }
      u.credits -= 150;
      u.ship.shields = Math.min(150, u.ship.shields + 10);
      ctx.save();
      msg = 'Shield capacity now ' + u.ship.shields + '.';
      continue;
    }
    if (k === 'W') {
      if (u.ship.warp >= 6) { msg = 'The drive is already the best in the cluster.'; continue; }
      const cost = 400 * (u.ship.warp + 1);
      if (u.credits < cost) { msg = 'A warp upgrade costs ' + comma(cost) + ' credits.'; continue; }
      u.credits -= cost;
      u.ship.warp += 1;
      u.ship.fuel = maxFuel(u.ship);
      ctx.save();
      msg = 'New drive installed. Warp ' + u.ship.warp + ', tanks topped to ' + maxFuel(u.ship) + '.';
      continue;
    }
    if (k === 'E') {
      if (u.sector === 1) { msg = 'You are already at the dock.'; continue; }
      if (u.credits < 250) { msg = 'A tow costs 250 credits. You cannot pay it.'; continue; }
      u.credits -= 250;
      u.sector = 1;
      ctx.save();
      msg = 'A tug drags you home. 250 credits, no questions.';
      continue;
    }
  }
}

function drawWarp(term, u, gal) {
  term.cls();
  bar(term, 1, 'WARP CONTROL', 'SECTOR ' + u.sector, 1);
  put(term, 2, 2, `TURNS ${u.turns}/${TURNS_PER_DAY}`, 11);
  put(term, 2, 24, `FUEL ${u.ship.fuel}/${maxFuel(u.ship)}`, 11);
  put(term, 2, 46, `WARP DRIVE ${u.ship.warp}  ·  max ${MAX_HOPS} hops`, 8);
  rule(term, 3, '═', 11);
  put(term, 4, 2, 'SECTOR', 8);
  put(term, 4, 12, 'HOPS', 8);
  put(term, 4, 19, 'TYPE', 8);
  put(term, 4, 31, 'DESTINATION', 8);
  put(term, 4, 63, 'COST', 8);
  rule(term, 5, '─', 8);

  const dests = [];
  for (let d = 1; d <= SECTOR_COUNT; d++) {
    if (d === u.sector) continue;
    const r = route(gal.adj, u.sector, d, MAX_HOPS);
    if (r) dests.push({ id: d, hops: r.length - 1, path: r });
  }
  dests.sort((a, b) => a.hops - b.hops || a.id - b.id);
  const shown = dests.slice(0, 16);
  shown.forEach((d, i) => {
    const sec = gal.sectors[d.id];
    const kind = sec.kind === 'dock' ? 'STARDOCK' : sec.kind === 'port' ? 'PORT ' + sec.cls : sec.kind === 'planet' ? 'PLANET' : 'empty';
    const row = 6 + i;
    put(term, row, 2, padl(String(d.id), 4), 15);
    put(term, row, 12, padl(String(d.hops), 3), d.hops === 1 ? 10 : 11);
    put(term, row, 19, pad(kind, 11), sec.kind === 'port' ? 14 : sec.kind === 'planet' ? 13 : 8);
    put(term, row, 31, pad(sec.name, 30), 7);
    put(term, row, 63, `${d.hops}t ${d.hops * 2}f`, 8);
  });
  if (dests.length > shown.length) {
    const more = dests.length - shown.length;
    put(term, 22, 2, `...and ${more} more sector${more === 1 ? '' : 's'} within range.`, 8);
  }
  status(term, u);
  put(term, 23, 2, 'Warp to sector (1-' + SECTOR_COUNT + ', blank or ESC cancels):', 14);
}

async function warpScreen(term, ctx, u, gal) {
  drawWarp(term, u, gal);
  for (let tries = 0; tries < 3; tries++) {
    let raw;
    try {
      raw = await term.readLine({ prompt: ' ', max: 2, allowEmpty: true });
    } catch (e) {
      if (e && e.name === 'AbortInput') return { ok: false, msg: 'Warp aborted.' };
      throw e;
    }
    const s = String(raw || '').trim();
    if (!s) return { ok: false, msg: 'Warp aborted. The lane can wait.' };
    if (!/^\d+$/.test(s)) { put(term, 24, 1, pad('  Sector numbers only.', SW - 1), 12); continue; }
    const dest = parseInt(s, 10);
    if (dest < 1 || dest > SECTOR_COUNT) { put(term, 24, 1, pad('  There is no sector ' + dest + '.', SW - 1), 12); continue; }
    if (dest === u.sector) { put(term, 24, 1, pad('  You are already there, pilot.', SW - 1), 12); continue; }
    const r = route(gal.adj, u.sector, dest, MAX_HOPS);
    if (!r) {
      put(term, 24, 1, pad(`  Sector ${dest} is more than ${MAX_HOPS} hops away.`, SW - 1), 12);
      continue;
    }
    const hops = r.length - 1;
    const fuelCost = hops * 2;
    if (u.turns < hops) return { ok: false, msg: 'Not enough turns for a ' + hops + '-hop jump.' };
    if (u.ship.fuel < fuelCost) return { ok: false, msg: 'Not enough fuel: ' + fuelCost + ' needed, ' + u.ship.fuel + ' aboard.' };
    u.turns -= hops;
    u.ship.fuel -= fuelCost;
    u.warps += 1;
    u.sector = dest;
    ctx.save();
    return { ok: true, hops, path: r, msg: 'Warped ' + hops + ' hop' + (hops === 1 ? '' : 's') + ' to sector ' + dest + '.' };
  }
  return { ok: false, msg: 'Warp aborted.' };
}

function makeEnemy(u, sector) {
  const pressure = 0.75 + sector / 70 + u.ship.warp * 0.10;
  const fighters = clamp(Math.round((7 + Math.floor(Math.random() * 14)) * pressure), 4, 120);
  return {
    name: ENEMY_NAMES[Math.floor(Math.random() * ENEMY_NAMES.length)],
    fighters,
    shields: Math.round(fighters * 0.5),
    bounty: 120 + fighters * 14,
  };
}

function drawCombat(term, u, enemy, log, round) {
  term.cls();
  bar(term, 1, 'COMBAT', 'HOSTILE CONTACT', 4);
  put(term, 2, 2, String(enemy.name).toUpperCase(), 12);
  put(term, 2, 40, `BOUNTY ${comma(enemy.bounty)} cr`, 10);
  rule(term, 3, '═', 11);

  put(term, 4, 2, 'ENEMY', 8);
  put(term, 4, 12, `FIGHTERS ${padl(enemy.fighters, 4)}`, 12);
  put(term, 4, 38, `SHIELDS ${padl(enemy.shields, 4)}`, 12);
  put(term, 5, 2, 'YOU', 8);
  put(term, 5, 12, `FIGHTERS ${padl(u.ship.fighters, 4)}`, 10);
  put(term, 5, 38, `SHIELDS ${padl(u.ship.shields, 4)}`, 10);
  put(term, 5, 58, `FUEL ${u.ship.fuel}`, 8);
  rule(term, 6, '─', 8);
  put(term, 7, 2, `ROUND ${round}`, 14);

  const body = log.slice(-8);
  body.forEach((t, i) => put(term, 9 + i, 3, pad(t, SW - 4), i === body.length - 1 ? 15 : 7));

  rule(term, 19, '─', 8);
  put(term, 20, 3, '[A] Attack', 15);
  put(term, 20, 22, '[E] Evade', 15);
  put(term, 20, 40, '[ESC] Break off (risky)', 8);
  status(term, u);
  put(term, 22, 3, 'Orders: ', 14);
}

async function combat(term, ctx, u, enemy) {
  let round = 1;
  const log = [`${enemy.name} locks weapons. ${enemy.fighters} fighters inbound.`];
  for (;;) {
    drawCombat(term, u, enemy, log, round);
    const k = await pick(term, 'AE');
    const evade = k === 'E' || k === 'ESC';
    if (evade) {
      const chance = 0.30 + u.ship.warp * 0.07 - enemy.fighters / 400 + (k === 'ESC' ? -0.1 : 0);
      if (Math.random() < chance) {
        log.push('You burn hard and lose them in the debris field.');
        drawCombat(term, u, enemy, log, round);
        await press(term, 23, 'Escaped. Press a key.');
        return 'evaded';
      }
      log.push('The evade fails. They rake your hull on the way past.');
      const dmg = Math.max(2, Math.round(enemy.fighters * 0.35));
      const hull = applyDamage(u, dmg);
      if (hull > 0) log.push(`Hull breach! ${hull} holds' worth of cargo vented.`);
      if (u.ship.fighters <= 0 && u.ship.shields <= 0) {
        drawCombat(term, u, enemy, log, round);
        await press(term, 23, 'Ship disabled. Press a key.');
        return 'lost';
      }
      round++;
      continue;
    }

    // Player volley.
    const volley = Math.max(1, Math.round(u.ship.fighters * (0.55 + Math.random() * 0.5)));
    let left = volley;
    if (enemy.shields > 0) {
      const absorbed = Math.min(enemy.shields, left);
      enemy.shields -= absorbed;
      left -= absorbed;
    }
    if (left > 0) enemy.fighters = Math.max(0, enemy.fighters - left);
    log.push(`Your ${u.ship.fighters} fighters put ${volley} into the target.`);

    if (enemy.shields <= 0 && enemy.fighters <= 0) {
      u.credits += enemy.bounty;
      u.kills += 1;
      ctx.save();
      log.push(`The ${enemy.name} comes apart. Bounty: ${comma(enemy.bounty)} cr.`);
      drawCombat(term, u, enemy, log, round);
      await press(term, 23, 'Victory. Press a key.');
      return 'won';
    }

    // Enemy volley.
    const incoming = Math.max(1, Math.round(enemy.fighters * (0.4 + Math.random() * 0.45)));
    const hull = applyDamage(u, incoming);
    log.push(`They answer with ${incoming}. Shields ${u.ship.shields}, fighters ${u.ship.fighters}.`);
    if (hull > 0) log.push(`Hull breach! ${hull} holds' worth of cargo vented.`);
    if (u.ship.fighters <= 0 && u.ship.shields <= 0) {
      drawCombat(term, u, enemy, log, round);
      await press(term, 23, 'Ship disabled. Press a key.');
      return 'lost';
    }
    round++;
  }
}

// Damage lands on shields, then fighters, then cargo. Returns cargo units lost.
function applyDamage(u, amount) {
  let left = amount;
  const shield = Math.min(u.ship.shields, left);
  u.ship.shields -= shield;
  left -= shield;
  if (left <= 0) return 0;
  const fight = Math.min(u.ship.fighters, left);
  u.ship.fighters -= fight;
  left -= fight;
  if (left <= 0) return 0;
  const units = Math.min(cargoUsed(u), Math.ceil(left / 2));
  let toVent = units;
  for (const g of GOODS) {
    if (toVent <= 0) break;
    const take = Math.min(u.cargo[g.key], toVent);
    u.cargo[g.key] -= take;
    toVent -= take;
  }
  return units - toVent;
}

function wipeout(term, ctx, u) {
  u.deaths += 1;
  u.credits = Math.floor(u.credits * 0.5);
  u.cargo = { fuelOre: 0, organics: 0, equipment: 0 };
  u.sector = 1;
  u.ship.fighters = 5;
  u.ship.shields = 10;
  u.ship.fuel = maxFuel(u.ship);
  ctx.save();
}

function drawMap(term, u, gal, page) {
  term.cls();
  bar(term, 1, 'GALACTIC MAP', `PAGE ${page + 1}/3`, 1);
  put(term, 2, 2, 'S = port sells, B = port buys.  Sector 1 is StarDock.', 8);
  rule(term, 3, '═', 11);
  for (let i = 0; i < 20; i++) {
    for (let c = 0; c < 3; c++) {
      const id = page * 20 + i + c * 20 + 1;
      if (id > SECTOR_COUNT) continue;
      const sec = gal.sectors[id];
      const kind = sec.kind === 'dock' ? 'DOCK' : sec.kind === 'port' ? 'P' + sec.cls : sec.kind === 'planet' ? 'PLNT' : '----';
      const name = sec.kind === 'empty' ? '' : sec.name;
      const row = 4 + i;
      const col = 2 + c * 26;
      put(term, row, col, padl(String(id), 2), id === u.sector ? 10 : 15);
      put(term, row, col + 3, pad(kind, 6), sec.kind === 'port' ? 14 : sec.kind === 'planet' ? 13 : 8);
      put(term, row, col + 10, pad(name, 15), 7);
    }
  }
  status(term, u);
  put(term, 24, 3, '[SPACE] next page   [ESC] back   (your sector is highlighted)', 8);
}

async function mapScreen(term, u, gal) {
  let page = 0;
  for (;;) {
    drawMap(term, u, gal, page);
    const k = await pick(term, ' ');
    if (k === 'ESC') return;
    if (k === 'SPACE') page = (page + 1) % 3;
  }
}

function drawScores(term, store, me) {
  term.cls();
  bar(term, 1, GAME_NAME + '  ·  HALL OF FAME', 'ALL PILOTS', 5);
  put(term, 2, 2, 'Ranked by net worth: credits, cargo and hull.', 8);
  rule(term, 3, '═', 11);
  put(term, 4, 2, 'RANK', 8);
  put(term, 4, 10, 'PILOT', 8);
  put(term, 4, 36, 'NET WORTH', 8);
  put(term, 4, 50, 'KILLS', 8);
  put(term, 4, 60, 'LOSSES', 8);
  put(term, 4, 70, 'SECTOR', 8);
  rule(term, 5, '─', 8);

  const rows = Object.keys(store.users)
    .map((h) => store.users[h])
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .slice(0, 10);
  if (!rows.length) {
    put(term, 7, 4, 'No pilots on the board yet. Be the first.', 8);
  }
  rows.forEach((u, i) => {
    const mine = me && u.handle === me.handle;
    put(term, 6 + i, 2, padl(String(i + 1), 4), mine ? 10 : 14);
    put(term, 6 + i, 10, pad(u.handle, 24), mine ? 10 : 15);
    put(term, 6 + i, 36, padl(comma(scoreOf(u)), 12), 11);
    put(term, 6 + i, 50, padl(String(u.kills || 0), 7), 15);
    put(term, 6 + i, 60, padl(String(u.deaths || 0), 8), 15);
    put(term, 6 + i, 70, padl(String(u.sector || 1), 6), 15);
  });
  put(term, 18, 3, 'Scores move with the market. Trade well and climb.', 8);
  put(term, 23, 3, 'Press any key to return.', 8);
}

async function scoresScreen(term, store, me) {
  drawScores(term, store, me);
  await term.readKey({ timeoutMs: IDLE_MS });
}

function drawHelp(term, u) {
  term.cls();
  bar(term, 1, 'SHIP & RULES', 'PILOT HANDBOOK', 1);
  rule(term, 2, '═', 11);
  const rows = [
    ['Ship', u.ship.name + '  ·  ' + u.ship.holds + ' holds  ·  warp ' + u.ship.warp],
    ['Cargo', GOODS.map((g) => `${g.short} ${u.cargo[g.key]}`).join('   ') + `   (${cargoUsed(u)}/${u.ship.holds})`],
    ['Fuel', `${u.ship.fuel}/${maxFuel(u.ship)}  ·  each hop burns 2 fuel and 1 turn`],
    ['Record', `${u.kills} kills  ·  ${u.deaths} losses  ·  ${u.trades} trades  ·  ${u.warps} warps`],
    ['Turns', `${u.turns} left today, ${TURNS_PER_DAY} granted each new day`],
    ['Score', `${comma(scoreOf(u))} credits of net worth`],
  ];
  rows.forEach((r, i) => {
    put(term, 4 + i, 3, pad(r[0], 9) + ':', 8);
    put(term, 4 + i, 14, pad(r[1], 62), 15);
  });
  rule(term, 11, '─', 8);
  const tips = [
    'Buy where a port SELLS cheap, sell where it BUYS dear.',
    'Ports restock forever; only holds, credits and turns limit you.',
    'Fighters win fights, shields absorb hits, fuel gets you home.',
    'StarDock refuels, upgrades and tows. Everything else is vacuum.',
  ];
  let row = 12;
  for (const t of tips) {
    for (const w of term.wrap(t, 72)) {
      if (row > 21) break;
      put(term, row, 4, w, 7);
      row += 1;
    }
    row += 1;
  }
  put(term, 24, 4, 'Press any key to return.', 8);
}

async function helpScreen(term, u) {
  drawHelp(term, u);
  await term.readKey({ timeoutMs: IDLE_MS });
}

// Port trading: one screen, numeric selection, quantity prompt.
async function portScreen(term, ctx, u, sec) {
  let msg = '';
  for (;;) {
    drawPort(term, u, sec, msg);
    msg = '';
    const k = await pick(term, '123');
    if (k === 'ESC') return 'Undocked. Back in open space.';
    const gi = '123'.indexOf(k);
    if (gi < 0) continue;
    const g = GOODS[gi];
    const p = sec.prices[g.key];
    if (p.side === 'S') {
      const room = u.ship.holds - cargoUsed(u);
      if (room <= 0) { msg = 'Your holds are full. Sell something first.'; continue; }
      const maxQty = Math.min(room, Math.floor(u.credits / p.price));
      if (maxQty <= 0) { msg = `Not enough credits for even one unit at ${p.price} cr.`; continue; }
      const n = await askInt(term, 22, `Buy ${g.name} at ${p.price} cr each (1-${maxQty}, blank cancels):`, 1, maxQty);
      if (n == null) { msg = 'No sale.'; continue; }
      const cost = n * p.price;
      u.credits -= cost;
      u.cargo[g.key] += n;
      u.trades += 1;
      ctx.save();
      msg = `Bought ${n} ${g.name} for ${comma(cost)} cr.`;
    } else {
      const have = u.cargo[g.key] || 0;
      if (have <= 0) { msg = `The port buys ${g.name}, but you have none aboard.`; continue; }
      const n = await askInt(term, 22, `Sell ${g.name} at ${p.price} cr each (1-${have}, blank cancels):`, 1, have);
      if (n == null) { msg = 'No sale.'; continue; }
      const paid = n * p.price;
      u.credits += paid;
      u.cargo[g.key] -= n;
      u.trades += 1;
      ctx.save();
      msg = `Sold ${n} ${g.name} for ${comma(paid)} cr.`;
    }
  }
}

async function titleScreen(term, u, isNew) {
  term.cls();
  bar(term, 1, GAME_NAME, 'A DOOR OF THE MIDNIGHT GATE', 4);
  const ship = [
    '        .-.',
    '   ____/   \\____',
    '  |  o  o  o  o  |',
    '   \\___________/',
  ];
  ship.forEach((t, i) => put(term, 4 + i, 30, t, 11));
  put(term, 9, 27, 'T R A D E   W A R S   3 0 0 1', 14);
  rule(term, 11, '─', 8);
  put(term, 12, 4, 'Sixty sectors. Thirty-five ports. One yard that will tow you home.', 7);
  put(term, 13, 4, 'Buy low, sell dear, and do not let the Corsairs take the cargo.', 7);
  rule(term, 15, '─', 8);
  put(term, 16, 4, `Pilot .......... ${u.handle}`, 15);
  put(term, 17, 4, `Ship ........... ${u.ship.name}, ${u.ship.holds} holds, warp ${u.ship.warp}`, 15);
  put(term, 18, 4, `Credits ........ ${comma(u.credits)}   Turns today: ${u.turns}/${TURNS_PER_DAY}`, 15);
  put(term, 19, 4, `Net worth ...... ${comma(scoreOf(u))}   Kills: ${u.kills}   Losses: ${u.deaths}`, 15);
  rule(term, 21, '─', 8);
  put(term, 22, 4, 'ENTER to launch   ·   ESC to leave the lane', 11);
  status(term, u, isNew ? 'new pilot' : 'pilot on file');
  const k = await term.readKey({ timeoutMs: IDLE_MS });
  return k === 'ESC' ? 'ESC' : 'GO';
}

// -------------------------------------------------------------------- run

async function run(term, ctx) {
  const store = storeOf(ctx);
  const handle = String(ctx.user.handle || 'pilot');
  let u = store.users[handle];
  const isNew = !u;
  if (!u) {
    u = newUser(handle);
    store.users[handle] = u;
    ctx.save();
  }
  // Repair records written by older versions / hand edits.
  u.ship = Object.assign({ name: 'Merchant Cruiser', holds: 20, fighters: 10, shields: 20, warp: 2, fuel: 40 }, u.ship || {});
  u.cargo = Object.assign({ fuelOre: 0, organics: 0, equipment: 0 }, u.cargo || {});
  u.turns = Number.isFinite(u.turns) ? u.turns : TURNS_PER_DAY;
  u.sector = clamp(Number(u.sector) || 1, 1, SECTOR_COUNT);
  u.ship.fuel = clamp(Number(u.ship.fuel) || 0, 0, maxFuel(u.ship));

  const gal = buildGalaxy(store.seed);
  let msg = 'Welcome to the lanes. StarDock is home; the rest is profit.';

  try {
    if (ensureTurns(u)) {
      msg = 'A new day: ' + TURNS_PER_DAY + ' turns on the clock.';
      ctx.save();
    }
    const start = await titleScreen(term, u, isNew);
    if (start === 'ESC') return;

    for (;;) {
      if (ensureTurns(u)) {
        msg = 'A new day: ' + TURNS_PER_DAY + ' turns on the clock.';
        ctx.save();
      }
      const sec = gal.sectors[u.sector];
      drawSector(term, u, gal, msg);
      msg = '';
      const k = await pick(term, 'PWSIMHLQ');
      if (k === 'ESC' || k === 'Q') return;

      if (k === 'P') {
        if (sec.kind !== 'port') {
          msg = 'There is no port here. Try the warp screen.';
          continue;
        }
        msg = await portScreen(term, ctx, u, sec);
        continue;
      }
      if (k === 'S') {
        if (u.sector !== 1) {
          msg = 'The yard is at sector 1. Warp back or pay for a tow.';
          continue;
        }
        msg = await dockScreen(term, ctx, u);
        continue;
      }
      if (k === 'W') {
        if (u.turns <= 0) {
          msg = 'No turns left today. The lanes reopen tomorrow.';
          continue;
        }
        if (u.ship.fuel < 2) {
          msg = 'Fuel tanks dry. Limp to a port? No. Get a tow from StarDock.';
          continue;
        }
        const w = await warpScreen(term, ctx, u, gal);
        if (!w.ok) { msg = w.msg; continue; }
        msg = w.msg;
        // Encounters scale a little with distance and with how far out you are.
        if (Math.random() < 0.20 + w.hops * 0.04) {
          const enemy = makeEnemy(u, u.sector);
          const result = await combat(term, ctx, u, enemy);
          if (result === 'won') msg = w.msg + ' ' + enemy.name + ' destroyed for ' + comma(enemy.bounty) + ' cr.';
          else if (result === 'lost') {
            wipeout(term, ctx, u);
            msg = 'Your ship was disabled. An escape pod dragged you to StarDock.';
          } else msg = w.msg + ' You shook off a ' + enemy.name + '.';
        }
        continue;
      }
      if (k === 'M') {
        await mapScreen(term, u, gal);
        msg = 'Map closed.';
        continue;
      }
      if (k === 'H') {
        await scoresScreen(term, store, u);
        msg = 'The board never lies.';
        continue;
      }
      if (k === 'I') {
        await helpScreen(term, u);
        msg = 'Handbook closed.';
        continue;
      }
      if (k === 'L') {
        if (sec.kind === 'planet') {
          msg = RUMOURS[mix(store.seed, u.sector, 41) % RUMOURS.length];
        } else {
          msg = 'You key the transmitter. Static, then nothing.';
        }
        continue;
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortInput') {
      u.played = Date.now();
      ctx.save();
      return;
    }
    throw e;
  } finally {
    u.played = Date.now();
    try {
      ctx.save();
    } catch { /* storage is the manager's problem, never the pilot's */ }
  }
}

module.exports = {
  id: DOOR_ID,
  name: GAME_NAME,
  author: 'Gate Software',
  category: 'Strategy',
  description: 'Trade cargo across sixty sectors, dodge pirates, and climb the board. 60 turns a day.',
  minLevel: 10,
  players: 'multi',
  run,
  // exported for tests and for the sysop's curiosity
  _internals: { buildGalaxy, buildLanes, route, scoreOf, mix },
};
