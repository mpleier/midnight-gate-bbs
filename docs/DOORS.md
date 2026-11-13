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

## Troubleshooting

- Door not in the menu: check `enabled`, and the caller's level versus `minLevel`.
- "This door is missing its door.js": the zip had no `door.js` but was detected as
  native (usually a stray empty file). Reinstall or set `type` and `exec` by hand.
- Garbage on screen from a DOS door: the program is writing CP437 through a pipe; the
  terminal expects UTF-8. Native doors avoid this entirely.
- The scanner ignores a zip: only files ending `.zip` with a `PK` header are considered;
  `.rar`/`.7z`/`.arj` must be converted first.
