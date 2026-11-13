# The dial-up sound

`dialup.mp3` is **rendered by this repo**, not sampled from a recording:
`tools/make-dialup-audio.js` synthesises the handshake stage by stage and writes
a 22.05 kHz mono wav, then an mp3 if ffmpeg is present. Nothing third-party is
shipped, so there is no licence question over the audio.

```
npm run audio                              # 867-5309, 33.6k negotiation
node tools/make-dialup-audio.js --number 5550113 --bps 14400
node tools/check-dialup-audio.js           # measures each stage with a Goertzel filter
```

## What each part is

The order comes from what the sounds actually do, not from an impression of
them — the phone network carries 300–3400 Hz because that is where speech lives,
so every modem signal has to fit in that band (and is therefore audible).

| Time | Sound | Meaning |
| --- | --- | --- |
| 0.0 s | click | handset off the hook |
| 0.1–3.3 s | 350 + 440 Hz | dial tone: the line is live, dial away |
| 3.3–4.4 s | pairs of tones | DTMF for the number dialled (`8` = 852 + 1336 Hz, `9` = 852 + 1477 Hz) |
| 4.5–5.6 s | 440 + 480 Hz | ringback: their line is ringing |
| 5.8–6.6 s | 2100 Hz, warbling at 15 Hz | answer tone (ANSam): their modem picked up |
| 6.7–7.2 s | short warbles at 1100/1650/2100 Hz | V.8 exchange: "what speeds and features do you have?" |
| 7.3–7.7 s | 980/1180 Hz alternating, 300 baud | V.21: the low-speed channel that agrees the details |
| 7.8–8.7 s | phase clicks, rising sweep, warble | line probe and training: measuring the line for echo and noise |
| 9.5–11.4 s | band-limited hiss | carrier: data, and the reason you got kicked off when someone picked up the phone |

The training stage is the one that decides the speed: the noisier the line, the
lower the constellation it can carry, which is why people could hear whether a
call would come up at 33.6k or crawl in at 14.4k.

Sources for the anatomy: [What the dial-up sound was actually
saying](https://www.youtube.com/watch?v=raik_i8VFvo) (Mixed Signals), [Why did
dialup modems make
noise?](https://superuser.com/questions/477358/why-dialup-modems-make-noise) on
Super User, and the ELI5 thread [Why did dialup modems make sound in the
90s?](https://www.reddit.com/r/explainlikeimfive/comments/1dcwa4d/).

## Using a real recording instead

Drop any file at `public/audio/dialup.mp3` (about 12 s suits the dial-in
sequence). Nothing else changes: the web terminal plays whatever is there and
falls back to the oscillator handshake in `public/terminal.js` when the file is
missing or cannot be decoded. `?synth=1` forces the synth so the two can be
compared.

The wav is a build artifact and is not committed; `npm run audio` regenerates it.
