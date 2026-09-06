import Dexie from 'dexie';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  countSessionAttendance,
  listSessionTapRecords,
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
