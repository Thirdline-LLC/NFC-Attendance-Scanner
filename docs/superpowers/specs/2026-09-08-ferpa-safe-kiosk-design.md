# Making the attendance kiosk FERPA-safe

**Date:** 2026-09-08 · **Status:** design approved in chat; implementation not started ·
**Owner:** Asher Mills

## Why

The kiosk holds minors' names, school email addresses, graduation years, card UIDs and a
per-meeting attendance history, and it is about to be run at St. John's College High School by
a **student at the desk**. Three regimes were researched on 2026-09-08 to find out which bind it
and what bar to build to. The findings, in one line each (sources and reasoning in the M-Brain
note *Student privacy law for the attendance kiosk 2026-09-08*):

| Regime | Binds this app? | Why |
|---|---|---|
| COPPA, 16 CFR 312 (amended 2025, compliance due 2026-04-22) | **No** | Covers *commercial* online services collecting from children **under 13**; St. John's is grades 9–12; nothing is transmitted (FTC FAQ F.5: interacting with data stored on the device and never transmitted is not "collection"); there is no online service |
| FERPA, 34 CFR 99 | **Probably not directly — unconfirmed** | Binds institutions receiving funds under ED-administered programs; private K-12 schools generally do not, and Title I *equitable services* through DCPS do not count. Only the school can confirm. Most private schools adopt FERPA as policy anyway |
| D.C. Protecting Students Digital Privacy Act, D.C. Code § 38-831.01 ff | **No** | "Educational institution" means a DC public school or public charter |

So no statute compels a change. The design still builds to a FERPA-style bar, because that is
what the school will hold it to and because the amended COPPA rule's two new duties — a written
retention policy with **no indefinite retention** (§ 312.10) and a written security program
(§ 312.8) — are the two things the app currently could not answer for. With no vendor, no
server and no account, every FERPA duty collapses to three questions:

1. **Who can see the roster at the kiosk?** Today `/roster`, `/dashboard`, Edit, Remove and
   *Export all history* are one tap from the scanner. A student in the queue is not a school
   official.
2. **Where do exports go?** The `.xlsx` carries the full 14-hex card UID — a building
   credential — beside every name and email, and the native share sheet can send it to any app.
3. **How long does data live?** Forever. `clearAllAttendanceHistory()` exists and nothing calls
   it; graduated students stay on the roster with their card UIDs.

## Decisions taken (2026-09-08, in chat)

| Question | Decision |
|---|---|
| Who is at the kiosk? | **A student runs the desk.** The teacher is the records owner |
| What stays open to the desk? | **Check-in taps and counts; enrolling new students.** Everything else is teacher-only |
| How does the teacher unlock? | **A PIN**, 4–8 digits, hashed in the `settings` table. A screen gate, not encryption; **no recovery** |
| Retention | **Teacher-triggered purge**, two actions with preview counts; nothing deletes on its own; a written one-school-year schedule |
| Card UID in the export | **Masked tail only** (`••••1F90`), the same rule as on screen |
| Record of disclosures and deletions | **Yes** — a PIN-gated activity log holding counts, timestamps and filenames, never student data |
| Lock architecture | **Route-level gate** on `/roster` and `/dashboard`, plus the End Session overlay |
| Branching | **One branch per work package**, merged in order |

## What is out of scope, and recorded here so it is not forgotten

- **Android's `INTERNET` permission.** Capacitor's default; removing it would make "no network"
  an OS guarantee rather than a CSP one, but whether the WebView still loads `https://localhost`
  without it has to be tried on a device. Not touched here.
- **Which is the system of record — this app's export or the OneDrive workbook.** Open in the
  vault; the retention schedule below assumes the exports are the retained record.
- **Repo ownership** (a private repo on a personal account) — no student data is in the repo;
  the concern is custody of the code, not of records.
- **Confirming with the school whether FERPA binds it**, and agreeing who owns the records and
  where exports may be sent. A `_queue` item for Asher.
- **Kiosk-mode / Guided Access setup per platform.** Documentation pointer only.
- **Encryption at rest.** IndexedDB is readable by anyone with the device's OS account on every
  platform. The docs say so; FileVault / Android file-based encryption are the device's job.

---

## 1. The lock

### Roles

- **Desk** — the default, whoever is at the device. The scanner screen: check-in taps, the
  count, `First L.` feedback, and Enroll (the operator types a peer's name and year and sees that
  one peer's derived email while doing it).
- **Teacher** — after the PIN. The End Session overlay (totals, *Export this session*, *Start
  New Session*), `/roster` and `/dashboard`, and everything inside them: edit, remove, the
  attendance target, retention, the activity log, *Export all history*, and changing the PIN.

### `src/data/operator-pin.ts`

Plain functions over the existing `settings` table (`{ key, value: string }`, values are JSON).

```ts
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
export function isValidPin(pin: string): boolean;          // digits only, 4–8 long
export async function hasOperatorPin(): Promise<boolean>;
export async function setOperatorPin(pin: string): Promise<void>;
  // First run only. Throws OperatorPinExistsError if one is already set, so the desk can
  // never replace the teacher's PIN by "setting" a new one.
export async function changeOperatorPin(current: string, next: string): Promise<PinVerification>;
  // Verifies `current` through verifyOperatorPin; writes `next` only on 'ok'.
export async function verifyOperatorPin(pin: string, now?: Date): Promise<PinVerification>;

export type PinVerification =
  | { status: 'ok' }
  | { status: 'unset' }
  | { status: 'wrong'; failures: number; lockedUntil: string | null }
  | { status: 'locked'; lockedUntil: string };
```

- **Storage.** `operator-pin` = `{ v: 1, algorithm: 'PBKDF2-SHA-256', iterations: 100000, salt, hash }`
  (salt 16 random bytes, hash 32 bytes, both base64). `operator-pin-attempts` =
  `{ failures, lockedUntil }`. Web Crypto (`crypto.subtle`) is available in every shell —
  `app://attendance` is registered `secure: true`, `https://localhost` and the hosted PWA are
  secure contexts — and in the jsdom test environment (verified 2026-09-08 with a probe test).
- **Compare** the full derived hash to the stored one without early exit.
- **Lockout.** After 5 consecutive failures, `lockedUntil = now + 30 s × 2^(failures−5)`, capped at
  5 minutes. While locked, `verify` returns `'locked'` without deriving anything. `'ok'` clears
  the counter. `now` is injectable for tests.
- The PIN itself is never logged, never stored in plain text, never in an activity row.

### `src/lock/OperatorLockProvider.tsx`

```ts
type OperatorLock = { unlocked: boolean; unlock(): void; relock(): void };
export function OperatorLockProvider({ children }): JSX.Element;
export function useOperatorLock(): OperatorLock;
```

In-memory only; a reload is locked. Mounted inside `AppRouter`'s `BrowserRouter`, around
`Routes`. Relocks on:

- **navigation to `/`** — a small `RelockOnScanner` effect component inside the router;
- **the End Session overlay closing** — the scanner calls `relock()` from `onDismiss` and after
  `startNewSession` resolves;
- **5 minutes idle** — `pointerdown` and `keydown` on `window` reset a timer while unlocked
  (`IDLE_RELOCK_MS = 300_000`);
- **reload.**

### `src/lock/PinDialog.tsx`

One modal, using the existing `useModalFocusTrap`; Escape and *Cancel* call `onCancel`.

```ts
type PinDialogProps =
  | { mode: 'gate'; onUnlocked(): void; onCancel(): void }
  | { mode: 'change'; onChanged(): void; onCancel(): void };
```

- `gate` reads `hasOperatorPin()` on mount: **no PIN** → *Set a teacher PIN* (enter twice, with
  the no-recovery warning) and records `pin-set`; **PIN exists** → *Enter the teacher PIN*. Either
  success calls `onUnlocked()`.
- `change` asks for the current PIN and the new one twice; records `pin-changed`.
- Input: `<input type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off">`;
  Enter submits; the submit button is disabled until the field is a valid PIN.
- While reading settings: *Checking this device…*; a read failure shows *This device isn't
  letting the app read its settings.* with a Retry.
- Test ids: `dialog-pin`, `input-pin`, `input-pin-confirm`, `input-pin-current`,
  `button-pin-submit`, `button-pin-cancel`, `text-pin-error`, `text-pin-status`.

### `src/lock/LockedRoute.tsx`

```tsx
<Route path="/roster" element={<LockedRoute><RosterPage /></LockedRoute>} />
```

Unlocked → renders children. Locked → a minimal `<main data-testid="locked-page">` shell with the
`PinDialog mode="gate"`; **the page component does not mount**, so no roster or history read
happens before the unlock. `onUnlocked` → `unlock()`; `onCancel` → `navigate('/')`.

### Scanner changes (`ScannerScreen.tsx`)

- `End Session`: `unlocked ? endSession() : setPinOpen(true)`. On `onUnlocked`: `unlock()`,
  close the dialog, `endSession()`.
- While the PIN dialog is open, `captureEnabled` is false — the same rule as the enrollment form,
  the summary and the new-session confirmation — so a card tapped at the desk cannot type
  fourteen characters into the PIN field. Scans are dropped, not queued.
- `onDismiss` of the summary and the completion of `startNewSession` call `relock()`.
- The *Students* and *Dashboard* header links gain a lock glyph (`lucide-react` `Lock`) while
  locked and an `aria-label` ending *(teacher PIN required)*. They stay visible: the teacher has
  to be able to find them, and a hidden link would still be a typeable URL in the PWA.

### Copy

| Where | Text |
|---|---|
| Set title | **Set a teacher PIN** |
| Set helper | 4 to 8 digits. Only the teacher should know it — it opens the roster, the dashboard and exports. There is no way to recover a forgotten PIN: write it down somewhere safe. |
| Unlock title | **Enter the teacher PIN** |
| Change title | **Change the teacher PIN** |
| Wrong | That PIN is not right. |
| Locked | Too many tries — wait {n} seconds. |
| Mismatch | The PINs do not match. |
| Storage | This device isn't letting the app read its settings. |

### Stated limits (these go in the docs verbatim in spirit)

A PIN is a **screen gate against whoever is at the desk**. It is not encryption: IndexedDB stays
readable to anyone with the device's OS account and a developer console. There is **no
recovery**: a forgotten PIN means clearing the app's data, which loses everything not yet
exported — one more reason the export-every-session rule matters.

---

## 2. Retention

### Dashboard — *Data retention* section (`section-retention`)

Two actions. Each reads its cost from the store as soon as the section renders, and the
confirmation dialog states that cost, that it cannot be undone, and to *Export all history* first
if the numbers have already been reported — the `RemoveStudentDialog` pattern, extracted so both
dialogs share it.

1. **Delete attendance before {Aug 1, YYYY}** — the date is `schoolYearStart(now)` from
   `attendance-metrics`, formatted with `formatSessionDateLabel`. Deletes every tap with
   `scannedAt < schoolYearStart`, the `'legacy'` session included, and the same rows in the legacy
   `scans` table. The roster is untouched. Preview: *N taps across M sessions*. Disabled with
   *Nothing older than this school year* when N is 0.
2. **Remove graduated students** — every roster entry whose grade derives to `Alumni` at `now`,
   and every tap that resolves to them by id or by card, exactly as `deletePerson` does today.
   Preview: *S students, T taps*. Disabled with *No graduated students on this device* when S is 0.

### Store additions (`attendance-store.ts`)

```ts
export async function previewHistoryPurge(before: string): Promise<{ tapCount; sessionCount }>;
export async function purgeHistoryBefore(before: string): Promise<{ tapCount; sessionCount }>;
export async function previewAlumniRemoval(isAlumni: (p: Person) => boolean): Promise<{ studentCount; tapCount }>;
export async function removeAlumni(isAlumni: (p: Person) => boolean): Promise<{ studentCount; tapCount }>;
```

The alumni test is a predicate handed in by the container —
`(p) => deriveGrade(p.gradYear, now) === 'Alumni'` — so the store stays free of grade logic and
of `attendance-export.ts`, which would drag the Capacitor delivery layer into the data module.
Both removals run in one `'rw'` transaction over `persons`, `taps` (and `scans`), so a failure
part-way leaves either everything or nothing. `clearAllAttendanceHistory` is unchanged and still
uncalled.

### The written schedule (`docs/data-protection.md`)

Taps are kept for the **current school year only**. At the start of each school year the
teacher runs *Export all history*, confirms the file opens, then runs both retention actions.
Graduated students come off the roster after commencement. The exported workbooks are the
retained record and fall under the school's own records policy; the app keeps nothing longer
than a year plus the summer.

---

## 3. Export and the activity log

### The export

- The `Card UID` column becomes **`Card (last 4)`**, value `maskCardUid(tap.uid)` → `••••1F90`.
  One rule everywhere: a card UID is never fully rendered, on screen or in a file. Unknown-card
  rows stay findable by the same tail the roster search uses.
- Consequence, written in the docs: an export can no longer be used to re-enrol cards by hand on a
  replacement device. There was never an import; a replacement device is rebuilt by tapping cards.
- `buildAttendanceWorkbook(taps, persons, now, activity?)` gains an optional fourth argument. When
  given, a second sheet **`Activity`** (columns *When*, *Action*, *Detail*) follows *Attendance*.
  Only *Export all history* passes it; the session export stays one sheet.
- Every export success notice adds one sentence: **Send this file only to a school account.**
- Filenames are unchanged.

### Dexie v6 — `activity`

```ts
database.version(6).stores({
  scans: 'uid, scannedAt',
  persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
  taps: '++id, uid, scannedAt, personId, sessionId',
  settings: 'key',
  activity: '++id, at, kind',
});

export type ActivityKind =
  | 'export-session' | 'export-all'
  | 'remove-student' | 'purge-history' | 'remove-alumni'
  | 'pin-set' | 'pin-changed';

export type ActivityEntry = {
  id?: number;
  at: string;                 // ISO timestamp
  kind: ActivityKind;
  filename?: string;          // exports
  delivery?: ExportDelivery;  // exports: 'download' | 'file' | 'saved'
  taps?: number;              // exports, removals, purges
  sessions?: number;          // exports (1 for a session export), removals, purges
  students?: number;          // remove-alumni
};

export const ACTIVITY_LOG_CAP = 500;
export async function recordActivity(entry: Omit<ActivityEntry, 'id'>): Promise<void>;
  // Adds the row, then trims the oldest rows beyond the cap, in one transaction.
export async function listActivity(limit = 50): Promise<ActivityEntry[]>;  // newest first
```

**A row never carries a name, an email or a UID.** `remove-student` records the tap and session
counts only.

### Who writes what

| Action | Caller | Row |
|---|---|---|
| Export this session | `ScannerScreen` after `exportAttendanceWorkbook` resolves | `export-session` — filename, delivery, taps, sessions: 1 |
| Export all history | `DashboardPage.exportAll` | `export-all` — filename, delivery, taps, sessions |
| Remove a student | `RosterPage.confirmRemoval` | `remove-student` — taps, sessions |
| Delete attendance before… | retention container | `purge-history` — taps, sessions |
| Remove graduated students | retention container | `remove-alumni` — students, taps |
| Set / change PIN | `PinDialog` | `pin-set` / `pin-changed` |

A cancelled export writes nothing. A failed log write **never fails the action** — the action's
success notice gains *The activity log entry could not be written.* so it is not silent.

### Dashboard — *Activity* section (`section-activity`)

The last 50 rows, newest first, in plain words:

| Kind | Wording |
|---|---|
| `export-session` | Exported this session — *{filename}*, {saved to {uri} / saved to Documents / handed to the browser} |
| `export-all` | Exported all history ({taps} taps) — *{filename}*, … |
| `remove-student` | Removed a student and {taps} taps from {sessions} sessions |
| `purge-history` | Deleted {taps} taps from {sessions} sessions before {date} |
| `remove-alumni` | Removed {students} graduated students and {taps} taps |
| `pin-set` / `pin-changed` | Teacher PIN set / changed |

---

## 4. Documentation, testing, delivery

### Docs

- `docs/data-protection.md` — the applicability table above; the two roles; what the PIN is and
  is not; the retention schedule; the export's contents (masked tail, second sheet); the activity
  log; the destination rule ("a school account, never a personal one"); no recovery.
- `docs/operating-the-kiosk.md` — a *For the teacher* section: setting the PIN on day one, what
  it unlocks, that the desk never needs it; End Session now asks for it.
- `docs/data-and-backup.md` — the v6 row in the schema table; `activity` in the tables list; the
  PIN rows in `settings`; "a forgotten PIN is not recoverable" under *What erases it*.
- `replit.md` — three lines under *Architecture decisions*: the roles and the gate; masked UID in
  the export; the activity log holds no student data.

### Testing (TDD, per unit, jsdom unless noted)

| Suite | Covers |
|---|---|
| `src/data/operator-pin.test.ts` | valid/invalid PIN; set then verify ok/wrong; `unset`; set twice throws; change requires current; lockout after 5, doubling, cap, clears on success; `now` injected |
| `src/data/attendance-store.test.ts` (+ `.migrations.test.ts`) | v5 → v6 upgrade keeps every row; `recordActivity` / `listActivity` order and cap; `purgeHistoryBefore` boundary (< not ≤), legacy and `scans` rows, roster untouched; `removeAlumni` by id and by card; both atomic on a forced failure |
| `src/lock/PinDialog.test.tsx` | set mode (twice, mismatch, no-recovery text, records `pin-set`); unlock mode (ok, wrong, locked countdown); change mode; Escape/Cancel; storage failure + retry |
| `src/lock/LockedRoute.test.tsx` / `AppRouter.test.tsx` | locked route shows the dialog and does not mount the page; unlock renders it; cancel returns to `/`; navigating to `/` relocks; idle timer relocks (fake timers) |
| `src/scanner/ScannerScreen.test.tsx` | End Session gated; unlock opens the summary; taps ignored while the dialog is up; summary dismiss relocks; export records `export-session`; notice carries the school-account sentence |
| `src/dashboard/DashboardPage.test.tsx` | retention previews, disabled states, confirm → store call → activity row; export-all passes activity and records `export-all`; Activity list wording; log-write failure shows the sentence without failing the action |
| `src/roster/RosterPage.test.tsx` | removal records `remove-student` with counts only |
| `src/lib/attendance-export.test.ts` | `Card (last 4)` header and masked value; unknown-card rows; `Activity` sheet only when passed |

Every branch: `pnpm --filter @workspace/nfc-attendance-scanner run typecheck` and `run test`
green; `run test:browser` where Chromium is available. Total today: 446 tests in 28 files.

### Work packages, in merge order

| # | Branch | Contents | Why this order |
|---|---|---|---|
| 1 | `export/masked-uid-and-activity` | Dexie v6, `recordActivity`/`listActivity`, masked column, `Activity` sheet, dashboard Activity section, logging in the existing export and remove paths, the school-account sentence | Everything later logs to this table |
| 2 | `lock/operator-pin` | PIN module, provider, dialog, `LockedRoute`, scanner gate, header glyph, *Change PIN* on the dashboard | Gates what 1 and 3 expose |
| 3 | `retention/purge` | Store functions, shared confirm dialog, *Data retention* section | Logs to 1, gated by 2 |
| 4 | `docs/data-protection` | The four documents above, and the memory/skill notes if any wording changed on screen | Written last so it describes what shipped |

Each branch is cut from the current `main` after the previous one merges. Merge is
`git merge --no-ff` on `main`; there is no remote PR flow for this repo. **Note the standing
finding in the vault's `_queue`: a local commit reached `origin/main` on 2026-09-08 with no push
run — treat nothing on this Mac as local-only until that is explained.**

## Open questions for the school (not blocking the build)

1. Does St. John's consider itself bound by FERPA, and who owns club and class attendance
   records — the club moderator, the registrar, or the school?
2. Which account may an export be sent to? The design assumes the teacher's school OneDrive and
   says so on every export notice.
3. Is a one-school-year retention of taps, with alumni removed after commencement, acceptable —
   or does the school want the device to keep less?
