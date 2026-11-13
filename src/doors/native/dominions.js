'use strict';
// DOMINIONS — native BBS door (CommonJS, zero dependencies).
//
// Turn-based star conquest in the spirit of the BBS classic. A small galaxy,
// intel that goes stale, and fleets that take a turn or two to arrive: the
// map you scanned is never quite the map you are attacking.
//
// Per-user state: ctx.db.data.doors.dominions.users[handle]

// --------------------------------------------------------------- constants

const DOOR_ID = 'dominions';
const GAME_NAME = 'DOMINIONS';
const SW = 80;
const TURNS_PER_DAY = 40;
const IDLE_MS = 180000;
const HOME_SHIPS = 12;
const SHIP_COST = 25;
const MAX_BUILD = 10;
const INTEL_TICKS = 12;          // intel older than this many actions is stale
const INTEL_MS = 24 * 60 * 60 * 1000; // ...and so is anything a day old
const PLAYER = '*';

const SYSTEM_NAMES = [
  'Sol', 'Cygnus', 'Vega', 'Rigel', 'Altair', 'Deneb', 'Lyra', 'Draco',
  'Orion', 'Carina', 'Nyx', 'Kepler', 'Tharsis', 'Tethys', 'Icarus', 'Boreas',
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

function hashHandle(handle) {
  let h = 0x5bf03635;
  const s = String(handle || 'captain');
  for (let i = 0; i < s.length; i++) h = (Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0);
  return h >>> 0;
}

function dayKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ------------------------------------------------------------------ galaxy

function buildGalaxy(seed, handle) {
  const n = 8 + (seed % 5); // 8..12 systems
  const sys = [];
  for (let i = 0; i < n; i++) {
    sys.push({
      id: i,
      name: SYSTEM_NAMES[(i * 5 + seed) % SYSTEM_NAMES.length],
      owner: null,
      ships: 0,
      defense: 0,
      links: [],
    });
  }
  const link = (a, b) => {
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) return;
    if (!sys[a].links.includes(b)) sys[a].links.push(b);
    if (!sys[b].links.includes(a)) sys[b].links.push(a);
  };
  for (let i = 0; i < n; i++) link(i, (i + 1) % n);
  for (let i = 0; i < n; i++) {
    if (mix(seed, i, 11) % 3 === 0) link(i, (i + 3) % n);
    if (mix(seed, i, 13) % 4 === 0) link(i, (i + 4) % n);
  }
  for (const s of sys) s.links.sort((a, b) => a - b);

  sys[0].owner = handle;
  sys[0].ships = HOME_SHIPS;
  sys[0].defense = 12;

  const empires = ['A', 'B', 'C'];
  for (let i = 1; i < n; i++) {
    const roll = mix(seed, i, 21) % 10;
    if (roll < 6) {
      sys[i].owner = empires[mix(seed, i, 23) % empires.length];
      sys[i].ships = 2 + (mix(seed, i, 27) % 5);
      sys[i].defense = 5 + (mix(seed, i, 29) % 9);
    } else {
      sys[i].owner = null;
      sys[i].ships = 1 + (mix(seed, i, 31) % 3);
      sys[i].defense = 2 + (mix(seed, i, 33) % 3);
    }
  }
  return sys;
}

// ------------------------------------------------------------------- state

function storeOf(ctx) {
  const data = ctx.db.data;
  if (!data.doors) data.doors = {};
  let store = data.doors[DOOR_ID];
  if (!store || typeof store !== 'object') store = data.doors[DOOR_ID] = { users: {} };
  if (!store.users || typeof store.users !== 'object') store.users = {};
  return store;
}

function newUser(handle) {
  const seed = hashHandle(handle) % 100000;
  return {
    handle,
    seed,
    galaxy: buildGalaxy(seed, handle),
    fleets: [],
    intel: {},
    resources: 300,
    turns: TURNS_PER_DAY,
    day: dayKey(),
    tick: 0,
    fleetSeq: 0,
    wins: 0,
    battles: 0,
    captures: 0,
    log: [],
    created: Date.now(),
    played: Date.now(),
  };
}

function repair(u, handle) {
  u.handle = handle;
  u.seed = Number.isFinite(u.seed) ? u.seed : hashHandle(handle) % 100000;
  if (!Array.isArray(u.galaxy) || u.galaxy.length < 8) u.galaxy = buildGalaxy(u.seed, handle);
  u.galaxy.forEach((s, i) => {
    s.id = i;
    s.name = s.name || SYSTEM_NAMES[i % SYSTEM_NAMES.length];
    s.links = Array.isArray(s.links) ? s.links.filter((x) => Number.isInteger(x) && x >= 0 && x < u.galaxy.length && x !== i) : [];
    s.ships = Math.max(0, Math.round(Number(s.ships) || 0));
    s.defense = Math.max(0, Math.round(Number(s.defense) || 0));
    s.owner = s.owner == null ? null : String(s.owner);
  });
  u.fleets = Array.isArray(u.fleets) ? u.fleets.filter((f) => f && Number.isFinite(f.to) && Number.isFinite(f.arrive)) : [];
  u.intel = u.intel && typeof u.intel === 'object' ? u.intel : {};
  u.resources = Math.max(0, Math.round(Number(u.resources) || 0));
  u.turns = Number.isFinite(u.turns) ? Math.max(0, Math.round(u.turns)) : TURNS_PER_DAY;
  u.day = u.day || dayKey();
  u.tick = Math.max(0, Math.round(Number(u.tick) || 0));
  u.fleetSeq = Math.max(0, Math.round(Number(u.fleetSeq) || 0));
  u.wins = Number(u.wins) || 0;
  u.battles = Number(u.battles) || 0;
  u.captures = Number(u.captures) || 0;
  u.log = Array.isArray(u.log) ? u.log.slice(-12) : [];
}

// --------------------------------------------------------------- economy

const systemsOf = (u) => u.galaxy.filter((s) => s.owner === u.handle);
const shipsAt = (u, id) => {
  const s = u.galaxy[id];
  return s && s.owner === u.handle ? s.ships : 0;
};
const transitShips = (u) => u.fleets.filter((f) => f.owner === u.handle).reduce((n, f) => n + (f.ships || 0), 0);
const totalShips = (u) => systemsOf(u).reduce((n, s) => n + s.ships, 0) + transitShips(u);
const allOwned = (u) => u.galaxy.every((s) => s.owner === u.handle);

function scoreOf(u) {
  return Math.round(systemsOf(u).length * 100 + totalShips(u) * 10 + (u.resources || 0) / 2);
}

function intelOf(u, id) {
  const it = u.intel[id];
  return it && typeof it === 'object' ? it : null;
}

function intelStale(u, id) {
  const it = intelOf(u, id);
  if (!it) return false;
  const ageMs = Date.now() - (Number(it.at) || 0);
  const ageTicks = u.tick - (Number(it.tick) || 0);
  return ageMs > INTEL_MS || ageTicks > INTEL_TICKS;
}

function ageLabel(u, id) {
  const it = intelOf(u, id);
  if (!it) return 'never scanned';
  const ticks = Math.max(0, u.tick - (Number(it.tick) || 0));
  if (intelStale(u, id)) return 'STALE ' + (ticks > 0 ? ticks + 't' : '');
  return ticks === 0 ? 'fresh' : ticks + 't ago';
}

function ensureDay(u) {
  const today = dayKey();
  if (u.day === today) return '';
  u.day = today;
  u.turns = TURNS_PER_DAY;
  const owned = systemsOf(u).length;
  u.resources += owned * 60;
  let grew = 0;
  for (const s of u.galaxy) {
    if (s.owner && s.owner !== u.handle) {
      const before = s.ships;
      s.ships = Math.min(30, s.ships + 1);
      if (s.ships !== before) grew += 1;
    }
  }
  return `A new day: ${TURNS_PER_DAY} turns, ${owned * 60} resources from ${owned} system${owned === 1 ? '' : 's'}.` +
    (grew ? ` Rival garrisons grew at ${grew} systems.` : '');
}

// --------------------------------------------------------------- movement

function resolveArrivals(u) {
  const out = [];
  const keep = [];
  for (const f of u.fleets) {
    if (f.arrive > u.tick) {
      keep.push(f);
      continue;
    }
    const sys = u.galaxy[f.to];
    if (!sys) continue;
    if (sys.owner === f.owner) {
      sys.ships += f.ships;
      if (f.owner === u.handle) out.push(`${f.ships} ships join the garrison at ${sys.name}.`);
      continue;
    }
    out.push(...battle(u, f, sys));
  }
  u.fleets = keep;
  return out;
}

function battle(u, fleet, sys) {
  const mine = fleet.owner === u.handle;
  const who = mine ? 'Your' : `${fleet.owner}'s`;
  const atk = fleet.ships * (0.9 + Math.random() * 0.25);
  const dfn = (sys.ships + sys.defense) * (0.9 + Math.random() * 0.25);
  const log = [];
  const guard = sys.ships + sys.defense;
  u.battles += 1;
  if (atk > dfn) {
    const lost = clamp(Math.round(fleet.ships * (dfn / atk) * 0.6), 1, fleet.ships);
    const survive = Math.max(1, fleet.ships - lost);
    sys.owner = fleet.owner;
    sys.ships = survive;
    sys.defense = Math.max(3, Math.round(sys.defense * 0.5));
    log.push(`${who} fleet breaks the defences of ${sys.name} (${fleet.ships} ships against ${guard}).`);
    log.push(`Losses ${lost} ships; ${survive} hold the system.`);
    if (mine) {
      u.captures += 1;
      u.intel[sys.id] = { owner: fleet.owner, ships: survive, defense: sys.defense, at: Date.now(), tick: u.tick };
      log.push(`${sys.name} is yours.`);
    } else {
      log.push(`${sys.name} has fallen to ${fleet.owner}.`);
    }
  } else {
    const lost = Math.max(1, Math.round(fleet.ships * 0.8));
    sys.ships = Math.max(0, sys.ships - Math.round(fleet.ships * 0.35));
    sys.defense = Math.max(1, Math.round(sys.defense * 0.8));
    log.push(`${who} assault on ${sys.name} is thrown back.`);
    log.push(`${lost} ships lost; the garrison holds with ${sys.ships}.`);
    if (mine) u.intel[sys.id] = { owner: sys.owner, ships: sys.ships, defense: sys.defense, at: Date.now(), tick: u.tick };
  }
  return log;
}

// Rival empires launch raids from systems next to yours. Their ships leave the
// garrison, so a system you scanned can look empty with a fleet already inbound.
function maybeRaid(u) {
  if (u.fleets.filter((f) => f.owner !== u.handle).length >= 3) return;
  if (Math.random() > 0.12) return;
  const pairs = [];
  for (const s of u.galaxy) {
    if (!s.owner || s.owner === u.handle) continue;
    for (const id of s.links) {
      const t = u.galaxy[id];
      if (t && t.owner === u.handle) pairs.push({ from: s, to: t });
    }
  }
  if (!pairs.length) return;
  const p = pairs[Math.floor(Math.random() * pairs.length)];
  const ships = Math.round(p.from.ships * 0.5);
  if (ships < 2) return;
  p.from.ships -= ships;
  u.fleetSeq += 1;
  u.fleets.push({
    id: u.fleetSeq,
    owner: p.from.owner,
    ships,
    from: p.from.id,
    to: p.to.id,
    arrive: u.tick + 2,
  });
}

function advance(u) {
  u.tick += 1;
  const out = resolveArrivals(u);
  maybeRaid(u);
  if (out.length) u.log = u.log.concat(out).slice(-12);
  return out;
}

function scanSystem(u, id) {
  const s = u.galaxy[id];
  u.intel[id] = { owner: s.owner, ships: s.ships, defense: s.defense, at: Date.now(), tick: u.tick };
  return u.intel[id];
}

// --------------------------------------------------------------- rendering

function put(term, row, col, text, fg, bg) {
  const maxRow = Math.min(term.rows || 25, 25);
  if (row < 1 || row > maxRow || col < 1 || col > SW) return;
  const max = SW - col + 1;
  let s = String(text == null ? '' : text);
  if (s.length > max) s = s.slice(0, max);
  term.print(row, col, s, fg, bg);
}

function rule(term, row, ch, fg) {
  put(term, row, 1, String(ch || '─').repeat(SW), fg);
}

function bar(term, row, left, right, bg) {
  put(term, row, 1, ' '.repeat(SW), 15, bg || 4);
  put(term, row, 2, pad(left, 48), 15, bg || 4);
  if (right) put(term, row, SW - String(right).length - 1, right + ' ', 15, bg || 4);
}

function status(term, u, extra) {
  const t = ' ' + GAME_NAME + '  ·  ' + u.handle + '  ·  ' + u.turns + ' turns  ·  ' + u.resources +
    ' res  ·  ' + systemsOf(u).length + '/' + u.galaxy.length + ' systems' + (extra ? '  ·  ' + extra : '');
  put(term, term.rows || 25, 1, pad(t, SW), 0, 7);
}

function symbolFor(u, s) {
  if (s.owner === u.handle) return PLAYER;
  const it = intelOf(u, s.id);
  if (!it) return '?';
  if (it.owner === u.handle) return PLAYER;
  if (it.owner) return String(it.owner).slice(0, 1).toUpperCase();
  return '.';
}

function ownerColour(u, s) {
  if (s.owner === u.handle) return 10;
  if (!intelOf(u, s.id)) return 8;
  return 14;
}

function intelLine(u, s) {
  if (s.owner === u.handle) return 'your garrison';
  const it = intelOf(u, s.id);
  if (!it) return 'unexplored';
  if (intelStale(u, s.id)) return 'intel stale';
  return 'scanned ' + ageLabel(u, s.id);
}

// --------------------------------------------------------------- screens

function drawMap(term, u, msg) {
  term.cls();
  const n = u.galaxy.length;
  const held = systemsOf(u).length;
  bar(term, 1, GAME_NAME, 'TURN ' + u.turns + '/' + TURNS_PER_DAY, 4);
  put(term, 2, 2, 'CAPTAIN ' + u.handle, 14);
  put(term, 2, 32, `RES ${comma(u.resources)}`, 10);
  put(term, 2, 48, `SYSTEMS ${held}/${n}`, 11);
  put(term, 2, 64, `SCORE ${comma(scoreOf(u))}`, 13);
  rule(term, 3, '═', 11);
  put(term, 4, 2, "'*' yours   A/B/C rival   '.' empty   '?' unexplored   '~' stale intel", 8);
  put(term, 5, 2, '#', 8);
  put(term, 5, 5, 'SYSTEM', 8);
  put(term, 5, 21, 'OWN', 8);
  put(term, 5, 26, 'SHIPS', 8);
  put(term, 5, 34, 'DEF', 8);
  put(term, 5, 41, 'LANES', 8);
  put(term, 5, 58, 'INTEL', 8);
  rule(term, 6, '─', 8);

  for (let i = 0; i < n; i++) {
    const s = u.galaxy[i];
    const row = 7 + i;
    const it = intelOf(u, i);
    const mine = s.owner === u.handle;
    const ships = mine ? String(s.ships) : (it ? String(it.ships) : '?');
    const def = mine ? String(s.defense) : (it ? String(it.defense) : '?');
    const stale = !mine && intelStale(u, i);
    put(term, row, 2, padl(String(i + 1), 2), mine ? 10 : 8);
    put(term, row, 5, pad(s.name, 15), mine ? 10 : 15);
    put(term, row, 21, pad(symbolFor(u, s), 3), ownerColour(u, s));
    put(term, row, 26, padl(ships + (stale ? '~' : ''), 6), stale ? 8 : 15);
    put(term, row, 34, padl(def, 5), stale ? 8 : 7);
    put(term, row, 41, pad(s.links.map((x) => x + 1).join(','), 16), 8);
    put(term, row, 58, pad(intelLine(u, s), 21), mine ? 10 : (stale ? 8 : 7));
  }

  const transit = u.fleets.filter((f) => f.owner === u.handle);
  put(term, 19, 2, `FLEETS IN TRANSIT (${transit.length})`, 8);
  const base = 20;
  if (!transit.length) {
    put(term, base, 4, 'none — every hull is in harbour', 8);
  } else {
    transit.slice(0, 2).forEach((f, i) => {
      const to = u.galaxy[f.to];
      const eta = Math.max(1, f.arrive - u.tick);
      put(term, base + i, 4, pad(`${f.ships} ships → ${to ? to.name : '?'} (arrives in ${eta} turn${eta === 1 ? '' : 's'})`, 74), 14);
    });
    if (transit.length > 2) put(term, base + 2, 4, `…and ${transit.length - 2} more fleet${transit.length - 2 === 1 ? '' : 's'} under way`, 8);
  }

  const msgRow = 23;
  put(term, msgRow, 1, ' '.repeat(SW), 7);
  term.wrap(String(msg || ''), SW - 4).slice(0, 1).forEach((t) => put(term, msgRow, 3, t, 14));
  put(term, 24, 2, 'Command: ', 14);
  status(term, u, 'ESC leaves');
}

function drawScan(term, u, msg) {
  term.cls();
  const n = u.galaxy.length;
  bar(term, 1, 'LONG-RANGE SCAN', 'TURN ' + u.turns + '/' + TURNS_PER_DAY, 6);
  put(term, 2, 2, 'One turn per sweep. Readings age: a day or twelve actions and they lie.', 8);
  rule(term, 3, '═', 11);
  put(term, 4, 2, '#', 8);
  put(term, 4, 5, 'SYSTEM', 8);
  put(term, 4, 22, 'OWNER', 8);
  put(term, 4, 30, 'SHIPS', 8);
  put(term, 4, 38, 'DEF', 8);
  put(term, 4, 46, 'INTEL', 8);
  rule(term, 5, '─', 8);
  for (let i = 0; i < n; i++) {
    const s = u.galaxy[i];
    const it = intelOf(u, i);
    const mine = s.owner === u.handle;
    const row = 6 + i;
    put(term, row, 2, padl(String(i + 1), 2), 8);
    put(term, row, 5, pad(s.name, 16), 15);
    put(term, row, 22, pad(symbolFor(u, s), 6), ownerColour(u, s));
    put(term, row, 30, padl(mine ? String(s.ships) : (it ? String(it.ships) : '?'), 6), 15);
    put(term, row, 38, padl(mine ? String(s.defense) : (it ? String(it.defense) : '?'), 4), 7);
    put(term, row, 46, pad(mine ? 'your garrison' : ageLabel(u, i), 20), mine ? 10 : (intelStale(u, i) ? 8 : 7));
  }
  put(term, 19, 3, 'Scanning reveals ships and works — but not fleets already under way.', 8);
  put(term, 21, 3, pad(String(msg || ''), SW - 4), 14);
  put(term, 23, 2, `Scan which system? (1-${n}, blank cancels): `, 14);
  status(term, u);
}

function drawMove(term, u, owned, from, msg) {
  term.cls();
  bar(term, 1, 'FLEET COMMAND', 'TURN ' + u.turns + '/' + TURNS_PER_DAY, 1);
  put(term, 2, 2, `FLEETS ${u.fleets.filter((f) => f.owner === u.handle).length} under way`, 8);
  put(term, 2, 42, 'Travel 1-2 turns; arrivals fight.', 8);
  rule(term, 3, '═', 11);
  put(term, 4, 2, 'YOUR SYSTEMS', 8);
  owned.slice(0, 8).forEach((s, i) => {
    put(term, 5 + i, 3, `[${i + 1}]`, 14);
    put(term, 5 + i, 7, pad(s.name, 16), 10);
    put(term, 5 + i, 24, `${s.ships} ships`, 15);
  });
  if (owned.length > 8) put(term, 13, 3, `…and ${owned.length - 8} more`, 8);
  rule(term, 14, '─', 8);
  if (!from) {
    put(term, 15, 3, 'Choose a source system first.', 8);
  } else {
    const dests = from.links.map((id) => u.galaxy[id]).filter(Boolean);
    put(term, 15, 3, `FROM ${from.name} (${from.ships} ships) — choose a lane:`, 11);
    dests.slice(0, 6).forEach((d, i) => {
      put(term, 16 + i, 3, `[${i + 1}]`, 14);
      put(term, 16 + i, 7, pad(d.name, 16), 15);
      put(term, 16 + i, 24, `${symbolFor(u, d)}  ${intelOf(u, d) ? (intelStale(u, d) ? 'stale intel' : 'scanned') : 'unexplored'}`, 8);
    });
  }
  put(term, 22, 3, pad(String(msg || ''), SW - 4), 14);
  status(term, u);
}

function drawBuild(term, u, msg) {
  const home = u.galaxy[0];
  term.cls();
  bar(term, 1, 'ORBITAL YARD', 'HOME SYSTEM', 2);
  put(term, 2, 2, `RESOURCES ${comma(u.resources)}`, 10);
  put(term, 2, 30, `${SHIP_COST} per hull`, 8);
  put(term, 2, 52, `HOME ${home.name}: ${home.owner === u.handle ? home.ships + ' ships' : 'LOST'}`, home.owner === u.handle ? 11 : 12);
  rule(term, 3, '═', 11);
  put(term, 5, 3, 'The yard lays down hulls at your home system only.', 7);
  put(term, 6, 3, `Each hull costs ${SHIP_COST} resources. Ten hulls is one turn of work.`, 7);
  put(term, 7, 3, `Affordable now: ${Math.min(MAX_BUILD, Math.floor(u.resources / SHIP_COST))} hulls.`, 11);
  put(term, 9, 3, 'New hulls join the home garrison, ready to be sent out.', 8);
  put(term, 11, 3, pad(String(msg || ''), SW - 4), 14);
  put(term, 14, 2, 'Build how many ships? ', 14);
  status(term, u);
}

function drawReport(term, u) {
  const owned = systemsOf(u);
  term.cls();
  bar(term, 1, 'EMPIRE REPORT', 'THE ADMIRALTY', 3);
  put(term, 2, 2, `${u.handle} · day ${u.day} · tick ${u.tick}`, 14);
  rule(term, 3, '═', 11);
  const garrison = owned.reduce((n, s) => n + s.ships, 0);
  const transit = transitShips(u);
  const rows = [
    ['Systems', `${owned.length} of ${u.galaxy.length} · ${owned.map((s) => s.name).join(', ').slice(0, 50)}`],
    ['Fleet', `${garrison} in harbour · ${transit} in transit · ${garrison + transit} total`],
    ['Yards', `${comma(u.resources)} resources · +${owned.length * 60}/day · ${SHIP_COST} per hull`],
    ['Turns', `${u.turns} left today, ${TURNS_PER_DAY} granted at the day change`],
    ['Record', `${u.battles} battles · ${u.captures} captures · ${u.wins} galaxies won`],
    ['Score', `${comma(scoreOf(u))}`],
    ['Victory', allOwned(u) ? 'the galaxy is yours' : `${u.galaxy.length - owned.length} systems still outside your flag`],
  ];
  rows.forEach((r, i) => {
    put(term, 4 + i, 3, pad(r[0], 10) + ':', 8);
    put(term, 4 + i, 15, pad(r[1], SW - 16), 15);
  });
  rule(term, 12, '─', 8);
  put(term, 13, 3, 'INTEL', 8);
  put(term, 13, 20, 'SHIPS', 8);
  put(term, 13, 30, 'DEF', 8);
  put(term, 13, 40, 'AGE', 8);
  const list = u.galaxy.map((s, i) => ({ s, it: intelOf(u, i) })).filter((x) => x.it || x.s.owner === u.handle).slice(0, 6);
  if (!list.length) put(term, 14, 4, 'No intel at all. Scan something.', 8);
  list.forEach((x, i) => {
    put(term, 14 + i, 3, pad(x.s.name, 16), x.s.owner === u.handle ? 10 : 15);
    put(term, 14 + i, 20, padl(String(x.s.owner === u.handle ? x.s.ships : x.it.ships), 6), 15);
    put(term, 14 + i, 30, padl(String(x.s.owner === u.handle ? x.s.defense : x.it.defense), 4), 7);
    put(term, 14 + i, 40, pad(x.s.owner === u.handle ? 'your garrison' : ageLabel(u, x.s.id), 20), x.s.owner === u.handle ? 10 : (intelStale(u, x.s.id) ? 8 : 7));
  });
  put(term, 22, 4, 'Press any key to return to the bridge.', 8);
  status(term, u);
}

function drawScores(term, users, me, page) {
  const rows = users.slice().sort((a, b) =>
    systemsOf(b).length - systemsOf(a).length || totalShips(b) - totalShips(a));
  const perPage = 10;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const p = clamp(page, 0, pages - 1);
  term.cls();
  bar(term, 1, GAME_NAME + '  ·  ADMIRALTY BOARD', `PAGE ${p + 1}/${pages}`, 5);
  put(term, 2, 2, 'Ranked by systems held, then hulls in service.', 8);
  rule(term, 3, '═', 11);
  put(term, 4, 2, 'RANK', 8);
  put(term, 4, 9, 'CAPTAIN', 8);
  put(term, 4, 31, 'SYSTEMS', 8);
  put(term, 4, 42, 'SHIPS', 8);
  put(term, 4, 52, 'RESOURCES', 8);
  put(term, 4, 66, 'SCORE', 8);
  rule(term, 5, '─', 8);
  if (!rows.length) put(term, 7, 4, 'No captains on the board yet.', 8);
  rows.slice(p * perPage, p * perPage + perPage).forEach((u, i) => {
    const row = 6 + i;
    const mine = me && u.handle === me.handle;
    put(term, row, 2, padl(String(p * perPage + i + 1), 4), mine ? 10 : 14);
    put(term, row, 9, pad(u.handle, 21), mine ? 10 : 15);
    put(term, row, 31, padl(`${systemsOf(u).length}/${u.galaxy.length}`, 8), 11);
    put(term, row, 42, padl(comma(totalShips(u)), 8), 15);
    put(term, row, 52, padl(comma(u.resources), 10), 10);
    put(term, row, 66, padl(comma(scoreOf(u)), 10), 13);
  });
  put(term, 22, 4, '[SPACE] next page   [ESC] back to the bridge', 8);
  status(term, me);
}

function drawHelp(term, u) {
  term.cls();
  bar(term, 1, 'STAR CHARTS & RULES', 'READ BEFORE YOU JUMP', 1);
  rule(term, 2, '═', 11);
  const text = [
    'The galaxy holds eight to twelve systems joined by lanes. You start with',
    'one home system and twelve ships. Hold every system to win the galaxy.',
    '',
    'SCAN costs a turn and writes down a system\'s owner, hulls and works.',
    'Intel is not the truth: it is a photograph. After a day, or twelve of',
    'your actions, it is STALE (shown with ~). A system scanned as empty can',
    'be full by the time your fleet arrives, and a system that reads defended',
    'may have sent its fleet away while you were reading the screen.',
    '',
    'MOVE sends hulls down a lane; travel takes one or two turns, so they sit',
    'in transit and cannot defend either end. Arrivals at your own system join',
    'the garrison. Arrivals anywhere else fight immediately: ships plus the',
    'system\'s defence works against your hulls, and the survivor holds it.',
    '',
    'BUILD lays down hulls at home only: 25 resources, ten to a turn.',
    'Systems pay 60 resources a day each. Rivals grow a hull a day and raid',
    'across the lanes; they too take two turns to arrive.',
  ];
  text.forEach((t, i) => put(term, 4 + i, 3, pad(t, SW - 4), 7));
  put(term, 22, 4, 'Press any key to return to the bridge.', 8);
  status(term, u, 'ESC leaves');
}

function drawVictory(term, u) {
  term.cls();
  bar(term, 1, 'THE GALAXY IS YOURS', 'VICTORY', 5);
  rule(term, 2, '═', 11);
  const art = [
    '        *        .        *       .      *    ',
    '   .        *        .        *        .      ',
    '      *          *         *          *       ',
  ];
  art.forEach((t, i) => put(term, 4 + i, 18, t, 11));
  put(term, 8, 22, 'E V E R Y   S T A R   F L I E S   Y O U R   F L A G', 14);
  put(term, 11, 4, `${u.handle} holds all ${u.galaxy.length} systems with ${totalShips(u)} hulls.`, 15);
  put(term, 12, 4, `Battles ${u.battles} · captures ${u.captures} · score ${comma(scoreOf(u))}`, 11);
  put(term, 14, 4, 'The Admiralty will chart a new galaxy when you are ready.', 7);
  status(term, u, 'victory');
}

// ------------------------------------------------------------------ input

async function pick(term, valid, row, col) {
  for (;;) {
    if (row) term.gotoxy(row, col || 1);
    const k = await term.readKey({ timeoutMs: IDLE_MS });
    if (k == null) continue;
    if (k === 'ENTER') return 'ENTER';
    if (k === 'ESC') return 'ESC';
    if (k === 'SPACE') {
      if (!valid || valid.indexOf(' ') >= 0) {
        term.write(' ');
        return 'SPACE';
      }
      term.beep();
      continue;
    }
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
    put(term, row, 2, pad(label, 70), 14);
    let raw;
    try {
      raw = await term.readLine({ prompt: '', max: 6, allowEmpty: true });
    } catch (e) {
      if (e && e.name === 'AbortInput') return null;
      throw e;
    }
    const s = String(raw || '').trim();
    if (!s) return null;
    if (!/^\d+$/.test(s)) {
      put(term, row + 1, 1, pad('  Numbers only, captain.', SW - 1), 12);
      continue;
    }
    const n = parseInt(s, 10);
    if (n < lo || n > hi) {
      put(term, row + 1, 1, pad(`  Between ${lo} and ${hi}, captain.`, SW - 1), 12);
      continue;
    }
    return n;
  }
  return null;
}

async function press(term, row, label) {
  put(term, row, 1, pad('  ' + label, SW - 1), 8);
  await term.readKey({ timeoutMs: IDLE_MS });
}

// ----------------------------------------------------------------- actions

async function screenScan(term, ctx, u) {
  let msg = '';
  for (;;) {
    drawScan(term, u, msg);
    msg = '';
    const id = await askInt(term, 23, `Scan which system? (1-${u.galaxy.length}, blank cancels):`, 1, u.galaxy.length);
    if (id == null) return 'Scan console idle.';
    if (u.turns <= 0) { msg = 'No turns left today. The array cools until tomorrow.'; continue; }
    u.turns -= 1;
    advance(u);
    const s = u.galaxy[id - 1];
    const it = scanSystem(u, id - 1);
    ctx.save();
    msg = it.owner
      ? `${s.name}: ${it.owner === u.handle ? 'yours' : 'held by ' + it.owner}, ${it.ships} ships, works ${it.defense}.`
      : `${s.name}: empty of flags, ${it.ships} ships, works ${it.defense}.`;
    return msg;
  }
}

async function screenMove(term, ctx, u) {
  const owned = systemsOf(u);
  if (!owned.length) return 'You hold no systems. There is nowhere to sail from.';
  drawMove(term, u, owned, null, '');
  const pickFrom = await askInt(term, 20, `From which system? (1-${Math.min(owned.length, 8)}, blank cancels):`, 1, Math.min(owned.length, 8));
  if (pickFrom == null) return 'No fleet sails.';
  const from = owned[pickFrom - 1];
  const dests = from.links.map((id) => u.galaxy[id]).filter(Boolean);
  if (!dests.length) return `${from.name} has no lanes out of it.`;
  drawMove(term, u, owned, from, '');
  const pickTo = await askInt(term, 22, `To which lane? (1-${Math.min(dests.length, 6)}, blank cancels):`, 1, Math.min(dests.length, 6));
  if (pickTo == null) return 'No fleet sails.';
  const to = dests[pickTo - 1];
  if (from.ships <= 0) return `${from.name} has no hulls to send.`;
  const qty = await askInt(term, 23, `How many ships? (1-${from.ships}, blank cancels):`, 1, from.ships);
  if (qty == null) return 'No fleet sails.';
  if (u.turns <= 0) return 'No turns left today. The fleet waits in harbour.';
  u.turns -= 1;
  advance(u);
  const src = u.galaxy[from.id];
  const send = Math.min(qty, src.ships);
  if (send <= 0) {
    ctx.save();
    return `${from.name} has no hulls left to send after the last arrivals.`;
  }
  const travel = 1 + (mix(u.seed, src.id, to.id) % 2);
  src.ships -= send;
  u.fleetSeq += 1;
  u.fleets.push({ id: u.fleetSeq, owner: u.handle, ships: send, from: src.id, to: to.id, arrive: u.tick + travel });
  ctx.save();
  return `${send} ships leave ${src.name} for ${to.name}; ${travel} turn${travel === 1 ? '' : 's'} in the dark.`;
}

async function screenBuild(term, ctx, u) {
  let msg = '';
  const home = u.galaxy[0];
  for (;;) {
    drawBuild(term, u, msg);
    msg = '';
    if (home.owner !== u.handle) {
      msg = 'The yard is lost with the home system. Take it back first.';
      return msg;
    }
    if (u.turns <= 0) return 'No turns left today; the yard stands idle.';
    const maxQty = Math.min(MAX_BUILD, Math.floor(u.resources / SHIP_COST));
    if (maxQty <= 0) return `A hull costs ${SHIP_COST} resources. Not enough ore.`;
    const qty = await askInt(term, 14, `Build how many ships? (1-${maxQty}, blank cancels):`, 1, maxQty);
    if (qty == null) return 'The yard stands down.';
    u.turns -= 1;
    advance(u);
    u.resources -= qty * SHIP_COST;
    u.galaxy[0].ships += qty;
    ctx.save();
    msg = `${qty} hull${qty === 1 ? '' : 's'} commissioned at ${home.name} for ${qty * SHIP_COST} resources.`;
  }
}

async function screenReport(term, u) {
  drawReport(term, u);
  await term.readKey({ timeoutMs: IDLE_MS });
}

async function screenHelp(term, u) {
  drawHelp(term, u);
  await term.readKey({ timeoutMs: IDLE_MS });
}

async function screenScores(term, store, me) {
  let page = 0;
  const users = Object.keys(store.users).map((h) => store.users[h]);
  for (;;) {
    drawScores(term, users, me, page);
    const k = await pick(term, ' ', 22, 47);
    if (k !== 'SPACE') return;
    page = (page + 1) % Math.max(1, Math.ceil(users.length / 10));
  }
}

async function victory(term, ctx, u) {
  drawVictory(term, u);
  await press(term, 20, 'Every system answers to you. Press a key.');
  const again = await term.yesno('Chart a new galaxy', true);
  if (!again) return false;
  u.wins += 1;
  u.seed = (u.seed + 17) % 100000;
  u.galaxy = buildGalaxy(u.seed, u.handle);
  u.fleets = [];
  u.intel = {};
  u.resources = 300;
  u.tick = 0;
  ctx.save();
  return true;
}

async function titleScreen(term, u, isNew) {
  term.cls();
  bar(term, 1, GAME_NAME, 'A DOOR OF THE MIDNIGHT GATE', 1);
  const art = [
    '      .           *                .        ',
    '   *        .-""-.       .        *         ',
    '        .-"/      \\  .        .             ',
    '   .   /  |  \u00b7  \u00b7  |  \\          *          ',
    '       \\  \\      /  /     .                 ',
    '    *    \\  "-..-"  /          .            ',
    '          \\        /                        ',
  ];
  art.forEach((t, i) => put(term, 3 + i, 18, t, 11));
  put(term, 10, 24, 'D O M I N I O N S', 14);
  rule(term, 12, '─', 8);
  put(term, 13, 4, 'Eight stars and a scanner that lies to you. Every fleet arrives late.', 7);
  put(term, 14, 4, 'Scan often, remember the timestamp, and never trust an empty system.', 7);
  rule(term, 16, '─', 8);
  put(term, 17, 4, `Captain ......... ${u.handle}`, 15);
  put(term, 18, 4, `Command ......... ${systemsOf(u).length} of ${u.galaxy.length} systems, ${totalShips(u)} ships`, 15);
  put(term, 19, 4, `Yards ........... ${comma(u.resources)} resources · turns ${u.turns}/${TURNS_PER_DAY}`, 15);
  put(term, 20, 4, `Score ........... ${comma(scoreOf(u))}`, 15);
  rule(term, 21, '─', 8);
  put(term, 22, 4, 'ENTER to take the bridge   ·   ESC to leave the sector', 11);
  status(term, u, isNew ? 'new command' : 'command on file');
  const k = await term.readKey({ timeoutMs: IDLE_MS });
  return k === 'ESC' ? 'ESC' : 'GO';
}

// -------------------------------------------------------------------- run

async function run(term, ctx) {
  const store = storeOf(ctx);
  const handle = String(ctx.user.handle || 'captain');
  let u = store.users[handle];
  const isNew = !u;
  if (!u) {
    u = newUser(handle);
    store.users[handle] = u;
    ctx.save();
  }
  repair(u, handle);

  let msg = isNew ? 'You inherit one system, twelve hulls and a lot of empty space.' : 'The bridge is yours, captain.';
  try {
    const rolled = ensureDay(u);
    if (rolled) { msg = rolled; ctx.save(); }
    const start = await titleScreen(term, u, isNew);
    if (start === 'ESC') return;

    for (;;) {
      const day = ensureDay(u);
      if (day) { msg = day; ctx.save(); }
      if (allOwned(u) && u.galaxy.length > 1) {
        const fresh = await victory(term, ctx, u);
        if (!fresh) return;
        msg = 'A new galaxy. Same fog.';
        continue;
      }
      drawMap(term, u, msg);
      msg = '';
      const k = await pick(term, 'SMBRPHQ', 24, 11);
      if (k === 'ESC' || k === 'Q') return;
      if (k === 'S') { msg = await screenScan(term, ctx, u); continue; }
      if (k === 'M') { msg = await screenMove(term, ctx, u); continue; }
      if (k === 'B') { msg = await screenBuild(term, ctx, u); continue; }
      if (k === 'R') { await screenReport(term, u); msg = 'Report filed.'; continue; }
      if (k === 'P') { await screenHelp(term, u); msg = 'Charts put away.'; continue; }
      if (k === 'H') {
        await screenScores(term, store, u);
        msg = 'The board is posted.';
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
    } catch { /* storage is the manager's problem */ }
  }
}

module.exports = {
  id: DOOR_ID,
  name: GAME_NAME,
  author: 'Gate Software',
  category: 'Strategy',
  description: 'Take a small galaxy with stale intel and fleets that arrive two turns late. 40 turns a day.',
  minLevel: 10,
  players: 'multi',
  run,
  _internals: {
    buildGalaxy,
    newUser,
    repair,
    ensureDay,
    scoreOf,
    scanSystem,
    advance,
    resolveArrivals,
    battle,
    systemsOf,
    totalShips,
    allOwned,
    intelStale,
    screenScan,
    screenMove,
    screenBuild,
    drawMap,
  },
};
