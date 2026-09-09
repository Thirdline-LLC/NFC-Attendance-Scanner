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

  it('shows the meeting date and time from the completed session', async () => {
    await renderWithSummaryOpen();

    const [tap] = await listTapRecords();
    expect(screen.getByTestId('text-session-meeting').textContent).toBe(
      `Meeting date and time: ${attendanceExport.formatMeetingDateTime(tap.scannedAt)}`,
    );
  });

  it('shows a meeting date and time for an empty session', async () => {
    const user = userEvent.setup();
    renderScanner();
    await waitFor(() => expect(screen.getByText('Tap to check in')).toBeTruthy());

    await user.click(screen.getByTestId('button-end-session'));

    await screen.findByTestId('dialog-session-summary');
    expect(screen.getByTestId('text-session-meeting').textContent).toMatch(
      /^Meeting date and time: \w+ \d+, \d{4}, \d{1,2}:\d{2} (AM|PM)$/,
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
    const pagePress = new Event('pointerdown', {
      bubbles: true,
      cancelable: true,
    });
    screen.getByRole('heading', { name: 'Attendance Scanner' }).dispatchEvent(pagePress);
    // The page must not let its default text/focus behavior steal the hidden
    // reader after the refocus handler runs.
    expect(pagePress.defaultPrevented).toBe(true);

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

  it('keeps the hidden reader focused when switching to enroll mode', async () => {
    const user = userEvent.setup();
    renderScanner();
    await waitFor(() => expect(screen.getByText('Tap to check in')).toBeTruthy());

    const hiddenInput = screen.getByTestId('input-scanner-hidden');
    const enrollButton = screen.getByRole('button', { name: 'Enroll' });
    const modePress = new Event('pointerdown', {
      bubbles: true,
      cancelable: true,
    });
    enrollButton.dispatchEvent(modePress);

    expect(modePress.defaultPrevented).toBe(true);

    await user.click(enrollButton);
    await waitFor(() => expect(document.activeElement).toBe(hiddenInput));
    expect(enrollButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('text-scanner-focus').textContent).toContain(
      'Scanner active',
    );
  });

  it('prevents admin navigation links from stealing reader focus', async () => {
    renderScanner();
    await waitFor(() => expect(screen.getByText('Tap to check in')).toBeTruthy());

    for (const testId of ['link-roster', 'link-dashboard']) {
      const linkPress = new Event('pointerdown', {
        bubbles: true,
        cancelable: true,
      });
      screen.getByTestId(testId).dispatchEvent(linkPress);
      expect(linkPress.defaultPrevented).toBe(true);
    }
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
    const [tap] = await listTapRecords();
    expect(screen.getByTestId('text-new-session-meeting').textContent).toBe(
      `Meeting date and time: ${attendanceExport.formatMeetingDateTime(tap.scannedAt)}`,
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

  it('identifies an empty session before the first tap', async () => {
    const user = userEvent.setup();
    renderScanner();
    await waitFor(() => expect(screen.getByText('Tap to check in')).toBeTruthy());

    await user.click(screen.getByTestId('button-reset-session'));

    expect(await screen.findByTestId('dialog-new-session')).toBeTruthy();
    expect(screen.getByTestId('text-new-session-counts').textContent).toBe(
      'This session has 0 taps and 0 checked in.',
    );
    expect(screen.getByTestId('text-new-session-meeting').textContent).toMatch(
      /^Meeting date and time: \w+ \d+, \d{4}, \d{1,2}:\d{2} (AM|PM)$/,
    );
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

  it('does not carry an old export notice into the next session', async () => {
    vi.spyOn(attendanceExport, 'exportAttendanceWorkbook').mockResolvedValue({
      filename: 'attendance-2026-09-07-20260907T000000Z.xlsx',
      delivery: 'download',
    });
    const user = await renderWithOneTap();

    await user.click(screen.getByTestId('button-reset-session'));
    await user.click(await screen.findByTestId('button-dialog-export'));
    expect(screen.getByTestId('text-export-saved')).toBeTruthy();

    await user.click(screen.getByTestId('button-dialog-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('text-attendance-count').textContent).toBe('0'),
    );

    await user.click(screen.getByTestId('button-end-session'));
    await screen.findByTestId('dialog-session-summary');
    expect(screen.queryByTestId('text-export-saved')).toBeNull();
  });

  it('exports from inside the dialog without answering the question', async () => {
    const exportSpy = vi
      .spyOn(attendanceExport, 'exportAttendanceWorkbook')
      .mockResolvedValue({
        filename: 'attendance-2026-09-07-20260907T000000Z.xlsx',
        delivery: 'download',
      });
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
    vi.spyOn(attendanceExport, 'exportAttendanceWorkbook').mockResolvedValue({
      filename: 'attendance-2026-09-07-20260907T000000Z.xlsx',
      delivery: 'download',
    });
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

describe('ScannerScreen first run', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // The genuine day-one mistake: a station nobody has enrolled on looks ready
  // for a queue of students, and every card they tap comes back unknown.
  it('says a card has to be enrolled before it can check anyone in', async () => {
    renderScanner();

    await waitFor(() =>
      expect(screen.getByTestId('text-scan-status').textContent).toBe(
        'No students enrolled yet',
      ),
    );
    const station = screen.getByTestId('scanner-station').textContent ?? '';
    expect(station).toContain('Nobody is enrolled on this device yet');
    expect(station).toContain('switch to Enroll');
  });

  it('drops the first-run wording once a student is on the device', async () => {
    await addPerson(knownPerson);
    renderScanner();

    await waitFor(() =>
      expect(screen.getByTestId('text-scan-status').textContent).toBe(
        'Ready for next tap',
      ),
    );
    expect(screen.getByTestId('scanner-station').textContent).not.toContain(
      'Nobody is enrolled',
    );
  });

  // An empty `persons` mid-read is not an empty device. A kiosk with a term of
  // students on it must not flash "nobody is enrolled" while the store opens.
  it('does not claim an empty device while the store is still opening', async () => {
    vi.spyOn(attendanceStore, 'listPersons').mockReturnValue(
      new Promise<Person[]>(() => {}),
    );
    renderScanner();

    await screen.findByTestId('text-storage-checking');
    expect(screen.getByTestId('scanner-station').textContent).not.toContain(
      'Nobody is enrolled',
    );
  });
});

describe('ScannerScreen activity log', () => {
  const FILENAME = 'attendance-2026-09-15-20260915T210000Z.xlsx';

  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
    await addPerson(knownPerson);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** One enrolled student checked in, then End Session pressed. */
  async function renderAndEndSession() {
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

  it('records a session export as counts and a filename only', async () => {
    vi.spyOn(attendanceExport, 'exportAttendanceWorkbook').mockResolvedValue({
      filename: FILENAME,
      delivery: 'file',
      uri: `file:///Documents/${FILENAME}`,
    });
    const record = vi.spyOn(attendanceStore, 'recordActivity').mockResolvedValue();
    const user = await renderAndEndSession();

    await user.click(screen.getByTestId('button-summary-export'));

    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const [entry] = record.mock.calls[0];
    expect(entry).toMatchObject({
      kind: 'export-session',
      filename: FILENAME,
      delivery: 'file',
      taps: 1,
      sessions: 1,
    });
    expect(JSON.stringify(entry)).not.toMatch(/@|[0-9A-F]{14}/);
    expect(JSON.stringify(entry)).not.toContain('Jordan');
    expect(screen.getByTestId('text-export-saved').textContent).not.toContain(
      'activity log',
    );
  });

  it('writes no row when the export is cancelled', async () => {
    const { ExportCancelledError } = await import('@/platform/desktop-bridge');
    vi.spyOn(attendanceExport, 'exportAttendanceWorkbook').mockRejectedValue(
      new ExportCancelledError(),
    );
    const record = vi.spyOn(attendanceStore, 'recordActivity').mockResolvedValue();
    const user = await renderAndEndSession();

    await user.click(screen.getByTestId('button-summary-export'));

    await screen.findByTestId('text-export-cancelled');
    expect(record).not.toHaveBeenCalled();
  });

  it('still reports the export as saved when the log row cannot be written, and says so', async () => {
    vi.spyOn(attendanceExport, 'exportAttendanceWorkbook').mockResolvedValue({
      filename: FILENAME,
      delivery: 'file',
    });
    vi.spyOn(attendanceStore, 'recordActivity').mockRejectedValue(new Error('quota'));
    const user = await renderAndEndSession();

    await user.click(screen.getByTestId('button-summary-export'));

    await waitFor(() =>
      expect(screen.getByTestId('text-export-saved').textContent).toContain(
        'The activity log entry could not be written.',
      ),
    );
    expect(screen.queryByTestId('text-export-failed')).toBeNull();
  });
});
