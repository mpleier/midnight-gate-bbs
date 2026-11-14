'use strict';
// Renders the dial-up handshake as audio, from the anatomy of a real call:
//
//   off-hook click -> dial tone (350 + 440 Hz) -> DTMF for the number ->
//   ringback (440 + 480 Hz) -> answer tone (ANSam: 2100 Hz, 15 Hz amplitude
//   modulation, 180-degree phase reversals every 450 ms) -> V.8 call menu from
//   the caller (V.21 channel 1, 980/1180 Hz, 300 baud) -> V.8 joint menu from
//   the answerer (channel 2, 1650/1850 Hz) -> line probe -> training
//   (the screech, where the speed is decided) -> carrier hiss
//
// Everything is band-limited to 300-3400 Hz, the passband of a phone line, and
// nothing is sampled from a recording, so the file is ours to ship.
//
//   node tools/make-dialup-audio.js                      # 867-5309, dialup.wav
//   node tools/make-dialup-audio.js --number 5550113 --out art/x.wav
//   node tools/make-dialup-audio.js --bps 33600          # slower training
//
// With ffmpeg on PATH it also writes an mp3 next to the wav.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SR = 22050;
const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const NUMBER = String(argOf('number', '8675309')).replace(/\D/g, '') || '8675309';
const BPS = Number(argOf('bps', '33600'));
const OUT = argOf('out', path.join(__dirname, '..', 'public', 'audio', 'dialup.wav'));

const TOTAL = 11.45;
const buf = new Float32Array(Math.ceil(SR * TOTAL));

/* ------------------------------------------------------------------ helpers */
const distort = (x) => Math.tanh(x * 1.1) * 0.92;

function wave(type, phase) {
  switch (type) {
    case 'square':
      return Math.sin(phase) >= 0 ? 1 : -1;
    case 'saw':
      return 2 * ((phase / (2 * Math.PI)) % 1) - 1;
    case 'tri':
      return 2 * Math.abs(2 * ((phase / (2 * Math.PI)) % 1) - 1) - 1;
    default:
      return Math.sin(phase);
  }
}

// one tone with an attack/release envelope
function tone(freq, start, dur, gain = 0.08, type = 'sine') {
  const i0 = Math.max(0, Math.round(start * SR));
  const len = Math.min(buf.length - i0, Math.round(dur * SR));
  if (len <= 0) return;
  const a = Math.max(1, Math.round(0.006 * SR));
  const r = Math.max(1, Math.round(0.02 * SR));
  let phase = 0;
  for (let i = 0; i < len; i++) {
    let g = 1;
    if (i < a) g = i / a;
    else if (i > len - r) g = Math.max(0, (len - i) / r);
    phase += (2 * Math.PI * freq) / SR;
    buf[i0 + i] += wave(type, phase) * gain * g;
  }
}

// ANSam: the answer tone of the far end's modem. 2100 Hz, amplitude-modulated
// at 15 Hz, with the phase reversed by 180 degrees every 450 ms so that echo
// cancellers on the line cannot notch it out. The reversals are audible as
// little clicks on top of the warble.
function ansam(freq, start, dur, gain = 0.1, modHz = 15) {
  const i0 = Math.max(0, Math.round(start * SR));
  const len = Math.min(buf.length - i0, Math.round(dur * SR));
  if (len <= 0) return;
  let phase = 0;
  let flip = 1;
  const vsr = Math.round(0.45 * SR);
  let nextFlip = vsr;
  for (let i = 0; i < len; i++) {
    if (i >= nextFlip) {
      flip = -flip;
      nextFlip += vsr;
    }
    const t = i / SR;
    const am = 1 + 0.2 * Math.sin(2 * Math.PI * modHz * t);
    const env = Math.min(1, i / (0.005 * SR)) * Math.min(1, (len - i) / (0.02 * SR));
    phase += (2 * Math.PI * freq) / SR;
    buf[i0 + i] += Math.sin(phase) * flip * am * gain * env;
  }
}

// V.21: the 300-baud FSK channel V.8 negotiates on. Channel 1 (980/1180 Hz) is
// the caller's, channel 2 (1650/1850 Hz) is the answerer's. Real traffic: a
// preamble of flags, then the menu bytes.
function v21(start, dur, f0, f1, gain = 0.07) {
  const i0 = Math.max(0, Math.round(start * SR));
  const len = Math.min(buf.length - i0, Math.round(dur * SR));
  if (len <= 0) return;
  const bits = [];
  const push = (byte) => {
    for (let b = 0; b < 8; b++) bits.push((byte >> b) & 1);
  };
  push(0x7e);
  push(0x7e);
  for (let k = 0; k < 48; k++) push((Math.random() * 256) | 0);
  const spb = SR / 300;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const bit = bits[Math.floor(i / spb) % bits.length];
    phase += (2 * Math.PI * (bit ? f1 : f0)) / SR;
    const env = Math.min(1, i / (0.005 * SR)) * Math.min(1, (len - i) / (0.01 * SR));
    buf[i0 + i] += Math.sin(phase) * gain * env;
  }
}

function sweep(f0, f1, start, dur, gain = 0.06, type = 'saw') {
  const i0 = Math.max(0, Math.round(start * SR));
  const len = Math.min(buf.length - i0, Math.round(dur * SR));
  if (len <= 0) return;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const k = i / len;
    const f = f0 * Math.pow(Math.max(60, f1) / f0, k);
    phase += (2 * Math.PI * f) / SR;
    const env = Math.min(1, i / (0.012 * SR)) * Math.min(1, (len - i) / (0.03 * SR));
    buf[i0 + i] += wave(type, phase) * gain * env;
  }
}

// RBJ bandpass biquad, used to shape noise the way a phone line would
function bandNoise(start, dur, gain = 0.08, centre = 1500, q = 0.8) {
  const i0 = Math.max(0, Math.round(start * SR));
  const len = Math.min(buf.length - i0, Math.round(dur * SR));
  if (len <= 0) return;
  const w0 = (2 * Math.PI * centre) / SR;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = alpha;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < len; i++) {
    const x = Math.random() * 2 - 1;
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    const env = Math.min(1, i / (0.01 * SR)) * Math.min(1, (len - i) / (0.05 * SR));
    buf[i0 + i] += y * gain * 2.2 * env;
  }
}

const click = (start, gain = 0.16) => bandNoise(start, 0.02, gain, 2200, 1.4);

/* ------------------------------------------------------------ the sequence */
const DTMF = {
  0: [941, 1336], 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209],
  5: [770, 1336], 6: [770, 1477], 7: [852, 1209], 8: [852, 1336], 9: [852, 1477],
};

let t = 0;
click(0.005); // handset off the hook
t = 0.08;
tone(350, t, 3.2, 0.05); // dial tone: the line is live
tone(440, t, 3.2, 0.05);
t = 3.34;

// DTMF for the number this call dialled
for (const d of NUMBER) {
  const [a, b] = DTMF[d] || DTMF[7];
  tone(a, t, 0.1, 0.085);
  tone(b, t, 0.1, 0.085);
  t += 0.15;
}

// ringback: the far end is ringing
t += 0.1;
tone(440, t, 1.15, 0.045);
tone(480, t, 1.15, 0.045);
t += 1.25;

// answer tone: their modem picked up. ANSam, with its phase reversals
click(t, 0.12);
ansam(2100, t + 0.02, 0.85, 0.1, 15);
t += 0.9;

// V.8: the caller announces the speeds and features it can do - the call menu,
// CM, on V.21 channel 1 (980/1180 Hz)
v21(t, 0.7, 980, 1180, 0.075);
t += 0.72;

// the answering modem replies with its own menu (JM) on channel 2 (1650/1850 Hz)
v21(t, 0.7, 1650, 1850, 0.07);
t += 0.74;

// line probe: short tones stepping up the band with phase hits at each step,
// the modems measuring the line's response and delay before agreeing a symbol rate
const probeTones = [800, 1000, 1250, 1500, 1800, 2100];
for (let i = 0; i < probeTones.length; i++) {
  click(t + i * 0.07, 0.045);
  tone(probeTones[i], t + i * 0.07, 0.06, 0.065);
}
t += 0.5;

// training: the long screech. Carrier with sweeps and noise while the
// equalisers converge - this is where the speed is decided, and why you could
// hear whether a call would come up fast or crawl in
sweep(1200, 2400, t, 0.35, 0.07);
bandNoise(t, 0.95, 0.075, 1700, 0.7);
sweep(2400, 1300, t + 0.3, 0.55, 0.05);
tone(1800, t + 0.15, 0.8, 0.045, 'square');
t += 1.0;

// carrier: data, at a level you would hear through the speaker
t += 0.05;
const dataLen = Math.max(0.6, TOTAL - t - 0.35);
bandNoise(t, dataLen, 0.028, 1900, 0.7);
tone(1800, t, dataLen, 0.012);

/* -------------------------------------------------- phone-line passband ---- */
function biquad(signal, type, freq, q) {
  const w0 = (2 * Math.PI * freq) / SR;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  let b0, b1, b2;
  if (type === 'hp') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  } else {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const x = signal[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    signal[i] = y;
  }
}

biquad(buf, 'hp', 300, 0.7);
biquad(buf, 'lp', 3300, 0.7);
biquad(buf, 'lp', 3300, 0.7);

// normalise to -1 dBFS, 5 ms fade in, 400 ms fade out
let peak = 1e-9;
for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = 0.89 / peak;
for (let i = 0; i < buf.length; i++) buf[i] = distort(buf[i] * norm * 0.98);
const fadeIn = Math.round(0.005 * SR);
const fadeOut = Math.round(0.4 * SR);
for (let i = 0; i < fadeIn; i++) buf[i] *= i / fadeIn;
for (let i = 0; i < fadeOut; i++) buf[buf.length - 1 - i] *= i / fadeOut;

/* ------------------------------------------------------------------- write */
function wav(samples, sr) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(sr, 24);
  head.writeUInt32LE(sr * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, wav(buf, SR));
const secs = (buf.length / SR).toFixed(2);
console.log(`wrote ${OUT} — ${secs}s, ${SR} Hz mono, dialled ${NUMBER}, negotiating ${BPS} bps`);

// an mp3 for browsers, if ffmpeg is around
const mp3 = OUT.replace(/\.wav$/, '.mp3');
try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', OUT, '-ac', '1', '-ar', String(SR), '-b:a', '64k', mp3], { stdio: 'inherit' });
  console.log(`wrote ${mp3} — ${(fs.statSync(mp3).size / 1024).toFixed(0)} KB`);
} catch {
  console.log('ffmpeg not found — wav only (the web terminal will still play it)');
}
