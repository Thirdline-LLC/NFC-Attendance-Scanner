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
