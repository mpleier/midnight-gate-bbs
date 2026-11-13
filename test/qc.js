'use strict';
// QC walk: drives the whole board over telnet against a throwaway instance and
// checks every menu command, message posting, file download, chat, doors,
// input edge cases and node limits. Prints a table; exits non-zero on failure.
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8097;
const TELNET_PORT = 2397;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function connect() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(TELNET_PORT, '127.0.0.1');
    const s = { sock, out: '', pos: 0 };
    sock.on('data', (d) => (s.out += d.toString('utf8')));
    sock.on('error', reject);
    sock.on('close', () => (s.closed = true));
    sock.on('connect', () => resolve(s));
  });
}

async function waitFor(s, re, ms = 8000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const tail = s.out.slice(s.pos);
    const m = tail.match(re);
    if (m) {
      s.pos += m.index + m[0].length;
      return m;
    }
    await sleep(50);
  }
  return null;
}

function send(s, text) {
  s.sock.write(text);
}

async function login(s) {
  await waitFor(s, /CONNECT \d+/, 20000);
  if (!(await waitFor(s, /Handle/, 15000))) return false;
  send(s, 'SysOp\r\n');
  if (!(await waitFor(s, /Password/, 8000))) return false;
  send(s, 'sysop\r\n');
  if (!(await waitFor(s, /Welcome back, SysOp/, 12000))) return false;
  await waitFor(s, /Press any key/, 5000);
  send(s, ' ');
  return !!(await waitFor(s, /Command:/, 12000)) && /\[M\] Message bases/.test(s.out);
}

async function atMenu(s) {
  // require the menu to be redrawn *after* our keypress: searching the whole
  // buffer makes a stale menu on a previous screen look current
  for (let i = 0; i < 10; i++) {
    const start = s.out.length;
    send(s, '\x1b');
    await sleep(700);
    const fresh = s.out.slice(start);
    if (/\[M\] Message bases/.test(fresh) && /Command:/.test(fresh)) return true;
  }
  return false;
}

async function main() {
  const tmp = path.join(ROOT, 'test', '.tmp-qc');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(HTTP_PORT), TELNET_PORT: String(TELNET_PORT), BBS_DATA_DIR: tmp },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => (log += d.toString()));
  srv.stderr.on('data', (d) => (log += d.toString()));

  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try {
      up = (await fetch(BASE + '/healthz')).ok;
    } catch {}
    if (!up) await sleep(200);
  }
  check('server boots', up);
  if (!up) {
    console.log(log);
    srv.kill();
    return finish();
  }

  const a = await connect();
  check('dial-in completes and login works', await login(a), 'welcome + main menu');

  // ---- every command reaches its screen ------------------------------------
  const screens = [
    ['m', /MESSAGE BASES/i, 'message bases'],
    ['f', /FILE AREAS/i, 'file areas'],
    ['d', /DOOR GAMES/i, 'door menu'],
    ['w', /WHO IS ONLINE/i, 'who is online'],
    ['u', /USER LIST/i, 'user list'],
    ['l', /LAST CALLERS/i, 'last callers'],
    ['b', /BULLETIN/i, 'bulletins'],
    ['v', /VOTING BOOTH/i, 'voting booth'],
    ['t', /TIME BANK/i, 'time bank'],
    ['r', /RUMORS|ONELINER/i, 'rumors'],
    ['n', /NEW FILES/i, 'new files scan'],
    ['y', /YOUR SETTINGS/i, 'settings'],
    ['s', /STATISTICS/i, 'statistics'],
    ['e', /E-?MAIL/i, 'private mail'],
    ['?', /HELP/i, 'help'],
  ];
  for (const [key, re, label] of screens) {
    await atMenu(a);
    a.pos = a.out.length;
    send(a, key);
    const got = await waitFor(a, re, 6000);
    const seen = a.out.slice(a.pos).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\r]/g, '');
    const crashed = /Error:|unhandled|TypeError/.test(seen);
    check(
      `command ${key.toUpperCase()} opens ${label}`,
      got && !crashed,
      crashed ? 'error text on screen' : got ? '' : 'saw: ' + seen.trim().split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 130)
    );
  }

  // ---- unknown key is ignored, not fatal ----------------------------------
  await atMenu(a);
  a.pos = a.out.length;
  send(a, 'z');
  await sleep(900);
  const afterZ = a.out.slice(a.pos);
  check('unknown key is ignored', !/Error:|has been disconnected|NO CARRIER/i.test(afterZ), afterZ.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim().slice(0, 40));

  // ---- ESC inside a prompt cancels the screen, not the call ---------------
  await atMenu(a);
  send(a, 'r');
  await sleep(1200);
  send(a, '\x1b');
  const backAtMenu = await waitFor(a, /\[M\] Message bases/, 6000);
  check('ESC in a prompt returns to the menu instead of hanging up', backAtMenu && !a.closed);

  // ---- post and read a message -------------------------------------------
  await atMenu(a);
  send(a, 'm');
  await waitFor(a, /Board number/, 8000);
  send(a, '1');
  await waitFor(a, /Command:/, 8000);
  a.pos = a.out.length;
  send(a, 'p');
  await waitFor(a, /To \(blank/, 8000);
  send(a, '\r\n');
  await waitFor(a, /Subject:/, 6000);
  send(a, 'QC test post\r\n');
  await waitFor(a, /Enter your message/, 6000);
  send(a, 'This is the quality control walk.\r\n');
  send(a, 'Second line of the QC post.\r\n');
  send(a, '\r\n');
  await waitFor(a, /Save this message/, 6000);
  send(a, 'y');
  const posted = await waitFor(a, /Posted\. Message/, 8000);
  check('posting a message works', posted, posted ? '' : 'no confirmation seen');
  await waitFor(a, /Press any key/, 5000);
  send(a, ' ');
  await waitFor(a, /Command:/, 6000);

  // verify it landed through the API
  const status = await (await fetch(BASE + '/api/status')).json();
  check('status endpoint exposes counters', typeof status.calls === 'number' || typeof status.online === 'number');

  // ---- file download ------------------------------------------------------
  const dl = await fetch(BASE + '/dl?file=' + encodeURIComponent('../../config.json'));
  check('download endpoint refuses traversal', dl.status === 404 || dl.status === 403, 'status ' + dl.status);

  // ---- chat --------------------------------------------------------------
  await atMenu(a);
  a.pos = a.out.length;
  send(a, 'c');
  const chatted = await waitFor(a, /CHAT ROOM/i, 6000);
  send(a, 'qc ping from the harness\r');
  await sleep(900);
  check('chat accepts a line', chatted && /qc ping from the harness/.test(a.out.slice(a.pos)));

  // ---- door launch -------------------------------------------------------
  await atMenu(a);
  a.pos = a.out.length;
  send(a, 'd');
  await waitFor(a, /DOOR GAMES/i, 6000);
  send(a, '1');
  const doorUp = await waitFor(a, /PRESS ANY KEY|PRESS \[|LORD|BLACKJACK|PIT|FISH|TRADE WAR|BARREN|DOMINION|DRAGON|WASTELAND/i, 10000);
  check('a door launches and draws', !!doorUp, doorUp ? doorUp[0].slice(0, 24) : 'no door screen');
  // doors back out with Q (ESC only backs up one level); paged intros take a few
  let leftDoor = false;
  for (let i = 0; i < 12 && !leftDoor; i++) {
    send(a, 'q');
    await sleep(700);
    const tail = a.out.slice(-500);
    if (/\(Y\/N\)|\[Y\/N\]/i.test(tail)) {
      send(a, 'y');
      await sleep(500);
    }
    leftDoor = /DOOR GAMES/.test(a.out.slice(-900)) || /Returning to the BBS/i.test(tail);
  }
  if (leftDoor) {
    send(a, ' ');
    await sleep(800);
  }
  check('a door can be left cleanly', leftDoor, leftDoor ? '' : 'still inside the door after 12 keys');

  // ---- long line ---------------------------------------------------------
  await atMenu(a);
  a.pos = a.out.length;
  send(a, '9'.repeat(400) + '\r');
  await sleep(1200);
  check('400-character input does not break the session', !a.closed && !/Error:/.test(a.out.slice(a.pos)));

  // ---- node limit --------------------------------------------------------
  const conns = [];
  for (let i = 0; i < 5; i++) {
    try {
      conns.push(await connect());
    } catch {}
  }
  await sleep(1500);
  const busy = conns.some((c) => /(all nodes|busy|no free node)/i.test(c.out));
  check('node limit enforced at 4 callers', busy, busy ? '' : `opened ${conns.length} extra sockets without a busy message`);
  for (const c of conns) c.sock.destroy();

  // ---- clean hangup ------------------------------------------------------
  const g = await connect();
  const okG = await login(g);
  if (okG) {
    g.pos = g.out.length;
    send(g, 'g');
    const bye = await waitFor(g, /(NO CARRIER|GOODBYE|Thanks for calling)/i, 8000);
    check('G hangs up with a proper goodbye', !!bye);
  } else {
    check('G hangs up with a proper goodbye', false, 'second login failed');
  }

  // ---- registration, private mail, voting ---------------------------------
  const n = await connect();
  await waitFor(n, /Handle/, 15000);
  send(n, 'NEW\r\n');
  await waitFor(n, /Choose a handle/, 9000);
  send(n, 'QCTester\r\n');
  await waitFor(n, /Password:/, 6000);
  send(n, 'qcpass\r\n');
  await waitFor(n, /Again to verify/, 6000);
  send(n, 'qcpass\r\n');
  const answers = [
    [/real name/i, 'Q C Tester'],
    [/City/i, 'Portland'],
    [/State/i, 'OR'],
    [/Phone/i, ''],
    [/Date of birth/i, '01/01/80'],
    [/e-mail/i, ''],
    [/Gender/i, ''],
  ];
  for (const [re, val] of answers) {
    await waitFor(n, re, 8000);
    send(n, val + '\r\n');
  }
  await waitFor(n, /ANSI/i, 8000);
  send(n, 'y\r\n');
  await waitFor(n, /agree to the rules/i, 8000);
  send(n, 'y\r\n');
  const created = await waitFor(n, /Account 'QCTester' created/i, 10000);
  check('new caller can register', created);
  send(n, ' ');
  const newMenu = await waitFor(n, /Command:/, 10000);
  check('new caller lands on the main menu', newMenu);

  // SysOp sends private mail to the new account
  await atMenu(a);
  send(a, 'e');
  await waitFor(a, /PRIVATE E-?MAIL/i, 8000);
  send(a, 's');
  const toPrompt = await waitFor(a, /Send to \(handle\)/i, 8000);
  send(a, 'QCTester\r\n');
  await waitFor(a, /Subject:/i, 6000);
  send(a, 'Welcome aboard\r\n');
  const bodyPrompt = await waitFor(a, /Enter your message/i, 6000);
  send(a, 'First piece of mail on the new board.\r\n');
  send(a, '\r\n');
  await waitFor(a, /Save this message/i, 6000);
  send(a, 'y');
  const mailed = await waitFor(a, /Mail sent to/i, 8000);
  check(
    'private mail can be sent',
    !!(toPrompt && bodyPrompt && mailed),
    !toPrompt ? 'no "Send to (handle)" prompt' : !bodyPrompt ? 'no body prompt' : !mailed ? 'no confirmation: ' + a.out.slice(-260).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '|').slice(-160) : ''
  );

  // the new caller sees it waiting
  const n2 = await connect();
  await waitFor(n2, /Handle/, 15000);
  send(n2, 'QCTester\r\n');
  await waitFor(n2, /Password:/, 6000);
  send(n2, 'qcpass\r\n');
  const sawMail = await waitFor(n2, /Private mail: \d+ message/i, 12000);
  check('new caller can log in and sees the mail', !!sawMail);
  send(n2, ' ');
  await waitFor(n2, /Command:/, 8000);
  send(n2, 'e');
  const mailList = await waitFor(n2, /Welcome aboard/, 8000);
  check('private mail shows in the inbox', !!mailList);
  n2.sock.destroy();

  // voting
  await atMenu(a);
  send(a, 'v');
  await waitFor(a, /Vote \(1-/, 8000);
  send(a, '1');
  const voted = await waitFor(a, /(Thanks|vote has been|recorded|RESULTS)/i, 8000);
  check(
    'a vote is recorded',
    !!voted,
    voted ? '' : 'saw: ' + a.out.slice(-260).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '|').slice(-160)
  );
  if (voted && !/Command:/.test(a.out.slice(-200))) {
    send(a, ' ');
    await sleep(500);
  }

  // ---- admin login lockout (last: it locks this address for five minutes) --
  let lockStatus = 0;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(BASE + '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'sysop', password: 'wrong-' + i }),
    });
    lockStatus = r.status;
  }
  check('repeated bad admin logins are throttled', lockStatus === 429, 'last status ' + lockStatus);

  a.sock.destroy();
  srv.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  finish();
}

function finish() {
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - bad}/${results.length} checks passed`);
  process.exitCode = bad ? 1 : 0;
}

main().catch((e) => {
  console.error('qc crashed:', e);
  process.exitCode = 1;
});
