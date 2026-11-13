# Audio credits

**`dialup.mp3`** — the dial-up handshake heard when a web caller connects.

- Source: “Dial Up Internet - Sound Effect (HD)”, Gaming Sound FX —
  https://www.youtube.com/watch?v=QDS4B0mM-ew (uploaded April 2019).
- The channel describes its uploads as sound effects sourced from the internet
  and offers no licence, so treat this clip as **unlicensed third-party
  material**: fine to keep on a private board, worth replacing before you publish
  one.
- Processed with ffmpeg: trailing silence trimmed, loudness normalised to
  −16 LUFS, mono, 22.05 kHz, 64 kbps — 11.5 s, 92 KB.

## Replacing it

Drop any file at `public/audio/dialup.mp3` (12 s is about right — the dial-in
sequence runs 11–12 s). Nothing else needs changing: the web terminal plays the
recording when it loads and falls back to the synthesised handshake when the
file is missing or cannot be decoded.

To hear the synth instead, open the terminal with `?synth=1`.

## The synthesised fallback

`public/terminal.js` still contains an oscillator-based V.32bis handshake: dial
tone (350 + 440 Hz), DTMF for whichever number the call dialled, ringback
(440 + 480 Hz), a 2100 Hz answer tone, V.8 warble, V.21 beeps and a training
sweep, all band-limited to 300–3400 Hz. It needs no assets, so a fresh clone
sounds like a modem out of the box.
