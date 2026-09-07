import React from 'react';
import Dexie from 'dexie';
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as attendanceStore from '@/data/attendance-store';
import {
  addPerson,
  countSessionAttendance,
  listPersons,
  listSessionIds,
  listSessionTapRecords,
  listTapRecords,
  type Person,
} from '@/data/attendance-store';
import { EnrollmentForm } from '@/ui/EnrollmentForm';
import { useAttendanceSession } from './use-attendance-session';

const existingUid = '04A1B2C3D4E5F6';
const newUid = '04F6E5D4C3B2A1';

const existingPerson: Omit<Person, 'id'> = {
  cardUid: existingUid,
  firstName: 'Jordan',
  lastName: 'Lee',
  gradYear: 2027,
  email: 'jlee27@stjohnschs.org',
  enrolledAt: '2026-09-01T10:00:00.000Z',
};

function renderEnrollmentForm(
  candidate: NonNullable<ReturnType<typeof useAttendanceSession>['enrollmentCandidate']>,
  onSave: ReturnType<typeof useAttendanceSession>['enrollPerson'],
) {
  return render(
    React.createElement(EnrollmentForm, {
      candidate,
      roster: [],
      isSaving: false,
      storageError: false,
      onSave,
      onCancel: () => undefined,
    }),
  );
}

async function waitForReady(
  result: { current: ReturnType<typeof useAttendanceSession> },
) {
  await waitFor(() => expect(result.current.isLoading).toBe(false));
}

describe('enrollment persistence', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('prefills and updates an existing card without duplicating its roster entry', async () => {
    const savedPerson = await addPerson(existingPerson);
    const { result } = renderHook(() => useAttendanceSession('enroll'));
    await waitForReady(result);

    await result.current.handleScan(existingUid);
    await waitFor(() => {
      expect(result.current.enrollmentCandidate?.person?.id).toBe(savedPerson.id);
    });

    renderEnrollmentForm(result.current.enrollmentCandidate!, result.current.enrollPerson);
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe(
      'Jordan',
    );
    expect((screen.getByLabelText('Last name') as HTMLInputElement).value).toBe(
      'Lee',
    );
    expect(
      (screen.getByLabelText('Graduation year') as HTMLInputElement).value,
    ).toBe('2027');
    expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe(
      'jlee27@stjohnschs.org',
    );

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('First name'));
    await user.type(screen.getByLabelText('First name'), 'Taylor');
    await user.clear(screen.getByLabelText('Last name'));
    await user.type(screen.getByLabelText('Last name'), 'Morgan');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(result.current.enrollmentCandidate).toBeNull();
    });
    const roster = await listPersons();
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      id: savedPerson.id,
      cardUid: existingUid,
      firstName: 'Taylor',
      lastName: 'Morgan',
      gradYear: 2027,
      // The stored address was the derived one, so renaming the student
      // re-derives it rather than leaving the previous name's address behind.
      email: 'tmorgan27@stjohnschs.org',
    });
  });

  it('creates exactly one roster entry for a new card enrollment', async () => {
    const { result } = renderHook(() => useAttendanceSession('enroll'));
    await waitForReady(result);

    await result.current.handleScan(newUid);
    await waitFor(() => {
      expect(result.current.enrollmentCandidate?.uid).toBe(newUid);
      expect(result.current.enrollmentCandidate?.person).toBeUndefined();
    });

    renderEnrollmentForm(result.current.enrollmentCandidate!, result.current.enrollPerson);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Avery');
    await user.type(screen.getByLabelText('Last name'), 'Chen');
    await user.type(screen.getByLabelText('Graduation year'), '2028');
    await user.click(screen.getByRole('button', { name: 'Save enrollment' }));

    await waitFor(() => {
      expect(result.current.enrollmentCandidate).toBeNull();
    });
    const roster = await listPersons();
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      cardUid: newUid,
      firstName: 'Avery',
      lastName: 'Chen',
      gradYear: 2028,
      email: 'achen28@stjohnschs.org',
    });
  });

  it('keeps a new enrollment available for retry after a storage failure', async () => {
    const addPersonSpy = vi
      .spyOn(attendanceStore, 'addPerson')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    const { result } = renderHook(() => useAttendanceSession('enroll'));
    await waitForReady(result);

    await result.current.handleScan(newUid);
    await waitFor(() => {
      expect(result.current.enrollmentCandidate?.uid).toBe(newUid);
    });

    const user = userEvent.setup();
    const form = render(
      React.createElement(EnrollmentForm, {
        candidate: result.current.enrollmentCandidate!,
        roster: result.current.persons,
        isSaving: result.current.isSaving,
        storageError: result.current.storageError,
        onSave: result.current.enrollPerson,
        onCancel: result.current.cancelEnrollment,
      }),
    );
    await user.type(screen.getByLabelText('First name'), 'Avery');
    await user.type(screen.getByLabelText('Last name'), 'Chen');
    await user.type(screen.getByLabelText('Graduation year'), '2028');
    await user.click(screen.getByRole('button', { name: 'Save enrollment' }));

    await waitFor(() => {
      expect(result.current.storageError).toBe(true);
    });
    form.rerender(
      React.createElement(EnrollmentForm, {
        candidate: result.current.enrollmentCandidate!,
        roster: result.current.persons,
        isSaving: result.current.isSaving,
        storageError: result.current.storageError,
        onSave: result.current.enrollPerson,
        onCancel: result.current.cancelEnrollment,
      }),
    );

    expect(result.current.enrollmentCandidate?.uid).toBe(newUid);
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe(
      'Avery',
    );
    expect((screen.getByLabelText('Last name') as HTMLInputElement).value).toBe(
      'Chen',
    );
    expect(
      (screen.getByLabelText('Graduation year') as HTMLInputElement).value,
    ).toBe('2028');
    expect(screen.getByRole('alert').textContent).toContain('Could not save locally');
    expect(await listPersons()).toHaveLength(0);
    addPersonSpy.mockRestore();
  });

  it('keeps an edited enrollment available for retry after an update failure', async () => {
    const savedPerson = await addPerson(existingPerson);
    const updatePersonSpy = vi
      .spyOn(attendanceStore, 'updatePerson')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    const { result } = renderHook(() => useAttendanceSession('enroll'));
    await waitForReady(result);

    await result.current.handleScan(existingUid);
    await waitFor(() => {
      expect(result.current.enrollmentCandidate?.person?.id).toBe(savedPerson.id);
    });

    const user = userEvent.setup();
    const form = render(
      React.createElement(EnrollmentForm, {
        candidate: result.current.enrollmentCandidate!,
        roster: result.current.persons,
        isSaving: result.current.isSaving,
        storageError: result.current.storageError,
        onSave: result.current.enrollPerson,
        onCancel: result.current.cancelEnrollment,
      }),
    );
    await user.clear(screen.getByLabelText('First name'));
    await user.type(screen.getByLabelText('First name'), 'Taylor');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(result.current.storageError).toBe(true);
    });
    form.rerender(
      React.createElement(EnrollmentForm, {
        candidate: result.current.enrollmentCandidate!,
        roster: result.current.persons,
        isSaving: result.current.isSaving,
        storageError: result.current.storageError,
        onSave: result.current.enrollPerson,
        onCancel: result.current.cancelEnrollment,
      }),
    );

    expect(result.current.enrollmentCandidate?.person?.id).toBe(savedPerson.id);
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe(
      'Taylor',
    );
    expect(screen.getByRole('alert').textContent).toContain('Could not save locally');
    const roster = await listPersons();
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      id: savedPerson.id,
      firstName: 'Jordan',
      lastName: 'Lee',
    });
    updatePersonSpy.mockRestore();
  });
});
describe('session history retention', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  afterEach(() => {
    cleanup();
  });

  async function scan(
    result: { current: ReturnType<typeof useAttendanceSession> },
    uid: string,
  ) {
    await act(async () => {
      await result.current.handleScan(uid);
    });
  }

  it("starts a new session without deleting the previous session's taps", async () => {
    await addPerson(existingPerson);
    const { result } = renderHook(() => useAttendanceSession('checkin'));
    await waitForReady(result);
    const firstSessionId = result.current.sessionId;

    await scan(result, existingUid);
    await scan(result, newUid);
    expect(result.current.taps).toHaveLength(2);
    expect(result.current.count).toBe(1);

    // The real flow: End Session shows the summary, then Start New Session.
    act(() => result.current.endSession());
    expect(result.current.sessionSummary).not.toBeNull();

    await act(async () => {
      await result.current.startNewSession();
    });

    const secondSessionId = result.current.sessionId;
    expect(secondSessionId).not.toBe(firstSessionId);
    // Rotating the session id must leave the earlier taps on disk: they are
    // the history a dashboard reads later, so "new session" is not "wipe".
    const history = await listTapRecords();
    expect(history.map((tap) => tap.sessionId)).toEqual([
      firstSessionId,
      firstSessionId,
    ]);
    expect(await countSessionAttendance(firstSessionId)).toBe(1);
    expect(await countSessionAttendance(secondSessionId)).toBe(0);
    expect(result.current.taps).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(result.current.sessionSummary).toBeNull();
    expect(result.current.isSaving).toBe(false);
  });

  it('scopes the count and taps to the current session while history accumulates', async () => {
    await addPerson(existingPerson);
    const { result } = renderHook(() => useAttendanceSession('checkin'));
    await waitForReady(result);
    const firstSessionId = result.current.sessionId;
    await scan(result, existingUid);
    await scan(result, newUid);
    await act(async () => {
      await result.current.startNewSession();
    });
    const secondSessionId = result.current.sessionId;

    // The same card again: in a fresh session it counts, rather than reading
    // as a duplicate of the earlier session's tap.
    await scan(result, existingUid);
    expect(result.current.feedback).toBe('valid');
    expect(result.current.count).toBe(1);
    expect(result.current.taps).toHaveLength(1);
    expect(result.current.taps[0].sessionId).toBe(secondSessionId);

    expect(await listTapRecords()).toHaveLength(3);
    expect(await listSessionIds()).toEqual([firstSessionId, secondSessionId]);

    // A reload picks up only the current session, not the whole history.
    cleanup();
    const { result: reloaded } = renderHook(() => useAttendanceSession('checkin'));
    await waitForReady(reloaded);
    expect(reloaded.current.sessionId).toBe(secondSessionId);
    expect(reloaded.current.taps).toHaveLength(1);
    expect(reloaded.current.count).toBe(1);
  });
});

describe('check-in outcomes', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function scan(
    result: { current: ReturnType<typeof useAttendanceSession> },
    uid: string,
  ) {
    await act(async () => {
      await result.current.handleScan(uid);
    });
  }

  it('counts an enrolled card once, then reads the second tap as a duplicate', async () => {
    const saved = await addPerson(existingPerson);
    const { result } = renderHook(() => useAttendanceSession('checkin'));
    await waitForReady(result);

    await scan(result, existingUid);
    expect(result.current.feedback).toBe('valid');
    expect(result.current.count).toBe(1);

    await scan(result, existingUid);
    expect(result.current.feedback).toBe('duplicate');
    // One attendance per card per session: the count holds where it was.
    expect(result.current.count).toBe(1);
    expect(await countSessionAttendance(result.current.sessionId)).toBe(1);

    // The second tap is still recorded — it is evidence the card was
    // presented — but it is stored uncounted so no total can double it.
    const stored = await listTapRecords();
    expect(stored.map((tap) => tap.counted)).toEqual([true, false]);
    expect(stored.every((tap) => tap.personId === saved.id)).toBe(true);
  });

  it('records a card nobody has enrolled without counting it', async () => {
    const { result } = renderHook(() => useAttendanceSession('checkin'));
    await waitForReady(result);

    await scan(result, newUid);

    expect(result.current.feedback).toBe('unknown');
    expect(result.current.lastPerson).toBeUndefined();
    expect(result.current.count).toBe(0);
    const stored = await listTapRecords();
    expect(stored).toHaveLength(1);
    // personId null and counted false is what lets a later enrollment credit
    // this tap retroactively (see tap-identity).
    expect(stored[0]).toMatchObject({ uid: newUid, personId: null, counted: false });
  });

  it('credits a card tapped while the opening read is still in flight', async () => {
    const saved = await addPerson(existingPerson);
    // The roster read hangs: this is the first second after a reload, with
    // "Checking local storage…" still on screen and a student already tapping.
    let releaseRead: (persons: Person[]) => void = () => undefined;
    vi.spyOn(attendanceStore, 'listPersons').mockReturnValue(
      new Promise<Person[]>((resolve) => {
        releaseRead = resolve;
      }),
    );
    const { result } = renderHook(() => useAttendanceSession('checkin'));
    expect(result.current.storageStatus).toBe('checking');

    await scan(result, existingUid);

    // The in-memory roster is still empty here, so resolving from it recorded
    // an enrolled student as an unknown card and told the volunteer to enroll
    // somebody who already is. The tap has to land counted as it happens.
    expect(result.current.feedback).toBe('valid');
    expect(result.current.count).toBe(1);
    expect(result.current.lastPerson?.id).toBe(saved.id);
    const [stored] = await listTapRecords();
    expect(stored).toMatchObject({
      uid: existingUid,
      personId: saved.id,
      counted: true,
    });

    await act(async () => {
      releaseRead([{ ...existingPerson, id: saved.id }]);
    });
  });

  it('does not let an older opening read roll back a committed tap', async () => {
    const saved = await addPerson(existingPerson);
    let releaseTapRead: () => void = () => undefined;
    const tapReadGate = new Promise<void>((resolve) => {
      releaseTapRead = resolve;
    });
    const listTapsSpy = vi
      .spyOn(attendanceStore, 'listSessionTapRecords')
      .mockImplementation(async () => {
        await tapReadGate;
        return [];
      });
    const countSpy = vi
      .spyOn(attendanceStore, 'countSessionAttendance')
      .mockImplementation(async () => {
        await tapReadGate;
        return 0;
      });
    const { result } = renderHook(() => useAttendanceSession('checkin'));

    await waitFor(() => expect(listTapsSpy).toHaveBeenCalledTimes(1));
    const scanning = result.current.handleScan(existingUid);
    await waitFor(async () => {
      expect(await listTapRecords()).toHaveLength(1);
    });
    expect(result.current.count).toBe(1);
    expect(result.current.taps[0]).toMatchObject({
      uid: existingUid,
      personId: saved.id,
      counted: true,
    });

    releaseTapRead();
    await act(async () => {
      await scanning;
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The opening read returned the pre-tap empty snapshot, but it must not
    // erase the tap the kiosk already showed as committed.
    expect(result.current.count).toBe(1);
    expect(result.current.taps).toHaveLength(1);
    expect(await listTapRecords()).toHaveLength(1);
  });

  it('writes nothing for a read that is not a 14-hex UID', async () => {
    await addPerson(existingPerson);
    const { result } = renderHook(() => useAttendanceSession('checkin'));
    await waitForReady(result);

    await scan(result, 'ZZZZ');

    expect(result.current.feedback).toBe('invalid');
    expect(result.current.count).toBe(0);
    expect(result.current.taps).toEqual([]);
    expect(await listTapRecords()).toEqual([]);
  });

  it('closes the session summary without touching the session', async () => {
    await addPerson(existingPerson);
    const { result } = renderHook(() => useAttendanceSession('checkin'));
    await waitForReady(result);
    const sessionIdBefore = result.current.sessionId;
    await scan(result, existingUid);

    act(() => result.current.endSession());
    expect(result.current.sessionSummary).not.toBeNull();

    act(() => result.current.dismissSummary());

    // Backing out of an accidental End Session costs nothing: same session id,
    // same count, same taps, and scanning works again.
    expect(result.current.sessionSummary).toBeNull();
    expect(result.current.sessionId).toBe(sessionIdBefore);
    expect(result.current.count).toBe(1);
    expect(result.current.taps).toHaveLength(1);

    await scan(result, newUid);
    expect(result.current.feedback).toBe('unknown');
    expect(await listTapRecords()).toHaveLength(2);
  });
});

describe('a repeat tap', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('reports when the student was counted, not when they tapped again', async () => {
    await addPerson(existingPerson);
    const { result } = renderHook(() => useAttendanceSession('checkin'));
    await waitForReady(result);

    await act(async () => {
      await result.current.handleScan(existingUid);
    });
    const countedAt = result.current.lastCountedAt;
    expect(countedAt).toBe(result.current.lastScannedAt);

    // Some time later the same card is tapped again. The panel promises a
    // time, so it has to be the check-in's, not this one's.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await act(async () => {
      await result.current.handleScan(existingUid);
    });

    expect(result.current.feedback).toBe('duplicate');
    expect(result.current.lastCountedAt).toBe(countedAt);
    expect(result.current.lastScannedAt).not.toBe(countedAt);
  });
});

describe('storage recovery', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const enrollmentDetails = {
    firstName: 'Avery',
    lastName: 'Chen',
    gradYear: 2028,
    email: 'achen28@stjohnschs.org',
  };

  it('reports a store that will not open, then recovers on retry', async () => {
    await addPerson(existingPerson);
    const listPersonsSpy = vi
      .spyOn(attendanceStore, 'listPersons')
      .mockRejectedValue(new Error('storage unavailable'));
    const { result } = renderHook(() => useAttendanceSession('checkin'));
    await waitForReady(result);

    expect(result.current.storageStatus).toBe('unavailable');
    expect(result.current.persons).toEqual([]);
    expect(result.current.storageError).toBe(true);

    // The retry runs the same read as boot, so recovery cannot drift from it.
    listPersonsSpy.mockRestore();
    await act(async () => {
      await result.current.retryStorage();
    });

    expect(result.current.storageStatus).toBe('ready');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.persons).toHaveLength(1);
  });

  it('will not open an enrollment while the store is unavailable', async () => {
    vi.spyOn(attendanceStore, 'listPersons').mockRejectedValue(
      new Error('storage unavailable'),
    );
    const { result } = renderHook(() => useAttendanceSession('enroll'));
    await waitForReady(result);
    expect(result.current.storageStatus).toBe('unavailable');

    await act(async () => {
      await result.current.handleScan(newUid);
    });

    // Details typed into a form that cannot save are details thrown away.
    expect(result.current.enrollmentCandidate).toBeNull();
    expect(result.current.feedback).toBe('storage-unavailable');
  });

  it('holds the candidate open after a failed enrollment save and clears on retry', async () => {
    vi.spyOn(attendanceStore, 'addPerson').mockRejectedValueOnce(
      new Error('write failed'),
    );
    const { result } = renderHook(() => useAttendanceSession('enroll'));
    await waitForReady(result);

    await act(async () => {
      await result.current.handleScan(newUid);
    });
    expect(result.current.enrollmentCandidate?.uid).toBe(newUid);

    await act(async () => {
      await result.current.enrollPerson(enrollmentDetails);
    });
    expect(result.current.storageStatus).toBe('save-failed');
    expect(result.current.enrollmentCandidate?.uid).toBe(newUid);
    expect(await listPersons()).toHaveLength(0);

    await act(async () => {
      await result.current.enrollPerson(enrollmentDetails);
    });
    expect(result.current.storageStatus).toBe('ready');
    expect(result.current.enrollmentCandidate).toBeNull();
    expect(await listPersons()).toHaveLength(1);
  });

  it('keeps an unread store unavailable even when a tap does save', async () => {
    await addPerson(existingPerson);
    const listPersonsSpy = vi
      .spyOn(attendanceStore, 'listPersons')
      .mockRejectedValue(new Error('storage unavailable'));
    const { result } = renderHook(() => useAttendanceSession('checkin'));
    await waitForReady(result);
    expect(result.current.storageStatus).toBe('unavailable');

    await act(async () => {
      await result.current.handleScan(existingUid);
    });

    // The write landed, but nothing has read the roster yet: calling that
    // 'ready' would take the panel and its Retry button away from an operator
    // whose device still is not readable.
    expect(await listTapRecords()).toHaveLength(1);
    await waitFor(() =>
      expect(result.current.storageStatus).toBe('unavailable'),
    );

    listPersonsSpy.mockRestore();
    await act(async () => {
      await result.current.retryStorage();
    });
    expect(result.current.storageStatus).toBe('ready');
  });

  // Note: this pins the end state, not the interleaving. The ordering bug it
  // was written for — a recovery read landing after the tap that overtook it,
  // rolling the count back — could not be reproduced deterministically under
  // jsdom; `refreshFromStore` queueing the read behind the scan is what
  // actually rules it out. What this does catch is the queue deadlocking or a
  // scan being dropped while a retry is in flight.
  it('applies both a retry and a tap that overlaps it', async () => {
    await addPerson(existingPerson);
    // A second enrolled card, so the racing tap is one that actually counts.
    await addPerson({
      ...existingPerson,
      cardUid: newUid,
      firstName: 'Priya',
      lastName: 'Nair',
      email: 'pnair27@stjohnschs.org',
    });
    const { result } = renderHook(() => useAttendanceSession('checkin'));
    await waitForReady(result);
    await act(async () => {
      await result.current.handleScan(existingUid);
    });
    expect(result.current.count).toBe(1);

    // Hold the recovery read open, then commit a tap while it is in flight.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realListPersons = attendanceStore.listPersons;
    vi.spyOn(attendanceStore, 'listPersons').mockImplementation(async () => {
      await gate;
      return realListPersons();
    });

    await act(async () => {
      const refreshing = result.current.retryStorage();
      const scanning = result.current.handleScan(newUid);
      release();
      await Promise.all([refreshing, scanning]);
    });

    expect(result.current.count).toBe(2);
    expect(await countSessionAttendance(result.current.sessionId)).toBe(2);
  });

  it('tells a taken address apart from a storage failure', async () => {
    await addPerson(existingPerson);
    // The form checks collisions against the roster it was handed, so reaching
    // the store's guard means that copy was stale — a second kiosk tab, say.
    vi.spyOn(attendanceStore, 'addPerson').mockRejectedValue(
      new attendanceStore.DuplicateEmailError({
        ...existingPerson,
        id: 1,
      }),
    );
    const { result } = renderHook(() => useAttendanceSession('enroll'));
    await waitForReady(result);
    await act(async () => {
      await result.current.handleScan(newUid);
    });

    await act(async () => {
      await result.current.enrollPerson({
        firstName: 'Avery',
        lastName: 'Chen',
        gradYear: 2028,
        email: existingPerson.email,
      });
    });

    // Storage is fine; blaming it sends the operator after the wrong problem,
    // and retrying the same address could only fail again.
    expect(result.current.storageStatus).toBe('ready');
    expect(result.current.storageError).toBe(false);
    expect(result.current.saveErrorMessage).toContain(existingPerson.email);
    // The typed details stay on screen so the address can be changed.
    expect(result.current.enrollmentCandidate).not.toBeNull();
  });

  it('does not invite a retry that cannot work while the store is unreadable', async () => {
    await addPerson(existingPerson);
    vi.spyOn(attendanceStore, 'listPersons').mockRejectedValue(
      new Error('storage unavailable'),
    );
    vi.spyOn(attendanceStore, 'recordSessionTap').mockRejectedValue(
      new Error('storage unavailable'),
    );
    const { result } = renderHook(() => useAttendanceSession('checkin'));
    await waitForReady(result);
    expect(result.current.storageStatus).toBe('unavailable');

    await act(async () => {
      await result.current.handleScan(existingUid);
    });

    // 'storage-error' reads "check browser storage and try again"; there is
    // nothing to retry here, and the card was not recorded.
    expect(result.current.feedback).toBe('storage-unavailable');
    expect(result.current.storageStatus).toBe('unavailable');
  });

  it('flags a tap that did not save and clears it on the next good tap', async () => {
    await addPerson(existingPerson);
    vi.spyOn(attendanceStore, 'recordSessionTap').mockRejectedValueOnce(
      new Error('write failed'),
    );
    const { result } = renderHook(() => useAttendanceSession('checkin'));
    await waitForReady(result);

    await act(async () => {
      await result.current.handleScan(existingUid);
    });
    expect(result.current.storageStatus).toBe('save-failed');
    expect(result.current.feedback).toBe('storage-error');
    expect(result.current.taps).toEqual([]);

    await act(async () => {
      await result.current.handleScan(existingUid);
    });
    expect(result.current.storageStatus).toBe('ready');
    expect(result.current.feedback).toBe('valid');
    expect(result.current.count).toBe(1);
  });
});
