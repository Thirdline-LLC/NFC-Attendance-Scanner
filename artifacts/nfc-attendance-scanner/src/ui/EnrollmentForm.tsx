import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { EnrollmentCandidate } from '@/scanner/use-attendance-session';
import {
  deriveStudentEmail,
  isValidSchoolEmail,
} from '@/lib/student-email';

type EnrollmentFormProps = {
  candidate: EnrollmentCandidate;
  isSaving: boolean;
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
  onSave,
  onCancel,
}: EnrollmentFormProps) {
  const isEditing = Boolean(candidate.person);
  const [firstName, setFirstName] = useState(candidate.person?.firstName ?? '');
  const [lastName, setLastName] = useState(candidate.person?.lastName ?? '');
  const [gradYear, setGradYear] = useState(
    candidate.person?.gradYear ? String(candidate.person.gradYear) : '',
  );
  // `null` means "follow the derived address"; a string is a manual override.
  const [emailOverride, setEmailOverride] = useState<string | null>(
    candidate.person?.email ?? null,
  );

  useEffect(() => {
    setFirstName(candidate.person?.firstName ?? '');
    setLastName(candidate.person?.lastName ?? '');
    setGradYear(
      candidate.person?.gradYear ? String(candidate.person.gradYear) : '',
    );
    setEmailOverride(candidate.person?.email ?? null);
  }, [candidate.person]);

  const derivedEmail = useMemo(() => {
    try {
      return deriveStudentEmail(firstName, lastName, gradYear);
    } catch {
      // Incomplete or unusable input — nothing to suggest yet.
      return '';
    }
  }, [firstName, lastName, gradYear]);

  const email = emailOverride ?? derivedEmail;
  const isOverridden = emailOverride !== null;
  const showEmailWarning =
    isOverridden && email.trim() !== '' && !isValidSchoolEmail(email);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
        <label className="grid gap-1.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
          <span className="flex items-center justify-between gap-2">
            <span>
              Email{' '}
              <span className="font-normal opacity-70">
                {isOverridden ? 'edited' : 'auto'}
              </span>
            </span>
            {isOverridden && derivedEmail !== '' && email !== derivedEmail ? (
              <button
                type="button"
                onClick={() => setEmailOverride(null)}
                className="font-semibold text-[hsl(var(--primary))] underline-offset-4 hover:underline"
              >
                Reset
              </button>
            ) : null}
          </span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmailOverride(event.target.value)}
            placeholder="jsmith27@stjohnschs.org"
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)]"
          />
          <span className="font-normal text-[10px] leading-snug opacity-70">
            {showEmailWarning
              ? 'Not a stjohnschs.org address in the standard format.'
              : 'Filled in from the name and graduation year. Edit to override.'}
          </span>
        </label>
      </div>
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