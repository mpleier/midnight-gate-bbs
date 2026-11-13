'use strict';
// Multi-node chat room. Bots join in via the same bus.
const db = require('../db');
const nodes = require('../nodes');
const s = require('./screens');
const config = require('../config');

const room = new Set();
const TOPIC = 'No topic set. Be excellent to each other.';

function members() {
  return [...room].filter((t) => t.alive);
}

function broadcast(text, { exclude = null, from = null } = {}) {
  for (const t of members()) {
    if (t === exclude) continue;
    try {
      deliver(t, text, from);
    } catch {}
  }
}

function deliver(t, text, from) {
  t.write('\r\n');
  t.color(10);
  t.write(text);
  t.reset();
  t.write('\r\n');
  if (t.chatPrompt) t.write(t.chatPrompt);
}

function addBot(botTerm) {
  room.add(botTerm);
}

function removeBot(botTerm) {
  room.delete(botTerm);
}

function systemSay(text) {
  broadcast(`\x1b[0;35m* ${text}\x1b[0m`);
}

function contextFor(n = 8) {
  return (db.data.chat || []).slice(-n).map((c) => ({ from: c.from, text: c.text, when: c.when }));
}

async function enter(term) {
  const user = term.user;
  const handle = user ? user.handle : 'Caller';
  room.add(term);
  term.inChat = true;
  term.activity = 'In the chat room';

  const top = s.frame(term, 'CHAT.ANS', 'CHAT ROOM');
  term.print(top, 3, `Topic: ${TOPIC}`, 7);
  term.print(top + 1, 3, `Command: /q to leave, /w who is here, /me action, /help`, 8);
  term.reset();

  const names = members().map((t) => (t.user ? t.user.handle : t.handle) + (t.bot ? ' [bot]' : ''));
  term.print(top + 3, 3, `Here now: ${names.join(', ')}`, 14);
  term.print(top + 4, 3, '─'.repeat(Math.min(term.cols - 6, 74)), 8);
  term.gotoxy(top + 6, 1);
  term.reset();

  broadcast(`\x1b[0;36m* ${handle} (node ${term.node}) joins the chat\x1b[0m`, { exclude: term });
  nodes.bus.emit('chat-join', { handle, node: term.node, term });

  const onChat = (msg) => {
    if (msg.node === term.node || msg.from === handle) return;
    deliver(term, `${msg.from}: ${msg.text}`);
  };
  nodes.bus.on('chat', onChat);

  term.chatPrompt = '\x1b[0;36m> \x1b[0m';
  try {
    for (;;) {
      const input = await term.readLine({ prompt: '\x1b[0;36m> \x1b[0m', max: 220, allowEmpty: true });
      if (input == null) break;
      const text = input.trim();
      if (!text) continue;
      if (text === '/q' || text === '/quit' || text === '/exit') break;
      if (text === '/w' || text === '/who') {
        const who = members().map((t) => (t.user ? t.user.handle : t.handle) + (t.bot ? ' [bot]' : ''));
        term.write(`\r\n  Here: ${who.join(', ')}\r\n`);
        continue;
      }
      if (text === '/help') {
        term.write('\r\n  /q leave, /w who is here, /me <action>, /msg <handle> <text>\r\n');
        continue;
      }
      if (text.startsWith('/me ')) {
        broadcast(`\x1b[0;35m* ${handle} ${text.slice(4)}\x1b[0m`, { exclude: term });
        term.write(`\x1b[0;35m* ${handle} ${text.slice(4)}\x1b[0m\r\n`);
        continue;
      }
      if (text.startsWith('/msg ')) {
        const [, who, ...rest] = text.split(' ');
        const target = members().find((t) => (t.user ? t.user.handle : t.handle).toLowerCase() === String(who).toLowerCase());
        if (!target) {
          term.write(`  No '${who}' in the room.\r\n`);
          continue;
        }
        target.write(`\r\n\x1b[0;33m[private] ${handle}: ${rest.join(' ')}\x1b[0m\r\n> `);
        term.write(`\x1b[0;33m[private to ${who}] ${rest.join(' ')}\x1b[0m\r\n`);
        continue;
      }
      broadcast(`${handle}: ${text}`, { exclude: term });
      term.write(`\x1b[0;37m${handle}\x1b[0m: ${text}\r\n`);
      db.data.chat.push({ from: handle, text, when: Date.now(), node: term.node });
      if (db.data.chat.length > 500) db.data.chat.shift();
      nodes.bus.emit('chat', { from: handle, text, node: term.node, user, when: Date.now() });
    }
  } finally {
    nodes.bus.off('chat', onChat);
    room.delete(term);
    term.inChat = false;
    term.chatPrompt = null;
    term.activity = 'Main menu';
    broadcast(`\x1b[0;36m* ${handle} has left the chat\x1b[0m`);
    nodes.bus.emit('chat-leave', { handle, node: term.node, term });
  }
}

module.exports = { enter, broadcast, members, addBot, removeBot, systemSay, room, TOPIC, config, contextFor };
