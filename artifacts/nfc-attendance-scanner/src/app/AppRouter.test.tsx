import Dexie from 'dexie';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppRouter } from './AppRouter';

/**
 * `BrowserRouter` reads the real location, so a deep link is set up the way the
 * browser would have: put the path on the history stack, then mount.
 */
function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(<AppRouter />);
}

describe('AppRouter', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  afterEach(() => {
    cleanup();
    window.history.pushState({}, '', '/');
  });

  it('serves the scanner at the root', async () => {
    renderAt('/');

    expect(await screen.findByTestId('scanner-station')).toBeTruthy();
  });

  it('serves the roster at /roster and the dashboard at /dashboard', async () => {
    renderAt('/roster');
    expect(await screen.findByTestId('roster-page')).toBeTruthy();
    expect(await screen.findByTestId('roster-manager')).toBeTruthy();
    cleanup();

    renderAt('/dashboard');
    expect(await screen.findByTestId('dashboard-page')).toBeTruthy();
    expect(await screen.findByTestId('dashboard')).toBeTruthy();
  });

  it('sends an unknown path back to the scanner', async () => {
    renderAt('/not-a-page');

    expect(await screen.findByTestId('scanner-station')).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });

  it('leaves the roster search focused: the hidden scanner input is not mounted', async () => {
    const user = userEvent.setup();
    renderAt('/roster');

    const search = await screen.findByTestId('input-roster-search');
    await user.type(search, 'jane');
    expect(screen.queryByTestId('input-scanner-hidden')).toBeNull();

    // The scanner grabs focus back whenever the window regains it. With the
    // scanner unmounted its listener must be gone, or the roster search would
    // lose every keystroke on a kiosk that blurs and refocuses.
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(document.activeElement).toBe(search);
    expect((search as HTMLInputElement).value).toBe('jane');
    expect(screen.queryByTestId('input-scanner-hidden')).toBeNull();
  });

  it('navigates scanner → roster → scanner and refocuses the reader on return', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const scannerInput = await screen.findByTestId('input-scanner-hidden');
    await waitFor(() => expect(document.activeElement).toBe(scannerInput));

    await user.click(screen.getByTestId('link-roster'));
    expect(await screen.findByTestId('roster-page')).toBeTruthy();
    expect(screen.queryByTestId('scanner-station')).toBeNull();

    await user.click(screen.getByTestId('link-scanner'));
    const returned = await screen.findByTestId('input-scanner-hidden');
    await waitFor(() => expect(document.activeElement).toBe(returned));
  });

  it('crosses between the two admin pages without the kiosk in between', async () => {
    const user = userEvent.setup();
    renderAt('/roster');
    await screen.findByTestId('roster-page');

    await user.click(screen.getByTestId('link-dashboard'));
    expect(await screen.findByTestId('dashboard-page')).toBeTruthy();

    // Going the other way used to mean a round trip through the scanner, which
    // takes the reader focus on the way past.
    await user.click(screen.getByTestId('link-roster'));
    expect(await screen.findByTestId('roster-page')).toBeTruthy();
    expect(screen.queryByTestId('scanner-station')).toBeNull();
  });

  it('reaches the dashboard from the scanner header', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await screen.findByTestId('scanner-station');

    await user.click(screen.getByTestId('link-dashboard'));

    expect(await screen.findByTestId('dashboard-page')).toBeTruthy();
  });
});
