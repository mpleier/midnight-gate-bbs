#!/usr/bin/env node
'use strict';
// Builds the screen redirector that lets DOS doors talk to a caller.
//
//   node tools/dosdoor/build.js
//
// The assembled binary is committed (src/doors/dos/scrape.com) so nobody needs
// NASM just to run a door; you only need it when changing scrape.asm.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DIR = __dirname;
const SRC = path.join(DIR, 'scrape.asm');
const OUT = path.join(DIR, '..', '..', 'src', 'doors', 'dos', 'scrape.com');
const CANDIDATES = [
  'nasm',
  'C:/Program Files/NASM/nasm.exe',
  'C:/nasm/nasm.exe',
  path.join(process.env.LOCALAPPDATA || '', 'hermes', 'cache', 'scratch', 'nasm-2.16.03', 'nasm.exe'),
];

function findNasm() {
  for (const c of CANDIDATES) {
    try {
      execFileSync(c, ['-v'], { stdio: 'ignore' });
      return c;
    } catch {}
  }
  return null;
}

const nasm = findNasm();
if (!nasm) {
  console.error('nasm not found. Install NASM (winget install NASM.NASM) and run again.');
  console.error('The prebuilt binary is already in src/doors/dos/scrape.com, so doors still work.');
  process.exit(1);
}

execFileSync(nasm, ['-f', 'bin', '-I', DIR + path.sep, SRC, '-o', OUT], { stdio: 'inherit' });
const size = fs.statSync(OUT).size;
console.log(`built ${path.relative(process.cwd(), OUT)} — ${size} bytes`);
