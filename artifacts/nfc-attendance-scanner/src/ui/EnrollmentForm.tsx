import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { EnrollmentCandidate } from '@/scanner/use-attendance-session';
import {
  deriveStudentEmail,
  isValidSchoolEmail,
  SCHOOL_EMAIL_DOMAIN,
} from '@/lib/student-email';

type EnrollmentFormProps = {
  candidate: EnrollmentCandidate;
  isSaving: boolean;
  storageError: boolean;
  onSave: (details: {
    firstName: string;
    lastName: string;
    gradYear: number;
    email: string;
  }) => Promise<void>;
  onCancel: () => void;
};

export function EnrollmentForm({
  candidate,
  isSaving,
  storageError,
  onSave,
  onCancel,
}: EnrollmentFormProps) {
  const isEditing = Boolean(candidate.person);
  const emailFieldId = useId();
  const [firstName, setFirstName] = useState(candidate.person?.firstName ?? '');
  const [lastName, setLastName] = useState(candidate.person?.lastName ?? '');
  const [gradYear, setGradYear] = useState(
    candidate.person?.gradYear ? String(candidate.person.gradYear) : '',
  );
  // `null` means "follow the derived address"; a string is a manual override.
  const [emailOverride, setEmailOverride] = useState<string | null>(
    candidate.person?.email ?? null,
  );
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    setFirstName(candidate.person?.firstName ?? '');
    setLastName(candidate.person?.lastName ?? '');
    setGradYear(
      candidate.person?.gradYear ? String(candidate.person.gradYear) : '',
    );
    setEmailOverride(candidate.person?.email ?? null);
    setSubmitError('');
  }, [candidate.person]);

  // Recomputed on every keystroke in the name and graduation-year fields, so
  // the proposal stays live. `deriveStudentEmail` folds the year down to its
  // last two digits, accepting both `2027` and `27`.
  const derivedEmail = useMemo(() => {
    try {
      return deriveStudentEmail(firstName, lastName, gradYear);
    } catch {
      // Incomplete or unusable input — nothing to suggest yet.
      return '';
    }
  }, [firstName, lastName, gradYear]);

  const isEmailOverridden = emailOverride !== null;
  const email = emailOverride ?? derivedEmail;
  const canRegenerate = derivedEmail !== '' && email !== derivedEmail;
  const showEmailWarning =
    isEmailOverridden && email.trim() !== '' && !isValidSchoolEmail(email);

  const editEmail = (value: string) => {
    // Any keystroke in the field freezes the automatic proposal.
    setEmailOverride(value);
    setSubmitError('');
  };

  const regenerateEmail = () => {
    setEmailOverride(null);
    setSubmitError('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isValidSchoolEmail(email)) {
      setSubmitError(
        email.trim() === ''
          ? `Enter a ${SCHOOL_EMAIL_DOMAIN} email address before saving.`
          : `"${email.trim()}" is not a ${SCHOOL_EMAIL_DOMAIN} address in the standard format.`,
      );
      return;
    }

    setSubmitError('');
    await onSave({
      firstName,
      lastName,
      gradYear: Number(gradYear),
      email,
    });
  };

  return (
    <form
      className="rounded-[1.35rem] border border-[hsl(var(--primary)/.5)] bg-[hsl(var(--background)/.72)] p-5 sm:p-6"
      onSubmit={submit}
      data-testid="form-enrollment"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[hsl(var(--primary))]">
            {isEditing ? 'Edit local enrollment' : 'New local enrollment'}
          </p>
          <p className="mt-2 font-mono text-sm font-bold tracking-[0.16em] text-[hsl(var(--foreground))]">
            Card ••••{candidate.uid.slice(-4)}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-semibold text-[hsl(var(--muted-foreground))] underline-offset-4 hover:text-[hsl(var(--foreground))] hover:underline"
        >
          Cancel
        </button>
      </div>
      {storageError ? (
        <div
          className="mb-4 flex items-start gap-2.5 rounded-xl border border-[hsl(var(--destructive)/.45)] bg-[hsl(var(--destructive)/.08)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
          role="alert"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
          <span>
            <strong className="font-semibold">Could not save locally.</strong>{' '}
            Check browser storage and try again. Your entered details are still here.
          </span>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
          First name
          <input
            required
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)]"
            autoFocus
          />
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
          Last name
          <input
            required
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)]"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
          Graduation year
          <input
            required
            type="number"
            inputMode="numeric"
            min="1900"
            max="2200"
            value={gradYear}
            onChange={(event) => setGradYear(event.target.value)}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)]"
          />
        </label>
        {/* Not a wrapping label: the Regenerate button sits in the same row and
            would otherwise become the label's associated control. */}
        <div className="grid gap-1.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
          <span className="flex items-center justify-between gap-2">
            <label htmlFor={emailFieldId}>
              Email{' '}
              <span className="font-normal opacity-70">
                {isEmailOverridden ? 'edited' : 'auto'}
              </span>
            </label>
            <button
              type="button"
              onClick={regenerateEmail}
              disabled={!canRegenerate}
              className="font-semibold text-[hsl(var(--primary))] underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
              data-testid="button-regenerate-email"
            >
              Regenerate
            </button>
          </span>
          <input
            id={emailFieldId}
            type="email"
            value={email}
            onChange={(event) => editEmail(event.target.value)}
            placeholder={`jsmith27@${SCHOOL_EMAIL_DOMAIN}`}
            aria-invalid={showEmailWarning || submitError !== ''}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)] aria-[invalid=true]:border-[hsl(var(--destructive)/.6)]"
            data-testid="input-email"
          />
          <span className="font-normal text-[10px] leading-snug opacity-70">
            {showEmailWarning
              ? `Not a ${SCHOOL_EMAIL_DOMAIN} address in the standard format.`
              : 'Filled in from the name and graduation year. Edit to override.'}
          </span>
        </div>
      </div>
      {submitError ? (
        <p
          className="mt-4 text-sm font-semibold text-[hsl(var(--destructive))]"
          role="alert"
        >
          {submitError}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isSaving}
        className="mt-5 w-full rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105 disabled:cursor-wait disabled:opacity-60"
      >
        {isSaving
          ? 'Saving locally…'
          : isEditing
            ? 'Save changes'
            : 'Save enrollment'}
      </button>
    </form>
  );
}
