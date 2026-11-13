'use strict';
// File areas + download tickets (web) — telnet callers get the web link.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db');
const s = require('./screens');

const tickets = new Map(); // token -> {file, expires}

function issueTicket(file) {
  const token = crypto.randomBytes(12).toString('hex');
  tickets.set(token, { file, expires: Date.now() + 30 * 60 * 1000 });
  for (const [t, v] of tickets) if (v.expires < Date.now()) tickets.delete(t);
  return token;
}

function takeTicket(token) {
  const t = tickets.get(token);
  if (!t) return null;
  tickets.delete(token);
  if (t.expires < Date.now()) return null;
  return t.file;
}

function areaFiles(areaId) {
  return db.files.filter((f) => f.areaId === areaId);
}

async function areas(term) {
  for (;;) {
    const top = s.frame(term, 'FILES.ANS', 'FILE AREAS');
    const list = db.fileAreas.filter((a) => (term.user.level || 0) >= (a.level || 0));
    term.print(top, 3, '  #   Area                            Files   Description', 8);
    term.print(top + 1, 3, '─'.repeat(Math.min(term.cols - 6, 74)), 8);
    list.forEach((a, i) => {
      const row = top + 2 + i;
      const n = areaFiles(a.id).length;
      term.print(row, 3, String(i + 1).padStart(2), 10);
      term.print(row, 7, s.pad(a.name, 30), 15);
      term.print(row, 38, s.pad(n, 5, true), 7);
      term.print(row, 45, s.pad(a.desc, Math.max(8, term.cols - 48)), 8);
    });
    term.print(term.rows - 4, 3, `${db.files.length} files online, ${s.fmtSize(db.files.reduce((t, f) => t + (f.size || 0), 0))} total.`, 8);
    term.print(term.rows - 3, 3, '[Q]uit', 14);
    term.gotoxy(term.rows - 2, 1);
    term.reset();
    const k = await term.menu({ prompt: '\x1b[0;36mArea number: \x1b[0m', valid: '123456789Q', allowEmpty: true });
    if (k == null || k === 'Q' || k === 'ESC' || k === '') return;
    const area = list[Number(k) - 1];
    if (!area) continue;
    await areaMenu(term, area);
  }
}

async function areaMenu(term, area) {
  for (;;) {
    const files = areaFiles(area.id);
    const top = s.frame(term, 'FILES.ANS', area.name.toUpperCase());
    if (!files.length) {
      term.print(top, 3, 'Nothing uploaded here yet.', 8);
    } else {
      term.print(top, 3, '  #   Filename             Size  Date             Description', 8);
      term.print(top + 1, 3, '─'.repeat(Math.min(term.cols - 6, 74)), 8);
      files.slice(0, Math.max(3, term.rows - (top + 7))).forEach((f, i) => {
        const row = top + 2 + i;
        term.print(row, 3, String(i + 1).padStart(2), 10);
        term.print(row, 7, s.pad(f.name, 20), 15);
        term.print(row, 28, s.pad(s.fmtSize(f.size || 0), 5, true), 7);
        term.print(row, 35, s.fmtDate(f.date), 8);
        term.print(row, 52, s.pad(f.desc, Math.max(8, term.cols - 55)), 9);
      });
    }
    term.print(term.rows - 3, 3, '[D]ownload  [Q]uit', 14);
    term.gotoxy(term.rows - 2, 1);
    term.reset();
    const k = await term.menu({ prompt: '\x1b[0;36mCommand: \x1b[0m', valid: 'DQ', allowEmpty: true });
    if (k == null || k === 'Q' || k === 'ESC' || k === '') return;
    if (k === 'D') {
      if (!files.length) continue;
      const n = await term.readLine({ prompt: 'File number: ', max: 3 });
      const f = files[Number(n) - 1];
      if (!f) {
        s.error(term, 'No such file.');
        continue;
      }
      await download(term, f);
    }
  }
}

async function download(term, file) {
  const full = path.isAbsolute(file.path || '') ? file.path : path.join(config.root, file.path || '');
  if (!fs.existsSync(full)) {
    s.error(term, 'That file has gone missing from the drive. Tell the sysop.');
    await term.pause();
    return;
  }
  term.write(`\r\n  ${file.name}  (${s.fmtSize(file.size || 0)})\r\n`);
  file.downloads = (file.downloads || 0) + 1;
  term.user.downloads = (term.user.downloads || 0) + 1;
  term.session.downloads++;
  db.stats.bytesDl += file.size || 0;
  db.save();
  if (term.kind === 'web') {
    const token = issueTicket(file);
    const host = `http://localhost:${config.get('network.httpPort')}`;
    term.color(10);
    term.write('\r\n  *** FILE READY ***\r\n');
    term.reset();
    term.write('  ZMODEM is simulated. Open this link to grab the file:\r\n\r\n');
    term.color(14);
    term.write(`  ${host}/dl/${token}/${encodeURIComponent(file.name)}\r\n`);
    term.reset();
  } else {
    term.color(14);
    term.write('\r\n  ZMODEM: not available over this connection.\r\n');
    term.reset();
    term.write(`  Point a browser at http://${config.get('network.publicHost')}:${config.get('network.httpPort')}/ and use the file areas there,\r\n`);
    term.write('  or ask the sysop for a direct link.\r\n');
  }
  await term.pause();
}

async function newScan(term) {
  const files = [...db.files].sort((a, b) => b.date - a.date).slice(0, 20);
  term.cls();
  s.header(term, 'NEW FILES SCAN', 11);
  term.write('\r\n');
  if (!files.length) {
    term.write('  No files have been uploaded yet.\r\n');
  } else {
    files.forEach((f, i) => {
      term.print(4 + i, 3, s.pad(f.name, 22), 15);
      term.print(4 + i, 26, s.pad(s.fmtSize(f.size || 0), 5, true), 7);
      term.print(4 + i, 33, s.fmtDate(f.date), 8);
      term.print(4 + i, 50, s.pad(f.desc, 28), 9);
    });
  }
  await term.pause();
}

module.exports = { areas, areaMenu, newScan, download, issueTicket, takeTicket, areaFiles };
