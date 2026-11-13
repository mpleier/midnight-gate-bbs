'use strict';
// Headless smoke test: boots the server, drives a telnet session end to end,
// checks the web terminal websocket, the admin API and the door installer.
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8099;
const TELNET_PORT = 2399;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function connectTelnet() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(TELNET_PORT, '127.0.0.1');
    let out = '';
    sock.on('data', (d) => {
      out += d.toString('utf8');
      resolve(session);
    });
    sock.on('error', reject);
    const session = {
      sock,
      pos: 0,
      get output() {
        return out;
      },
    };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(session, pattern, timeout = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const hay = session.output.slice(session.pos || 0);
    const m = hay.match(pattern);
    if (m) {
      session.pos = (session.pos || 0) + m.index + m[0].length;
      return true;
    }
    await sleep(60);
  }
  return false;
}

async function main() {
  const tmpData = path.join(ROOT, 'test', '.tmp-data');
  fs.rmSync(tmpData, { recursive: true, force: true });
  fs.mkdirSync(tmpData, { recursive: true });
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(HTTP_PORT), TELNET_PORT: String(TELNET_PORT), BBS_DATA_DIR: tmpData },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => (log += d.toString()));
  srv.stderr.on('data', (d) => (log += d.toString()));

  // wait for http
  let up = false;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + '/healthz');
      if (res.ok) {
        up = true;
        break;
      }
    } catch {}
    await sleep(200);
  }
  check('server boots', up);
  if (!up) {
    console.log(log);
    srv.kill();
    return finish();
  }

  const status = await (await fetch(BASE + '/api/status')).json();
  check('status api returns board name', /MIDNIGHT|BBS/i.test(status.name), status.name);
  check('status reports nodes field', typeof status.online === 'number');

  const landing = await (await fetch(BASE + '/')).text();
  check('landing page served', landing.includes('MIDNIGHT') || landing.includes('DIAL IN'));

  const termPage = await (await fetch(BASE + '/terminal')).text();
  check('terminal page served', termPage.includes('xterm.js'));

  const xterm = await fetch(BASE + '/vendor/xterm.js');
  check('xterm.js vendored', xterm.ok && Number(xterm.headers.get('content-length') || 0) > 100000);

  const audio = await fetch(BASE + '/audio/dialup.mp3');
  const audioType = audio.headers.get('content-type') || '';
  check(
    'dial-up recording is served',
    audio.ok && /audio\/mpeg/.test(audioType) && Number(audio.headers.get('content-length') || 0) > 50000,
    `${audio.status} ${audioType} ${audio.headers.get('content-length')} bytes`
  );

  // ---- admin api ----------------------------------------------------------
  const badLogin = await fetch(BASE + '/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user: 'sysop', password: 'wrong' }),
  });
  check('admin rejects bad password', badLogin.status === 401);

  const login = await fetch(BASE + '/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user: 'sysop', password: 'sysop' }),
  });
  const loginJson = await login.json();
  const token = loginJson.token;
  check('admin login works with default password', login.ok && !!token);

  const authed = (p, opts = {}) =>
    fetch(BASE + p, { ...opts, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(opts.headers || {}) } });

  const ov = await (await authed('/api/admin/overview')).json();
  check('admin overview has stats', ov.stats && typeof ov.stats.users === 'number');

  const cfg = await (await authed('/api/admin/config')).json();
  check('config redacts the admin hash', cfg.config && cfg.config.admin.passwordHash === '***');

  const boards = await (await authed('/api/admin/boards')).json();
  check('admin lists message boards', Array.isArray(boards.boards) && boards.boards.length >= 3);

  const doorList = await (await authed('/api/admin/doors')).json();
  check('admin lists built-in doors', Array.isArray(doorList.doors) && doorList.doors.length >= 1, `${doorList.doors?.length} doors`);

  const artPut = await fetch(BASE + '/api/admin/art/upload', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'TEST.ANS', contentBase64: Buffer.from('\x1b[0;32mHELLO FROM A TEST SCREEN\x1b[0m').toString('base64') }),
  });
  check('admin can upload ANSI art', artPut.ok);
  const preview = await (await authed('/api/admin/art/TEST.ANS/preview')).text();
  check('art preview renders', preview.includes('HELLO FROM A TEST SCREEN'));

  // ---- telnet session -----------------------------------------------------
  const sess = await connectTelnet();
  const sawCarrier = await waitFor(sess, /CONNECT \d+/);
  check('telnet dial-in banner', sawCarrier);

  await waitFor(sess, /Handle/, 8000);
  sess.sock.write('SysOp\r\n');
  await waitFor(sess, /Password/, 5000);
  sess.sock.write('sysop\r\n');
  const loggedIn = await waitFor(sess, /Welcome back, SysOp/, 8000);
  check('existing user can log in over telnet', loggedIn, loggedIn ? '' : sess.output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(-400));
  await waitFor(sess, /Press any key/, 4000);
  sess.sock.write(' ');
  const menu = await waitFor(sess, /Command:/, 8000);
  check('main menu appears', menu);
  check('main menu draws menu furniture', /\[M\] Message bases/.test(sess.output));

  // message bases -> choose board 1 -> post
  sess.sock.write('m');
  await waitFor(sess, /Board number/, 6000);
  sess.sock.write('1');
  await waitFor(sess, /Command:/, 6000);
  sess.sock.write('p');
  await waitFor(sess, /To \(blank/, 6000);
  sess.sock.write('\r\n');
  await waitFor(sess, /Subject:/, 6000);
  sess.sock.write('Smoke test message\r\n');
  await waitFor(sess, /Enter your message/, 6000);
  sess.sock.write('automated smoke test\r\n');
  sess.sock.write('\r\n');
  await waitFor(sess, /Save this message/, 6000);
  sess.sock.write('y');
  const posted = await waitFor(sess, /Posted\. Message/, 8000);
  check('caller can post a message', posted, posted ? '' : sess.output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').slice(-500));
  await waitFor(sess, /Press any key/, 5000);
  sess.sock.write(' ');
  await waitFor(sess, /Command:/, 6000);
  sess.sock.write('q');
  await waitFor(sess, /Board number/, 6000);
  sess.sock.write('q');
  const backToMenu = await waitFor(sess, /\[M\] Message bases/, 6000);
  check('returns to the main menu', backToMenu);

  // who's online
  sess.sock.write('w');
  const who = await waitFor(sess, /WHO IS ONLINE/, 6000);
  check('who is online screen', who);
  sess.sock.write(' ');
  await waitFor(sess, /\[M\] Message bases/, 8000);

  // door menu
  sess.sock.write('d');
  const doorScreen = await waitFor(sess, /DOOR GAMES/, 6000);
  check('door menu opens', doorScreen, doorScreen ? '' : sess.output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').slice(-300));
  sess.sock.write('q');
  await waitFor(sess, /\[M\] Message bases/, 8000);

  // good bye
  sess.sock.write('g');
  const bye = await waitFor(sess, /Thanks for calling/, 8000);
  check('logoff screen', bye);
  sess.sock.destroy();

  // ---- new user registration over telnet ---------------------------------
  const s2 = await connectTelnet();
  await waitFor(s2, /Handle/, 8000);
  s2.sock.write('new\r\n');
  const reg = await waitFor(s2, /Choose a handle/, 8000);
  check('new user registration starts', reg);
  s2.sock.write('TestCaller\r\n');
  await waitFor(s2, /Password:/, 5000);
  s2.sock.write('secret123\r\n');
  await waitFor(s2, /Again to verify/, 5000);
  s2.sock.write('secret123\r\n');
  await waitFor(s2, /real name/i);
  s2.sock.write('Test Caller\r\n');
  for (const answer of ['Portland', 'OR', '555-0100', '01/02/80', 'test@example.com', 'M']) {
    await waitFor(s2, /:/, 4000);
    s2.sock.write(answer + '\r\n');
    await sleep(120);
  }
  await waitFor(s2, /ANSI colour/, 4000);
  s2.sock.write('y');
  await waitFor(s2, /agree to the rules/, 4000);
  s2.sock.write('y');
  const created = await waitFor(s2, /Account 'TestCaller' created|Welcome/, 8000);
  check('new user is registered', created);
  s2.sock.destroy();

  const status2 = await (await fetch(BASE + '/api/status')).json();
  check('status reflects new user count', status2.stats.users >= 2, `${status2.stats.users} users`);

  // ---- door install via zip ----------------------------------------------
  // build a tiny zip with a native door using the project's own zip writer? none — use zip CLI if present
  const zipPath = path.join(ROOT, 'doors', 'install', 'smoke-door.zip');
  try {
    const { execSync } = require('node:child_process');
    const tmp = path.join(ROOT, 'doors', 'tmp', 'smoke-door');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'door.js'),
      `module.exports={id:'smoke-door',name:'SMOKE DOOR',author:'test',category:'Arcade',description:'A door installed by the smoke test.',minLevel:10,async run(term){term.cls();term.print(3,3,'SMOKE DOOR RUNNING',15);await term.pause();}};`
    );
    fs.writeFileSync(path.join(tmp, 'FILE_ID.DIZ'), 'SMOKE DOOR\nInstalled by the test suite. Proves zip installs work.');
    execSync(`cd "${tmp}" && powershell -NoProfile -Command "Compress-Archive -Path * -DestinationPath '${zipPath}' -Force"`, { shell: 'cmd.exe' });
  } catch (e) {
    check('zip tool available for install test', false, e.message.split('\n')[0]);
  }
  if (fs.existsSync(zipPath)) {
    const scan = await (await authed('/api/admin/doors/scan', { method: 'POST' })).json();
    const installed = (scan.doors || []).find((d) => /smoke/i.test(d.name) || /smoke/.test(d.id));
    check('door zip installs from doors/install', !!installed, installed ? installed.name : JSON.stringify(scan.installed || []));
  }

  const filesFlow = require('../src/flow/files');
  const filesJson = await (await authed('/api/admin/files')).json();
  const demoFile = (filesJson.files || []).find((f) => f.name === 'MODEMS.TXT') || (filesJson.files || [])[0];
  if (demoFile) {
    const token = filesFlow.issueTicket(demoFile);
    const taken = filesFlow.takeTicket(token);
    check('download tickets issue and redeem once', !!taken && taken.name === demoFile.name, taken ? taken.name : 'none');
    check('download ticket cannot be reused', filesFlow.takeTicket(token) === null);
    const dl = await fetch(`${BASE}/dl/${token}/${encodeURIComponent(demoFile.name)}`);
    check('download route rejects a used ticket', dl.status === 404);
  } else {
    check('a textfile is registered in the file area', false, 'no files in db');
  }

  srv.kill();
  await sleep(300);

  console.log('\n--- server log tail ---');
  console.log(log.split('\n').slice(-12).join('\n'));
  finish();
}

function finish() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${passed}/${results.length} checks passed`);
  if (failed.length) {
    console.log('failed:');
    for (const f of failed) console.log(' - ' + f.name + (f.detail ? ': ' + f.detail : ''));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
