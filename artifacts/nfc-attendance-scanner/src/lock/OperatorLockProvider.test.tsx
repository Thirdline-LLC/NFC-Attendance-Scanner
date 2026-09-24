import Dexie from 'dexie';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { setPinRequired as storeSetPinRequired } from '@/data/attendance-store';
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
    const { result, unmount } = renderHook(() => useOperatorLock(), { wrapper });
    await waitFor(() => expect(result.current.pinRequired).toBe(true));

    await act(async () => {
      await result.current.setPinRequired(false);
    });
    expect(result.current.pinRequired).toBe(false);
    expect(result.current.unlocked).toBe(true);
    unmount();

    const { result: fresh } = renderHook(() => useOperatorLock(), { wrapper });
    await waitFor(() => expect(fresh.current.pinRequired).toBe(false));
    expect(fresh.current.unlocked).toBe(true);
  });
});
