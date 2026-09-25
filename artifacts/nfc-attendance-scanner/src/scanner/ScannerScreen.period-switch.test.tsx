import Dexie from 'dexie';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as attendanceStore from '@/data/attendance-store';
import {
  addPerson,
  applyRosterImport,
  archiveBody,
  createBody,
  createClassWithPeriods,
  getActiveBodyId,
  listActivity,
  listTapsForBodies,
  setActiveBody,
} from '@/data/attendance-store';
import { setOperatorPin } from '@/data/operator-pin';
import * as switchPin from '@/data/switch-pin';
import { setSwitchPinRequired } from '@/data/switch-pin';
import { OperatorLockProvider } from '@/lock/OperatorLockProvider';
import { ScannerScreen } from './ScannerScreen';

// Synthetic: invented students (example.com) and card UIDs.
const AVA_CARD = '04AAAA00000001';
const UNKNOWN_CARD = '04DEADBEEF1234';
// A test-only PIN, set in fake-indexeddb.
const PIN = '2468';

function renderScanner() {
  return render(
    <MemoryRouter>
      <OperatorLockProvider>
        <ScannerScreen />
      </OperatorLockProvider>
    </MemoryRouter>,
  );
}

async function scanCard(user: ReturnType<typeof userEvent.setup>, uid: string) {
  await user.type(screen.getByTestId('input-scanner-hidden'), `${uid}{Enter}`);
}

async function waitForReady() {
  await waitFor(() => expect(screen.queryByTestId('text-storage-checking')).toBeNull());
}

/** English 11 with Periods 1, 3, 6 and an archived Period 5; the desk on Period 1. */
async function setUpClass() {
  const { parent, periods } = await createClassWithPeriods({
    className: 'English 11',
    periodNames: ['Period 1', 'Period 3', 'Period 5', 'Period 6'],
  });
  const [p1, p3, p5, p6] = periods.map((period) => period.id as number);
  await archiveBody(p5);
  await setActiveBody(p1);
  await addPerson({
    cardUid: AVA_CARD,
    firstName: 'Ava',
    lastName: 'Sample',
    gradYear: 2027,
    email: 'ava@example.com',
    enrolledAt: '2026-09-01T12:00:00.000Z',
  });
  return { parentId: parent.id as number, p1, p3, p5, p6 };
}

async function findTrigger() {
  return screen.findByTestId('button-period-switch');
}

describe('ScannerScreen period switcher (Design 09 §3)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
    await setOperatorPin(PIN);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('is not shown on a root body', async () => {
    await createBody({ name: 'Robotics', typeLabel: 'club', parentId: null });
    renderScanner();
    await waitForReady();
    await waitFor(() => expect(screen.getByTestId('text-body-subtitle')).toBeTruthy());
    expect(screen.queryByTestId('bar-period-switch')).toBeNull();
  });

  it('shows the current period and offers only its non-archived siblings', async () => {
    const { parentId, p1, p3, p5, p6 } = await setUpClass();
    const other = await createBody({ name: 'Chemistry', typeLabel: 'class', parentId: null });
    await createBody({ name: 'Period 2', typeLabel: 'period', parentId: other.id as number });
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();

    const trigger = await findTrigger();
    expect(trigger.textContent).toBe('Switch period');
    expect(screen.getByTestId('text-period-current').textContent).toBe('Period 1');

    await user.click(trigger);
    const dialog = await screen.findByTestId('dialog-period-chooser');
    expect(within(dialog).getByRole('heading').textContent).toBe('Switch period');
    const options = within(dialog)
      .getAllByRole('button')
      .map((button) => button.getAttribute('data-testid'))
      .filter((id) => id?.startsWith('button-period-option-'));
    expect(options).toEqual([p1, p3, p6].map((id) => `button-period-option-${id}`));
    expect(screen.queryByTestId(`button-period-option-${p5}`)).toBeNull();
    expect(screen.queryByTestId(`button-period-option-${parentId}`)).toBeNull();
    expect(within(dialog).queryByText('Period 2')).toBeNull();
    // The current period is marked and cannot be chosen.
    const current = screen.getByTestId(`button-period-option-${p1}`);
    expect(current.getAttribute('aria-current')).toBe('true');
    expect((current as HTMLButtonElement).disabled).toBe(true);
    // No roster, history or figures in the chooser.
    expect(within(dialog).queryByText(/Ava/)).toBeNull();
    expect(within(dialog).queryByText(/checked in/i)).toBeNull();
  });

  it('switches, confirms in a polite live region, updates the subtitle and logs ids and names only', async () => {
    const { p1, p3 } = await setUpClass();
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    await scanCard(user, AVA_CARD);
    await waitFor(() => expect(screen.getByTestId('text-attendance-count').textContent).toBe('1'));

    await user.click(await findTrigger());
    await user.click(await screen.findByTestId(`button-period-option-${p3}`));

    const status = screen.getByTestId('text-period-switch-status');
    await waitFor(() => expect(status.textContent).toBe('Now taking attendance for Period 3'));
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(within(status).getByText('Period 3').tagName).toBe('STRONG');
    expect(screen.getByTestId('text-period-current').textContent).toBe('Period 3');
    expect(screen.getByTestId('text-body-subtitle').textContent).toBe(
      'English 11 › Period 3 · period',
    );
    expect(screen.getByTestId('text-attendance-count').textContent).toBe('0');
    expect(await getActiveBodyId()).toBe(p3);

    const [entry] = await listActivity();
    expect(entry).toMatchObject({
      kind: 'body-switch',
      fromBodyId: p1,
      fromBodyName: 'Period 1',
      toBodyId: p3,
      toBodyName: 'Period 3',
    });
    expect(Object.keys(entry).sort()).toEqual(
      ['at', 'fromBodyId', 'fromBodyName', 'id', 'kind', 'toBodyId', 'toBodyName'].sort(),
    );
    const serialized = JSON.stringify(entry);
    for (const pii of ['Ava', 'Sample', 'ava@example.com', AVA_CARD, AVA_CARD.slice(-4)]) {
      expect(serialized).not.toContain(pii);
    }
  });

  it('is disabled while the "Whose card is…?" prompt is open, and says why', async () => {
    await setUpClass();
    await applyRosterImport([
      { firstName: 'Cal', lastName: 'Sample', gradYear: 2028, email: 'cal@example.com' },
    ]);
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    const trigger = (await findTrigger()) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);

    await scanCard(user, UNKNOWN_CARD);
    await screen.findByTestId('dialog-card-bind');

    expect(trigger.disabled).toBe(true);
    expect(screen.getByTestId('text-period-switch-status').textContent).toMatch(
      /^Finish the current tap first/,
    );
    expect(trigger.getAttribute('aria-describedby')).toBe('period-switch-reason');

    await user.click(screen.getByTestId('button-bind-cancel'));
    await waitFor(() => expect(trigger.disabled).toBe(false));
  });

  it('is disabled while the enrollment form is open', async () => {
    await setUpClass();
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    const trigger = (await findTrigger()) as HTMLButtonElement;

    await user.click(screen.getByRole('button', { name: /Enroll/ }));
    await scanCard(user, '04CCCC00000003');
    await screen.findByTestId('form-enrollment');

    expect(trigger.disabled).toBe(true);
    expect(screen.getByTestId('text-period-switch-status').textContent).toContain('enrollment');
  });

  it('is disabled while a scan is still being written, and re-enables once it lands', async () => {
    await setUpClass();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = attendanceStore.recordSessionTap;
    vi.spyOn(attendanceStore, 'recordSessionTap').mockImplementationOnce(async (input) => {
      await gate;
      return real(input);
    });
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    const trigger = (await findTrigger()) as HTMLButtonElement;

    await scanCard(user, AVA_CARD);
    await waitFor(() => expect(trigger.disabled).toBe(true));

    await act(async () => {
      release();
    });
    await waitFor(() => expect(trigger.disabled).toBe(false));
    expect(screen.getByTestId('text-attendance-count').textContent).toBe('1');
  });

  it('closes on Escape without switching, and hands focus back to the reader', async () => {
    const { p1 } = await setUpClass();
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    await user.click(await findTrigger());
    await screen.findByTestId('dialog-period-chooser');

    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('dialog-period-chooser')).toBeNull();
    expect(await getActiveBodyId()).toBe(p1);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('input-scanner-hidden')),
    );
  });

  it('moves between rows with the arrow keys, and a person’s Enter switches', async () => {
    const { p3, p6 } = await setUpClass();
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    await user.click(await findTrigger());
    await screen.findByTestId('dialog-period-chooser');

    // Focus lands on the first row that can be chosen.
    expect(document.activeElement).toBe(screen.getByTestId(`button-period-option-${p3}`));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByTestId(`button-period-option-${p6}`));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByTestId(`button-period-option-${p6}`));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByTestId(`button-period-option-${p3}`));
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByTestId('dialog-period-chooser')).toBeNull());
    await waitFor(() =>
      expect(screen.getByTestId('text-period-current').textContent).toBe('Period 3'),
    );
    expect(await getActiveBodyId()).toBe(p3);
  });

  it('ignores a card tapped while the chooser is open', async () => {
    const { p1, p3 } = await setUpClass();
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    await user.click(await findTrigger());
    const row = await screen.findByTestId(`button-period-option-${p3}`);
    expect(document.activeElement).toBe(row);

    // The reader is a keyboard: its UID and Enter land on the focused row.
    await user.keyboard(`${AVA_CARD}{Enter}`);

    expect(screen.getByTestId('dialog-period-chooser')).toBeTruthy();
    expect(await getActiveBodyId()).toBe(p1);
  });

  it('drops a card read while the switch is still running, so it never lands on the new period', async () => {
    const { p1, p3, p5, p6 } = await setUpClass();
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = attendanceStore.findTodaysSessionForBody;
    vi.spyOn(attendanceStore, 'findTodaysSessionForBody').mockImplementationOnce(async (id) => {
      await gate;
      return real(id);
    });

    await user.click(await findTrigger());
    await user.click(await screen.findByTestId(`button-period-option-${p3}`));
    await waitFor(() =>
      expect(screen.getByTestId('button-period-switch').hasAttribute('disabled')).toBe(true),
    );
    // The desk still shows Period 1; the card is read now, mid-switch.
    expect(screen.getByTestId('text-period-current').textContent).toBe('Period 1');
    await scanCard(user, AVA_CARD);

    release();
    await waitFor(() =>
      expect(screen.getByTestId('text-period-switch-status').textContent).toBe(
        'Now taking attendance for Period 3',
      ),
    );
    expect(await getActiveBodyId()).toBe(p3);
    // Dropped, not deferred: no tap on the period switched to, nor the one left.
    expect(await listTapsForBodies([p1, p3, p5, p6])).toEqual([]);
    expect(screen.getByTestId('text-attendance-count').textContent).toBe('0');
    expect((screen.getByTestId('input-scanner-hidden') as HTMLInputElement).value).toBe('');
  });

  it('turns capture off while the switch runs, then hands focus back to the reader', async () => {
    const { p3 } = await setUpClass();
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = attendanceStore.findTodaysSessionForBody;
    vi.spyOn(attendanceStore, 'findTodaysSessionForBody').mockImplementationOnce(async (id) => {
      await gate;
      return real(id);
    });

    await user.click(await findTrigger());
    await user.click(await screen.findByTestId(`button-period-option-${p3}`));
    await waitFor(() =>
      expect(screen.getByTestId('text-scanner-focus').textContent).toBe('Scanner off — switching'),
    );

    release();
    await waitFor(() =>
      expect(screen.getByTestId('text-period-switch-status').textContent).toBe(
        'Now taking attendance for Period 3',
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('text-scanner-focus').textContent).toBe('Scanner active'),
    );
    expect(document.activeElement).toBe(screen.getByTestId('input-scanner-hidden'));
  });

  it('drops a card read after the switch but before the new period is on screen', async () => {
    const { p1, p3, p5, p6 } = await setUpClass();
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = attendanceStore.listBodies;
    let reads = 0;
    // The chooser's own re-read passes; the one after the switch waits.
    vi.spyOn(attendanceStore, 'listBodies').mockImplementation(async () => {
      if ((await getActiveBodyId()) === p3 && reads++ === 0) await gate;
      return real();
    });

    await user.click(await findTrigger());
    await user.click(await screen.findByTestId(`button-period-option-${p3}`));
    await waitFor(async () => expect(await getActiveBodyId()).toBe(p3));
    expect(screen.getByTestId('text-period-current').textContent).toBe('Period 1');
    await scanCard(user, AVA_CARD);

    release();
    await waitFor(() =>
      expect(screen.getByTestId('text-period-current').textContent).toBe('Period 3'),
    );
    expect(await listTapsForBodies([p1, p3, p5, p6])).toEqual([]);
  });

  it('says the settings could not be read when it asks for the PIN because of that', async () => {
    const { p1, p3 } = await setUpClass();
    vi.spyOn(switchPin, 'isSwitchPinEnforced').mockRejectedValueOnce(new Error('blocked'));
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    await user.click(await findTrigger());
    await user.click(await screen.findByTestId(`button-period-option-${p3}`));

    // Still fail-safe: the PIN is asked for.
    await screen.findByTestId('dialog-pin');
    expect(screen.getByTestId('text-period-switch-status').textContent).toBe(
      "This device couldn't read its settings, so the teacher PIN is needed to switch.",
    );
    expect(await getActiveBodyId()).toBe(p1);
  });

  it('asks for the PIN first when the device requires it', async () => {
    const { p1, p3 } = await setUpClass();
    await setSwitchPinRequired(true);
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    await user.click(await findTrigger());
    await user.click(await screen.findByTestId(`button-period-option-${p3}`));

    const pinDialog = await screen.findByTestId('dialog-pin');
    expect(within(pinDialog).getByTestId('text-pin-title').textContent).toBe(
      'Enter the teacher PIN to switch',
    );
    expect(await getActiveBodyId()).toBe(p1);

    // Cancel: nothing changes.
    await user.click(screen.getByTestId('button-pin-cancel'));
    expect(screen.queryByTestId('dialog-pin')).toBeNull();
    expect(await getActiveBodyId()).toBe(p1);

    // Wrong, then right.
    await user.click(await findTrigger());
    await user.click(await screen.findByTestId(`button-period-option-${p3}`));
    await screen.findByTestId('dialog-pin');
    await user.type(screen.getByTestId('input-pin'), '1357');
    await user.click(screen.getByTestId('button-pin-submit'));
    await screen.findByTestId('text-pin-error');
    expect(await getActiveBodyId()).toBe(p1);

    await user.type(screen.getByTestId('input-pin'), PIN);
    await user.click(screen.getByTestId('button-pin-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('text-period-switch-status').textContent).toBe(
        'Now taking attendance for Period 3',
      ),
    );
    expect(await getActiveBodyId()).toBe(p3);
  });

  it('switches without a prompt when the setting is off', async () => {
    const { p3 } = await setUpClass();
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    await user.click(await findTrigger());
    await user.click(await screen.findByTestId(`button-period-option-${p3}`));
    await waitFor(async () => expect(await getActiveBodyId()).toBe(p3));
    expect(screen.queryByTestId('dialog-pin')).toBeNull();
  });

  it('reports a refused switch and stays on the same period', async () => {
    const { p1, p3 } = await setUpClass();
    vi.spyOn(attendanceStore, 'setActiveBody').mockRejectedValueOnce(new Error('blocked'));
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    await user.click(await findTrigger());
    await user.click(await screen.findByTestId(`button-period-option-${p3}`));

    await waitFor(() =>
      expect(screen.getByTestId('text-period-switch-status').textContent).toBe(
        "This device couldn't switch to Period 3. It is still on Period 1; try again.",
      ),
    );
    expect(await getActiveBodyId()).toBe(p1);
    expect(screen.getByTestId('text-period-current').textContent).toBe('Period 1');
    expect((await listActivity()).filter((entry) => entry.kind === 'body-switch')).toEqual([]);
  });

  it('says to finish the tap when a prompt opened between choosing and switching', async () => {
    const { p1, p3 } = await setUpClass();
    const hook = await import('./use-attendance-session');
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    // Stand in for the race: the queue refuses the switch because a tap is open.
    vi.spyOn(attendanceStore, 'findTodaysSessionForBody').mockRejectedValueOnce(
      new hook.TapPendingError(),
    );
    await user.click(await findTrigger());
    await user.click(await screen.findByTestId(`button-period-option-${p3}`));

    await waitFor(() =>
      expect(screen.getByTestId('text-period-switch-status').textContent).toBe(
        'Still on Period 1. Finish the current tap first, then switch.',
      ),
    );
    expect(await getActiveBodyId()).toBe(p1);
  });
});
