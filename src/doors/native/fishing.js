'use strict';
// FRESHWATER FISHING — a slow, quiet door game in the spirit of the 1989
// "Freshwater Fishing Simulator". Nine spots on one lake, three rods, three
// baits, ten casts a day, and a record book that outlives your account.

const ID = 'fishing';
const RODS = [
  { name: 'Cane pole', price: 0, bonus: 0.0 },
  { name: 'Fiberglass 6ft', price: 120, bonus: 0.18 },
  { name: 'Graphite 7ft', price: 450, bonus: 0.38 },
  { name: 'Custom bass rig', price: 1400, bonus: 0.62 },
];
const BAITS = [
  { key: 'worm', name: 'Nightcrawlers', price: 6, pack: 5, bonus: 0.0 },
  { key: 'minnow', name: 'Minnows', price: 14, pack: 5, bonus: 0.15 },
  { key: 'lure', name: 'Spinner lures', price: 30, pack: 5, bonus: 0.3 },
];
const SPOTS = [
  { name: 'Reed Beds', depth: 'shallow', glyph: '≈', fish: ['bluegill', 'bass', 'pike'] },
  { name: 'Sunken Logs', depth: 'medium', glyph: '≈', fish: ['bass', 'catfish', 'bluegill'] },
  { name: 'Deep Channel', depth: 'deep', glyph: '≋', fish: ['catfish', 'muskie', 'trout'] },
  { name: 'Boat Dock', depth: 'shallow', glyph: '≈', fish: ['bluegill', 'perch', 'bass'] },
  { name: 'Lily Pads', depth: 'shallow', glyph: '≈', fish: ['bass', 'pike', 'bluegill'] },
  { name: 'Rock Point', depth: 'medium', glyph: '≈', fish: ['trout', 'pike', 'bass'] },
  { name: 'Old Dam', depth: 'deep', glyph: '≋', fish: ['muskie', 'catfish', 'trout'] },
  { name: 'Spring Hole', depth: 'deep', glyph: '≋', fish: ['trout', 'muskie', 'catfish'] },
  { name: 'Weedy Bay', depth: 'medium', glyph: '≈', fish: ['pike', 'bass', 'perch'] },
];
const FISH = {
  bluegill: { min: 0.2, max: 1.1, value: 3, art: ['  <>< ', ' <><><', '<><   '] },
  perch: { min: 0.3, max: 1.8, value: 4, art: ['  ><> ', ' <><><', '  ><> '] },
  bass: { min: 0.8, max: 6.5, value: 9, art: ['   __ ', ' <°))))><', '   -- '] },
  pike: { min: 1.5, max: 14, value: 14, art: ['  _____', ' <°)))))><', '  -----'] },
  catfish: { min: 2, max: 26, value: 18, art: ['  ______', ' <°))))))><', '  ~~~~~ '] },
  trout: { min: 0.6, max: 7, value: 12, art: ['  ~~~  ', ' <°)))>< ', '  ~~~  '] },
  muskie: { min: 4, max: 38, value: 30, art: ['  _______', ' <°)))))))><', '  ======='] },
};
const TODAY = () => new Date().toISOString().slice(0, 10);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US');

function store(ctx) {
  ctx.db.data.doors = ctx.db.data.doors || {};
  const d = (ctx.db.data.doors[ID] = ctx.db.data.doors[ID] || { users: {}, records: {} });
  d.users = d.users || {};
  d.records = d.records || {};
  return d;
}

function rec(st, handle) {
  const key = String(handle).toLowerCase();
  if (!st.users[key]) {
    st.users[key] = {
      day: TODAY(),
      casts: 10,
      rod: 0,
      bait: { worm: 5, minnow: 0, lure: 0 },
      baitChoice: 'worm',
      purse: 25,
      caught: 0,
      best: {},
      lastSpot: 1,
    };
  }
  const r = st.users[key];
  if (r.day !== TODAY()) {
    r.day = TODAY();
    r.casts = 10;
  }
  r.bait = r.bait || { worm: 0, minnow: 0, lure: 0 };
  r.best = r.best || {};
  return r;
}

function bar(term, r) {
  term.print(1, 1, ' '.repeat(80), 0, 1);
  const head = ` FRESHWATER FISHING · ${term.user.handle} `;
  term.print(1, 2, head, 15, 1);
  const right = `casts ${r.casts}  ${money(r.purse)}  rod: ${RODS[r.rod].name} `;
  term.print(1, Math.max(2, 80 - right.length), right, 14, 1);
  term.print(24, 1, '─'.repeat(80), 8);
}

function lakeMap(term, r, top) {
  term.print(top, 3, '              ╔═════════╦═════════╦═════════╗', 11);
  for (let row = 0; row < 3; row++) {
    const y = top + 1 + row * 2;
    let line = '              ║';
    for (let col = 0; col < 3; col++) {
      const n = row * 3 + col + 1;
      const sp = SPOTS[n - 1];
      const mark = n === r.lastSpot ? '»' : ' ';
      line += `${mark}${n} ${sp.glyph}${sp.glyph}${sp.glyph}${sp.glyph}${sp.glyph}${mark}║`;
    }
    term.print(y, 3, line, 14);
    if (row < 2) term.print(y + 1, 3, '              ╠═════════╬═════════╬═════════╣', 11);
  }
  term.print(top + 7, 3, '              ╚═════════╩═════════╩═════════╝', 11);
  return top + 8;
}

async function cast(term, ctx, st, r) {
  term.cls();
  bar(term, r);
  const top = 2;
  term.print(top, 3, 'CHOOSE A SPOT ON THE LAKE', 11);
  const listTop = lakeMap(term, r, top + 1);
  SPOTS.forEach((sp, i) => {
    const row = listTop + Math.floor(i / 3);
    const col = 3 + (i % 3) * 26;
    term.print(row, col, `${i + 1} ${sp.name}`.slice(0, 24), 7);
    term.print(row + 1, col, `  ${sp.depth}, ${sp.fish.slice(0, 2).join('/')}`.slice(0, 24), 8);
  });
  term.write('\r\n');
  const k = await term.menu({ prompt: '\x1b[0;36mSpot (1-9, ESC to go back): \x1b[0m', valid: '123456789', allowEmpty: true });
  if (k == null || k === 'ESC' || k === '') return;

  const spot = SPOTS[Number(k) - 1];
  r.lastSpot = Number(k);
  const bait = BAITS.find((b) => b.key === r.baitChoice) || BAITS[0];
  if ((r.bait[bait.key] || 0) <= 0) {
    term.cls();
    term.print(3, 3, `You are out of ${bait.name.toLowerCase()}. The tackle shop is on the main menu.`, 12);
    await term.pause();
    return;
  }
  r.bait[bait.key]--;
  r.casts--;
  ctx.save();

  term.cls();
  bar(term, r);
  term.print(3, 3, `Casting into the ${spot.name} with ${bait.name.toLowerCase()}...`, 14);
  term.print(5, 3, 'Watch the line. Strike when it dips.', 8);
  term.print(7, 3, 'LINE  ', 8);
  const biteDelay = 900 + Math.random() * 2200;
  const start = Date.now();
  let spooked = false;
  while (Date.now() - start < biteDelay) {
    const k2 = await term.readKey({ timeoutMs: 70 });
    if (k2 === 'SPACE') {
      spooked = true;
      break;
    }
    const dots = '.'.repeat(Math.floor((Date.now() - start) / 220) % 12);
    term.print(7, 9, (dots + '          ').slice(0, 10), 8);
  }
  if (spooked) {
    term.write('\r\n');
    term.print(9, 3, 'You struck early. Nothing there but water. The cast is spent.', 12);
    await term.pause();
    return;
  }
  term.print(7, 9, '~~~ BITE! ~~~', 15);
  const windowMs = 420 + r.rod * 90;
  const t1 = Date.now();
  let landed = false;
  while (Date.now() - t1 < windowMs) {
    const k3 = await term.readKey({ timeoutMs: 40 });
    if (k3 === 'SPACE') {
      landed = true;
      break;
    }
  }
  term.write('\r\n');
  if (!landed) {
    term.print(9, 3, 'Too slow. The line goes slack and the fish is gone.', 12);
    await term.pause();
    return;
  }

  const species = pick(spot.fish);
  const f = FISH[species];
  const skill = 1 + RODS[r.rod].bonus + bait.bonus;
  const weight = Math.max(0.1, (f.min + Math.random() * (f.max - f.min)) * skill);
  const value = Math.round(f.value * weight * 1.6 + 2);
  r.caught++;
  r.purse += value;
  const isBest = !r.best[species] || weight > r.best[species];
  if (isBest) r.best[species] = Number(weight.toFixed(2));
  const worldBest = st.records[species] || 0;
  if (weight > worldBest) st.records[species] = Number(weight.toFixed(2));
  ctx.save();

  term.print(10, 3, f.art[0], 14);
  term.print(11, 3, f.art[1], 14);
  term.print(12, 3, f.art[2], 14);
  term.print(10, 22, `A ${species.toUpperCase()}`, 15);
  term.print(11, 22, `${weight.toFixed(2)} lb`, 11);
  term.print(12, 22, `sold for ${money(value)}`, 10);
  if (isBest) term.print(14, 3, 'Personal best for this species.', 14);
  if (weight > worldBest) term.print(15, 3, '*** NEW LAKE RECORD ***', 13);
  term.print(17, 3, `Casts left today: ${r.casts}`, 8);
  await term.pause();
}

async function shop(term, ctx, st, r) {
  for (;;) {
    term.cls();
    bar(term, r);
    term.print(2, 3, 'THE TACKLE SHOP', 11);
    term.print(4, 3, 'Rods', 14);
    RODS.forEach((rod, i) => {
      const owned = i <= r.rod;
      term.print(5 + i, 5, `${i + 1}. ${rod.name}`.padEnd(26), owned ? 10 : 7);
      term.print(5 + i, 32, owned ? 'owned' : money(rod.price), owned ? 8 : 15);
      term.print(5 + i, 44, `+${Math.round(rod.bonus * 100)}% fish size`, 8);
    });
    term.print(10, 3, 'Bait', 14);
    BAITS.forEach((b, i) => {
      term.print(11 + i, 5, `${i + 4}. ${b.name} (${b.pack})`.padEnd(26), 7);
      term.print(11 + i, 32, money(b.price), 15);
      term.print(11 + i, 40, `have ${r.bait[b.key] || 0}`, 8);
    });
    term.print(15, 3, `Purse: ${money(r.purse)}`, 11);
    term.write('\r\n');
    const k = await term.menu({ prompt: '\x1b[0;36mBuy (1-6), Q to leave: \x1b[0m', valid: '123456Q', allowEmpty: true });
    if (k == null || k === 'Q' || k === 'ESC' || k === '') return;
    const n = Number(k);
    if (n >= 1 && n <= 4) {
      const idx = n - 1;
      if (idx <= r.rod) {
        term.write('  You already own that rod.\r\n');
      } else if (r.purse < RODS[idx].price) {
        term.write('  Not enough in the purse.\r\n');
      } else {
        r.purse -= RODS[idx].price;
        r.rod = idx;
        ctx.save();
        term.write(`  Bought the ${RODS[idx].name}.\r\n`);
      }
      await term.pause();
    } else {
      const bait = BAITS[n - 4];
      if (!bait) continue;
      if (r.purse < bait.price) {
        term.write('  Not enough in the purse.\r\n');
        await term.pause();
        continue;
      }
      r.purse -= bait.price;
      r.bait[bait.key] = (r.bait[bait.key] || 0) + bait.pack;
      ctx.save();
      term.write(`  Bought ${bait.pack} ${bait.name.toLowerCase()}.\r\n`);
      await term.pause();
    }
  }
}

async function records(term, st, r) {
  term.cls();
  bar(term, r);
  term.print(2, 3, 'LAKE RECORD BOOK', 11);
  term.print(4, 3, 'Species      Lake record    Your best', 8);
  term.print(5, 3, '─'.repeat(46), 8);
  Object.keys(FISH).forEach((sp, i) => {
    term.print(6 + i, 3, sp.padEnd(12), 15);
    term.print(6 + i, 16, (st.records[sp] ? st.records[sp].toFixed(2) + ' lb' : '—').padEnd(15), 11);
    term.print(6 + i, 31, r.best[sp] ? r.best[sp].toFixed(2) + ' lb' : '—', 7);
  });
  term.print(14, 3, `Fish caught: ${r.caught}   Purse: ${money(r.purse)}`, 8);
  await term.pause();
}

async function run(term, ctx) {
  const st = store(ctx);
  const r = rec(st, term.user.handle);
  for (;;) {
    term.cls();
    bar(term, r);
    term.print(2, 3, 'THE LAKE AT DAWN', 11);
    term.print(3, 3, 'Mist on the water. Nothing but time.', 8);
    const top = 5;
    lakeMap(term, r, top);
    const sp = SPOTS[r.lastSpot - 1];
    term.print(top + 9, 3, `Last spot: ${sp.name} — ${sp.depth}`, 7);
    term.print(top + 10, 3, `Bait: ${(BAITS.find((b) => b.key === r.baitChoice) || BAITS[0]).name}`, 7);
    term.print(top + 11, 3, `Casts left: ${r.casts}   Purse: ${money(r.purse)}`, 14);
    term.write('\r\n');
    term.color(14);
    term.write('  [C]ast   [S]hop   [R]ecords   [Q]uit\r\n');
    term.reset();
    const k = await term.menu({ prompt: '\x1b[0;36mWhat now? \x1b[0m', valid: 'CSRQ', allowEmpty: true });
    if (k == null || k === 'Q' || k === 'ESC' || k === '') return;
    if (k === 'C') {
      if (r.casts <= 0) {
        term.write('\r\n  No casts left today. The fish will still be there tomorrow.\r\n');
        await term.pause();
        continue;
      }
      await cast(term, ctx, st, r);
    } else if (k === 'S') {
      await shop(term, ctx, st, r);
    } else if (k === 'R') {
      await records(term, st, r);
    }
  }
}

module.exports = {
  id: ID,
  name: 'FRESHWATER FISHING',
  author: 'Gate Software',
  category: 'Other',
  description: 'Nine spots, three rods, ten casts a day. Sit still and watch the line.',
  minLevel: 10,
  run,
};
