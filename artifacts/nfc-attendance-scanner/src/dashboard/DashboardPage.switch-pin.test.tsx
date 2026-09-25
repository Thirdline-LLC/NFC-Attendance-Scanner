import Dexie from 'dexie';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSwitchPinRequired, listActivity, writeSetting } from '@/data/attendance-store';
import { setOperatorPin } from '@/data/operator-pin';
import { OperatorLockProvider } from '@/lock/OperatorLockProvider';
import { DashboardPage } from './DashboardPage';

// A test-only PIN, set in fake-indexeddb.
const PIN = '2468';
const TOGGLE = 'switch-switch-pin-required';

function renderPage() {
  return render(
    <MemoryRouter>
      <OperatorLockProvider initiallyUnlocked>
        <DashboardPage />
      </OperatorLockProvider>
    </MemoryRouter>,
  );
}

async function switchPinRows() {
  return (await listActivity()).filter((entry) => entry.kind.startsWith('switch-pin-'));
}

describe('Dashboard "Require PIN to switch periods" (Design 09 §3)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('sits in the teacher-PIN card, off by default', async () => {
    await setOperatorPin(PIN);
    renderPage();
    const toggle = await screen.findByTestId(TOGGLE);
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Require PIN to switch periods');
    const card = screen.getByTestId('section-teacher-pin').parentElement as HTMLElement;
    expect(within(card).getByTestId(TOGGLE)).toBe(toggle);
  });

  it('turns on with no PIN typed, and logs it with a timestamp only', async () => {
    await setOperatorPin(PIN);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId(TOGGLE));

    await waitFor(() =>
      expect(screen.getByTestId(TOGGLE).getAttribute('aria-checked')).toBe('true'),
    );
    expect(screen.queryByTestId('dialog-pin')).toBeNull();
    expect(await getSwitchPinRequired()).toBe(true);
    expect(screen.getByTestId('text-pin-changed').textContent).toBe(
      'PIN to switch periods turned on.',
    );
    const rows = await switchPinRows();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['at', 'id', 'kind']);
    expect(rows[0].kind).toBe('switch-pin-enabled');
  });

  it('asks for the current PIN to turn off, and changes nothing on a wrong one or a cancel', async () => {
    await setOperatorPin(PIN);
    await writeSetting('switch-pin-required', 'true');
    const user = userEvent.setup();
    renderPage();
    await waitFor(async () =>
      expect((await screen.findByTestId(TOGGLE)).getAttribute('aria-checked')).toBe('true'),
    );

    await user.click(screen.getByTestId(TOGGLE));
    await screen.findByTestId('dialog-pin');
    expect(screen.getByTestId('text-pin-title').textContent).toBe(
      'Enter the teacher PIN to turn this off',
    );
    await user.click(screen.getByTestId('button-pin-cancel'));
    expect(await getSwitchPinRequired()).toBe(true);

    await user.click(screen.getByTestId(TOGGLE));
    await screen.findByTestId('dialog-pin');
    await user.type(screen.getByTestId('input-pin'), '1357');
    await user.click(screen.getByTestId('button-pin-submit'));
    await screen.findByTestId('text-pin-error');
    expect(await getSwitchPinRequired()).toBe(true);
    expect(await switchPinRows()).toEqual([]);

    await user.type(screen.getByTestId('input-pin'), PIN);
    await user.click(screen.getByTestId('button-pin-submit'));
    await waitFor(() =>
      expect(screen.getByTestId(TOGGLE).getAttribute('aria-checked')).toBe('false'),
    );
    expect(await getSwitchPinRequired()).toBe(false);
    const rows = await switchPinRows();
    expect(rows.map((row) => row.kind)).toEqual(['switch-pin-disabled']);
    expect(Object.keys(rows[0]).sort()).toEqual(['at', 'id', 'kind']);
  });

  it('cannot be turned on without a teacher PIN, and says why', async () => {
    // The dashboard is open because the gate is off and no PIN exists.
    await writeSetting('pin-required', 'false');
    renderPage();
    const toggle = (await screen.findByTestId(TOGGLE)) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(
      document.getElementById(toggle.getAttribute('aria-describedby') as string)?.textContent,
    ).toMatch(/^Set a teacher PIN first/);
  });

  it('can still be turned off when it is on with no PIN behind it', async () => {
    await writeSetting('pin-required', 'false');
    await writeSetting('switch-pin-required', 'true');
    const user = userEvent.setup();
    renderPage();
    const toggle = (await screen.findByTestId(TOGGLE)) as HTMLButtonElement;
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(toggle.disabled).toBe(false);

    await user.click(toggle);

    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(screen.queryByTestId('dialog-pin')).toBeNull();
    expect((await switchPinRows()).map((row) => row.kind)).toEqual(['switch-pin-disabled']);
  });
});
