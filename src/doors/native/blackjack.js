'use strict';
// BLACKJACK — native BBS casino door (CommonJS, zero dependencies).
//
// Bets are real ctx.user.credits; every state change is saved through ctx.save().
// A six-deck shoe is shuffled per session, the dealer stands on 17, and a
// natural pays 3:2. Session results land in a small persistent high-score list
// at ctx.db.data.doors.blackjack.scores.

// --------------------------------------------------------------- constants

const DOOR_ID = 'blackjack';
const GAME_NAME = 'BLACKJACK';
const SW = 80;
const DECKS = 6;
const MIN_BET = 10;
const IDLE_MS = 180000; // idle callers time out of a key read; carrier loss raises Hangup
const CHIPS = [10, 25, 50, 100];
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RED = 12; // bright red for hearts/diamonds; S and C print bright white

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

function put(term, row, col, text, fg, bg) {
  if (row < 1 || row > (term.rows || 25) || col > SW) return;
  const max = SW - col + 1;
  let s = String(text == null ? '' : text);
  if (s.length > max) s = s.slice(0, max);
  term.print(row, col, s, fg, bg);
}

function rule(term, row, ch, fg) {
  put(term, row, 1, String(ch || '─').repeat(SW), fg);
}

function bar(term, row, left, right, bg) {
  put(term, row, 1, ' '.repeat(SW), 15, bg || 6);
  put(term, row, 2, left, 15, bg || 6);
  if (right) put(term, row, SW - String(right).length - 1, right + ' ', 15, bg || 6);
}

// ------------------------------------------------------------------- cards

function makeShoe() {
  const shoe = [];
  for (let d = 0; d < DECKS; d++) {
    for (const s of SUITS) for (const r of RANKS) shoe.push({ r, s });
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shoe[i];
    shoe[i] = shoe[j];
    shoe[j] = tmp;
  }
  return shoe;
}

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.r === 'A') { aces += 1; total += 11; }
    else if (c.r === '10' || c.r === 'J' || c.r === 'Q' || c.r === 'K') total += 10;
    else total += Number(c.r);
  }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return total;
}

// Five-row card face. S/H/D/C letters because the CP437 suits do not exist.
function cardArt(card, hidden) {
  if (hidden) {
    return ['┌─────┐', '│░░░░░│', '│░░░░░│', '│░░░░░│', '└─────┘'];
  }
  return [
    '┌─────┐',
    '│' + pad(card.r, 5) + '│',
    '│  ' + card.s + '  │',
    '│' + padl(card.r, 5) + '│',
    '└─────┘',
  ];
}

function drawHand(term, hand, top, hideIndex) {
  const max = Math.min(hand.length, 6);
  for (let i = 0; i < max; i++) {
    const col = 3 + i * 9;
    const hidden = hideIndex === i;
    const card = hand[i];
    const fg = hidden ? 8 : (card.s === 'H' || card.s === 'D' ? RED : 15);
    cardArt(card, hidden).forEach((t, j) => put(term, top + j, col, t, fg));
  }
  if (hand.length > max) put(term, top + 2, 3 + max * 9, '+ more', 8);
}

// ------------------------------------------------------------------- state

function storeOf(ctx) {
  const data = ctx.db.data;
  if (!data.doors) data.doors = {};
  let store = data.doors[DOOR_ID];
  if (!store || typeof store !== 'object') store = data.doors[DOOR_ID] = { scores: [] };
  if (!Array.isArray(store.scores)) store.scores = [];
  return store;
}

function recordScore(ctx, store, handle, net, hands) {
  if (hands <= 0) return false;
  const row = { handle, net: Math.round(net), hands, when: Date.now() };
  const existing = store.scores.findIndex((s) => s.handle === handle);
  if (existing >= 0) {
    if (store.scores[existing].net >= row.net) return false;
    store.scores.splice(existing, 1);
  }
  store.scores.push(row);
  store.scores.sort((a, b) => b.net - a.net);
  store.scores = store.scores.slice(0, 10);
  ctx.save();
  return store.scores.some((s) => s.handle === handle && s.net === row.net && s.hands === row.hands);
}

// -------------------------------------------------------------------- input

async function pick(term, valid) {
  for (;;) {
    const k = await term.readKey({ timeoutMs: IDLE_MS });
    if (k == null) continue;
    if (k === 'ENTER') return 'ENTER';
    if (k === 'ESC') return 'ESC';
    if (k === 'SPACE') {
      if (valid.indexOf(' ') >= 0) { term.write(' '); return 'SPACE'; }
      term.beep();
      continue;
    }
    const ch = String(k).toUpperCase();
    if (ch.length === 1 && valid.indexOf(ch) >= 0) {
      term.write(ch);
      return ch;
    }
    term.beep();
  }
}

async function press(term, row, label) {
  put(term, row, 1, pad('  ' + label, SW - 1), 8);
  const k = await term.readKey({ timeoutMs: IDLE_MS });
  return k === 'ESC' ? 'ESC' : 'OK';
}

// ------------------------------------------------------------------- table

function drawTable(term, ctx, st) {
  const credits = Math.max(0, Math.round(Number(ctx.user.credits) || 0));
  term.cls();
  bar(term, 1, GAME_NAME + '  ·  TABLE 3', 'DEALER STANDS ON 17', 6);
  put(term, 2, 2, `PLAYER ${st.handle}`, 14);
  put(term, 2, 26, `CREDITS ${comma(credits)}`, 10);
  put(term, 2, 48, `CHIPS ${comma(Math.floor(credits / 10))} x 10`, 8);
  put(term, 2, 70, `BET ${comma(st.bet)}`, 11);
  rule(term, 3, '═', 11);

  const dTotal = handValue(st.dealer);
  const pTotal = handValue(st.player);
  const dShow = st.hide ? (st.dealer.length ? handValue([st.dealer[0]]) : 0).toString() + '+' : String(dTotal);
  put(term, 4, 3, 'DEALER', 8);
  put(term, 4, 14, st.dealer.length ? 'SHOWING ' + dShow : '', st.hide ? 8 : 15);
  drawHand(term, st.dealer, 6, st.hide ? 1 : -1);
  put(term, 11, 3, st.dealer.length && !st.hide ? 'TOTAL ' + dTotal + (dTotal > 21 ? '  BUST' : '') : '', dTotal > 21 ? 12 : 15);

  rule(term, 12, '─', 8);

  put(term, 13, 3, String(st.handle).toUpperCase(), 14);
  put(term, 13, 14, st.player.length ? 'POSSIBLE ' + pTotal : '', 8);
  drawHand(term, st.player, 14, -1);
  const pBust = pTotal > 21;
  put(term, 19, 3, st.player.length ? 'TOTAL ' + pTotal + (pBust ? '  BUST' : '') + (st.player.length === 2 && pTotal === 21 ? '  BLACKJACK' : '') : '',
    pBust ? 12 : pTotal === 21 ? 10 : 15);

  rule(term, 20, '─', 8);

  const s = st.stats;
  put(term, 25, 1, pad(
    ` ${GAME_NAME}  ·  ${st.handle}  ·  hands ${s.hands}  W ${s.wins}  L ${s.losses}  P ${s.pushes}  BJ ${s.bjs}  net ${s.net >= 0 ? '+' : ''}${comma(s.net)} cr  ·  ESC backs out`,
    SW,
  ), 0, 7);

  put(term, 21, 3, pad(String(st.msg || ''), SW - 5), 15);
  put(term, 22, 3, pad(String(st.msg2 || ''), SW - 5), st.msg2fg || 8);

  if (st.phase === 'bet') {
    put(term, 23, 3, '[1] 10   [2] 25   [3] 50   [4] 100   [SPACE] repeat   [C] clear', 14);
    put(term, 24, 3, '[ENTER] deal   [H] hall of fame   [Q] cash out', 8);
  } else if (st.phase === 'play') {
    put(term, 23, 3, '[H] Hit      [S] Stand      [D] Double down', 14);
    put(term, 24, 3, 'ESC stands. Dealer must stand on 17, blackjack pays 3:2.', 8);
  } else {
    put(term, 23, 3, '[ENTER] next hand      [Q] cash out', 14);
    put(term, 24, 3, 'Dealer stands on 17. Six decks, shuffled between shoes.', 8);
  }
}

// --------------------------------------------------------------- high score

function drawScores(term, store, handle) {
  term.cls();
  bar(term, 1, GAME_NAME + '  ·  HALL OF FAME', 'TOP 10 SESSIONS', 5);
  rule(term, 2, '═', 11);
  put(term, 3, 3, 'RANK', 8);
  put(term, 3, 10, 'PLAYER', 8);
  put(term, 3, 36, 'SESSION NET', 8);
  put(term, 3, 52, 'HANDS', 8);
  put(term, 3, 61, 'WHEN', 8);
  rule(term, 4, '─', 8);
  const rows = store.scores.slice(0, 10);
  if (!rows.length) put(term, 6, 4, 'The book is empty. Somebody has to win first.', 8);
  rows.forEach((r, i) => {
    const mine = r.handle === handle;
    const when = new Date(r.when || Date.now());
    const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
    put(term, 5 + i, 3, padl(String(i + 1), 4), mine ? 10 : 14);
    put(term, 5 + i, 10, pad(r.handle, 24), mine ? 10 : 15);
    put(term, 5 + i, 36, padl((r.net >= 0 ? '+' : '') + comma(r.net) + ' cr', 13), r.net >= 0 ? 10 : 12);
    put(term, 5 + i, 52, padl(String(r.hands), 6), 15);
    put(term, 5 + i, 61, stamp, 8);
  });
  rule(term, 17, '─', 8);
  put(term, 18, 3, 'Only your best session is kept. Beating it replaces it.', 8);
  put(term, 23, 3, 'Press any key to return to the table.', 8);
}

async function scoresScreen(term, store, handle) {
  drawScores(term, store, handle);
  await term.readKey({ timeoutMs: IDLE_MS });
}

// ----------------------------------------------------------------- settle

function settle(ctx, stats, player, dealer, bet) {
  const pv = handValue(player);
  const dv = handValue(dealer);
  const pBJ = player.length === 2 && pv === 21;
  const dBJ = dealer.length === 2 && dv === 21;
  let net = 0;
  let msg = '';
  if (pBJ && dBJ) {
    ctx.user.credits += bet;
    net = 0;
    msg = 'Two naturals. Push — your ' + comma(bet) + ' credit bet comes back.';
    stats.pushes += 1;
    stats.bjs += 1;
  } else if (pBJ) {
    const win = Math.floor(bet * 1.5);
    ctx.user.credits += bet + win;
    net = win;
    msg = 'BLACKJACK! Paid 3:2, +' + comma(win) + ' credits.';
    stats.wins += 1;
    stats.bjs += 1;
  } else if (dBJ) {
    net = -bet;
    msg = 'Dealer turns a natural. The house takes ' + comma(bet) + '.';
    stats.losses += 1;
  } else if (pv > 21) {
    net = -bet;
    msg = 'Bust with ' + pv + '. The dealer collects ' + comma(bet) + '.';
    stats.losses += 1;
  } else if (dv > 21) {
    ctx.user.credits += bet * 2;
    net = bet;
    msg = 'Dealer busts with ' + dv + '. You win ' + comma(bet) + '.';
    stats.wins += 1;
  } else if (pv > dv) {
    ctx.user.credits += bet * 2;
    net = bet;
    msg = pv + ' beats ' + dv + '. You win ' + comma(bet) + '.';
    stats.wins += 1;
  } else if (pv < dv) {
    net = -bet;
    msg = dv + ' beats your ' + pv + '. The house takes ' + comma(bet) + '.';
    stats.losses += 1;
  } else {
    ctx.user.credits += bet;
    net = 0;
    msg = 'Push at ' + pv + '. Your bet comes back.';
    stats.pushes += 1;
  }
  stats.hands += 1;
  stats.net += net;
  ctx.user.credits = Math.max(0, Math.round(ctx.user.credits));
  ctx.save();
  return { msg, net, pv, dv };
}

// --------------------------------------------------------------------- run

async function run(term, ctx) {
  const store = storeOf(ctx);
  const handle = String(ctx.user.handle || 'player');
  const stats = { hands: 0, wins: 0, losses: 0, pushes: 0, bjs: 0, net: 0 };
  let shoe = makeShoe();
  let bet = 0;
  let lastBet = 0;
  let player = [];
  let dealer = [];
  let hide = true;
  let msg = 'Table three is open. Chips are 10 credits each. Dealer stands on 17.';
  let msg2 = '';
  let msg2fg = 8;

  const draw = () => {
    if (!shoe.length || shoe.length < 60) {
      shoe = makeShoe();
      msg2 = 'The pit boss cuts in a fresh six-deck shoe.';
      msg2fg = 8;
    }
    return shoe.pop();
  };

  const table = (phase) => drawTable(term, ctx, { handle, bet, player, dealer, hide, stats, msg, msg2, msg2fg, phase });

  try {
    for (;;) {
      // ------------------------------------------------------------ betting
      let dealt = false;
      while (!dealt) {
        const credits = Math.max(0, Math.round(Number(ctx.user.credits) || 0));
        if (credits < MIN_BET) {
          table('bet');
          put(term, 21, 3, pad('You are down to ' + comma(credits) + ' credits. The table minimum is 10.', SW - 5), 12);
          put(term, 24, 3, pad('[H] hall of fame   [Q] cash out', SW - 5), 8);
          const k = await pick(term, 'HQ');
          if (k === 'ESC' || k === 'Q') {
            await cashOut(term, ctx, store, handle, stats);
            return;
          }
          if (k === 'H') { await scoresScreen(term, store, handle); msg = ''; continue; }
          continue;
        }
        table('bet');
        const k = await pick(term, '1234CQEH ');
        if (k === 'ESC' || k === 'Q') {
          await cashOut(term, ctx, store, handle, stats);
          return;
        }
        if (k === 'H') {
          await scoresScreen(term, store, handle);
          msg = '';
          continue;
        }
        if (k === 'C') {
          bet = 0;
          msg = 'Bet cleared.';
          msg2 = '';
          continue;
        }
        if (k === 'SPACE') {
          if (lastBet < MIN_BET) { msg2 = 'No previous bet to repeat.'; continue; }
          bet = Math.min(credits, lastBet);
          msg = 'Bet ' + comma(bet) + '. Press ENTER to deal.';
          msg2 = '';
          continue;
        }
        if (k === 'ENTER') {
          if (bet < MIN_BET) { msg2 = 'The minimum bet is ' + MIN_BET + ' credits.'; continue; }
          if (bet > ctx.user.credits) { msg2 = 'You cannot cover that bet.'; bet = 0; continue; }
          dealt = true;
          break;
        }
        const idx = '1234'.indexOf(k);
        if (idx >= 0) {
          const chip = CHIPS[idx];
          if (bet + chip > credits) { msg2 = 'Not enough credits for a ' + chip + ' chip.'; continue; }
          bet += chip;
          msg = 'Bet ' + comma(bet) + ' credits. Press ENTER to deal.';
          msg2 = '';
        }
      }

      // --------------------------------------------------------------- deal
      lastBet = bet;
      ctx.user.credits -= bet;
      ctx.save();
      player = [draw(), draw()];
      dealer = [draw(), draw()];
      hide = true;
      msg = 'Dealing.';
      msg2 = '';
      msg2fg = 8;

      const pBJ = handValue(player) === 21;
      const dBJ = handValue(dealer) === 21;

      if (!pBJ && !dBJ) {
        // ------------------------------------------------------- player turn
        let done = false;
        while (!done) {
          table('play');
          const k = await pick(term, 'HSD');
          if (k === 'H') {
            player.push(draw());
            const v = handValue(player);
            if (v > 21) {
              msg = 'Bust! ' + v + ' is too many.';
              done = true;
            } else if (v === 21) {
              msg = 'Twenty-one. Standing.';
              done = true;
            } else {
              msg = 'Hit: ' + v + '.';
            }
            continue;
          }
          if (k === 'S' || k === 'ESC') {
            msg = 'You stand on ' + handValue(player) + '.';
            done = true;
            continue;
          }
          if (k === 'D') {
            if (player.length !== 2) { msg2 = 'Double is only allowed on the first two cards.'; continue; }
            if (ctx.user.credits < bet) { msg2 = 'You cannot cover a double.'; continue; }
            ctx.user.credits -= bet;
            bet *= 2;
            ctx.save();
            player.push(draw());
            msg = 'Doubled to ' + comma(bet) + '. One card: ' + handValue(player) + '.';
            done = true;
          }
        }
      } else {
        msg = pBJ ? 'Natural on the deal!' : 'Dealer shows a natural.';
      }

      // ------------------------------------------------------- dealer's turn
      hide = false;
      if (handValue(player) <= 21 && !pBJ) {
        while (handValue(dealer) < 17) {
          dealer.push(draw());
        }
      }

      const result = settle(ctx, stats, player, dealer, bet);
      msg = result.msg;
      msg2 = 'Dealer ' + result.dv + '  ·  you ' + result.pv + '  ·  session net ' +
        (stats.net >= 0 ? '+' : '') + comma(stats.net) + ' cr';
      msg2fg = result.net > 0 ? 10 : result.net < 0 ? 12 : 8;
      table('settle');

      const k = await pick(term, 'Q');
      bet = 0;
      if (k === 'ESC' || k === 'Q') {
        await cashOut(term, ctx, store, handle, stats);
        return;
      }
      msg = 'Place your bet.';
      msg2 = '';
      player = [];
      dealer = [];
      hide = true;
    }
  } catch (e) {
    if (e && e.name === 'AbortInput') {
      recordScore(ctx, store, handle, stats.net, stats.hands);
      return;
    }
    throw e;
  } finally {
    try {
      recordScore(ctx, store, handle, stats.net, stats.hands);
      ctx.save();
    } catch { /* never fail a door on a save */ }
  }
}

async function cashOut(term, ctx, store, handle, stats) {
  recordScore(ctx, store, handle, stats.net, stats.hands);
  term.cls();
  bar(term, 1, GAME_NAME + '  ·  CASHING OUT', handle, 5);
  rule(term, 2, '═', 11);
  const lines = [
    ['Hands played', String(stats.hands)],
    ['Won / lost / pushed', `${stats.wins} / ${stats.losses} / ${stats.pushes}`],
    ['Naturals', String(stats.bjs)],
    ['Session', (stats.net >= 0 ? '+' : '') + comma(stats.net) + ' credits'],
    ['Bankroll', comma(Math.max(0, Math.round(ctx.user.credits || 0))) + ' credits'],
  ];
  lines.forEach((r, i) => {
    put(term, 4 + i * 2, 4, pad(r[0], 22) + ':', 8);
    put(term, 4 + i * 2, 28, r[1], 15);
  });
  rule(term, 15, '─', 8);
  put(term, 16, 4, stats.net > 0 ? 'You leave the table up. The dealer does not smile.'
    : stats.net < 0 ? 'The house always keeps the lights on. Come back tomorrow.'
      : 'You break even. The coffee was free, at least.', 11);
  put(term, 17, 4, 'Session recorded in the hall of fame if it beats your best.', 8);
  put(term, 23, 3, 'Press any key to return to the table.', 8);
  await term.readKey({ timeoutMs: IDLE_MS });
}

module.exports = {
  id: DOOR_ID,
  name: GAME_NAME,
  author: 'Gate Software',
  category: 'Casino',
  description: 'Six-deck blackjack against the house. Real credits, 3:2 naturals, dealer stands on 17.',
  minLevel: 10,
  players: 'multi',
  run,
  _internals: { makeShoe, handValue, cardArt },
};
