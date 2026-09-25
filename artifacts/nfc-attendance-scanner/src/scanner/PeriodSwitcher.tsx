import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowLeftRight, Check, Loader2 } from 'lucide-react';
import type { AttendanceBody } from '@/data/attendance-store';
import { isHumanEnter } from '@/lock/pin-entry';
import type { PendingTap } from '@/scanner/use-attendance-session';
import { useModalFocusTrap } from '@/ui/use-modal-focus-trap';

/** Why the switcher is waiting, in the operator's words. */
const PENDING_REASON: Record<PendingTap, string> = {
  scan: 'Finish the current tap first — a card is still being saved.',
  'unknown-card': 'Finish the current tap first — answer “Whose card is…?”',
  enroll: 'Finish the current tap first — save or cancel the enrollment.',
  saving: 'Finish the current tap first — a change is still being saved.',
};

type PeriodSwitchBarProps = {
  /** The body the desk is on now. */
  current: AttendanceBody;
  /** `Switch period`, from `periodSwitchTitle`. */
  title: string;
  pendingTap: PendingTap | null;
  /** A switch is being written. */
  isSwitching: boolean;
  /** The body name for "Now taking attendance for …" after a switch. */
  confirmation: string | null;
  /** Shown instead of the confirmation when a switch could not be made. */
  error: string | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
};

/**
 * The desk strip for Design 09 §3: which period taps land in, and the one
 * control that changes it. The period name is the loudest thing here on
 * purpose — the desk has to be readable from the line. No roster, no tap
 * history, no figures: those belong to the teacher's pages.
 */
export function PeriodSwitchBar({
  current,
  title,
  pendingTap,
  isSwitching,
  confirmation,
  error,
  triggerRef,
  onOpen,
}: PeriodSwitchBarProps) {
  const disabled = pendingTap !== null || isSwitching;
  const reasonId = 'period-switch-reason';
  const status: ReactNode = error ? (
    error
  ) : pendingTap ? (
    PENDING_REASON[pendingTap]
  ) : confirmation ? (
    <>
      Now taking attendance for <strong className="font-semibold">{confirmation}</strong>
    </>
  ) : null;

  return (
    <div
      className="station-enter mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.68)] px-4 py-3 sm:px-5"
      data-testid="bar-period-switch"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-[hsl(var(--muted-foreground))]">
          Taking attendance for{' '}
          <span
            className="block truncate font-display text-2xl font-semibold leading-tight tracking-[-0.03em] text-[hsl(var(--foreground))] sm:text-3xl"
            data-testid="text-period-current"
          >
            {current.name}
          </span>
        </p>
        <button
          ref={triggerRef}
          type="button"
          onClick={onOpen}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-describedby={pendingTap ? reasonId : undefined}
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-[hsl(var(--primary)/.55)] bg-[hsl(var(--primary)/.12)] px-5 text-sm font-semibold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--primary)/.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:border-[hsl(var(--border))] disabled:bg-transparent disabled:text-[hsl(var(--muted-foreground))]"
          data-testid="button-period-switch"
          data-scanner-nav
        >
          {isSwitching ? (
            <Loader2 aria-hidden="true" size={16} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <ArrowLeftRight aria-hidden="true" size={16} />
          )}
          {title}
        </button>
      </div>
      {/* Always mounted, so the confirmation is announced when it arrives:
          a live region that appears with its text is often not read. */}
      <p
        id={reasonId}
        role="status"
        aria-live="polite"
        className={`text-sm leading-5 [&:not(:empty)]:mt-2 ${
          error
            ? 'text-[hsl(var(--destructive))]'
            : pendingTap
              ? 'text-[hsl(var(--muted-foreground))]'
              : 'text-[hsl(var(--accent))]'
        }`}
        data-testid="text-period-switch-status"
      >
        {status}
      </p>
    </div>
  );
}

type PeriodChooserDialogProps = {
  title: string;
  parent: AttendanceBody;
  options: AttendanceBody[];
  currentId: number;
  onChoose: (bodyId: number) => void;
  onCancel: () => void;
};

/**
 * The chooser the strip's button opens: the active body's siblings and
 * nothing else (`periodSwitchOptions` decides which). Up/Down and Home/End
 * move between rows; Escape closes; focus comes back to whatever opened it.
 *
 * Enter is guarded the way the PIN field guards it. While this is open the
 * hidden reader input is not focused, so a card tapped now types its UID and
 * Enter into whichever row has focus — which would switch periods on a tap.
 * A reader sends Enter within milliseconds of its last character; a person
 * does not, so a fast Enter is dropped.
 */
export function PeriodChooserDialog({
  title,
  parent,
  options,
  currentId,
  onChoose,
  onCancel,
}: PeriodChooserDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const lastKeystrokeAt = useRef<number | null>(null);
  useModalFocusTrap(dialogRef);

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    // Land on the first row that can be chosen, not on the current one.
    const first = listRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
    first?.focus();
    return () => {
      const previous = previouslyFocused.current;
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'Enter') {
      if (!isHumanEnter(lastKeystrokeAt.current, Date.now())) event.preventDefault();
      return;
    }
    // Only characters count as the reader typing; arrows are a person moving.
    if (event.key.length === 1) {
      lastKeystrokeAt.current = Date.now();
      return;
    }
    // The current row is disabled and cannot take focus, so it is skipped.
    const rows = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []),
    ];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = at < 0 ? 0 : Math.min(rows.length - 1, at + 1);
    else if (event.key === 'ArrowUp') next = at < 0 ? 0 : Math.max(0, at - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    if (next === null) return;
    event.preventDefault();
    rows[next]?.focus();
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-40 flex overflow-y-auto overscroll-contain bg-[hsl(var(--background)/.86)] px-5 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="period-chooser-title"
      aria-describedby="period-chooser-parent"
      data-testid="dialog-period-chooser"
    >
      <div className="m-auto w-full max-w-md rounded-[1.35rem] border border-[hsl(var(--primary)/.45)] bg-[hsl(var(--card))] p-5 shadow-[0_24px_90px_hsl(211_55%_5%/.5)] sm:p-6">
        <div className="flex items-start gap-2.5">
          <ArrowLeftRight
            aria-hidden="true"
            className="mt-1 shrink-0 text-[hsl(var(--primary))]"
            size={18}
          />
          <div className="min-w-0">
            <h2
              id="period-chooser-title"
              className="font-display text-lg font-semibold tracking-[-0.02em] text-[hsl(var(--foreground))]"
            >
              {title}
            </h2>
            <p
              id="period-chooser-parent"
              className="mt-1 text-sm leading-snug text-[hsl(var(--muted-foreground))]"
            >
              {parent.name}. Taps after the switch count for the one you pick.
            </p>
          </div>
        </div>

        <ul
          ref={listRef}
          className="mt-4 grid gap-2"
          onKeyDown={handleListKeyDown}
          data-testid="list-period-options"
        >
          {options.map((body) => {
            const id = body.id as number;
            const current = id === currentId;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onChoose(id)}
                  disabled={current}
                  aria-current={current ? 'true' : undefined}
                  className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border px-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${
                    current
                      ? 'cursor-default border-[hsl(var(--primary)/.6)] bg-[hsl(var(--primary)/.1)]'
                      : 'border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] hover:bg-[hsl(var(--secondary))]'
                  }`}
                  data-testid={`button-period-option-${id}`}
                >
                  <span className="min-w-0 truncate font-display text-base font-semibold text-[hsl(var(--foreground))]">
                    {body.name}
                  </span>
                  {current ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[hsl(var(--primary))]">
                      <Check aria-hidden="true" size={14} />
                      Current
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={onCancel}
          className="mt-4 flex min-h-11 w-full items-center justify-center rounded-xl border border-[hsl(var(--border))] px-4 text-sm font-semibold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-testid="button-period-chooser-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
