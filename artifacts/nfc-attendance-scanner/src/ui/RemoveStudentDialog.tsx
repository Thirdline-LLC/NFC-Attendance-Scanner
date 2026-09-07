import { useEffect, useRef } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';

import type { Person } from '@/data/attendance-store';
import type { PersonRemoval } from '@/data/attendance-store';
import { maskCardUid } from '@/lib/scan-format';

type RemoveStudentDialogProps = {
  person: Person;
  /** What goes with them, so the cost is on screen before the decision. */
  removal: PersonRemoval | null;
  isRemoving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Confirms removing a student, and says what that costs.
 *
 * This is the only irreversible action in the app that a volunteer can reach:
 * there is no undo, no server copy, and no recycle bin. The taps go with the
 * record — leaving them would keep rows carrying a card UID that is still in
 * somebody's wallet — so a past session really does lose those check-ins, and
 * the year-to-date figures really do move. Saying that plainly is the point of
 * the dialog; a bare "are you sure?" would hide the half that matters.
 */
export function RemoveStudentDialog({
  person,
  removal,
  isRemoving,
  onConfirm,
  onCancel,
}: RemoveStudentDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  // Least destructive button first: a stray Enter on a kiosk must not erase a
  // student. Focus goes back to whatever asked, which is the row's own button.
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    cancelRef.current?.focus();

    return () => {
      const previous = previouslyFocused.current;
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const name = `${person.firstName} ${person.lastName}`;

  return (
    <div className="fixed inset-0 z-30 flex overflow-y-auto bg-[hsl(var(--background)/.88)] px-5 py-8 backdrop-blur-sm">
      <section
        className="m-auto w-full max-w-lg rounded-[1.7rem] border border-[hsl(var(--destructive)/.55)] bg-[hsl(var(--card))] p-6 shadow-[0_24px_90px_hsl(211_55%_5%/.5)] sm:p-8"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-student-title"
        data-testid="dialog-remove-student"
      >
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-[hsl(var(--destructive))]">
          <AlertTriangle aria-hidden="true" size={15} />
          Cannot be undone
        </p>
        <h2
          id="remove-student-title"
          className="mt-2 font-display text-2xl font-semibold tracking-[-0.03em] text-[hsl(var(--foreground))] sm:text-3xl"
        >
          Remove {name}?
        </h2>

        <p
          className="mt-4 text-sm leading-6 text-[hsl(var(--muted-foreground))]"
          data-testid="text-removal-cost"
        >
          {removal === null ? (
            'Checking what this would remove…'
          ) : removal.tapCount === 0 ? (
            <>
              {name} has no attendance on this device, so only their details
              and card {maskCardUid(person.cardUid)} will go.
            </>
          ) : (
            <>
              This also deletes {plural(removal.tapCount, 'tap')} across{' '}
              {plural(removal.sessionCount, 'session')}, including sessions
              already finished. Those check-ins will disappear from the
              dashboard and from any export made after this, so the year-to-date
              figures will change. Export first if you need them.
            </>
          )}
        </p>

        <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          Their card can be enrolled again afterwards, as a new student.
        </p>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-[hsl(var(--border))] px-4 py-3 text-sm font-bold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid="button-remove-cancel"
          >
            Keep {person.firstName}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isRemoving || removal === null}
            className="flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--destructive))] px-4 py-3 text-sm font-bold text-[hsl(var(--destructive-foreground))] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-wait disabled:opacity-60"
            data-testid="button-remove-confirm"
          >
            <Trash2 aria-hidden="true" size={15} />
            {isRemoving ? 'Removing…' : 'Remove permanently'}
          </button>
        </div>
      </section>
    </div>
  );
}
