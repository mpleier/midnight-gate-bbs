'use strict';
// Runs an installed DOS door under DOSBox, with COM1 bridged to the caller.
//
// DOSBox draws its own screen that nobody is watching: the only thing the
// caller sees is what the game writes to the serial port. So each call gets
//   * a scratch copy of the door's directory (LORD.DAT and friends are written
//     per node, so two callers cannot stomp on each other),
//   * a drop file in the directory the game runs from,
//   * a generated dosbox.conf whose serial1 is a nullmodem waiting on a port,
//   * and, once DOSBox starts listening, the socket spliced onto the terminal.
const fs = require('node:fs');
const path = require('node:path');
const { writeDrop } = require('./dropfiles');

function shellSafe(p) {
  return String(p).replace(/"/g, '');
}

function dosPath(dir) {
  return String(dir).split('/').join('\\');
}

async function runDos(manager, term, door, installDir, dosboxExe) {
  const tmpRoot = path.join(path.dirname(installDir), 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const work = path.join(tmpRoot, 'node' + (term.node || 1) + '-' + door.id + '-' + Date.now().toString(36));
  fs.cpSync(installDir, work, { recursive: true });

  const rel = String(door.exec || door.bat || '').split('\\').join('/');
  const relDir = path.dirname(rel) === '.' ? '' : path.dirname(rel);
  const runName = path.basename(rel);
  if (!runName) {
    term.write('\r\n  This DOS door has no executable in its manifest.\r\n');
    await term.pause();
    fs.rmSync(work, { recursive: true, force: true });
    return;
  }

  const runDir = relDir ? path.join(work, relDir) : work;
  const dropName = String(door.dropType || 'DOOR.SYS').toUpperCase();
  // LORD keeps its node configuration (NODE1.DAT, written by LORDCFG) pointing at
  // C:\BBS for the drop file, so it goes there as well as next to the executable
  const dropDirs = [runDir, work, path.join(work, 'BBS')];
  for (const d of dropDirs) {
    try {
      fs.mkdirSync(d, { recursive: true });
      writeDrop(term, dropName, d);
    } catch (e) {
      manager.pushLog('drop file failed: ' + e.message);
    }
  }

  const port = 2500 + (Number(term.node) || 1) * 10 + Math.floor(Math.random() * 8);
  const conf = path.join(work, 'dosbox.conf');
  const lines = [
    '[sdl]',
    'fullscreen=false',
    'autolock=false',
    'output=surface',
    '[dosbox]',
    'machine=svga_s3',
    'memsize=16',
    '[cpu]',
    'cycles=auto',
    '[serial]',
    'serial1=nullmodem server:127.0.0.1 port:' + port,
    '[autoexec]',
    'mount c "' + shellSafe(dosPath(work)) + '"',
    'c:',
  ];
  if (relDir) lines.push('cd ' + dosPath(relDir));
  // most classic DOS doors expect a FOSSIL driver to be resident; BNU /F is the
  // usual incantation (X00 is loaded as a device driver instead)
  for (const cand of ['BNU.COM', 'X00.EXE']) {
    if (fs.existsSync(path.join(runDir, cand))) {
      lines.push(cand === 'BNU.COM' ? 'BNU /F' : 'X00 /Pn');
      manager.pushLog('fossil: ' + cand + ' loaded before the door');
      break;
    }
  }
  // DOS doors are fussy about how they are launched: LORD refuses to run as
  // LORD.EXE and insists on START.BAT <node> (it passes the node through to the
  // executable, along with its own switches)
  const isBatch = /\.bat$/i.test(runName);
  const node = String(term.node || 1);
  const extra = Array.isArray(door.args) && door.args.length ? door.args.map(String) : isBatch ? [node] : [];
  lines.push([runName, ...extra].join(' '), 'exit', '');
  fs.writeFileSync(conf, lines.join('\r\n'));

  manager.pushLog('dosbox: ' + runName + ' on COM1 port ' + port);
  const isX = /dosbox-x/i.test(dosboxExe);
  // DOSBox-X is a console app that will quit on -exit; 0.74 detaches its own
  // console, so it gets -noconsole and we stop on the serial socket instead
  const args = isX ? ' -conf "' + conf + '" -fastlaunch -exit' : ' -conf "' + conf + '" -noconsole';
  try {
    await manager.runExternal(term, '"' + dosboxExe + '"' + args, work, door, { serialPort: port });
  } finally {
    setTimeout(() => {
      try {
        fs.rmSync(work, { recursive: true, force: true });
      } catch {}
    }, 1500);
  }
}

module.exports = { runDos };
