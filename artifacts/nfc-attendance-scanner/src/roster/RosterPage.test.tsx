import Dexie from 'dexie';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as attendanceStore from '@/data/attendance-store';
import {
  addPerson,
  DuplicateEmailError,
  listPersons,
  type Person,
} from '@/data/attendance-store';
import { RosterPage } from './RosterPage';

const DATABASE_NAME = 'attendance-scanner-local';

const jane: Omit<Person, 'id'> = {
  cardUid: '04A1B2C3D4E5F6',
  firstName: 'Jane',
  lastName: 'Smith',
  gradYear: 2027,
  email: 'jsmith27@stjohnschs.org',
  enrolledAt: '2026-09-01T12:00:00.000Z',
};

const ada: Omit<Person, 'id'> = {
  cardUid: '04FFEEDDCCBB99',
  firstName: 'Ada',
  lastName: 'Lovelace',
  gradYear: 2028,
  email: 'alovelace28@stjohnschs.org',
  enrolledAt: '2026-09-01T12:02:00.000Z',
};

/** The page links back to the scanner, so it needs a router around it. */
function renderPage() {
  return render(
    <MemoryRouter>
      <RosterPage />
    </MemoryRouter>,
  );
}

/** Opens a student's editor and hands back the fields the tests drive. */
async function openEditor(user: ReturnType<typeof userEvent.setup>, personId: number) {
  await user.click(screen.getByTestId(`button-edit-person-${personId}`));
  const form = await screen.findByTestId('form-enrollment');
  return {
    form,
    firstName: within(form).getByLabelText('First name') as HTMLInputElement,
    submit: within(form).getByRole('button', { name: 'Save changes' }),
  };
}

describe('RosterPage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the loading notice, then lists the students on this device', async () => {
    const saved = await addPerson(jane);
    await addPerson(ada);
    renderPage();

    expect(screen.getByTestId('text-roster-loading')).toBeTruthy();

    expect(await screen.findByTestId('roster-manager')).toBeTruthy();
    expect(screen.getByTestId('text-roster-count').textContent).toBe('2 students');
    expect(screen.getByTestId(`row-person-${saved.id}`).textContent).toContain('Smith');
    // Only the tail of a card is ever rendered.
    expect(screen.getByTestId(`text-card-tail-${saved.id}`).textContent).toBe(
      '••••E5F6',
    );
  });

  it('offers a retry when the roster cannot be read, and lists it once the read succeeds', async () => {
    await addPerson(jane);
    const read = vi
      .spyOn(attendanceStore, 'listPersons')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByTestId('text-roster-load-error')).toBeTruthy();
    expect(screen.queryByTestId('roster-manager')).toBeNull();

    read.mockRestore();
    await user.click(screen.getByTestId('button-roster-retry'));

    expect(await screen.findByTestId('roster-manager')).toBeTruthy();
    expect(screen.queryByTestId('text-roster-load-error')).toBeNull();
  });

  it('writes an edit through the store and shows the new values without reloading', async () => {
    const saved = await addPerson(jane);
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-manager');

    const editor = await openEditor(user, saved.id as number);
    await user.clear(editor.firstName);
    await user.type(editor.firstName, 'Janet');
    await user.click(editor.submit);

    // The editor closes only on a persisted write, so its absence is the signal.
    await waitFor(() =>
      expect(screen.queryByTestId(`row-editor-${saved.id}`)).toBeNull(),
    );
    expect(screen.getByTestId(`row-person-${saved.id}`).textContent).toContain(
      'Janet',
    );
    const stored = await listPersons();
    expect(stored[0].firstName).toBe('Janet');
    // The card is the hardware identity and is never rewritten by an edit.
    expect(stored[0].cardUid).toBe(jane.cardUid);
  });

  it('names the student holding the address when the store rejects a duplicate email', async () => {
    const saved = await addPerson(jane);
    const owner = await addPerson(ada);
    vi.spyOn(attendanceStore, 'updatePerson').mockRejectedValue(
      new DuplicateEmailError(owner),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-manager');

    const editor = await openEditor(user, saved.id as number);
    await user.clear(editor.firstName);
    await user.type(editor.firstName, 'Janet');
    await user.click(editor.submit);

    const notice = await screen.findByTestId('text-roster-save-error');
    expect(notice.textContent).toContain('Ada Lovelace');
    expect(notice.textContent).toContain(ada.email);
    // The rejected edit stays on screen so it can be corrected, not retyped.
    expect(screen.getByTestId(`row-editor-${saved.id}`)).toBeTruthy();
    expect(editor.firstName.value).toBe('Janet');
  });

  it('keeps the editor open with a save-error notice when the write fails for any other reason', async () => {
    const saved = await addPerson(jane);
    vi.spyOn(attendanceStore, 'updatePerson').mockRejectedValue(
      new Error('write failed'),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-manager');

    const editor = await openEditor(user, saved.id as number);
    await user.clear(editor.firstName);
    await user.type(editor.firstName, 'Janet');
    await user.click(editor.submit);

    await waitFor(() =>
      expect(within(editor.form).getByRole('alert').textContent).toContain(
        'Could not save locally.',
      ),
    );
    expect(screen.getByTestId(`row-editor-${saved.id}`)).toBeTruthy();
    expect(editor.firstName.value).toBe('Janet');
    // A failed write is not a duplicate, so the email notice must stay away.
    expect(screen.queryByTestId('text-roster-save-error')).toBeNull();
    expect(screen.getByTestId(`row-person-${saved.id}`).textContent).toContain(
      'Jane',
    );
  });
});
