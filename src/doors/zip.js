'use strict';
// Minimal ZIP reader (stored + deflate), no external deps. Extraction is path-safe.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function findEOCD(buf) {
  const sig = 0x06054b50;
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === sig) return i;
  }
  return -1;
}

function list(buf) {
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error('Not a ZIP file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const method = buf.readUInt16LE(off + 10);
    const crc = buf.readUInt32LE(off + 16);
    const compSize = buf.readUInt32LE(off + 20);
    const rawSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    entries.push({ name, method, compSize, rawSize, crc, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, entry) {
  if (buf.readUInt32LE(entry.localOff) !== 0x04034b50) throw new Error('Corrupt ZIP local header');
  const nameLen = buf.readUInt16LE(entry.localOff + 26);
  const extraLen = buf.readUInt16LE(entry.localOff + 28);
  const start = entry.localOff + 30 + nameLen + extraLen;
  const data = buf.slice(start, start + entry.compSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

function safeRel(name) {
  const rel = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
  return rel;
}

function extractZip(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath);
  const entries = list(buf);
  const written = [];
  const root = path.resolve(destDir);
  for (const e of entries) {
    // "legord/" is a directory entry; stripping the slash turned it into a
    // zero-byte file, and every file under it then failed to extract
    const isDir = /[\/\\]$/.test(e.name);
    const rel = safeRel(e.name);
    if (!rel) continue;
    const out = path.resolve(root, rel);
    if (!out.startsWith(root + path.sep)) continue; // zip-slip guard
    if (isDir) {
      try {
        fs.mkdirSync(out, { recursive: true });
      } catch {
        fs.rmSync(out, { force: true });
        fs.mkdirSync(out, { recursive: true });
      }
      continue;
    }
    if (fs.existsSync(out) && fs.statSync(out).isDirectory()) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, extractEntry(buf, e));
    written.push(rel);
  }
  return written;
}

function isZip(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    fs.closeSync(fd);
    return b.toString('latin1').startsWith('PK');
  } catch {
    return false;
  }
}

module.exports = { list, extractZip, isZip, safeRel };
