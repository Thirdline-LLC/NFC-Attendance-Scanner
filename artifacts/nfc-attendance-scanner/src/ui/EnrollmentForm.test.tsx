import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EnrollmentForm } from './EnrollmentForm';

afterEach(cleanup);

function renderForm(overrides: Partial<Parameters<typeof EnrollmentForm>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();

  render(
    <EnrollmentForm
      candidate={{ uid: '04A1B2C3' }}
      roster={[]}
      isSaving={false}
      storageError={false}
      onSave={onSave}
      onCancel={onCancel}
      {...overrides}
    />,
  );

  return {
    onSave,
    onCancel,
    user: userEvent.setup(),
    firstName: screen.getByLabelText('First name'),
    lastName: screen.getByLabelText('Last name'),
    gradYear: screen.getByLabelText('Graduation year'),
    email: screen.getByTestId('input-email') as HTMLInputElement,
    regenerate: screen.getByTestId('button-regenerate-email'),
    submit: screen.getByRole('button', { name: /^Save (enrollment|changes)$/ }),
  };
}

describe('EnrollmentForm email derivation', () => {
  it('fills the email in live as the name and graduation year change', async () => {
    const { user, firstName, lastName, gradYear, email } = renderForm();

    expect(email.value).toBe('');

    await user.type(firstName, 'Jane');
    expect(email.value).toBe('');

    await user.type(lastName, 'Smith');
    expect(email.value).toBe('');

    await user.type(gradYear, '2027');
    expect(email.value).toBe('jsmith27@stjohnschs.org');
  });

  it('keeps following the derived value as the fields are corrected', async () => {
    const { user, firstName, lastName, gradYear, email } = renderForm();

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');
    expect(email.value).toBe('jsmith27@stjohnschs.org');

    await user.clear(lastName);
    await user.type(lastName, "O'Brien-Smith");
    expect(email.value).toBe('jobriensmith27@stjohnschs.org');

    await user.clear(gradYear);
    await user.type(gradYear, '2028');
    expect(email.value).toBe('jobriensmith28@stjohnschs.org');
  });

  it('folds a 4-digit graduation year down to two digits', async () => {
    const { user, firstName, lastName, gradYear, email } = renderForm();

    await user.type(firstName, 'Luis');
    await user.type(lastName, 'De La Cruz');
    await user.type(gradYear, '2005');

    expect(email.value).toBe('ldelacruz05@stjohnschs.org');
  });

  it('strips accents from the derived address', async () => {
    const { user, firstName, lastName, gradYear, email } = renderForm();

    await user.type(firstName, 'José');
    await user.type(lastName, 'Núñez');
    await user.type(gradYear, '2027');

    expect(email.value).toBe('jnunez27@stjohnschs.org');
  });
});

describe('EnrollmentForm manual override', () => {
  it('freezes the automatic proposal once the email is typed into', async () => {
    const { user, firstName, lastName, gradYear, email } = renderForm();

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');
    expect(email.value).toBe('jsmith27@stjohnschs.org');

    await user.clear(email);
    await user.type(email, 'jane.smith@stjohnschs.org');
    expect(email.value).toBe('jane.smith@stjohnschs.org');

    // Later edits to the derivation inputs must not clobber the manual entry.
    await user.clear(lastName);
    await user.type(lastName, 'Smithson');
    await user.clear(gradYear);
    await user.type(gradYear, '2029');

    expect(email.value).toBe('jane.smith@stjohnschs.org');
  });

  it('labels the field as edited and rejects an address outside the domain', async () => {
    const { user, firstName, lastName, gradYear, email } = renderForm();

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');
    expect(screen.getByText('auto')).toBeTruthy();

    await user.clear(email);
    await user.type(email, 'jane@gmail.com');

    expect(screen.getByText('edited')).toBeTruthy();
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(
      screen.getByText('Must be an address in the stjohnschs.org domain.'),
    ).toBeTruthy();
  });

  it('allows an in-domain address that the formula cannot produce', async () => {
    const { user, firstName, lastName, gradYear, email } = renderForm();

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');

    // The second Jane Smith of 2027 collides with the derived address.
    await user.clear(email);
    await user.type(email, 'jsmith271@stjohnschs.org');

    expect(email.getAttribute('aria-invalid')).toBe('false');
    expect(
      screen.getByText(
        'Not the standard [initial][last name][yy] format — it will be saved as typed.',
      ),
    ).toBeTruthy();
  });

  it('follows the name and year again when the stored address was auto-filled', async () => {
    const { user, gradYear, email } = renderForm({
      candidate: {
        uid: '04A1B2C3',
        person: {
          id: 7,
          cardUid: '04A1B2C3',
          firstName: 'Jane',
          lastName: 'Smith',
          gradYear: 2027,
          // Exactly what the formula produces, so it was never hand-entered.
          email: 'jsmith27@stjohnschs.org',
          enrolledAt: '2026-09-01T12:00:00.000Z',
        },
      },
    });

    expect(email.value).toBe('jsmith27@stjohnschs.org');

    await user.clear(gradYear);
    await user.type(gradYear, '2028');

    expect(email.value).toBe('jsmith28@stjohnschs.org');
  });

  it('keeps a stored address when editing an existing enrollment', async () => {
    const { user, gradYear, email } = renderForm({
      candidate: {
        uid: '04A1B2C3',
        person: {
          id: 7,
          cardUid: '04A1B2C3',
          firstName: 'Jane',
          lastName: 'Smith',
          gradYear: 2027,
          email: 'legacy.smith@stjohnschs.org',
          enrolledAt: '2026-09-01T12:00:00.000Z',
        },
      },
    });

    expect(email.value).toBe('legacy.smith@stjohnschs.org');

    await user.clear(gradYear);
    await user.type(gradYear, '2028');

    expect(email.value).toBe('legacy.smith@stjohnschs.org');
  });
});

describe('EnrollmentForm regenerate', () => {
  it('resets a manual entry back to the derived address', async () => {
    const { user, firstName, lastName, gradYear, email, regenerate } =
      renderForm();

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');

    await user.clear(email);
    await user.type(email, 'jane@gmail.com');
    expect(email.value).toBe('jane@gmail.com');

    await user.click(regenerate);

    expect(email.value).toBe('jsmith27@stjohnschs.org');
    expect(screen.getByText('auto')).toBeTruthy();
  });

  it('recalculates from the latest name and year, not the values at override time', async () => {
    const { user, firstName, lastName, gradYear, email, regenerate } =
      renderForm();

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');

    await user.clear(email);
    await user.type(email, 'typo@stjohnschs.org');

    await user.clear(firstName);
    await user.type(firstName, 'Ada');
    await user.clear(lastName);
    await user.type(lastName, 'Van Der Berg');
    await user.clear(gradYear);
    await user.type(gradYear, '2030');

    await user.click(regenerate);

    expect(email.value).toBe('avanderberg30@stjohnschs.org');
  });

  it('resumes live updates after regenerating', async () => {
    const { user, firstName, lastName, gradYear, email, regenerate } =
      renderForm();

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');

    await user.clear(email);
    await user.type(email, 'jane@gmail.com');
    await user.click(regenerate);

    await user.clear(gradYear);
    await user.type(gradYear, '2031');

    expect(email.value).toBe('jsmith31@stjohnschs.org');
  });

  it('is disabled while the field already matches the derived address', async () => {
    const { user, firstName, lastName, gradYear, email, regenerate } =
      renderForm();

    expect((regenerate as HTMLButtonElement).disabled).toBe(true);

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');
    expect((regenerate as HTMLButtonElement).disabled).toBe(true);

    await user.clear(email);
    expect((regenerate as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('EnrollmentForm submission', () => {
  it('saves the derived address', async () => {
    const { user, firstName, lastName, gradYear, submit, onSave } =
      renderForm();

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');
    await user.click(submit);

    expect(onSave).toHaveBeenCalledWith({
      firstName: 'Jane',
      lastName: 'Smith',
      gradYear: 2027,
      email: 'jsmith27@stjohnschs.org',
    });
  });

  it('trims the values it hands over, whichever screen is saving', async () => {
    const { user, firstName, lastName, gradYear, submit, onSave } =
      renderForm();

    await user.type(firstName, '  Jane ');
    await user.type(lastName, ' Smith  ');
    await user.type(gradYear, '2027');
    await user.click(submit);

    // Both the scanner and the roster editor save through this form, and only
    // one of them used to trim: a stray space reached the export's Name column
    // from one route and not the other.
    expect(onSave).toHaveBeenCalledWith({
      firstName: 'Jane',
      lastName: 'Smith',
      gradYear: 2027,
      email: 'jsmith27@stjohnschs.org',
    });
  });

  it('saves a manual address that still fits the school format', async () => {
    const { user, firstName, lastName, gradYear, email, submit, onSave } =
      renderForm();

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');
    await user.clear(email);
    await user.type(email, 'jsmithson27@stjohnschs.org');
    await user.click(submit);

    expect(onSave).toHaveBeenCalledWith({
      firstName: 'Jane',
      lastName: 'Smith',
      gradYear: 2027,
      email: 'jsmithson27@stjohnschs.org',
    });
  });

  it('blocks submission of an address outside the school domain', async () => {
    const { user, firstName, lastName, gradYear, email, submit, onSave } =
      renderForm();

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');
    await user.clear(email);
    await user.type(email, 'jane@gmail.com');
    await user.click(submit);

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(
      'is not a stjohnschs.org address',
    );
  });

  it('saves an in-domain address that is off the derivation formula', async () => {
    const { user, firstName, lastName, gradYear, email, submit, onSave } =
      renderForm();

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');
    await user.clear(email);
    await user.type(email, 'jsmith271@stjohnschs.org');
    await user.click(submit);

    expect(onSave).toHaveBeenCalledWith({
      firstName: 'Jane',
      lastName: 'Smith',
      gradYear: 2027,
      email: 'jsmith271@stjohnschs.org',
    });
  });

  it('saves an existing legacy address unchanged while another field is fixed', async () => {
    const { user, lastName, submit, onSave } = renderForm({
      candidate: {
        uid: '04A1B2C3',
        person: {
          id: 7,
          cardUid: '04A1B2C3',
          firstName: 'Jane',
          lastName: 'Smiht',
          gradYear: 2027,
          email: 'jane.smith@stjohnschs.org',
          enrolledAt: '2026-09-01T12:00:00.000Z',
        },
      },
    });

    await user.clear(lastName);
    await user.type(lastName, 'Smith');
    await user.click(submit);

    expect(onSave).toHaveBeenCalledWith({
      firstName: 'Jane',
      lastName: 'Smith',
      gradYear: 2027,
      email: 'jane.smith@stjohnschs.org',
    });
  });

  it('blocks submission of an empty address', async () => {
    const { user, firstName, lastName, gradYear, email, submit, onSave } =
      renderForm();

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');
    await user.clear(email);
    await user.click(submit);

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(
      'Enter a stjohnschs.org email address before saving.',
    );
  });

  it('clears the submission error once the address is fixed', async () => {
    const { user, firstName, lastName, gradYear, email, regenerate, submit, onSave } =
      renderForm();

    await user.type(firstName, 'Jane');
    await user.type(lastName, 'Smith');
    await user.type(gradYear, '2027');
    await user.clear(email);
    await user.click(submit);
    expect(screen.queryByRole('alert')).toBeTruthy();

    await user.click(regenerate);
    expect(screen.queryByRole('alert')).toBeNull();

    await user.click(submit);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

const janeSmith = {
  id: 1,
  cardUid: '04AAAAAA',
  firstName: 'Jane',
  lastName: 'Smith',
  gradYear: 2027,
  email: 'jsmith27@stjohnschs.org',
  enrolledAt: '2026-09-01T12:00:00.000Z',
};

describe('EnrollmentForm collision detection', () => {
  async function typeSecondJaneSmith(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('First name'), 'Jane');
    await user.type(screen.getByLabelText('Last name'), 'Smith');
    await user.type(screen.getByLabelText('Graduation year'), '2027');
  }

  it('warns when the derived address already belongs to someone', async () => {
    const { user, email } = renderForm({ roster: [janeSmith] });

    await typeSecondJaneSmith(user);

    expect(email.value).toBe('jsmith27@stjohnschs.org');
    expect(screen.getByTestId('text-email-collision').textContent).toContain(
      'Already used by Jane Smith, class of 2027.',
    );
    expect(email.getAttribute('aria-invalid')).toBe('true');
  });

  it('stays quiet for a name nobody else holds', async () => {
    const { user, email } = renderForm({ roster: [janeSmith] });

    await user.type(screen.getByLabelText('First name'), 'Ada');
    await user.type(screen.getByLabelText('Last name'), 'Lovelace');
    await user.type(screen.getByLabelText('Graduation year'), '2027');

    expect(email.value).toBe('alovelace27@stjohnschs.org');
    expect(screen.queryByTestId('text-email-collision')).toBeNull();
    expect(email.getAttribute('aria-invalid')).toBe('false');
  });

  it('does not flag a student against their own stored address', async () => {
    const { email } = renderForm({
      roster: [janeSmith],
      candidate: { uid: janeSmith.cardUid, person: janeSmith },
    });

    expect(email.value).toBe('jsmith27@stjohnschs.org');
    expect(screen.queryByTestId('text-email-collision')).toBeNull();
  });

  it('offers the next free variant and freezes it once applied', async () => {
    const { user, email } = renderForm({ roster: [janeSmith] });

    await typeSecondJaneSmith(user);
    await user.click(screen.getByTestId('button-use-suggested-email'));

    expect(email.value).toBe('jsmith271@stjohnschs.org');
    expect(screen.queryByTestId('text-email-collision')).toBeNull();
    expect(screen.getByText('edited')).toBeTruthy();

    // Frozen: further edits to the name must not re-derive over the choice.
    await user.clear(screen.getByLabelText('Graduation year'));
    await user.type(screen.getByLabelText('Graduation year'), '2028');
    expect(email.value).toBe('jsmith271@stjohnschs.org');
  });

  it('skips suffixes that are themselves taken', async () => {
    const { user } = renderForm({
      roster: [
        janeSmith,
        { ...janeSmith, id: 2, email: 'jsmith271@stjohnschs.org' },
      ],
    });

    await typeSecondJaneSmith(user);

    expect(
      screen.getByTestId('button-use-suggested-email').textContent,
    ).toContain('jsmith272@stjohnschs.org');
  });

  it('blocks submission while the duplicate stands, and allows it once fixed', async () => {
    const { user, submit, onSave } = renderForm({ roster: [janeSmith] });

    await typeSecondJaneSmith(user);
    await user.click(submit);

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(
      'already belongs to Jane Smith',
    );

    await user.click(screen.getByTestId('button-use-suggested-email'));
    await user.click(submit);

    expect(onSave).toHaveBeenCalledWith({
      firstName: 'Jane',
      lastName: 'Smith',
      gradYear: 2027,
      email: 'jsmith271@stjohnschs.org',
    });
  });

  it('catches a duplicate typed in by hand', async () => {
    const { user, email, submit, onSave } = renderForm({ roster: [janeSmith] });

    await user.type(screen.getByLabelText('First name'), 'Ada');
    await user.type(screen.getByLabelText('Last name'), 'Lovelace');
    await user.type(screen.getByLabelText('Graduation year'), '2027');
    await user.clear(email);
    await user.type(email, 'JSmith27@StJohnsCHS.org');
    await user.click(submit);

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('text-email-collision')).toBeTruthy();
  });
});

describe('EnrollmentForm conflict dialog', () => {
  async function typeSecondJaneSmith(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('First name'), 'Jane');
    await user.type(screen.getByLabelText('Last name'), 'Smith');
    await user.type(screen.getByLabelText('Graduation year'), '2027');
  }

  it('opens as soon as the derived address collides, naming the holder', async () => {
    const { user } = renderForm({ roster: [janeSmith] });

    expect(screen.queryByTestId('dialog-email-conflict')).toBeNull();
    await typeSecondJaneSmith(user);

    const dialog = screen.getByTestId('dialog-email-conflict');
    expect(dialog.textContent).toContain('jsmith27@stjohnschs.org');
    expect(dialog.textContent).toContain('Jane Smith, class of 2027');
  });

  it('stays shut when the address is free', async () => {
    const { user } = renderForm({ roster: [janeSmith] });

    await user.type(screen.getByLabelText('First name'), 'Ada');
    await user.type(screen.getByLabelText('Last name'), 'Lovelace');
    await user.type(screen.getByLabelText('Graduation year'), '2027');

    expect(screen.queryByTestId('dialog-email-conflict')).toBeNull();
  });

  it('takes the address the student was actually issued', async () => {
    const { user, email, submit, onSave } = renderForm({ roster: [janeSmith] });

    await typeSecondJaneSmith(user);
    await user.type(
      screen.getByTestId('input-conflict-email'),
      'janesmith27@stjohnschs.org',
    );
    await user.click(screen.getByTestId('button-conflict-save'));

    expect(screen.queryByTestId('dialog-email-conflict')).toBeNull();
    expect(screen.queryByTestId('text-email-collision')).toBeNull();
    expect(email.value).toBe('janesmith27@stjohnschs.org');

    await user.click(submit);
    expect(onSave).toHaveBeenCalledWith({
      firstName: 'Jane',
      lastName: 'Smith',
      gradYear: 2027,
      email: 'janesmith27@stjohnschs.org',
    });
  });

  it('falls back to the generated variant when nobody knows the address', async () => {
    const { user, email } = renderForm({ roster: [janeSmith] });

    await typeSecondJaneSmith(user);
    await user.click(screen.getByTestId('button-conflict-suggested'));

    expect(screen.queryByTestId('dialog-email-conflict')).toBeNull();
    expect(email.value).toBe('jsmith271@stjohnschs.org');
  });

  it('refuses a replacement that is itself taken, and stays open', async () => {
    const { user } = renderForm({
      roster: [
        janeSmith,
        { ...janeSmith, id: 2, firstName: 'Jonah', email: 'jsmith26@stjohnschs.org' },
      ],
    });

    await typeSecondJaneSmith(user);
    await user.type(
      screen.getByTestId('input-conflict-email'),
      'jsmith26@stjohnschs.org',
    );
    await user.click(screen.getByTestId('button-conflict-save'));

    expect(screen.getByTestId('dialog-email-conflict')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'That one belongs to Jonah Smith',
    );
  });

  it('refuses a replacement outside the school domain, and stays open', async () => {
    const { user } = renderForm({ roster: [janeSmith] });

    await typeSecondJaneSmith(user);
    await user.type(
      screen.getByTestId('input-conflict-email'),
      'jane@gmail.com',
    );
    await user.click(screen.getByTestId('button-conflict-save'));

    expect(screen.getByTestId('dialog-email-conflict')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'is not a stjohnschs.org address',
    );
  });

  it('can be waved off, leaving the inline warning and the block in place', async () => {
    const { user, submit, onSave } = renderForm({ roster: [janeSmith] });

    await typeSecondJaneSmith(user);
    await user.click(screen.getByTestId('button-conflict-dismiss'));

    expect(screen.queryByTestId('dialog-email-conflict')).toBeNull();
    expect(screen.getByTestId('text-email-collision')).toBeTruthy();

    await user.click(submit);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('raises itself again when a different address collides', async () => {
    const { user } = renderForm({
      roster: [
        janeSmith,
        { ...janeSmith, id: 2, firstName: 'Jonah', email: 'jsmith26@stjohnschs.org' },
      ],
    });

    await typeSecondJaneSmith(user);
    await user.click(screen.getByTestId('button-conflict-dismiss'));
    expect(screen.queryByTestId('dialog-email-conflict')).toBeNull();

    await user.clear(screen.getByLabelText('Graduation year'));
    await user.type(screen.getByLabelText('Graduation year'), '2026');

    expect(screen.getByTestId('dialog-email-conflict')).toBeTruthy();
  });
});

