import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Person } from '@/data/attendance-store';
import { RosterManager } from './RosterManager';

afterEach(cleanup);

const janeSmith: Person = {
  id: 1,
  cardUid: '04A1B2C3D4E5F6',
  firstName: 'Jane',
  lastName: 'Smith',
  gradYear: 2027,
  // Exactly what the formula derives, so edits to the name keep updating it.
  email: 'jsmith27@stjohnschs.org',
  enrolledAt: '2026-09-01T12:00:00.000Z',
};

const elodieVanDerBerg: Person = {
  id: 2,
  cardUid: '04AABBCCDD1122',
  firstName: 'Élodie',
  lastName: 'Van Der Berg',
  gradYear: 2028,
  email: 'evanderberg28@stjohnschs.org',
  enrolledAt: '2026-09-01T12:01:00.000Z',
};

const adaLovelace: Person = {
  id: 3,
  cardUid: '04FFEEDDCCBB99',
  firstName: 'Ada',
  lastName: 'Lovelace',
  gradYear: 2027,
  email: 'alovelace27@stjohnschs.org',
  enrolledAt: '2026-09-01T12:02:00.000Z',
};

const luisDeLaCruz: Person = {
  id: 4,
  cardUid: '049988776655AA',
  firstName: 'Luis',
  // Lower-case on purpose: the sort must not push it after the capitalised names.
  lastName: 'de la Cruz',
  gradYear: 2029,
  email: 'ldelacruz29@stjohnschs.org',
  enrolledAt: '2026-09-01T12:03:00.000Z',
};

const bobSmith: Person = {
  id: 5,
  cardUid: '04B0B0B0B0B0B0',
  firstName: 'Bob',
  lastName: 'Smith',
  gradYear: 2027,
  email: 'bsmith27@stjohnschs.org',
  enrolledAt: '2026-09-01T12:04:00.000Z',
};

// Deliberately not in display order.
const roster: Person[] = [
  janeSmith,
  elodieVanDerBerg,
  adaLovelace,
  luisDeLaCruz,
  bobSmith,
];

type RosterProps = Parameters<typeof RosterManager>[0];

function renderRoster(overrides: Partial<RosterProps> = {}) {
  const onSave = vi.fn<RosterProps['onSave']>().mockResolvedValue(true);
  const props: RosterProps = {
    persons: roster,
    onSave,
    isSaving: false,
    saveError: false,
    ...overrides,
  };
  const view = render(<RosterManager {...props} />);

  return {
    onSave,
    user: userEvent.setup(),
    search: screen.getByLabelText('Search students') as HTMLInputElement,
    count: () => screen.getByTestId('text-roster-count').textContent,
    rowIds: () =>
      screen
        .getAllByTestId(/^row-person-/)
        .map((row) => row.getAttribute('data-testid')),
    rerender: (next: Partial<RosterProps>) =>
      view.rerender(<RosterManager {...props} {...next} />),
  };
}

function openEditor(user: ReturnType<typeof userEvent.setup>, id: number) {
  return user.click(screen.getByTestId(`button-edit-person-${id}`));
}

function editorFields() {
  const form = screen.getByTestId('form-enrollment');
  return {
    form,
    firstName: within(form).getByLabelText('First name') as HTMLInputElement,
    lastName: within(form).getByLabelText('Last name') as HTMLInputElement,
    gradYear: within(form).getByLabelText('Graduation year') as HTMLInputElement,
    email: within(form).getByTestId('input-email') as HTMLInputElement,
    submit: within(form).getByRole('button', { name: 'Save changes' }),
    cancel: within(form).getByRole('button', { name: 'Cancel' }),
  };
}

describe('RosterManager listing', () => {
  it('sorts by last name then first name, ignoring case and input order', () => {
    const { rowIds } = renderRoster();

    expect(rowIds()).toEqual([
      'row-person-4', // de la Cruz
      'row-person-3', // Lovelace
      'row-person-5', // Smith, Bob
      'row-person-1', // Smith, Jane
      'row-person-2', // Van Der Berg
    ]);
  });

  it('shows each student with a masked card and never the full UID', () => {
    renderRoster();

    const row = screen.getByTestId('row-person-1');
    expect(within(row).getByText('Jane')).toBeTruthy();
    expect(within(row).getByText('Smith')).toBeTruthy();
    expect(within(row).getByText('2027')).toBeTruthy();
    expect(within(row).getByText('jsmith27@stjohnschs.org')).toBeTruthy();
    expect(within(row).getByText('••••E5F6')).toBeTruthy();

    // Attributes count as much as text: nothing in the tree may carry the UID.
    for (const person of roster) {
      expect(document.body.innerHTML).not.toContain(person.cardUid);
    }
  });

  it('labels the columns for assistive technology', () => {
    renderRoster();

    const headers = screen
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual([
      'First name',
      'Last name',
      'Class of',
      'Email',
      'Card',
      'Actions',
    ]);
  });

  it('names each Edit button after its student', () => {
    renderRoster();

    expect(
      screen.getByRole('button', { name: 'Edit Jane Smith' }).getAttribute(
        'data-testid',
      ),
    ).toBe('button-edit-person-1');
  });

  it('counts the roster, singular and plural', () => {
    const { count, rerender } = renderRoster();
    expect(count()).toBe('5 students');

    rerender({ persons: [janeSmith] });
    expect(count()).toBe('1 student');
  });

  it('says so when nobody is enrolled yet', () => {
    const { count } = renderRoster({ persons: [] });

    expect(screen.getByTestId('text-roster-empty').textContent).toContain(
      'No students enrolled yet',
    );
    expect(screen.queryByTestId('table-roster')).toBeNull();
    expect(count()).toBe('0 students');
  });
});

describe('RosterManager search', () => {
  it('filters by first name and reports the narrowed count', async () => {
    const { user, search, rowIds, count } = renderRoster();

    await user.type(search, 'jane');

    expect(rowIds()).toEqual(['row-person-1']);
    expect(count()).toBe('1 of 5 students');
  });

  it('filters by last name regardless of case', async () => {
    const { user, search, rowIds, count } = renderRoster();

    await user.type(search, 'SMITH');

    expect(rowIds()).toEqual(['row-person-5', 'row-person-1']);
    expect(count()).toBe('2 of 5 students');
  });

  it('filters by a full name typed in either order', async () => {
    const { user, search, rowIds } = renderRoster();

    await user.type(search, 'jane sm');
    expect(rowIds()).toEqual(['row-person-1']);

    await user.clear(search);
    await user.type(search, 'smith bob');
    expect(rowIds()).toEqual(['row-person-5']);
  });

  it('does not match a run of letters that straddles first and last name', async () => {
    const { user, search } = renderRoster();

    await user.type(search, 'esm');

    expect(screen.queryByTestId('row-person-1')).toBeNull();
  });

  it('filters by email', async () => {
    const { user, search, rowIds } = renderRoster();

    // "alove" is in Ada's address but in nobody's name.
    await user.type(search, 'alove');

    expect(rowIds()).toEqual(['row-person-3']);
  });

  it('filters by the last four characters of a card, in any case', async () => {
    const { user, search, rowIds } = renderRoster();

    await user.type(search, 'e5f6');
    expect(rowIds()).toEqual(['row-person-1']);

    // A partial tail still finds the card.
    await user.clear(search);
    await user.type(search, 'F6');
    expect(rowIds()).toEqual(['row-person-1']);
  });

  it('finds a card from its whole UID, as a reader would type it', async () => {
    const { user, search, rowIds } = renderRoster();

    await user.type(search, '04ffeeddccbb99');

    expect(rowIds()).toEqual(['row-person-3']);
  });

  it('ignores accents when matching names', async () => {
    const { user, search, rowIds } = renderRoster();

    await user.type(search, 'Elodie');
    expect(rowIds()).toEqual(['row-person-2']);

    await user.clear(search);
    await user.type(search, 'élodie');
    expect(rowIds()).toEqual(['row-person-2']);
  });

  it('echoes a query that matches nobody', async () => {
    const { user, search, count } = renderRoster();

    await user.type(search, 'zzz');

    expect(screen.getByTestId('text-roster-no-match').textContent).toContain(
      'No students match “zzz”',
    );
    expect(screen.queryByTestId('table-roster')).toBeNull();
    expect(count()).toBe('0 of 5 students');
  });

  it('clears the query from the button beside the field', async () => {
    const { user, search, rowIds, count } = renderRoster();

    await user.type(search, 'zzz');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(search.value).toBe('');
    expect(rowIds()).toHaveLength(5);
    expect(count()).toBe('5 students');
  });

  it('starts from an initial query when given one', () => {
    const { search, rowIds } = renderRoster({ initialQuery: 'lovelace' });

    expect(search.value).toBe('lovelace');
    expect(rowIds()).toEqual(['row-person-3']);
  });
});

describe('RosterManager editing', () => {
  it('opens the enrollment form in place, prefilled with that student', async () => {
    const { user } = renderRoster();

    expect(screen.queryByTestId('form-enrollment')).toBeNull();
    await openEditor(user, 1);

    const { form, firstName, lastName, gradYear, email } = editorFields();
    expect(firstName.value).toBe('Jane');
    expect(lastName.value).toBe('Smith');
    expect(gradYear.value).toBe('2027');
    expect(email.value).toBe('jsmith27@stjohnschs.org');
    expect(form.textContent).toContain('Card ••••E5F6');
    expect(document.body.innerHTML).not.toContain(janeSmith.cardUid);

    // The editor sits directly under its own row.
    const editorRow = screen.getByTestId('row-editor-1');
    expect(screen.getByTestId('row-person-1').nextElementSibling).toBe(
      editorRow,
    );
    expect(
      screen.getByTestId('button-edit-person-1').getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('offers no field for the card itself', async () => {
    const { user } = renderRoster();

    await openEditor(user, 1);

    const inputs = within(screen.getByTestId('form-enrollment')).getAllByRole(
      'textbox',
    );
    // First name, last name and email; the graduation year is a spinbutton.
    expect(inputs).toHaveLength(3);
    expect(within(screen.getByTestId('form-enrollment')).queryByLabelText(/card/i)).toBeNull();
  });

  it('saves the edited values under the student id, with the email regenerated', async () => {
    const { user, onSave } = renderRoster();

    await openEditor(user, 1);
    const { firstName, gradYear, email, submit } = editorFields();

    await user.clear(firstName);
    await user.type(firstName, 'Janet');
    await user.clear(gradYear);
    await user.type(gradYear, '2028');
    expect(email.value).toBe('jsmith28@stjohnschs.org');

    await user.click(submit);

    expect(onSave).toHaveBeenCalledWith(1, {
      firstName: 'Janet',
      lastName: 'Smith',
      gradYear: 2028,
      email: 'jsmith28@stjohnschs.org',
    });
    await waitFor(() =>
      expect(screen.queryByTestId('form-enrollment')).toBeNull(),
    );
    expect(
      screen.getByTestId('button-edit-person-1').getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('stays open with the typed values when the save fails', async () => {
    const { user, onSave, rerender } = renderRoster();
    onSave.mockResolvedValue(false);

    await openEditor(user, 1);
    const { firstName, submit } = editorFields();
    await user.clear(firstName);
    await user.type(firstName, 'Janet');
    await user.click(submit);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // The container reports the failure through `saveError`; the roster
    // itself is unchanged, so the form keeps what was typed.
    rerender({ saveError: true });

    const fields = editorFields();
    expect(fields.firstName.value).toBe('Janet');
    expect(within(fields.form).getByRole('alert').textContent).toContain(
      'Could not save locally',
    );
  });

  it('closes the first editor when a second row is opened', async () => {
    const { user } = renderRoster();

    await openEditor(user, 1);
    expect(editorFields().firstName.value).toBe('Jane');

    await openEditor(user, 3);

    expect(screen.getAllByTestId('form-enrollment')).toHaveLength(1);
    expect(editorFields().firstName.value).toBe('Ada');
    expect(screen.queryByTestId('row-editor-1')).toBeNull();
    expect(screen.getByTestId('row-editor-3')).toBeTruthy();
  });

  it('closes from the form’s Cancel and from the row’s own button', async () => {
    const { user, onSave } = renderRoster();

    await openEditor(user, 1);
    await user.click(editorFields().cancel);
    expect(screen.queryByTestId('form-enrollment')).toBeNull();

    await openEditor(user, 1);
    await openEditor(user, 1);
    expect(screen.queryByTestId('form-enrollment')).toBeNull();

    expect(onSave).not.toHaveBeenCalled();
  });

  it('passes the saving state through to the form', async () => {
    const { user, rerender } = renderRoster();

    await openEditor(user, 1);
    rerender({ isSaving: true });

    const button = within(screen.getByTestId('form-enrollment')).getByRole(
      'button',
      { name: 'Saving locally…' },
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('keeps the row being edited visible when a search would hide it', async () => {
    const { user, search, rowIds } = renderRoster();

    await openEditor(user, 1);
    await user.type(search, 'lovelace');

    expect(rowIds()).toEqual(['row-person-3', 'row-person-1']);
    expect(editorFields().firstName.value).toBe('Jane');
  });

  it('notes a failed save at the top once no editor is open', () => {
    renderRoster({ saveError: true });

    expect(screen.getByRole('status').textContent).toContain(
      'could not be saved locally',
    );
  });
});
