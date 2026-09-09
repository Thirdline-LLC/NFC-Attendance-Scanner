import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  IDLE_RELOCK_MS,
  OperatorLockProvider,
  RelockOnScanner,
  useOperatorLock,
} from './OperatorLockProvider';

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

  it('relocks after five idle minutes, and any key or tap restarts the clock', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useOperatorLock(), { wrapper });
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
});
