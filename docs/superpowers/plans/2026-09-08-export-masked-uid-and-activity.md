# Export masked UID + activity log — implementation plan (branch 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `.xlsx` export stops carrying the full card UID, and every export and removal leaves a row in a new on-device activity log that never holds student data.

**Architecture:** Dexie schema v6 adds an `activity` table beside the existing four; two store functions (`recordActivity`, `listActivity`) own it. One pure module (`activity-wording.ts`) turns a row into words for both the dashboard list and a second `Activity` sheet that only *Export all history* writes. The three containers that already export or remove (`ScannerScreen`, `DashboardPage`, `RosterPage`) call `recordActivity` after their action succeeds; a failed log write never fails the action and is said out loud in the notice.

**Tech Stack:** React 18/19, TypeScript, Dexie 4 (IndexedDB), SheetJS (`xlsx`), vitest + jsdom + fake-indexeddb + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-08-ferpa-safe-kiosk-design.md`, section 3 ("Export and the activity log") and the *Who writes what* table.

## Global Constraints

- Run everything from `artifacts/nfc-attendance-scanner/`; the workspace is **pnpm only** (root `preinstall` rejects npm/yarn).
- Tests: `pnpm exec vitest run --config vitest.config.ts <file>`; whole suite `pnpm run test`; types `pnpm run typecheck` (checks `src/` **and** `electron/`, and `.test.tsx` files are typechecked).
- **Leave the existing Dexie `version(1)`…`version(5)` blocks untouched** — old databases upgrade through them. Add `version(6)` only.
- An activity row **never** carries a name, an email or a UID. Counts, timestamps, filenames, delivery and (for a purge) a boundary date only.
- A failed `recordActivity` **never fails the action**; the notice says *The activity log entry could not be written.*
- Card UIDs are never fully rendered — on screen or in a file. The export column is `Card (last 4)` with the value from `maskCardUid` (`••••1F90`).
- Every export success notice ends with **Send this file only to a school account.**
- Branch: `export/masked-uid-and-activity`, cut from `main` at `84cca43` or later. Commit after every task; commit messages end with the attribution trailer in use for this session.
- No ESLint exists; do not add one. Match the surrounding comment density and voice (the codebase explains *why*, in full sentences).

---

## File structure

| File | Responsibility |
|---|---|
| `src/data/attendance-store.ts` (modify) | v6 schema; `ActivityKind`, `ActivityEntry`, `ACTIVITY_LOG_CAP`, `recordActivity`, `listActivity` |
| `src/data/attendance-store.test.ts` (modify) | behaviour of the two functions: order, cap, atomicity |
| `src/data/attendance-store.migrations.test.ts` (modify) | a v5 database opens at v6 with every row intact and an empty log |
| `src/lib/activity-wording.ts` (create) | `describeActivity(entry) → { action, detail }` — the one place the log is turned into words |
| `src/lib/activity-wording.test.ts` (create) | every kind's wording, singular/plural, missing uri |
| `src/lib/attendance-export.ts` (modify) | `Card (last 4)` column; optional `activity` sheet in `buildAttendanceWorkbook` and `exportAttendanceWorkbook` |
| `src/lib/attendance-export.test.ts` (modify) | column rename; sheet present only when passed |
| `src/ui/ExportNotice.tsx` (modify) | the school-account sentence; `logFailed` sentence |
| `src/ui/ExportNotice.test.tsx` (modify) | both sentences |
| `src/scanner/ScannerScreen.tsx` (modify) | records `export-session` |
| `src/scanner/ScannerScreen.test.tsx` (modify) | the row is written; a failed write shows the sentence |
| `src/ui/Dashboard.tsx` (modify) | `activity` prop → `ActivitySection` |
| `src/dashboard/DashboardPage.tsx` (modify) | reads the log; export-all passes the sheet and records `export-all` |
| `src/dashboard/DashboardPage.test.tsx` (modify) | list renders; export records; failure sentence |
| `src/roster/RosterPage.tsx` (modify) | records `remove-student` |
| `src/roster/RosterPage.test.tsx` (modify) | counts only; failure sentence |

---

### Task 0: Branch

- [ ] **Step 1: Cut the branch from main**

```bash
cd "/Users/ashermills/Git Hub Repo Projects/NFC-Attendance-Scanner"
git checkout -b export/masked-uid-and-activity main
cd artifacts/nfc-attendance-scanner
pnpm run typecheck && pnpm run test
```

Expected: typecheck clean, `Tests  446 passed` (28 files). Anything else is a pre-existing problem — stop and report it before touching code.

---

### Task 1: The `activity` table

**Files:**
- Modify: `src/data/attendance-store.ts` (after the `version(5)` block, ~line 78; table handles ~line 84; new functions after `clearAllAttendanceHistory`)
- Test: `src/data/attendance-store.test.ts`, `src/data/attendance-store.migrations.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ActivityKind =
    | 'export-session' | 'export-all'
    | 'remove-student' | 'purge-history' | 'remove-alumni'
    | 'pin-set' | 'pin-changed';
  export type ActivityEntry = {
    id?: number; at: string; kind: ActivityKind;
    filename?: string; delivery?: ExportDelivery;
    taps?: number; sessions?: number; students?: number; before?: string;
  };
  export const ACTIVITY_LOG_CAP = 500;
  export async function recordActivity(entry: Omit<ActivityEntry, 'id'>, cap?: number): Promise<void>;
  export async function listActivity(limit?: number): Promise<ActivityEntry[]>; // newest first, default 50
  ```
- Consumes: `ExportDelivery` from `@/lib/workbook-delivery` (type-only import).

- [ ] **Step 1: Write the failing behaviour tests**

Append to `src/data/attendance-store.test.ts` (add `ACTIVITY_LOG_CAP`, `listActivity`, `recordActivity` to the import from `./attendance-store`):

```ts
describe('activity log', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  it('lists entries newest first and never returns more than asked for', async () => {
    await recordActivity({ at: '2026-09-15T20:00:00.000Z', kind: 'pin-set' });
    await recordActivity({
      at: '2026-09-15T21:00:00.000Z',
      kind: 'export-session',
      filename: 'attendance-2026-09-15-20260915T210000Z.xlsx',
      delivery: 'saved',
      taps: 12,
      sessions: 1,
    });
    await recordActivity({
      at: '2026-09-16T20:00:00.000Z',
      kind: 'remove-student',
      taps: 3,
      sessions: 2,
    });

    const all = await listActivity();
    expect(all.map((entry) => entry.kind)).toEqual([
      'remove-student',
      'export-session',
      'pin-set',
    ]);
    expect(all[1]).toMatchObject({ filename: expect.stringContaining('.xlsx'), taps: 12 });

    expect((await listActivity(2)).map((entry) => entry.kind)).toEqual([
      'remove-student',
      'export-session',
    ]);
  });

  it('trims the oldest rows once the cap is passed, in the same write', async () => {
    const cap = 3;
    for (let index = 0; index < 5; index += 1) {
      await recordActivity(
        { at: `2026-09-1${index}T20:00:00.000Z`, kind: 'pin-changed', taps: index },
        cap,
      );
    }

    const kept = await listActivity(10);
    expect(kept).toHaveLength(cap);
    // The three newest survive; the two oldest went.
    expect(kept.map((entry) => entry.taps)).toEqual([4, 3, 2]);
    expect(ACTIVITY_LOG_CAP).toBe(500);
  });

  it('keeps the log out of clearAllAttendanceHistory', async () => {
    await recordActivity({ at: '2026-09-15T20:00:00.000Z', kind: 'pin-set' });
    await clearAllAttendanceHistory();
    expect(await listActivity()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --config vitest.config.ts src/data/attendance-store.test.ts -t "activity log"`
Expected: FAIL — `recordActivity`/`listActivity`/`ACTIVITY_LOG_CAP` are not exported (TypeScript/ESM import error).

- [ ] **Step 3: Add the schema version and the two functions**

In `src/data/attendance-store.ts`, add the type-only import at the top:

```ts
import type { ExportDelivery } from '@/lib/workbook-delivery';
```

After the `database.version(5)` block:

```ts
// What left the device and what was deleted, as counts, timestamps and
// filenames. A row here never carries a name, an email or a card UID: the log
// exists so a teacher can answer "where did that file go" and "when was that
// student removed" without the answer itself being a disclosure. Kept beside
// the records so it is cleared with them.
database.version(6).stores({
  scans: 'uid, scannedAt',
  persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
  taps: '++id, uid, scannedAt, personId, sessionId',
  settings: 'key',
  activity: '++id, at, kind',
});
```

After the `settingsTable` handle:

```ts
const activityTable = database.table<ActivityEntry, number>('activity');
```

Add the types near `Person`/`TapRecord` at the top of the file:

```ts
export type ActivityKind =
  | 'export-session'
  | 'export-all'
  | 'remove-student'
  | 'purge-history'
  | 'remove-alumni'
  | 'pin-set'
  | 'pin-changed';

/**
 * One line of the device's activity log. Only counts, timestamps, filenames
 * and delivery: the log records that student data moved or was deleted, never
 * the data itself, so reading the log is not a disclosure.
 */
export type ActivityEntry = {
  id?: number;
  /** ISO timestamp of the action. */
  at: string;
  kind: ActivityKind;
  /** Exports: the name the file was written under. */
  filename?: string;
  /** Exports: which route delivered it. */
  delivery?: ExportDelivery;
  /** Exports, removals and purges: rows involved. */
  taps?: number;
  /** Exports (1 for a session export), removals and purges: sessions involved. */
  sessions?: number;
  /** Removing graduated students: how many. */
  students?: number;
  /** A history purge: the school-year boundary it deleted before, `YYYY-MM-DD`. */
  before?: string;
};
```

After `clearAllAttendanceHistory`:

```ts
/**
 * Rows the activity log keeps before the oldest are dropped. Five hundred is
 * years of a club's exports and removals; the cap exists so the log cannot
 * grow without bound, not to forget anything a teacher would ask about.
 */
export const ACTIVITY_LOG_CAP = 500;

/**
 * Appends one row and trims the oldest beyond the cap, in one transaction so
 * a failure part-way cannot leave the log over the cap or missing the row that
 * was just added. `cap` is injectable for tests; production always uses the
 * constant.
 */
export async function recordActivity(
  entry: Omit<ActivityEntry, 'id'>,
  cap = ACTIVITY_LOG_CAP,
): Promise<void> {
  await database.transaction('rw', activityTable, async () => {
    // A copy, for the same reason `addPerson` copies: Dexie stamps the key
    // onto the object it is handed.
    await activityTable.add({ ...entry });
    const count = await activityTable.count();
    if (count > cap) {
      const stale = await activityTable
        .orderBy('at')
        .limit(count - cap)
        .primaryKeys();
      await activityTable.bulkDelete(stale);
    }
  });
}

/** The most recent rows, newest first. */
export async function listActivity(limit = 50): Promise<ActivityEntry[]> {
  return activityTable.orderBy('at').reverse().limit(limit).toArray();
}
```

- [ ] **Step 4: Run the behaviour tests**

Run: `pnpm exec vitest run --config vitest.config.ts src/data/attendance-store.test.ts -t "activity log"`
Expected: 3 passed.

- [ ] **Step 5: Write the failing migration test**

In `src/data/attendance-store.migrations.test.ts`, add `getAttendanceTarget`, `listActivity`, `setAttendanceTarget` to the import from `./attendance-store`, add this seeder beside `seedVersion2`, and add the test inside the existing `describe`:

```ts
/** A database frozen at version 5: every table the app had before the activity log. */
async function seedVersion5(): Promise<void> {
  const legacy = new Dexie(DATABASE_NAME);
  legacy.version(5).stores({
    scans: 'uid, scannedAt',
    persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
    taps: '++id, uid, scannedAt, personId, sessionId',
    settings: 'key',
  });
  await legacy.open();
  await legacy.table('persons').bulkAdd([ROSA, KAI]);
  await legacy.table('taps').bulkAdd([
    {
      uid: ROSA_CARD,
      scannedAt: '2025-09-10T22:31:00.000Z',
      personId: ROSA.id,
      sessionId: 'session-a',
      counted: true,
    },
    {
      uid: STRANGER_CARD,
      scannedAt: '2025-09-10T22:33:00.000Z',
      personId: null,
      sessionId: 'session-a',
      counted: false,
    },
  ]);
  await legacy.table('settings').put({ key: 'attendance-target', value: '35' });
  legacy.close();
}
```

```ts
  it('opens a version 5 database at version 6 with every row intact and an empty log', async () => {
    await seedVersion5();

    expect((await listPersons()).map((person) => person.firstName)).toEqual(['Rosa', 'Nakamura'].slice(0, 1).concat(['Kai']).sort());
    expect(await listTapRecords()).toHaveLength(2);
    expect(await getAttendanceTarget()).toBe(35);
    expect(await listActivity()).toEqual([]);

    await withRawDatabase(async (raw) => {
      expect(raw.verno).toBe(6);
      expect(raw.tables.map((table) => table.name).sort()).toEqual([
        'activity',
        'persons',
        'scans',
        'settings',
        'taps',
      ]);
    });
  });
```

Replace the first `expect` line above with the plain form — the roster sorts by last name, so:

```ts
    expect((await listPersons()).map((person) => person.lastName)).toEqual(['Alvarez', 'Nakamura']);
```

- [ ] **Step 6: Run the migration test**

Run: `pnpm exec vitest run --config vitest.config.ts src/data/attendance-store.migrations.test.ts`
Expected: all pass, including the new case (the store now declares v6, so `verno` is 6 and the `activity` table exists).

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm run typecheck
git add src/data/attendance-store.ts src/data/attendance-store.test.ts src/data/attendance-store.migrations.test.ts
git commit -m "Add the activity log table: what left the device and what was deleted, never who"
```

---

### Task 2: The export shows the card's last four, not the UID

**Files:**
- Modify: `src/lib/attendance-export.ts` (`AttendanceRow`, `EXPORT_COLUMNS`, `buildAttendanceRows`)
- Test: `src/lib/attendance-export.test.ts` (lines using `'Card UID'`: ~254, 282, 307, 353, 502–526)

**Interfaces:**
- Produces: `AttendanceRow['Card (last 4)']: string` (replaces `'Card UID'`).
- Consumes: `maskCardUid` from `@/lib/scan-format`.

- [ ] **Step 1: Change the tests first**

In `src/lib/attendance-export.test.ts`, import `maskCardUid` from `'@/lib/scan-format'` and make every `'Card UID'` expectation the masked form:

- Where a row is expected with `'Card UID': jordan.cardUid` → `'Card (last 4)': maskCardUid(jordan.cardUid)`.
- Where `'Card UID': STRANGER_UID` → `'Card (last 4)': maskCardUid(STRANGER_UID)`.
- The `UID_PATTERN` assertion at ~307 becomes:
  ```ts
  expect(row['Card (last 4)']).toMatch(/^••••[0-9A-F]{4}$/);
  ```
- The header list at ~353 becomes `'Card (last 4)'` in the same position.

Add one explicit test in the `buildAttendanceRows` describe:

```ts
  it('never writes a full card UID — the file gets the same last four the screen shows', () => {
    const rows = buildAttendanceRows(
      [{ id: 1, uid: '04A1B2C3D4E5F6', scannedAt: FALL_2026, personId: null, sessionId: 's', counted: false }],
      [],
    );
    expect(rows[0]['Card (last 4)']).toBe('••••E5F6');
    expect(JSON.stringify(rows)).not.toContain('04A1B2C3D4E5F6');
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm exec vitest run --config vitest.config.ts src/lib/attendance-export.test.ts`
Expected: FAIL on every renamed key (`'Card (last 4)'` undefined / typecheck error).

- [ ] **Step 3: Rename the column and mask the value**

In `src/lib/attendance-export.ts`:

```ts
import { maskCardUid } from '@/lib/scan-format';
```

```ts
/**
 * One worksheet row. The keys are the column headers, verbatim.
 *
 * The card column carries the same `••••` + last-four the screen shows, never
 * the full UID: a UID opens a building, and the file is the one artefact that
 * routinely leaves the device. Nothing reads an export back in, so the full
 * value would serve no purpose here that the tail does not.
 */
export type AttendanceRow = {
  Timestamp: string;
  'Card (last 4)': string;
  'Meeting Date': string;
  Name: string;
  Email: string;
  Grade: string;
};

const EXPORT_COLUMNS: (keyof AttendanceRow)[] = [
  'Timestamp',
  'Card (last 4)',
  'Meeting Date',
  'Name',
  'Email',
  'Grade',
];
```

and in `buildAttendanceRows`, replace `'Card UID': tap.uid,` with `'Card (last 4)': maskCardUid(tap.uid),`.

- [ ] **Step 4: Run the export tests**

Run: `pnpm exec vitest run --config vitest.config.ts src/lib/attendance-export.test.ts`
Expected: all pass.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm run typecheck
git add src/lib/attendance-export.ts src/lib/attendance-export.test.ts
git commit -m "Export the card's last four, not the UID — one rule on screen and in the file"
```

---

### Task 3: Words for an activity row, and the `Activity` sheet

**Files:**
- Create: `src/lib/activity-wording.ts`, `src/lib/activity-wording.test.ts`
- Modify: `src/lib/attendance-export.ts` (`buildAttendanceWorkbook`, `exportAttendanceWorkbook`)
- Test: `src/lib/attendance-export.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // activity-wording.ts
  export type ActivityWording = { action: string; detail: string };
  export function describeActivity(entry: ActivityEntry): ActivityWording;
  // attendance-export.ts
  export type ActivitySheetRow = { When: string; Action: string; Detail: string };
  export function buildAttendanceWorkbook(taps, persons, now?: Date, activity?: readonly ActivityEntry[]): AttendanceWorkbook;
  export async function exportAttendanceWorkbook(taps, persons, activity?: readonly ActivityEntry[]): Promise<DeliveredExport>;
  ```
- Consumes: `ActivityEntry` (Task 1); `formatSessionTimestamp`, `formatSessionDateLabel` from `@/lib/session-formatting`.

- [ ] **Step 1: Write the failing wording tests**

`src/lib/activity-wording.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { describeActivity } from './activity-wording';

const AT = '2026-09-15T21:00:00.000Z';
const FILE = 'attendance-2026-09-15-20260915T210000Z.xlsx';

describe('describeActivity', () => {
  it('names a session export by file and where it went', () => {
    expect(
      describeActivity({ at: AT, kind: 'export-session', filename: FILE, delivery: 'saved', uri: undefined, taps: 12, sessions: 1 } as never),
    ).toEqual({ action: 'Exported this session', detail: `${FILE}, saved` });
    expect(
      describeActivity({ at: AT, kind: 'export-session', filename: FILE, delivery: 'file', taps: 1, sessions: 1 }),
    ).toEqual({ action: 'Exported this session', detail: `${FILE}, saved to Documents` });
    expect(
      describeActivity({ at: AT, kind: 'export-session', filename: FILE, delivery: 'download', taps: 1, sessions: 1 }),
    ).toEqual({ action: 'Exported this session', detail: `${FILE}, handed to the browser` });
  });

  it('counts taps and sessions for a full-history export', () => {
    expect(
      describeActivity({ at: AT, kind: 'export-all', filename: FILE, delivery: 'download', taps: 240, sessions: 9 }),
    ).toEqual({ action: 'Exported all history', detail: `240 taps from 9 sessions — ${FILE}, handed to the browser` });
  });

  it('describes removals and purges by count only, singular and plural', () => {
    expect(describeActivity({ at: AT, kind: 'remove-student', taps: 1, sessions: 1 })).toEqual({
      action: 'Removed a student',
      detail: '1 tap from 1 session',
    });
    expect(describeActivity({ at: AT, kind: 'remove-student', taps: 0, sessions: 0 })).toEqual({
      action: 'Removed a student',
      detail: '0 taps from 0 sessions',
    });
    expect(
      describeActivity({ at: AT, kind: 'purge-history', taps: 300, sessions: 12, before: '2026-08-01' }),
    ).toEqual({ action: 'Deleted attendance', detail: '300 taps from 12 sessions before Aug 1, 2026' });
    expect(describeActivity({ at: AT, kind: 'remove-alumni', students: 2, taps: 40 })).toEqual({
      action: 'Removed graduated students',
      detail: '2 students and 40 taps',
    });
  });

  it('says only that the PIN changed', () => {
    expect(describeActivity({ at: AT, kind: 'pin-set' })).toEqual({ action: 'Teacher PIN set', detail: '' });
    expect(describeActivity({ at: AT, kind: 'pin-changed' })).toEqual({ action: 'Teacher PIN changed', detail: '' });
  });

  it('never leaks a field it was not meant to print', () => {
    const wording = describeActivity({ at: AT, kind: 'remove-student', taps: 2, sessions: 1 });
    expect(`${wording.action} ${wording.detail}`).not.toMatch(/@|[0-9A-F]{14}/);
  });
});
```

Replace the first expectation's `as never` cast with a plain object — `ActivityEntry` has no `uri` field, so a `saved` delivery with no path reads simply `saved`:

```ts
      describeActivity({ at: AT, kind: 'export-session', filename: FILE, delivery: 'saved', taps: 12, sessions: 1 }),
```

Check `formatSessionDateLabel('2026-08-01')` renders `Aug 1, 2026` by reading `src/lib/session-formatting.ts` line ~89; if its format differs, use whatever it produces in the purge expectation — the point is that the boundary is printed as a date, not an ISO string.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm exec vitest run --config vitest.config.ts src/lib/activity-wording.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

`src/lib/activity-wording.ts`:

```ts
import type { ActivityEntry } from '@/data/attendance-store';
import { formatSessionDateLabel } from '@/lib/session-formatting';

/** A row of the log as two short strings: what happened, and the figures. */
export type ActivityWording = { action: string; detail: string };

function count(value: number | undefined, noun: string): string {
  const n = value ?? 0;
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Where an export went, in the words the export notice already uses. */
function delivered(entry: ActivityEntry): string {
  switch (entry.delivery) {
    case 'saved':
      return 'saved';
    case 'file':
      return 'saved to Documents';
    case 'download':
      return 'handed to the browser';
    default:
      return '';
  }
}

/**
 * Turns a log row into words for the dashboard and the export's second sheet.
 * One place, so the two never disagree — and so the rule that a row holds no
 * student data is enforced by construction: there is no field here that could
 * carry a name, and nothing to print one from.
 */
export function describeActivity(entry: ActivityEntry): ActivityWording {
  switch (entry.kind) {
    case 'export-session':
      return {
        action: 'Exported this session',
        detail: `${entry.filename ?? ''}, ${delivered(entry)}`,
      };
    case 'export-all':
      return {
        action: 'Exported all history',
        detail: `${count(entry.taps, 'tap')} from ${count(entry.sessions, 'session')} — ${entry.filename ?? ''}, ${delivered(entry)}`,
      };
    case 'remove-student':
      return {
        action: 'Removed a student',
        detail: `${count(entry.taps, 'tap')} from ${count(entry.sessions, 'session')}`,
      };
    case 'purge-history':
      return {
        action: 'Deleted attendance',
        detail: `${count(entry.taps, 'tap')} from ${count(entry.sessions, 'session')} before ${entry.before ? formatSessionDateLabel(entry.before) : 'the school year'}`,
      };
    case 'remove-alumni':
      return {
        action: 'Removed graduated students',
        detail: `${count(entry.students, 'student')} and ${count(entry.taps, 'tap')}`,
      };
    case 'pin-set':
      return { action: 'Teacher PIN set', detail: '' };
    case 'pin-changed':
      return { action: 'Teacher PIN changed', detail: '' };
  }
}
```

- [ ] **Step 4: Run the wording tests**

Run: `pnpm exec vitest run --config vitest.config.ts src/lib/activity-wording.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Write the failing sheet tests**

In `src/lib/attendance-export.test.ts`, inside the `buildAttendanceWorkbook` describe (near the `SheetNames` assertion at ~380), add:

```ts
  it('writes a second Activity sheet only when handed a log', () => {
    const without = buildAttendanceWorkbook([], [], new Date('2026-09-15T21:00:00.000Z'));
    expect(without.workbook.SheetNames).toEqual(['Attendance']);

    const withLog = buildAttendanceWorkbook([], [], new Date('2026-09-15T21:00:00.000Z'), [
      {
        id: 2,
        at: '2026-09-15T20:30:00.000Z',
        kind: 'export-session',
        filename: 'attendance-2026-09-15-20260915T203000Z.xlsx',
        delivery: 'file',
        taps: 12,
        sessions: 1,
      },
      { id: 1, at: '2026-09-10T20:00:00.000Z', kind: 'pin-set' },
    ]);
    expect(withLog.workbook.SheetNames).toEqual(['Attendance', 'Activity']);

    const reopened = XLSX.read(XLSX.write(withLog.workbook, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(reopened.Sheets.Activity);
    expect(Object.keys(rows[0])).toEqual(['When', 'Action', 'Detail']);
    expect(rows[0].Action).toBe('Exported this session');
    expect(rows[0].Detail).toContain('saved to Documents');
    expect(rows[1].Action).toBe('Teacher PIN set');
  });
```

Also add, in the `exportAttendanceWorkbook` describe, a case that the optional third argument reaches the workbook — spy on `XLSX.writeFile` (already mocked) and assert the workbook it received has two sheets:

```ts
  it('passes an activity log through to the delivered workbook', async () => {
    await exportAttendanceWorkbook([], [], [{ id: 1, at: '2026-09-10T20:00:00.000Z', kind: 'pin-set' }]);
    const [workbook] = vi.mocked(XLSX.writeFile).mock.calls.at(-1) as [XLSX.WorkBook, string];
    expect(workbook.SheetNames).toEqual(['Attendance', 'Activity']);
  });
```

- [ ] **Step 6: Run to see them fail**

Run: `pnpm exec vitest run --config vitest.config.ts src/lib/attendance-export.test.ts -t "Activity"`
Expected: FAIL — only one sheet; the fourth argument is ignored.

- [ ] **Step 7: Add the sheet**

In `src/lib/attendance-export.ts`:

```ts
import type { ActivityEntry, Person, TapRecord } from '@/data/attendance-store';
import { describeActivity } from '@/lib/activity-wording';
```

```ts
/** One row of the export's second sheet. Keys are the headers, verbatim. */
export type ActivitySheetRow = { When: string; Action: string; Detail: string };

const ACTIVITY_COLUMNS: (keyof ActivitySheetRow)[] = ['When', 'Action', 'Detail'];

/** The log as sheet rows, in the order it was handed over (newest first). */
export function buildActivityRows(activity: readonly ActivityEntry[]): ActivitySheetRow[] {
  return activity.map((entry) => {
    const { action, detail } = describeActivity(entry);
    return { When: formatSessionTimestamp(entry.at), Action: action, Detail: detail };
  });
}
```

Change `buildAttendanceWorkbook` to:

```ts
export function buildAttendanceWorkbook(
  taps: readonly TapRecord[],
  persons: readonly Person[],
  now: Date = new Date(),
  activity?: readonly ActivityEntry[],
): AttendanceWorkbook {
  const rows = buildAttendanceRows(taps, persons);
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_COLUMNS });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
  // Only the whole-history export carries the log: it is the record a school
  // keeps, and the log is what says where earlier copies of it went. The row
  // for this very export is written after delivery, so it is never in the
  // sheet it produces.
  if (activity) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(buildActivityRows(activity), { header: ACTIVITY_COLUMNS }),
      'Activity',
    );
  }
  const timestamp = now.toISOString();
  // ...rest unchanged
```

and `exportAttendanceWorkbook`:

```ts
export async function exportAttendanceWorkbook(
  taps: readonly TapRecord[],
  persons: readonly Person[],
  activity?: readonly ActivityEntry[],
): Promise<DeliveredExport> {
  return deliverWorkbook(buildAttendanceWorkbook(taps, persons, new Date(), activity));
}
```

- [ ] **Step 8: Run the export tests, typecheck, commit**

Run: `pnpm exec vitest run --config vitest.config.ts src/lib/attendance-export.test.ts src/lib/activity-wording.test.ts`
Expected: all pass.

```bash
pnpm run typecheck
git add src/lib/activity-wording.ts src/lib/activity-wording.test.ts src/lib/attendance-export.ts src/lib/attendance-export.test.ts
git commit -m "Give the activity log words, and a second sheet in the full-history export"
```

---

### Task 4: The export notice says where the file may go, and when the log failed

**Files:**
- Modify: `src/ui/ExportNotice.tsx`
- Test: `src/ui/ExportNotice.test.tsx`

**Interfaces:**
- Produces: `ExportResult` ok variant gains `logFailed?: boolean`:
  ```ts
  export type ExportResult =
    | ({ ok: true; logFailed?: boolean } & DeliveredExport)
    | { ok: false; cancelled?: boolean }
    | null;
  ```

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('ExportNotice')`:

```ts
  it('tells every successful export where the file may go', () => {
    for (const delivery of ['download', 'file', 'saved'] as const) {
      cleanup();
      render(<ExportNotice result={{ ok: true, filename: FILENAME, delivery }} />);
      expect(screen.getByTestId('text-export-saved').textContent).toContain(
        'Send this file only to a school account.',
      );
    }
  });

  it('says when the activity log entry could not be written, without calling the export a failure', () => {
    render(
      <ExportNotice result={{ ok: true, filename: FILENAME, delivery: 'file', logFailed: true }} />,
    );
    const notice = screen.getByTestId('text-export-saved');
    expect(notice.textContent).toContain('The activity log entry could not be written.');
    expect(screen.queryByTestId('text-export-failed')).toBeNull();
  });

  it('does not mention the log when it was written', () => {
    render(<ExportNotice result={{ ok: true, filename: FILENAME, delivery: 'file' }} />);
    expect(screen.getByTestId('text-export-saved').textContent).not.toContain('activity log');
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm exec vitest run --config vitest.config.ts src/ui/ExportNotice.test.tsx`
Expected: FAIL on the two new sentences (and a type error on `logFailed`).

- [ ] **Step 3: Add the sentences**

In `src/ui/ExportNotice.tsx`, change the type:

```ts
export type ExportResult =
  | ({ ok: true; /** The file was delivered but the activity row was not written. */ logFailed?: boolean } & DeliveredExport)
  | { ok: false; cancelled?: boolean }
  | null;
```

In the success branch, wrap the three delivery `<span>`s so each is followed by the same trailer. Simplest: keep the three spans as they are and add after the ternary, still inside the `<p>`:

```tsx
      <span className="block">
        {' '}
        Send this file only to a school account.
        {result.logFailed ? (
          <>
            {' '}
            <span data-testid="text-export-log-failed">
              The activity log entry could not be written.
            </span>
          </>
        ) : null}
      </span>
```

For the `<p>` to hold two spans side by side, change its `className` to add `flex-wrap` (`flex flex-wrap items-start gap-2 …`) — keep every other class.

- [ ] **Step 4: Run, typecheck, commit**

Run: `pnpm exec vitest run --config vitest.config.ts src/ui/ExportNotice.test.tsx`
Expected: all pass.

```bash
pnpm run typecheck
git add src/ui/ExportNotice.tsx src/ui/ExportNotice.test.tsx
git commit -m "Say on every export where the file may go, and when the log could not be written"
```

---

### Task 5: The scanner records a session export

**Files:**
- Modify: `src/scanner/ScannerScreen.tsx` (`handleExport`, ~line 153)
- Test: `src/scanner/ScannerScreen.test.tsx` (near the export tests at ~490–560)

**Interfaces:**
- Consumes: `recordActivity` (Task 1); `ExportResult.logFailed` (Task 4).

- [ ] **Step 1: Write the failing tests**

In `src/scanner/ScannerScreen.test.tsx`, add `import * as attendanceStore from '@/data/attendance-store';` if absent, then next to the existing export tests (which open the summary and click *Export this session* — copy their setup exactly):

```ts
  it('records a session export in the activity log, as counts and a filename only', async () => {
    vi.spyOn(attendanceExport, 'exportAttendanceWorkbook').mockResolvedValue({
      filename: 'attendance-2026-09-15-20260915T210000Z.xlsx',
      delivery: 'file',
      uri: 'file:///Documents/attendance-2026-09-15-20260915T210000Z.xlsx',
    });
    const record = vi.spyOn(attendanceStore, 'recordActivity').mockResolvedValue();

    // ...the same enroll + tap + End Session + Export this session steps the
    // neighbouring export test performs...

    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const [entry] = record.mock.calls[0];
    expect(entry).toMatchObject({
      kind: 'export-session',
      filename: 'attendance-2026-09-15-20260915T210000Z.xlsx',
      delivery: 'file',
      sessions: 1,
    });
    expect(typeof entry.taps).toBe('number');
    expect(JSON.stringify(entry)).not.toMatch(/@|[0-9A-F]{14}/);
    expect(screen.getByTestId('text-export-saved').textContent).not.toContain('activity log');
  });

  it('still reports the export as saved when the log row cannot be written, and says so', async () => {
    vi.spyOn(attendanceExport, 'exportAttendanceWorkbook').mockResolvedValue({
      filename: 'attendance-2026-09-15-20260915T210000Z.xlsx',
      delivery: 'file',
    });
    vi.spyOn(attendanceStore, 'recordActivity').mockRejectedValue(new Error('quota'));

    // ...same steps...

    const notice = await screen.findByTestId('text-export-saved');
    expect(notice.textContent).toContain('The activity log entry could not be written.');
    expect(screen.queryByTestId('text-export-failed')).toBeNull();
  });
```

Fill in the elided steps by copying the body of the existing test that asserts `text-export-saved` (lines ~490–500) — do not invent selectors; the ones it uses are `button-end-session` and the *Export this session* button inside `dialog-session-summary` (check the test id in `SessionSummary.tsx` before writing).

- [ ] **Step 2: Run to see them fail**

Run: `pnpm exec vitest run --config vitest.config.ts src/scanner/ScannerScreen.test.tsx -t "activity log"`
Expected: FAIL — `recordActivity` never called; no log sentence.

- [ ] **Step 3: Record after delivery**

In `src/scanner/ScannerScreen.tsx`, import `recordActivity` from `'@/data/attendance-store'` and change `handleExport`:

```ts
  const handleExport = useCallback(async () => {
    try {
      const delivered = await exportAttendanceWorkbook(taps, persons);
      // Logged after delivery, so a cancelled Save dialog leaves no row. The
      // row is counts and a filename: which taps went is what the file says,
      // and the log must be readable without being a disclosure itself.
      let logFailed = false;
      try {
        await recordActivity({
          at: new Date().toISOString(),
          kind: 'export-session',
          filename: delivered.filename,
          delivery: delivered.delivery,
          taps: taps.length,
          sessions: 1,
        });
      } catch {
        // The file is already delivered; a log that could not be written must
        // not turn that into "the export failed". The notice says so instead.
        logFailed = true;
      }
      setExportResult({ ok: true, ...delivered, logFailed });
    } catch (error) {
      setExportResult({
        ok: false,
        cancelled: error instanceof ExportCancelledError,
      });
    }
  }, [persons, taps]);
```

- [ ] **Step 4: Run the scanner tests, typecheck, commit**

Run: `pnpm exec vitest run --config vitest.config.ts src/scanner/ScannerScreen.test.tsx`
Expected: all pass.

```bash
pnpm run typecheck
git add src/scanner/ScannerScreen.tsx src/scanner/ScannerScreen.test.tsx
git commit -m "Record a session export in the activity log after it is delivered"
```

---

### Task 6: The dashboard shows the log, and its export carries and records it

**Files:**
- Modify: `src/ui/Dashboard.tsx` (props; new `ActivitySection` after `UnidentifiedCardSection`)
- Modify: `src/dashboard/DashboardPage.tsx` (`load`, `exportAll`, render)
- Test: `src/dashboard/DashboardPage.test.tsx`

**Interfaces:**
- Produces: `DashboardProps.activity?: ActivityEntry[]`; section test ids `section-activity`, `list-activity`, `row-activity-<id>`, `text-activity-empty`.
- Consumes: `listActivity`, `recordActivity`, `ACTIVITY_LOG_CAP` (Task 1); `describeActivity` (Task 3); `formatSessionDateTime` from `@/lib/session-formatting`; `exportAttendanceWorkbook(taps, persons, activity)` (Task 3).

- [ ] **Step 1: Write the failing page tests**

In `src/dashboard/DashboardPage.test.tsx` add these cases (the file already imports `* as attendanceStore` and `* as attendanceExport`; add `recordActivity` to the named import):

```ts
  it('lists the device activity newest first, in words, and says when there is none', async () => {
    await seedTwoSessions();
    renderPage();
    expect(await screen.findByTestId('text-activity-empty')).toBeTruthy();

    cleanup();
    await recordActivity({ at: secondsAgo(30), kind: 'pin-set' });
    await recordActivity({ at: secondsAgo(10), kind: 'remove-student', taps: 3, sessions: 2 });
    renderPage();

    const list = await screen.findByTestId('list-activity');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Removed a student');
    expect(rows[0].textContent).toContain('3 taps from 2 sessions');
    expect(rows[1].textContent).toContain('Teacher PIN set');
  });

  it('exports all history with the activity sheet and records the export', async () => {
    await seedTwoSessions();
    await recordActivity({ at: secondsAgo(20), kind: 'pin-set' });
    const exportSpy = vi
      .spyOn(attendanceExport, 'exportAttendanceWorkbook')
      .mockResolvedValue({ filename: 'attendance-all.xlsx', delivery: 'download' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-export-history'));

    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    const [, , activity] = exportSpy.mock.calls[0];
    expect(activity?.map((entry) => entry.kind)).toEqual(['pin-set']);

    const logged = await attendanceStore.listActivity();
    expect(logged[0]).toMatchObject({
      kind: 'export-all',
      filename: 'attendance-all.xlsx',
      delivery: 'download',
      taps: 4,
      sessions: 2,
    });
    // The list on screen picks the new row up without a full reload.
    const list = await screen.findByTestId('list-activity');
    expect(within(list).getAllByRole('listitem')[0].textContent).toContain('Exported all history');
    expect(screen.getByTestId('text-export-saved').textContent).toContain('Send this file only to a school account.');
  });

  it('keeps the export a success when the log row cannot be written', async () => {
    await seedTwoSessions();
    vi.spyOn(attendanceExport, 'exportAttendanceWorkbook').mockResolvedValue({ filename: 'attendance-all.xlsx', delivery: 'download' });
    vi.spyOn(attendanceStore, 'recordActivity').mockRejectedValue(new Error('quota'));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-export-history'));

    const notice = await screen.findByTestId('text-export-saved');
    expect(notice.textContent).toContain('The activity log entry could not be written.');
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm exec vitest run --config vitest.config.ts src/dashboard/DashboardPage.test.tsx -t "activity"`
Expected: FAIL — no `text-activity-empty`, no third argument, no row.

- [ ] **Step 3: The section**

In `src/ui/Dashboard.tsx`, import `History` from `lucide-react`, `type ActivityEntry` from `'@/data/attendance-store'`, `describeActivity` from `'@/lib/activity-wording'` and `formatSessionDateTime` from `'@/lib/session-formatting'` (the file already imports `formatSessionLastSeen` from there). Add to `DashboardProps`:

```ts
  /**
   * The device's activity log, newest first. Counts, timestamps and filenames
   * only — the log is how a teacher answers "where did that file go" without
   * the answer being a disclosure. Optional so the presentational tests that
   * render this component without a page keep working.
   */
  activity?: ActivityEntry[];
```

Destructure `activity = []` in the component and render, after `<UnidentifiedCardSection … />`:

```tsx
        <ActivitySection entries={activity} />
```

Add the component after `UnidentifiedCardSection`:

```tsx
function ActivitySection({ entries }: { entries: ActivityEntry[] }) {
  return (
    <Card eyebrow="Activity" icon={<History aria-hidden="true" size={16} />}>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]" data-testid="section-activity">
        Exports and deletions on this device. Counts and filenames only — never a name or a card.
      </p>
      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]" data-testid="text-activity-empty">
          Nothing exported or deleted on this device yet.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2" data-testid="list-activity">
          {entries.map((entry) => {
            const { action, detail } = describeActivity(entry);
            return (
              <li
                key={entry.id ?? `${entry.at}-${entry.kind}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] px-3 py-2.5 text-sm"
                data-testid={`row-activity-${entry.id ?? 'unsaved'}`}
              >
                <span className="min-w-0">
                  <span className="font-semibold text-[hsl(var(--foreground))]">{action}</span>
                  {detail ? (
                    <span className="text-[hsl(var(--muted-foreground))] [overflow-wrap:anywhere]"> — {detail}</span>
                  ) : null}
                </span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {formatSessionDateTime(entry.at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: The page**

In `src/dashboard/DashboardPage.tsx`, extend the named import with `ACTIVITY_LOG_CAP, listActivity, recordActivity, type ActivityEntry`. Add state and read it in `load`:

```ts
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
```

inside `load`, alongside the other three reads:

```ts
      const [taps, persons, target, recent] = await Promise.all([
        listTapRecords(),
        listPersons(),
        getAttendanceTarget(),
        listActivity(),
      ]);
      // ...existing setMetrics/setHistory...
      setActivity(recent);
```

Replace `exportAll`:

```ts
  const exportAll = useCallback(async () => {
    if (!history) return;
    try {
      // The whole log rides along as the second sheet: this file is the record
      // a school keeps, and the log is what says where earlier copies went.
      const delivered = await exportAttendanceWorkbook(
        history.taps,
        history.persons,
        await listActivity(ACTIVITY_LOG_CAP),
      );
      let logFailed = false;
      try {
        await recordActivity({
          at: new Date().toISOString(),
          kind: 'export-all',
          filename: delivered.filename,
          delivery: delivered.delivery,
          taps: history.taps.length,
          sessions: new Set(history.taps.map((tap) => tap.sessionId)).size,
        });
        // Only the log is re-read: the numbers on screen are still true.
        setActivity(await listActivity());
      } catch {
        logFailed = true;
      }
      setExportResult({ ok: true, ...delivered, logFailed });
    } catch (error) {
      // See ScannerScreen: a cancelled Save dialog must not read as a failure.
      setExportResult({
        ok: false,
        cancelled: error instanceof ExportCancelledError,
      });
    }
  }, [history]);
```

and pass `activity={activity}` to `<Dashboard … />`.

- [ ] **Step 5: Run the dashboard suites, typecheck, commit**

Run: `pnpm exec vitest run --config vitest.config.ts src/dashboard/DashboardPage.test.tsx src/ui/Dashboard.test.tsx`
Expected: all pass.

```bash
pnpm run typecheck
git add src/ui/Dashboard.tsx src/dashboard/DashboardPage.tsx src/dashboard/DashboardPage.test.tsx
git commit -m "Show the activity log on the dashboard; the full export carries it and is logged"
```

---

### Task 7: Removing a student is logged by count

**Files:**
- Modify: `src/roster/RosterPage.tsx` (`confirmRemoval`, ~line 75)
- Test: `src/roster/RosterPage.test.tsx`

**Interfaces:**
- Consumes: `recordActivity` (Task 1).

- [ ] **Step 1: Write the failing tests**

In `src/roster/RosterPage.test.tsx` (it already imports `* as attendanceStore`; find the existing removal test and copy its steps — it clicks `button-remove-person-<id>` and confirms inside `RemoveStudentDialog`; check the confirm button's test id in `src/ui/RemoveStudentDialog.tsx` before writing):

```ts
  it('logs a removal as counts only', async () => {
    const saved = await addPerson(jane);
    const record = vi.spyOn(attendanceStore, 'recordActivity').mockResolvedValue();
    const user = userEvent.setup();
    renderPage();

    // ...open the Remove dialog for `saved.id` and confirm, exactly as the
    // existing removal test does...

    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const [entry] = record.mock.calls[0];
    expect(entry).toMatchObject({ kind: 'remove-student', taps: 0, sessions: 0 });
    expect(JSON.stringify(entry)).not.toContain('Jane');
    expect(JSON.stringify(entry)).not.toContain(jane.email);
    expect(JSON.stringify(entry)).not.toContain(jane.cardUid);
  });

  it('says when the removal could not be logged, and still removes', async () => {
    const saved = await addPerson(jane);
    vi.spyOn(attendanceStore, 'recordActivity').mockRejectedValue(new Error('quota'));
    const user = userEvent.setup();
    renderPage();

    // ...same steps...

    const notice = await screen.findByTestId('text-roster-removed');
    expect(notice.textContent).toContain('The activity log entry could not be written.');
    expect(await listPersons()).toHaveLength(0);
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm exec vitest run --config vitest.config.ts src/roster/RosterPage.test.tsx -t "log"`
Expected: FAIL.

- [ ] **Step 3: Record after the delete commits**

In `src/roster/RosterPage.tsx`, import `recordActivity` and change `confirmRemoval`'s success path:

```ts
      const removed = await deletePerson(person.id);
      setPersons((current) => current.filter((item) => item.id !== person.id));
      // Counts only. The student is gone from the store, and the log must not
      // be the place their name survives.
      let logNote = '';
      try {
        await recordActivity({
          at: new Date().toISOString(),
          kind: 'remove-student',
          taps: removed.tapCount,
          sessions: removed.sessionCount,
        });
      } catch {
        logNote = ' The activity log entry could not be written.';
      }
      setRemovedNotice(
        (removed.tapCount === 0
          ? `Removed ${person.firstName} ${person.lastName}.`
          : `Removed ${person.firstName} ${person.lastName} and ${removed.tapCount} tap${removed.tapCount === 1 ? '' : 's'}.`) +
          logNote,
      );
```

- [ ] **Step 4: Run, typecheck, commit**

Run: `pnpm exec vitest run --config vitest.config.ts src/roster/RosterPage.test.tsx`
Expected: all pass.

```bash
pnpm run typecheck
git add src/roster/RosterPage.tsx src/roster/RosterPage.test.tsx
git commit -m "Log a student's removal by count, never by name"
```

---

### Task 8: Whole suite, browser suite if available, merge

- [ ] **Step 1: Everything green**

```bash
pnpm run typecheck && pnpm run test
```

Expected: typecheck clean; every file passes; the count is 446 plus the cases added above (≈ 16 new).

- [ ] **Step 2: Browser suite, if Chromium is installed**

```bash
pnpm run test:browser
```

If it reports no browser, say so in the merge commit rather than installing one now.

- [ ] **Step 3: Merge**

```bash
cd "/Users/ashermills/Git Hub Repo Projects/NFC-Attendance-Scanner"
git checkout main
git merge --no-ff export/masked-uid-and-activity -m "Merge export/masked-uid-and-activity: masked card tail in the export and an activity log"
git log --oneline -3
git ls-remote origin refs/heads/main   # confirm nothing pushed itself
```

Do **not** push. The `_queue` finding about an unexplained push is still open.
