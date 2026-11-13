'use strict';
// Registers the textfiles in files/util with the board's file area.
// Idempotent: run it after dropping new .TXT files in.
const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/db');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'files', 'util');

const DESC = {
  'MODEMS.TXT': 'A caller\'s guide to modems, speeds and the handshake',
  'ANSI.TXT': 'ANSI art primer: characters, colour ramps, shading',
  'DOORS.TXT': 'Door game etiquette, and what is in the door menu here',
  'SYSOP.TXT': 'So you want to run a board: costs, rules, first week',
  'TEXTFILES.TXT': 'Index of the textfiles in this area',
};

function main() {
  let area = db.fileAreas.find((a) => a.path && a.path.replace(/\\/g, '/').endsWith('files/util'));
  if (!area) {
    area = { id: 'area_util', name: 'Utilities & Texfiles', desc: 'Docs, textfiles, and the occasional gem.', path: 'files/util', level: 10 };
    db.fileAreas.push(area);
  }
  const files = fs.readdirSync(DIR).filter((f) => /\.(txt|doc|nfo)$/i.test(f));
  let added = 0;
  for (const name of files) {
    if (db.files.some((f) => f.areaId === area.id && f.name.toLowerCase() === name.toLowerCase())) continue;
    const full = path.join(DIR, name);
    const st = fs.statSync(full);
    db.files.push({
      id: 'file_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12),
      areaId: area.id,
      name,
      desc: DESC[name.toUpperCase()] || 'Textfile',
      size: st.size,
      date: st.mtimeMs,
      path: path.join('files', 'util', name),
      downloads: 0,
    });
    added++;
  }
  db.save();
  console.log(`${files.length} textfiles on disk, ${added} newly registered, ${db.files.length} files online`);
}

main();

module.exports = { main };
