import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPerson,
  clearAllAttendanceHistory,
  countSessionAttendance,
  getActiveBodyId,
  getAttendanceTarget,
  listActivity,
  listBodies,
  listPersons,
  listSessionIds,
  listSessionTapRecords,
  listTapRecords,
  recordSessionTap,
  type Person,
} from './attendance-store';
import { buildAttendanceRows } from '@/lib/attendance-export';
import { computeDashboardMetrics } from '@/lib/attendance-metrics';

/**
 * The migration chain against real databases rather than the current schema.
 *
 * Every one of these builds an older database with its own Dexie connection,
 * closes it, and then reaches it through the store, which opens at the current
 * version and therefore runs the upgraders on the way. The assertions are
 * deliberately end-to-end — what the export writes and what the dashboard
 * counts — because those are what a school actually loses if an upgrade
 * mangles a row.
 */

const DATABASE_NAME = 'attendance-scanner-local';
const LEGACY_SESSION_ID = 'legacy';

const ROSA_CARD = '04A1B2C3D4E5F6';
const KAI_CARD = '04FFEEDDCCBBAA';
const STRANGER_CARD = '0400112233445F';

const ROSA = {
  id: 1,
  cardUid: ROSA_CARD,
  firstName: 'Rosa',
  lastName: 'Alvarez',
  gradYear: 2027,
  email: 'ralvarez27@stjohnschs.org',
  enrolledAt: '2025-09-02T13:00:00.000Z',
};
const KAI = {
  id: 2,
  cardUid: KAI_CARD,
  firstName: 'Kai',
  lastName: 'Nakamura',
  gradYear: 2028,
  email: 'knakamura28@stjohnschs.org',
  enrolledAt: '2025-09-02T13:05:00.000Z',
};

/** A school-year `now` that all the seeded taps fall inside. */
const NOW = '2025-10-01T16:00:00.000Z';

/** Opens a second connection against whatever schema is on disk now. */
async function withRawDatabase<T>(work: (raw: Dexie) => Promise<T>): Promise<T> {
  const raw = new Dexie(DATABASE_NAME);
  await raw.open();
  try {
    return await work(raw);
  } finally {
    raw.close();
  }
}

/** A database frozen at version 1: the pre-enrollment `scans` table only. */
async function seedVersion1(): Promise<void> {
  const legacy = new Dexie(DATABASE_NAME);
  legacy.version(1).stores({ scans: 'uid, scannedAt' });
  await legacy.open();
  await legacy.table('scans').bulkAdd([
    { uid: ROSA_CARD, scannedAt: '2025-09-10T22:31:00.000Z' },
    { uid: STRANGER_CARD, scannedAt: '2025-09-10T22:33:00.000Z' },
  ]);
  legacy.close();
}

/** A database frozen at version 2: taps with no `sessionId` and no `counted`. */
async function seedVersion2(): Promise<void> {
  const legacy = new Dexie(DATABASE_NAME);
  legacy.version(1).stores({ scans: 'uid, scannedAt' });
  legacy.version(2).stores({
    scans: 'uid, scannedAt',
    persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
    taps: '++id, uid, scannedAt, personId',
  });
  await legacy.open();
  await legacy.table('persons').bulkAdd([ROSA, KAI]);
  await legacy.table('taps').bulkAdd([
    // Rosa at the September 10 meeting, and again when she came back in after
    // stepping out — one meeting, two taps.
    { uid: ROSA_CARD, scannedAt: '2025-09-10T22:31:00.000Z', personId: ROSA.id },
    { uid: ROSA_CARD, scannedAt: '2025-09-10T23:02:00.000Z', personId: ROSA.id },
    { uid: KAI_CARD, scannedAt: '2025-09-10T22:34:00.000Z', personId: KAI.id },
    // A card nobody has enrolled, seen at both meetings.
    { uid: STRANGER_CARD, scannedAt: '2025-09-10T22:40:00.000Z', personId: null },
    // The following week's meeting, which v2 had no way to tell apart.
    { uid: ROSA_CARD, scannedAt: '2025-09-17T22:30:00.000Z', personId: ROSA.id },
    { uid: STRANGER_CARD, scannedAt: '2025-09-17T22:41:00.000Z', personId: null },
  ]);
  legacy.close();
}

/**
 * A database frozen at version 3, indexes and all — including the `counted`
 * index and the two compound indexes over it that version 4 drops.
 */
async function seedVersion3(sessionId: string): Promise<void> {
  const legacy = new Dexie(DATABASE_NAME);
  legacy.version(1).stores({ scans: 'uid, scannedAt' });
  legacy.version(2).stores({
    scans: 'uid, scannedAt',
    persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
    taps: '++id, uid, scannedAt, personId',
  });
  legacy.version(3).stores({
    scans: 'uid, scannedAt',
    persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
    taps:
      '++id, uid, scannedAt, personId, sessionId, counted, [sessionId+uid+counted], [sessionId+counted]',
  });
  await legacy.open();
  await legacy.table('persons').bulkAdd([ROSA, KAI]);
  await legacy.table('taps').bulkAdd([
    {
      uid: ROSA_CARD,
      scannedAt: '2025-09-24T22:30:00.000Z',
      personId: ROSA.id,
      sessionId,
      counted: true,
    },
    {
      uid: ROSA_CARD,
      scannedAt: '2025-09-24T23:05:00.000Z',
      personId: ROSA.id,
      sessionId,
      counted: false,
    },
    {
      uid: KAI_CARD,
      scannedAt: '2025-09-24T22:36:00.000Z',
      personId: KAI.id,
      sessionId,
      counted: true,
    },
    {
      uid: STRANGER_CARD,
      scannedAt: '2025-09-24T22:44:00.000Z',
      personId: null,
      sessionId,
      counted: false,
    },
  ]);
  legacy.close();
}

describe('upgrading a version 1 database', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  it('opens, keeps its legacy scans, and records new attendance', async () => {
    await seedVersion1();

    // Reaching the store at all is the first assertion: a broken upgrader
    // throws here rather than returning wrong data.
    expect(await listTapRecords()).toEqual([]);
    expect(await listPersons()).toEqual([]);

    // v1 rows live in `scans`, which nothing migrates into `taps` — see the
    // note on the table in the store. They are still on disk, and are still
    // what `clearAllAttendanceHistory` exists to purge.
    const scanned = await withRawDatabase((raw) => raw.table('scans').toArray());
    expect(scanned.map((scan) => scan.uid)).toEqual([
      STRANGER_CARD,
      ROSA_CARD,
    ]);

    const rosa = await addPerson({
      cardUid: ROSA_CARD,
      firstName: ROSA.firstName,
      lastName: ROSA.lastName,
      gradYear: ROSA.gradYear,
      email: ROSA.email,
      enrolledAt: ROSA.enrolledAt,
    });
    const committed = await recordSessionTap({
      sessionId: 'first-session-after-upgrade',
      uid: ROSA_CARD,
      scannedAt: '2025-09-10T22:31:00.000Z',
      personId: rosa.id ?? null,
    });

    expect(committed.tap.counted).toBe(true);
    expect(committed.attendanceCount).toBe(1);

    await clearAllAttendanceHistory();
    expect(
      await withRawDatabase((raw) => raw.table('scans').count()),
    ).toBe(0);
  });
});

describe('upgrading a version 2 database', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  it('counts a student once in the legacy session however often they tapped', async () => {
    await seedVersion2();

    const taps = await listSessionTapRecords(LEGACY_SESSION_ID);
    expect(taps).toHaveLength(6);
    // One counted tap per card per session, exactly as `recordSessionTap`
    // would have written them. Rosa tapped four times across what used to be
    // two meetings; the legacy session is one session, so she counts once.
    expect(
      taps
        .filter((tap) => tap.counted)
        .map((tap) => `${tap.uid} ${tap.scannedAt}`),
    ).toEqual([
      `${ROSA_CARD} 2025-09-10T22:31:00.000Z`,
      `${KAI_CARD} 2025-09-10T22:34:00.000Z`,
    ]);
    expect(await countSessionAttendance(LEGACY_SESSION_ID)).toBe(2);
    expect(await listSessionIds()).toEqual([LEGACY_SESSION_ID]);
  });

  it('agrees with the attendance the dashboard computes for the same session', async () => {
    await seedVersion2();

    const metrics = computeDashboardMetrics(
      await listTapRecords(),
      await listPersons(),
      NOW,
    );

    expect(metrics.ytd.sessions).toHaveLength(1);
    const [session] = metrics.ytd.sessions;
    expect(session.sessionId).toBe(LEGACY_SESSION_ID);
    expect(session.tapCount).toBe(6);
    // The stored flag and the recomputed figure are two routes to the same
    // number; a migration that disagrees with the dashboard is a migration
    // that inflated somebody's attendance.
    expect(session.attendance).toBe(
      await countSessionAttendance(LEGACY_SESSION_ID),
    );
    expect(metrics.ytd.uniqueStudents).toBe(2);
    expect(metrics.unidentified).toMatchObject({
      tapCount: 2,
      cardCount: 1,
    });
  });

  it('exports every migrated tap, oldest first, resolved against the roster', async () => {
    await seedVersion2();

    const rows = buildAttendanceRows(await listTapRecords(), await listPersons());

    expect(rows).toHaveLength(6);
    expect(rows.map((row) => [row['Meeting Date'], row.Name, row.Grade])).toEqual(
      [
        ['2025-09-10', 'Rosa Alvarez', '11'],
        ['2025-09-10', 'Kai Nakamura', '10'],
        ['2025-09-10', 'Unknown card', ''],
        ['2025-09-10', 'Rosa Alvarez', '11'],
        ['2025-09-17', 'Rosa Alvarez', '11'],
        ['2025-09-17', 'Unknown card', ''],
      ],
    );
    // The two meetings the legacy session lumped together are still legible in
    // the export, because Meeting Date comes from the tap, not the session.
    expect(new Set(rows.map((row) => row['Meeting Date'])).size).toBe(2);
    expect(rows[0].Email).toBe(ROSA.email);
    expect(rows[2].Email).toBe('');
  });
});

describe('upgrading a version 3 database', () => {
  const SESSION_ID = 'session-from-v3';

  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  it('drops the unusable boolean indexes without touching the rows', async () => {
    await seedVersion3(SESSION_ID);

    // Read through the store first: that is what opens the database at the
    // current version and so what performs the upgrade. A raw connection
    // opened before it would still be looking at the version 3 schema.
    const taps = await listSessionTapRecords(SESSION_ID);

    const indexes = await withRawDatabase(async (raw) =>
      raw
        .table('taps')
        .schema.indexes.map((index) => index.name)
        .sort(),
    );
    // `counted` is a boolean and IndexedDB has no boolean key, so the index
    // over it and the two compound indexes that included it could never hold
    // an entry. Version 4 removes all three. `bodyId` is the version 7
    // backfill index, present because reading through the store upgrades all
    // the way to the current schema.
    expect(indexes).toEqual(['bodyId', 'personId', 'scannedAt', 'sessionId', 'uid']);

    // Oldest first, as `listSessionTapRecords` returns them.
    expect(taps.map((tap) => [tap.uid, tap.counted])).toEqual([
      [ROSA_CARD, true],
      [KAI_CARD, true],
      [STRANGER_CARD, false],
      [ROSA_CARD, false],
    ]);
    // The stored flags are respected as they stand: the v3 upgrader only fills
    // in what is missing, and this database had already decided.
    expect(await countSessionAttendance(SESSION_ID)).toBe(2);
  });

  it('still recognises a repeat tap once the index is gone', async () => {
    await seedVersion3(SESSION_ID);

    const repeat = await recordSessionTap({
      sessionId: SESSION_ID,
      uid: ROSA_CARD,
      scannedAt: '2025-09-24T23:40:00.000Z',
      personId: ROSA.id,
    });

    // `countSessionAttendance` walks the `sessionId` index and filters in
    // memory, so dropping the compound indexes cost it nothing.
    expect(repeat.priorCounted).toBe(true);
    expect(repeat.tap.counted).toBe(false);
    expect(repeat.attendanceCount).toBe(2);
  });

  it('exports and counts a migrated session correctly', async () => {
    await seedVersion3(SESSION_ID);

    const persons: Person[] = await listPersons();
    const taps = await listTapRecords();
    const metrics = computeDashboardMetrics(taps, persons, NOW);

    expect(metrics.ytd.sessionsCount).toBe(1);
    expect(metrics.ytd.sessions[0].attendance).toBe(
      await countSessionAttendance(SESSION_ID),
    );
    expect(metrics.unidentified.cards.map((card) => card.uid)).toEqual([
      STRANGER_CARD,
    ]);

    const rows = buildAttendanceRows(taps, persons);
    expect(rows.map((row) => row.Name)).toEqual([
      'Rosa Alvarez',
      'Kai Nakamura',
      'Unknown card',
      'Rosa Alvarez',
    ]);
    expect(rows.every((row) => row['Meeting Date'] === '2025-09-24')).toBe(true);
  });
});

describe('version 5 to 6', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

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

  it('opens a version 5 database at version 6 with every row intact and an empty log', async () => {
    await seedVersion5();

    expect((await listPersons()).map((person) => person.lastName)).toEqual([
      'Alvarez',
      'Nakamura',
    ]);
    expect(await listTapRecords()).toHaveLength(2);
    expect(await getAttendanceTarget()).toBe(35);
    expect(await listActivity()).toEqual([]);

    await withRawDatabase(async (raw) => {
      // Reading through the store upgrades all the way to the current
      // schema, not just to 6 — `bodies` and its backfill land too.
      expect(raw.verno).toBe(8);
      expect(raw.tables.map((table) => table.name).sort()).toEqual([
        'activity',
        'bodies',
        'persons',
        'scans',
        'settings',
        'taps',
      ]);
    });
  });
});

describe('version 6 to 7', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  /** A database frozen at version 6: every table before bodies existed. */
  async function seedVersion6(): Promise<void> {
    const legacy = new Dexie(DATABASE_NAME);
    legacy.version(6).stores({
      scans: 'uid, scannedAt',
      persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
      taps: '++id, uid, scannedAt, personId, sessionId',
      settings: 'key',
      activity: '++id, at, kind',
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
    legacy.close();
  }

  it('backfills a single body from current club semantics and assigns every row to it', async () => {
    await seedVersion6();

    const bodies = await listBodies();
    expect(bodies).toHaveLength(1);
    const [body] = bodies;

    const activeBodyId = await getActiveBodyId();
    expect(activeBodyId).toBe(body.id);
    expect(body.parentId).toBeNull();
    expect(body.sortOrder).toBe(0);

    // Every pre-existing person and tap belongs to the one backfilled body —
    // nothing is orphaned, and nothing is invented.
    expect((await listPersons()).map((person) => person.lastName)).toEqual([
      'Alvarez',
      'Nakamura',
    ]);
    expect(await listTapRecords()).toHaveLength(2);

    await withRawDatabase(async (raw) => {
      expect(raw.verno).toBe(8);
      const persons = await raw.table('persons').toArray();
      const taps = await raw.table('taps').toArray();
      expect(persons.every((person) => person.bodyId === body.id)).toBe(true);
      expect(taps.every((tap) => tap.bodyId === body.id)).toBe(true);
    });
  });
});

describe('version 7 to 8', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  /**
   * A database frozen at version 7: bodies exist, but they are a flat list
   * with no parent, sort order, or archive flag.
   */
  async function seedVersion7(): Promise<{ olderId: number; newerId: number }> {
    const legacy = new Dexie(DATABASE_NAME);
    legacy.version(7).stores({
      scans: 'uid, scannedAt',
      persons: '++id, &[bodyId+cardUid], lastName, gradYear, enrolledAt, bodyId',
      taps: '++id, uid, scannedAt, personId, sessionId, bodyId',
      settings: 'key',
      activity: '++id, at, kind',
      bodies: '++id, createdAt',
    });
    await legacy.open();
    const olderId = (await legacy.table('bodies').add({
      name: 'Older',
      typeLabel: 'group',
      createdAt: '2024-01-01T00:00:00.000Z',
    })) as number;
    const newerId = (await legacy.table('bodies').add({
      name: 'Newer',
      typeLabel: 'group',
      createdAt: '2025-06-01T00:00:00.000Z',
    })) as number;
    await legacy.table('persons').add({ ...ROSA, bodyId: olderId });
    await legacy.table('settings').put({
      key: 'active-body-id',
      value: String(newerId),
    });
    legacy.close();
    return { olderId, newerId };
  }

  it('turns flat bodies into roots and leaves the active body where it was', async () => {
    const { olderId, newerId } = await seedVersion7();

    const bodies = await listBodies();
    expect(bodies.map((body) => body.name)).toEqual(['Older', 'Newer']);
    expect(bodies.map((body) => body.parentId)).toEqual([null, null]);
    expect(bodies.map((body) => body.sortOrder)).toEqual([0, 1]);
    expect(await getActiveBodyId()).toBe(newerId);

    await withRawDatabase(async (raw) => {
      expect(raw.verno).toBe(8);
      const persons = await raw.table('persons').toArray();
      expect(persons).toHaveLength(1);
      expect(persons[0].bodyId).toBe(olderId);
      expect(persons[0].lastName).toBe('Alvarez');
    });
  });
});
