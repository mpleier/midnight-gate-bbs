'use strict';
// BARREN REALMS — native BBS door (CommonJS, zero dependencies).
//
// Empire management in the spirit of Barren Realms Elite. Every caller rules
// one realm: wild acres, five kinds of buildings, people, a host, gold and
// food. Forty turns a day; each order costs turns, and the day rollover runs
// the harvest, the tax collector and the recruiting sergeants.
//
// Per-user state: ctx.db.data.doors['barren-realms'].users[handle]

// --------------------------------------------------------------- constants

const DOOR_ID = 'barren-realms';
const GAME_NAME = 'BARREN REALMS';
const SW = 80; // design width; wider would wrap on an 80-column caller
const TURNS_PER_DAY = 40;
const ATTACK_TURNS = 3;
const MAX_BUILD = 50;
const IDLE_MS = 180000;
const RECRUIT_COST = 14;
const RECRUIT_PER_TURN = 25;
const REALM_COUNT = 8;

const BUILDINGS = [
  { key: 'houses', name: 'Houses', cost: 120, blurb: '+30 people can live here' },
  { key: 'farms', name: 'Farms', cost: 90, blurb: '+90 food every harvest' },
  { key: 'barracks', name: 'Barracks', cost: 200, blurb: '+60 soldiers you can keep' },
  { key: 'markets', name: 'Markets', cost: 160, blurb: '+45 gold every day' },
  { key: 'walls', name: 'Walls', cost: 140, blurb: '+25 defence against raids' },
];

const REALM_NAMES = [
  'Ashfell', 'Dunmoor', 'Greyhollow', 'Thornwick', 'Barrowmere', 'Coldharbour',
  'Rookwood', 'Saltfen', 'Mirebank', 'Highwatch', 'Duskvale', 'Ironmarch',
  'Fenwick', 'Blackmoor', 'Stonecross', 'Widowfield',
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
  let h = 0x1f2e3d4c;
  const s = String(handle || 'realm');
  for (let i = 0; i < s.length; i++) h = (Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0);
  return h >>> 0;
}

function dayKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function daySerial(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return 20260101;
  return parseInt(m[1], 10) * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
}

// ------------------------------------------------------------------ state

function storeOf(ctx) {
  const data = ctx.db.data;
  if (!data.doors) data.doors = {};
  let store = data.doors[DOOR_ID];
  if (!store || typeof store !== 'object') store = data.doors[DOOR_ID] = { users: {} };
  if (!store.users || typeof store.users !== 'object') store.users = {};
  return store;
}

function newUser(handle) {
  const seed = hashHandle(handle);
  return {
    handle,
    seed,
    land: 120,
    buildings: { houses: 4, farms: 4, barracks: 2, markets: 1, walls: 0 },
    population: 140,
    army: 40,
    gold: 2000,
    food: 600,
    turns: TURNS_PER_DAY,
    day: dayKey(),
    attacks: 0,
    wins: 0,
    losses: 0,
    conquered: 0,
    npcs: [],
    created: Date.now(),
    played: Date.now(),
  };
}

// Economy -------------------------------------------------------------

const devUsed = (u) => BUILDINGS.reduce((n, b) => n + (u.buildings[b.key] || 0), 0);
const freeLand = (u) => Math.max(0, (u.land || 0) - devUsed(u));
const popCap = (u) => 40 + (u.buildings.houses || 0) * 30;
const foodProd = (u) => Math.round((u.buildings.farms || 0) * 90);
const foodNeed = (u) => Math.round((u.population || 0) * 1.1);
const goldIncome = (u) => Math.round((u.population || 0) * 0.55 + (u.buildings.markets || 0) * 45);
const armyUpkeep = (u) => Math.round((u.army || 0) * 0.35);
const armyCap = (u) => 20 + (u.buildings.barracks || 0) * 60;
const defenseRating = (u) => Math.round((u.army || 0) + (u.buildings.walls || 0) * 25 + (u.land || 0) * 0.2);
const barracksBonus = (u) => 1 + (u.buildings.barracks || 0) * 0.004;

function scoreOf(u) {
  const dev = devUsed(u);
  return Math.round(
    (u.land || 0) * 10 + dev * 6 + (u.army || 0) * 3 +
    Math.floor((u.gold || 0) / 20) + Math.floor((u.food || 0) / 40) + (u.wins || 0) * 50,
  );
}

function marketPrices(u) {
  const s = daySerial(u.day) + (u.seed || 1);
  const buy = 0.9 + (mix(u.seed || 1, s, 3) % 40) / 100;
  return { buy: Math.round(buy * 100) / 100, sell: Math.round(buy * 0.72 * 100) / 100 };
}

// Rival realms: generated per user, scaled to the player's land, and kept
// alive (weaker but not free) by the daily growth pass.
function makeRealm(u, i) {
  const seed = u.seed || 1;
  const scale = 0.35 + i * 0.085 + (mix(seed, i, 3) % 40) / 200;
  const land = Math.max(40, Math.round(((u.land || 120) * scale) / 10) * 10);
  const defense = Math.max(12, Math.round((10 + land * 0.7) * (0.45 + (mix(seed, i, 7) % 60) / 100 + i * 0.02)));
  return {
    id: i + 1,
    name: REALM_NAMES[(i * 3 + (seed % 5)) % REALM_NAMES.length],
    land,
    defense,
    gold: Math.round(land * 4.5),
    food: Math.round(land * 6),
    conquered: 0,
  };
}

function ensureNpcs(u) {
  if (!Array.isArray(u.npcs) || u.npcs.length !== REALM_COUNT) {
    u.npcs = [];
    for (let i = 0; i < REALM_COUNT; i++) u.npcs.push(makeRealm(u, i));
    return;
  }
  u.npcs.forEach((r, i) => {
    r.id = i + 1;
    r.name = r.name || REALM_NAMES[i % REALM_NAMES.length];
    r.land = Math.max(20, Math.round(Number(r.land) || 60));
    r.defense = Math.max(5, Math.round(Number(r.defense) || 20));
    r.gold = Math.max(0, Math.round(Number(r.gold) || 0));
    r.food = Math.max(0, Math.round(Number(r.food) || 0));
    r.conquered = Number(r.conquered) || 0;
  });
}

function repair(u, handle) {
  u.handle = handle;
  u.seed = Number.isFinite(u.seed) ? u.seed : hashHandle(handle);
  u.land = Math.max(20, Math.round(Number(u.land) || 120));
  const b = Object.assign({ houses: 4, farms: 4, barracks: 2, markets: 1, walls: 0 }, u.buildings || {});
  u.buildings = {};
  for (const t of BUILDINGS) u.buildings[t.key] = Math.max(0, Math.round(Number(b[t.key]) || 0));
  u.population = Math.max(0, Math.round(Number(u.population) || 0));
  u.army = Math.max(0, Math.round(Number(u.army) || 0));
  u.gold = Math.max(0, Math.round(Number(u.gold) || 0));
  u.food = Math.max(0, Math.round(Number(u.food) || 0));
  u.turns = Number.isFinite(u.turns) ? Math.max(0, Math.round(u.turns)) : TURNS_PER_DAY;
  u.day = u.day || dayKey();
  u.attacks = Number(u.attacks) || 0;
  u.wins = Number(u.wins) || 0;
  u.losses = Number(u.losses) || 0;
  u.conquered = Number(u.conquered) || 0;
  ensureNpcs(u);
  // Land can never be over-developed after a hand edit.
  const used = devUsed(u);
  if (used > u.land) {
    let over = used - u.land;
    for (let i = BUILDINGS.length - 1; i >= 0 && over > 0; i--) {
      const k = BUILDINGS[i].key;
      const take = Math.min(u.buildings[k], over);
      u.buildings[k] -= take;
      over -= take;
    }
  }
}

// One day's economy. Returns the lines the steward reads out.
function dailyTick(u) {
  const notes = [];
  const cap = popCap(u);
  const prod = foodProd(u);
  const eat = foodNeed(u);
  const income = goldIncome(u);
  const upkeep = armyUpkeep(u);

  u.food = (u.food || 0) + prod - eat;
  if (u.food < 0) {
    const starve = Math.min(u.population || 0, Math.max(1, Math.ceil(-u.food / 1.1)));
    u.population -= starve;
    u.food = 0;
    notes.push(`${starve} people starved when the granary ran dry.`);
  }
  u.gold = (u.gold || 0) + income - upkeep;
  if (u.gold < 0) {
    const desert = Math.min(u.army || 0, Math.max(1, Math.ceil(-u.gold / RECRUIT_COST)));
    u.army -= desert;
    u.gold = 0;
    notes.push(`${desert} soldiers deserted; the pay chest was empty.`);
  }
  if (u.population < cap) {
    const born = Math.max(1, Math.round((cap - u.population) * 0.12));
    u.population = Math.min(cap, u.population + born);
    if (born > 1) notes.push(`${born} children were born into the realm.`);
  } else if (u.population > cap) {
    const left = Math.max(1, Math.round((u.population - cap) * 0.1));
    u.population = Math.max(cap, u.population - left);
    notes.push(`${left} families left; there is nowhere for them to sleep.`);
  }
  // Rivals grow toward the player, so the map never goes stale.
  ensureNpcs(u);
  for (const r of u.npcs) {
    const floorLand = Math.max(40, Math.round((u.land || 120) * (0.3 + (r.id - 1) * 0.075)));
    if (r.land < floorLand) r.land = Math.min(floorLand, Math.round(r.land * 1.12));
    const target = Math.round((12 + r.land * 0.85) * (0.7 + (mix(u.seed, r.id, 9) % 60) / 100));
    if (r.defense < target) r.defense = Math.min(target, Math.round(r.defense * 1.06 + 3));
    r.gold += Math.round(r.land * 1.2);
    r.food += Math.round(r.land * 2);
  }
  return notes;
}

// Daily turn grant + rollover. Returns a message, or '' if nothing happened.
function ensureDay(u) {
  const today = dayKey();
  if (u.day === today) return '';
  u.day = today;
  u.turns = TURNS_PER_DAY;
  const notes = dailyTick(u);
  const head = `A new day: ${TURNS_PER_DAY} turns, harvest in, taxes collected.`;
  return notes.length ? head + ' ' + notes.slice(0, 2).join(' ') : head;
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

function line(term, row, text, fg) {
  put(term, row, 1, pad(text, SW), fg);
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
  const t = ' ' + GAME_NAME + '  ·  ' + u.handle + '  ·  ' + u.turns + ' turns  ·  day ' + u.day +
    '  ·  ESC backs out' + (extra ? '  ·  ' + extra : '');
  put(term, term.rows || 25, 1, pad(t, SW), 0, 7);
}

// Multi-line message block, clipped to the rows it is given.
function msgBlock(term, top, rowsText, msg, fg) {
  const lines = term.wrap(String(msg || ''), SW - 6).slice(0, rowsText);
  lines.forEach((t, i) => put(term, top + i, 4, t, fg == null ? 11 : fg));
  for (let i = lines.length; i < rowsText; i++) put(term, top + i, 4, ' '.repeat(SW - 4), 7);
}

// --------------------------------------------------------------- input

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
      put(term, row + 1, 1, pad('  Numbers only, my lord.', SW - 1), 12);
      continue;
    }
    const n = parseInt(s, 10);
    if (n < lo || n > hi) {
      put(term, row + 1, 1, pad(`  Between ${lo} and ${hi}, my lord.`, SW - 1), 12);
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

// ---------------------------------------------------------------- actions

function guardTurns(u) {
  if (u.turns > 0) return null;
  return 'No turns left today. The realm rests until tomorrow.';
}

async function screenBuild(term, ctx, u) {
  let msg = '';
  for (;;) {
    drawBuild(term, u, msg);
    msg = '';
    const k = await pick(term, '12345', 18, 28);
    if (k === 'ESC') return 'Back at the keep.';
    if (k === 'ENTER') continue;
    const b = BUILDINGS['12345'.indexOf(k)];
    if (!b) continue;
    const gate = guardTurns(u);
    if (gate) { msg = gate; continue; }
    const free = freeLand(u);
    if (free <= 0) { msg = 'Every acre is developed. Clear wild land at the market.'; continue; }
    if (u.gold < b.cost) { msg = `${b.name} cost ${comma(b.cost)} gold each. The purse is light.`; continue; }
    const maxQty = Math.min(free, Math.floor(u.gold / b.cost), MAX_BUILD);
    const qty = await askInt(term, 20, `How many ${b.name.toLowerCase()}? (1-${maxQty}, blank cancels):`, 1, maxQty);
    if (qty == null) return 'No work ordered.';
    const turns = Math.ceil(qty / 10);
    if (u.turns < turns) { msg = `That is ${turns} turns of work; you have ${u.turns}.`; continue; }
    u.gold -= qty * b.cost;
    u.buildings[b.key] += qty;
    u.turns -= turns;
    ctx.save();
    msg = `${qty} ${b.name.toLowerCase()} raised for ${comma(qty * b.cost)} gold, ${turns} turn${turns === 1 ? '' : 's'} gone.`;
  }
}

async function screenRecruit(term, ctx, u) {
  const gate = guardTurns(u);
  if (gate) return gate;
  const room = armyCap(u) - u.army;
  if (room <= 0) return 'Barracks are full. Build more before recruiting.';
  const purse = Math.floor(u.gold / RECRUIT_COST);
  if (purse <= 0) return `A soldier costs ${RECRUIT_COST} gold. The chest is empty.`;
  const maxQty = Math.min(room, purse, 300);
  drawRecruit(term, u, '');
  const qty = await askInt(term, 18, `Recruit how many? (1-${maxQty}, blank cancels):`, 1, maxQty);
  if (qty == null) return 'No recruits taken.';
  const turns = Math.ceil(qty / RECRUIT_PER_TURN);
  if (u.turns < turns) return `That is ${turns} turns of drilling; you have ${u.turns}.`;
  u.gold -= qty * RECRUIT_COST;
  u.army += qty;
  u.turns -= turns;
  ctx.save();
  return `${qty} soldiers take the oath for ${comma(qty * RECRUIT_COST)} gold.`;
}

async function screenFarm(term, ctx, u) {
  const gate = guardTurns(u);
  if (gate) { return gate; }
  const gain = Math.round((u.buildings.farms || 0) * 7 + 25);
  u.turns -= 1;
  u.food += gain;
  ctx.save();
  drawFarm(term, u, gain);
  await press(term, 21, 'The carts roll in. Press a key.');
  return `${gain} food brought in from the fields.`;
}

async function screenTrade(term, ctx, u) {
  let msg = '';
  for (;;) {
    drawTrade(term, u, msg);
    msg = '';
    const k = await pick(term, '123', 21, 9);
    if (k === 'ESC') return 'Back at the keep.';
    if (k === 'ENTER') continue;
    const gate = guardTurns(u);
    if (gate) { msg = gate; continue; }
    const p = marketPrices(u);
    if (k === '1') {
      const lots = await askInt(term, 19, `Buy how many hundreds of food? (1-20, blank cancels):`, 1, 20);
      if (lots == null) return 'No grain bought.';
      const cost = Math.round(lots * 100 * p.buy);
      const turns = Math.ceil(lots / 5);
      if (u.gold < cost) { msg = `That is ${comma(cost)} gold; you have ${comma(u.gold)}.`; continue; }
      if (u.turns < turns) { msg = `That is ${turns} turns of haggling; you have ${u.turns}.`; continue; }
      u.gold -= cost;
      u.food += lots * 100;
      u.turns -= turns;
      ctx.save();
      msg = `Bought ${comma(lots * 100)} food for ${comma(cost)} gold.`;
      continue;
    }
    if (k === '2') {
      const lots = await askInt(term, 19, `Sell how many hundreds of food? (1-20, blank cancels):`, 1, 20);
      if (lots == null) return 'No grain sold.';
      const have = Math.floor((u.food || 0) / 100);
      if (have < lots) { msg = `The granary holds only ${comma(u.food)} food.`; continue; }
      const paid = Math.round(lots * 100 * p.sell);
      const turns = Math.ceil(lots / 5);
      if (u.turns < turns) { msg = `That is ${turns} turns of haggling; you have ${u.turns}.`; continue; }
      u.food -= lots * 100;
      u.gold += paid;
      u.turns -= turns;
      ctx.save();
      msg = `Sold ${comma(lots * 100)} food for ${comma(paid)} gold.`;
      continue;
    }
    // 3: clear wild land
    const lots = await askInt(term, 19, `Clear how many score of acres? (1-5, blank cancels):`, 1, 5);
    if (lots == null) return 'The surveyors go home.';
    const cost = lots * 600;
    if (u.gold < cost) { msg = `Clearing costs ${comma(cost)} gold; you have ${comma(u.gold)}.`; continue; }
    if (u.turns < lots) { msg = `That is ${lots} turns of clearing; you have ${u.turns}.`; continue; }
    u.gold -= cost;
    u.land += lots * 20;
    u.turns -= lots;
    ctx.save();
    msg = `${lots * 20} wild acres cleared and staked out.`;
  }
}

async function screenAttack(term, ctx, u) {
  let msg = '';
  for (;;) {
    drawAttack(term, u, msg);
    msg = '';
    const k = await pick(term, '12345678', 19, 20);
    if (k === 'ESC' || k === 'ENTER') return 'The war council disperses.';
    const realm = u.npcs[parseInt(k, 10) - 1];
    if (!realm) continue;
    if (u.turns < ATTACK_TURNS) return `An attack costs ${ATTACK_TURNS} turns; you have ${u.turns}.`;
    if (u.army <= 0) return 'You have no soldiers to march.';
    const qty = await askInt(term, 17, `Send how many soldiers? (1-${u.army}, blank cancels):`, 1, u.army);
    if (qty == null) return 'The host stands down.';
    const result = resolveBattle(u, realm, qty);
    u.turns -= ATTACK_TURNS;
    u.attacks += 1;
    if (result.win) { u.wins += 1; u.conquered += 1; } else { u.losses += 1; }
    ctx.save();
    drawBattle(term, u, realm, result, qty);
    await press(term, 21, 'Press a key for the keep.');
    msg = result.win
      ? `${realm.name} is sacked: ${comma(result.plunder.gold)} gold, ${comma(result.plunder.food)} food, ${result.plunder.land} acres.`
      : `The assault on ${realm.name} failed. ${result.losses} soldiers did not return.`;
  }
}

function resolveBattle(u, realm, troops) {
  const log = [];
  const defenceBefore = realm.defense;
  const offense = troops * barracksBonus(u) * (0.85 + Math.random() * 0.3);
  const defense = realm.defense * (0.85 + Math.random() * 0.3);
  const ratio = offense / Math.max(1, defense);
  const win = ratio >= 1;
  log.push(`Your ${troops} soldiers march on ${realm.name}.`);
  log.push(`Their ${defenceBefore} defenders man ${realm.land} acres of wall and ditch.`);
  let losses;
  const plunder = { gold: 0, food: 0, land: 0 };
  if (win) {
    losses = clamp(Math.round(troops * (0.3 / ratio)), 1, Math.round(troops * 0.6));
    plunder.gold = Math.round(realm.gold * 0.6);
    plunder.food = Math.round(realm.food * 0.5);
    plunder.land = Math.max(5, Math.round(realm.land * 0.35));
    realm.gold = Math.max(0, realm.gold - plunder.gold);
    realm.food = Math.max(0, realm.food - plunder.food);
    realm.land = Math.max(20, realm.land - plunder.land);
    realm.defense = Math.max(10, Math.round(realm.defense * 0.55));
    realm.conquered += 1;
    log.push('The gate gives way. The town is yours by dusk.');
    u.gold += plunder.gold;
    u.food += plunder.food;
    u.land += plunder.land;
    log.push(`Plunder: ${comma(plunder.gold)} gold, ${comma(plunder.food)} food, ${plunder.land} acres.`);
  } else {
    losses = clamp(Math.round(troops * (0.55 - ratio * 0.2)), Math.round(troops * 0.2), Math.round(troops * 0.7));
    realm.defense = Math.max(8, Math.round(realm.defense * 0.93));
    log.push('The ladders never reach the parapet. The host falls back.');
  }
  losses = Math.min(losses, troops);
  u.army = Math.max(0, u.army - losses);
  log.push(`${losses} soldiers were lost; ${u.army} remain under arms.`);
  return { win, log, losses, plunder, defenceBefore };
}

function threatLabel(u, realm) {
  const ratio = (u.army * barracksBonus(u)) / Math.max(1, realm.defense);
  if (ratio >= 1.6) return { t: 'EASY', fg: 10 };
  if (ratio >= 1.05) return { t: 'EVEN', fg: 11 };
  if (ratio >= 0.7) return { t: 'HARD', fg: 13 };
  return { t: 'SUICIDE', fg: 12 };
}

// ----------------------------------------------------------------- screens

function drawMain(term, u, msg) {
  term.cls();
  bar(term, 1, GAME_NAME, 'TURN ' + u.turns + '/' + TURNS_PER_DAY, 4);
  put(term, 2, 2, 'LORD ' + u.handle, 14);
  put(term, 2, 30, 'LAND ' + comma(u.land) + ' ac', 11);
  put(term, 2, 48, 'GOLD ' + comma(u.gold), 10);
  put(term, 2, 68, 'FOOD ' + comma(u.food), 10);
  rule(term, 3, '═', 11);

  put(term, 4, 3, `PEOPLE ${padl(u.population, 4)}/${popCap(u)}`, 15);
  put(term, 4, 26, `ARMY ${padl(u.army, 4)}/${armyCap(u)}`, 12);
  put(term, 4, 48, `DEFENCE ${defenseRating(u)}`, 12);
  put(term, 4, 66, `SCORE ${comma(scoreOf(u))}`, 13);

  put(term, 5, 3, 'BUILDINGS', 8);
  put(term, 5, 14, BUILDINGS.map((b) => `${b.key.slice(0, 4)} ${u.buildings[b.key]}`).join('  '), 15);
  put(term, 6, 3, 'WILD LAND', 8);
  put(term, 6, 14, `${freeLand(u)} acres free to develop`, freeLand(u) > 0 ? 15 : 8);
  rule(term, 7, '─', 8);

  const prod = foodProd(u);
  const eat = foodNeed(u);
  const net = prod - eat;
  put(term, 8, 3, 'HARVEST', 8);
  put(term, 8, 12, `${comma(prod)} food/day`, 10);
  put(term, 8, 30, 'BELLIES', 8);
  put(term, 8, 39, `${comma(eat)} food/day`, 12);
  put(term, 8, 58, 'NET', 8);
  put(term, 8, 62, (net >= 0 ? '+' : '') + comma(net), net >= 0 ? 10 : 12);

  const inc = goldIncome(u);
  const up = armyUpkeep(u);
  const gnet = inc - up;
  put(term, 9, 3, 'TREASURY', 8);
  put(term, 9, 12, `${comma(inc)} gold/day`, 10);
  put(term, 9, 30, 'UPKEEP', 8);
  put(term, 9, 39, `${comma(up)} gold/day`, 12);
  put(term, 9, 58, 'NET', 8);
  put(term, 9, 62, (gnet >= 0 ? '+' : '') + comma(gnet), gnet >= 0 ? 10 : 12);
  rule(term, 10, '─', 8);

  put(term, 11, 3, '[B] Build', 15);
  put(term, 11, 40, '[P] Realm report', 15);
  put(term, 12, 3, '[R] Recruit', 15);
  put(term, 12, 40, '[S] Scoreboard', 15);
  put(term, 13, 3, '[F] Farm the land', 15);
  put(term, 13, 40, '[H] Handbook', 15);
  put(term, 14, 3, '[T] Trade at the market', 15);
  put(term, 14, 40, '[Q] Quit the realm', 15);
  put(term, 15, 3, '[A] Attack a rival realm', 12);
  rule(term, 16, '─', 8);

  msgBlock(term, 17, 3, msg, 14);
  put(term, 20, 2, 'Order: ', 14);
  put(term, 21, 3, 'ESC backs out of any screen. Every order costs turns.', 8);
  status(term, u);
}

function drawBuild(term, u, msg) {
  term.cls();
  bar(term, 1, 'BUILDERS AND MASONS', 'TURN ' + u.turns + '/' + TURNS_PER_DAY, 4);
  put(term, 2, 2, `GOLD ${comma(u.gold)}`, 10);
  put(term, 2, 26, `WILD LAND ${freeLand(u)} ac`, 11);
  put(term, 2, 52, `WORK COST 1 turn per 10`, 8);
  rule(term, 3, '═', 11);
  put(term, 4, 3, '#', 8);
  put(term, 4, 6, 'BUILDING', 8);
  put(term, 4, 22, 'COST', 8);
  put(term, 4, 31, 'HAVE', 8);
  put(term, 4, 38, 'EFFECT', 8);
  rule(term, 5, '─', 8);
  BUILDINGS.forEach((b, i) => {
    const row = 6 + i;
    const can = u.gold >= b.cost && freeLand(u) > 0;
    put(term, row, 3, `[${i + 1}]`, can ? 14 : 8);
    put(term, row, 7, b.name, can ? 15 : 8);
    put(term, row, 22, padl(comma(b.cost) + ' g', 7), 10);
    put(term, row, 31, padl(String(u.buildings[b.key]), 5), 15);
    put(term, row, 38, b.blurb, 7);
  });
  rule(term, 12, '─', 8);
  put(term, 13, 3, `Developed ${devUsed(u)} of ${u.land} acres. Each order is up to ${MAX_BUILD} buildings.`, 8);
  msgBlock(term, 14, 3, msg, 14);
  put(term, 18, 2, 'Choose a building (1-5): ', 14);
  put(term, 19, 3, 'ESC returns to the keep.', 8);
  put(term, 20, 1, ' '.repeat(SW), 7);
  status(term, u);
}

function drawRecruit(term, u, msg) {
  term.cls();
  bar(term, 1, 'THE MUSTER FIELD', 'TURN ' + u.turns + '/' + TURNS_PER_DAY, 4);
  put(term, 2, 2, `ARMY ${u.army}/${armyCap(u)}`, 12);
  put(term, 2, 28, `GOLD ${comma(u.gold)}`, 10);
  put(term, 2, 52, `${RECRUIT_COST} gold, ${RECRUIT_PER_TURN} per turn`, 8);
  rule(term, 3, '═', 11);
  put(term, 5, 3, 'Soldiers drill in the yard. Pay them and they will march.', 7);
  put(term, 6, 3, `Each soldier costs ${RECRUIT_COST} gold and eats 0.35 gold a day in pay.`, 7);
  put(term, 7, 3, `Barracks hold ${armyCap(u)}; you keep ${u.army}.`, 7);
  put(term, 8, 3, `Defence rating with walls and host: ${defenseRating(u)}.`, 7);
  put(term, 10, 3, 'One company per visit: answer the prompt below.', 8);
  put(term, 11, 3, '[ESC] Back to the keep, nothing taken', 8);
  msgBlock(term, 13, 3, msg, 14);
  put(term, 17, 2, 'Muster: ', 14);
  put(term, 18, 1, ' '.repeat(SW), 7);
  status(term, u);
}

function drawFarm(term, u, gain) {
  term.cls();
  bar(term, 1, 'THE HARVEST', 'TURN ' + u.turns + '/' + TURNS_PER_DAY, 2);
  rule(term, 2, '═', 11);
  put(term, 4, 3, 'Reapers work the fields from dawn to dark.', 7);
  put(term, 6, 3, 'FARMS', 8);
  put(term, 6, 12, String(u.buildings.farms), 15);
  put(term, 7, 3, 'BROUGHT IN', 8);
  put(term, 7, 15, `${comma(gain)} food`, 10);
  put(term, 8, 3, 'GRANARY', 8);
  put(term, 8, 12, `${comma(u.food)} food`, 10);
  put(term, 9, 3, 'NEXT HARVEST', 8);
  put(term, 9, 17, `${comma(foodProd(u))} food/day against ${comma(foodNeed(u))} eaten`, 11);
  status(term, u);
}

function drawTrade(term, u, msg) {
  const p = marketPrices(u);
  term.cls();
  bar(term, 1, 'THE MARKET CROSS', 'TURN ' + u.turns + '/' + TURNS_PER_DAY, 3);
  put(term, 2, 2, `GOLD ${comma(u.gold)}`, 10);
  put(term, 2, 30, `FOOD ${comma(u.food)}`, 10);
  put(term, 2, 54, `WILD LAND ${freeLand(u)} ac`, 11);
  rule(term, 3, '═', 11);
  put(term, 4, 3, 'The corn factors have set today\'s prices.', 8);
  put(term, 6, 3, 'BUY', 8);
  put(term, 6, 9, `100 food for ${comma(Math.round(100 * p.buy))} gold`, 15);
  put(term, 7, 3, 'SELL', 8);
  put(term, 7, 9, `100 food for ${comma(Math.round(100 * p.sell))} gold`, 15);
  put(term, 8, 3, 'LAND', 8);
  put(term, 8, 9, '20 wild acres for 600 gold, 1 turn', 15);
  rule(term, 10, '─', 8);
  put(term, 11, 3, '[1] Buy grain', 15);
  put(term, 12, 3, '[2] Sell grain', 15);
  put(term, 13, 3, '[3] Clear wild land', 15);
  put(term, 14, 3, '[ESC] Back to the keep', 8);
  msgBlock(term, 16, 3, msg, 14);
  put(term, 19, 1, ' '.repeat(SW), 7);
  put(term, 21, 2, 'Trade: ', 14);
  status(term, u);
}

function drawAttack(term, u, msg) {
  term.cls();
  bar(term, 1, 'THE WAR COUNCIL', 'TURN ' + u.turns + '/' + TURNS_PER_DAY, 4);
  put(term, 2, 2, `YOUR HOST ${u.army}`, 12);
  put(term, 2, 26, `BARRACKS BONUS +${Math.round((barracksBonus(u) - 1) * 1000) / 10}%`, 8);
  put(term, 2, 56, `AN ATTACK COSTS ${ATTACK_TURNS} TURNS`, 8);
  rule(term, 3, '═', 11);
  put(term, 4, 3, '#', 8);
  put(term, 4, 6, 'REALM', 8);
  put(term, 4, 26, 'LAND', 8);
  put(term, 4, 38, 'DEFENCE', 8);
  put(term, 4, 50, 'ODDS', 8);
  put(term, 4, 60, 'SACKED', 8);
  rule(term, 5, '─', 8);
  u.npcs.forEach((r, i) => {
    const row = 6 + i;
    const th = threatLabel(u, r);
    put(term, row, 3, `[${i + 1}]`, 14);
    put(term, row, 7, pad(r.name, 17), 15);
    put(term, row, 26, padl(comma(r.land) + ' ac', 9), 7);
    put(term, row, 38, padl(comma(r.defense), 8), 12);
    put(term, row, 50, pad(th.t, 9), th.fg);
    put(term, row, 60, padl(String(r.conquered), 6), 8);
  });
  rule(term, 14, '─', 8);
  put(term, 15, 3, 'Rivals grow while you sit still. Odds compare your whole host to their walls.', 8);
  msgBlock(term, 16, 2, msg, 14);
  put(term, 18, 1, ' '.repeat(SW), 7);
  put(term, 19, 2, 'Realm to attack: ', 14);
  status(term, u);
}

function drawBattle(term, u, realm, result, troops) {
  term.cls();
  bar(term, 1, 'BATTLE FOR ' + String(realm.name).toUpperCase(), result.win ? 'VICTORY' : 'DEFEAT', result.win ? 2 : 4);
  put(term, 2, 2, `YOUR HOST ${troops}`, 12);
  put(term, 2, 24, `THEIR DEFENCE ${result.defenceBefore}`, 12);
  put(term, 2, 52, `TURNS LEFT ${u.turns}`, 8);
  rule(term, 3, '═', 11);
  const body = result.log.slice(0, 12);
  body.forEach((t, i) => put(term, 5 + i, 3, pad(t, SW - 4), i === body.length - 1 ? 15 : 7));
  rule(term, 17, '─', 8);
  put(term, 18, 3, result.win ? 'THE REALM IS SACKED' : 'THE ASSAULT FAILS', result.win ? 10 : 12);
  put(term, 19, 3, `Losses ${result.losses} · Army ${u.army} · Gold ${comma(u.gold)} · Food ${comma(u.food)}`, 11);
  status(term, u);
}

function drawReport(term, u) {
  term.cls();
  bar(term, 1, 'REALM REPORT', 'THE STEWARD\'S LEDGER', 3);
  put(term, 2, 2, `${u.handle} of the realm · day ${u.day}`, 14);
  rule(term, 3, '═', 11);

  const prod = foodProd(u);
  const eat = foodNeed(u);
  const inc = goldIncome(u);
  const up = armyUpkeep(u);
  const daysFood = eat > 0 ? Math.floor(u.food / eat) : 99;
  const rows = [
    ['Land', `${comma(u.land)} acres, ${devUsed(u)} developed, ${freeLand(u)} wild`],
    ['People', `${comma(u.population)} of ${comma(popCap(u))} beds · ${u.population >= popCap(u) ? 'crowded' : 'room to grow'}`],
    ['Host', `${comma(u.army)} of ${comma(armyCap(u))} · defence ${comma(defenseRating(u))}`],
    ['Granary', `${comma(u.food)} food · ${daysFood} days at the current table`],
    ['Coffers', `${comma(u.gold)} gold`],
    ['Harvest', `+${comma(prod)} food/day, table takes ${comma(eat)} → ${(prod - eat >= 0 ? '+' : '') + comma(prod - eat)}`],
    ['Taxes', `+${comma(inc)} gold/day, wages ${comma(up)} → ${(inc - up >= 0 ? '+' : '') + comma(inc - up)}`],
    ['Buildings', BUILDINGS.map((b) => `${b.name} ${u.buildings[b.key]}`).join(' · ')],
    ['Record', `${u.attacks} attacks · ${u.wins} won · ${u.losses} lost · ${u.conquered} sacked`],
    ['Score', `${comma(scoreOf(u))}`],
  ];
  rows.forEach((r, i) => {
    put(term, 5 + i, 3, pad(r[0], 11) + ':', 8);
    put(term, 5 + i, 16, pad(r[1], SW - 17), 15);
  });
  rule(term, 16, '─', 8);
  const warns = [];
  if (prod - eat < 0) warns.push('The granary shrinks every day. Build farms or buy grain.');
  if (inc - up < 0) warns.push('Wages outrun taxes; soldiers will desert.');
  if (u.food < eat * 3) warns.push('Less than three days of food in store.');
  if (freeLand(u) === 0) warns.push('No wild land left: clear more at the market.');
  if (!warns.length) warns.push('The realm is in good order. Expand while your rivals sleep.');
  warns.slice(0, 3).forEach((w, i) => put(term, 17 + i, 4, pad(w, SW - 5), i === 0 ? 11 : 7));
  put(term, 22, 4, 'Press any key to return to the keep.', 8);
  status(term, u);
}

function drawScores(term, users, me, page) {
  const rows = users.slice().sort((a, b) => (b.land || 0) - (a.land || 0) || scoreOf(b) - scoreOf(a));
  const perPage = 10;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const p = clamp(page, 0, pages - 1);
  term.cls();
  bar(term, 1, GAME_NAME + '  ·  THE LAND ROLL', `PAGE ${p + 1}/${pages}`, 5);
  put(term, 2, 2, 'Ranked by acres held. Score breaks ties.', 8);
  rule(term, 3, '═', 11);
  put(term, 4, 2, 'RANK', 8);
  put(term, 4, 9, 'LORD', 8);
  put(term, 4, 30, 'LAND', 8);
  put(term, 4, 40, 'PEOPLE', 8);
  put(term, 4, 50, 'ARMY', 8);
  put(term, 4, 58, 'BUILDINGS', 8);
  put(term, 4, 70, 'SCORE', 8);
  rule(term, 5, '─', 8);
  if (!rows.length) put(term, 7, 4, 'No realms on the board yet.', 8);
  rows.slice(p * perPage, p * perPage + perPage).forEach((u, i) => {
    const row = 6 + i;
    const mine = me && u.handle === me.handle;
    put(term, row, 2, padl(String(p * perPage + i + 1), 4), mine ? 10 : 14);
    put(term, row, 9, pad(u.handle, 20), mine ? 10 : 15);
    put(term, row, 30, padl(comma(u.land), 8), 11);
    put(term, row, 40, padl(comma(u.population), 8), 15);
    put(term, row, 50, padl(comma(u.army), 6), 15);
    put(term, row, 58, padl(String(devUsed(u)), 9), 8);
    put(term, row, 70, padl(comma(scoreOf(u)), 9), 13);
  });
  put(term, 22, 4, '[SPACE] next page   [ESC] back to the keep', 8);
  status(term, me);
}

function drawHelp(term, u) {
  term.cls();
  bar(term, 1, 'THE HANDBOOK', 'HOW A REALM IS RUN', 1);
  rule(term, 2, '═', 11);
  const text = [
    'Land is the root of everything. Wild acres can be developed; each building',
    'takes one acre. Clear more land at the market when the wild runs out.',
    '',
    'FARMS feed people: 90 food a day each. Every person eats 1.1 food a day.',
    'HOUSES give 30 beds each and people arrive to fill them, up to the cap.',
    'MARKETS pay 45 gold a day each, and every person pays 0.55 gold in tax.',
    'BARRACKS hold 60 soldiers each and sharpen every attack slightly.',
    'WALLS add 25 defence each, which is what raiders must break.',
    '',
    'Soldiers cost 14 gold and 0.35 gold a day in wages. Unpaid soldiers',
    'desert. An attack costs 3 turns: you commit troops, they are lost in',
    'proportion to how close the fight was, and the plunder is land, gold',
    'and food. Rivals grow toward your size every day, so strike early.',
    '',
    'You get 40 turns a day. Building runs 10 to a turn, recruiting 25,',
    'grain 5 lots, clearing land 1 score, farming 1 turn, attacking 3.',
  ];
  text.forEach((t, i) => put(term, 4 + i, 3, pad(t, SW - 4), 7));
  put(term, 22, 4, 'Press any key to return to the keep.', 8);
  status(term, u);
}

// -------------------------------------------------------------------- run

async function screenReport(term, u) {
  drawReport(term, u);
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

async function screenHelp(term, u) {
  drawHelp(term, u);
  await term.readKey({ timeoutMs: IDLE_MS });
}

async function titleScreen(term, u, isNew) {
  term.cls();
  bar(term, 1, GAME_NAME, 'A DOOR OF THE MIDNIGHT GATE', 2);
  const art = [
    '   __                                   ',
    '  /  \\    _    _ __ ___ _ __ ___   ___  ',
    ' |    |  | |  | \'__/ _ \\ \'_ ` _ \\ / _ \\ ',
    ' |    |  | |__| | | (_) | | | | | |  __/ ',
    '  \\__/    \\__,_|_|  \\___/|_| |_| |_|\\___|',
  ];
  art.forEach((t, i) => put(term, 3 + i, 20, t, 11));
  put(term, 9, 22, 'B A R R E N   R E A L M S', 14);
  rule(term, 11, '─', 8);
  put(term, 12, 4, 'Wild acres, hungry people, and eight neighbours who want your fields.', 7);
  put(term, 13, 4, 'Build, recruit, harvest, trade — then take what you cannot grow.', 7);
  rule(term, 15, '─', 8);
  put(term, 16, 4, `Lord ........... ${u.handle}`, 15);
  put(term, 17, 4, `Realm .......... ${comma(u.land)} acres, ${devUsed(u)} developed, ${comma(u.population)} people`, 15);
  put(term, 18, 4, `Treasury ....... ${comma(u.gold)} gold, ${comma(u.food)} food, ${u.army} soldiers`, 15);
  put(term, 19, 4, `Turns .......... ${u.turns}/${TURNS_PER_DAY} today · score ${comma(scoreOf(u))}`, 15);
  rule(term, 21, '─', 8);
  put(term, 22, 4, 'ENTER to take the throne   ·   ESC to ride away', 11);
  status(term, u, isNew ? 'new realm' : 'realm on file');
  const k = await term.readKey({ timeoutMs: IDLE_MS });
  return k === 'ESC' ? 'ESC' : 'GO';
}

async function run(term, ctx) {
  const store = storeOf(ctx);
  const handle = String(ctx.user.handle || 'lord');
  let u = store.users[handle];
  const isNew = !u;
  if (!u) {
    u = newUser(handle);
    store.users[handle] = u;
    ctx.save();
  }
  repair(u, handle);

  let msg = isNew ? 'Your steward hands you the keys to a cold, empty keep.' : 'The steward awaits your orders.';
  try {
    const rolled = ensureDay(u);
    if (rolled) { msg = rolled; ctx.save(); }
    const start = await titleScreen(term, u, isNew);
    if (start === 'ESC') return;

    for (;;) {
      const day = ensureDay(u);
      if (day) { msg = day; ctx.save(); }
      drawMain(term, u, msg);
      msg = '';
      const k = await pick(term, 'BRFTAPSHQ', 20, 9);
      if (k === 'ESC' || k === 'Q') return;
      if (k === 'B') { msg = await screenBuild(term, ctx, u); continue; }
      if (k === 'R') { msg = await screenRecruit(term, ctx, u); continue; }
      if (k === 'F') { msg = await screenFarm(term, ctx, u); continue; }
      if (k === 'T') { msg = await screenTrade(term, ctx, u); continue; }
      if (k === 'A') { msg = await screenAttack(term, ctx, u); continue; }
      if (k === 'P') { await screenReport(term, u); msg = 'The ledger is closed.'; continue; }
      if (k === 'S') { await screenScores(term, store, u); msg = 'The land roll never lies.'; continue; }
      if (k === 'H') { await screenHelp(term, u); msg = 'Handbook closed.'; continue; }
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
  description: 'Rule a realm of wild acres: build, recruit, harvest and sack your neighbours. 40 turns a day.',
  minLevel: 10,
  players: 'multi',
  run,
  _internals: {
    BUILDINGS,
    newUser,
    ensureDay,
    dailyTick,
    repair,
    resolveBattle,
    makeRealm,
    scoreOf,
    devUsed,
    foodProd,
    foodNeed,
    goldIncome,
    armyUpkeep,
    freeLand,
    popCap,
    armyCap,
    screenBuild,
    screenRecruit,
    screenFarm,
    screenTrade,
    screenAttack,
    drawMain,
  },
};
