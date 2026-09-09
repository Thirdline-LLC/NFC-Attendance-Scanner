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

/** Five minutes without a key or a tap and the teacher is assumed gone. */
export const IDLE_RELOCK_MS = 5 * 60_000;

type OperatorLock = {
  unlocked: boolean;
  unlock: () => void;
  relock: () => void;
};

const OperatorLockContext = createContext<OperatorLock | null>(null);

/**
 * One in-memory flag: whether the teacher has unlocked this device since the
 * page loaded. Deliberately not persisted — a reload is locked, and so is a
 * tab the teacher walked away from. `initiallyUnlocked` exists for tests of
 * screens that are not about the lock.
 */
export function OperatorLockProvider({
  children,
  initiallyUnlocked = false,
}: {
  children: ReactNode;
  initiallyUnlocked?: boolean;
}) {
  const [unlocked, setUnlocked] = useState(initiallyUnlocked);
  const unlock = useCallback(() => setUnlocked(true), []);
  const relock = useCallback(() => setUnlocked(false), []);

  useEffect(() => {
    if (!unlocked) return;
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
  }, [unlocked, relock]);

  const value = useMemo(
    () => ({ unlocked, unlock, relock }),
    [unlocked, unlock, relock],
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
