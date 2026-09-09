# NFC Attendance Scanner

A frontend-only kiosk screen for recording HID NFC attendance scans locally in
the browser.

**This app is no longer Replit-specific.** It now builds for three targets —
an installable PWA, an Android APK and a macOS `.dmg` — from one source tree,
and develops on any machine with Node and pnpm. `README.md` at the repository
root is the entry point; `docs/vscode-setup.md` is the full guide.

## Run & Operate

`vite.config.ts` no longer requires `PORT` or `BASE_PATH`. It defaults to port
5173 and derives the asset base from `BUILD_TARGET`, while still honouring both
variables when they are set — so the Replit runner's `PORT=23205 BASE_PATH=/`
environment continues to work unchanged.

On Replit the runner still serves the scanner on port 23205; check with
`curl -s -o /dev/null -w '%{http_code}\n' http://localhost:23205/` before
starting anything.

- `pnpm --filter @workspace/nfc-attendance-scanner run test` — vitest (509 tests in 34 files)
- `pnpm --filter @workspace/nfc-attendance-scanner run test:browser` — real Chromium
- `pnpm --filter @workspace/nfc-attendance-scanner run typecheck` — the app *and* `electron/`
- `pnpm --filter @workspace/nfc-attendance-scanner run build` — the PWA
- `pnpm --filter @workspace/nfc-attendance-scanner run build:native` — the Capacitor bundle
- `pnpm --filter @workspace/nfc-attendance-scanner run build:electron` — the macOS renderer + main + preload
- `pnpm --filter @workspace/nfc-attendance-scanner run dev` — localhost:5173, or 23205 on Replit

The scanner has no backend, accounts, analytics, API routes, or database server. Scan records are stored in the browser with Dexie/IndexedDB. The only credential is a local teacher PIN (`src/data/operator-pin.ts`), a screen gate for the admin screens.

## Stack

- pnpm workspaces, TypeScript, React 18, Vite
- Tailwind CSS, react-router-dom, Dexie.js
- vite-plugin-pwa (web target only), Capacitor 8 (Android), Electron 44 +
  electron-builder (macOS)

## Where things live

- `artifacts/nfc-attendance-scanner/src/scanner/` — scanner input and session behavior
- `artifacts/nfc-attendance-scanner/src/data/` — Dexie/IndexedDB persistence
- `artifacts/nfc-attendance-scanner/src/ui/` — feedback and status presentation
- `artifacts/nfc-attendance-scanner/src/app/` — router (`/`, `/roster`, `/dashboard`)
- `artifacts/nfc-attendance-scanner/src/platform/` — which shell we are in
  (`runtime.ts`) and the desktop bridge contract (`desktop-bridge.ts`)
- `artifacts/nfc-attendance-scanner/src/pwa/` — service-worker registration,
  which refuses to run outside a production web build
- `artifacts/nfc-attendance-scanner/src/lock/` — the teacher PIN gate:
  `OperatorLockProvider` (one in-memory unlock, relocked on idle and on the
  way back to `/`), `PinDialog` (set / unlock / change, deaf to a card
  reader), `LockedRoute`, and `pin-entry.ts` (digits only, Enter honoured only
  after a human pause)
- `artifacts/nfc-attendance-scanner/src/data/operator-pin.ts` — the PIN
  itself: PBKDF2 in the `settings` table, a doubling lockout after five misses
- `artifacts/nfc-attendance-scanner/src/lib/activity-wording.ts` — the one
  place an activity-log row becomes words, for the dashboard and the export
- `artifacts/nfc-attendance-scanner/src/ui/RetentionDialog.tsx` — the
  confirmation for the two retention actions
- `artifacts/nfc-attendance-scanner/electron/` — the macOS main process,
  preload, input validation, and the build and dev scripts
- `artifacts/nfc-attendance-scanner/src/roster/` — the roster page container
- `artifacts/nfc-attendance-scanner/src/dashboard/` — the dashboard page container
- `artifacts/nfc-attendance-scanner/src/lib/scan-format.ts` — UID normalization, validation and on-screen masking
- `artifacts/nfc-attendance-scanner/src/lib/tap-identity.ts` — resolving a tap to a student
- `artifacts/nfc-attendance-scanner/src/lib/attendance-metrics.ts` — year-to-date and per-session figures
- `artifacts/nfc-attendance-scanner/src/lib/attendance-export.ts` — the `.xlsx`
  export: row shape and workbook (`buildAttendanceWorkbook`) kept apart from
  handing it to the browser (`exportAttendanceWorkbook`)

## Architecture decisions

- **Attendance history is retained across sessions.** `startNewSession` only
  rotates the session id (in localStorage) and clears the on-screen view; every
  tap stays in IndexedDB under the session id it was recorded with, which is
  what makes per-session and year-to-date figures possible. The only thing that
  deletes taps is `clearAllAttendanceHistory()`, and nothing in the UI calls it.
- **A tap resolves to a student by person id, falling back to card UID**
  (`src/lib/tap-identity.ts`). A tap stores the `personId` known at scan time,
  which is `null` for a card nobody had enrolled yet; enrolling that card later
  credits its earlier taps retroactively. The dashboard therefore recomputes
  attendance from the roster as it stands *now* rather than trusting the
  `counted` flag frozen at scan time.
- **Two different storage failures, two different states.** `storageStatus` is
  `'checking' | 'ready' | 'unavailable' | 'save-failed'`: a store that never
  opened versus one write that did not land. `'unavailable'` blocks enroll-mode
  scans (details would have nowhere to land) and survives a session rotation;
  `'save-failed'` belongs to the session that hit it and clears with it. There
  is deliberately no silent localStorage fallback — a kiosk that quietly stops
  persisting is worse than one that says so.
- **Base path is set per build target.** `vite.config.ts` reads `BUILD_TARGET`
  (`web`, `capacitor` or `electron`) and derives the base from it, defaulting
  `PORT` to 5173. The web build uses `/`; `build:native` and `build:electron`
  use `./` so the Capacitor bundle resolves assets relative to
  `capacitor://localhost`. `routerBasename` in `AppRouter.tsx` turns a
  non-absolute `BASE_URL` into an empty basename — trimming `./` would hand
  react-router `.`, which matches no location and renders a blank app.
- **Two exports, two scopes.** The scanner's End Session export covers the
  session on screen, which is what a meeting wants. Everything ever recorded —
  rotated-away sessions, and the taps the v3 upgrade stamped `'legacy'` — is
  reachable only from the dashboard's "Export all history", because the
  scanner's `taps` come from `listSessionTapRecords(sessionId)` and no session
  id will ever equal `'legacy'`. The `.xlsx` is the system of record, so some
  route to the whole history has to exist. In a browser that export is a Blob
  behind a synthetic `<a download>` click, which reports nothing back — whether
  a Capacitor WebView does anything at all with that click is untested and is
  the first thing `docs/capacitor-native.md` asks you to check on a device.
- **A card UID is hardware identity: never editable, never fully rendered.**
  One helper, `maskCardUid` in `src/lib/scan-format.ts`, produces the `••••` +
  last-4 string everywhere a card is named on screen. The roster search box is
  the one field a whole UID can be typed into — tapping a card with it focused
  types all fourteen characters, one at a time — so a card run is cut to four
  there, the longest fragment the rows already print, and the tail searches
  identically. Hex letters are only a-f, so the rule cannot be "cut every run
  of five": that turned "Rebecca" into "RECCA" and lost her. A run is card
  input if it carries a digit, if it is longer than any English word inside
  [a-f], or if it extends a run already cut — that last is what holds the
  ceiling at four once a reader has started typing.
- **The export carries the card's last four, not the UID.** Same helper,
  same rule, in the file: a UID opens a building, the workbook is the one
  artefact that routinely leaves the device, and nothing reads an export back
  in, so the full value served no purpose the tail does not.
- **Two roles, one PIN.** A student runs the desk (check-in, enroll —
  including correcting an enrolled card's details when that card is on the
  reader, because the card is the credential). End Session, `/roster` and
  `/dashboard` sit behind a teacher PIN: PBKDF2 in `settings`, a doubling
  lockout, one in-memory unlock that ends on the way back to `/`, when the
  summary closes, after five idle minutes and on reload. A screen gate, not
  encryption, and not recoverable — the docs say both. Until a PIN exists the
  scanner shows a banner: whoever sets it first owns the records.
- **The activity log holds no student data.** Every export, removal, purge
  and PIN change is a row of counts, a timestamp and a filename in the `activity`
  table (v6), so the log can be read and exported without being a disclosure.
  A failed log write never fails its action; the notice says the row is missing.
- **Retention is a teacher's action, never a schedule.** Two dashboard
  buttons — delete taps before the school-year boundary (Eastern calendar
  date against August 1, the dashboard's own rule), remove graduated students
  with their taps — each previewed, confirmed with its cost, logged, and
  followed by a reload. The store takes predicates so it stays free of date
  and grade logic.

## Product

A single-device kiosk for taking attendance with a USB HID NFC reader, which
types a 14-hex-char card UID and presses Enter into a hidden, always-focused
input. Three routes:

- `/` — the scanner, open to whoever is at the desk. Check-in mode records a tap against the current session
  (repeat taps show as duplicates and do not raise the count; an unknown card
  is recorded and flagged for later enrollment). Enroll mode opens a form for
  the scanned card, deriving a `@stjohnschs.org` address from the name and
  class year and resolving collisions. "End Session" shows the session totals
  and exports that session's `.xlsx`, and can be backed out of ("Back to
  scanning", or Escape) without rotating anything; starting a new session asks
  for confirmation first.
- `/roster` — behind the teacher PIN. Every student on the device: search by name, email or the last
  four of a card, and correct a name, class year or email in place. The card a
  student enrolled with stays theirs. Cards are not recorded while this page is
  open, and it says so.
- `/dashboard` — behind the teacher PIN, with the same warning that cards are not being recorded here. Year to
  date (the school year rolls over Aug 1): average
  attendance against the 50-per-session target, sessions held, unique students,
  grade breakdown, and the cards that still resolve to nobody — those last
  figures are all-time, not year-to-date, and say so on the card. Its "Export
  all history" button writes every tap on the device to one workbook, with the
  activity log as a second sheet. Three teacher cards below: Activity (the
  log, newest first), Data retention (delete taps before the school year;
  remove graduated students — previewed, confirmed, logged), and Teacher PIN
  (change it).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Architecture decisions (packaging)

- **One app, three shells, no copies.** `src/` is shared verbatim. The only
  place the targets diverge is `src/lib/workbook-delivery.ts`, which picks a
  browser download, a Capacitor file write, or the desktop Save dialog.
- **The service worker is a web-only feature.** `shouldRegisterServiceWorker`
  requires a production *web* build AND a runtime that is neither a Capacitor
  WebView nor the Electron shell. Both runtime checks are redundant with the
  build target on purpose: a mistyped `BUILD_TARGET` must not put a
  second, independently-updated copy of the app in front of assets that already
  ship inside an APK.
- **The desktop renderer is served over `app://attendance`, not `file://`.**
  A `file://` origin is opaque and Chromium treats its storage as
  untrustworthy; everything here lives in IndexedDB. That origin, the
  `org.stjohnschs.attendance` bundle id and the `SJC Attendance` userData
  directory are permanent identity — changing any of them orphans every
  installed machine's records.
- **The renderer never names a filesystem path.** It hands the main process
  bytes and a suggested filename; the operator picks the destination in the
  system Save dialog, and the main process confirms the written size before
  reporting success. Cancelling that dialog is reported as a cancellation, not
  a failure.

## Gotchas

- **`PORT` and `BASE_PATH` are optional now.** They used to be required and
  `vite.config.ts` threw without them; it now defaults to 5173 and derives the
  base from `BUILD_TARGET`. Setting them still works.
- **`pnpm run <anything>` fails if `allowBuilds:` in `pnpm-workspace.yaml` is
  incomplete.** pnpm 11 makes an un-approved install script an error, and the
  dependency-status check runs before every script. That file had placeholder
  `set this to true or false` values, which is what made a fresh checkout
  unusable.
- **Run `native:sync` after every `src/` change** before a Gradle build. Gradle
  has no idea the web assets moved.
- **The Replit runner already serves this app on 23205.** Never start a second
  dev server for the package, and never `pkill -f vite` — it kills every
  session's server in the container.
- **`.tsx` test files are typechecked.** `tsconfig.json` excludes `**/*.test.ts`
  but not `**/*.test.tsx`, so keep component tests type-clean.
- **Scanner tests must render inside a router.** The scanner header links to
  `/roster` and `/dashboard`, so `ScannerScreen` needs a `MemoryRouter`.
- **Scans are ignored while a modal is up.** The enrollment form, the session
  summary, the new-session confirmation and the PIN dialog all set
  `captureEnabled` false, and the hook drops scans while a summary is open.
  Save or cancel first. On a locked `/roster` or `/dashboard` the reader types
  into the PIN field instead, which is why that field keeps digits only, stops
  at eight, and ignores an Enter that arrives within 100 ms of the last key.
- **Fake only `Date`, never the timers, in a test that touches the store.**
  `vi.useFakeTimers()` fakes `setTimeout`/`setImmediate`, and fake-indexeddb
  schedules its own work on them, so every Dexie call stalls until the test
  times out. `vi.useFakeTimers({ toFake: ['Date'] })` plus `vi.setSystemTime`
  is the tool when only the clock matters (see `PinDialog.test.tsx`).
- **Scanner and router tests pass the PIN gate.** `renderScanner` wraps the
  screen in `OperatorLockProvider`, every `beforeEach` seeds a PIN with
  `setOperatorPin('2468')`, and `passGate(user)` types it after End Session
  or a locked route; a test about the gate itself seeds nothing.
- **Dashboard tests must seed taps relative to `Date.now()`**, or they fall
  outside the current school year once the Aug 1 rollover passes.
- **The `scans` table is legacy.** Nothing writes it any more; it exists so
  databases upgraded from v1/v2 still have their rows purged by
  `clearAllAttendanceHistory`. Leave the Dexie version blocks alone — old
  databases upgrade through them.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- `docs/operating-the-kiosk.md` — the front-desk instructions: enrolling,
  checking in, what each message means, exporting, and what to do when
  something looks wrong. Written for a volunteer, not a developer; keep it in
  step with the copy on screen when that copy changes.
- `docs/capacitor-native.md` — packaging this app for iOS/Android and keeping
  IndexedDB data alive there. The `ios/` and `android/` projects are generated
  by Capacitor and **committed**, name and icons already set; a Mac session
  should only need `build:native` → `cap sync` → `cap open`.
- `artifacts/nfc-attendance-scanner/branding/` — `mark.svg`, the source of the
  native app icon and splash screens, and `generate-icons.sh`, which renders
  every size into both platform asset catalogues with ImageMagick.
