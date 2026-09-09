---
name: run-nfc-attendance-scanner
description: Run, start, build, test, drive, or screenshot the NFC attendance scanner app. Use when asked to launch the scanner, see a change working in the real app, reproduce the enrollment or email-collision flow, or capture screenshots of it.
---

# Run the NFC attendance scanner

A frontend-only React + Vite kiosk app. No backend — enrolled students and
attendance taps live in the browser's IndexedDB (`attendance-scanner-local`).
Three routes, all client-side: `/` (scanner), `/roster` (manage students),
`/dashboard` (year-to-date figures).

There is no `chromium-cli` and no Playwright package in this container, so the
driver is committed here: `.claude/skills/run-nfc-attendance-scanner/driver.mjs`.
It speaks CDP to the system Chromium over a **pipe** rather than a TCP port.
Use it to launch, click, type, simulate card scans, read IndexedDB, and take
screenshots.

All paths below are relative to `artifacts/nfc-attendance-scanner/`.
All commands were run in this container and worked.

## Prerequisites

**On Replit:** nothing to install — Chromium is at `/repl/tools/bin/chromium`,
and the driver also accepts `$REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` or
`$CHROMIUM_BIN`.

**On a local checkout or a Codespace:** none of those paths exist. Point the
driver at a browser with `$CHROMIUM_BIN`, or install Playwright's:

```bash
pnpm exec playwright install chromium
```

`vitest.browser.config.ts` uses Playwright's own Chromium by default and takes
`$CHROMIUM_PATH` as an override. Its old default was `/repl/tools/bin/chromium`,
which made `run test:browser` unrunnable off Replit.

## Which dev server to drive

**On Replit**, the artifact runner already serves this app on **port 23205**
(`.replit-artifact`: `localPort = 23205`, `PORT = "23205"`). Check before
starting anything:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:23205/   # 200 => use it
```

If it answers 200, drive that one. **Do not start a second dev server for this
package** — see the duplicate-server gotcha below. The runner's server is what
`https://$REPLIT_DEV_DOMAIN` proxies, so that URL is what you hand to a human
who wants to click it.

**Anywhere else** there is no runner and nothing on 23205. Just start one:

```bash
pnpm --filter @workspace/nfc-attendance-scanner run dev     # localhost:5173
```

`vite.config.ts` no longer requires `PORT` or `BASE_PATH`; it defaults to 5173
and derives the asset base from `BUILD_TARGET`. Both variables still work:

```bash
PORT=23205 BASE_PATH=/ pnpm --filter @workspace/nfc-attendance-scanner run dev
```

The driver defaults to `http://localhost:23205/` — set `APP_URL` when you are
running on 5173:

```bash
APP_URL=http://localhost:5173/ node .claude/skills/run-nfc-attendance-scanner/driver.mjs smoke
```

Start it as a persistent background process — a plain `&` from a one-shot shell
gets reaped between commands. Wait for it before driving:

```bash
for i in $(seq 1 25); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:23205/)" = "200" ] \
    && { echo "up"; break; }; sleep 1
done
```

`Port 23205 is already in use` means the runner's server is up after all — stop
yours and use theirs. The driver defaults to `http://localhost:23205/`; point it
elsewhere with `APP_URL`.

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
await app.goto(SEL.linkRoster, SEL.rosterPage);  // follow an in-app link
console.log(await app.shot('my-check'));  // png path
app.close();
```

Also on the handle: `evaluate(expr)`, `waitFor(expr, label, ms)`, `fill(sel, v, i)`,
`click(sel)`, `clickText(label)`, `value(sel)`, `text(sel)`, `exists(sel)`,
`goto(linkSel, arrivedSel, label)`, `cmd(method, params)` (raw CDP — e.g.
`Emulation.setDeviceMetricsOverride` to check phone width).
`SEL` holds every `data-testid` the driver needs.

**Routing is client-side, but a direct navigate works.** The dev server falls
back to `index.html` for any path — `curl -o /dev/null -w '%{http_code}'`
returns 200 with the app's HTML for `/`, `/roster`, `/dashboard` and even
`/nope` — so `Page.navigate('http://localhost:23205/roster')` does land on the
roster. Prefer `goto`, which clicks the in-app `<Link>`: it exercises the
router the way an operator does and skips a full reload.

### Testids by screen

| Screen | Testids |
|---|---|
| Scanner `/` | `scanner-station`, `header-scanner`, `card-scanner-reader`, `input-scanner-hidden`, `text-attendance-count`, `status-scan-feedback`, `text-scan-status`, `text-last-uid`, `text-scanner-focus`, `button-end-session`, `button-reset-session` (DEV only), `panel-storage-unavailable`, `button-retry-storage`, `text-storage-checking`, `text-storage-footer`, `link-roster`, `link-dashboard` |
| Enrollment form | `form-enrollment`, `input-email`, `button-regenerate-email`, `text-email-collision`, `button-use-suggested-email`, `dialog-email-conflict`, `input-conflict-email`, `button-conflict-save`, `button-conflict-suggested`, `button-conflict-dismiss` |
| Session rotation | `dialog-session-summary`, `button-summary-export`, `button-summary-new-session`, `button-summary-dismiss`, `dialog-new-session`, `text-new-session-counts`, `button-dialog-export`, `button-dialog-confirm`, `button-dialog-cancel` |
| Roster `/roster` | `roster-page`, `header-roster`, `text-scans-paused`, `link-scanner-resume`, `link-scanner`, `link-dashboard`, `roster-manager`, `input-roster-search`, `button-roster-clear`, `text-roster-count`, `text-roster-empty`, `text-roster-no-match`, `table-roster`, `row-person-<id>`, `text-card-tail-<id>`, `button-edit-person-<id>`, `row-editor-<id>`, `text-roster-loading`, `text-roster-load-error`, `button-roster-retry`, `text-roster-save-error` |
| Dashboard `/dashboard` | `dashboard-page`, `header-dashboard`, `text-scans-paused`, `link-scanner-resume`, `link-scanner`, `link-roster`, `dashboard`, `text-average-attendance`, `text-attendance-target`, `text-percent-of-target`, `text-sessions-count`, `text-unique-students`, `text-enrolled-students`, `list-grade-breakdown`, `row-grade-<grade>`, `text-unidentified-taps`, `text-unidentified-cards`, `list-unidentified-cards`, `text-no-sessions`, `text-local-only`, `button-refresh-dashboard`, `button-export-history`, `text-dashboard-loading`, `text-dashboard-load-error`, `button-dashboard-retry`, `text-dashboard-stale` |

**Look at the screenshots.** A blank frame means the app never mounted.

## Run (human path)

Same dev server, then open `https://$REPLIT_DEV_DOMAIN` in a real browser. The
scanner input is hidden and auto-focused, so typing a 14-hex-char UID and
pressing Enter *is* a scan. Useless headless — use the driver instead.

## Test

```bash
pnpm --filter @workspace/nfc-attendance-scanner run test          # vitest, 443 passing in 28 files
pnpm --filter @workspace/nfc-attendance-scanner run test:browser  # real Chromium, 4 files
pnpm --filter @workspace/nfc-attendance-scanner run typecheck     # the app AND electron/
pnpm --filter @workspace/nfc-attendance-scanner run build           # PWA  -> dist/public
pnpm --filter @workspace/nfc-attendance-scanner run build:native    # APK bundle
pnpm --filter @workspace/nfc-attendance-scanner run build:electron  # macOS renderer + main + preload
```

`run test` covers `electron/**/*.test.ts` too — the main process's input
validation lives in `electron/validation.ts`, which imports no Electron
precisely so it can be unit-tested here.

There is **no ESLint config** anywhere in this repo. Don't try to lint.

## Gotchas

- **On Replit, never run a second dev server for this package.** The artifact
  runner owns one on 23205. (Off Replit this does not apply — there is no
  runner, and starting your own on 5173 is the normal thing to do.) A second one (the old version of this skill said 5173) competes
  with it, and tearing yours down — session teardown, or any broad
  `pkill -f vite` — kills the runner's too. What the user then sees is the red
  *"Your NFC Attendance Scanner artifact crashed"* panel ending in:

  ```
   ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  ... dev: `vite --config vite.config.ts --host 0.0.0.0`
  Command failed with signal "SIGTERM"
  ```

  That is **not a crash**. Vite reached `ready` and printed no error; `SIGTERM`
  means something outside killed it, and pnpm reports any non-zero child exit
  that way. Nothing is wrong with the app — restart the artifact. Confirm by
  running `pnpm run build`, `pnpm run typecheck` and `pnpm run test`; all three
  pass on a healthy tree.
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
- **The header chip says whether a scan would be read.** `text-scanner-focus`
  has three states: `SCANNER ACTIVE` when the hidden input has focus,
  `SCANNER PAUSED — TAP TO RESUME` when a press took it away, and
  `SCANNER OFF — FINISH ENROLLING` / `SCANNER OFF — CLOSE THIS DIALOG` while
  capture is deliberately disabled (a form or an overlay is open). A press
  anywhere that is not itself a control hands focus back in the paused state
  only — with capture off there is nothing to tap, which is why the chip stops
  saying "tap to resume". `innerText` comes back upper-cased (CSS), so match
  case-insensitively.
- **The session summary is not a trap.** `button-summary-dismiss` ("Back to
  scanning") and Escape both close it and rotate nothing; only
  `button-summary-new-session` → the confirmation dialog rotates the session.
- **Scanning is disabled while the enrollment form, the session summary or the
  new-session confirmation is open.** `ScannerScreen` sets `captureEnabled`
  false and the hook drops scans while a summary is up, so a scan mid-dialog is
  a silent no-op. Save, cancel or confirm first.
- **Scanning is also dead on `/roster` and `/dashboard`**, for a different
  reason: `ScannerScreen` and its hidden input are unmounted with the route, so
  the reader's keystrokes go to whatever has focus — usually nothing. Both
  pages carry a `text-scans-paused` notice saying so. A driver script that
  scans while on either page will see the tap count stay put; navigate back to
  `/` first.
- **A new session does not delete anything.** `End Session` -> `Start New
  Session` -> confirm only rotates the session id; the previous session's taps
  stay in IndexedDB, which is what the dashboard counts. Read them with
  `indexedDB.open('attendance-scanner-local')` -> `taps`.
- **Enroll-mode scans record no tap.** They open the form only. To make a
  session appear on the dashboard, check a card in.
- **A card enrolled after its taps counts retroactively**
  (`src/lib/tap-identity.ts`), so the dashboard's "unidentified taps" drops to
  zero once the unknown card is enrolled — the stored `counted` flag is not
  what it reads.
- **IndexedDB survives across runs in the same browser profile.** `launch()`
  makes a fresh temp profile each time so the roster starts empty; pass
  `{ profile }` only if you *want* the carry-over, and expect collision
  behavior to change when you do.
- **Three export routes, not one.** `src/lib/workbook-delivery.ts` picks
  between a browser download, a Capacitor file write, and the Electron Save
  dialog, in that last-to-first order of specificity. In the desktop app a
  cancelled dialog throws `ExportCancelledError`, which both call sites render
  as "Export cancelled" rather than as a failure.
- **The export writes a real file under vitest.** `XLSX.writeFile` picks its
  branch from the environment: in Node it is `fs.writeFileSync`, so a test that
  calls `exportAttendanceWorkbook` for real drops an `attendance-*.xlsx` into
  the package root. Stub it — `attendance-export.test.ts` mocks only that one
  export via `vi.mock('xlsx', importOriginal)`. In a browser the same call
  makes a Blob and clicks a synthetic `<a download>`; whether a Capacitor
  WebView does anything with that click is unproven, see
  `docs/capacitor-native.md`.
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
| Preview shows *artifact crashed* with `SIGTERM` after Vite says `ready` | Not a crash — something killed the runner's server, usually a duplicate dev server being torn down. Restart the artifact. |
| `Port 23205 is already in use` | The runner's server is up. Don't start your own; drive `http://localhost:23205/`. |
| `timed out waiting for: app boot` | Dev server isn't up. `curl` returns `000`. Restart it as a persistent background process. |
| Roster isn't empty / a collision fires on the first enrollment | Reused browser profile. Drop `profile` so `launch()` makes a fresh one. |
| `no element for <sel>[n]` | The form isn't open yet. `await app.waitFor(...)` on `SEL.form` after scanning. |

## The teacher PIN

Since branch `lock/operator-pin` (2026-09-08), **End Session, `/roster` and
`/dashboard` sit behind a PIN dialog** (`SEL.pinDialog` in the driver). On a
fresh database the dialog is the *set* form — `SEL.pinInput` and
`SEL.pinConfirm`, 4–8 digits, then `SEL.pinSubmit`; afterwards it is the
*unlock* form with `SEL.pinInput` alone. Click `SEL.pinSubmit` rather than
sending Enter: the field ignores an Enter that arrives within 100 ms of the
previous keystroke, which is how it tells a person from the card reader.

The `smoke` flow in `driver.mjs` only enrolls two cards and reads IndexedDB,
so it never meets the gate. A flow that ends a session or opens the roster
has to pass it first.
