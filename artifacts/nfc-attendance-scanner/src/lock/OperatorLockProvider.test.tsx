import Dexie from 'dexie';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as attendanceStore from '@/data/attendance-store';
import { setPinRequired as storeSetPinRequired } from '@/data/attendance-store';
import { hasOperatorPin, setOperatorPin, verifyOperatorPin } from '@/data/operator-pin';
import { LockedRoute } from './LockedRoute';
import {
  IDLE_RELOCK_MS,
  OperatorLockProvider,
  RelockOnScanner,
  useOperatorLock,
} from './OperatorLockProvider';

const DATABASE_NAME = 'attendance-scanner-local';

beforeEach(async () => {
  localStorage.clear();
  await Dexie.delete(DATABASE_NAME);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <OperatorLockProvider>{children}</OperatorLockProvider>
);

describe('OperatorLockProvider', () => {
  it('starts locked, unlocks, relocks', () => {
    const { result } = renderHook(() => useOperatorLock(), { wrapper });
    expect(result.current.unlocked).toBe(false);
    act(() => result.current.unlock());
    expect(result.current.unlocked).toBe(true);
    act(() => result.current.relock());
    expect(result.current.unlocked).toBe(false);
  });

  it('throws without a provider, so a missing one is a build error not a silent open door', () => {
    expect(() => renderHook(() => useOperatorLock())).toThrow(/OperatorLockProvider/);
  });

  it('relocks after five idle minutes, and any key or tap restarts the clock', async () => {
    const { result } = renderHook(() => useOperatorLock(), { wrapper });
    // The initial `pinRequired` read is a real IndexedDB round trip; let it
    // settle under real timers first; fake-indexeddb schedules its own work
    // on the same clock `vi.useFakeTimers()` below takes over, and engaging
    // it before that read finishes leaves the fake-indexeddb connection in a
    // state later tests in this file cannot open a fresh one against.
    await waitFor(() => expect(result.current.pinRequired).toBe(true));

    vi.useFakeTimers();
    act(() => result.current.unlock());

    act(() => {
      vi.advanceTimersByTime(IDLE_RELOCK_MS - 60_000);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    act(() => {
      vi.advanceTimersByTime(IDLE_RELOCK_MS - 60_000);
    });
    expect(result.current.unlocked).toBe(true);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.unlocked).toBe(false);
  });

  it('relocks when the location becomes the scanner', () => {
    function Probe() {
      const { unlocked, unlock } = useOperatorLock();
      const navigate = useNavigate();
      return (
        <>
          <span data-testid="state">{unlocked ? 'open' : 'locked'}</span>
          <button type="button" onClick={unlock}>
            unlock
          </button>
          <button type="button" onClick={() => navigate('/')}>
            home
          </button>
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={['/roster']}>
        <OperatorLockProvider>
          <RelockOnScanner />
          <Routes>
            <Route path="*" element={<Probe />} />
          </Routes>
        </OperatorLockProvider>
      </MemoryRouter>,
    );
    act(() => screen.getByText('unlock').click());
    expect(screen.getByTestId('state').textContent).toBe('open');
    act(() => screen.getByText('home').click());
    expect(screen.getByTestId('state').textContent).toBe('locked');
  });

  describe('with the PIN requirement turned off', () => {
    it('reads the setting on mount and is unlocked without ever calling unlock', async () => {
      await storeSetPinRequired(false);
      const { result } = renderHook(() => useOperatorLock(), { wrapper });
      await waitFor(() => expect(result.current.pinRequired).toBe(false));
      expect(result.current.unlocked).toBe(true);
    });

    it('does not idle-relock', async () => {
      await storeSetPinRequired(false);
      const { result } = renderHook(() => useOperatorLock(), { wrapper });
      await waitFor(() => expect(result.current.pinRequired).toBe(false));

      vi.useFakeTimers();
      act(() => {
        vi.advanceTimersByTime(IDLE_RELOCK_MS * 2);
      });
      expect(result.current.unlocked).toBe(true);
    });

    it('does not relock on navigating to the scanner', async () => {
      await storeSetPinRequired(false);
      function Probe() {
        const { unlocked } = useOperatorLock();
        const navigate = useNavigate();
        return (
          <>
            <span data-testid="state">{unlocked ? 'open' : 'locked'}</span>
            <button type="button" onClick={() => navigate('/')}>
              home
            </button>
          </>
        );
      }
      render(
        <MemoryRouter initialEntries={['/roster']}>
          <OperatorLockProvider>
            <RelockOnScanner />
            <Routes>
              <Route path="*" element={<Probe />} />
            </Routes>
          </OperatorLockProvider>
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('open'));
      act(() => screen.getByText('home').click());
      expect(screen.getByTestId('state').textContent).toBe('open');
    });

    it('mounts a locked route without a PIN prompt', async () => {
      await storeSetPinRequired(false);
      render(
        <MemoryRouter initialEntries={['/roster']}>
          <OperatorLockProvider>
            <LockedRoute>
              <div data-testid="protected-content">Roster</div>
            </LockedRoute>
          </OperatorLockProvider>
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getByTestId('protected-content')).toBeTruthy());
      expect(screen.queryByTestId('dialog-pin')).toBeNull();
    });
  });

  describe('with the PIN requirement on (unchanged behavior)', () => {
    it('still gates a locked route behind the PIN dialog', async () => {
      await storeSetPinRequired(true);
      render(
        <MemoryRouter initialEntries={['/roster']}>
          <OperatorLockProvider>
            <LockedRoute>
              <div data-testid="protected-content">Roster</div>
            </LockedRoute>
          </OperatorLockProvider>
        </MemoryRouter>,
      );
      expect(await screen.findByTestId('dialog-pin')).toBeTruthy();
      expect(screen.queryByTestId('protected-content')).toBeNull();
    });
  });

  it('setPinRequired persists the setting; a freshly mounted provider reads it back', async () => {
    await setOperatorPin('2468');
    const { result, unmount } = renderHook(() => useOperatorLock(), { wrapper });
    await waitFor(() => expect(result.current.pinRequired).toBe(true));

    await act(async () => {
      expect(await result.current.setPinRequired(false, '2468')).toEqual({ status: 'ok' });
    });
    expect(result.current.pinRequired).toBe(false);
    expect(result.current.unlocked).toBe(true);
    unmount();

    const { result: fresh } = renderHook(() => useOperatorLock(), { wrapper });
    await waitFor(() => expect(fresh.current.pinRequired).toBe(false));
    expect(fresh.current.unlocked).toBe(true);
  });

  describe('setPinRequired enforces its own rules (not only the dashboard UI)', () => {
    it('refuses to turn off without a PIN argument', async () => {
      await setOperatorPin('2468');
      const { result } = renderHook(() => useOperatorLock(), { wrapper });
      await waitFor(() => expect(result.current.pinRequired).toBe(true));

      await expect(result.current.setPinRequired(false)).rejects.toThrow(/current PIN/);
      expect(result.current.pinRequired).toBe(true);
      expect(await attendanceStore.getPinRequired()).toBe(true);
    });

    it('a wrong PIN leaves it on and returns the verdict; the right one turns it off', async () => {
      await setOperatorPin('2468');
      const { result } = renderHook(() => useOperatorLock(), { wrapper });
      await waitFor(() => expect(result.current.pinRequired).toBe(true));

      let verdict: Awaited<ReturnType<typeof result.current.setPinRequired>> | undefined;
      await act(async () => {
        verdict = await result.current.setPinRequired(false, '0000');
      });
      expect(verdict?.status).toBe('wrong');
      expect(result.current.pinRequired).toBe(true);
      expect(await attendanceStore.getPinRequired()).toBe(true);

      await act(async () => {
        verdict = await result.current.setPinRequired(false, '2468');
      });
      expect(verdict).toEqual({ status: 'ok' });
      expect(result.current.pinRequired).toBe(false);
      // The hash is untouched.
      expect(await hasOperatorPin()).toBe(true);
      expect((await verifyOperatorPin('2468')).status).toBe('ok');
    });

    it('refuses to turn on when no PIN exists, returning unset', async () => {
      await storeSetPinRequired(false);
      const { result } = renderHook(() => useOperatorLock(), { wrapper });
      await waitFor(() => expect(result.current.pinRequired).toBe(false));

      let verdict: Awaited<ReturnType<typeof result.current.setPinRequired>> | undefined;
      await act(async () => {
        verdict = await result.current.setPinRequired(true);
      });
      expect(verdict).toEqual({ status: 'unset' });
      expect(result.current.pinRequired).toBe(false);
    });

    it('turns on with no PIN argument once a PIN exists', async () => {
      await setOperatorPin('2468');
      await storeSetPinRequired(false);
      const { result } = renderHook(() => useOperatorLock(), { wrapper });
      await waitFor(() => expect(result.current.pinRequired).toBe(false));

      await act(async () => {
        expect(await result.current.setPinRequired(true)).toEqual({ status: 'ok' });
      });
      expect(result.current.pinRequired).toBe(true);
      expect(await attendanceStore.getPinRequired()).toBe(true);
    });
  });

  it('falls back to required when the first read of the setting fails', async () => {
    const spy = vi
      .spyOn(attendanceStore, 'getPinRequired')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    const { result } = renderHook(() => useOperatorLock(), { wrapper });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    // Let the rejected read settle; the handled rejection must leave it safe.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.pinRequired).toBe(true);
    expect(result.current.unlocked).toBe(false);
    spy.mockRestore();
  });

  it('resumes idle and scanner relocks after the requirement is turned back on', async () => {
    await setOperatorPin('2468');
    await storeSetPinRequired(false);
    function Probe() {
      const { unlocked, unlock, pinRequired, setPinRequired } = useOperatorLock();
      const navigate = useNavigate();
      return (
        <>
          <span data-testid="state">{unlocked ? 'open' : 'locked'}</span>
          <span data-testid="required">{pinRequired ? 'on' : 'off'}</span>
          <button type="button" onClick={() => navigate('/')}>
            home
          </button>
          <button type="button" onClick={() => navigate('/dashboard')}>
            dashboard
          </button>
          <button type="button" onClick={unlock}>
            unlock
          </button>
          <button
            type="button"
            onClick={() => {
              // The dashboard's order: unlock first, then re-arm the gate.
              unlock();
              void setPinRequired(true);
            }}
          >
            turn on
          </button>
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <OperatorLockProvider>
          <RelockOnScanner />
          <Routes>
            <Route path="*" element={<Probe />} />
          </Routes>
        </OperatorLockProvider>
      </MemoryRouter>,
    );
    const state = () => screen.getByTestId('state').textContent;
    const required = () => screen.getByTestId('required').textContent;
    await waitFor(() => expect(required()).toBe('off'));
    expect(state()).toBe('open');

    // While off: visiting the scanner drops the in-memory unlock, but the
    // gate stays open because the requirement is off.
    act(() => screen.getByText('home').click());
    expect(state()).toBe('open');
    act(() => screen.getByText('dashboard').click());

    // Back on: open immediately (no prompt under the teacher's hands)...
    await act(async () => {
      screen.getByText('turn on').click();
    });
    await waitFor(() => expect(required()).toBe('on'));
    expect(state()).toBe('open');
    expect(await attendanceStore.getPinRequired()).toBe(true);

    // ...and the scanner relock applies again.
    act(() => screen.getByText('home').click());
    expect(state()).toBe('locked');

    // The idle relock applies again too. Fake timers are engaged before the
    // unlock (the PIN passing on re-entry) so they own the idle timer; the
    // IndexedDB work above has already settled under real timers.
    vi.useFakeTimers();
    act(() => screen.getByText('dashboard').click());
    act(() => screen.getByText('unlock').click());
    expect(state()).toBe('open');
    act(() => {
      vi.advanceTimersByTime(IDLE_RELOCK_MS - 1_000);
    });
    expect(state()).toBe('open');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(state()).toBe('locked');
  });
});
