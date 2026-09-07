import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Person } from '@/data/attendance-store';
import { isSchoolDomainEmail, SCHOOL_EMAIL_DOMAIN } from '@/lib/student-email';

type EmailConflictDialogProps = {
  /** The address the form derived, which somebody else already holds. */
  attemptedEmail: string;
  /** The student holding it. */
  owner: Person;
  /** A free variant, offered only as a fallback when the real one isn't known. */
  suggestedEmail: string;
  /** Who holds a given address, so a replacement can be checked before it lands. */
  findOwner: (email: string) => Person | undefined;
  onResolve: (email: string) => void;
  onDismiss: () => void;
};

function describe(person: Person): string {
  return `${person.firstName} ${person.lastName}, class of ${person.gradYear}`;
}

/**
 * Raised when the derived address is already spoken for. The formula cannot
 * tell two students with the same initial, surname and year apart, but the
 * school has, so the first thing this asks for is the address the student was
 * actually issued. The generated variant is a fallback for when nobody knows it.
 */
export function EmailConflictDialog({
  attemptedEmail,
  owner,
  suggestedEmail,
  findOwner,
  onResolve,
  onDismiss,
}: EmailConflictDialogProps) {
  const [entered, setEntered] = useState('');
  const [error, setError] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  // aria-modal promises focus is inside; without this the keyboard stayed on
  // the enrollment field behind the dialog and kept typing into it. The field
  // this asks for takes it, and whatever had it gets it back on the way out —
  // the form underneath is still mounted and still half-filled.
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    emailRef.current?.focus();

    return () => {
      const previous = previouslyFocused.current;
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus();
      }
    };
  }, []);

  const resolveEntered = () => {
    const value = entered.trim();

    if (!isSchoolDomainEmail(value)) {
      setError(
        value === ''
          ? 'Enter the address the school issued to this student.'
          : `"${value}" is not a ${SCHOOL_EMAIL_DOMAIN} address.`,
      );
      return;
    }

    const clash = findOwner(value);
    if (clash) {
      setError(`That one belongs to ${describe(clash)}.`);
      return;
    }

    onResolve(value);
  };

  // The dialog lives inside the enrollment <form>, so Enter would otherwise
  // submit it out from under us.
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      resolveEntered();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex overflow-y-auto overscroll-contain bg-[hsl(var(--background)/.82)] p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-conflict-title"
      data-testid="dialog-email-conflict"
    >
      <div className="m-auto w-full max-w-md rounded-[1.35rem] border border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--card))] p-5 sm:p-6">
        <div className="flex items-start gap-2.5">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-[hsl(var(--destructive))]"
            size={18}
          />
          <div>
            <p
              id="email-conflict-title"
              className="text-sm font-bold text-[hsl(var(--foreground))]"
            >
              That email is already taken
            </p>
            <p className="mt-2 text-sm leading-snug text-[hsl(var(--muted-foreground))]">
              <span className="font-mono text-[hsl(var(--foreground))]">
                {attemptedEmail}
              </span>{' '}
              belongs to {describe(owner)}. If this student has their own school
              email, enter it below.
            </p>
          </div>
        </div>

        <label className="mt-5 grid gap-1.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
          Their actual school email
          <input
            type="email"
            value={entered}
            onChange={(event) => {
              setEntered(event.target.value);
              setError('');
            }}
            onKeyDown={handleKeyDown}
            placeholder={`someone27@${SCHOOL_EMAIL_DOMAIN}`}
            aria-invalid={error !== ''}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)]"
            data-testid="input-conflict-email"
            ref={emailRef}
          />
        </label>
        {error ? (
          <p
            className="mt-2 text-xs font-semibold text-[hsl(var(--destructive))]"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={resolveEntered}
          className="mt-4 w-full rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105"
          data-testid="button-conflict-save"
        >
          Use this email
        </button>
        <button
          type="button"
          onClick={() => onResolve(suggestedEmail)}
          className="mt-2 w-full rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-semibold text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))]"
          data-testid="button-conflict-suggested"
        >
          Don't know it — use {suggestedEmail}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 w-full text-xs font-semibold text-[hsl(var(--muted-foreground))] underline-offset-4 hover:underline"
          data-testid="button-conflict-dismiss"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
