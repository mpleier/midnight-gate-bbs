'use strict';
// Message bases + private e-mail. Written to feel like Telegard/Renegade.
const config = require('../config');
const db = require('../db');
const auth = require('../auth');
const s = require('./screens');
const nodes = require('../nodes');

function visibleBoards(user) {
  return db.boards.filter((b) => (user.level || 0) >= (b.level || 0)).sort((a, b) => (a.order || 0) - (b.order || 0));
}

function unreadCount(user) {
  if (!user) return 0;
  return db.messages.filter((m) => m.to && m.to.toLowerCase() === user.handle.toLowerCase() && !m.read).length;
}

async function bases(term) {
  for (;;) {
    const top = s.frame(term, 'MSG.ANS', 'MESSAGE BASES');
    const boards = visibleBoards(term.user);
    term.print(top, 3, '  #   Board                          Msgs  New  Description', 8);
    term.print(top + 1, 3, '─'.repeat(Math.min(term.cols - 6, 74)), 8);
    boards.forEach((b, i) => {
      const row = top + 2 + i;
      const msgs = db.boardMessages(b.id);
      const lastRead = term.user.lastRead ? term.user.lastRead[b.id] || 0 : 0;
      const fresh = msgs.filter((m) => m.date > lastRead && m.from !== term.user.handle).length;
      term.print(row, 3, String(i + 1).padStart(2), 10);
      term.print(row, 7, s.pad(b.name, 29), 15);
      term.print(row, 37, s.pad(msgs.length, 5, true), 7);
      term.print(row, 43, s.pad(fresh || '', 4, true), fresh ? 14 : 8);
      term.print(row, 49, s.pad(b.desc, Math.max(8, term.cols - 52)), 8);
    });
    term.print(term.rows - 3, 3, '[Q]uit back to main menu', 14);
    term.gotoxy(term.rows - 2, 1);
    term.reset();
    const k = await term.menu({ prompt: '\x1b[0;36mBoard number: \x1b[0m', valid: '123456789Q', allowEmpty: true });
    if (k == null || k === 'Q' || k === 'ESC' || k === '') return;
    const board = boards[Number(k) - 1];
    if (!board) {
      s.error(term, 'No such board.');
      continue;
    }
    await boardMenu(term, board);
  }
}

async function boardMenu(term, board) {
  for (;;) {
    const all = db.boardMessages(board.id);
    const top = s.frame(term, 'MSG.ANS', board.name.toUpperCase());
    const lastRead = term.user.lastRead ? term.user.lastRead[board.id] || 0 : 0;
    term.print(top, 3, board.desc, 8);
    term.print(top + 1, 3, '  #    From                 Subject                          Date', 8);
    term.print(top + 2, 3, '─'.repeat(Math.min(term.cols - 6, 74)), 8);
    const pageSize = Math.max(3, term.rows - (top + 7));
    const list = all.slice(-pageSize).reverse();
    if (!list.length) {
      term.print(top + 3, 3, 'No messages on this board yet. Be the first.', 8);
    }
    list.forEach((m, i) => {
      const row = top + 3 + i;
      if (row >= term.rows - 3) return;
      const fresh = m.date > lastRead && m.from.toLowerCase() !== term.user.handle.toLowerCase();
      term.print(row, 3, String(all.length - i).padStart(3), fresh ? 15 : 8);
      term.print(row, 8, s.pad(m.from, 20), fresh ? 14 : 7);
      term.print(row, 29, s.pad((m.to && m.to !== 'ALL' ? '>' + m.to + ' ' : '') + m.subject, 33), 11);
      term.print(row, 63, s.fmtDate(m.date), 8);
    });
    term.print(term.rows - 3, 3, `[R]ead  [P]ost  [Q]uit    ${all.length} message(s)`, 14);
    term.gotoxy(term.rows - 2, 1);
    term.reset();
    const k = await term.menu({ prompt: '\x1b[0;36mCommand: \x1b[0m', valid: 'RPQ', allowEmpty: true });
    if (k == null || k === 'Q' || k === 'ESC' || k === '') return;
    if (k === 'P') {
      await post(term, board);
      continue;
    }
    if (k === 'R') {
      const n = await term.readLine({ prompt: 'Read message number (blank = latest): ', max: 5 });
      if (n === null) continue;
      const which = n.trim() ? all[Math.max(0, Math.min(all.length - 1, Number(n) - 1))] : all[all.length - 1];
      if (!which) {
        s.error(term, 'No such message.');
        continue;
      }
      await read(term, which, board);
    }
  }
}

async function read(term, msg, board) {
  for (;;) {
    term.cls();
    s.header(term, 'MESSAGE', 11);
    term.write('\r\n');
    term.print(5, 3, 'From    : ', 8);
    term.print(5, 13, msg.from, 14);
    term.print(6, 3, 'To      : ', 8);
    term.print(6, 13, msg.to || 'ALL', 14);
    term.print(7, 3, 'Subject : ', 8);
    term.print(7, 13, msg.subject, 15);
    term.print(8, 3, 'Date    : ', 8);
    term.print(8, 13, s.fmtDate(msg.date), 7);
    term.print(9, 3, 'Board   : ', 8);
    term.print(9, 13, board.name, 7);
    s.rule(term, '─', 8);
    term.write('\r\n');
    const lines = term.wrap(msg.body || '', term.cols - 8);
    for (const l of lines) {
      term.color(7);
      term.write('    ' + l + '\r\n');
    }
    term.write('\r\n');
    term.color(8);
    term.write('  ' + `Message #${db.messages.indexOf(msg) + 1} of ${db.messages.length}` + '\r\n');
    term.reset();
    term.color(14);
    term.write('  [R]eply  [Q]uit\r\n');
    term.reset();
    const k = await term.menu({ prompt: 'Command: ', valid: 'RQ', allowEmpty: true });
    if (k == null || k === 'Q' || k === 'ESC' || k === '') return;
    if (k === 'R') {
      if ((term.user.level || 0) < (board.level || 0)) {
        s.error(term, 'You do not have access to post here.');
        continue;
      }
      await post(term, board, msg);
    }
  }
}

async function post(term, board, replyTo = null) {
  term.cls();
  s.header(term, `POST IN ${board.name.toUpperCase()}`, 11);
  term.write('\r\n');
  const to = replyTo
    ? replyTo.from
    : (await term.readLine({ prompt: 'To (blank = ALL): ', max: 24, defaultVal: 'ALL' })).trim() || 'ALL';
  let subject = await term.readLine({
    prompt: 'Subject: ',
    max: 48,
    defaultVal: replyTo ? (/^re:/i.test(replyTo.subject) ? replyTo.subject : 'Re: ' + replyTo.subject) : undefined,
    min: 1,
  });
  term.write('\r\n');
  s.info(term, 'Enter your message. Blank line ends it. /A aborts, /Q quotes the original.', 8);
  term.write('\r\n');
  if (replyTo) {
    for (const l of term.wrap(replyTo.body, term.cols - 8).slice(0, 8)) {
      term.color(8);
      term.write('  > ' + l + '\r\n');
    }
    term.reset();
  }
  term.color(7);
  const bodyLines = [];
  for (;;) {
    const l = await term.readLine({ prompt: '> ', max: 76, allowEmpty: true });
    if (l === null) return;
    if (l === '/A') {
      s.error(term, 'Post aborted.');
      await term.pause();
      return;
    }
    if (l === '/Q' && replyTo) {
      for (const q of term.wrap(replyTo.body, 72)) bodyLines.push('> ' + q);
      term.write('\r\n');
      continue;
    }
    if (!l.length) break;
    bodyLines.push(l);
    if (bodyLines.length > 60) break;
  }
  if (!bodyLines.length) {
    s.error(term, 'Empty message. Nothing posted.');
    await term.pause();
    return;
  }
  term.reset();
  if (term.user.sig) {
    term.color(8);
    term.write(`\r\n  ${term.user.sig}\r\n`);
    term.reset();
  }
  const ok = await term.yesno('Save this message', true);
  if (!ok) {
    term.write('  Discarded.\r\n');
    await term.pause();
    return;
  }
  const msg = db.addMessage({
    boardId: board.id,
    from: term.user.handle,
    to,
    subject,
    body: bodyLines.join('\n'),
    replyTo: replyTo ? replyTo.id : null,
  });
  db.save();
  if (replyTo) replyTo.replies = (replyTo.replies || 0) + 1;
  s.ok(term, `Posted. Message #${db.messages.indexOf(msg) + 1} on ${board.name}.`);
  nodes.bus.emit('message-posted', { board, msg });
  await term.pause();
}

// ---------------------------------------------------------------- private mail
async function mail(term) {
  for (;;) {
    const handle = term.user.handle.toLowerCase();
    const inbox = db.messages.filter((m) => m.to && m.to.toLowerCase() === handle);
    term.cls();
    s.showArt(term, 'MAIL.ANS', { fallback: false });
    s.header(term, 'PRIVATE E-MAIL', 11);
    term.write('\r\n');
    if (!inbox.length) {
      term.color(8);
      term.write('  Your mailbox is empty.\r\n');
      term.reset();
    } else {
      term.color(8);
      term.write('  #   From                 Subject                          Date\r\n');
      term.write('  ' + '─'.repeat(Math.min(term.cols - 4, 74)) + '\r\n');
      term.reset();
      inbox.slice(-12).forEach((m, i) => {
        const row = 7 + i;
        term.print(row, 3, String(i + 1).padStart(2), m.read ? 8 : 15);
        term.print(row, 7, s.pad(m.from, 20), m.read ? 7 : 14);
        term.print(row, 28, s.pad(m.subject, 33), 11);
        term.print(row, 62, s.fmtDate(m.date), 8);
      });
    }
    term.write('\r\n');
    term.color(14);
    term.write('  [R]ead  [S]end  [Q]uit\r\n');
    term.reset();
    const k = await term.menu({ prompt: 'Command: ', valid: 'RSQ', allowEmpty: true });
    if (k == null || k === 'Q' || k === 'ESC' || k === '') return;
    if (k === 'S') {
      await sendMail(term);
      continue;
    }
    if (k === 'R') {
      if (!inbox.length) continue;
      const n = await term.readLine({ prompt: 'Message number (blank = latest): ', max: 3 });
      const msg = inbox[Math.min(inbox.length, Math.max(1, Number(n) || inbox.length)) - 1];
      if (!msg) continue;
      msg.read = true;
      db.save();
      await readMail(term, msg);
    }
  }
}

async function readMail(term, msg) {
  term.cls();
  s.header(term, 'PRIVATE MESSAGE', 11);
  term.write('\r\n');
  term.print(5, 3, 'From    : ', 8);
  term.print(5, 13, msg.from, 14);
  term.print(6, 3, 'Subject : ', 8);
  term.print(6, 13, msg.subject, 15);
  term.print(7, 3, 'Date    : ', 8);
  term.print(7, 13, s.fmtDate(msg.date), 7);
  s.rule(term, '─', 8);
  term.write('\r\n');
  for (const l of term.wrap(msg.body, term.cols - 8)) {
    term.color(7);
    term.write('    ' + l + '\r\n');
  }
  term.write('\r\n');
  term.color(14);
  term.write('  [R]eply  [D]elete  [Q]uit\r\n');
  term.reset();
  const k = await term.menu({ prompt: 'Command: ', valid: 'RDQ', allowEmpty: true });
  if (k === 'R') {
    const to = await term.readLine({ prompt: `To: `, max: 20, defaultVal: msg.from });
    const subject = await term.readLine({ prompt: 'Subject: ', max: 48, defaultVal: 'Re: ' + msg.subject });
    const body = await readBody(term);
    if (body) {
      db.addMessage({ boardId: null, from: term.user.handle, to: to || msg.from, subject, body, private: true });
      db.save();
      s.ok(term, 'Sent.');
      await term.pause();
    }
  } else if (k === 'D') {
    const i = db.messages.indexOf(msg);
    if (i >= 0) db.messages.splice(i, 1);
    db.save();
    term.write('  Deleted.\r\n');
    await term.pause();
  }
}

async function readBody(term) {
  s.info(term, 'Enter your message. Blank line ends it.', 8);
  const lines = [];
  for (;;) {
    const l = await term.readLine({ prompt: '> ', max: 76, allowEmpty: true });
    if (l === null) return null;
    if (!l.length) break;
    lines.push(l);
  }
  return lines.join('\n');
}

async function sendMail(term) {
  const to = await term.readLine({ prompt: 'Send to (handle): ', max: 20, min: 1 });
  const target = db.findUser(to);
  if (!target) {
    s.error(term, `No user '${to.trim()}'.`);
    await term.pause();
    return;
  }
  const subject = await term.readLine({ prompt: 'Subject: ', max: 48, min: 1 });
  const body = await readBody(term);
  if (!body.trim()) {
    s.error(term, 'Empty message.');
    await term.pause();
    return;
  }
  db.addMessage({ boardId: null, from: term.user.handle, to: target.handle, subject, body, private: true, read: false });
  db.save();
  s.ok(term, `Mail sent to ${target.handle}.`);
  await term.pause();
}

// Auto-reply so a lone caller still finds a living board: bots handle the rest.
function unreadFor(user) {
  return db.messages.filter((m) => m.to && m.to.toLowerCase() === user.handle.toLowerCase() && !m.read);
}

module.exports = {
  bases,
  mail,
  unreadCount,
  unreadFor,
  visibleBoards,
  boardMenu,
  post,
  read,
  config,
  auth,
};
