'use strict';
// Drop-file writers for DOS doors: DOOR.SYS, DORINFO1.DAT, CHAIN.TXT, CALLINFO.BBS, EXITINFO.BBS.
const fs = require('node:fs');
const path = require('node:path');

function pad(s, n) {
  return String(s ?? '')
    .replace(/[\r\n]/g, ' ')
    .slice(0, n)
    .padEnd(n, ' ');
}

function doorSys(term) {
  const u = term.user || {};
  const now = new Date();
  const d = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
  const lines = [
    `COM${term.node || 1}`, // 1 comm port
    '14400', // 2 baud
    '8', // 3 parity
    String(term.node || 1), // 4 node
    '14400', // 5 locked baud
    '', // 6 password
    pad(u.name || u.handle || 'Caller', 36), // 7 name
    pad([u.city, u.state].filter(Boolean).join(', '), 30), // 8 location
    pad(u.phone || '', 20), // 9 home phone
    pad('', 20), // 10 data phone
    '', // 11 password
    String(u.level || 10), // 12 access level
    String(u.calls || 1), // 13 total calls
    d, // 14 last call date
    String((term.session.minutesLeft || 0) * 60), // 15 seconds left
    String(term.session.minutesLeft || 0), // 16 minutes left
    'GR', // 17 graphics mode
    String(term.rows || 25), // 18 page length
    'Y', // 19 user mode
    'Y', // 20 alarm
    'Y', // 21 sysop available
    pad((u.name || '').split(' ')[0] || u.handle || 'Caller', 20), // 22 first name
    pad((u.name || '').split(' ').slice(1).join(' ') || '', 20), // 23 last name
    '', // 24 password
    '', // 25 expiry
    String(u.id || 1), // 26 user number
    '7', // 27 default colour
    '0', // 28 time credit
    '0', // 29 last new files
    '1', // 30 conference
    '0', // 31 event time
    '0', // 32 error free
    'X', // 33 protocol
    '0', // 34 bytes
    '0', // 35 daily file limit
    '0', // 36 posts per call
    String(u.posts || 0), // 37 posts total
    '0', // 38 post cost
    '1', // 39 minutes this call
    '1', // 40 minutes today
    '0', // 41 daily limit
    '99', // 42 max downloads
    String(u.uploads || 0), // 43 uploads today
    String(u.downloads || 0), // 44 downloads today
    '0', // 45 download KB today
    '0', // 46 download KB total
    u.sig ? pad(u.sig, 40) : '', // 47 comment
    '0', // 48 doors
    '0', // 49 doors
    '0', // 50 doors
    pad(u.birth || '', 8), // 51 birthdate
  ];
  return lines.join('\r\n') + '\r\n';
}

function dorinfo(term) {
  const u = term.user || {};
  const [first, ...rest] = String(u.name || u.handle || 'Caller').split(' ');
  return [
    'SysOp',
    require('../config').get('bbs.name'),
    'COM0',
    '14400',
    '0',
    `${first}`,
    rest.join(' ') || first,
    u.city || '',
    u.state || '',
    u.phone || '',
    String(u.level || 10),
    String(term.session.minutesLeft || 0),
    term.ansi ? 'Y' : 'N',
    String(term.node || 1),
    '0',
    '',
  ].join('\r\n') + '\r\n';
}

function chainTxt(term) {
  const u = term.user || {};
  const [first, ...rest] = String(u.name || u.handle || 'Caller').split(' ');
  return [
    first,
    rest.join(' ') || first,
    u.handle || 'Caller',
    [u.city, u.state].filter(Boolean).join(', '),
    u.phone || '',
    '14400',
    '14400',
    String(term.session.minutesLeft || 0),
    String(u.level || 10),
    '1',
    '1',
    '1',
    '1',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
  ].join('\r\n') + '\r\n';
}

function callinfo(term) {
  const u = term.user || {};
  return `1\r\n${u.handle || 'Caller'}\r\n${u.name || ''}\r\n${term.session.minutesLeft || 0}\r\n${u.level || 10}\r\n`;
}

const WRITERS = {
  'DOOR.SYS': (t) => doorSys(t),
  'DORINFO1.DAT': (t) => dorinfo(t),
  'DORINFO.DAT': (t) => dorinfo(t),
  'CHAIN.TXT': (t) => chainTxt(t),
  'CALLINFO.BBS': (t) => callinfo(t),
};

function writeDrop(term, type, dir) {
  const fn = WRITERS[String(type || 'DOOR.SYS').toUpperCase()] || WRITERS['DOOR.SYS'];
  fs.mkdirSync(dir, { recursive: true });
  const name = String(type || 'DOOR.SYS').toUpperCase();
  const file = path.join(dir, name);
  fs.writeFileSync(file, fn(term));
  return file;
}

module.exports = { writeDrop, doorSys, dorinfo, chainTxt, callinfo, TYPES: Object.keys(WRITERS) };
