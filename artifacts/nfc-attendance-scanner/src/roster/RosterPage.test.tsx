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
  type BoundPerson,
} from '@/data/attendance-store';
import { RosterPage } from './RosterPage';

const DATABASE_NAME = 'attendance-scanner-local';

const jane: Omit<BoundPerson, 'id'> = {
  cardUid: '04A1B2C3D4E5F6',
  firstName: 'Jane',
  lastName: 'Smith',
  gradYear: 2027,
  email: 'jsmith27@stjohnschs.org',
  enrolledAt: '2026-09-01T12:00:00.000Z',
};

const ada: Omit<BoundPerson, 'id'> = {
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

  it('drops a save notice when a different student\u2019s editor is opened', async () => {
    const saved = await addPerson(jane);
    const other = await addPerson(ada);
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

    await user.click(screen.getByTestId(`button-edit-person-${other.id}`));

    // The notice is page-scoped state but belongs to one row: left standing,
    // it marks Ada's untouched editor as the one that failed to save.
    const form = await screen.findByTestId('form-enrollment');
    expect(within(form).queryByRole('alert')).toBeNull();
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

  it('warns that cards are not being recorded while this page is open', async () => {
    await addPerson(jane);
    renderPage();

    // The reader types into whatever has focus, and here that is nothing, so
    // a tap at the desk is swallowed. Saying so is the only honest option.
    const notice = await screen.findByTestId('text-scans-paused');
    expect(notice.textContent).toContain('not');
    expect(notice.textContent).toMatch(/not being recorded/i);
    expect(
      within(notice).getByTestId('link-scanner-resume').getAttribute('href'),
    ).toBe('/');
  });

  it('will not remove a student without asking, and says what it costs', async () => {
    const saved = await addPerson(jane);
    await attendanceStore.recordSessionTap({
      sessionId: 's1',
      uid: jane.cardUid,
      scannedAt: '2026-09-02T13:00:00.000Z',
      personId: saved.id as number,
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-manager');

    await user.click(screen.getByTestId(`button-remove-person-${saved.id}`));

    const dialog = await screen.findByTestId('dialog-remove-student');
    expect(dialog.textContent).toContain('Jane Smith');
    await waitFor(() =>
      expect(screen.getByTestId('text-removal-cost').textContent).toContain(
        '1 tap',
      ),
    );
    // Asking is not doing.
    expect(await listPersons()).toHaveLength(1);
  });

  it('keeps the student when the operator backs out', async () => {
    const saved = await addPerson(jane);
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-manager');

    await user.click(screen.getByTestId(`button-remove-person-${saved.id}`));
    await screen.findByTestId('dialog-remove-student');
    await user.click(screen.getByTestId('button-remove-cancel'));

    expect(screen.queryByTestId('dialog-remove-student')).toBeNull();
    expect(await listPersons()).toHaveLength(1);
    expect(screen.getByTestId(`row-person-${saved.id}`)).toBeTruthy();
  });

  it('removes the student and their taps once confirmed', async () => {
    const saved = await addPerson(jane);
    await attendanceStore.recordSessionTap({
      sessionId: 's1',
      uid: jane.cardUid,
      scannedAt: '2026-09-02T13:00:00.000Z',
      personId: saved.id as number,
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-manager');

    await user.click(screen.getByTestId(`button-remove-person-${saved.id}`));
    await screen.findByTestId('dialog-remove-student');
    await waitFor(() =>
      expect(
        screen.getByTestId('button-remove-confirm').hasAttribute('disabled'),
      ).toBe(false),
    );
    await user.click(screen.getByTestId('button-remove-confirm'));

    await waitFor(() =>
      expect(screen.queryByTestId('dialog-remove-student')).toBeNull(),
    );
    expect(await listPersons()).toEqual([]);
    expect(await attendanceStore.listTapRecords()).toEqual([]);
    expect(screen.queryByTestId(`row-person-${saved.id}`)).toBeNull();
    expect(screen.getByTestId('text-roster-removed').textContent).toContain(
      'Jane Smith',
    );
  });

  it('keeps everything and says so when the removal cannot be written', async () => {
    const saved = await addPerson(jane);
    vi.spyOn(attendanceStore, 'deletePerson').mockRejectedValue(
      new Error('storage unavailable'),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-manager');

    await user.click(screen.getByTestId(`button-remove-person-${saved.id}`));
    await screen.findByTestId('dialog-remove-student');
    await waitFor(() =>
      expect(
        screen.getByTestId('button-remove-confirm').hasAttribute('disabled'),
      ).toBe(false),
    );
    await user.click(screen.getByTestId('button-remove-confirm'));

    // The dialog stays, and says so inside itself: the page-level alert was
    // painted behind the dialog's own overlay, where nobody could read it.
    expect(await screen.findByTestId('text-remove-failed')).toBeTruthy();
    expect(screen.getByTestId('dialog-remove-student')).toBeTruthy();
    expect(await listPersons()).toHaveLength(1);
  });

  it('does not claim a student has no attendance when the check failed', async () => {
    const saved = await addPerson(jane);
    vi.spyOn(attendanceStore, 'previewPersonRemoval').mockRejectedValue(
      new Error('storage unavailable'),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-manager');

    await user.click(screen.getByTestId(`button-remove-person-${saved.id}`));

    // Substituting a zero cost would have said "has no attendance on this
    // device" before an irreversible delete, which is a different claim from
    // "we could not look".
    const cost = await screen.findByTestId('text-removal-cost');
    await waitFor(() =>
      expect(cost.textContent).toMatch(/would not say|not sure|may delete more/i),
    );
    expect(cost.textContent).not.toMatch(/no attendance on this device/i);
  });

});

describe('RosterPage activity log', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** Opens the Remove dialog for a student and confirms it. */
  async function removeStudent(personId: number) {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('roster-manager');
    await user.click(screen.getByTestId(`button-remove-person-${personId}`));
    await screen.findByTestId('dialog-remove-student');
    await waitFor(() =>
      expect(
        screen.getByTestId('button-remove-confirm').hasAttribute('disabled'),
      ).toBe(false),
    );
    await user.click(screen.getByTestId('button-remove-confirm'));
  }

  it('logs a removal as counts only', async () => {
    const saved = await addPerson(jane);
    await attendanceStore.recordSessionTap({
      sessionId: 's1',
      uid: jane.cardUid,
      scannedAt: '2026-09-02T13:00:00.000Z',
      personId: saved.id as number,
    });
    const record = vi.spyOn(attendanceStore, 'recordActivity').mockResolvedValue();

    await removeStudent(saved.id as number);

    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const [entry] = record.mock.calls[0];
    expect(entry).toMatchObject({ kind: 'remove-student', taps: 1, sessions: 1 });
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain('Jane');
    expect(serialised).not.toContain(jane.email);
    expect(serialised).not.toContain(jane.cardUid);
    expect(screen.getByTestId('text-roster-removed').textContent).not.toContain(
      'activity log',
    );
  });

  it('says when the removal could not be logged, and still removes', async () => {
    const saved = await addPerson(jane);
    vi.spyOn(attendanceStore, 'recordActivity').mockRejectedValue(new Error('quota'));

    await removeStudent(saved.id as number);

    await waitFor(() =>
      expect(screen.getByTestId('text-roster-removed').textContent).toContain(
        'The activity log entry could not be written.',
      ),
    );
    expect(await listPersons()).toHaveLength(0);
  });
});
