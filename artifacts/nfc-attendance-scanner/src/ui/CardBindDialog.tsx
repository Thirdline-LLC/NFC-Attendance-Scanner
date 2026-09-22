import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CreditCard, Search, UserRoundSearch } from 'lucide-react';

import type { Person } from '@/data/attendance-store';
import { maskCardUid } from '@/lib/scan-format';
import { normalizeNamePart } from '@/lib/student-email';
import { useModalFocusTrap } from '@/ui/use-modal-focus-trap';

type CardBindDialogProps = {
  /** The card that just tapped and matched nobody. */
  uid: string;
  /**
   * The students this card may be given to: pre-enrolled, no card yet.
   * Everyone else is deliberately absent — see the note on the component.
   */
  candidates: Person[];
  isSaving: boolean;
  /** A refusal or a failed write, said in place of any success. */
  errorMessage?: string;
  onBind: (personId: number) => void;
  onCancel: () => void;
};

/**
 * Matches a typed query against a student's names and address. A query is
 * never matched against the card: the only card in this dialog is the one that
 * just tapped, and the students listed have none.
 */
function matches(person: Person, query: string): boolean {
  const words = query.split(/\s+/).filter((word) => word !== '');
  const fragments = words.map(normalizeNamePart).filter(Boolean);

  if (fragments.length === words.length && fragments.length > 0) {
    const first = normalizeNamePart(person.firstName);
    const last = normalizeNamePart(person.lastName);
    if (
      fragments.every(
        (fragment) => first.includes(fragment) || last.includes(fragment),
      )
    ) {
      return true;
    }
  }

  return person.email.toLowerCase().includes(query.toLowerCase());
}

/**
 * Gives an unrecognized card to a student who was pre-enrolled without one.
 *
 * This is the second half of the roster import: a workbook puts a whole class
 * on the device with no cards, and each student's card arrives later, one tap
 * at a time, at the desk. The list is the import's leftovers — anyone who
 * already taps with a card is not offered, because handing this card to them
 * would mean retiring theirs, and a card still in a wallet must not be
 * replaced by a stray tap at a kiosk. If one really has been lost, the
 * student's old card is removed on the Students page first.
 *
 * The card itself is shown masked, like everywhere else: the operator needs
 * to tell this card from the last one they tapped, and four characters do
 * that without putting hardware identity on a screen anybody can read.
 */
export function CardBindDialog({
  uid,
  candidates,
  isSaving,
  errorMessage = '',
  onBind,
  onCancel,
}: CardBindDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const searchId = useId();
  const titleId = useId();
  const [query, setQuery] = useState('');
  useModalFocusTrap(dialogRef);

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    searchRef.current?.focus();

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

  const trimmedQuery = query.trim();
  const visible = useMemo(() => {
    const sorted = [...candidates].sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName, 'en', { sensitivity: 'base' }) ||
        a.firstName.localeCompare(b.firstName, 'en', { sensitivity: 'base' }),
    );
    return trimmedQuery === ''
      ? sorted
      : sorted.filter((person) => matches(person, trimmedQuery));
  }, [candidates, trimmedQuery]);

  return (
    <div className="fixed inset-0 z-30 flex overflow-y-auto bg-[hsl(var(--background)/.88)] px-5 py-8 backdrop-blur-sm">
      <section
        ref={dialogRef}
        className="m-auto w-full max-w-xl rounded-[1.7rem] border border-[hsl(var(--primary)/.55)] bg-[hsl(var(--card))] p-6 shadow-[0_24px_90px_hsl(211_55%_5%/.5)] sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="dialog-card-bind"
      >
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-[hsl(var(--primary))]">
          <CreditCard aria-hidden="true" size={15} />
          Card not recognised
        </p>
        <h2
          id={titleId}
          className="mt-2 font-display text-2xl font-semibold tracking-[-0.03em] text-[hsl(var(--foreground))] sm:text-3xl"
        >
          Whose card is{' '}
          <span
            className="font-mono tracking-[0.12em]"
            data-testid="text-bind-card"
          >
            {maskCardUid(uid)}
          </span>
          ?
        </h2>
        <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          Pick the student this card belongs to and it becomes theirs on this
          device. Only students who have no card yet are listed; the tap has
          already been recorded either way.
        </p>

        {errorMessage ? (
          <p
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--destructive)/.09)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
            role="alert"
            data-testid="text-bind-error"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
            <span>
              <strong className="font-semibold">Card not linked.</strong>{' '}
              {errorMessage}
            </span>
          </p>
        ) : null}

        <div className="mt-5 grid gap-1.5 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
          <label htmlFor={searchId}>Find the student</label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
              size={16}
            />
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or email"
              className="w-full appearance-none rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] py-3 pl-10 pr-4 text-base font-normal text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)] sm:text-sm [&::-webkit-search-cancel-button]:appearance-none"
              autoComplete="off"
              spellCheck={false}
              data-testid="input-bind-search"
            />
          </div>
        </div>

        {visible.length === 0 ? (
          <p
            className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[hsl(var(--primary)/.34)] bg-[hsl(var(--background)/.45)] px-5 py-8 text-center text-sm text-[hsl(var(--muted-foreground))]"
            data-testid="text-bind-no-match"
          >
            <UserRoundSearch aria-hidden="true" size={24} strokeWidth={1.8} />
            {trimmedQuery === ''
              ? 'Every student on this device already has a card. Switch to Enroll to add a new student for this one.'
              : `No student without a card matches “${trimmedQuery}”.`}
          </p>
        ) : (
          <ul
            className="mt-4 max-h-72 divide-y divide-[hsl(var(--border)/.6)] overflow-y-auto rounded-2xl border border-[hsl(var(--border)/.75)] bg-[hsl(var(--background)/.45)]"
            data-testid="list-bind-candidates"
          >
            {visible.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => person.id !== undefined && onBind(person.id)}
                  disabled={isSaving || person.id === undefined}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-[hsl(var(--secondary)/.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))] disabled:cursor-wait disabled:opacity-60"
                  data-testid={`button-bind-person-${person.id}`}
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-[hsl(var(--foreground))] [overflow-wrap:anywhere]">
                      {person.firstName} {person.lastName}
                    </span>
                    <span className="block text-xs text-[hsl(var(--muted-foreground))] [overflow-wrap:anywhere]">
                      Class of {person.gradYear} · {person.email}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--primary))]">
                    {isSaving ? 'Linking…' : 'This is me'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={onCancel}
          className="mt-6 w-full rounded-xl border border-[hsl(var(--border))] px-4 py-3 text-sm font-bold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-testid="button-bind-cancel"
        >
          Not now
        </button>
      </section>
    </div>
  );
}
