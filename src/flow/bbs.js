'use strict';
// Session entry point + the main menu.
const config = require('../config');
const db = require('../db');
const nodes = require('../nodes');
const s = require('./screens');
const loginFlow = require('./login');
const messages = require('./messages');
const files = require('./files');
const doors = require('../doors/manager');
const chat = require('./chat');
const who = require('./who');
const misc = require('./misc');
const Terminal = require('../terminal');

const COMMANDS = {
  M: ['Message bases', () => messages.bases],
  E: ['Private e-mail', () => messages.mail],
  F: ['File areas', () => files.areas],
  D: ['Door games', () => doors.menu],
  C: ['Chat room', () => chat.enter],
  W: ['Who is online', () => who.online],
  U: ['User list', () => who.userList],
  L: ['Last callers', () => who.lastCallers],
  B: ['Bulletins', () => misc.bulletins],
  V: ['Voting booth', () => misc.voting],
  T: ['Time bank', () => misc.timeBank],
  R: ['Rumors & oneliners', () => misc.oneliners],
  N: ['New files scan', () => files.newScan],
  Y: ['Your settings', () => misc.settings],
  S: ['System stats', () => who.stats],
  '/': ['Page the sysop', () => misc.pageSysop],
  G: ['Goodbye', null],
};

function drawMenu(term) {
  term.cls();
  const hasArt = s.showArt(term, config.get('ansi.mainArt'), { fallback: false });
  if (!hasArt) s.banner(term, config.get('bbs.name'), config.get('bbs.tagline'));

  const top = Math.max(12, Math.floor(term.rows * 0.52));
  const online = nodes.online();
  const boxW = Math.min(term.cols - 4, 76);
  const x = Math.floor((term.cols - boxW) / 2) + 1;

  term.print(top, x, '╔' + '═'.repeat(boxW - 2) + '╗', 11);
  const colW = 34;
  const row = (r, left, right) => {
    const inner = boxW - 4;
    term.print(r, x, '║', 11);
    term.print(r, x + 2, s.pad(left, colW), 14);
    term.print(r, x + 2 + colW, s.pad(right, inner - colW), 14);
    term.print(r, x + boxW - 1, '║', 11);
  };
  row(top + 1, '[M] Message bases', '[E] Private e-mail');
  row(top + 2, '[F] File areas', '[N] New files scan');
  row(top + 3, '[D] Door games', '[C] Chat room');
  row(top + 4, '[W] Who is online', '[L] Last callers');
  row(top + 5, '[B] Bulletins', '[V] Voting booth');
  row(top + 6, '[T] Time bank', '[R] Rumors');
  row(top + 7, '[U] User list', '[Y] Your settings');
  row(top + 8, '[/] Page the SysOp', '[S] System stats');
  term.print(top + 9, x, '╚' + '═'.repeat(boxW - 2) + '╝', 11);

  const unread = messages.unreadCount(term.user);
  const noteRow = top + 11;
  if (noteRow < term.rows - 2) {
    term.print(noteRow, x, `Callers on: ${online.length}/${config.get('bbs.maxNodes')}   `, 7);
    term.print(noteRow, x + 20, unread ? `*** ${unread} private message(s) waiting ***` : 'No new private mail.', unread ? 14 : 8);
    term.print(noteRow + 1, x, `Logged on as ${term.user.handle} (${term.user.level >= 100 ? 'SysOp' : 'User'})  ·  ${s.clock()}`, 8);
  }
  s.status(term, online.map((o) => o.handle).slice(0, 3).join(', '));
  term.gotoxy(term.rows - 2, 1);
}

function tick(term) {
  const elapsed = Math.floor((Date.now() - term.session.started) / 60000);
  const left = Math.max(0, term.session.timeLimit - elapsed);
  const prev = term.session.minutesLeft;
  term.session.minutesLeft = left;
  if (left !== prev && left <= 5 && left > 0) {
    term.write(`\r\n\x1b[1;33m*** Only ${left} minute(s) of connect time left ***\x1b[0m\r\n`);
  }
  return left;
}

async function mainMenu(term) {
  for (;;) {
    tick(term);
    if (term.session.minutesLeft <= 0) {
      term.write('\r\n\x1b[1;31mYour time has expired. Hanging up.\x1b[0m\r\n');
      return;
    }
    drawMenu(term);
    const key = await term.menu({
      prompt: '\x1b[0;36mCommand: \x1b[0m',
      valid: Object.keys(COMMANDS).join('') + '?',
      allowEmpty: true,
      defaultVal: null,
    });
    if (key == null) return;
    if (key === 'ESC') continue;
    if (key === '') continue;
    if (key === '?') {
      misc.help(term);
      continue;
    }
    if (key === 'G') return;
    const entry = COMMANDS[key];
    if (!entry) continue;
    const [label, fn] = entry;
    term.activity = label;
    try {
      await fn()(term);
    } catch (err) {
      const name = err && err.name;
      if (name === 'Hangup') throw err;
      // ESC inside a feature cancels the feature, it must not drop the carrier
      if (name === 'AbortInput') {
        term.write('\r\n');
        term.activity = 'Main menu';
        continue;
      }
      term.write(`\r\n\x1b[0;31mError: ${err && err.message ? err.message : err}\x1b[0m\r\n`);
      await term.pause();
    }
    term.activity = 'Main menu';
  }
}

async function goodbye(term, reason = 'User logoff') {
  const user = term.user;
  s.showArt(term, config.get('ansi.goodbyeArt'), { subtitle: 'Goodbye' });
  const mins = Math.max(1, Math.round((Date.now() - term.session.started) / 60000));
  if (user) {
    const up = user.uploads || 0;
    term.write('\r\n');
    term.center(12, `Thanks for calling, ${user.handle}.`, 14);
    term.center(14, `You were on for ${mins} minute(s) at ${Number(term.modem ? term.modem.bps : 14400).toLocaleString('en-US')} bps.`, 7);
    term.center(15, `Calls: ${user.calls}   Messages: ${user.posts || 0}   Uploads: ${up}`, 7);
    term.center(17, 'Call back soon. The Gate is always open.', 11);
    db.addCaller({
      handle: user.handle,
      node: term.node,
      kind: term.kind,
      minutes: mins,
      note: reason,
    });
  } else {
    term.center(14, 'Thanks for calling. Call back soon.', 7);
  }
  term.write('\r\n\r\n');
  term.center(term.rows - 5, reason === 'carrier' ? 'NO CARRIER' : '+++ ATH0  (hang up)', 8);
  term.reset();
  db.save();
}

async function runSession(term) {
  const maxNodes = config.get('bbs.maxNodes');
  const node = nodes.allocate(term, maxNodes);
  if (!node) {
    term.write('\r\n\x1b[1;31mAll nodes are busy. Please try again later.\x1b[0m\r\n');
    term.write('NO CARRIER\r\n');
    term.hangup('busy');
    return;
  }
  term.node = node;
  term.activity = 'Dialing in';

  const carrier = () => term.hangup('carrier');
  term.on('hangup', carrier);

  try {
    // dial-in theatre, paced like a real call; any key skips it
    const numbers = config.get('bbs.dialNumbers') || ['555-0113'];
    const dialed = term.dialNumber || numbers[Math.floor(Math.random() * numbers.length)];
    const modems = config.get('bbs.modems') || [{ bps: 14400, connect: '14400/ARQ/V32BIS/LAPM/V42BIS', name: 'Sportster' }];
    const modem =
      (term.modemBps && modems.find((m) => Number(m.bps) === Number(term.modemBps))) ||
      modems[Math.floor(Math.random() * modems.length)];
    term.modem = modem;
    let skipped = false;
    const wait = async (ms) => {
      const end = Date.now() + ms;
      while (!skipped && Date.now() < end && term.alive) {
        const k = await term.readKey({ timeoutMs: Math.min(150, Math.max(30, end - Date.now())) });
        if (k != null) {
          skipped = true;
          // keep a printable keystroke for the handle prompt instead of eating it
          if (k.length === 1 && /[A-Za-z0-9]/.test(k)) term.feed(k);
        }
      }
    };
    term.cls();
    term.write('\r\n\r\n');
    term.write(`ATDT ${dialed}\r\n`);
    await wait(600);
    term.write('RING\r\n');
    await wait(1500);
    if (!skipped) term.write('RING\r\n');
    await wait(1400);
    term.write('\x1b[0;90mAnswer tone 2100 Hz — training...\x1b[0m\r\n');
    await wait(1200);
    term.write(`\x1b[0;32mCONNECT ${modem.connect}  (${modem.name})\x1b[0m\r\n`);
    if (term.kind === 'web') term.write('\x1b[0;90m(press a key to skip the modem noises)\x1b[0m\r\n');
    await wait(250);
    term.write(`\r\n\x1b[0;36m${config.get('bbs.name')}\x1b[0m  Node ${term.node}  ${s.clock()}\r\n`);
    term.write('\x1b[0;90mPress any key to continue...\x1b[0m');
    const firstKey = await term.readKey({ timeoutMs: 1600 });
    if (firstKey && firstKey.length === 1 && /[A-Za-z0-9]/.test(firstKey)) term.feed(firstKey);
    term.write('\r\n');

    await loginFlow.showWelcome(term);
    term.activity = 'Logging on';
    const user = await loginFlow.login(term);
    const isNew = !user.calls || user.calls === 0;
    loginFlow.startSession(term, user, isNew);
    term.activity = 'Main menu';

    term.write('\x1b[2J\x1b[H');
    await loginFlow.announce(term, user);
    if (isNew) {
      s.info(term, 'Since this is your first call, wander around. Read the bulletins. Mind the sysop.', 11);
    }
    await term.pause('Press any key to continue');
    await mainMenu(term);
    await goodbye(term, 'User logoff');
  } catch (err) {
    if (err && (err.name === 'AbortInput' || err.name === 'Hangup')) {
      // caller hit ESC or dropped the carrier
      if (err.name === 'AbortInput') {
        try {
          await goodbye(term, 'ESC (abort)');
        } catch {}
      }
    } else {
      console.error('session error:', err);
      try {
        term.write('\r\n\x1b[1;31m+++ CARRIER LOST +++\x1b[0m\r\n');
      } catch {}
    }
  } finally {
    term.off('hangup', carrier);
    if (term.user) {
      const mins = Math.max(1, Math.round((Date.now() - term.session.started) / 60000));
      term.user.lastCall = Date.now();
      db.save();
      nodes.bus.emit('caller-offline', { term, user: term.user, minutes: mins });
    }
    nodes.bus.emit('node-change', nodes.online());
    term.hangup('bye');
  }
}

module.exports = { runSession, mainMenu, drawMenu, COMMANDS };
