import Dexie from 'dexie';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as attendanceStore from '@/data/attendance-store';
import {
  addPerson,
  applyRosterImport,
  createClassWithPeriods,
  findTodaysSessionForBody,
  getActiveBodyId,
  getOrCreateSessionId,
  listTapsForBodies,
  recordSessionTap,
  setActiveBody,
  type ClassWithPeriods,
} from '@/data/attendance-store';
import { TapPendingError, useAttendanceSession } from './use-attendance-session';

// Synthetic students and card UIDs; example.com addresses only.
const AVA_CARD = '04AAAA00000001';
const BEN_CARD = '04BBBB00000002';

async function setUpClass(): Promise<{ periods: number[]; created: ClassWithPeriods }> {
  const created = await createClassWithPeriods({
    className: 'English 11',
    periodNames: ['Period 1', 'Period 3', 'Period 6'],
  });
  const periods = created.periods.map((period) => period.id as number);
  // Ava is in Period 1, Ben in Period 3: each body keeps its own roster.
  await setActiveBody(periods[0]);
  await addPerson({ cardUid: AVA_CARD, firstName: 'Ava', lastName: 'Sample', gradYear: 2027, email: 'ava@example.com', enrolledAt: '2026-09-01T12:00:00.000Z' });
  await setActiveBody(periods[1]);
  await addPerson({ cardUid: BEN_CARD, firstName: 'Ben', lastName: 'Sample', gradYear: 2027, email: 'ben@example.com', enrolledAt: '2026-09-01T12:00:00.000Z' });
  await setActiveBody(periods[0]);
  return { periods, created };
}

async function renderReady() {
  const hook = renderHook(() => useAttendanceSession('checkin'));
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

describe('useAttendanceSession.switchBody (Design 09 §3)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('starts a new session for a body with none today, leaving the old one as it was', async () => {
    const { periods } = await setUpClass();
    const { result } = await renderReady();
    await act(() => result.current.handleScan(AVA_CARD));
    const firstSession = result.current.sessionId;
    expect(result.current.count).toBe(1);

    await act(() => result.current.switchBody(periods[1]));

    expect(await getActiveBodyId()).toBe(periods[1]);
    expect(result.current.sessionId).not.toBe(firstSession);
    // The device's current session is the new one, so a reload carries on in it.
    expect(getOrCreateSessionId()).toBe(result.current.sessionId);
    expect(result.current.count).toBe(0);
    expect(result.current.taps).toEqual([]);
    // Ben is on this period's roster; Ava is not.
    expect(result.current.persons.map((person) => person.firstName)).toEqual(['Ben']);

    await act(() => result.current.handleScan(BEN_CARD));
    expect(result.current.count).toBe(1);

    const taps = await listTapsForBodies(periods);
    const period1 = taps.filter((tap) => tap.bodyId === periods[0]);
    const period3 = taps.filter((tap) => tap.bodyId === periods[1]);
    expect(period1.map((tap) => tap.sessionId)).toEqual([firstSession]);
    expect(period3.map((tap) => tap.sessionId)).toEqual([result.current.sessionId]);
    // A session never spans two bodies.
    expect(new Set(period1.map((tap) => tap.sessionId))).not.toContain(period3[0].sessionId);
  });

  it('joins the new body’s own session for today when it already has one', async () => {
    const { periods } = await setUpClass();
    // Period 3 met earlier today under its own session.
    await setActiveBody(periods[1]);
    await recordSessionTap({
      sessionId: 'period-3-morning',
      uid: BEN_CARD,
      scannedAt: new Date(Date.now() - 60_000).toISOString(),
      personId: 2,
    });
    await setActiveBody(periods[0]);

    const { result } = await renderReady();
    await act(() => result.current.switchBody(periods[1]));

    expect(result.current.sessionId).toBe('period-3-morning');
    expect(getOrCreateSessionId()).toBe('period-3-morning');
    await waitFor(() => expect(result.current.taps).toHaveLength(1));
    expect(result.current.count).toBe(1);

    // Ben tapping again is a repeat in the joined session, not a new count.
    await act(() => result.current.handleScan(BEN_CARD));
    expect(result.current.count).toBe(1);
    expect(result.current.feedback).toBe('duplicate');
  });

  it('switching back to a body joins the session it left, not a new one', async () => {
    const { periods } = await setUpClass();
    const { result } = await renderReady();
    await act(() => result.current.handleScan(AVA_CARD));
    const period1Session = result.current.sessionId;

    await act(() => result.current.switchBody(periods[1]));
    await act(() => result.current.switchBody(periods[0]));

    expect(result.current.sessionId).toBe(period1Session);
    expect(result.current.count).toBe(1);
  });

  it('does not join a session from an earlier day', async () => {
    const { periods } = await setUpClass();
    await setActiveBody(periods[1]);
    await recordSessionTap({
      sessionId: 'period-3-last-week',
      uid: BEN_CARD,
      scannedAt: new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString(),
      personId: 2,
    });
    expect(await findTodaysSessionForBody(periods[1])).toBeNull();
    await setActiveBody(periods[0]);

    const { result } = await renderReady();
    await act(() => result.current.switchBody(periods[1]));

    expect(result.current.sessionId).not.toBe('period-3-last-week');
    expect(result.current.count).toBe(0);
  });

  it('writes a tap read before the switch against the body it was read on', async () => {
    const { periods } = await setUpClass();
    const { result } = await renderReady();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = attendanceStore.recordSessionTap;
    vi.spyOn(attendanceStore, 'recordSessionTap').mockImplementationOnce(async (input) => {
      await gate;
      return real(input);
    });

    let scan!: Promise<void>;
    let switched!: Promise<void>;
    act(() => {
      scan = result.current.handleScan(AVA_CARD);
    });
    await waitFor(() => expect(result.current.pendingTap).toBe('scan'));
    act(() => {
      switched = result.current.switchBody(periods[1]);
    });
    // Still on Period 1 while the tap is being written.
    expect(await getActiveBodyId()).toBe(periods[0]);

    release();
    await act(async () => {
      await scan;
      await switched;
    });

    const taps = await listTapsForBodies(periods);
    expect(taps).toHaveLength(1);
    expect(taps[0].bodyId).toBe(periods[0]);
    expect(await getActiveBodyId()).toBe(periods[1]);
    expect(result.current.pendingTap).toBeNull();
  });

  it('rejoins the session the desk was running for a body, even one with no taps yet', async () => {
    const { periods } = await setUpClass();
    const { result } = await renderReady();
    await act(() => result.current.handleScan(AVA_CARD));
    const morning = result.current.sessionId;
    // The teacher starts a fresh session on Period 1, then the desk moves on.
    await act(() => result.current.startNewSession());
    const fresh = result.current.sessionId;
    expect(fresh).not.toBe(morning);

    await act(() => result.current.switchBody(periods[1]));
    await act(() => result.current.switchBody(periods[0]));

    // Not the older session that holds Period 1's latest tap.
    expect(result.current.sessionId).toBe(fresh);
    expect(result.current.count).toBe(0);
  });

  it('refuses the switch, keeping the tap, when an unknown card read just before it opened the prompt', async () => {
    const { periods } = await setUpClass();
    // Someone on Period 1's roster has no card yet, so an unknown card opens the prompt.
    await applyRosterImport([{ firstName: 'Cal', lastName: 'Sample', gradYear: 2028, email: 'cal@example.com' }]);
    const { result } = await renderReady();

    let scan!: Promise<void>;
    let switched!: Promise<void>;
    act(() => {
      // The card lands in the queue first; the switch is queued behind it.
      scan = result.current.handleScan('04DEADBEEF1234');
      switched = result.current.switchBody(periods[1]);
    });
    await act(async () => {
      await scan;
      await expect(switched).rejects.toBeInstanceOf(TapPendingError);
    });

    expect(await getActiveBodyId()).toBe(periods[0]);
    expect(result.current.bindCandidate?.uid).toBe('04DEADBEEF1234');
    expect(result.current.pendingTap).toBe('unknown-card');
  });

  it('changes nothing when the store refuses the switch', async () => {
    const { periods } = await setUpClass();
    const { result } = await renderReady();
    await act(() => result.current.handleScan(AVA_CARD));
    const before = result.current.sessionId;
    vi.spyOn(attendanceStore, 'setActiveBody').mockRejectedValueOnce(new Error('blocked'));

    await act(async () => {
      await expect(result.current.switchBody(periods[1])).rejects.toThrow('blocked');
    });

    expect(await getActiveBodyId()).toBe(periods[0]);
    expect(result.current.sessionId).toBe(before);
    expect(getOrCreateSessionId()).toBe(before);
    expect(result.current.count).toBe(1);
  });
});

describe('useAttendanceSession.pendingTap', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('is null with nothing in the queue', async () => {
    await setUpClass();
    const { result } = await renderReady();
    expect(result.current.pendingTap).toBeNull();
  });

  it('is "enroll" while the enrollment form is open, and clears on cancel', async () => {
    await setUpClass();
    const hook = renderHook(() => useAttendanceSession('enroll'));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    await act(() => hook.result.current.handleScan('04CCCC00000003'));
    await waitFor(() => expect(hook.result.current.pendingTap).toBe('enroll'));
    act(() => hook.result.current.cancelEnrollment());
    expect(hook.result.current.pendingTap).toBeNull();
  });
});
