import Dexie from 'dexie';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setOperatorPin } from '@/data/operator-pin';
import { AppRouter, routerBasename } from './AppRouter';

/**
 * `BrowserRouter` reads the real location, so a deep link is set up the way the
 * browser would have: put the path on the history stack, then mount.
 */
function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(<AppRouter />);
}

/** Types the teacher PIN into the gate and submits by button. */
async function passGate(user: ReturnType<typeof userEvent.setup>, pin = '2468') {
  const dialog = await screen.findByTestId('dialog-pin');
  await user.type(within(dialog).getByTestId('input-pin'), pin);
  await user.click(within(dialog).getByTestId('button-pin-submit'));
  await waitFor(() => expect(screen.queryByTestId('dialog-pin')).toBeNull());
}

describe('AppRouter', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
    // A device with a PIN: the two admin routes ask for it.
    await setOperatorPin('2468');
  });

  afterEach(() => {
    cleanup();
    window.history.pushState({}, '', '/');
  });

  it('serves the scanner at the root', async () => {
    renderAt('/');

    expect(await screen.findByTestId('scanner-station')).toBeTruthy();
  });

  it('serves the roster at /roster and the dashboard at /dashboard, behind the gate', async () => {
    const user = userEvent.setup();
    renderAt('/roster');
    await passGate(user);
    expect(await screen.findByTestId('roster-page')).toBeTruthy();
    expect(await screen.findByTestId('roster-manager')).toBeTruthy();
    cleanup();

    renderAt('/dashboard');
    await passGate(user);
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
    await passGate(user);

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
    await passGate(user);
    expect(await screen.findByTestId('roster-page')).toBeTruthy();
    expect(screen.queryByTestId('scanner-station')).toBeNull();

    await user.click(screen.getByTestId('link-scanner'));
    const returned = await screen.findByTestId('input-scanner-hidden');
    await waitFor(() => expect(document.activeElement).toBe(returned));
  });

  it('crosses between the two admin pages without the kiosk in between', async () => {
    const user = userEvent.setup();
    renderAt('/roster');
    await passGate(user);
    await screen.findByTestId('roster-page');

    await user.click(screen.getByTestId('link-dashboard'));
    expect(await screen.findByTestId('dashboard-page')).toBeTruthy();
    // One unlock covers both admin pages: the gate is per visit to the
    // teacher's side, not per page.
    expect(screen.queryByTestId('dialog-pin')).toBeNull();

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
    await passGate(user);

    expect(await screen.findByTestId('dashboard-page')).toBeTruthy();
  });

  it('shows the gate and mounts nothing until the teacher unlocks', async () => {
    const user = userEvent.setup();
    renderAt('/roster');

    expect(await screen.findByTestId('locked-page')).toBeTruthy();
    expect(screen.getByTestId('text-scans-paused')).toBeTruthy();
    expect(screen.queryByTestId('roster-manager')).toBeNull();

    await passGate(user);
    expect(await screen.findByTestId('roster-manager')).toBeTruthy();
  });

  it('returns to the scanner when the gate is cancelled', async () => {
    const user = userEvent.setup();
    renderAt('/dashboard');
    await screen.findByTestId('dialog-pin');

    await user.click(screen.getByTestId('button-pin-cancel'));

    expect(await screen.findByTestId('scanner-station')).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });

  it('locks again once the teacher has gone back to the scanner', async () => {
    const user = userEvent.setup();
    renderAt('/roster');
    await passGate(user);
    await screen.findByTestId('roster-manager');

    await user.click(screen.getByTestId('link-scanner'));
    await screen.findByTestId('scanner-station');
    await user.click(screen.getByTestId('link-roster'));

    expect(await screen.findByTestId('dialog-pin')).toBeTruthy();
    expect(screen.queryByTestId('roster-manager')).toBeNull();
  });

  it('offers to set a PIN on a device that has none', async () => {
    await Dexie.delete('attendance-scanner-local');
    renderAt('/roster');
    expect((await screen.findByTestId('text-pin-title')).textContent).toBe(
      'Set a teacher PIN',
    );
  });
});

describe('routerBasename', () => {
  it('is empty for a site hosted at a domain root', () => {
    // `/` would work too, but an empty basename is what react-router treats as
    // "no prefix" without any string handling of its own.
    expect(routerBasename('/')).toBe('');
  });

  it('keeps the prefix for a site hosted under a sub-path', () => {
    // A static host that gives this app a folder rather than a domain, e.g.
    // BASE_PATH=/attendance/ at build time.
    expect(routerBasename('/attendance/')).toBe('/attendance');
    expect(routerBasename('/school/apps/attendance/')).toBe(
      '/school/apps/attendance',
    );
  });

  it('is empty for the relative base both packaged shells build with', () => {
    // `./` is what Vite reports for BUILD_TARGET=capacitor and =electron.
    // Trimming its slash would give react-router `.`, which matches no
    // location: the APK and the .app would open to a blank screen.
    expect(routerBasename('./')).toBe('');
    expect(routerBasename('.')).toBe('');
  });
});
