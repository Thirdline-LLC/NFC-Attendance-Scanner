# NFC Attendance Scanner

A frontend-only kiosk screen for recording HID NFC attendance scans locally in the browser.

## Run & Operate

The Replit runner already serves the scanner on port 23205; check with
`curl -s -o /dev/null -w '%{http_code}\n' http://localhost:23205/` before
starting anything. `vite.config.ts` throws unless both `PORT` and `BASE_PATH`
are set — including for `build`.

- `pnpm --filter @workspace/nfc-attendance-scanner run test` — vitest
- `pnpm --filter @workspace/nfc-attendance-scanner run typecheck` — tsc --noEmit
- `PORT=23205 BASE_PATH=/ pnpm --filter @workspace/nfc-attendance-scanner run build` — production build
- `pnpm --filter @workspace/nfc-attendance-scanner run build:native` — the Capacitor bundle (sets both itself)
- `PORT=23205 BASE_PATH=/ pnpm --filter @workspace/nfc-attendance-scanner run dev` — only if 23205 is down

The scanner has no backend, authentication, analytics, API routes, or database server. Scan records are stored in the browser with Dexie/IndexedDB.

## Stack

- pnpm workspaces, TypeScript, React 18, Vite
- Tailwind CSS, react-router-dom, Dexie.js

## Where things live

- `artifacts/nfc-attendance-scanner/src/scanner/` — scanner input and session behavior
- `artifacts/nfc-attendance-scanner/src/data/` — Dexie/IndexedDB persistence
- `artifacts/nfc-attendance-scanner/src/ui/` — feedback and status presentation
- `artifacts/nfc-attendance-scanner/src/app/` — router (`/`, `/roster`, `/dashboard`)
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
- **Base path is set per build target.** `vite.config.ts` throws unless `PORT`
  and `BASE_PATH` are both set. The web build uses `/`; `build:native` uses
  `./` so the Capacitor bundle resolves assets relative to
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

## Product

A single-device kiosk for taking attendance with a USB HID NFC reader, which
types a 14-hex-char card UID and presses Enter into a hidden, always-focused
input. Three routes:

- `/` — the scanner. Check-in mode records a tap against the current session
  (repeat taps show as duplicates and do not raise the count; an unknown card
  is recorded and flagged for later enrollment). Enroll mode opens a form for
  the scanned card, deriving a `@stjohnschs.org` address from the name and
  class year and resolving collisions. "End Session" shows the session totals
  and exports that session's `.xlsx`, and can be backed out of ("Back to
  scanning", or Escape) without rotating anything; starting a new session asks
  for confirmation first.
- `/roster` — every student on the device: search by name, email or the last
  four of a card, and correct a name, class year or email in place. The card a
  student enrolled with stays theirs. Cards are not recorded while this page is
  open, and it says so.
- `/dashboard` — same warning that cards are not being recorded here. Year to
  date (the school year rolls over Aug 1): average
  attendance against the 50-per-session target, sessions held, unique students,
  grade breakdown, and the cards that still resolve to nobody — those last
  figures are all-time, not year-to-date, and say so on the card. Its "Export
  all history" button writes every tap on the device to one workbook.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **`PORT` and `BASE_PATH` are required for `build` too**, not just `dev` —
  `vite.config.ts` throws without them.
- **The Replit runner already serves this app on 23205.** Never start a second
  dev server for the package, and never `pkill -f vite` — it kills every
  session's server in the container.
- **`.tsx` test files are typechecked.** `tsconfig.json` excludes `**/*.test.ts`
  but not `**/*.test.tsx`, so keep component tests type-clean.
- **Scanner tests must render inside a router.** The scanner header links to
  `/roster` and `/dashboard`, so `ScannerScreen` needs a `MemoryRouter`.
- **Scans are ignored while a modal is up.** The enrollment form, the session
  summary and the new-session confirmation all set `captureEnabled` false, and
  the hook drops scans while a summary is open. Save or cancel first.
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
