import Dexie from 'dexie';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as attendanceStore from '@/data/attendance-store';
import {
  addPerson,
  applyRosterImport,
  listPersons,
  listTapRecords,
  listUnboundPersons,
  type RosterEntry,
} from '@/data/attendance-store';
import { setOperatorPin } from '@/data/operator-pin';
import { OperatorLockProvider } from '@/lock/OperatorLockProvider';
import { ScannerScreen } from './ScannerScreen';

// Synthetic: invented students, and card UIDs unlike anything a reader would
// produce for a real card. No assertion below ever looks for one in the DOM
// except to prove it is absent.
const UNKNOWN_CARD = '04DEADBEEF1234';
const OTHER_CARD = '04C0FFEE005678';

const jordanRow: RosterEntry = {
  firstName: 'Jordan',
  lastName: 'Lee',
  gradYear: 2027,
  email: 'jlee27@stjohnschs.org',
};

const priyaRow: RosterEntry = {
  firstName: 'Priya',
  lastName: 'Nair',
  gradYear: 2028,
  email: 'pnair28@stjohnschs.org',
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

/** The reader is a keyboard wedge: a burst of characters, then Enter. */
async function scanCard(user: ReturnType<typeof userEvent.setup>, uid: string) {
  await user.type(screen.getByTestId('input-scanner-hidden'), `${uid}{Enter}`);
}

/** Waits for the opening read, so a tap is never raced against it. */
async function waitForReady() {
  await waitFor(() =>
    expect(screen.queryByTestId('text-storage-checking')).toBeNull(),
  );
}

describe('ScannerScreen binding an unrecognized card', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
    await setOperatorPin('2468');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('offers only the pre-enrolled students who have no card', async () => {
    await applyRosterImport([jordanRow, priyaRow]);
    await addPerson({
      cardUid: OTHER_CARD,
      firstName: 'Sam',
      lastName: 'Okafor',
      gradYear: 2029,
      email: 'sokafor29@stjohnschs.org',
      enrolledAt: '2026-09-01T12:00:00.000Z',
    });
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();

    await scanCard(user, UNKNOWN_CARD);

    const dialog = await screen.findByTestId('dialog-card-bind');
    const list = within(dialog).getByTestId('list-bind-candidates');
    expect(within(list).getByText('Jordan Lee')).toBeTruthy();
    expect(within(list).getByText('Priya Nair')).toBeTruthy();
    // Sam already taps with a card, so offering them here would mean
    // retiring a card that is still in a wallet.
    expect(within(list).queryByText('Sam Okafor')).toBeNull();
  });

  it('links the card to the student picked, and counts their tap', async () => {
    await applyRosterImport([jordanRow, priyaRow]);
    const [jordan] = await listUnboundPersons();
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    await scanCard(user, UNKNOWN_CARD);
    await screen.findByTestId('dialog-card-bind');

    await user.click(screen.getByTestId(`button-bind-person-${jordan.id}`));

    await waitFor(() =>
      expect(screen.queryByTestId('dialog-card-bind')).toBeNull(),
    );
    expect(screen.getByTestId('text-scan-status').textContent).toBe(
      'Card linked',
    );
    // The card really is theirs now, and the tap they already made counts.
    const stored = await listPersons();
    expect(stored.find((person) => person.id === jordan.id)?.cardUid).toBe(
      UNKNOWN_CARD,
    );
    await waitFor(() =>
      expect(screen.getByTestId('text-attendance-count').textContent).toBe('1'),
    );
    const [tap] = await listTapRecords();
    expect(tap).toMatchObject({ personId: jordan.id, counted: true });
  });

  it('checks the same card in normally on the next tap', async () => {
    await applyRosterImport([jordanRow]);
    const [jordan] = await listUnboundPersons();
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    await scanCard(user, UNKNOWN_CARD);
    await screen.findByTestId('dialog-card-bind');
    await user.click(screen.getByTestId(`button-bind-person-${jordan.id}`));
    await waitFor(() =>
      expect(screen.queryByTestId('dialog-card-bind')).toBeNull(),
    );

    await scanCard(user, UNKNOWN_CARD);

    // Recognised this time, and already counted, so it is a repeat rather
    // than a second unknown card.
    await waitFor(() =>
      expect(screen.getByTestId('text-scan-status').textContent).toContain(
        'already checked in',
      ),
    );
    expect(screen.queryByTestId('dialog-card-bind')).toBeNull();
  });

  it('does not open the dialog when everybody already has a card', async () => {
    await addPerson({
      cardUid: OTHER_CARD,
      firstName: 'Sam',
      lastName: 'Okafor',
      gradYear: 2029,
      email: 'sokafor29@stjohnschs.org',
      enrolledAt: '2026-09-01T12:00:00.000Z',
    });
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();

    await scanCard(user, UNKNOWN_CARD);

    await waitFor(() =>
      expect(screen.getByTestId('text-scan-status').textContent).toContain(
        'Unknown card',
      ),
    );
    expect(screen.queryByTestId('dialog-card-bind')).toBeNull();
  });

  it('keeps the card and the dialog when the write fails', async () => {
    await applyRosterImport([jordanRow]);
    const [jordan] = await listUnboundPersons();
    vi.spyOn(attendanceStore, 'bindCardToPerson').mockRejectedValue(
      new Error('storage unavailable'),
    );
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    await scanCard(user, UNKNOWN_CARD);
    await screen.findByTestId('dialog-card-bind');

    await user.click(screen.getByTestId(`button-bind-person-${jordan.id}`));

    // Nothing may read as success: the student is standing at the desk and
    // the card they tapped is still unassigned.
    const error = await screen.findByTestId('text-bind-error');
    expect(error.textContent).toContain('still unassigned');
    expect(screen.getByTestId('dialog-card-bind')).toBeTruthy();
    expect(screen.getByTestId(`button-bind-person-${jordan.id}`)).toBeTruthy();
    expect((await listPersons())[0].cardUid).toBeUndefined();
  });

  it('refuses in words when the card turns out to be somebody else’s', async () => {
    await applyRosterImport([jordanRow]);
    const [jordan] = await listUnboundPersons();
    const owner = await addPerson({
      cardUid: OTHER_CARD,
      firstName: 'Sam',
      lastName: 'Okafor',
      gradYear: 2029,
      email: 'sokafor29@stjohnschs.org',
      enrolledAt: '2026-09-01T12:00:00.000Z',
    });
    vi.spyOn(attendanceStore, 'bindCardToPerson').mockRejectedValue(
      new attendanceStore.CardTakenError(owner),
    );
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    await scanCard(user, UNKNOWN_CARD);
    await screen.findByTestId('dialog-card-bind');

    await user.click(screen.getByTestId(`button-bind-person-${jordan.id}`));

    const error = await screen.findByTestId('text-bind-error');
    expect(error.textContent).toContain('Sam Okafor');
    expect(screen.getByTestId('dialog-card-bind')).toBeTruthy();
    expect((await listPersons()).find((p) => p.id === jordan.id)?.cardUid).toBe(
      undefined,
    );
  });

  it('leaves the tap recorded when the operator closes the dialog', async () => {
    await applyRosterImport([jordanRow]);
    const user = userEvent.setup();
    renderScanner();
    await waitForReady();
    await scanCard(user, UNKNOWN_CARD);
    await screen.findByTestId('dialog-card-bind');

    await user.click(screen.getByTestId('button-bind-cancel'));

    await waitFor(() =>
      expect(screen.queryByTestId('dialog-card-bind')).toBeNull(),
    );
    const [tap] = await listTapRecords();
    expect(tap).toMatchObject({ personId: null, counted: false });
    expect((await listPersons())[0].cardUid).toBeUndefined();
  });

  it('never puts a full card UID on the screen', async () => {
    await applyRosterImport([jordanRow]);
    const [jordan] = await listUnboundPersons();
    const user = userEvent.setup();
    const { container } = renderScanner();
    await waitForReady();
    await scanCard(user, UNKNOWN_CARD);
    const dialog = await screen.findByTestId('dialog-card-bind');

    // Only the tail, and only behind a mask, exactly as everywhere else.
    expect(within(dialog).getByTestId('text-bind-card').textContent).toBe(
      '••••1234',
    );
    expect(container.textContent).not.toContain(UNKNOWN_CARD);

    await user.click(screen.getByTestId(`button-bind-person-${jordan.id}`));
    await waitFor(() =>
      expect(screen.queryByTestId('dialog-card-bind')).toBeNull(),
    );

    expect(container.textContent).not.toContain(UNKNOWN_CARD);
    expect(container.textContent).not.toMatch(/[0-9A-F]{14}/);
  });
});
