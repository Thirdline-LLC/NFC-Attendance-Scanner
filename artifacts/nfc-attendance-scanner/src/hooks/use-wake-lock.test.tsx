import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isWakeLockSupported, useWakeLock } from '@/hooks/use-wake-lock';

/** A stand-in sentinel that records whether it was released. */
function fakeSentinel() {
  const listeners: (() => void)[] = [];
  return {
    released: false,
    release: vi.fn(async function (this: { released: boolean }) {
      this.released = true;
    }),
    addEventListener: vi.fn((_type: 'release', listener: () => void) => {
      listeners.push(listener);
    }),
    /** Fires the browser's own "I took this back" event. */
    revoke() {
      this.released = true;
      for (const listener of listeners) listener();
    },
  };
}

function installWakeLock(request: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
    writable: true,
  });
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

function Kiosk({ active }: { active: boolean }) {
  useWakeLock(active);
  return <div data-testid="kiosk" />;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'wakeLock');
  setVisibility('visible');
  vi.restoreAllMocks();
});

describe('isWakeLockSupported', () => {
  it('is false where the API is missing, which is jsdom and every old WebView', () => {
    expect(isWakeLockSupported()).toBe(false);
  });

  it('is false when navigator.wakeLock exists but cannot be requested', () => {
    // Some WebViews expose the object without the method behind it.
    Object.defineProperty(navigator, 'wakeLock', {
      value: {},
      configurable: true,
      writable: true,
    });

    expect(isWakeLockSupported()).toBe(false);
  });

  it('is true once the API is present', () => {
    installWakeLock(vi.fn());

    expect(isWakeLockSupported()).toBe(true);
  });
});

describe('useWakeLock', () => {
  it('renders and does nothing at all where the API is missing', () => {
    // The kiosk still has to work on a device whose screen simply dims.
    expect(() => render(<Kiosk active />)).not.toThrow();
  });

  it('takes a screen lock while active', async () => {
    const sentinel = fakeSentinel();
    const request = vi.fn().mockResolvedValue(sentinel);
    installWakeLock(request);

    render(<Kiosk active />);
    await act(async () => {});

    expect(request).toHaveBeenCalledWith('screen');
  });

  it('takes no lock when inactive', async () => {
    const request = vi.fn().mockResolvedValue(fakeSentinel());
    installWakeLock(request);

    render(<Kiosk active={false} />);
    await act(async () => {});

    expect(request).not.toHaveBeenCalled();
  });

  it('releases the lock when the screen holding it goes away', async () => {
    const sentinel = fakeSentinel();
    installWakeLock(vi.fn().mockResolvedValue(sentinel));

    const view = render(<Kiosk active />);
    await act(async () => {});
    await act(async () => {
      view.unmount();
    });

    // Navigating to /roster unmounts ScannerScreen; the lock must not outlive
    // the screen that asked for it.
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('takes the lock again after the browser revokes it on hiding the tab', async () => {
    const first = fakeSentinel();
    const second = fakeSentinel();
    const request = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    installWakeLock(request);

    render(<Kiosk active />);
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);

    // What actually happens when a teacher switches apps mid-meeting: the
    // browser drops the lock, and without re-requesting it the kiosk dims for
    // the rest of the session.
    await act(async () => {
      first.revoke();
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('releases a lock that arrives after the screen has already gone', async () => {
    // The request takes a few hundred milliseconds on a real tablet, and the
    // operator can tap through to /roster inside that window. Before this was
    // fixed the sentinel landed in an orphaned closure with nothing holding a
    // reference to it, and the screen stayed awake for the rest of the page's
    // life — on /roster, on /dashboard, and after everyone had gone home.
    const sentinel = fakeSentinel();
    let grant = (_value: typeof sentinel) => {};
    installWakeLock(
      vi.fn().mockReturnValue(
        new Promise<typeof sentinel>((resolve) => {
          grant = resolve;
        }),
      ),
    );

    const view = render(<Kiosk active />);
    // Unmount while the request is still in flight.
    await act(async () => {
      view.unmount();
    });
    await act(async () => {
      grant(sentinel);
    });

    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('survives a refused request without throwing', async () => {
    installWakeLock(vi.fn().mockRejectedValue(new Error('NotAllowedError')));

    const view = render(<Kiosk active />);
    await act(async () => {});

    // A refused lock costs a dimmed screen. It must never cost a scan.
    expect(() => view.unmount()).not.toThrow();
  });
});
