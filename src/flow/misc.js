'use strict';
// Bulletins, voting booth, time bank, oneliners, settings, sysop page, help.
const config = require('../config');
const db = require('../db');
const auth = require('../auth');
const s = require('./screens');
const nodes = require('../nodes');

async function bulletins(term) {
  for (;;) {
    const top = s.frame(term, 'BULL.ANS', 'SYSTEM BULLETINS');
    db.bulletins.forEach((b, i) => {
      const row = top + 1 + i;
      term.print(row, 3, String(i + 1).padStart(2), 10);
      term.print(row, 7, s.pad(b.title, 55), 15);
      term.print(row, 64, s.fmtDate(b.date), 8);
    });
    term.print(term.rows - 3, 3, 'Bulletin number, or [Q]uit: ', 14);
    term.gotoxy(term.rows - 2, 1);
    term.reset();
    const k = await term.readKey({ timeoutMs: 120000 });
    if (k == null || String(k).toUpperCase() === 'Q' || k === 'ESC') return;
    const n = Number(String(k));
    if (!n) continue;
    const b = db.bulletins[n - 1];
    if (!b) continue;
    term.cls();
    s.header(term, b.title.toUpperCase(), 11);
    term.write('\r\n');
    for (const l of term.wrap(b.body, term.cols - 8)) {
      term.write('    ' + l + '\r\n');
    }
    term.write('\r\n');
    term.color(8);
    term.write(`  Posted ${s.fmtDate(b.date)}\r\n`);
    term.reset();
    await term.pause();
  }
}

async function voting(term) {
  const polls = db.votes.filter((v) => v.open);
  if (!polls.length) {
    term.cls();
    s.header(term, 'VOTING BOOTH', 11);
    s.info(term, 'No open ballots right now. The sysop is slacking.', 8);
    await term.pause();
    return;
  }
  const poll = polls[0];
  term.cls();
  s.header(term, 'VOTING BOOTH', 11);
  term.write('\r\n');
  term.color(15);
  term.write('  ' + poll.question + '\r\n\r\n');
  term.reset();
  poll.options.forEach((o, i) => {
    term.print(7 + i, 5, String(i + 1) + ')', 10);
    term.print(7 + i, 8, o, 14);
  });
  term.write('\r\n');
  const total = Object.keys(poll.ballots || {}).length;
  const voted = poll.ballots && poll.ballots[term.user.handle.toLowerCase()];
  term.color(8);
  term.write(`  ${total} ballot(s) cast so far.` + (voted ? ` You voted for #${voted}.` : '') + '\r\n');
  term.reset();
  const k = await term.menu({ prompt: 'Vote (1-' + poll.options.length + ', Q to quit): ', valid: '123456789Q', allowEmpty: true });
  if (k == null || k === 'Q' || k === 'ESC' || k === '') return;
  const choice = Number(k);
  if (choice >= 1 && choice <= poll.options.length) {
    poll.ballots = poll.ballots || {};
    poll.ballots[term.user.handle.toLowerCase()] = choice;
    db.save();
    s.ok(term, 'Ballot recorded. The sysop counts these by hand.');
  }
  // results
  term.write('\r\n');
  const counts = poll.options.map((o, i) => Object.values(poll.ballots || {}).filter((v) => v === i + 1).length);
  const maxV = Math.max(1, ...counts);
  poll.options.forEach((o, i) => {
    const bars = Math.round((counts[i] / maxV) * 30);
    term.print(12 + i, 5, s.pad(o.slice(0, 34), 34), 7);
    term.print(12 + i, 40, '█'.repeat(bars), 11);
    term.print(12 + i, 72, String(counts[i]), 14);
  });
  await term.pause();
}

async function timeBank(term) {
  term.cls();
  s.header(term, 'TIME BANK', 11);
  const u = term.user;
  term.write('\r\n');
  term.print(6, 5, 'Current balance', 8);
  term.print(6, 25, `${u.timeBank || 0} minute(s)`, 15);
  term.print(8, 5, 'Time left this call', 8);
  term.print(8, 25, `${term.session.minutesLeft} minute(s)`, 15);
  term.print(10, 5, 'Posting credit', 8);
  term.print(10, 25, `${u.credits || 0} credits (1 min per 5 credits)`, 15);
  term.write('\r\n');
  term.color(8);
  term.write('  [W]ithdraw 2 minutes from the bank   [Q]uit\r\n');
  term.reset();
  const k = await term.menu({ prompt: 'Command: ', valid: 'WQ', allowEmpty: true });
  if (k === 'W') {
    if ((u.timeBank || 0) >= 2) {
      u.timeBank -= 2;
      term.session.timeLimit += 2;
      term.session.minutesLeft += 2;
      db.save();
      s.ok(term, 'Two minutes added to this call.');
    } else {
      s.error(term, 'Not enough time banked. Post messages and upload files to earn more.');
    }
  }
  await term.pause();
}

async function oneliners(term) {
  term.cls();
  s.header(term, 'RUMORS & ONELINERS', 11);
  term.write('\r\n');
  db.data.oneliners.slice(-12).forEach((l, i) => {
    term.print(6 + i, 4, s.pad(l, term.cols - 8), i % 2 ? 15 : 14);
  });
  term.write('\r\n');
  const add = await term.readLine({ prompt: 'Add a one-liner (blank to quit): ', max: 70, allowEmpty: true });
  if (add && add.trim()) {
    db.data.oneliners.push(`${term.user.handle}: ${add.trim()}`);
    if (db.data.oneliners.length > 80) db.data.oneliners.shift();
    db.save();
    s.ok(term, 'Added. The sysop pretends not to read these.');
    await term.pause();
  }
}

async function settings(term) {
  const u = term.user;
  for (;;) {
    term.cls();
    s.header(term, 'YOUR SETTINGS', 11);
    term.write('\r\n');
    const rows = [
      ['Handle', u.handle],
      ['Real name', u.name || ''],
      ['Location', [u.city, u.state].filter(Boolean).join(', ')],
      ['E-mail', u.email || '(none)'],
      ['ANSI colour', u.ansi ? 'Yes' : 'No'],
      ['Signature', u.sig || '(none)'],
      ['Access', `${auth.levelName(u.level)} (level ${u.level})`],
    ];
    rows.forEach(([k, v], i) => {
      term.print(6 + i, 5, s.pad(k, 16) + ':', 8);
      term.print(6 + i, 22, String(v).slice(0, term.cols - 24), 15);
    });
    term.write('\r\n');
    term.color(14);
    term.write('  [P]assword  [S]ignature  [E]mail  [N]ame  [A]NSI toggle  [Q]uit\r\n');
    term.reset();
    const k = await term.menu({ prompt: 'Command: ', valid: 'PSENAQ', allowEmpty: true });
    if (k == null || k === 'Q' || k === 'ESC' || k === '') return;
    if (k === 'P') {
      const old = await term.readLine({ prompt: 'Current password: ', max: 32, mask: true });
      if (!auth.checkPassword(u, old)) {
        s.error(term, 'Wrong password.');
        await term.pause();
        continue;
      }
      const pw = await term.readLine({ prompt: 'New password: ', max: 32, mask: true, min: config.get('bbs.minPassword') });
      const pw2 = await term.readLine({ prompt: 'Again: ', max: 32, mask: true });
      if (pw !== pw2) {
        s.error(term, 'Mismatch. Unchanged.');
      } else {
        auth.setPassword(u, pw);
        db.save();
        s.ok(term, 'Password changed.');
      }
      await term.pause();
    } else if (k === 'S') {
      u.sig = await term.readLine({ prompt: 'Signature: ', max: 70, defaultVal: u.sig || '' });
      db.save();
      s.ok(term, 'Signature saved.');
      await term.pause();
    } else if (k === 'E') {
      u.email = await term.readLine({ prompt: 'E-mail: ', max: 48, defaultVal: u.email || '' });
      db.save();
      s.ok(term, 'Saved.');
      await term.pause();
    } else if (k === 'N') {
      u.name = await term.readLine({ prompt: 'Real name: ', max: 40, defaultVal: u.name || '' });
      db.save();
      await term.pause();
    } else if (k === 'A') {
      u.ansi = !u.ansi;
      db.save();
      s.ok(term, `ANSI is now ${u.ansi ? 'ON' : 'OFF'}.`);
      await term.pause();
    }
  }
}

async function pageSysop(term) {
  term.cls();
  s.header(term, 'PAGE THE SYSOP', 11);
  term.write('\r\n');
  s.info(term, 'This rings the sysop console. If the sysop is around, they will answer.', 7);
  const msg = await term.readLine({ prompt: '\r\nReason for page: ', max: 200, allowEmpty: true });
  if (!msg || !msg.trim()) return;
  db.data.pages = db.data.pages || [];
  db.data.pages.push({ id: 'page_' + Date.now(), handle: term.user.handle, node: term.node, msg: msg.trim(), when: Date.now(), handled: false });
  db.save();
  nodes.bus.emit('sysop-page', { handle: term.user.handle, node: term.node, msg: msg.trim() });
  term.write('\r\n');
  s.ok(term, 'The sysop has been paged. Hang tight.');
  await term.pause();
  if ((term.user.level || 0) >= 90) {
    const pages = db.data.pages.filter((p) => !p.handled);
    term.write(`\r\n  ${pages.length} unhandled page(s).\r\n`);
    for (const p of pages.slice(-5)) term.write(`   ${s.fmtDate(p.when)}  ${p.handle} (node ${p.node}): ${p.msg}\r\n`);
    const done = await term.yesno('Mark all pages handled', false);
    if (done) {
      for (const p of pages) p.handled = true;
      db.save();
    }
    await term.pause();
  }
}

async function help(term) {
  term.cls();
  s.header(term, 'HELP', 11);
  term.write('\r\n');
  const lines = [
    'M  Message bases     Read and post on the public boards.',
    'E  Private e-mail    Messages only you and the recipient see.',
    'F  File areas        Download files (web callers get a direct link).',
    'D  Door games        Play games that run on the board.',
    'C  Chat room         Talk to whoever else is online, live.',
    'W  Who is online     See every node and what they are doing.',
    'B  Bulletins         Announcements from the sysop.',
    'V  Voting booth      Have your say. It changes nothing, but still.',
    'T  Time bank         Trade posting credits for extra minutes.',
    'Y  Your settings     Password, signature, ANSI, e-mail.',
    'S  System stats      Calls, users, files, charts.',
    '/  Page the sysop    Ring the console if something is broken.',
    'G  Goodbye           Hang up. Come back soon.',
    '',
    'ESC almost always backs out of a prompt. Ctrl-C aborts an input line.',
  ];
  lines.forEach((l, i) => term.print(5 + i, 5, l, l.startsWith('G ') || l.startsWith('/ ') ? 14 : 7));
  await term.pause();
}

module.exports = { bulletins, voting, timeBank, oneliners, settings, pageSysop, help };
