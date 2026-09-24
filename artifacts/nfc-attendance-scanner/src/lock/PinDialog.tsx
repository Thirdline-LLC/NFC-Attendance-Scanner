import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { KeyRound, RotateCcw } from 'lucide-react';
import { recordActivity, type ActivityKind } from '@/data/attendance-store';
import {
  changeOperatorPin,
  hasOperatorPin,
  isValidPin,
  OperatorPinExistsError,
  PIN_MAX_LENGTH,
  PinUnavailableError,
  setOperatorPin,
  verifyOperatorPin,
  type PinVerification,
} from '@/data/operator-pin';
import { digitsOnly, isHumanEnter } from '@/lock/pin-entry';
import { useModalFocusTrap } from '@/ui/use-modal-focus-trap';
import { useTheme } from '@/theme/ThemeProvider';

type PinDialogProps =
  | {
      mode: 'gate';
      /**
       * `'set'` when this dialog set a new PIN, `'unlocked'` when it found one
       * already there and verified it — a caller that opened the gate to set
       * a PIN words the two differently.
       */
      onUnlocked: (outcome?: 'set' | 'unlocked') => void;
      onCancel: () => void;
    }
  | {
      mode: 'change';
      /**
       * `'set'` when there turned out to be no PIN to change (the dialog fell
       * back to setting one, which the caller may word differently).
       */
      onChanged: (outcome?: 'changed' | 'set') => void;
      onCancel: () => void;
    }
  | {
      mode: 'verify';
      /**
       * Checks the typed PIN and acts on it in one step (e.g. the lock
       * context's `setPinRequired(false, pin)`), so the rule is enforced by
       * the callee, not by this dialog. Defaults to `verifyOperatorPin`.
       */
      verify?: (pin: string) => Promise<PinVerification>;
      onVerified: () => void;
      /**
       * The PIN vanished between opening this and submitting (`unset`). A
       * confirmation has nothing to confirm then, so rather than turning into
       * a set-PIN form (which cannot complete this action) the dialog hands
       * back to the caller. Without it, the dialog shows a clear message.
       */
      onPinMissing?: () => void;
      onCancel: () => void;
    };

/**
 * `checking` and `storage-error` belong to the gate: it has to read whether a
 * PIN exists before it knows which form to show. `change` is the dashboard's
 * mode and needs no read — the current PIN is asked for instead. `verify` is
 * a confirmation on an already-unlocked screen (turning the PIN requirement
 * off): the caller only opens it once a PIN is known to exist, so it goes
 * straight to `unlock` the same way `change` goes straight to its own phase.
 */
type Phase = 'checking' | 'storage-error' | 'set' | 'unlock' | 'change';

/**
 * Fallback titles for a device with no theme pack installed, or one that
 * leaves these copy fields unset. A theme may override `unlock` (via
 * `copy.pinGateTitle`) and the generic heading (via `copy.teacherRoleLabel`)
 * to relabel the gate — it cannot change what unlocks it.
 */
const TITLES: Record<Exclude<Phase, 'checking' | 'storage-error'>, string> = {
  set: 'Set a teacher PIN',
  unlock: 'Enter the teacher PIN',
  change: 'Change the teacher PIN',
};

const HELPERS: Record<Exclude<Phase, 'checking' | 'storage-error'>, string> = {
  set: '4 to 8 digits. Only the teacher should know it — it opens the roster, the dashboard and exports. There is no way to recover a forgotten PIN: write it down somewhere safe.',
  unlock:
    'Only the teacher has it. Nobody needs it to check students in or to enroll a card.',
  change: 'Enter the current PIN, then the new one twice.',
};

const WRONG = 'That PIN is not right.';
const MISMATCH = 'The PINs do not match.';
const STORAGE = "This device isn't letting the app read its settings.";
const PIN_MISSING =
  'There is no teacher PIN on this device anymore, so nothing was changed. Close this and set a PIN first.';
const PIN_APPEARED =
  'A teacher PIN was set on this device in the meantime. Enter it to continue.';
const NO_CRYPTO =
  'This device cannot secure a PIN — open the app from its installed or https address.';

function lockedText(lockedUntil: string): string {
  const seconds = Math.max(1, Math.ceil((Date.parse(lockedUntil) - Date.now()) / 1000));
  return `Too many tries — wait ${seconds} seconds.`;
}

/**
 * The row for a PIN being set or changed is a courtesy entry in the log —
 * nothing depends on it, and the dialog closes on success with no notice to
 * hang a warning on — so a failed write here is the one place it is allowed
 * to pass in silence.
 */
async function logQuietly(kind: Extract<ActivityKind, 'pin-set' | 'pin-changed'>) {
  try {
    await recordActivity({ at: new Date().toISOString(), kind });
  } catch {
    // See above.
  }
}

type PinFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  testId: string;
  inputRef?: RefObject<HTMLInputElement | null>;
};

/**
 * A PIN field that a card reader cannot operate. The reader is a keyboard,
 * and on a locked page this field is what has focus: a tap would type
 * fourteen characters and Enter, and five taps would lock the teacher out.
 * So non-digits are dropped, the field stops at the PIN maximum, and Enter
 * only counts after a pause a reader never makes.
 */
function PinField({ id, label, value, onChange, onSubmit, testId, inputRef }: PinFieldProps) {
  const lastKeystrokeAt = useRef<number | null>(null);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (isHumanEnter(lastKeystrokeAt.current, Date.now())) onSubmit();
      return;
    }
    lastKeystrokeAt.current = Date.now();
  };

  return (
    <label htmlFor={id} className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
        {label}
      </span>
      <input
        ref={inputRef}
        id={id}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={PIN_MAX_LENGTH}
        value={value}
        onChange={(event) => onChange(digitsOnly(event.target.value))}
        onKeyDown={handleKeyDown}
        className="mt-1.5 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] px-3 py-2.5 font-mono text-lg tracking-[0.4em] text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        data-testid={testId}
      />
    </label>
  );
}

/**
 * One modal for the teacher PIN. As the gate it reads whether a PIN exists
 * and shows *set* (twice, with the no-recovery warning) or *unlock*; on the
 * dashboard it shows *change*. Escape and Cancel hand control back; a wrong
 * PIN says only that it was wrong; a lockout counts down on screen.
 */
export function PinDialog(props: PinDialogProps) {
  const [phase, setPhase] = useState<Phase>(
    props.mode === 'change' ? 'change' : props.mode === 'verify' ? 'unlock' : 'checking',
  );
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Re-rendered once a second while locked, so the countdown moves.
  const [, tick] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const { onCancel } = props;
  const { active } = useTheme();
  const titles = { ...TITLES, unlock: active.copy.pinGateTitle ?? TITLES.unlock };
  const genericTitle = active.copy.teacherRoleLabel ?? 'Teacher PIN';

  useModalFocusTrap(dialogRef);

  const check = useCallback(async () => {
    setPhase('checking');
    setError(null);
    try {
      setPhase((await hasOperatorPin()) ? 'unlock' : 'set');
    } catch {
      setPhase('storage-error');
      setError(STORAGE);
    }
  }, []);

  useEffect(() => {
    if (props.mode === 'gate') void check();
  }, [props.mode, check]);

  // Focus the first field as soon as there is one; hand focus back on the way
  // out, as the other dialogs do, so the keyboard is not dropped on <body>.
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
    if (phase === 'set' || phase === 'unlock' || phase === 'change') {
      firstFieldRef.current?.focus();
    }
  }, [phase]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  useEffect(() => {
    if (!lockedUntil) return;
    const id = window.setInterval(() => {
      if (Date.parse(lockedUntil) <= Date.now()) {
        setLockedUntil(null);
      } else {
        tick((n) => n + 1);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [lockedUntil]);

  const handleVerdict = useCallback(
    async (
      verdict: PinVerification,
      onOk: () => void | Promise<void>,
      clearWrong: () => void,
    ) => {
      switch (verdict.status) {
        case 'ok':
          await onOk();
          return;
        case 'wrong':
          // Only the field that was wrong is cleared: in change mode the new
          // PIN, typed twice already, stays for the retry.
          clearWrong();
          if (verdict.lockedUntil) setLockedUntil(verdict.lockedUntil);
          else setError(WRONG);
          return;
        case 'locked':
          setLockedUntil(verdict.lockedUntil);
          return;
        case 'unset':
          // The PIN vanished between the read and the check: offer to set one.
          setPin('');
          setConfirm('');
          setPhase('set');
          return;
      }
    },
    [],
  );

  const canSubmit =
    !busy &&
    (phase === 'unlock'
      ? isValidPin(pin)
      : phase === 'set'
        ? isValidPin(pin) && isValidPin(confirm)
        : phase === 'change'
          ? isValidPin(current) && isValidPin(pin) && isValidPin(confirm)
          : false);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      if (phase === 'set') {
        if (pin !== confirm) {
          setError(MISMATCH);
          return;
        }
        await setOperatorPin(pin);
        await logQuietly('pin-set');
        if (props.mode === 'gate') props.onUnlocked('set');
        // Change mode lands here when the PIN had vanished ('unset'): the new
        // PIN is saved, so the dialog finishes instead of staying open.
        else if (props.mode === 'change') props.onChanged('set');
      } else if (phase === 'unlock') {
        const verdict =
          props.mode === 'verify' && props.verify
            ? await props.verify(pin)
            : await verifyOperatorPin(pin);
        if (props.mode === 'verify' && verdict.status === 'unset') {
          setPin('');
          if (props.onPinMissing) props.onPinMissing();
          else setError(PIN_MISSING);
          return;
        }
        await handleVerdict(
          verdict,
          () => {
            if (props.mode === 'gate') props.onUnlocked('unlocked');
            else if (props.mode === 'verify') props.onVerified();
          },
          () => setPin(''),
        );
      } else if (phase === 'change') {
        if (pin !== confirm) {
          setError(MISMATCH);
          return;
        }
        await handleVerdict(
          await changeOperatorPin(current, pin),
          async () => {
            await logQuietly('pin-changed');
            if (props.mode === 'change') props.onChanged('changed');
          },
          () => setCurrent(''),
        );
      }
    } catch (caught) {
      if (caught instanceof OperatorPinExistsError) {
        // Someone set a PIN while this set form was open. Nothing was
        // overwritten; ask for that PIN instead. Change mode goes back to its
        // own form, since only it can finish a change.
        setCurrent('');
        setPin('');
        setConfirm('');
        setPhase(props.mode === 'change' ? 'change' : 'unlock');
        setError(PIN_APPEARED);
        return;
      }
      setError(caught instanceof PinUnavailableError ? NO_CRYPTO : STORAGE);
    } finally {
      setBusy(false);
    }
  }, [canSubmit, phase, pin, confirm, current, props, handleVerdict]);

  const message = lockedUntil ? lockedText(lockedUntil) : error;
  const formPhase = phase === 'set' || phase === 'unlock' || phase === 'change' ? phase : null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex overflow-y-auto overscroll-contain bg-[hsl(var(--background)/.86)] px-5 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-dialog-title"
      data-testid="dialog-pin"
    >
      <div className="m-auto w-full max-w-md rounded-[1.35rem] border border-[hsl(var(--primary)/.45)] bg-[hsl(var(--card))] p-5 shadow-[0_24px_90px_hsl(211_55%_5%/.5)] sm:p-6">
        <div className="flex items-start gap-2.5">
          <KeyRound
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-[hsl(var(--primary))]"
            size={18}
          />
          <div className="min-w-0">
            <h2
              id="pin-dialog-title"
              className="font-display text-lg font-semibold tracking-[-0.02em] text-[hsl(var(--foreground))]"
              // The id arrives with the real title: a test or a driver waiting
              // for it then waits for the phase to be known, not for a placeholder.
              data-testid={formPhase ? 'text-pin-title' : undefined}
            >
              {formPhase ? titles[formPhase] : genericTitle}
            </h2>
            {formPhase ? (
              <p className="mt-2 text-sm leading-snug text-[hsl(var(--muted-foreground))]">
                {HELPERS[formPhase]}
              </p>
            ) : null}
          </div>
        </div>

        {phase === 'checking' ? (
          <p
            className="mt-4 text-sm text-[hsl(var(--muted-foreground))]"
            aria-busy="true"
            data-testid="text-pin-status"
          >
            Checking this device…
          </p>
        ) : null}

        {formPhase ? (
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {formPhase === 'change' ? (
              <PinField
                id="pin-current"
                label="Current PIN"
                value={current}
                onChange={setCurrent}
                onSubmit={() => void submit()}
                testId="input-pin-current"
                inputRef={firstFieldRef}
              />
            ) : null}
            <PinField
              id="pin-new"
              label={formPhase === 'unlock' ? 'PIN' : 'New PIN'}
              value={pin}
              onChange={setPin}
              onSubmit={() => void submit()}
              testId="input-pin"
              inputRef={formPhase === 'change' ? undefined : firstFieldRef}
            />
            {formPhase !== 'unlock' ? (
              <PinField
                id="pin-confirm"
                label="New PIN again"
                value={confirm}
                onChange={setConfirm}
                onSubmit={() => void submit()}
                testId="input-pin-confirm"
              />
            ) : null}
          </form>
        ) : null}

        {message ? (
          <p
            className="mt-3 text-sm font-semibold text-[hsl(var(--destructive))]"
            role="alert"
            data-testid="text-pin-error"
          >
            {message}
          </p>
        ) : null}

        {phase === 'storage-error' ? (
          <button
            type="button"
            onClick={() => void check()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-[hsl(var(--destructive)/.6)] px-4 py-3 text-sm font-bold text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)/.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-testid="button-pin-retry"
          >
            <RotateCcw aria-hidden="true" size={15} />
            Retry
          </button>
        ) : null}

        {formPhase ? (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="button-pin-submit"
          >
            {formPhase === 'set'
              ? 'Set PIN'
              : formPhase === 'change'
                ? 'Change PIN'
                : props.mode === 'verify'
                  ? 'Confirm'
                  : 'Unlock'}
          </button>
        ) : null}

        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full text-xs font-semibold text-[hsl(var(--muted-foreground))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-testid="button-pin-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
