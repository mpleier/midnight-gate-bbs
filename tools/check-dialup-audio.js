'use strict';
// Checks the rendered handshake by measuring which frequencies are present in
// each stage — the audio equivalent of reading the screen.
const fs = require('node:fs');
const path = require('node:path');

const wav = fs.readFileSync(path.join(__dirname, '..', 'public', 'audio', 'dialup.wav'));
const sr = wav.readUInt32LE(24);
const data = wav.subarray(44);
const n = data.length / 2;
const pcm = new Float32Array(n);
for (let i = 0; i < n; i++) pcm[i] = data.readInt16LE(i * 2) / 32768;

// Goertzel: energy at one frequency over one window
function energy(freq, start, dur) {
  const i0 = Math.max(0, Math.round(start * sr));
  const len = Math.min(pcm.length - i0, Math.round(dur * sr));
  const k = Math.round((len * freq) / sr);
  const w = (2 * Math.PI * k) / len;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) {
    s0 = pcm[i0 + i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / len;
}

const bands = [300, 350, 440, 480, 697, 770, 852, 941, 980, 1180, 1209, 1336, 1477, 1650, 1800, 2100, 2400, 2600];
function dom(start, dur) {
  return bands
    .map((f) => [f, energy(f, start, dur)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([f, e]) => `${f}Hz ${(e * 1000).toFixed(1)}`)
    .join('  ');
}

const stages = [
  ['dial tone', 0.6, 2.2],
  ['first DTMF digit (8: 852+1336)', 3.36, 0.09],
  ['last DTMF digit (9: 852+1477)', 4.24, 0.09],
  ['ringback', 4.70, 0.9],
  ['answer tone', 6.00, 0.6],
  ['V.8 warble', 6.95, 0.4],
  ['V.21 beeps', 7.28, 0.4],
  ['training', 8.00, 0.35],
  ['carrier', 10.40, 0.6],
];

let ok = 0;
for (const [name, t, d] of stages) {
  console.log(`${name.padEnd(32)} ${dom(t, d)}`);
}

// assertions on what each stage must contain
const has = (f, t, d, floor = 0.004) => energy(f, t, d) > floor;
const checks = [
  ['dial tone has 350 Hz', has(350, 0.9, 2.0)],
  ['dial tone has 440 Hz', has(440, 0.9, 2.0)],
  ['DTMF 8 has 852+1336', has(852, 3.36, 0.08, 0.003) && has(1336, 3.36, 0.08, 0.003)],
  ['DTMF 9 has 1477', has(1477, 4.24, 0.08, 0.003)],
  ['ringback has 480', has(480, 4.75, 0.8, 0.002)],
  ['answer tone is 2100', has(2100, 6.05, 0.5, 0.004)],
  ['V.21 has 980/1180', has(980, 7.28, 0.38, 0.0015) || has(1180, 7.28, 0.38, 0.0015)],
  ['carrier is energy, not silence', energy(1900, 9.8, 0.8) > 0.0008],
  ['no clipping', Math.max(...Array.from(pcm.slice(0, 20000)).map(Math.abs)) < 1],
];
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (pass) ok++;
}
console.log(`\n${ok}/${checks.length} stage checks passed`);
process.exitCode = ok === checks.length ? 0 : 1;
