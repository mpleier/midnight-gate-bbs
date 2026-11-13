'use strict';
// Chat bots: personas that post, chat, idle on nodes and answer mail so the board
// feels populated. Uses a local Ollama model when available, corpus otherwise.
const config = require('../config');
const db = require('../db');
const nodes = require('../nodes');
const auth = require('../auth');
const chat = require('../flow/chat');
const llm = require('./llm');
const corpus = require('./corpus');

const DEFAULT_BOTS = [
  {
    id: 'bot_phiber',
    handle: 'Phiber',
    name: 'Marcus R.',
    persona:
      'a 19-year-old phone phreak from New Jersey, 1994. Cocky, fast typer, lowercase, abbreviations. Obsessed with modems, long distance codes and the scene. Will argue about anything technical. Never mentions the internet as if it matters.',
    style: 'lowercase, terse, occasional typo, street-smart',
    chatter: 70,
    level: 50,
    active: true,
    topics: ['modems', 'phreaking', 'door games', 'ANSI'],
  },
  {
    id: 'bot_nightowl',
    handle: 'NightOwl',
    name: 'Dana K.',
    persona:
      'a 34-year-old night shift nurse who calls the board at 3am with coffee. Warm, dry humour, types in full sentences. Loves door games and keeps spreadsheets about them.',
    style: 'warm, complete sentences, dry jokes, no slang',
    chatter: 55,
    level: 80,
    active: true,
    topics: ['door games', 'night shifts', 'cats'],
  },
  {
    id: 'bot_skull',
    handle: 'TheSkull',
    name: 'unknown',
    persona:
      'a scene kid ANSI artist, 1993. Talks about art packs, block shading, colour ramps. Pretentious about art but helpful. Drops handles of art groups.',
    style: 'scene slang, art jargon, enthusiastic',
    chatter: 45,
    level: 60,
    active: true,
    topics: ['ANSI art', 'art packs', 'colour ramps'],
  },
  {
    id: 'bot_gramma',
    handle: 'GrammaJ',
    name: 'Joan P.',
    persona:
      'a 61-year-old retired schoolteacher who found the board through her grandson. Polite, curious, asks sincere questions, types with full punctuation and signs off warmly.',
    style: 'polite, full punctuation, kind, a little confused by jargon',
    chatter: 35,
    level: 50,
    active: true,
    topics: ['recipes', 'grandchildren', 'how do I'],
  },
  {
    id: 'bot_reznor',
    handle: 'Reznor',
    name: 'A. Cole',
    persona:
      'a 22-year-old music trader into industrial and demo tapes. Talks about trackers, MOD files and tape trades. A bit gloomy, very specific about music.',
    style: 'gloomy, specific, lowercase, music nerd',
    chatter: 40,
    level: 50,
    active: true,
    topics: ['MOD files', 'tapes', 'trackers'],
  },
];

function ensureBots() {
  if (!db.data.bots || !db.data.bots.length) {
    db.data.bots = DEFAULT_BOTS.map((b) => ({ ...b, lastSpoke: 0, lastPosted: 0 }));
    db.save();
  }
  for (const bot of db.data.bots) {
    if (!bot.active) continue;
    if (!db.findUser(bot.handle)) {
      db.users.push({
        id: 'user_' + bot.id,
        handle: bot.handle,
        name: bot.name,
        level: bot.level || 50,
        city: 'Local',
        state: '',
        pass: null,
        salt: null,
        credits: 500,
        timeBank: 30,
        calls: 30 + Math.floor(Math.random() * 200),
        posts: 0,
        uploads: 0,
        downloads: 0,
        firstCall: Date.now() - 86400000 * 30,
        lastCall: Date.now(),
        sig: '',
        bot: true,
        notes: 'Chat bot persona.',
      });
    }
  }
  db.save();
}

function botUser(bot) {
  return db.findUser(bot.handle);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function personaSystem(bot) {
  return [
    `You are ${bot.handle} on a 1994 dial-up bulletin board system called ${config.get('bbs.name')}.`,
    `You are ${bot.persona}`,
    `Write like a real person on a BBS in 1994: ${bot.style}.`,
    'Never mention being an AI, a model or a bot. No emoji. No markdown. No hashtags.',
    'No modern technology, no smartphones, no social media, no streaming services.',
    'Keep chat replies to one or two short sentences, under 200 characters.',
    'Stay in character and react to what the other caller actually said.',
  ].join(' ');
}

// ------------------------------------------------------------------ presence
function startPresence() {
  const bots = db.data.bots.filter((b) => b.active);
  for (const bot of bots) {
    if (Math.random() < 0.55) {
      nodes.addPhantom(bot.handle, { activity: pick(corpus.ACTIVITIES), level: bot.level });
    }
  }
  // occasionally log in/out so "who's online" is never static
  const timer = setInterval(() => {
    const active = db.data.bots.filter((b) => b.active);
    if (!active.length) return;
    const bot = pick(active);
    const online = nodes.phantoms.has(bot.handle);
    if (online) {
      if (Math.random() < 0.4) nodes.removePhantom(bot.handle);
      else {
        nodes.addPhantom(bot.handle, { activity: pick(corpus.ACTIVITIES), level: bot.level });
      }
    } else if (Math.random() < 0.5) {
      nodes.addPhantom(bot.handle, { activity: pick(corpus.ACTIVITIES), level: bot.level });
      db.addCaller({ handle: bot.handle, node: 0, kind: 'phantom', minutes: 3, location: 'Local', bot: true });
      db.save();
    }
  }, 45000);
  timer.unref?.();
  return timer;
}

// -------------------------------------------------------------------- posting
function boardFor(bot) {
  const boards = db.boards.filter((b) => (bot.level || 50) >= (b.level || 0) && b.id !== 'board_sysop');
  return pick(boards);
}

async function generatePost(bot) {
  const board = boardFor(bot);
  if (!board) return null;
  let subject = null;
  let body = null;
  if (await llm.health()) {
    const seed = pick(corpus.POSTS);
    const out = await llm.chat({
      system: personaSystem(bot) + ' You are writing a forum post on this board.',
      messages: [
        {
          role: 'user',
          content: `Write a new message for the "${board.name}" board. Reply with exactly:\nSUBJECT: <subject under 48 chars>\nBODY: <2-4 short lines, under 400 chars, plain text, no signature>\nTopic idea (do not copy literally): ${seed.subject}`,
        },
      ],
      maxTokens: 200,
    });
    if (out) {
      const m = out.match(/SUBJECT:\s*(.+)/i);
      const b = out.match(/BODY:\s*([\s\S]+)/i);
      if (m && b) {
        subject = m[1].trim().slice(0, 48);
        body = b[1].trim();
      }
    }
  }
  if (!subject || !body) {
    const seed = pick(corpus.POSTS);
    subject = seed.subject;
    body = seed.body.replace(/\n/g, '\n');
  }
  return { board, subject, body };
}

async function postAs(bot) {
  const gen = await generatePost(bot);
  if (!gen) return null;
  const msg = db.addMessage({
    boardId: gen.board.id,
    from: bot.handle,
    to: 'ALL',
    subject: gen.subject,
    body: gen.body,
    bot: true,
  });
  bot.lastPosted = Date.now();
  db.save();
  nodes.bus.emit('bot-post', { bot, board: gen.board, msg });
  return msg;
}

// ------------------------------------------------------------------ reactions
async function replyToPost({ board, msg }) {
  if (!msg || msg.bot || !board) return;
  const bots = db.data.bots.filter((b) => b.active && (b.level || 0) >= (board.level || 0));
  if (!bots.length) return;
  const bot = pick(bots);
  if (Math.random() > 0.65) return;
  const delay = 25000 + Math.random() * 90000;
  setTimeout(async () => {
    let body = null;
    if (await llm.health()) {
      body = await llm.chat({
        system: personaSystem(bot) + ' You are replying to another caller on a message board.',
        messages: [
          {
            role: 'user',
            content: `${msg.from} posted on "${board.name}", subject "${msg.subject}":\n${msg.body}\n\nWrite a 2-4 line reply. Plain text, no greeting boilerplate, no signature.`,
          },
        ],
        maxTokens: 160,
      });
    }
    if (!body) body = pick(corpus.REPLIES);
    const reply = db.addMessage({
      boardId: board.id,
      from: bot.handle,
      to: msg.from,
      subject: /^re:/i.test(msg.subject) ? msg.subject : 'Re: ' + msg.subject,
      body,
      replyTo: msg.id,
      bot: true,
    });
    msg.replies = (msg.replies || 0) + 1;
    bot.lastPosted = Date.now();
    db.save();
    nodes.bus.emit('bot-reply', { bot, board, reply });
  }, delay).unref?.();
}

// ----------------------------------------------------------------------- chat
const botTerms = new Map();

function botTerm(bot) {
  if (botTerms.has(bot.handle)) return botTerms.get(bot.handle);
  const t = {
    bot: true,
    handle: bot.handle,
    user: { handle: bot.handle, level: bot.level || 50 },
    alive: true,
    activity: 'In the chat room',
    write() {},
    color() {},
    reset() {},
    chatPrompt: null,
  };
  botTerms.set(bot.handle, t);
  return t;
}

function joinChat(bot) {
  chat.addBot(botTerm(bot));
}

function leaveChat(bot) {
  chat.removeBot(botTerm(bot));
}

async function chatReply(bot, entry) {
  const t = botTerm(bot);
  if (!chat.room.has(t)) return false;
  const handle = entry.from;
  const addressed = new RegExp(bot.handle, 'i').test(entry.text);
  if (!addressed && Math.random() > (bot.chatter || 50) / 220) return false;
  let line = null;
  if (await llm.health()) {
    line = await llm.chat({
      system:
        personaSystem(bot) +
        ` You are in the live chat room with ${handle}. Reply to their last line. One sentence, under 180 chars, no quotes around it.`,
      messages: [
        ...chat.contextFor(8).map((c) => ({ role: 'user', content: `${c.from}: ${c.text}` })),
        { role: 'user', content: `${handle}: ${entry.text}` },
      ],
      maxTokens: 80,
      temperature: 1.0,
    });
  }
  if (!line) line = pick(corpus.CHAT);
  setTimeout(() => {
    if (!chat.room.has(t)) return;
    chat.broadcast(`\x1b[0;36m${bot.handle}\x1b[0m: ${line}`, { from: bot.handle });
    db.data.chat.push({ from: bot.handle, text: line, when: Date.now(), node: 0, bot: true });
    if (db.data.chat.length > 500) db.data.chat.shift();
    db.save();
  }, 1500 + Math.random() * 6000).unref?.();
  return true;
}

function startChatPresence() {
  nodes.bus.on('chat-join', ({ handle }) => {
    const bots = db.data.bots.filter((b) => b.active);
    const joiners = bots.filter(() => Math.random() < 0.5).slice(0, 2);
    for (const bot of joiners) {
      setTimeout(() => {
        joinChat(bot);
        chat.broadcast(`\x1b[0;36m* ${bot.handle} (bot) has joined the chat\x1b[0m`);
      }, 1200 + Math.random() * 4000).unref?.();
    }
  });

  let lastAmbient = 0;
  setInterval(() => {
    if (!chat.members().some((m) => !m.bot)) return; // only chat when a human is present
    const bots = db.data.bots.filter((b) => b.active && chat.room.has(botTerm(b)));
    const t = Date.now();
    if (t - lastAmbient < 25000) return;
    if (Math.random() > 0.45) return;
    lastAmbient = t;
    const bot = pick(bots);
    if (!bot) return;
    const line = pick(corpus.CHAT);
    chat.broadcast(`\x1b[0;36m${bot.handle}\x1b[0m: ${line}`, { from: bot.handle });
    db.data.chat.push({ from: bot.handle, text: line, when: Date.now(), node: 0, bot: true });
    if (db.data.chat.length > 500) db.data.chat.shift();
    db.save();
  }, 15000).unref?.();
}

// --------------------------------------------------------------------- events
function start() {
  ensureBots();
  startPresence();
  startChatPresence();

  nodes.bus.on('chat', (entry) => {
    if (!entry || entry.bot) return;
    for (const bot of db.data.bots.filter((b) => b.active)) {
      chatReply(bot, entry).catch(() => {});
    }
  });

  nodes.bus.on('message-posted', (payload) => {
    replyToPost(payload).catch((e) => console.error('bot reply failed', e.message));
  });

  nodes.bus.on('caller-online', ({ user, term }) => {
    if (!user || user.bot) return;
    if ((user.calls || 1) > 2) return;
    const bot = pick(db.data.bots.filter((b) => b.active));
    if (!bot) return;
    setTimeout(() => {
      db.addMessage({
        boardId: null,
        from: bot.handle,
        to: user.handle,
        subject: 'Welcome to the Gate',
        body: pick(corpus.MAIL_INTROS),
        private: true,
        read: false,
        bot: true,
      });
      db.save();
    }, 20000).unref?.();
  });

  // ambient posting: one bot post every 4-9 minutes
  const schedule = () => {
    const wait = 240000 + Math.random() * 300000;
    setTimeout(async () => {
      const bots = db.data.bots.filter((b) => b.active);
      const bot = pick(bots);
      if (bot) {
        try {
          await postAs(bot);
          nodes.addPhantom(bot.handle, { activity: 'Posting a message', level: bot.level });
        } catch (e) {
          console.error('bot post failed', e.message);
        }
      }
      schedule();
    }, wait).unref?.();
  };
  schedule();

  // occasional one-liner
  setInterval(() => {
    const bots = db.data.bots.filter((b) => b.active);
    const bot = pick(bots);
    if (!bot || Math.random() > 0.3) return;
    db.data.oneliners.push(`${bot.handle}: ${pick(corpus.ONELINERS)}`);
    if (db.data.oneliners.length > 80) db.data.oneliners.shift();
    db.save();
  }, 600000).unref?.();

  console.log(`[bots] ${db.data.bots.filter((b) => b.active).length} personas active`);
}

function list() {
  return db.data.bots || [];
}

function add(bot) {
  const id = 'bot_' + Math.random().toString(36).slice(2, 8);
  const rec = { id, active: true, chatter: 50, level: 50, topics: [], lastSpoke: 0, lastPosted: 0, ...bot };
  db.data.bots.push(rec);
  db.save();
  ensureBots();
  return rec;
}

function update(id, patch) {
  const bot = db.data.bots.find((b) => b.id === id);
  if (!bot) return null;
  Object.assign(bot, patch);
  if (patch.active === false) nodes.removePhantom(bot.handle);
  db.save();
  ensureBots();
  return bot;
}

function remove(id) {
  const i = db.data.bots.findIndex((b) => b.id === id);
  if (i < 0) return false;
  const [bot] = db.data.bots.splice(i, 1);
  nodes.removePhantom(bot.handle);
  db.save();
  return true;
}

module.exports = { start, list, add, update, remove, ensureBots, DEFAULT_BOTS };
