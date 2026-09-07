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
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as attendanceStore from '@/data/attendance-store';
import { addPerson, listTapRecords, type Person } from '@/data/attendance-store';
import * as attendanceExport from '@/lib/attendance-export';
import { ScannerScreen } from './ScannerScreen';

/** The header links out to the roster and dashboard, so the screen needs a router. */
function renderScanner() {
  return render(
    <MemoryRouter>
      <ScannerScreen />
    </MemoryRouter>,
  );
}

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
    renderScanner();

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
    renderScanner();

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
    renderScanner();

    const footer = await screen.findByTestId('text-storage-footer');
    expect(footer.textContent).toBe('Storage unavailable');
  });

  it('names the failure in the footer: one save that did not land', async () => {
    await addPerson(knownPerson);
    vi.spyOn(attendanceStore, 'recordSessionTap').mockRejectedValue(
      new Error('write failed'),
    );
    const user = userEvent.setup();
    renderScanner();
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

describe('ScannerScreen session summary', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
    await addPerson(knownPerson);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function renderWithSummaryOpen() {
    const user = userEvent.setup();
    renderScanner();
    await waitFor(() => expect(screen.getByText('Tap to check in')).toBeTruthy());
    await scanCard(user, knownUid);
    await waitFor(() =>
      expect(screen.getByTestId('text-attendance-count').textContent).toBe('1'),
    );
    await user.click(screen.getByTestId('button-end-session'));
    await screen.findByTestId('dialog-session-summary');
    return user;
  }

  it('takes the keyboard on the least destructive control', async () => {
    await renderWithSummaryOpen();

    // aria-modal is a promise that focus is inside; without this the keyboard
    // stays on the page behind, and Enter would land on whatever had it.
    expect(document.activeElement).toBe(
      screen.getByTestId('button-summary-dismiss'),
    );
  });

  it('goes back to scanning without rotating the session', async () => {
    const user = await renderWithSummaryOpen();
    const sessionIdBefore = (await listTapRecords())[0].sessionId;

    await user.click(screen.getByTestId('button-summary-dismiss'));

    await waitFor(() =>
      expect(screen.queryByTestId('dialog-session-summary')).toBeNull(),
    );
    // An accidental End Session must not cost the volunteer the count.
    expect(screen.getByTestId('text-attendance-count').textContent).toBe('1');
    expect((await listTapRecords())[0].sessionId).toBe(sessionIdBefore);
    // And the reader is listening again.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId('input-scanner-hidden'),
      ),
    );
  });

  it('closes on Escape', async () => {
    const user = await renderWithSummaryOpen();

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByTestId('dialog-session-summary')).toBeNull(),
    );
    expect(screen.getByTestId('text-attendance-count').textContent).toBe('1');
  });

  it('scrolls instead of putting its buttons out of reach', async () => {
    await renderWithSummaryOpen();

    const panel = screen.getByTestId('dialog-session-summary');
    const overlay = panel.parentElement as HTMLElement;
    // jsdom lays nothing out, so this stands in for the browser check: the
    // overlay scrolls, and the panel centres with auto margins, which collapse
    // rather than pushing "Back to scanning" off a short landscape viewport —
    // the only way out of the summary on a touch screen with no Escape key.
    expect(overlay.className).toContain('overflow-y-auto');
    expect(panel.className).toContain('m-auto');
  });

  it('hands focus back into the summary when the confirmation is cancelled', async () => {
    const user = await renderWithSummaryOpen();

    await user.click(screen.getByTestId('button-summary-new-session'));
    await screen.findByTestId('dialog-new-session');
    await user.click(screen.getByTestId('button-dialog-cancel'));

    await waitFor(() =>
      expect(screen.queryByTestId('dialog-new-session')).toBeNull(),
    );
    // The summary is still up and still claims aria-modal. Focus used to land
    // on <body> behind it: the reader cannot take it back while a dialog is
    // open, so there was nothing left to press Escape or Enter with.
    expect(document.activeElement).toBe(
      screen.getByTestId('button-summary-new-session'),
    );
    expect(
      screen
        .getByTestId('dialog-session-summary')
        .contains(document.activeElement),
    ).toBe(true);
  });

  it('leaves Escape to the new-session question stacked on top', async () => {
    const user = await renderWithSummaryOpen();

    await user.click(screen.getByTestId('button-summary-new-session'));
    await screen.findByTestId('dialog-new-session');
    await user.keyboard('{Escape}');

    // One press answers one question: the confirmation goes, the summary stays.
    await waitFor(() =>
      expect(screen.queryByTestId('dialog-new-session')).toBeNull(),
    );
    expect(screen.getByTestId('dialog-session-summary')).toBeTruthy();
  });
});

describe('ScannerScreen reader focus', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
    await addPerson(knownPerson);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('says so when the reader input has lost focus', async () => {
    const user = userEvent.setup();
    renderScanner();
    await waitFor(() => expect(screen.getByText('Tap to check in')).toBeTruthy());
    const hiddenInput = screen.getByTestId('input-scanner-hidden');
    expect(screen.getByTestId('text-scanner-focus').textContent).toContain(
      'Scanner active',
    );

    act(() => hiddenInput.blur());

    // The chip is the only thing on screen that says whether a tap would be
    // read; claiming "active" while the input is blurred loses scans silently.
    expect(screen.getByTestId('text-scanner-focus').textContent).toContain(
      'Scanner paused',
    );

    // A press anywhere that is not a control of its own hands it back.
    await user.click(screen.getByRole('heading', { name: 'Attendance Scanner' }));

    await waitFor(() => expect(document.activeElement).toBe(hiddenInput));
    expect(screen.getByTestId('text-scanner-focus').textContent).toContain(
      'Scanner active',
    );
    await scanCard(user, knownUid);
    await waitFor(() =>
      expect(screen.getByTestId('text-attendance-count').textContent).toBe('1'),
    );
  });

  it('leaves a press on a control to that control', async () => {
    const user = userEvent.setup();
    renderScanner();
    await waitFor(() => expect(screen.getByText('Tap to check in')).toBeTruthy());

    await user.click(screen.getByTestId('button-end-session'));

    // The summary opened, so the press was not stolen back by the reader.
    expect(await screen.findByTestId('dialog-session-summary')).toBeTruthy();
    expect(document.activeElement).not.toBe(
      screen.getByTestId('input-scanner-hidden'),
    );
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
    renderScanner();
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
      .mockReturnValue('attendance-2026-09-07-20260907T000000Z.xlsx');
    const user = await renderWithOneTap();

    await user.click(screen.getByTestId('button-reset-session'));
    await user.click(await screen.findByTestId('button-dialog-export'));

    expect(exportSpy).toHaveBeenCalledTimes(1);
    const [exportedTaps] = exportSpy.mock.calls[0];
    expect(exportedTaps).toHaveLength(1);
    expect(screen.getByTestId('dialog-new-session')).toBeTruthy();
    expect(screen.getByTestId('text-attendance-count').textContent).toBe('1');
  });

  it('names the file it handed to the browser', async () => {
    vi.spyOn(attendanceExport, 'exportAttendanceWorkbook').mockReturnValue(
      'attendance-2026-09-07-20260907T000000Z.xlsx',
    );
    const user = await renderWithOneTap();

    await user.click(screen.getByTestId('button-reset-session'));
    await user.click(await screen.findByTestId('button-dialog-export'));

    // A blocked download throws nothing, so the filename is the only honest
    // confirmation the page can give — see ExportNotice.
    expect(screen.getByTestId('text-export-saved').textContent).toContain(
      'attendance-2026-09-07-20260907T000000Z.xlsx',
    );
  });

  it('says so when the export does not run at all', async () => {
    vi.spyOn(attendanceExport, 'exportAttendanceWorkbook').mockImplementation(
      () => {
        throw new Error('download blocked');
      },
    );
    const user = await renderWithOneTap();

    await user.click(screen.getByTestId('button-reset-session'));
    await user.click(await screen.findByTestId('button-dialog-export'));

    expect(screen.getByTestId('text-export-failed')).toBeTruthy();
    expect(screen.queryByTestId('text-export-saved')).toBeNull();
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

describe('ScannerScreen reader chip', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('says the reader is off, not "tap to resume", while the form is open', async () => {
    const user = userEvent.setup();
    renderScanner();
    await waitFor(() => expect(screen.getByText('Tap to check in')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Enroll' }));
    await scanCard(user, knownUid);
    await screen.findByTestId('form-enrollment');

    const chip = () => screen.getByTestId('text-scanner-focus').textContent ?? '';
    // Capture is deliberately off here, so inviting a tap invites nothing:
    // refocusFromStrayPress returns early and the chip never changes.
    expect(chip()).toContain('Scanner off');
    expect(chip()).toContain('finish enrolling');
    expect(chip()).not.toContain('tap to resume');

    await user.click(screen.getByTestId('text-attendance-count'));
    expect(chip()).toContain('Scanner off');

    await user.click(
      within(screen.getByTestId('form-enrollment')).getByRole('button', {
        name: 'Cancel',
      }),
    );

    // Answered: the reader is listening again and the chip says so.
    await waitFor(() => expect(chip()).toContain('Scanner active'));
  });

  it('names the dialog, not the form, when a dialog is what is holding it', async () => {
    const user = userEvent.setup();
    renderScanner();
    await waitFor(() => expect(screen.getByText('Tap to check in')).toBeTruthy());

    await user.click(screen.getByTestId('button-end-session'));
    await screen.findByTestId('dialog-session-summary');

    const chip = screen.getByTestId('text-scanner-focus').textContent ?? '';
    expect(chip).toContain('Scanner off');
    expect(chip).toContain('close this dialog');
  });
});
