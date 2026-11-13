# Door authoring API

Native doors are plain CommonJS modules. Put one at `src/doors/native/<slug>.js`
(built-in, ships with the board) or inside an installed archive as `door.js`
(drop the zip in `doors/install/` and it installs itself).

```js
module.exports = {
  id: 'dragon-keep',              // stable id
  name: "DRAGON'S KEEP",          // shown in the door menu
  author: 'Gate Software',
  category: 'RPG',                // RPG | Strategy | Casino | Trivia | Arcade | Utility | Other
  description: 'One line for the door info screen.',
  minLevel: 10,
  async run(term, ctx) { /* ... */ }
};
```

`run()` may `throw` only `AbortInput`/`Hangup` (i.e. let term.readLine throw);
return cleanly when the player quits. The manager redraws and returns to the menu.

## term — the caller's terminal

All rows/cols are 1-based. Output is ANSI; `\n` is translated to CRLF for you.

| call | behaviour |
|---|---|
| `term.cols`, `term.rows` | screen size (80x25 by default) |
| `term.cls()` | clear screen + home cursor |
| `term.write(str)` | write text, ANSI SGR allowed (`\x1b[0;32m`) |
| `term.writeRaw(str)` | write bytes with no newline translation (for cursor control) |
| `term.art(bufferOrString)` | write CP437 ANSI art (decodes bytes) |
| `term.print(row, col, text, fg?, bg?)` | positioned write; fg/bg 0-15 |
| `term.center(row, text, fg?, bg?)` | horizontally centred |
| `term.right(row, text, fg?, bg?)` | right aligned |
| `term.color(fg, bg?)`, `term.reset()` | SGR |
| `term.gotoxy(row, col)` | cursor move |
| `term.box(x, y, w, h, {fg, double})` | box drawing |
| `term.hrule(row, ch, fg)` | horizontal rule |
| `term.wrap(text, width)` | word wrap → array of lines |
| `term.beep()` | BEL |
| `await term.readLine({prompt, max, upper, mask, allowEmpty, min, defaultVal})` | echo line input; ESC throws `AbortInput`, carrier loss throws `Hangup` |
| `await term.readKey({timeoutMs})` | one key: `'ENTER'`, `'ESC'`, `'UP'`, `'SPACE'`, a letter, or null on timeout |
| `await term.getkeySame` | (use readKey) |
| `await term.pause('Press any key')` | wait for a key |
| `await term.yesno('Question', true)` | Y/N prompt → boolean |
| `await term.menu({prompt, valid, allowEmpty})` | one validated char, uppercased |

## ctx

| field | meaning |
|---|---|
| `ctx.db.data` | the whole JSON database (users, messages, ...). Door state convention: `ctx.db.data.doors[did]` |
| `ctx.save()` | persist the DB (call after any state change) |
| `ctx.user` | the caller record (`handle`, `credits`, `timeBank`, `level`, ...) |
| `ctx.config` | config accessor: `ctx.config.get('bbs.name')` |
| `ctx.door` | this door's manifest |

## Rules of the house

- Stay inside 80x25. Never write past column 80; pad, do not overflow.
- Everything must be keyboard driven and abandonable with ESC.
- Save after every meaningful action so a carrier drop loses nothing.
- No network, no child processes, no external npm packages.
- Keep the ANSI style: colours 9-15 for highlights, `─` `═` `│` `█` `░` for furniture.
- Show the caller's handle and a short status line on each screen.
