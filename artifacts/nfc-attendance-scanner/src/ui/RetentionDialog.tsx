import { useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useModalFocusTrap } from '@/ui/use-modal-focus-trap';

type RetentionDialogProps = {
  title: string;
  /** The sentence naming exactly what goes, with its counts. */
  cost: ReactNode;
  /** True when a confirmed deletion failed to write. */
  failed?: boolean;
  isWorking: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Confirms one of the two retention actions and says what it costs. The
 * shape is `RemoveStudentDialog`'s — cost first, least destructive button
 * first, nothing hidden behind "are you sure?" — because these delete more
 * at once than anything else in the app.
 */
export function RetentionDialog({
  title,
  cost,
  failed = false,
  isWorking,
  confirmLabel,
  onConfirm,
  onCancel,
}: RetentionDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  useModalFocusTrap(dialogRef);

  // Least destructive button first: a stray Enter on a kiosk must not delete
  // a school year. Focus goes back to the button that asked.
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

  return (
    <div className="fixed inset-0 z-30 flex overflow-y-auto bg-[hsl(var(--background)/.88)] px-5 py-8 backdrop-blur-sm">
      <section
        ref={dialogRef}
        className="m-auto w-full max-w-lg rounded-[1.7rem] border border-[hsl(var(--destructive)/.55)] bg-[hsl(var(--card))] p-6 shadow-[0_24px_90px_hsl(211_55%_5%/.5)] sm:p-8"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="retention-title"
        data-testid="dialog-retention"
      >
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-[hsl(var(--destructive))]">
          <AlertTriangle aria-hidden="true" size={15} />
          Cannot be undone
        </p>
        <h2
          id="retention-title"
          className="mt-2 font-display text-2xl font-semibold tracking-[-0.03em] text-[hsl(var(--foreground))] sm:text-3xl"
        >
          {title}
        </h2>

        <p
          className="mt-4 text-sm leading-6 text-[hsl(var(--muted-foreground))]"
          data-testid="text-retention-cost"
        >
          {cost}
        </p>

        <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          There is no server copy and no recycle bin. Export all history first
          if these numbers have already been reported to anyone.
        </p>

        {failed ? (
          <p
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-[hsl(var(--destructive)/.5)] bg-[hsl(var(--destructive)/.09)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
            role="alert"
            data-testid="text-retention-failed"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
            <span>
              <strong className="font-semibold">Nothing was deleted.</strong>{' '}
              The device would not save the change, so everything is still
              here. Try again.
            </span>
          </p>
        ) : null}

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-[hsl(var(--border))] px-4 py-3 text-sm font-bold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid="button-retention-cancel"
          >
            Keep everything
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isWorking}
            className="flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--destructive))] px-4 py-3 text-sm font-bold text-[hsl(var(--destructive-foreground))] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-wait disabled:opacity-60"
            data-testid="button-retention-confirm"
          >
            <Trash2 aria-hidden="true" size={15} />
            {isWorking ? 'Working…' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
