import Dexie from 'dexie';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACTIVITY_LOG_CAP,
  addPerson,
  clearAllAttendanceHistory,
  countSessionAttendance,
  DEFAULT_ATTENDANCE_TARGET,
  deletePerson,
  getAttendanceTarget,
  DuplicateEmailError,
  getPinRequired,
  listPersons,
  listSessionIds,
  listSessionTapRecords,
  listActivity,
  listTapRecords,
  previewAlumniRemoval,
  previewHistoryPurge,
  previewPersonRemoval,
  purgeHistoryBefore,
  recordActivity,
  recordSessionTap,
  removeAlumni,
  setAttendanceTarget,
  setPinRequired,
  updatePerson,
  writeSetting,
  type Person,
} from './attendance-store';
import { useAttendanceSession } from '@/scanner/use-attendance-session';

const DATABASE_NAME = 'attendance-scanner-local';

/**
 * A second connection opened against whatever schema is already on disk, for
 * the legacy `scans` table the store no longer exposes any helper for.
 */
async function withRawDatabase<T>(
  work: (raw: Dexie) => Promise<T>,
): Promise<T> {
  const raw = new Dexie(DATABASE_NAME);
  await raw.open();
  try {
    return await work(raw);
  } finally {
    raw.close();
  }
}
const LEGACY_SESSION_ID = 'legacy';
const EXISTING_SESSION_ID = 'existing-session';

describe('addPerson', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  it('does not stamp the generated id onto the caller\u2019s object', async () => {
    // Dexie writes the key back onto whatever object it is handed. Left alone,
    // reusing that object — spreading a fixture, retrying a failed save — sends
    // somebody else's primary key into the next insert, which surfaces as a
    // ConstraintError nowhere near the cause.
    const details = {
      cardUid: '04A1B2C3D4E5F6',
      firstName: 'Jordan',
      lastName: 'Lee',
      gradYear: 2027,
      email: 'jlee27@stjohnschs.org',
      enrolledAt: '2026-09-01T10:00:00.000Z',
    };

    const saved = await addPerson(details);

    expect(saved.id).toBeTypeOf('number');
    expect(details).not.toHaveProperty('id');

    // The reused object must still be insertable as a different student.
    const second = await addPerson({
      ...details,
      cardUid: '04F6E5D4C3B2A1',
      email: 'jlee28@stjohnschs.org',
    });
    expect(second.id).not.toBe(saved.id);
    expect(await listPersons()).toHaveLength(2);
  });
});

describe('the attendance target', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  it('falls back to the default until one is set', async () => {
    expect(await getAttendanceTarget()).toBe(DEFAULT_ATTENDANCE_TARGET);
  });

  it('stores and returns a club-sized target', async () => {
    await setAttendanceTarget(12);
    expect(await getAttendanceTarget()).toBe(12);

    // Setting it again replaces rather than accumulating rows.
    await setAttendanceTarget(30);
    expect(await getAttendanceTarget()).toBe(30);
  });

  it('refuses a target that is not a whole number in range', async () => {
    for (const bad of [0, -5, 1.5, Number.NaN, 10_001]) {
      await expect(setAttendanceTarget(bad)).rejects.toThrow(RangeError);
    }
    // Nothing was written, so the default still stands.
    expect(await getAttendanceTarget()).toBe(DEFAULT_ATTENDANCE_TARGET);
  });

  it('treats an unusable stored value as absent', async () => {
    await setAttendanceTarget(12);
    // Simulating a hand-edited or corrupted row: the dashboard must still
    // render, and showing the default beats refusing to draw.
    const raw = new Dexie('attendance-scanner-local');
    raw.version(5).stores({
      scans: 'uid, scannedAt',
      persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
      taps: '++id, uid, scannedAt, personId, sessionId',
      settings: 'key',
    });
    await raw.open();
    await raw.table('settings').put({ key: 'attendance-target', value: 'nope' });
    raw.close();

    expect(await getAttendanceTarget()).toBe(DEFAULT_ATTENDANCE_TARGET);
  });

  it('survives an upgrade from a database that had no settings table', async () => {
    const legacy = new Dexie('attendance-scanner-local');
    legacy.version(4).stores({
      scans: 'uid, scannedAt',
      persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
      taps: '++id, uid, scannedAt, personId, sessionId',
    });
    await legacy.open();
    legacy.close();

    // v5 adds the table; an existing kiosk must open and read the default.
    expect(await getAttendanceTarget()).toBe(DEFAULT_ATTENDANCE_TARGET);
    await setAttendanceTarget(25);
    expect(await getAttendanceTarget()).toBe(25);
  });
});

describe('the pin-required setting', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  it('defaults to required, including on a device that has never set it', async () => {
    expect(await getPinRequired()).toBe(true);
  });

  it('stores and returns false, then true again', async () => {
    await setPinRequired(false);
    expect(await getPinRequired()).toBe(false);

    await setPinRequired(true);
    expect(await getPinRequired()).toBe(true);
  });

  it('treats a corrupted stored value as required, not as off', async () => {
    // A row that is neither 'true' nor 'false' — hand-edited or from some
    // future format — must fail closed: only the literal 'false' turns the
    // gate off.
    await writeSetting('pin-required', 'nope');
    expect(await getPinRequired()).toBe(true);
  });
});

describe('deletePerson', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  const jane = {
    cardUid: '04A1B2C3D4E5F6',
    firstName: 'Jane',
    lastName: 'Smith',
    gradYear: 2027,
    email: 'jsmith27@stjohnschs.org',
    enrolledAt: '2026-09-01T12:00:00.000Z',
  };
  const bob = {
    cardUid: '04FFEEDDCCBB99',
    firstName: 'Bob',
    lastName: 'Nolan',
    gradYear: 2028,
    email: 'bnolan28@stjohnschs.org',
    enrolledAt: '2026-09-01T12:01:00.000Z',
  };

  it('removes the student and every tap that resolves to them', async () => {
    const saved = await addPerson(jane);
    const other = await addPerson(bob);
    await recordSessionTap({
      sessionId: 's1',
      uid: jane.cardUid,
      scannedAt: '2026-09-02T13:00:00.000Z',
      personId: saved.id as number,
    });
    await recordSessionTap({
      sessionId: 's2',
      uid: jane.cardUid,
      scannedAt: '2026-09-03T13:00:00.000Z',
      personId: saved.id as number,
    });
    await recordSessionTap({
      sessionId: 's2',
      uid: bob.cardUid,
      scannedAt: '2026-09-03T13:05:00.000Z',
      personId: other.id as number,
    });

    const removed = await deletePerson(saved.id as number);

    expect(removed).toEqual({ tapCount: 2, sessionCount: 2 });
    expect((await listPersons()).map((p) => p.email)).toEqual([bob.email]);
    // Bob is untouched: a removal must take exactly one student with it.
    const remaining = await listTapRecords();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].uid).toBe(bob.cardUid);
  });

  it('takes the taps recorded before the card was ever enrolled', async () => {
    // These carry personId null and are matched to their student by UID, so an
    // id-only delete would leave rows the export still resolves to them.
    await recordSessionTap({
      sessionId: 's1',
      uid: jane.cardUid,
      scannedAt: '2026-09-02T13:00:00.000Z',
      personId: null,
    });
    const saved = await addPerson(jane);

    const removed = await deletePerson(saved.id as number);

    expect(removed.tapCount).toBe(1);
    expect(await listTapRecords()).toEqual([]);
  });

  it('leaves nothing carrying the removed card', async () => {
    const saved = await addPerson(jane);
    await recordSessionTap({
      sessionId: 's1',
      uid: jane.cardUid,
      scannedAt: '2026-09-02T13:00:00.000Z',
      personId: saved.id as number,
    });

    await deletePerson(saved.id as number);

    // The card is still in somebody's wallet; a row carrying its UID would be
    // a detached record, not an erased one.
    const everything = JSON.stringify([
      await listPersons(),
      await listTapRecords(),
    ]);
    expect(everything).not.toContain(jane.cardUid);
    expect(everything).not.toContain('jsmith27');
  });

  it('frees the card and the address for a fresh enrolment', async () => {
    const saved = await addPerson(jane);
    await deletePerson(saved.id as number);

    // &cardUid is unique and the store rejects a duplicate address, so a
    // removal that left either behind would block re-enrolling the card.
    const reEnrolled = await addPerson({ ...jane, firstName: 'Janet' });

    expect(reEnrolled.id).not.toBe(saved.id);
    expect(await listPersons()).toHaveLength(1);
  });

  it('reports the cost before anything is removed', async () => {
    const saved = await addPerson(jane);
    await recordSessionTap({
      sessionId: 's1',
      uid: jane.cardUid,
      scannedAt: '2026-09-02T13:00:00.000Z',
      personId: saved.id as number,
    });

    const preview = await previewPersonRemoval(saved.id as number);

    expect(preview).toEqual({ tapCount: 1, sessionCount: 1 });
    // A preview must not be a removal.
    expect(await listPersons()).toHaveLength(1);
    expect(await listTapRecords()).toHaveLength(1);
  });

  it('refuses an id that is not enrolled', async () => {
    await expect(deletePerson(999)).rejects.toThrow('999');
  });
});

describe('attendance store migrations', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
  });

  it('preserves legacy taps and restores the correct session attendance after upgrading', async () => {
    const legacyDatabase = new Dexie(DATABASE_NAME);
    legacyDatabase.version(1).stores({ scans: 'uid, scannedAt' });
    legacyDatabase.version(2).stores({
      scans: 'uid, scannedAt',
      persons: '++id, &cardUid, lastName, gradYear, enrolledAt',
      taps: '++id, uid, scannedAt, personId',
    });
    await legacyDatabase.open();
    await legacyDatabase.table('taps').bulkAdd([
      {
        uid: 'known-card',
        scannedAt: '2026-09-06T09:00:00.000Z',
        personId: 42,
      },
      {
        uid: 'unknown-card',
        scannedAt: '2026-09-06T09:01:00.000Z',
        personId: null,
      },
      {
        uid: 'existing-duplicate',
        scannedAt: '2026-09-06T09:02:00.000Z',
        personId: 42,
        sessionId: EXISTING_SESSION_ID,
        counted: false,
      },
      {
        uid: 'existing-attendance',
        scannedAt: '2026-09-06T09:03:00.000Z',
        personId: null,
        sessionId: EXISTING_SESSION_ID,
        counted: true,
      },
    ]);
    legacyDatabase.close();

    localStorage.setItem(
      'attendance-scanner-current-session',
      LEGACY_SESSION_ID,
    );

    const legacyTaps = await listSessionTapRecords(LEGACY_SESSION_ID);
    expect(legacyTaps).toEqual([
      expect.objectContaining({
        uid: 'known-card',
        personId: 42,
        sessionId: LEGACY_SESSION_ID,
        counted: true,
      }),
      expect.objectContaining({
        uid: 'unknown-card',
        personId: null,
        sessionId: LEGACY_SESSION_ID,
        counted: false,
      }),
    ]);
    expect(await countSessionAttendance(LEGACY_SESSION_ID)).toBe(1);

    const existingSessionTaps =
      await listSessionTapRecords(EXISTING_SESSION_ID);
    expect(existingSessionTaps).toEqual([
      expect.objectContaining({
        uid: 'existing-duplicate',
        personId: 42,
        sessionId: EXISTING_SESSION_ID,
        counted: false,
      }),
      expect.objectContaining({
        uid: 'existing-attendance',
        personId: null,
        sessionId: EXISTING_SESSION_ID,
        counted: true,
      }),
    ]);
    expect(await countSessionAttendance(EXISTING_SESSION_ID)).toBe(1);

    const { result } = renderHook(() => useAttendanceSession('checkin'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.taps).toHaveLength(2);
    expect(result.current.metrics).toEqual({
      uniqueAttendance: 1,
      totalTaps: 2,
      duplicateTaps: 0,
      unknownCards: 1,
    });
    expect(result.current.count).toBe(1);
    expect(result.current.storageError).toBe(false);
  });
});

describe('roster email uniqueness', () => {
  const jane = {
    cardUid: '04A1',
    firstName: 'Jane',
    lastName: 'Smith',
    gradYear: 2027,
    email: 'jsmith27@stjohnschs.org',
    enrolledAt: '2026-09-01T12:00:00.000Z',
  };
  const jordan = {
    cardUid: '04B2',
    firstName: 'Jordan',
    lastName: 'Smith',
    gradYear: 2027,
    email: 'jsmith271@stjohnschs.org',
    enrolledAt: '2026-09-01T12:05:00.000Z',
  };

  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
  });

  it('refuses a second student on an address already in use', async () => {
    await addPerson(jane);

    await expect(
      addPerson({ ...jordan, email: jane.email }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
    expect(await listPersons()).toHaveLength(1);
  });

  it('matches duplicates regardless of case and surrounding space', async () => {
    await addPerson(jane);

    await expect(
      addPerson({ ...jordan, email: '  JSmith27@StJohnsCHS.org  ' }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('names the student already holding the address', async () => {
    await addPerson(jane);

    await expect(
      addPerson({ ...jordan, email: jane.email }),
    ).rejects.toThrow(/Jane Smith, class of 2027/);
  });

  it('accepts a distinct address for the second student', async () => {
    await addPerson(jane);
    await addPerson(jordan);

    expect(await listPersons()).toHaveLength(2);
  });

  it('stops an edit from taking another student\'s address', async () => {
    await addPerson(jane);
    const saved = await addPerson(jordan);

    await expect(
      updatePerson(saved.id!, {
        firstName: jordan.firstName,
        lastName: jordan.lastName,
        gradYear: jordan.gradYear,
        email: jane.email,
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);

    const roster = await listPersons();
    expect(roster.find((person) => person.id === saved.id)?.email).toBe(
      jordan.email,
    );
  });

  it('lets a student keep their own address while another field changes', async () => {
    const saved = await addPerson(jane);

    const updated = await updatePerson(saved.id!, {
      firstName: 'Janet',
      lastName: jane.lastName,
      gradYear: jane.gradYear,
      email: jane.email,
    });

    expect(updated.firstName).toBe('Janet');
    expect(updated.email).toBe(jane.email);
  });
});

describe('attendance history', () => {
  const CARD_A = '04A1B2C3D4E5F6';
  const CARD_B = '04F6E5D4C3B2A1';
  const jane = {
    cardUid: CARD_A,
    firstName: 'Jane',
    lastName: 'Smith',
    gradYear: 2027,
    email: 'jsmith27@stjohnschs.org',
    enrolledAt: '2026-09-01T12:00:00.000Z',
  };

  const unknownTap = (sessionId: string, uid: string, scannedAt: string) => ({
    sessionId,
    uid,
    scannedAt,
    personId: null,
  });

  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  it('lists every tap across sessions, oldest first', async () => {
    await recordSessionTap(unknownTap('later', CARD_A, '2026-09-08T13:00:00.000Z'));
    await recordSessionTap(unknownTap('earlier', CARD_A, '2026-09-01T13:00:00.000Z'));

    expect((await listTapRecords()).map((tap) => tap.sessionId)).toEqual([
      'earlier',
      'later',
    ]);
  });

  it('lists each session id once, ordered by its first tap', async () => {
    // Inserted out of time order with the sessions interleaved, so the result
    // cannot be insertion order by accident.
    await recordSessionTap(unknownTap('later', CARD_A, '2026-09-08T13:00:00.000Z'));
    await recordSessionTap(unknownTap('earlier', CARD_A, '2026-09-01T13:00:00.000Z'));
    await recordSessionTap(unknownTap('later', CARD_B, '2026-09-08T13:05:00.000Z'));
    await recordSessionTap(unknownTap('earlier', CARD_B, '2026-09-01T13:05:00.000Z'));

    expect(await listSessionIds()).toEqual(['earlier', 'later']);
  });

  it('reports no sessions before anything has been recorded', async () => {
    expect(await listSessionIds()).toEqual([]);
  });

  it('clearAllAttendanceHistory wipes taps and legacy scans but keeps the roster', async () => {
    const saved = await addPerson(jane);
    await recordSessionTap({
      sessionId: 'first',
      uid: jane.cardUid,
      scannedAt: '2026-09-01T13:00:00.000Z',
      personId: saved.id!,
    });
    await recordSessionTap({
      sessionId: 'second',
      uid: jane.cardUid,
      scannedAt: '2026-09-08T13:00:00.000Z',
      personId: saved.id!,
    });
    // Nothing in the app writes `scans` any more, so the only way a row gets
    // there is an upgraded pre-enrollment database. Seed one the same way.
    await withRawDatabase((raw) =>
      raw
        .table('scans')
        .put({ uid: jane.cardUid, scannedAt: '2026-08-20T13:00:00.000Z' }),
    );

    await clearAllAttendanceHistory();

    expect(await listTapRecords()).toEqual([]);
    expect(await listSessionIds()).toEqual([]);
    expect(
      await withRawDatabase((raw) => raw.table('scans').toArray()),
    ).toEqual([]);
    // A card's identity outlives its attendance record.
    expect(await listPersons()).toEqual([
      expect.objectContaining({ id: saved.id, cardUid: jane.cardUid }),
    ]);
  });
});

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
    expect(all[1]).toMatchObject({
      filename: expect.stringContaining('.xlsx'),
      taps: 12,
    });

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

describe('retention', () => {
  const BOUNDARY = '2026-08-01';
  const isStale = (scannedAt: string) => scannedAt.slice(0, 10) < BOUNDARY;

  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  async function seed() {
    const grad = await addPerson({
      cardUid: '04AAAAAAAAAAAA',
      firstName: 'Grace',
      lastName: 'Old',
      gradYear: 2026,
      email: 'gold26@stjohnschs.org',
      enrolledAt: '2025-09-01T12:00:00.000Z',
    });
    const junior = await addPerson({
      cardUid: '04BBBBBBBBBBBB',
      firstName: 'Jun',
      lastName: 'New',
      gradYear: 2028,
      email: 'jnew28@stjohnschs.org',
      enrolledAt: '2025-09-01T12:00:00.000Z',
    });
    // Last school year: two sessions, one of them 'legacy'.
    await recordSessionTap({
      sessionId: 'legacy',
      uid: grad.cardUid,
      scannedAt: '2025-10-01T20:00:00.000Z',
      personId: grad.id as number,
    });
    await recordSessionTap({
      sessionId: 'old',
      uid: junior.cardUid,
      scannedAt: '2026-03-01T20:00:00.000Z',
      personId: junior.id as number,
    });
    // The graduate's card, tapped before it was enrolled — matched by UID only.
    await recordSessionTap({
      sessionId: 'old',
      uid: grad.cardUid,
      scannedAt: '2026-03-01T20:05:00.000Z',
      personId: null,
    });
    // This school year.
    await recordSessionTap({
      sessionId: 'new',
      uid: junior.cardUid,
      scannedAt: '2026-09-15T20:00:00.000Z',
      personId: junior.id as number,
    });
    await recordSessionTap({
      sessionId: 'new',
      uid: grad.cardUid,
      scannedAt: '2026-09-15T20:01:00.000Z',
      personId: grad.id as number,
    });
    // Pre-enrollment rows a v1/v2 database carried up.
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
    expect((await listPersons()).map((person) => person.id).sort()).toEqual(
      [grad.id, junior.id].sort(),
    );
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
    expect(
      left.every((tap) => tap.uid === junior.cardUid && tap.personId === junior.id),
    ).toBe(true);
    expect(left.some((tap) => tap.uid === grad.cardUid)).toBe(false);
    expect(await previewAlumniRemoval(isAlumni)).toEqual({ studentCount: 0, tapCount: 0 });
  });
});
