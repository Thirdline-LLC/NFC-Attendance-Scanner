import Dexie from 'dexie';
import {
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addPerson,
  listTapRecords,
  type Person,
} from '@/data/attendance-store';
import { setOperatorPin } from '@/data/operator-pin';
import { OperatorLockProvider } from '@/lock/OperatorLockProvider';
import { ScannerScreen } from './ScannerScreen';

const knownUid = '04A1B2C3D4E5F6';

const knownPerson: Omit<Person, 'id'> = {
  cardUid: knownUid,
  firstName: 'Jordan',
  lastName: 'Lee',
  gradYear: 2027,
  email: 'jlee27@stjohnschs.org',
  enrolledAt: '2026-09-01T10:00:00.000Z',
};

function renderScanner() {
  return render(
    <MemoryRouter>
      <OperatorLockProvider>
        <ScannerScreen />
      </OperatorLockProvider>
    </MemoryRouter>,
  );
}

/** End Session is the teacher's: types the PIN into the gate and submits by button. */
async function passGate(user: ReturnType<typeof userEvent.setup>, pin = '2468') {
  await screen.findByTestId('dialog-pin');
  await user.type(screen.getByTestId('input-pin'), pin);
  await user.click(screen.getByTestId('button-pin-submit'));
  await waitFor(() => expect(screen.queryByTestId('dialog-pin')).toBeNull());
}

async function scanCard(
  user: ReturnType<typeof userEvent.setup>,
  uid: string,
) {
  await user.type(screen.getByTestId('input-scanner-hidden'), `${uid}{Enter}`);
}

describe('ScannerScreen session reset browser smoke flow', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
    await setOperatorPin('2468');
    await addPerson(knownPerson);
  });

  afterEach(() => {
    cleanup();
  });

  it('cancels with Escape, then confirms a fresh session that can receive the next tap', async () => {
    const user = userEvent.setup();
    renderScanner();

    await waitFor(() =>
      expect(screen.getByText('Tap to check in')).toBeTruthy(),
    );
    await scanCard(user, knownUid);
    await waitFor(() =>
      expect(screen.getByTestId('text-attendance-count').textContent).toBe('1'),
    );

    const hiddenInput = screen.getByTestId('input-scanner-hidden');
    const [previousTap] = await listTapRecords();
    const previousSessionId = previousTap.sessionId;

    await user.click(screen.getByTestId('button-end-session'));
    await passGate(user);
    await screen.findByTestId('dialog-session-summary');
    await user.click(screen.getByTestId('button-summary-new-session'));

    const confirmation = await screen.findByTestId('dialog-new-session');
    expect(confirmation.getAttribute('role')).toBe('alertdialog');
    expect(screen.getByTestId('text-new-session-counts').textContent).toBe(
      'This session has 1 tap and 1 checked in.',
    );

    // Escape answers only the topmost question. The summary and its count stay
    // in place, and the tap remains assigned to the same stored session.
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByTestId('dialog-new-session')).toBeNull(),
    );
    expect(screen.getByTestId('dialog-session-summary')).toBeTruthy();
    expect(screen.getByTestId('text-attendance-count').textContent).toBe('1');
    expect(await listTapRecords()).toHaveLength(1);
    expect((await listTapRecords())[0].sessionId).toBe(previousSessionId);

    // Reopen the warning from the real summary, then confirm the rotation.
    await user.click(screen.getByTestId('button-summary-new-session'));
    await screen.findByTestId('dialog-new-session');
    await user.click(screen.getByTestId('button-dialog-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('text-attendance-count').textContent).toBe('0'),
    );
    expect(screen.queryByTestId('dialog-session-summary')).toBeNull();
    expect(screen.queryByTestId('dialog-new-session')).toBeNull();

    // The browser-level focus handoff is what lets the next physical reader
    // burst arrive without an operator clicking the page first.
    await waitFor(() => expect(document.activeElement).toBe(hiddenInput));
    await scanCard(user, knownUid);
    await waitFor(() =>
      expect(screen.getByTestId('text-attendance-count').textContent).toBe('1'),
    );

    const storedTaps = await listTapRecords();
    expect(storedTaps).toHaveLength(2);
    expect(storedTaps[0].sessionId).toBe(previousSessionId);
    expect(storedTaps[1].sessionId).not.toBe(previousSessionId);
  });
});