import { useEffect } from 'react';

/**
 * The slice of the Screen Wake Lock API this hook uses.
 *
 * Declared locally rather than pulled from `lib.dom` because the API is not in
 * every TypeScript DOM library version, and because a hook whose whole job is
 * feature detection should not need the type to exist to compile.
 */
type WakeLockSentinelLike = {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
};

type WakeLockLike = {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
};

function wakeLockApi(): WakeLockLike | undefined {
  if (typeof navigator === 'undefined') return undefined;

  const api = (navigator as Navigator & { wakeLock?: unknown }).wakeLock;

  // Safari before 16.4, every Android WebView before Chrome 84, and jsdom all
  // land here. None of them is an error: the screen simply dims as it always
  // did, and scanning is unaffected.
  if (!api || typeof (api as WakeLockLike).request !== 'function') {
    return undefined;
  }

  return api as WakeLockLike;
}

/** True where the browser or WebView implements the Screen Wake Lock API. */
export function isWakeLockSupported(): boolean {
  return wakeLockApi() !== undefined;
}

/**
 * Keeps the screen awake while `active` is true.
 *
 * A meeting is an hour of a tablet sitting on a table with nobody touching it,
 * and a kiosk whose screen has gone dark reads as a kiosk that has crashed —
 * the next student walks past instead of tapping. The lock is therefore held
 * for as long as the scanner is the thing on screen and dropped the moment it
 * is not.
 *
 * The browser revokes the lock on its own whenever the tab is hidden, which is
 * why the visibility listener re-requests it: without that, one switch to
 * another app leaves the kiosk dimming for the rest of the session.
 *
 * Every failure path is silent by design. A refused lock costs a dimmed
 * screen; it must never cost a scan, and there is nothing an operator could do
 * about it anyway.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const api = wakeLockApi();
    if (!api) return;

    let sentinel: WakeLockSentinelLike | undefined;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        const granted = await api.request('screen');

        // The request takes a few hundred milliseconds on a real tablet, and
        // the scanner can be navigated away from inside that window. Cleanup
        // has then already run and found nothing to release, so a lock that
        // arrives now would be held for the rest of the page's life -- on
        // /roster, on /dashboard, and after the operator has walked away.
        // Nothing else holds a reference to it, so this is the only chance to
        // let it go.
        if (cancelled) {
          void granted.release().catch(() => {});
          return;
        }

        sentinel = granted;
        // A lock the browser drops for its own reasons must not look held.
        granted.addEventListener('release', () => {
          if (sentinel === granted) sentinel = undefined;
        });
      } catch {
        sentinel = undefined;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !sentinel) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      // Releasing an already-released sentinel rejects in some engines.
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
      sentinel = undefined;
    };
  }, [active]);
}
