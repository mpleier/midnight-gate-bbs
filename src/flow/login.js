'use strict';
// Logon sequence + new user registration. Deliberately slow and talkative.
const config = require('../config');
const db = require('../db');
const auth = require('../auth');
const s = require('./screens');
const nodes = require('../nodes');

function lastCallerText() {
  const prev = db.callers.find((c) => !c.bot);
  if (!prev) return 'You are the first caller today.';
  return `Last caller: ${prev.handle} (${s.fmtDate(prev.when)})`;
}

async function showWelcome(term) {
  s.showArt(term, config.get('ansi.welcomeArt'), {
    title: config.get('bbs.name'),
    subtitle: config.get('bbs.tagline'),
  });
  const startRow = Math.max(12, Math.floor(term.rows * 0.58));
  term.print(startRow, 3, '─'.repeat(Math.min(term.cols - 6, 74)), 8);
  const c = config.data.bbs;
  term.print(startRow + 1, 3, `${c.name}  ·  ${c.location}  ·  ${c.software}`, 11);
  term.print(startRow + 2, 3, `SysOp: ${c.sysop}   Nodes: ${nodes.count()}/${c.maxNodes}   ${s.clock()}`, 7);
  term.print(startRow + 3, 3, lastCallerText().slice(0, term.cols - 6), 8);
  term.print(startRow + 4, 3, '─'.repeat(Math.min(term.cols - 6, 74)), 8);
  term.reset();
  term.gotoxy(startRow + 6, 1);
}

async function login(term) {
  const bbs = config.data.bbs;
  let attempts = 0;
  for (;;) {
    if (attempts >= 4) {
      term.write('\r\nToo many tries. The sysop has been notified.\r\n');
      throw new Error('auth');
    }
    const handle = await term.readLine({ prompt: '\r\nHandle (NEW to register): ', max: 24, upper: false });
    const name = handle.trim();
    if (!name) continue;
    if (/^(new|newuser|register|signup)$/i.test(name)) {
      if (!bbs.allowNewUsers) {
        s.error(term, 'New user registration is closed right now. Sorry.');
        continue;
      }
      const user = await newUser(term);
      if (user) return user;
      continue;
    }
    const user = db.findUser(name);
    if (!user) {
      s.error(term, `No account for '${name}'.`);
      attempts++;
      continue;
    }
    if (user.banned) {
      term.write('\r\nThis account has been revoked.\r\n');
      throw new Error('banned');
    }
    const pw = await term.readLine({ prompt: 'Password: ', max: 32, mask: true });
    if (!auth.checkPassword(user, pw)) {
      s.error(term, 'Incorrect password.');
      attempts++;
      continue;
    }
    return user;
  }
}

const QUESTIONS = [
  ['name', 'What is your real name', 40],
  ['city', 'City', 20],
  ['state', 'State / Province', 20],
  ['phone', 'Phone number (private)', 20],
  ['birth', 'Date of birth (MM/DD/YY)', 10],
  ['email', 'Internet e-mail (optional)', 48],
  ['gender', 'Gender (M/F/other)', 8],
];

async function newUser(term) {
  s.showArt(term, config.get('ansi.newUserArt'), { subtitle: 'New User Registration' });
  term.print(2, 2, 'NEW USER REGISTRATION', 15);
  term.print(3, 2, 'Answer honestly. The sysop reads these.', 7);
  term.gotoxy(6, 1);
  s.info(term, 'There are a few questions. Take your time. You can press ESC to bail out.', 11);
  term.write('\r\n');

  const reg = { level: config.get('bbs.newUserLevel'), ansi: term.ansi, credits: 20, timeBank: 0, calls: 0 };
  let handle = await term.readLine({ prompt: 'Choose a handle: ', max: 20, min: 2 });
  handle = handle.trim().replace(/\s+/g, ' ');
  while (db.findUser(handle) || /^new$/i.test(handle)) {
    s.error(term, 'That handle is taken.');
    handle = await term.readLine({ prompt: 'Handle: ', max: 20, min: 2 });
  }
  reg.handle = handle;

  const pw = await term.readLine({ prompt: 'Password: ', max: 32, mask: true, min: bbs_minPassword() });
  const pw2 = await term.readLine({ prompt: 'Again to verify: ', max: 32, mask: true });
  if (pw !== pw2) {
    s.error(term, 'Passwords do not match. Starting over.');
    return null;
  }
  auth.setPassword(reg, pw);

  for (const [field, question, max] of QUESTIONS) {
    let val = '';
    for (;;) {
      val = await term.readLine({ prompt: `${question}: `, max, allowEmpty: true, defaultVal: field === 'email' ? '' : undefined });
      if (field === 'name' && !val.trim()) {
        s.error(term, 'The sysop insists on a name.');
        continue;
      }
      break;
    }
    reg[field] = val.trim();
  }

  const ansi = await term.yesno('Does your terminal support ANSI colour', true);
  reg.ansi = ansi;
  term.write('\r\n');
  s.info(term, 'Profanity is not permitted on this board. Do not upload copyrighted software.', 10);
  s.info(term, 'You are responsible for everything done under your handle.', 10);
  const agree = await term.yesno('Do you agree to the rules', true);
  if (!agree) {
    term.write('\r\nThen this is where we part ways. Hang up any time.\r\n');
    await term.pause();
    return null;
  }

  reg.id = 'user_' + require('node:crypto').randomBytes(5).toString('hex');
  reg.firstCall = Date.now();
  reg.lastCall = Date.now();
  reg.calls = 1;
  reg.uploads = 0;
  reg.downloads = 0;
  reg.posts = 0;
  reg.sig = '';
  reg.notes = 'Registered online.';
  db.users.push(reg);
  db.save();
  s.ok(term, `Account '${reg.handle}' created. You are caller #${db.stats.callsTotal + 1}.`);
  await term.pause();
  return reg;
}

function bbs_minPassword() {
  return config.get('bbs.minPassword') || 4;
}

function announce(term, user) {
  const d = new Date(user.lastCall || Date.now());
  term.write('\r\n');
  s.rule(term, '─', 8);
  term.color(11);
  term.write(`  Welcome back, ${user.handle}.\r\n`);
  term.reset();
  const unread = db.messages.filter((m) => m.to && m.to.toLowerCase() === user.handle.toLowerCase()).length;
  term.write(`  Access .....: ${auth.levelName(user.level)} (level ${user.level})\r\n`);
  term.write(`  Calls ......: ${user.calls}   Posts: ${user.posts || 0}   Credits: ${user.credits ?? 0}\r\n`);
  term.write(`  Last call ..: ${s.fmtDate(d.getTime())} from ${user.city || 'parts unknown'}\r\n`);
  if (unread) term.write(`  Private mail: ${unread} message(s) waiting\r\n`);
  s.rule(term, '─', 8);
}

function startSession(term, user, isNew) {
  const bbs = config.data.bbs;
  const limit = user.timeLimit || (isNew ? bbs.newUserTime : bbs.timeLimit);
  term.user = user;
  term.session.timeLimit = limit;
  term.session.minutesLeft = limit;
  term.session.started = Date.now();
  term.session.isNew = !!isNew;
  term.handle = user.handle;

  user.calls = (user.calls || 0) + 1;
  user.lastCall = Date.now();
  db.save();

  db.addCaller({
    handle: user.handle,
    node: term.node,
    kind: term.kind,
    location: [user.city, user.state].filter(Boolean).join(', '),
    minutes: 0,
    note: isNew ? 'first call' : 'logged on',
  });

  nodes.bus.emit('node-change', nodes.online());
  nodes.bus.emit('caller-online', { term, user });
}

module.exports = { login, newUser, startSession, announce, showWelcome, lastCallerText };
