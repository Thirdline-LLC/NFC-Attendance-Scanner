import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import {
  getPinRequired,
  setPinRequired as storeSetPinRequired,
} from '@/data/attendance-store';

/** Five minutes without a key or a tap and the teacher is assumed gone. */
export const IDLE_RELOCK_MS = 5 * 60_000;

type OperatorLock = {
  /**
   * Whether the locked routes should mount. True whenever the PIN gate is
   * turned off (`!pinRequired`), regardless of the in-memory unlock flag
   * below — a device with the gate off is always open.
   */
  unlocked: boolean;
  /** Whether the teacher PIN gates the locked routes on this device. */
  pinRequired: boolean;
  unlock: () => void;
  relock: () => void;
  /** Persists the setting and updates this device's live gate immediately. */
  setPinRequired: (required: boolean) => Promise<void>;
};

const OperatorLockContext = createContext<OperatorLock | null>(null);

/**
 * One in-memory flag: whether the teacher has unlocked this device since the
 * page loaded. Deliberately not persisted — a reload is locked, and so is a
 * tab the teacher walked away from. `initiallyUnlocked` exists for tests of
 * screens that are not about the lock.
 *
 * `pinRequired` is the device setting a teacher can turn off (Design 05):
 * while off, every locked route is treated as unlocked and the idle/scanner
 * relocks below are skipped. It is read from `settings` on mount, optimistic
 * `true` in the meantime — the same "missing reads as required" default the
 * store itself uses — so a slow read never flashes the gate open.
 */
export function OperatorLockProvider({
  children,
  initiallyUnlocked = false,
}: {
  children: ReactNode;
  initiallyUnlocked?: boolean;
}) {
  const [rawUnlocked, setRawUnlocked] = useState(initiallyUnlocked);
  const [pinRequired, setPinRequiredState] = useState(true);
  const unlock = useCallback(() => setRawUnlocked(true), []);
  const relock = useCallback(() => setRawUnlocked(false), []);
  const unlocked = !pinRequired || rawUnlocked;

  useEffect(() => {
    let cancelled = false;
    void getPinRequired().then((required) => {
      if (!cancelled) setPinRequiredState(required);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPinRequired = useCallback(async (required: boolean) => {
    await storeSetPinRequired(required);
    setPinRequiredState(required);
  }, []);

  useEffect(() => {
    // While the gate is off, `unlocked` is already true regardless of
    // `rawUnlocked` — an idle timer here would have nothing to protect, so
    // it is not even set up.
    if (!pinRequired || !rawUnlocked) return;
    let timer = window.setTimeout(relock, IDLE_RELOCK_MS);
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(relock, IDLE_RELOCK_MS);
    };
    window.addEventListener('pointerdown', restart);
    window.addEventListener('keydown', restart);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', restart);
      window.removeEventListener('keydown', restart);
    };
  }, [pinRequired, rawUnlocked, relock]);

  const value = useMemo(
    () => ({ unlocked, pinRequired, unlock, relock, setPinRequired }),
    [unlocked, pinRequired, unlock, relock, setPinRequired],
  );
  return (
    <OperatorLockContext.Provider value={value}>
      {children}
    </OperatorLockContext.Provider>
  );
}

export function useOperatorLock(): OperatorLock {
  const lock = useContext(OperatorLockContext);
  if (!lock) {
    throw new Error('useOperatorLock needs an OperatorLockProvider above it.');
  }
  return lock;
}

/**
 * Relocks whenever the location becomes the scanner. Mounted inside the
 * router: leaving an admin page is the teacher handing the device back.
 */
export function RelockOnScanner() {
  const { pathname } = useLocation();
  const { relock } = useOperatorLock();
  useEffect(() => {
    if (pathname === '/') relock();
  }, [pathname, relock]);
  return null;
}
