'use strict';
const crypto = require('node:crypto');
const config = require('./config');

function hash(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString('hex');
}

function setPassword(user, pw) {
  user.salt = crypto.randomBytes(16).toString('hex');
  user.pass = hash(pw, user.salt);
}

function checkPassword(user, pw) {
  if (!user || !user.pass || !user.salt) return false;
  const h = hash(pw, user.salt);
  const a = Buffer.from(h);
  const b = Buffer.from(user.pass);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const LEVELS = [
  { min: 100, name: 'SysOp', short: 'SYSOP' },
  { min: 90, name: 'Co-SysOp', short: 'COSYS' },
  { min: 80, name: 'Aide', short: 'AIDE' },
  { min: 50, name: 'Validated User', short: 'USER' },
  { min: 20, name: 'User', short: 'USER' },
  { min: 10, name: 'New User', short: 'NEW' },
  { min: 0, name: 'Visitor', short: 'GUEST' },
];

function levelName(level) {
  return (LEVELS.find((l) => level >= l.min) || LEVELS[LEVELS.length - 1]).name;
}

function atLeast(user, level) {
  return !!user && (user.level || 0) >= level;
}

module.exports = { hash, setPassword, checkPassword, levelName, atLeast, LEVELS, config };
