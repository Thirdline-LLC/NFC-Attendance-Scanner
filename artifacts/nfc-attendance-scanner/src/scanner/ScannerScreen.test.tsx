import Dexie from 'dexie';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as attendanceStore from '@/data/attendance-store';
import { addPerson, listTapRecords, type Person } from '@/data/attendance-store';
import * as attendanceExport from '@/lib/attendance-export';
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

/** The reader is a keyboard wedge: a burst of characters, then Enter. */
async function scanCard(user: ReturnType<typeof userEvent.setup>, uid: string) {
  await user.type(screen.getByTestId('input-scanner-hidden'), `${uid}{Enter}`);
}

describe('ScannerScreen storage recovery', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('explains an unopenable store and retries the read on demand', async () => {
    const listPersonsSpy = vi
      .spyOn(attendanceStore, 'listPersons')
      .mockRejectedValue(new Error('storage unavailable'));
    const user = userEvent.setup();
    render(<ScannerScreen />);

    const panel = await screen.findByTestId('panel-storage-unavailable');
    expect(panel.getAttribute('role')).toBe('alert');
    expect(panel.textContent).toContain('isn’t letting the app save');
    expect(panel.textContent).toContain('not being recorded');
    // The radio target is gone: nothing useful happens if a card is tapped.
    expect(screen.queryByTestId('text-storage-checking')).toBeNull();
    expect(listPersonsSpy).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('button-retry-storage'));

    await waitFor(() => expect(listPersonsSpy).toHaveBeenCalledTimes(2));
    // Still failing, so the operator keeps the explanation and the button.
    expect(await screen.findByTestId('panel-storage-unavailable')).toBeTruthy();
  });

  it('shows a quiet checking label instead of the tap prompt while the store opens', async () => {
    let releaseRead: (persons: Person[]) => void = () => undefined;
    vi.spyOn(attendanceStore, 'listPersons').mockReturnValue(
      new Promise<Person[]>((resolve) => {
        releaseRead = resolve;
      }),
    );
    render(<ScannerScreen />);

    expect(await screen.findByTestId('text-storage-checking')).toBeTruthy();
    expect(screen.queryByText('Tap to check in')).toBeNull();
    expect(screen.queryByTestId('panel-storage-unavailable')).toBeNull();
    expect(screen.queryByTestId('text-storage-footer')).toBeNull();

    await act(async () => {
      releaseRead([]);
    });

    await waitFor(() =>
      expect(screen.queryByTestId('text-storage-checking')).toBeNull(),
    );
    expect(screen.getByText('Tap to check in')).toBeTruthy();
  });

  it('names the failure in the footer: unopenable store', async () => {
    vi.spyOn(attendanceStore, 'listPersons').mockRejectedValue(
      new Error('storage unavailable'),
    );
    render(<ScannerScreen />);

    const footer = await screen.findByTestId('text-storage-footer');
    expect(footer.textContent).toBe('Storage unavailable');
  });

  it('names the failure in the footer: one save that did not land', async () => {
    await addPerson(knownPerson);
    vi.spyOn(attendanceStore, 'recordSessionTap').mockRejectedValue(
      new Error('write failed'),
    );
    const user = userEvent.setup();
    render(<ScannerScreen />);
    await waitFor(() =>
      expect(screen.getByText('Tap to check in')).toBeTruthy(),
    );

    await scanCard(user, knownUid);

    const footer = await screen.findByTestId('text-storage-footer');
    // The store opened, so this is the milder failure and there is no panel.
    expect(footer.textContent).toBe('Last save failed');
    expect(screen.queryByTestId('panel-storage-unavailable')).toBeNull();
  });
});

describe('ScannerScreen new-session confirmation', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
    await addPerson(knownPerson);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** One counted tap on this session, which is what the dialog is warning about. */
  async function renderWithOneTap() {
    const user = userEvent.setup();
    render(<ScannerScreen />);
    await waitFor(() => expect(screen.getByText('Tap to check in')).toBeTruthy());
    await scanCard(user, knownUid);
    await waitFor(() =>
      expect(screen.getByTestId('text-attendance-count').textContent).toBe('1'),
    );
    return user;
  }

  it('opens from the session summary rather than rotating', async () => {
    const user = await renderWithOneTap();

    await user.click(screen.getByTestId('button-end-session'));
    await user.click(await screen.findByTestId('button-summary-new-session'));

    const dialog = await screen.findByTestId('dialog-new-session');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(screen.getByTestId('text-new-session-counts').textContent).toBe(
      'This session has 1 tap and 1 checked in.',
    );
    // Nothing rotated on the way here.
    expect(screen.getByTestId('text-attendance-count').textContent).toBe('1');
  });

  it('opens from the dev reset button rather than rotating', async () => {
    const user = await renderWithOneTap();

    await user.click(screen.getByTestId('button-reset-session'));

    expect(await screen.findByTestId('dialog-new-session')).toBeTruthy();
    expect(screen.getByTestId('text-attendance-count').textContent).toBe('1');
  });

  it('holds the scanner while the dialog is open and hands it back on cancel', async () => {
    const user = await renderWithOneTap();
    const hiddenInput = screen.getByTestId('input-scanner-hidden');
    expect(document.activeElement).toBe(hiddenInput);

    await user.click(screen.getByTestId('button-reset-session'));

    // Capture is off: a card tapped mid-question cannot be typed into the input.
    expect(document.activeElement).not.toBe(hiddenInput);
    expect(
      screen
        .getByTestId('dialog-new-session')
        .contains(document.activeElement),
    ).toBe(true);

    await user.click(screen.getByTestId('button-dialog-cancel'));

    await waitFor(() => expect(document.activeElement).toBe(hiddenInput));
  });

  it('leaves the session alone when cancelled', async () => {
    const user = await renderWithOneTap();

    await user.click(screen.getByTestId('button-reset-session'));
    await user.click(await screen.findByTestId('button-dialog-cancel'));

    await waitFor(() =>
      expect(screen.queryByTestId('dialog-new-session')).toBeNull(),
    );
    expect(screen.getByTestId('text-attendance-count').textContent).toBe('1');
    expect(await listTapRecords()).toHaveLength(1);
  });

  it('rotates on confirm while the taps stay in the store', async () => {
    const user = await renderWithOneTap();
    const sessionIdBefore = (await listTapRecords())[0].sessionId;

    await user.click(screen.getByTestId('button-reset-session'));
    await user.click(await screen.findByTestId('button-dialog-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('text-attendance-count').textContent).toBe('0'),
    );
    expect(screen.queryByTestId('dialog-new-session')).toBeNull();
    // Retention: the count left the screen, the tap did not leave IndexedDB.
    const stored = await listTapRecords();
    expect(stored).toHaveLength(1);
    expect(stored[0].sessionId).toBe(sessionIdBefore);
  });

  it('exports from inside the dialog without answering the question', async () => {
    const exportSpy = vi
      .spyOn(attendanceExport, 'exportAttendanceWorkbook')
      .mockImplementation(() => undefined);
    const user = await renderWithOneTap();

    await user.click(screen.getByTestId('button-reset-session'));
    await user.click(await screen.findByTestId('button-dialog-export'));

    expect(exportSpy).toHaveBeenCalledTimes(1);
    const [exportedTaps] = exportSpy.mock.calls[0];
    expect(exportedTaps).toHaveLength(1);
    expect(screen.getByTestId('dialog-new-session')).toBeTruthy();
    expect(screen.getByTestId('text-attendance-count').textContent).toBe('1');
  });

  it('cancels on Escape', async () => {
    const user = await renderWithOneTap();

    await user.click(screen.getByTestId('button-reset-session'));
    await screen.findByTestId('dialog-new-session');
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByTestId('dialog-new-session')).toBeNull(),
    );
    expect(screen.getByTestId('text-attendance-count').textContent).toBe('1');
  });
});
