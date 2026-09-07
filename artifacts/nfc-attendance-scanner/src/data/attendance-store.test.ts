import Dexie from 'dexie';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addPerson,
  countSessionAttendance,
  DuplicateEmailError,
  listPersons,
  listSessionTapRecords,
  updatePerson,
} from './attendance-store';
import { useAttendanceSession } from '@/scanner/use-attendance-session';

const DATABASE_NAME = 'attendance-scanner-local';
const LEGACY_SESSION_ID = 'legacy';
const EXISTING_SESSION_ID = 'existing-session';

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
