---
name: run-nfc-attendance-scanner
description: Run, start, build, test, drive, or screenshot the NFC attendance scanner app. Use when asked to launch the scanner, see a change working in the real app, reproduce the enrollment or email-collision flow, or capture screenshots of it.
---

# Run the NFC attendance scanner

A frontend-only React + Vite kiosk app. No backend — enrolled students and
attendance taps live in the browser's IndexedDB (`attendance-scanner-local`).

There is no `chromium-cli` and no Playwright package in this container, so the
driver is committed here: `.claude/skills/run-nfc-attendance-scanner/driver.mjs`.
It speaks CDP to the system Chromium over a **pipe** rather than a TCP port.
Use it to launch, click, type, simulate card scans, read IndexedDB, and take
screenshots.

All paths below are relative to `artifacts/nfc-attendance-scanner/`.
All commands were run in this container and worked.

## Prerequisites

Nothing to install. Chromium is already at `/repl/tools/bin/chromium`; the
driver also accepts `$REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` or `$CHROMIUM_BIN`.

## Start the dev server

`vite.config.ts` **throws** unless both `PORT` and `BASE_PATH` are set.

```bash
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/nfc-attendance-scanner run dev
```

Start it as a persistent background process — a plain `&` from a one-shot shell
gets reaped between commands. Wait for it before driving:

```bash
for i in $(seq 1 25); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/)" = "200" ] \
    && { echo "up"; break; }; sleep 1
done
```

Port 5173 is declared in `.replit`, so the app is also reachable publicly at
`https://$REPLIT_DEV_DOMAIN` — hand that to a human who wants to click it.

## Run (agent path)

End-to-end smoke: enroll a student, collide a second student's derived email,
resolve it, assert the roster. Exits non-zero on failure.

```bash
SHOT_DIR=/tmp/nfc-scanner-shots \
  node .claude/skills/run-nfc-attendance-scanner/driver.mjs smoke
```

Verified output:

```
  ok   email derives live
  ok   conflict dialog names the holder
  ok   rejects an address outside the school domain
  ok   accepts the real address
roster in IndexedDB:
   Jane Smith '27  ->  jsmith27@stjohnschs.org
   Jane Smith '27  ->  janesmith27@stjohnschs.org
  ok   two students, two distinct addresses
SMOKE PASSED
```

For your own flow, import it. `launch()` navigates and returns the handle:

```js
import { launch, SEL } from './.claude/skills/run-nfc-attendance-scanner/driver.mjs';

const app = await launch();               // fresh browser profile => empty roster
await app.setMode('enroll');              // 'enroll' | 'checkin'
await app.scan('04A1B2C3D4E5F6');         // simulates an HID reader
await app.fillEnrollment({ firstName: 'Jane', lastName: 'Smith', gradYear: 2027 });
console.log(await app.value(SEL.email));  // jsmith27@stjohnschs.org
await app.saveEnrollment();
console.log(await app.readRoster());      // reads IndexedDB directly
console.log(await app.shot('my-check'));  // png path
app.close();
```

Also on the handle: `evaluate(expr)`, `waitFor(expr, label, ms)`, `fill(sel, v, i)`,
`click(sel)`, `clickText(label)`, `value(sel)`, `text(sel)`, `exists(sel)`.
`SEL` holds every `data-testid` the app exposes.

**Look at the screenshots.** A blank frame means the app never mounted.

## Run (human path)

Same dev server, then open `https://$REPLIT_DEV_DOMAIN` in a real browser. The
scanner input is hidden and auto-focused, so typing a 14-hex-char UID and
pressing Enter *is* a scan. Useless headless — use the driver instead.

## Test

```bash
pnpm --filter nfc-attendance-scanner test        # vitest, 105 passing
pnpm --filter nfc-attendance-scanner typecheck   # tsc --noEmit
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/nfc-attendance-scanner run build
```

There is **no ESLint config** anywhere in this repo. Don't try to lint.

## Gotchas

- **`pkill -f "<pattern>"` will kill the shell running it** when the pattern
  appears in that shell's own command line. A command starting
  `pkill -f "remote-debugging-port=9222"; chromium ... &` terminates *itself*
  and reports **exit 144** with an empty log — indistinguishable from the
  program you were launching crashing on startup. This cost real debugging
  time and produced a wrong diagnosis. Kill by process name (`killall
  chromium`) or match on something that cannot appear in your own command.
- **CDP over a pipe, by choice.** The driver uses `--remote-debugging-pipe`
  (fds 3/4). `--remote-debugging-port=9222` also works in this container —
  verified — but the pipe needs no free port, no `/json/list` polling, and
  leaves nothing listening if the driver dies.
- **`el.value = x` does nothing** to a React input. React tracks its own value
  on the node. Go through the native setter and dispatch a bubbling `input`
  event; `driver.fill()` already does.
- **A scan is a keystroke burst, not a click.** Fill
  `[data-testid="input-scanner-hidden"]` and dispatch an `Enter` **keydown**.
  The UID must match `^[0-9A-F]{14}$` (`src/lib/scan-format.ts`) or the app
  reports an invalid scan.
- **Scanning is disabled while the enrollment form or session summary is open.**
  `ScannerScreen` sets `captureEnabled` false, so a scan mid-enrollment is a
  silent no-op. Save or cancel first.
- **IndexedDB survives across runs in the same browser profile.** `launch()`
  makes a fresh temp profile each time so the roster starts empty; pass
  `{ profile }` only if you *want* the carry-over, and expect collision
  behavior to change when you do.
- **Chromium floods stderr** with `dbus`/`upower`/`Fontconfig` errors. All
  harmless. Filter with `grep -viE "dbus|upower|Fontconfig"`.
- `vitest.config.ts` includes `src/**/*.test.{ts,tsx}`. `tsconfig.json` excludes
  `**/*.test.ts` but **not** `**/*.test.tsx`, so `.tsx` test files are
  typechecked — keep them type-clean.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `PORT environment variable is required but was not provided.` | Set both `PORT` and `BASE_PATH` on the dev/build command. |
| A command dies instantly with `exit 144` and no output | It probably began with `pkill -f "..."` matching its own command line. Use `killall <name>` instead. |
| `timed out waiting for: app boot` | Dev server isn't up. `curl` returns `000`. Restart it as a persistent background process. |
| Roster isn't empty / a collision fires on the first enrollment | Reused browser profile. Drop `profile` so `launch()` makes a fresh one. |
| `no element for <sel>[n]` | The form isn't open yet. `await app.waitFor(...)` on `SEL.form` after scanning. |
