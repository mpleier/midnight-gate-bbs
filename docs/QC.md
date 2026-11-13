# Quality control — the state of the board

`npm run test:qc` boots a throwaway instance on ports 8097/2397 and drives it over
telnet with a scripted caller. It is deliberately end-to-end: nothing is stubbed,
every assertion reads bytes the server actually sent.

```
35/35 checks passed
```

Companion suites: `npm test` (30 checks: boot, HTTP, admin API, telnet login,
posting, doors, installer) and `npm run test:doors` (9 doors, 80x25 audit).

## What the walk covers

| Area | Checks |
| --- | --- |
| Dial-in | carrier banner, handle/password prompts, welcome, main menu |
| Every menu command | M F D W U L B V T R N Y S E ? each reach their screen |
| Bad input | an unknown key beeps instead of throwing; ESC inside a prompt cancels the screen |
| Messages | post on board 1, confirmation, counter moves |
| Files | `/dl` refuses `../` traversal |
| Chat | a line reaches the room and echoes back |
| Doors | a door launches, draws, and can be left cleanly |
| Limits | 400-character input survives; the 5th caller gets "all nodes are busy" |
| Hangup | G prints a goodbye and drops the carrier |
| Registration | a brand-new caller completes the questionnaire and lands at the menu |
| Private mail | SysOp mails the new caller; it shows as waiting, and in the inbox |
| Voting | a ballot is recorded |
| Security | repeated bad admin logins are throttled (429) |

## Defects found and fixed

1. **ESC hung up the call.** Every prompt built on `readLine()` threw
   `AbortInput`, which `mainMenu()` re-threw, so the session ended with
   `+++ CARRIER LOST +++` — pressing ESC in the rumors box, the file-number
   prompt or the settings question dropped the caller. The main menu now catches
   `AbortInput`, prints a newline and redraws; only `Hangup` propagates. Login
   still aborts the call, which is where ESC should mean "never mind".
   *Verified in telnet and in the browser: ESC in the oneliner prompt returns to
   the menu with the carrier up.*

2. **Five table headers sat two columns right of their data.** The headers were
   written as single strings padded for a column-1 origin, then printed at
   column 3, so `#`, `From`, `Subject`, `Date`, `Board`, `Msgs`, `New`, `Area`
   and `Files` all landed off-column (the mail header was the worst: `Subject`
   floated above the middle of the subject text). Headers are now printed at the
   same columns as the rows they label — message bases, board message list,
   private mail, file areas, file list. Checked by reading the xterm buffer and
   comparing `indexOf` per column, not by eye.

3. **The admin login had no brute-force protection.** Ten wrong passwords were
   ten ordinary 401s. Five consecutive failures now lock that address out for
   five minutes (`429` with `Retry-After`), a good login clears the counter, and
   `X-Forwarded-For` is only honoured when `network.trustProxy` is set — trusting
   it unconditionally would let anyone dodge the lockout by inventing a header.
   The admin cookie also gains `Secure` when the socket is TLS.

## Checked and found sound

- **Auth on the admin API** — all eleven `/api/admin/*` endpoints return 401
  unauthenticated.
- **Path traversal** — `/../server.js`, `/%2e%2e/server.js`, `/admin/../../` and
  `/dl/../../config.json` all 404.
- **XSS** — a message posted with `<script>alert(1)</script>` and an
  `<img onerror>` payload renders as literal text in the admin console and never
  executes there or on the landing page (`window.__xss` stays undefined).
- **Node accounting** — five sockets against `maxNodes: 4` produce
  "All nodes are busy" + NO CARRIER, and the counter returns to zero after the
  sockets are destroyed; no leaked nodes.
- **Admin console** — all nine tabs render with no console errors and no raw
  escape codes.
- **Doors** — every door stays inside 80x25 and exits cleanly; the door menu,
  game screens and "returning to the BBS" handoff all work over telnet.

## Notes for future testing

- A door's intro is paged and its own exits are `Q` (ESC backs up one level), so
  a harness needs several keys — up to a dozen — before it sees the door menu
  again. That is behaviour, not a bug; the door header says so on screen.
- Raw telnet output is a stream of cursor moves, so counting spaces in it says
  nothing about layout. Judge alignment from a screen model (the xterm buffer in
  the browser, or `test/doors.js`'s 25x80 shadow grid), never from the stream.
- `npm run test:qc`'s lockout check runs last on purpose: it locks the loopback
  address for five minutes.
