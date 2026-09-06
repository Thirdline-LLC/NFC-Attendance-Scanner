import React from 'react';
import Dexie from 'dexie';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addPerson, listPersons, type Person } from '@/data/attendance-store';
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
      isSaving: false,
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
      email: 'jlee27@stjohnschs.org',
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
});