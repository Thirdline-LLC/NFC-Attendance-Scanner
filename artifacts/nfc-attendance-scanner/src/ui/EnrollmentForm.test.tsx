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

  it('labels the field as edited and warns about an off-format address', async () => {
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
      screen.getByText(
        'Not a stjohnschs.org address in the standard format.',
      ),
    ).toBeTruthy();
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
      'is not a stjohnschs.org address in the standard format',
    );
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
