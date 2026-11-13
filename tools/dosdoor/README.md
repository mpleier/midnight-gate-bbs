# SCRAPE.COM — the board's own screen redirector

A DOS door game writes to the screen. A caller is on the other end of a serial
line. Something has to carry one to the other, and for a game that paints the
screen directly (which is most of them after about 1992) a FOSSIL driver cannot
do it.

The classic answer is **Doorway**, which is shareware: unregistered it gives each
caller ten minutes and prints an unregistered banner at them. This is our
replacement — 5 KB of our own assembly, MIT licensed with the rest of the repo.

## What it does

`SCRAPE.COM` stays resident and takes three things over:

* **Screen** — every timer tick it compares the 80×25 VGA text buffer against a
  shadow copy and sends only the cells that changed, positioned with ANSI
  cursor moves. Because it reads the buffer rather than hooking the program's
  output calls, it does not matter whether the door prints through BIOS, through
  DOS, or writes straight into video memory.
* **Keyboard** — serial bytes are handed to the door through `INT 16h` and the
  `INT 21h` character functions, which is what door games poll.
* **Serial line** — it programs the 16550 UART at `0x3F8` itself and never goes
  near a FOSSIL driver. That is deliberate: BNU reports `0 ports active` until it
  sees carrier, and blocks every transmit until then, which hangs the caller on
  a blank screen. Doorway's `/FC` switch exists to work around exactly that.

## Usage

```
SCRAPE.COM
START.BAT 1
```

The runner (`src/doors/dosbox.js`) copies `src/doors/dos/scrape.com` into the
door's scratch directory and adds the line for you, so a dropped-in DOS door gets
it automatically. A door that is *already* serial-aware gains nothing from it and
can be run as-is.

## Building

```
npm run build:door-shim
```

Needs NASM (`winget install NASM.NASM`). The assembled binary is committed, so
installing NASM is only necessary when editing `scrape.asm`.

## Limits worth knowing

* 80×25 colour text only. A game that switches to a graphics mode will show the
  caller nothing.
* The shadow is 4,000 bytes, so a door that switches to 43/50 line mode still
  gets the top 25 rows.
* Redraws are sent as changed spans, so a full screen costs roughly 2 KB — fine
  over Telnet, unhurried over a 14.4k modem, which is the point.
* Extended keys (arrows, function keys) arrive as their ANSI escape sequences;
  simple menus that only want letters, Enter and Escape work correctly.
