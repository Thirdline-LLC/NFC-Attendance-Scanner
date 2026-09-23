import { useEffect, useRef, useState } from 'react';
import { Check, Layers } from 'lucide-react';
import type { AttendanceBody } from '@/data/attendance-store';
import { useModalFocusTrap } from '@/ui/use-modal-focus-trap';

/** The presets a teacher picks from before falling back to a custom label. */
const TYPE_LABEL_PRESETS = ['club', 'class', 'faculty'] as const;

type BodySwitcherDialogProps = {
  bodies: AttendanceBody[];
  activeBodyId?: number;
  isWorking: boolean;
  error: string | null;
  /** Points the device at an existing body. */
  onSelect: (bodyId: number) => void;
  /** Creates a body and attaches the device to it. */
  onCreate: (input: { name: string; typeLabel: string }) => void;
  onCancel: () => void;
};

/**
 * Reassignment only (D-T2): picking an existing body just points
 * `activeBodyId` at it, and creating one adds it without touching any
 * other body's roster or history. Export is never required first.
 */
export function BodySwitcherDialog({
  bodies,
  activeBodyId,
  isWorking,
  error,
  onSelect,
  onCreate,
  onCancel,
}: BodySwitcherDialogProps) {
  const [name, setName] = useState('');
  const [typeLabel, setTypeLabel] = useState<string>(TYPE_LABEL_PRESETS[0]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  useModalFocusTrap(dialogRef);

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
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

  const canCreate = !isWorking && name.trim().length > 0;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-40 flex overflow-y-auto overscroll-contain bg-[hsl(var(--background)/.86)] px-5 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="body-switcher-title"
      data-testid="dialog-body-switcher"
    >
      <div className="m-auto w-full max-w-md rounded-[1.35rem] border border-[hsl(var(--primary)/.45)] bg-[hsl(var(--card))] p-5 shadow-[0_24px_90px_hsl(211_55%_5%/.5)] sm:p-6">
        <div className="flex items-start gap-2.5">
          <Layers aria-hidden="true" className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" size={18} />
          <div className="min-w-0">
            <h2
              id="body-switcher-title"
              className="font-display text-lg font-semibold tracking-[-0.02em] text-[hsl(var(--foreground))]"
            >
              Change body
            </h2>
            <p className="mt-2 text-sm leading-snug text-[hsl(var(--muted-foreground))]">
              Every body keeps its own roster and history. Switching only
              changes which one this device scans for — nothing is deleted.
            </p>
          </div>
        </div>

        {bodies.length > 0 ? (
          <ul className="mt-4 grid gap-2" data-testid="list-bodies">
            {bodies.map((body) => (
              <li key={body.id}>
                <button
                  type="button"
                  onClick={() => body.id !== undefined && onSelect(body.id)}
                  disabled={isWorking || body.id === activeBodyId}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.5)] px-3 py-2.5 text-left text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-70"
                  data-testid={`button-body-${body.id}`}
                >
                  <span>
                    {body.name}{' '}
                    <span className="text-[hsl(var(--muted-foreground))]">· {body.typeLabel}</span>
                  </span>
                  {body.id === activeBodyId ? (
                    <Check aria-hidden="true" size={15} className="shrink-0 text-[hsl(var(--primary))]" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <form
          className="mt-5 grid gap-3 border-t border-[hsl(var(--border))] pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canCreate) onCreate({ name: name.trim(), typeLabel });
          }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
            Or create a new body
          </p>
          <label htmlFor="body-name" className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
              Name
            </span>
            <input
              id="body-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              data-testid="input-body-name"
            />
          </label>
          <label htmlFor="body-type" className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
              Type
            </span>
            <select
              id="body-type"
              value={typeLabel}
              onChange={(event) => setTypeLabel(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              data-testid="select-body-type"
            >
              {TYPE_LABEL_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!canCreate}
            className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="button-body-create"
          >
            {isWorking ? 'Working…' : 'Create and switch'}
          </button>
        </form>

        {error ? (
          <p
            className="mt-3 text-sm font-semibold text-[hsl(var(--destructive))]"
            role="alert"
            data-testid="text-body-error"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full text-xs font-semibold text-[hsl(var(--muted-foreground))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-testid="button-body-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
