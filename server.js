'use strict';
// Entry point: starts HTTP (web terminal + admin) and the telnet door.
const config = require('./src/config');
const db = require('./src/db');
const nodes = require('./src/nodes');
const { createServer } = require('./src/http');
const { attachTelnet } = require('./src/telnet');
const doors = require('./src/doors/manager');
const bots = require('./src/bots/bots');
const { runSession } = require('./src/flow/bbs');

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

function banner() {
  const c = config.data.bbs;
  const httpPort = config.get('network.httpPort');
  const telnetPort = config.get('network.telnetPort');
  const line = '─'.repeat(66);
  console.log(`\n┌${line}┐`);
  console.log(`│ ${c.name.padEnd(64)} │`);
  console.log(`│ ${c.tagline.padEnd(64)} │`);
  console.log(`├${line}┤`);
  console.log(`│ ${('Web  : http://localhost:' + httpPort).padEnd(64)} │`);
  console.log(`│ ${('Telnet: telnet localhost ' + telnetPort).padEnd(64)} │`);
  console.log(`│ ${('Admin : http://localhost:' + httpPort + '/admin/').padEnd(64)} │`);
  console.log(`│ ${('Doors : ' + doors.doors.length + ' installed (drop zips in doors/install)').padEnd(64)} │`);
  console.log(`└${line}┘\n`);
}

async function main() {
  // make sure the sysop account actually has a usable password
  const auth = require('./src/auth');
  const sysop = db.findUser(config.get('bbs.sysop')) || db.users.find((u) => u.level >= 100);
  if (sysop && !sysop.pass) {
    auth.setPassword(sysop, config.get('bbs.sysopPassword') || 'sysop');
    db.save();
    console.log(`[boot] sysop account '${sysop.handle}' initialised (password from config bbs.sysopPassword)`);
  }

  // keep the textfile area in sync with files/util on every boot
  try {
    require('./tools/seed-files').main();
  } catch (e) {
    log(`textfile seed skipped: ${e.message}`);
  }

  const server = createServer(log);
  const httpPort = Number(process.env.PORT || config.get('network.httpPort'));
  const host = config.get('network.host');

  server.listen(httpPort, host, () => log(`http listening on ${host}:${httpPort}`));
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${httpPort} is busy. Set network.httpPort in config.json or PORT=xxxx.`);
      process.exit(1);
    }
    console.error('http error:', e);
  });

  if (config.get('network.telnetEnabled')) {
    const telnetPort = Number(process.env.TELNET_PORT || config.get('network.telnetPort'));
    attachTelnet({ host, port: telnetPort }, { onConnection: (term) => runSession(term), log });
  }

  bots.start();
  const installed = doors.scanInstallFolder();
  if (installed.length) log(`installed ${installed.length} door(s) from the install folder`);

  banner();

  const shutdown = (sig) => {
    log(`${sig} — flushing database`);
    db.flush();
    server.close();
    setTimeout(() => process.exit(0), 200);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  setInterval(() => db.flush(), 15000).unref?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
