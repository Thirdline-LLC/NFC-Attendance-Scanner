import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PinDialog } from '@/lock/PinDialog';
import { useOperatorLock } from '@/lock/OperatorLockProvider';
import { ScansPausedNotice } from '@/ui/ScansPausedNotice';

/**
 * The teacher's half of the app. Until the unlock, the page inside is not
 * mounted at all — no roster read, no history read — and the shell says the
 * one thing that is still true here: the reader is not recording.
 */
export function LockedRoute({ children }: { children: ReactNode }) {
  const { unlocked, unlock } = useOperatorLock();
  const navigate = useNavigate();

  if (unlocked) return <>{children}</>;

  return (
    <main
      className="grain relative min-h-[100dvh] overflow-hidden bg-[hsl(var(--background))]"
      data-testid="locked-page"
    >
      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-8 sm:py-7">
        <ScansPausedNotice />
      </div>
      <PinDialog mode="gate" onUnlocked={unlock} onCancel={() => navigate('/')} />
    </main>
  );
}
