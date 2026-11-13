#!/usr/bin/env node
'use strict';
// Waits for the board's HTTP port to answer, then opens it in the default
// browser. Started in the background by START.bat / start.sh so the server can
// own the console it was launched from.
const net = require('node:net');
const { exec } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const config = require(path.join(ROOT, 'src', 'config'));
const port = Number(process.env.PORT || config.get('network.httpPort') || 8080);
const url = `http://localhost:${port}/`;
const DEADLINE = Date.now() + 20000;
if (process.env.BBS_NO_BROWSER) process.exit(0); // used by the test suite

function openBrowser(target) {
  // BBS_BROWSER_CMD lets a sysop force a particular browser (or a test harness
  // substitute) instead of the system default
  const custom = process.env.BBS_BROWSER_CMD;
  const cmd = custom
    ? `${custom} "${target}"`
    :
    process.platform === 'win32'
      ? `start "" "${target}"`
      : process.platform === 'darwin'
        ? `open "${target}"`
        : `xdg-open "${target}"`;
  exec(cmd, () => process.exit(0));
}

function probe() {
  const sock = net.connect(port, '127.0.0.1');
  sock.setTimeout(800);
  sock.on('connect', () => {
    sock.destroy();
    setTimeout(() => openBrowser(url), 300); // let the first screen render
  });
  sock.on('error', retry);
  sock.on('timeout', () => {
    sock.destroy();
    retry();
  });
}

function retry() {
  if (Date.now() > DEADLINE) {
    // the server prints its own error; stay quiet rather than stealing focus
    process.exit(0);
  }
  setTimeout(probe, 400);
}

probe();
