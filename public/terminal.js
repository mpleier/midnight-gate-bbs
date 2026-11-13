'use strict';
/* Web terminal: xterm.js at a fixed 80x25, scaled to fit, wired to the BBS websocket. */

const PALETTE = {
  black: '#000000',
  red: '#aa0000',
  green: '#00aa00',
  yellow: '#aa5500',
  blue: '#0000aa',
  magenta: '#aa00aa',
  cyan: '#00aaaa',
  white: '#aaaaaa',
  brightBlack: '#555555',
  brightRed: '#ff5555',
  brightGreen: '#55ff55',
  brightYellow: '#ffff55',
  brightBlue: '#5555ff',
  brightMagenta: '#ff55ff',
  brightCyan: '#55ffff',
  brightWhite: '#ffffff',
};

const term = new Terminal({
  cols: 80,
  rows: 25,
  cursorBlink: true,
  cursorStyle: 'block',
  fontFamily: "'IBM Plex Mono', 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace",
  fontSize: 18,
  lineHeight: 1.0,
  letterSpacing: 0,
  scrollback: 400,
  convertEol: false,
  allowTransparency: true,
  theme: {
    background: '#000000',
    foreground: '#c6c6c6',
    cursor: '#55ff55',
    cursorAccent: '#000000',
    selectionBackground: 'rgba(85,255,136,0.25)',
    ...PALETTE,
  },
});

term.open(document.getElementById('term'));

const els = {
  screen: document.getElementById('screen'),
  inner: document.getElementById('screenInner'),
  offline: document.getElementById('offline'),
  offlineWhy: document.getElementById('offlineWhy'),
  conn: document.getElementById('connState'),
  led: document.getElementById('led'),
  nodes: document.getElementById('nodesOnline'),
};

/* ---------------------------------------------------------------- scaling */
function rescale() {
  const frame = document.querySelector('.frame');
  const screenEl = document.querySelector('.xterm-screen');
  if (!frame || !screenEl) return;
  const w = screenEl.offsetWidth || 844;
  const h = screenEl.offsetHeight || 525;
  const availW = Math.max(320, frame.clientWidth - 44);
  const availH = Math.max(240, frame.clientHeight - 40);
  const scale = Math.max(0.25, Math.min(availW / w, availH / h, 1.7));
  els.inner.style.transform = `scale(${scale})`;
  els.inner.dataset.scale = String(scale);
  els.screen.style.width = Math.ceil(w * scale) + 20 + 'px';
  els.screen.style.height = Math.ceil(h * scale) + 20 + 'px';
}
window.addEventListener('resize', rescale);
setTimeout(rescale, 60);
setTimeout(rescale, 400);
setTimeout(rescale, 1200);

/* ------------------------------------------------------------------- socket */
let ws = null;
let connected = false;
let wantSound = true;
let audioCtx = null;
let dialNumbers = ['555-0113', '867-5309'];
let dialNumber = dialNumbers[0];
let modemList = [{ bps: 14400, connect: '14400/ARQ/V32BIS/LAPM/V42BIS', name: 'Sportster 14,400' }];
let modem = modemList[0];
let soundPending = false;

function pickModem() {
  modem = modemList[Math.floor(Math.random() * modemList.length)] || modemList[0];
  const baud = document.getElementById('baud');
  if (baud) baud.textContent = `${modem.bps}-8-N-1`;
  return modem;
}

function pickDialNumber() {
  dialNumber = dialNumbers[Math.floor(Math.random() * dialNumbers.length)] || '555-0113';
  return dialNumber;
}

function dialDigits() {
  return String(dialNumber)
    .replace(/\D/g, '')
    .split('');
}

function setState(state, text) {
  els.conn.textContent = text;
  els.led.className = 'led ' + (state === 'on' ? '' : state === 'wait' ? 'wait' : 'off');
}

function connect() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  els.offline.classList.remove('show');
  setState('wait', 'DIALING…');
  pickDialNumber();
  pickModem();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(
    `${proto}://${location.host}/ws?dial=${encodeURIComponent(dialNumber)}&modem=${modem.bps}`
  );
  socket.binaryType = 'arraybuffer';
  ws = socket;
  // any handler from a previous socket is ignored: only the current one speaks
  const current = () => ws === socket;

  socket.onopen = () => {
    if (!current()) return;
    connected = true;
    els.offline.classList.remove('show');
    setState('on', `CONNECT ${modem.bps}`);
    term.focus();
    if (wantSound) {
      playModem(modem.bps);
      if (audioCtx && audioCtx.state === 'suspended') {
        // browsers block audio until the page is interacted with: restart the
        // handshake on the first click so the caller actually hears it
        soundPending = true;
        const btn = document.getElementById('btnSound');
        if (btn) {
          btn.classList.add('pending');
          btn.title = 'Click the screen to hear the modem';
        }
      }
    }
  };
  socket.onmessage = (ev) => {
    if (!current()) return;
    if (typeof ev.data === 'string') term.write(ev.data);
    else if (ev.data instanceof ArrayBuffer) term.write(new Uint8Array(ev.data));
  };
  socket.onclose = () => {
    if (!current()) return;
    connected = false;
    setState('off', 'NO CARRIER');
    els.offline.classList.add('show');
    els.offlineWhy.textContent = 'The carrier dropped. The board is still there.';
  };
  socket.onerror = () => {
    if (!current()) return;
    els.offline.classList.add('show');
  };
}

// hang up the current socket without letting it fire its handlers at the new one
function dropSocket() {
  const old = ws;
  ws = null;
  if (!old) return;
  old.onopen = null;
  old.onmessage = null;
  old.onclose = null;
  old.onerror = null;
  try {
    old.close();
  } catch {}
}

function send(data) {
  if (ws && ws.readyState === 1) ws.send(data);
}

term.onData((d) => {
  if (modemPlaying) stopModem(); // any key skips the modem noises, like the screen says
  send(d);
});
term.onBinary((s) => send(s));
term.onBell(() => beep());

document.getElementById('redial').onclick = () => {
  els.offline.classList.remove('show');
  connect();
};
document.getElementById('btnRedial2').onclick = () => {
  dropSocket();
  connect();
};
els.screen.addEventListener('mousedown', () => term.focus());

/* -------------------------------------------------------------- modem audio */
function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/* ------------------------------------------------------------- modem audio
   A V.32bis 14,400 handshake, staged like the real thing:
   off-hook click, dial tone, DTMF, ringback, answer tone (2100 Hz ANSam),
   V.8 capability warble, V.21 beeps, training sweeps, then data hiss.
   Everything is band-limited to 300-3400 Hz, like a phone line. */

let modemNodes = [];
let modemEnd = 0;
let masterGain = null;
let modemPlaying = false;

function audioChain() {
  const ac = ctx();
  if (!ac) return null;
  if (!masterGain) {
    masterGain = ac.createGain();
    masterGain.gain.value = 0.9;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3400;
    const out = ac.createGain();
    out.gain.value = 0.8;
    masterGain.connect(hp).connect(lp).connect(out).connect(ac.destination);
    // measurement tap so the handshake volume can be checked from the console
    const analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    out.connect(analyser);
    window.__audioTap = analyser;
  }
  return { ac, out: masterGain };
}

function envelope(param, start, dur, peak) {
  const attack = Math.min(0.006, dur / 4);
  const release = Math.min(0.02, dur / 3);
  param.setValueAtTime(0.0001, start);
  param.linearRampToValueAtTime(peak, start + attack);
  param.setValueAtTime(peak, Math.max(start + attack, start + dur - release));
  param.linearRampToValueAtTime(0.0001, start + dur);
}

function tone(freq, start, dur, gain = 0.08, type = 'sine') {
  const c = audioChain();
  if (!c) return;
  const ac = c.ac;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  envelope(g.gain, start, dur, gain);
  osc.connect(g).connect(c.out);
  osc.start(start);
  osc.stop(start + dur + 0.03);
  modemNodes.push(osc);
}

// amplitude-modulated tone: the answer tone is 2100 Hz with a 15 Hz warble
function warble(freq, start, dur, gain = 0.1, modHz = 15, depth = 0.6) {
  const c = audioChain();
  if (!c) return;
  const ac = c.ac;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, start);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain * (1 - depth), start);
  const lfo = ac.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(modHz, start);
  const lfoGain = ac.createGain();
  lfoGain.gain.value = gain * depth;
  lfo.connect(lfoGain).connect(g.gain);
  osc.connect(g).connect(c.out);
  osc.start(start);
  lfo.start(start);
  osc.stop(start + dur);
  lfo.stop(start + dur);
  modemNodes.push(osc, lfo);
}

// continuous-phase FSK: 300 baud V.21 style beeps
function fsk(start, dur, f0, f1, baud = 300, gain = 0.07) {
  const c = audioChain();
  if (!c) return;
  const ac = c.ac;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, start);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, start);
  const step = 1 / baud;
  for (let t = start; t < start + dur; t += step) {
    osc.frequency.setValueAtTime(Math.round((t - start) / step) % 2 ? f1 : f0, t);
  }
  osc.connect(g).connect(c.out);
  osc.start(start);
  osc.stop(start + dur);
  modemNodes.push(osc);
}

function sweep(f0, f1, start, dur, gain = 0.06, type = 'sawtooth') {
  const c = audioChain();
  if (!c) return;
  const ac = c.ac;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(60, f1), start + dur);
  envelope(g.gain, start, dur, gain);
  osc.connect(g).connect(c.out);
  osc.start(start);
  osc.stop(start + dur + 0.03);
  modemNodes.push(osc);
}

function noiseBand(start, dur, gain = 0.08, centre = 1500, q = 0.8) {
  const c = audioChain();
  if (!c) return;
  const ac = c.ac;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(centre, start);
  bp.Q.value = q;
  const g = ac.createGain();
  envelope(g.gain, start, Math.min(dur, 0.05), gain);
  g.gain.setValueAtTime(gain, Math.max(start + 0.05, start + dur - 0.06));
  g.gain.linearRampToValueAtTime(0.0001, start + dur);
  src.connect(bp).connect(g).connect(c.out);
  src.start(start);
  modemNodes.push(src);
}

function click(start, dur = 0.018, gain = 0.18) {
  noiseBand(start, dur, gain, 2200, 1.4);
}

function stopModem() {
  if (sampleEl && !sampleEl.paused) {
    try {
      sampleEl.pause();
      sampleEl.currentTime = 0;
    } catch {}
  }
  if (!modemNodes.length) {
    modemPlaying = false;
    return;
  }
  const now = audioCtx ? audioCtx.currentTime : 0;
  try {
    if (masterGain) {
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value || 0.9, now);
      masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.12);
      setTimeout(() => {
        if (masterGain) masterGain.gain.value = 0.9;
      }, 400);
    }
    for (const n of modemNodes) {
      try {
        n.stop(now + 0.15);
      } catch {}
    }
  } catch {}
  modemNodes = [];
}

const DTMF = {
  0: [941, 1336], 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209],
  5: [770, 1336], 6: [770, 1477], 7: [852, 1209], 8: [852, 1336], 9: [852, 1477],
};

/* ------------------------------------------------------- recorded dial-up
   The real handshake, not the oscillator: 11 s of dial tone, DTMF, ringback,
   answer tone and training, trimmed and normalised. It is used whenever it
   loads; the synthesised handshake below stays as the fallback, and ?synth=1
   forces the synth so the two can be compared. */
const DIAL_SAMPLE_URL = '/audio/dialup.mp3?v=2';
const forceSynth = new URLSearchParams(location.search).has('synth');
let sampleEl = null;
let sampleBroken = false;

function dialSample() {
  if (forceSynth || sampleEl || sampleBroken) return sampleEl;
  try {
    sampleEl = new Audio(DIAL_SAMPLE_URL);
    sampleEl.preload = 'auto';
    sampleEl.volume = 0.85;
    // a detached element can sit at readyState 0 forever unless told to fetch
    sampleEl.load();
    sampleEl.addEventListener('error', () => {
      sampleBroken = true;
      sampleEl = null;
    });
  } catch {
    sampleBroken = true;
  }
  return sampleEl;
}

function playSample() {
  const el = dialSample();
  if (!el || el.readyState < 2) return false;
  try {
    el.currentTime = 0;
    el.volume = wantSound ? 0.85 : 0;
    const p = el.play();
    if (p && p.catch) {
      // Before the caller has clicked anything the browser blocks playback.
      // The synth would be blocked too, so keep the promise: the pointerdown
      // handler replays the handshake once audio is unlocked.
      p.catch(() => {
        soundPending = true;
        const btn = document.getElementById('btnSound');
        if (btn) btn.classList.add('pending');
      });
    }
    return true;
  } catch {
    return false;
  }
}

function playModem(bps = 14400) {
  stopModem();
  if (playSample()) {
    modemPlaying = true;
    modemEnd = (audioCtx ? audioCtx.currentTime : 0) + 12;
    return;
  }
  const c = audioChain();
  if (!c) return;
  const ac = c.ac;
  // a previous stopModem may still have a fade-out scheduled: undo it so the
  // redial starts at full volume instead of playing the first half-second silent
  try {
    masterGain.gain.cancelScheduledValues(ac.currentTime);
    masterGain.gain.setValueAtTime(0.9, ac.currentTime);
  } catch {}
  const t = ac.currentTime + 0.06;
  const profile = bps <= 2400 ? 'v22' : bps <= 14400 ? 'v32' : 'v34';

  click(t - 0.04, 0.02, 0.14); // handset picks up
  // 1. dial tone: 350 + 440 Hz
  tone(350, t, 0.5, 0.055);
  tone(440, t, 0.5, 0.055);

  // 2. DTMF for the number this call dialled
  const digits = dialDigits();
  digits.forEach((k, i) => {
    const [a, b] = DTMF[k] || [770, 1336];
    const at = t + 0.58 + i * 0.15;
    tone(a, at, 0.09, 0.09);
    tone(b, at, 0.09, 0.09);
  });

  // 3. ringback: 440 + 480 Hz
  const ring = t + 0.58 + digits.length * 0.15 + 0.2;
  tone(440, ring, 1.1, 0.05);
  tone(480, ring, 1.1, 0.05);

  // 4. answer: click, then the answer tone (2100 Hz ANSam with its warble)
  const ans = ring + 1.15;
  click(ans, 0.02, 0.2);

  if (profile === 'v22') {
    // 2400 baud: short answer tone, quick V.22 training, straight into carrier
    warble(2100, ans + 0.04, 0.7, 0.1, 15, 0.5);
    let p = ans + 0.8;
    sweep(1200, 2400, p, 0.2, 0.06);
    p += 0.24;
    fsk(p, 0.28, 1200, 2400, 600, 0.06);
    p += 0.32;
    noiseBand(p, 0.45, 0.09, 1400, 1.0);
    p += 0.5;
    noiseBand(p, 0.3, 0.05, 1700, 0.6);
    modemEnd = p + 0.25;
    modemPlaying = true;
    scheduleNodeCleanup(ac);
    return;
  }

  if (profile === 'v34') {
    // V.34 line probing: the long alternating "beeee-waaaaah" before training
    warble(2100, ans + 0.04, 1.0, 0.1, 15, 0.55);
    let p = ans + 1.1;
    for (let i = 0; i < 3; i++) {
      sweep(1200, 2600, p, 0.22, 0.05);
      sweep(2600, 1200, p + 0.24, 0.22, 0.05);
      p += 0.5;
    }
    fsk(p, 0.3, 980, 1180, 300, 0.06);
    p += 0.35;
    for (let i = 0; i < 3; i++) sweep(1400, 2500, p + i * 0.2, 0.18, 0.05);
    p += 0.7;
    noiseBand(p, 0.9, 0.12, 1500, 0.7);
    p += 0.95;
    sweep(2400, 1300, p, 0.6, 0.045);
    p += 0.65;
    noiseBand(p, 0.4, 0.06, 1800, 0.5);
    modemEnd = p + 0.4;
    modemPlaying = true;
    scheduleNodeCleanup(ac);
    return;
  }

  // V.32 / V.32bis (9600, 14400)
  warble(2100, ans + 0.04, 1.05, 0.1, 15, 0.55);
  let p = ans + 1.12;
  // 5. V.8 capability exchange: guard tone plus scrambled data
  tone(1800, p, 0.62, 0.03);
  noiseBand(p, 0.62, 0.09, 1200, 1.1);

  // 6. V.21 handshake beeps (980 / 1180 Hz at 300 baud)
  p += 0.66;
  fsk(p, 0.42, 980, 1180, 300, 0.065);

  // 7. phase hits, then the rising training tone
  p += 0.46;
  for (let i = 0; i < 4; i++) click(p + i * 0.1, 0.012, 0.1);
  sweep(1150, 2200, p + 0.06, 0.34, 0.06);

  // 8. the "bleeeglebleeeeg" warble of the training sequence
  p += 0.45;
  for (let i = 0; i < 3; i++) sweep(1500, 2500, p + i * 0.2, 0.18, 0.055);
  sweep(2500, 1500, p + 0.6, 0.2, 0.055);

  // 9. final screech and data hiss, fading into carrier
  p += 0.85;
  noiseBand(p, 0.75, 0.12, 1600, 0.6);
  tone(2400, p, 0.5, 0.04, 'square');
  sweep(2400, 1300, p, 0.75, 0.045);
  p += 0.8;
  noiseBand(p, 0.45, 0.06, 1800, 0.5);

  modemEnd = p + 0.45;
  modemPlaying = true;
  scheduleNodeCleanup(ac);
}

function scheduleNodeCleanup(ac) {
  // let go of finished nodes so reconnects do not pile them up
  setTimeout(() => {
    modemNodes = modemNodes.filter((n) => (n.context ? n.context.currentTime < modemEnd : false));
  }, (modemEnd - ac.currentTime + 1) * 1000);
}

function beep() {
  const ac = ctx();
  if (!ac) return;
  tone(880, ac.currentTime, 0.08, 0.03, 'square');
}

document.getElementById('btnSound').onclick = (e) => {
  wantSound = !wantSound;
  e.currentTarget.classList.toggle('on', wantSound);
  if (wantSound) beep();
  else stopModem();
};

document.getElementById('btnCrt').onclick = (e) => {
  const on = !e.currentTarget.classList.contains('on');
  e.currentTarget.classList.toggle('on', on);
  els.screen.classList.toggle('vignette-off', !on);
};

document.getElementById('btnFull').onclick = () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
  setTimeout(rescale, 300);
};

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) setTimeout(rescale, 200);
});

/* first gesture unlocks audio for browsers that block it; replay the handshake
   from the top so the caller still hears the modem connect */
window.addEventListener(
  'pointerdown',
  async () => {
    const ac = ctx();
    if (!ac) return;
    try {
      await ac.resume();
    } catch {}
    if (soundPending && wantSound) {
      soundPending = false;
      const btn = document.getElementById('btnSound');
      if (btn) btn.classList.remove('pending');
      playModem(modem.bps);
    }
  },
  { once: true }
);
window.addEventListener('keydown', () => ctx(), { once: true });

/* --------------------------------------------------------------- status poll */
async function pollStatus() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      els.nodes.textContent = `${d.online}/${d.maxNodes} NODES`;
      document.title = `${d.name} — terminal`;
    }
  } catch {}
  setTimeout(pollStatus, 15000);
}

/* --------------------------------------------------------------- boot ----- */
async function boot() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      if (Array.isArray(d.dialNumbers) && d.dialNumbers.length) dialNumbers = d.dialNumbers;
      if (Array.isArray(d.modems) && d.modems.length) modemList = d.modems;
    }
  } catch {}
  dialSample(); // start fetching the recording so it is ready when we dial
  connect();
  pollStatus();
}

boot();

/* handy for debugging in the console, and for the smoke tests */
window.__bbs = {
  term,
  connect,
  playModem,
  get dialNumber() {
    return dialNumber;
  },
  get modem() {
    return modem;
  },
  get state() {
    return { connected, wantSound, audio: audioCtx ? audioCtx.state : 'none', dialNumbers };
  },
  // the recorded handshake: what it is doing, for the QC checks
  get sample() {
    const el = sampleEl;
    return el
      ? {
          url: DIAL_SAMPLE_URL,
          ready: el.readyState,
          duration: el.duration,
          paused: el.paused,
          at: el.currentTime,
          volume: el.volume,
          forcedSynth: forceSynth,
        }
      : { url: DIAL_SAMPLE_URL, broken: sampleBroken, forcedSynth: forceSynth };
  },
};
