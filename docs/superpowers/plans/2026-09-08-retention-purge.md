# Retention — implementation plan (branch 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teacher can delete last school year's attendance and remove graduated students from the dashboard, each action previewed, confirmed, logged and never automatic.

**Architecture:** Four store functions take *predicates* — the container decides what "before this school year" and "graduated" mean, using the school-year and grade helpers the app already has, so the data module stays free of date logic and of `attendance-export.ts`. One generic `RetentionDialog` (the `RemoveStudentDialog` pattern, not a refactor of it) confirms either action. The dashboard gets a *Data retention* card whose two buttons are disabled when there is nothing to do; `DashboardPage` reads both previews with the rest of the page, runs the action, logs it, and reloads.

**Tech Stack:** React, Dexie 4, vitest + jsdom + fake-indexeddb + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-08-ferpa-safe-kiosk-design.md`, section 2 ("Retention") and the `purge-history` / `remove-alumni` rows of section 3.

## Global Constraints

- Run from `artifacts/nfc-attendance-scanner/`; pnpm only; `pnpm exec vitest run --config vitest.config.ts <file>`, `pnpm run test`, `pnpm run typecheck`.
- No new Dexie version. Deletions run in one `'rw'` transaction over every table they touch.
- Nothing deletes on its own. Both buttons sit on the dashboard, which is already behind the PIN.
- The `purge-history` activity row carries `before` (the `YYYY-MM-DD` boundary); the `remove-alumni` row carries `students` and `taps`. Neither carries a name, an email or a UID.
- "Before this school year" is judged the way the dashboard judges it — on the tap's **Eastern calendar date** (`formatSessionDate(scannedAt) < schoolYearStart(now)`), not on the raw UTC timestamp.
- Copy: card intro *Taps are kept for the current school year only. At the start of each year, export all history, then run both. Neither can be undone.*; empty states *Nothing older than this school year.* / *No graduated students on this device.*; buttons *Delete attendance before {Aug 1, YYYY}* / *Remove graduated students*; dialog eyebrow *Cannot be undone*; confirm labels *Delete permanently* / *Remove permanently*; done notices *Deleted {N taps} from {M sessions} before {date}.* / *Removed {S graduated students} and {T taps}.*
- Test ids: `section-retention`, `text-retention-history`, `text-retention-alumni`, `button-purge-history`, `button-remove-alumni`, `dialog-retention`, `text-retention-cost`, `text-retention-failed`, `button-retention-confirm`, `button-retention-cancel`, `text-retention-done`.
- Branch `retention/purge` from `main` at `d948641` or later. Commit per task with the session's attribution trailer.

---

## File structure

| File | Responsibility |
|---|---|
| `src/data/attendance-store.ts` (modify) | `HistoryPurge`, `AlumniRemoval`, `previewHistoryPurge`, `purgeHistoryBefore`, `previewAlumniRemoval`, `removeAlumni` |
| `src/data/attendance-store.test.ts` (modify) | boundary, legacy rows, roster untouched; alumni by id and by card; survivors intact |
| `src/ui/RetentionDialog.tsx` (create) | generic destructive confirmation |
| `src/ui/RetentionDialog.test.tsx` (create) | cost text, disabled while working, failure notice, Escape/cancel |
| `src/ui/Dashboard.tsx` (modify) | `retention` prop → `RetentionSection` |
| `src/dashboard/DashboardPage.tsx` (modify) | previews with the page, the two actions, logging, reload, notices |
| `src/dashboard/DashboardPage.test.tsx` (modify) | end to end for both actions |

---

### Task 0: Branch

- [ ] `git checkout -b retention/purge main`; the merged `main` was verified at 502 tests / typecheck clean minutes before.

### Task 1: The store functions

**Interfaces (produced):**

```ts
export type HistoryPurge = { tapCount: number; sessionCount: number };
export type AlumniRemoval = { studentCount: number; tapCount: number };
export async function previewHistoryPurge(isStale: (scannedAt: string) => boolean): Promise<HistoryPurge>;
export async function purgeHistoryBefore(isStale: (scannedAt: string) => boolean): Promise<HistoryPurge>;
export async function previewAlumniRemoval(isAlumni: (person: Person) => boolean): Promise<AlumniRemoval>;
export async function removeAlumni(isAlumni: (person: Person) => boolean): Promise<AlumniRemoval>;
```

- [ ] **Step 1: failing tests** — append to `src/data/attendance-store.test.ts` (add the four functions to the import):

```ts
describe('retention', () => {
  const BOUNDARY = '2026-08-01';
  const isStale = (scannedAt: string) => scannedAt.slice(0, 10) < BOUNDARY;

  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  async function seed() {
    const grad = await addPerson({ cardUid: '04AAAAAAAAAAAA', firstName: 'Grace', lastName: 'Old', gradYear: 2026, email: 'gold26@stjohnschs.org', enrolledAt: '2025-09-01T12:00:00.000Z' });
    const junior = await addPerson({ cardUid: '04BBBBBBBBBBBB', firstName: 'Jun', lastName: 'New', gradYear: 2028, email: 'jnew28@stjohnschs.org', enrolledAt: '2025-09-01T12:00:00.000Z' });
    // Last school year: two sessions, one of them 'legacy'.
    await recordSessionTap({ sessionId: 'legacy', uid: grad.cardUid, scannedAt: '2025-10-01T20:00:00.000Z', personId: grad.id as number });
    await recordSessionTap({ sessionId: 'old', uid: junior.cardUid, scannedAt: '2026-03-01T20:00:00.000Z', personId: junior.id as number });
    // The graduate's card, tapped before it was enrolled — matched by UID only.
    await recordSessionTap({ sessionId: 'old', uid: grad.cardUid, scannedAt: '2026-03-01T20:05:00.000Z', personId: null });
    // This school year.
    await recordSessionTap({ sessionId: 'new', uid: junior.cardUid, scannedAt: '2026-09-15T20:00:00.000Z', personId: junior.id as number });
    await recordSessionTap({ sessionId: 'new', uid: grad.cardUid, scannedAt: '2026-09-15T20:01:00.000Z', personId: grad.id as number });
    // A pre-enrollment row a v1/v2 database carried up.
    await withRawDatabase(async (raw) => {
      await raw.table('scans').bulkAdd([
        { uid: '04CCCCCCCCCCCC', scannedAt: '2025-09-10T20:00:00.000Z' },
        { uid: '04DDDDDDDDDDDD', scannedAt: '2026-09-10T20:00:00.000Z' },
      ]);
    });
    return { grad, junior };
  }

  it('previews and deletes only the taps before the boundary, and leaves the roster alone', async () => {
    const { grad, junior } = await seed();

    expect(await previewHistoryPurge(isStale)).toEqual({ tapCount: 3, sessionCount: 2 });
    expect(await purgeHistoryBefore(isStale)).toEqual({ tapCount: 3, sessionCount: 2 });

    const left = await listTapRecords();
    expect(left.map((tap) => tap.sessionId)).toEqual(['new', 'new']);
    expect((await listPersons()).map((person) => person.id).sort()).toEqual([grad.id, junior.id].sort());
    await withRawDatabase(async (raw) => {
      expect(await raw.table('scans').toArray()).toEqual([
        { uid: '04DDDDDDDDDDDD', scannedAt: '2026-09-10T20:00:00.000Z' },
      ]);
    });
    expect(await previewHistoryPurge(isStale)).toEqual({ tapCount: 0, sessionCount: 0 });
  });

  it('removes graduated students with every tap of theirs, by id and by card, and nobody else', async () => {
    const { grad, junior } = await seed();
    const isAlumni = (person: Person) => person.gradYear <= 2026;

    expect(await previewAlumniRemoval(isAlumni)).toEqual({ studentCount: 1, tapCount: 3 });
    expect(await removeAlumni(isAlumni)).toEqual({ studentCount: 1, tapCount: 3 });

    expect((await listPersons()).map((person) => person.id)).toEqual([junior.id]);
    const left = await listTapRecords();
    expect(left).toHaveLength(2);
    expect(left.every((tap) => tap.uid === junior.cardUid && tap.personId === junior.id)).toBe(true);
    expect(left.some((tap) => tap.uid === grad.cardUid)).toBe(false);
    expect(await previewAlumniRemoval(isAlumni)).toEqual({ studentCount: 0, tapCount: 0 });
  });
});
```

`Person` must be imported as a type in that test file if it is not already.

- [ ] **Step 2:** FAIL. **Step 3:** after `deletePerson` in `attendance-store.ts`:

```ts
/** What a history purge would take, or took. */
export type HistoryPurge = { tapCount: number; sessionCount: number };

/** What removing the graduated students would take, or took. */
export type AlumniRemoval = { studentCount: number; tapCount: number };

function summarizeTaps(taps: readonly TapRecord[]): HistoryPurge {
  return {
    tapCount: taps.length,
    sessionCount: new Set(taps.map((tap) => tap.sessionId)).size,
  };
}

/**
 * Taps older than a boundary the caller defines. The predicate is handed in
 * rather than a date because "before this school year" is a calendar
 * judgement in Eastern time, which the dashboard already knows how to make;
 * the store only knows timestamps.
 */
export async function previewHistoryPurge(
  isStale: (scannedAt: string) => boolean,
): Promise<HistoryPurge> {
  const taps = (await tapsTable.toArray()).filter((tap) => isStale(tap.scannedAt));
  return summarizeTaps(taps);
}

/**
 * Deletes every tap the predicate marks stale, and the same rows from the
 * legacy `scans` table. The roster is untouched: a card's identity outlives
 * its attendance record. One transaction over both tables.
 */
export async function purgeHistoryBefore(
  isStale: (scannedAt: string) => boolean,
): Promise<HistoryPurge> {
  return database.transaction('rw', scansTable, tapsTable, async () => {
    const stale = (await tapsTable.toArray()).filter((tap) => isStale(tap.scannedAt));
    await tapsTable.bulkDelete(
      stale.map((tap) => tap.id).filter((id): id is number => id !== undefined),
    );
    const staleScans = (await scansTable.toArray()).filter((scan) => isStale(scan.scannedAt));
    await scansTable.bulkDelete(staleScans.map((scan) => scan.uid));
    return summarizeTaps(stale);
  });
}

/** The graduates and every tap that resolves to them, by id or by card. */
async function alumniWithTaps(
  isAlumni: (person: Person) => boolean,
): Promise<{ alumni: Person[]; taps: TapRecord[] }> {
  const alumni = (await personsTable.toArray()).filter(isAlumni);
  const ids = new Set(alumni.map((person) => person.id));
  const cards = new Set(alumni.map((person) => person.cardUid));
  const taps = (await tapsTable.toArray()).filter(
    (tap) => (tap.personId !== null && ids.has(tap.personId)) || cards.has(tap.uid),
  );
  return { alumni, taps };
}

/**
 * Who would go, and how many taps with them. Grade is a calendar judgement
 * (`deriveGrade` in `attendance-export.ts`), so the caller passes the test.
 */
export async function previewAlumniRemoval(
  isAlumni: (person: Person) => boolean,
): Promise<AlumniRemoval> {
  const { alumni, taps } = await alumniWithTaps(isAlumni);
  return { studentCount: alumni.length, tapCount: taps.length };
}

/**
 * Removes every graduated student and their taps, exactly as `deletePerson`
 * would one at a time, in one transaction so the roster and the history
 * cannot disagree about who is gone.
 */
export async function removeAlumni(
  isAlumni: (person: Person) => boolean,
): Promise<AlumniRemoval> {
  return database.transaction('rw', personsTable, tapsTable, async () => {
    const { alumni, taps } = await alumniWithTaps(isAlumni);
    await tapsTable.bulkDelete(
      taps.map((tap) => tap.id).filter((id): id is number => id !== undefined),
    );
    await personsTable.bulkDelete(
      alumni.map((person) => person.id).filter((id): id is number => id !== undefined),
    );
    return { studentCount: alumni.length, tapCount: taps.length };
  });
}
```

- [ ] **Step 4–5:** pass; typecheck; commit `Add the two retention actions to the store: purge old taps, remove graduates`.

### Task 2: The confirmation dialog

**Interfaces (produced):** `RetentionDialog({ title, cost, failed?, isWorking, confirmLabel, onConfirm, onCancel })` — `cost: ReactNode` is the sentence naming what goes.

- [ ] **Step 1: tests** (`src/ui/RetentionDialog.test.tsx`): renders title and cost in `dialog-retention` / `text-retention-cost`; the eyebrow says *Cannot be undone*; confirm disabled while `isWorking`; `failed` shows `text-retention-failed` with *Nothing was deleted*; Escape and `button-retention-cancel` call `onCancel`; `button-retention-confirm` calls `onConfirm`; focus lands on Cancel first.
- [ ] **Step 2–5:** implement by copying `RemoveStudentDialog`'s scaffolding (focus trap, Escape, previously-focused restore, least-destructive-first) with the new props and ids; commit `A confirmation for the two retention actions`.

### Task 3: The dashboard section and the page

- [ ] **Step 1: tests** in `DashboardPage.test.tsx` — seed one graduated student (`gradYear = currentSeniorGradYear(now) - 1`) with a tap the day before `schoolYearStart(now)` and one this year, plus the existing two-session seed; assert `text-retention-history` names *1 tap across 1 session*, `text-retention-alumni` names *1 graduated student*; click `button-purge-history` → `dialog-retention` → confirm → the old tap is gone, `text-retention-done` says *Deleted 1 tap from 1 session before …*, the activity list's first row says *Deleted attendance*, the purge button is now disabled with *Nothing older than this school year.*; then `button-remove-alumni` → confirm → the graduate is gone from `listPersons`, the notice says *Removed 1 graduated student and …*, activity says *Removed graduated students*. A second test: with nothing to purge, both buttons are disabled.
- [ ] **Step 2–5:** `Dashboard.tsx` gains `retention?: { schoolYearStart: string; history: HistoryPurge | null; alumni: AlumniRemoval | null; onPurgeHistory: () => void; onRemoveAlumni: () => void }` and a `RetentionSection` card (icon `Archive`) between *Activity* and *Teacher PIN*. `DashboardPage.tsx` reads both previews in `load()` (`isStale = (at) => formatSessionDate(at) < schoolYearStart(now)`, `isAlumni = (p) => deriveGrade(p.gradYear, now) === 'Alumni'`), holds `retentionAction: 'history' | 'alumni' | null`, `retentionWorking`, `retentionFailed`, `retentionNotice`; on confirm runs the store function, records `purge-history` `{ taps, sessions, before }` or `remove-alumni` `{ students, taps }` (a failed log write appends *The activity log entry could not be written.* to the notice), then `await load()` so the numbers, previews and activity list all reflect the deletion. Commit `Delete last year's attendance and remove graduates from the dashboard, previewed and logged`.

### Task 4: Suite and merge

- [ ] `pnpm run typecheck && pnpm run test` green; merge `--no-ff` into `main`; re-verify; confirm the remote is untouched. Do not push.
