# Doors: installing, running, writing

## The drop-in folder

Drop a `.zip` into `doors/install/` and either wait for the scanner (every 20 s,
`doors.scanIntervalSec`) or press **Scan install folder** in the console. The scanner:

1. unpacks the archive into `doors/<slug>/` (zip-slip safe, `..` stripped),
2. reads `FILE_ID.DIZ`, then any README/`.NFO`/`.DOC`, for a name and description,
3. finds the runnable thing — `door.js` means a native door, otherwise the first
   `.EXE`/`.BAT` that is not an installer,
4. writes `doors/<slug>/door.json`,
5. moves the zip to `doors/archives/` so it is not installed twice.

Installed doors appear in the menu under their category. The archive's own docs
(`.DOC`, `.NFO`) are not converted — read them in `doors/<slug>/`.

### door.json

```json
{
  "id": "lord",
  "name": "Legend of the Red Dragon",
  "author": "Somebody",
  "description": "Fight monsters, buy a sword, die anyway.",
  "category": "RPG",
  "type": "dos",
  "exec": "LORD.EXE",
  "args": [],
  "dropType": "DOOR.SYS",
  "cmd": "",
  "minLevel": 10,
  "enabled": true
}
```

- `type`: `native` (javascript), `dos` (needs an emulator), `external` (anything that
  speaks on stdin/stdout).
- `dropType`: `DOOR.SYS`, `DORINFO1.DAT`, `CHAIN.TXT` or `CALLINFO.BBS` — written into
  the door's directory before launch, filled from the caller's account and time left.
- `cmd`: runner command template, with `{dir}`, `{exec}`, `{dropfile}`, `{node}`,
  `{port}` substitutions. If empty and `doors.dosboxPath` is set, the default is
  `dosbox -noconsole -c "mount c {dir}" -c "c:" -c "{exec}"`.

All fields except `id` and `type` are editable in the console.

## Native doors (recommended)

A native door is a Node module that draws on the caller's terminal. Drop it in as
`door.js` inside the zip, or put it in `src/doors/native/<name>.js` to ship it with the
board. The complete API is in [DOOR_API.md](DOOR_API.md); the short version:

```js
module.exports = {
  id: 'my-door', name: 'MY DOOR', author: 'me', category: 'Arcade', minLevel: 10,
  description: 'What it is.',
  async run(term, ctx) {
    term.cls();
    term.print(2, 3, 'HELLO ' + term.user.handle, 15);
    await term.pause();
    ctx.db.data.doors['my-door'] = { played: Date.now() };
    ctx.save();
  },
};
```

Native doors run in-process, honour the caller's time limit, save through the same
JSON database, and need no DOSBox, FOSSIL driver or drop file.

## DOS doors

Old `.EXE` doors talk to a modem over a COM port through a FOSSIL driver. Three ways to
run them, in order of effort:

1. **DOSBox-X with a serial bridge.** `dosbox-x -c "mount c {dir}" -c "c:" -c "LORD.EXE"`
   with `serial1=tcp:127.0.0.1:2444` in its config, and a FOSSIL driver inside the DOS
   image talking to that socket. Set `cmd` to the dosbox-x invocation. The door's stdio
   is piped to the caller's terminal, so anything the emulator prints shows up on the
   BBS. This is the only path that gets real 16-bit doors on the board.
2. **A shim you write.** Anything that reads stdin and writes stdout works: set
   `type: "external"` and a `cmd`. Drop files are generated for you either way.
3. **Not at all.** The console still installs, catalogues and shows the door, and asks
   you to configure a runner. That is deliberate: a half-configured DOS door is worse
   than an honest error.

Time limits are enforced: the runner kills the child when the caller's remaining minutes
run out or the carrier drops.

## DOS doors under DOSBox

`src/doors/dosbox.js` runs an installed DOS door for real: each call gets a scratch
copy of the door directory (so per-node data files cannot collide), a drop file in the
directory the game runs from, and a generated `dosbox.conf` whose `serial1` is a
`nullmodem` waiting on a port. Once DOSBox is listening, that socket is spliced onto
the caller's terminal, so the game talks to the caller through COM1 exactly as it
would through a FOSSIL driver. Set `doors.dosboxPath` (or install DOSBox-X / DOSBox
0.74 in a standard location and it is found automatically).

DOSBox's own chatter goes to `doors/tmp/<run>/dosbox.log` rather than the caller's
screen.

**One-time setup is still yours.** Most DOS doors ship without a configuration file
and have to be told which port and speed to use. For Legend of the Red Dragon that
means running `LORDCFG.EXE` once in the door directory: `(S)etup Nodes`, set
GBBSTYPE to `QBBS`, drop-file path `C:\BBS`, and **`(B) Use direct screen writes?
: No`** — with direct writes on, the game paints DOSBox's own screen and the caller
sees nothing. The config lands in `NODE1.DAT`, a plain text file, so it can also be
edited by hand.

LORD also refuses to be started as `LORD.EXE`: it demands `START.BAT <node>`. The
manifest therefore points at `legord/START.BAT`, and the runner appends the node
number for batch entry points. Its drop file is `DORINFO1.DEF` (the QuickBBS
format), written to `C:\BBS` inside the per-call directory.

Verified here: archive extracts, installs, appears on the menu, LORDCFG writes a
working `NODE1.DAT`, and DOSBox boots the game to its title screen ("Legend Of the
Red Dragon — Node 1", 59:34 on the clock).

**FOSSIL first.** `BNU 1.70` (`BNU.COM`, `BNU.SYS`, docs) sits in `legord/`, the
runner loads it with `BNU /F` before the game, and `NODE1.DAT` reads `FOSSIL`,
`COMPORT 1`, `NODIRECT`, `BBSDROP C:\BBS`. LORD on its own still paints DOSBox's
own screen and sends nothing down COM1 — a FOSSIL only carries the serial
channel, not screen output — which is why the screen scraper below exists.

**It runs.** The chain that finally works, end to end, for a caller on the web
terminal or plain telnet:

```
DOSBox-X  serial1=nullmodem (the board listens, DOSBox dials out)
BNU /F    FOSSIL driver, resident
DOORWAY SYSF /V:D /P:COMMAND.COM /C START.BAT <node>
```

with the game in local mode (`COM0` / baud `0` in `DORINFO1.DEF`) and a `DOOR.SYS`
beside it for Doorway to read. Doorway scrapes the game's screen and sends ANSI
down the FOSSIL; the board answers its terminal-identification queries
(`ESC[6n` → `ESC[1;1R`, `ESC[c` → `ESC[?1;0c`) because xterm and telnet clients
are inconsistent about it.

Three things cost the most time and are worth remembering:

1. **LORD refuses to start as `LORD.EXE`** — it demands `START.BAT <node>`.
2. **Doorway cannot exec a `.BAT`.** It printed its banner, then "RETURNING TO
   HOST" and never ran the door; wrapping the batch in `COMMAND.COM /C` fixed it.
3. **DOSBox's nullmodem dials out**, whatever `server:` suggests. The board has
   to *listen* on the port and accept DOSBox's connection; the opposite
   arrangement produced six sync bytes and silence.

Verified: `Legend Of The Red Dragon — Compiled 5/24/99: VERSION 4.02a`,
`REGISTERED, Thanks to eXo!`, the warrior menu, and the join prompt, over both
transports.

**Doorway is shareware.** Unregistered it caps each caller at ten minutes and
prints `Registered to: [UNREGISTERED COPY!]` to them. That is the timer callers
see. Registering Doorway (PC Micro) removes both, and `doors/dosbox.js` needs no
change when you do.

## Troubleshooting

- Door not in the menu: check `enabled`, and the caller's level versus `minLevel`.
- "This door is missing its door.js": the zip had no `door.js` but was detected as
  native (usually a stray empty file). Reinstall or set `type` and `exec` by hand.
- "This game started but sent nothing to COM1": the door is running but has not been
  configured for serial I/O — run its setup program once (see above).
- A zip installs as one zero-byte file instead of a directory: that was a bug in the
  ZIP reader, fixed — directory entries now create directories.
- Garbage on screen from a DOS door: the program is writing CP437 through a pipe; the
  terminal expects UTF-8. The serial bridge writes raw bytes instead, which the web
  terminal renders as CP437.
- The scanner ignores a zip: only files ending `.zip` with a `PK` header are considered;
  `.rar`/`.7z`/`.arj` must be converted first.
