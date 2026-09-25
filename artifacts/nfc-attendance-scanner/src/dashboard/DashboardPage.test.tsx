import Dexie from 'dexie';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as attendanceStore from '@/data/attendance-store';
import {
  addBodyFieldDef,
  addBodyTypeDef,
  addPerson,
  createBody,
  getActiveBody,
  listBodies,
  recordActivity,
  recordSessionTap,
  setActiveBody,
  type BoundPerson,
} from '@/data/attendance-store';
import * as operatorPin from '@/data/operator-pin';
import { setOperatorPin, verifyOperatorPin } from '@/data/operator-pin';
import * as rangeExport from '@/lib/range-export';
import * as rosterTemplate from '@/lib/roster-template';
import { currentSeniorGradYear } from '@/lib/attendance-export';
import { schoolYearStart } from '@/lib/attendance-metrics';
import { OperatorLockProvider } from '@/lock/OperatorLockProvider';
import { LockedRoute } from '@/lock/LockedRoute';
import { DashboardPage } from './DashboardPage';

const DATABASE_NAME = 'attendance-scanner-local';
const UNKNOWN_UID = '04CAFEBABE1122';

/**
 * Seeded relative to the clock the page reads, so the taps always land inside
 * the school year in session — a fixed date would fall out of it every August.
 */
const startedAt = Date.now();
function secondsAgo(seconds: number): string {
  return new Date(startedAt - seconds * 1000).toISOString();
}

/**
 * `DashboardPage` only ever mounts inside `AppRouter`'s one
 * `OperatorLockProvider`, behind a `LockedRoute` that has already unlocked
 * it — so the wrapper here matches that, rather than leaving `useOperatorLock`
 * to throw.
 */
function renderPage() {
  return render(
    <MemoryRouter>
      <OperatorLockProvider initiallyUnlocked>
        <DashboardPage />
      </OperatorLockProvider>
    </MemoryRouter>,
  );
}

/**
 * Two sessions, four taps: one student at both meetings, one at the first
 * only, and one card nobody has enrolled.
 */
async function seedTwoSessions(): Promise<{ jane: BoundPerson; ada: BoundPerson }> {
  const seniorYear = currentSeniorGradYear(new Date().toISOString());
  const jane = await addPerson({
    cardUid: '04A1B2C3D4E5F6',
    firstName: 'Jane',
    lastName: 'Smith',
    gradYear: seniorYear,
    email: 'jsmith@stjohnschs.org',
    enrolledAt: secondsAgo(90),
  });
  const ada = await addPerson({
    cardUid: '04FFEEDDCCBB99',
    firstName: 'Ada',
    lastName: 'Lovelace',
    gradYear: seniorYear,
    email: 'alovelace@stjohnschs.org',
    enrolledAt: secondsAgo(89),
  });

  await recordSessionTap({
    sessionId: 'session-one',
    uid: jane.cardUid,
    scannedAt: secondsAgo(60),
    personId: jane.id as number,
  });
  await recordSessionTap({
    sessionId: 'session-one',
    uid: ada.cardUid,
    scannedAt: secondsAgo(55),
    personId: ada.id as number,
  });
  await recordSessionTap({
    sessionId: 'session-two',
    uid: jane.cardUid,
    scannedAt: secondsAgo(40),
    personId: jane.id as number,
  });
  // No roster row, so `personId` is null exactly as an unrecognised tap is stored.
  await recordSessionTap({
    sessionId: 'session-two',
    uid: UNKNOWN_UID,
    scannedAt: secondsAgo(35),
    personId: null,
  });

  return { jane, ada };
}

/** Opens the Export dialog, picks a range and confirms it. */
async function exportRange(
  user: ReturnType<typeof userEvent.setup>,
  preset: 'all-time' | 'today' | 'school-year' = 'all-time',
) {
  await user.click(await screen.findByTestId('button-export-history'));
  const dialog = await screen.findByTestId('dialog-export');
  await user.click(within(dialog).getByTestId(`radio-range-${preset}`));
  await user.click(within(dialog).getByTestId('button-export-confirm'));
}

function delivered(filename: string) {
  return { filename, delivery: 'download' as const, tapCount: 4, sessionCount: 2 };
}

describe('DashboardPage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('folds the seeded taps and roster into the metrics on screen', async () => {
    await seedTwoSessions();
    const { container } = renderPage();

    expect(screen.getByTestId('text-dashboard-loading')).toBeTruthy();
    expect(await screen.findByTestId('dashboard')).toBeTruthy();

    expect(screen.getByTestId('text-sessions-count').textContent).toBe('2');
    // Two students at the first meeting, one at the second.
    expect(screen.getByTestId('text-average-attendance').textContent).toBe('1.5');
    expect(screen.getByTestId('text-attendance-target').textContent).toBe('50');
    expect(screen.getByTestId('text-percent-of-target').textContent).toBe('3%');
    expect(screen.getByTestId('text-unique-students').textContent).toBe('2');
    expect(screen.getByTestId('text-enrolled-students').textContent).toBe('2');

    expect(screen.getByTestId('text-unidentified-taps').textContent).toBe('1');
    expect(screen.getByTestId('text-unidentified-cards').textContent).toBe('1');
    const cards = screen.getByTestId('list-unidentified-cards');
    expect(within(cards).getByText('••••1122')).toBeTruthy();
    // A card UID is hardware identity: only its tail may reach the DOM.
    expect(container.textContent).not.toContain(UNKNOWN_UID);

    expect(screen.getByTestId('row-grade-12').textContent).toContain('2');
  });

  it('exports every session ever recorded, not just the latest', async () => {
    const { jane } = await seedTwoSessions();
    // What the v3 upgrade stamps on taps that predate session ids. No session
    // id will ever equal it, so the scanner's own export can never reach it.
    await recordSessionTap({
      sessionId: 'legacy',
      uid: jane.cardUid,
      scannedAt: secondsAgo(120),
      personId: jane.id as number,
    });
    const exportSpy = vi
      .spyOn(rangeExport, 'exportRangeWorkbook')
      .mockResolvedValue(delivered('Robotics Club - All time.xlsx'));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    await exportRange(user, 'all-time');

    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    const [{ taps: exportedTaps, persons: exportedPersons, range }] = exportSpy.mock.calls[0];
    expect(range).toEqual({ preset: 'all-time', from: null, to: null });
    expect(exportedTaps).toHaveLength(5);
    expect(new Set(exportedTaps.map((tap) => tap.sessionId))).toEqual(
      new Set(['legacy', 'session-one', 'session-two']),
    );
    expect(exportedPersons).toHaveLength(2);
  });

  it('names the file it handed to the browser', async () => {
    await seedTwoSessions();
    vi.spyOn(rangeExport, 'exportRangeWorkbook').mockResolvedValue(
      delivered('Robotics Club - 2026-09-07.xlsx'),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    await exportRange(user, 'today');

    expect((await screen.findByTestId('text-export-saved')).textContent).toContain(
      'Robotics Club - 2026-09-07.xlsx',
    );
    // The dialog closes on a delivered file, and focus goes back to Export.
    expect(screen.queryByTestId('dialog-export')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('button-export-history'));
  });

  it('re-reads the store when refreshed', async () => {
    const { jane } = await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');
    expect(screen.getByTestId('text-sessions-count').textContent).toBe('2');

    await recordSessionTap({
      sessionId: 'session-three',
      uid: jane.cardUid,
      scannedAt: secondsAgo(10),
      personId: jane.id as number,
    });

    await user.click(screen.getByTestId('button-refresh-dashboard'));

    await waitFor(() =>
      expect(screen.getByTestId('text-sessions-count').textContent).toBe('3'),
    );
  });

  it('offers a retry when the first read fails', async () => {
    await seedTwoSessions();
    const read = vi
      .spyOn(attendanceStore, 'listTapsForBodies')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByTestId('text-dashboard-load-error')).toBeTruthy();
    expect(screen.queryByTestId('dashboard')).toBeNull();

    read.mockRestore();
    await user.click(screen.getByTestId('button-dashboard-retry'));

    expect(await screen.findByTestId('dashboard')).toBeTruthy();
    expect(screen.getByTestId('text-sessions-count').textContent).toBe('2');
  });

  it('keeps the numbers already computed when a refresh fails', async () => {
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    vi.spyOn(attendanceStore, 'listTapsForBodies').mockRejectedValueOnce(
      new Error('storage unavailable'),
    );
    await user.click(screen.getByTestId('button-refresh-dashboard'));

    expect(await screen.findByTestId('text-dashboard-stale')).toBeTruthy();
    // Still true, only older than the button implied.
    expect(screen.getByTestId('text-sessions-count').textContent).toBe('2');
  });

  it('warns that cards are not being recorded while this page is open', async () => {
    renderPage();

    const notice = await screen.findByTestId('text-scans-paused');
    expect(notice.textContent).toMatch(/not being recorded/i);
    expect(within(notice).getByTestId('link-scanner-resume')).toBeTruthy();
  });

  it('measures against a target the operator can change', async () => {
    const { jane } = await seedTwoSessions();
    expect(jane).toBeTruthy();
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    // Starts at the default until this kiosk is told what its club looks like.
    expect(screen.getByTestId('text-attendance-target').textContent).toBe('50');
    const before = screen.getByTestId('text-average-attendance').textContent;

    await user.click(screen.getByTestId('button-edit-target'));
    const field = screen.getByTestId('input-attendance-target');
    await user.clear(field);
    await user.type(field, '2');
    await user.click(screen.getByTestId('button-save-target'));

    await waitFor(() =>
      expect(screen.getByTestId('text-attendance-target').textContent).toBe('2'),
    );
    // Only the goal moved; the attendance behind it is untouched.
    expect(screen.getByTestId('text-average-attendance').textContent).toBe(
      before,
    );
    expect(await attendanceStore.getAttendanceTarget()).toBe(2);
  });

  it('reloads with the target this kiosk was given', async () => {
    await seedTwoSessions();
    await attendanceStore.setAttendanceTarget(12);
    renderPage();
    await screen.findByTestId('dashboard');

    expect(screen.getByTestId('text-attendance-target').textContent).toBe('12');
  });

  it('refuses a target that is not a sensible number', async () => {
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    await user.click(screen.getByTestId('button-edit-target'));
    const field = screen.getByTestId('input-attendance-target');
    await user.clear(field);
    await user.type(field, '0');
    await user.click(screen.getByTestId('button-save-target'));

    expect(await screen.findByTestId('text-target-error')).toBeTruthy();
    // The editor stays open with the typed value, and nothing was stored.
    expect(screen.getByTestId('input-attendance-target')).toBeTruthy();
    expect(await attendanceStore.getAttendanceTarget()).toBe(50);
  });

  it('keeps the editor open when the device will not store it', async () => {
    await seedTwoSessions();
    vi.spyOn(attendanceStore, 'setAttendanceTarget').mockRejectedValue(
      new Error('storage unavailable'),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    await user.click(screen.getByTestId('button-edit-target'));
    const field = screen.getByTestId('input-attendance-target');
    await user.clear(field);
    await user.type(field, '15');
    await user.click(screen.getByTestId('button-save-target'));

    expect(await screen.findByTestId('text-target-error')).toBeTruthy();
    expect(screen.getByTestId('text-attendance-target').textContent).toBe('50');
  });

});

describe('DashboardPage activity log', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('lists the device activity newest first, in words, and says when there is none', async () => {
    await seedTwoSessions();
    renderPage();
    expect(await screen.findByTestId('text-activity-empty')).toBeTruthy();

    cleanup();
    await recordActivity({ at: secondsAgo(30), kind: 'pin-set' });
    await recordActivity({
      at: secondsAgo(10),
      kind: 'remove-student',
      taps: 3,
      sessions: 2,
    });
    renderPage();

    const list = await screen.findByTestId('list-activity');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Removed a student');
    expect(rows[0].textContent).toContain('3 taps from 2 sessions');
    expect(rows[1].textContent).toContain('Teacher PIN set');
  });

  it('exports all history with the activity sheet and records the export', async () => {
    await seedTwoSessions();
    await recordActivity({ at: secondsAgo(20), kind: 'pin-set' });
    const exportSpy = vi
      .spyOn(rangeExport, 'exportRangeWorkbook')
      .mockResolvedValue(delivered('attendance-all.xlsx'));
    const user = userEvent.setup();
    renderPage();

    await exportRange(user, 'all-time');

    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    const [{ activity }] = exportSpy.mock.calls[0];
    expect(activity?.map((entry) => entry.kind)).toEqual(['pin-set']);

    await waitFor(async () =>
      expect((await attendanceStore.listActivity())[0]).toMatchObject({
        kind: 'export-all',
        filename: 'attendance-all.xlsx',
        delivery: 'download',
        taps: 4,
        sessions: 2,
      }),
    );
    // The list on screen picks the new row up without a full reload.
    await waitFor(() =>
      expect(
        within(screen.getByTestId('list-activity')).getAllByRole('listitem')[0]
          .textContent,
      ).toContain('Exported all history'),
    );
    expect(screen.getByTestId('text-export-saved').textContent).toContain(
      'Send this file only to a school account.',
    );
  });

  it('logs a date-range export by its dates, with no activity sheet', async () => {
    await seedTwoSessions();
    await recordActivity({ at: secondsAgo(20), kind: 'pin-set' });
    const exportSpy = vi
      .spyOn(rangeExport, 'exportRangeWorkbook')
      .mockResolvedValue(delivered('Robotics Club - 2026-08-01 to 2026-09-24.xlsx'));
    const user = userEvent.setup();
    renderPage();

    await exportRange(user, 'school-year');

    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    const [{ activity, range, bodyPath }] = exportSpy.mock.calls[0];
    expect(activity).toBeUndefined();
    expect(range.preset).toBe('school-year');
    expect(bodyPath).toEqual([(await getActiveBody()).name]);
    await waitFor(async () =>
      expect((await attendanceStore.listActivity())[0]).toMatchObject({
        kind: 'export-range',
        filename: 'Robotics Club - 2026-08-01 to 2026-09-24.xlsx',
        taps: 4,
        sessions: 2,
        rangeFrom: range.from,
        rangeTo: range.to,
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId('list-activity')).getAllByRole('listitem')[0]
          .textContent,
      ).toContain('Exported a date range'),
    );
  });

  it('delivers a real range workbook named for the body and the day', async () => {
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await exportRange(user, 'today');

    await screen.findByTestId('text-export-saved');
    expect(screen.getByTestId('text-export-saved').textContent).toMatch(/ - \d{4}-\d{2}-\d{2}\.xlsx/);
  });

  it('keeps the export a success when the log row cannot be written', async () => {
    await seedTwoSessions();
    vi.spyOn(rangeExport, 'exportRangeWorkbook').mockResolvedValue(
      delivered('attendance-all.xlsx'),
    );
    vi.spyOn(attendanceStore, 'recordActivity').mockRejectedValue(new Error('quota'));
    const user = userEvent.setup();
    renderPage();

    await exportRange(user, 'all-time');

    await waitFor(() =>
      expect(screen.getByTestId('text-export-saved').textContent).toContain(
        'The activity log entry could not be written.',
      ),
    );
  });
});

describe('DashboardPage teacher PIN', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('changes the teacher PIN from the dashboard and logs it', async () => {
    await setOperatorPin('2468');
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-pin'));
    await user.type(await screen.findByTestId('input-pin-current'), '2468');
    await user.type(screen.getByTestId('input-pin'), '1357');
    await user.type(screen.getByTestId('input-pin-confirm'), '1357');
    await user.click(screen.getByTestId('button-pin-submit'));

    expect((await screen.findByTestId('text-pin-changed')).textContent).toContain(
      'Teacher PIN changed',
    );
    expect(await verifyOperatorPin('1357')).toEqual({ status: 'ok' });
    await waitFor(() =>
      expect(
        within(screen.getByTestId('list-activity')).getAllByRole('listitem')[0]
          .textContent,
      ).toContain('Teacher PIN changed'),
    );
  });

  it('keeps the old PIN when the dialog is cancelled', async () => {
    await setOperatorPin('2468');
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-pin'));
    await user.click(await screen.findByTestId('button-pin-cancel'));

    expect(screen.queryByTestId('dialog-pin')).toBeNull();
    expect(await verifyOperatorPin('2468')).toEqual({ status: 'ok' });
  });
});

describe('DashboardPage "Require teacher PIN" switch', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('is hidden until a PIN has ever been set', async () => {
    await seedTwoSessions();
    renderPage();

    await screen.findByTestId('dashboard');
    expect(screen.queryByTestId('switch-pin-required')).toBeNull();
  });

  it('shows on once a PIN exists, checked by default', async () => {
    await setOperatorPin('2468');
    await seedTwoSessions();
    renderPage();

    const toggle = await screen.findByTestId('switch-pin-required');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(await attendanceStore.getPinRequired()).toBe(true);
  });

  it('requires the current PIN to turn off; a wrong PIN leaves it on', async () => {
    await setOperatorPin('2468');
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('switch-pin-required'));
    await user.type(await screen.findByTestId('input-pin'), '0000');
    await user.click(screen.getByTestId('button-pin-submit'));

    expect((await screen.findByTestId('text-pin-error')).textContent).toBe(
      'That PIN is not right.',
    );
    expect(screen.getByTestId('switch-pin-required').getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(await attendanceStore.getPinRequired()).toBe(true);

    await user.type(screen.getByTestId('input-pin'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('switch-pin-required').getAttribute('aria-checked')).toBe(
        'false',
      ),
    );
    expect(screen.queryByTestId('dialog-pin')).toBeNull();
    expect(await attendanceStore.getPinRequired()).toBe(false);
    await waitFor(() =>
      expect(
        within(screen.getByTestId('list-activity')).getAllByRole('listitem')[0].textContent,
      ).toContain('PIN turned off'),
    );
  });

  it('turns back on with no PIN prompt, and the hash is unchanged', async () => {
    await setOperatorPin('2468');
    await attendanceStore.setPinRequired(false);
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('switch-pin-required');
    // Two independent reads settle here: `DashboardPage`'s own load (which
    // gates the switch's visibility) and the lock context's own read of the
    // same setting (which gates its checked state) — wait for both rather
    // than assuming they land in the same tick.
    await waitFor(() =>
      expect(screen.getByTestId('switch-pin-required').getAttribute('aria-checked')).toBe(
        'false',
      ),
    );

    await user.click(screen.getByTestId('switch-pin-required'));

    expect(screen.queryByTestId('dialog-pin')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('switch-pin-required').getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
    expect(await attendanceStore.getPinRequired()).toBe(true);
    // The setting toggled off and on again without ever touching the hash.
    expect(await verifyOperatorPin('2468')).toEqual({ status: 'ok' });
    await waitFor(() =>
      expect(
        within(screen.getByTestId('list-activity')).getAllByRole('listitem')[0].textContent,
      ).toContain('PIN turned on'),
    );
  });

  it('turning on with no PIN ever set opens the set-PIN flow instead of silently enabling', async () => {
    // The edge case: the requirement is off and no PIN exists behind it —
    // not reachable by turning the switch off (that needs a PIN to begin
    // with), but a device could still land here, and the recovery path is
    // the same form a fresh install's locked-route gate falls back to.
    await attendanceStore.setPinRequired(false);
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('switch-pin-required');
    await waitFor(() =>
      expect(screen.getByTestId('switch-pin-required').getAttribute('aria-checked')).toBe(
        'false',
      ),
    );
    await user.click(screen.getByTestId('switch-pin-required'));

    expect((await screen.findByTestId('text-pin-title')).textContent).toBe(
      'Set a teacher PIN',
    );
    await user.type(screen.getByTestId('input-pin'), '9999');
    await user.type(screen.getByTestId('input-pin-confirm'), '9999');
    await user.click(screen.getByTestId('button-pin-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('switch-pin-required').getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
    expect(await verifyOperatorPin('9999')).toEqual({ status: 'ok' });
    expect(await attendanceStore.getPinRequired()).toBe(true);
  });

  it('logs the switch with no student data in either direction', async () => {
    await setOperatorPin('2468');
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('switch-pin-required'));
    await user.type(await screen.findByTestId('input-pin'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('switch-pin-required').getAttribute('aria-checked')).toBe(
        'false',
      ),
    );
    await user.click(screen.getByTestId('switch-pin-required'));
    await waitFor(() =>
      expect(screen.getByTestId('switch-pin-required').getAttribute('aria-checked')).toBe(
        'true',
      ),
    );

    const entries = await attendanceStore.listActivity();
    const disabled = entries.find((entry) => entry.kind === 'pin-disabled');
    const enabled = entries.find((entry) => entry.kind === 'pin-enabled');
    expect(disabled).toBeTruthy();
    expect(enabled).toBeTruthy();
    expect(Object.keys(disabled as object).sort()).toEqual(['at', 'id', 'kind']);
    expect(Object.keys(enabled as object).sort()).toEqual(['at', 'id', 'kind']);
    expect(JSON.stringify(entries)).not.toContain('2468');
  });

  it('closes the turn-off dialog with a clear error if the PIN vanished meanwhile', async () => {
    await setOperatorPin('2468');
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('switch-pin-required'));
    await screen.findByTestId('input-pin');
    // The PIN disappears between opening the dialog and submitting.
    vi.spyOn(operatorPin, 'verifyOperatorPin').mockResolvedValueOnce({ status: 'unset' });
    await user.type(screen.getByTestId('input-pin'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));

    await waitFor(() => expect(screen.queryByTestId('dialog-pin')).toBeNull());
    expect((await screen.findByTestId('text-pin-required-error')).textContent).toMatch(
      /no teacher PIN on this device anymore/,
    );
    expect(await attendanceStore.getPinRequired()).toBe(true);
    const kinds = (await attendanceStore.listActivity()).map((entry) => entry.kind);
    expect(kinds).not.toContain('pin-disabled');
  });

  describe('after the PIN goes missing', () => {
    /**
     * Opens the turn-off dialog, then really removes the stored PIN (as a
     * cleared site-data store would) before submitting, so the dialog gets
     * a genuine 'unset' verdict and the Dashboard shows the missing-PIN alert.
     */
    async function reachMissingPinAlert(user: ReturnType<typeof userEvent.setup>) {
      await setOperatorPin('2468');
      await seedTwoSessions();
      renderPage();
      await user.click(await screen.findByTestId('switch-pin-required'));
      await screen.findByTestId('input-pin');
      await attendanceStore.writeSetting('operator-pin', '');
      await user.type(screen.getByTestId('input-pin'), '2468');
      await user.click(screen.getByTestId('button-pin-submit'));
      await screen.findByTestId('text-pin-required-error');
      expect(screen.queryByTestId('dialog-pin')).toBeNull();
      expect(screen.queryByTestId('switch-pin-required')).toBeNull();
    }

    it('the alert\'s Set PIN opens the set-PIN form, closes on success, and brings the switch back', async () => {
      const user = userEvent.setup();
      await reachMissingPinAlert(user);

      await user.click(screen.getByTestId('button-pin-error-set-pin'));
      await waitFor(() =>
        expect(screen.getByTestId('text-pin-title').textContent).toBe('Set a teacher PIN'),
      );
      await user.type(screen.getByTestId('input-pin'), '1357');
      await user.type(screen.getByTestId('input-pin-confirm'), '1357');
      await user.click(screen.getByTestId('button-pin-submit'));

      await waitFor(() => expect(screen.queryByTestId('dialog-pin')).toBeNull());
      expect(screen.queryByTestId('text-pin-required-error')).toBeNull();
      expect((await screen.findByTestId('text-pin-changed')).textContent).toBe(
        'Teacher PIN set.',
      );
      const toggle = await screen.findByTestId('switch-pin-required');
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      // The alert's button is gone; the keyboard lands on the switch it brought back.
      await waitFor(() => expect(document.activeElement).toBe(toggle));
      expect(await verifyOperatorPin('1357')).toEqual({ status: 'ok' });
      // The requirement never changed, so only the set is logged.
      expect(await attendanceStore.getPinRequired()).toBe(true);
      const kinds = (await attendanceStore.listActivity()).map((entry) => entry.kind);
      expect(kinds).toContain('pin-set');
      expect(kinds).not.toContain('pin-enabled');
      expect(kinds).not.toContain('pin-disabled');
    });

    it('Change PIN with no PIN left falls back to setting one and closes when done', async () => {
      const user = userEvent.setup();
      await reachMissingPinAlert(user);

      await user.click(screen.getByTestId('button-change-pin'));
      // Opening another dialog clears the stale alert.
      expect(screen.queryByTestId('text-pin-required-error')).toBeNull();
      await user.type(await screen.findByTestId('input-pin-current'), '2468');
      await user.type(screen.getByTestId('input-pin'), '1357');
      await user.type(screen.getByTestId('input-pin-confirm'), '1357');
      await user.click(screen.getByTestId('button-pin-submit'));

      // No PIN to change: the dialog switches to setting one.
      await waitFor(() =>
        expect(screen.getByTestId('text-pin-title').textContent).toBe('Set a teacher PIN'),
      );
      await user.type(screen.getByTestId('input-pin'), '1357');
      await user.type(screen.getByTestId('input-pin-confirm'), '1357');
      await user.click(screen.getByTestId('button-pin-submit'));

      await waitFor(() => expect(screen.queryByTestId('dialog-pin')).toBeNull());
      expect((await screen.findByTestId('text-pin-changed')).textContent).toBe(
        'Teacher PIN set.',
      );
      expect(await screen.findByTestId('switch-pin-required')).toBeTruthy();
      expect(await verifyOperatorPin('1357')).toEqual({ status: 'ok' });
      // Setting a PIN is not flipping the requirement: still on, and neither
      // direction of the switch was logged.
      expect(await attendanceStore.getPinRequired()).toBe(true);
      const kinds = (await attendanceStore.listActivity()).map((entry) => entry.kind);
      expect(kinds).not.toContain('pin-enabled');
      expect(kinds).not.toContain('pin-disabled');
    });

    it('cancelling Set PIN returns focus to Change PIN', async () => {
      const user = userEvent.setup();
      await reachMissingPinAlert(user);

      await user.click(screen.getByTestId('button-pin-error-set-pin'));
      await screen.findByTestId('text-pin-title');
      await user.click(screen.getByTestId('button-pin-cancel'));

      expect(screen.queryByTestId('dialog-pin')).toBeNull();
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByTestId('button-change-pin')),
      );
    });

    it('a PIN set elsewhere before Set PIN is pressed is asked for, not reported as set', async () => {
      const user = userEvent.setup();
      await reachMissingPinAlert(user);
      // Another window sets a PIN while the alert is still up.
      await setOperatorPin('9753');

      await user.click(screen.getByTestId('button-pin-error-set-pin'));
      await waitFor(() =>
        expect(screen.getByTestId('text-pin-title').textContent).toBe('Enter the teacher PIN'),
      );
      await user.type(screen.getByTestId('input-pin'), '9753');
      await user.click(screen.getByTestId('button-pin-submit'));

      await waitFor(() => expect(screen.queryByTestId('dialog-pin')).toBeNull());
      expect((await screen.findByTestId('text-pin-changed')).textContent).toBe(
        'A teacher PIN is already set on this device.',
      );
      expect(await attendanceStore.getPinRequired()).toBe(true);
      const kinds = (await attendanceStore.listActivity()).map((entry) => entry.kind);
      expect(kinds).not.toContain('pin-set');
    });

    it('a PIN set elsewhere while the set form is open is named, and asked for', async () => {
      const user = userEvent.setup();
      await reachMissingPinAlert(user);

      await user.click(screen.getByTestId('button-pin-error-set-pin'));
      await waitFor(() =>
        expect(screen.getByTestId('text-pin-title').textContent).toBe('Set a teacher PIN'),
      );
      await setOperatorPin('9753');
      await user.type(screen.getByTestId('input-pin'), '1357');
      await user.type(screen.getByTestId('input-pin-confirm'), '1357');
      await user.click(screen.getByTestId('button-pin-submit'));

      expect((await screen.findByTestId('text-pin-error')).textContent).toBe(
        'A teacher PIN was set on this device in the meantime. Enter it to continue.',
      );
      expect(screen.getByTestId('text-pin-title').textContent).toBe('Enter the teacher PIN');
      // Nothing was overwritten.
      expect(await verifyOperatorPin('9753')).toEqual({ status: 'ok' });

      await user.type(screen.getByTestId('input-pin'), '9753');
      await user.click(screen.getByTestId('button-pin-submit'));
      await waitFor(() => expect(screen.queryByTestId('dialog-pin')).toBeNull());
      expect((await screen.findByTestId('text-pin-changed')).textContent).toBe(
        'A teacher PIN is already set on this device.',
      );
      const kinds = (await attendanceStore.listActivity()).map((entry) => entry.kind);
      expect(kinds).not.toContain('pin-set');
    });

    it('Dismiss clears the alert', async () => {
      const user = userEvent.setup();
      await reachMissingPinAlert(user);

      await user.click(screen.getByTestId('button-pin-error-dismiss'));
      expect(screen.queryByTestId('text-pin-required-error')).toBeNull();
    });

    it('opening another dialog (body vocabulary) clears the alert', async () => {
      const user = userEvent.setup();
      await reachMissingPinAlert(user);

      await user.click(screen.getByTestId('button-manage-vocabulary'));
      await waitFor(() =>
        expect(screen.queryByTestId('text-pin-required-error')).toBeNull(),
      );
    });
  });

  it('shows an error and logs nothing when a direct turn-on cannot be saved', async () => {
    await setOperatorPin('2468');
    await attendanceStore.setPinRequired(false);
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('switch-pin-required');
    await waitFor(() =>
      expect(screen.getByTestId('switch-pin-required').getAttribute('aria-checked')).toBe(
        'false',
      ),
    );
    vi.spyOn(attendanceStore, 'setPinRequired').mockRejectedValueOnce(new Error('quota'));
    await user.click(screen.getByTestId('switch-pin-required'));

    expect((await screen.findByTestId('text-pin-required-error')).textContent).toMatch(
      /Couldn't turn the teacher PIN back on/,
    );
    expect(screen.getByTestId('switch-pin-required').getAttribute('aria-checked')).toBe('false');
    expect(await attendanceStore.getPinRequired()).toBe(false);
    const kinds = (await attendanceStore.listActivity()).map((entry) => entry.kind);
    expect(kinds).not.toContain('pin-enabled');
  });

  it('after set-PIN, logs pin-enabled only if turning the requirement on was saved', async () => {
    await attendanceStore.setPinRequired(false);
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('switch-pin-required');
    await waitFor(() =>
      expect(screen.getByTestId('switch-pin-required').getAttribute('aria-checked')).toBe(
        'false',
      ),
    );
    await user.click(screen.getByTestId('switch-pin-required'));
    await screen.findByTestId('input-pin-confirm');
    vi.spyOn(attendanceStore, 'setPinRequired').mockRejectedValueOnce(new Error('quota'));
    await user.type(screen.getByTestId('input-pin'), '9999');
    await user.type(screen.getByTestId('input-pin-confirm'), '9999');
    await user.click(screen.getByTestId('button-pin-submit'));

    expect((await screen.findByTestId('text-pin-required-error')).textContent).toMatch(
      /Couldn't turn the teacher PIN back on/,
    );
    expect(await attendanceStore.getPinRequired()).toBe(false);
    const kinds = (await attendanceStore.listActivity()).map((entry) => entry.kind);
    // The PIN itself was set (and logged by the set form); the requirement was not.
    expect(kinds).toContain('pin-set');
    expect(kinds).not.toContain('pin-enabled');
  });

  it('updates the live gate for the whole app immediately, without a reload', async () => {
    // The bug this guards against: writing the setting straight to the store
    // persists it, but the app's one `OperatorLockProvider` — the thing
    // `LockedRoute`, the idle relock and `RelockOnScanner` all actually read
    // — would not know until it remounted. This mounts a second locked
    // screen in the *same* provider, alongside the dashboard, and proves the
    // toggle reaches it without a remount.
    await setOperatorPin('2468');
    await seedTwoSessions();
    const user = userEvent.setup();

    function Other() {
      return <div data-testid="other-content">Other locked screen</div>;
    }
    function NavToOther() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/other')}>
          go elsewhere
        </button>
      );
    }

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <OperatorLockProvider initiallyUnlocked>
          <NavToOther />
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route
              path="/other"
              element={
                <LockedRoute>
                  <Other />
                </LockedRoute>
              }
            />
          </Routes>
        </OperatorLockProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByTestId('switch-pin-required'));
    await user.type(await screen.findByTestId('input-pin'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('switch-pin-required').getAttribute('aria-checked')).toBe(
        'false',
      ),
    );

    await user.click(screen.getByText('go elsewhere'));
    expect(await screen.findByTestId('other-content')).toBeTruthy();
    expect(screen.queryByTestId('dialog-pin')).toBeNull();
  });
});

describe('DashboardPage attendance body', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the active body the device is attached to', async () => {
    await seedTwoSessions();
    renderPage();

    expect((await screen.findByTestId('text-active-body')).textContent).toContain(
      'Club',
    );
    expect(screen.getByTestId('text-active-body').textContent).toContain('club');
  });

  it('switches to an existing body without touching the one just left', async () => {
    await seedTwoSessions();
    const debateClub = await createBody({ name: 'Debate Club', typeLabel: 'club' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-body'));
    await user.click(await screen.findByTestId(`button-body-${debateClub.id}`));

    await waitFor(() =>
      expect(screen.getByTestId('text-active-body').textContent).toContain(
        'Debate Club',
      ),
    );
    expect((await getActiveBody()).id).toBe(debateClub.id);
  });

  it('creates a new body from the dashboard and attaches to it', async () => {
    await seedTwoSessions();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-body'));
    await user.type(await screen.findByTestId('input-body-name'), 'Robotics Club');
    await user.type(screen.getByTestId('input-body-type'), 'section');
    await user.click(screen.getByTestId('button-body-create'));

    await waitFor(() =>
      expect(screen.getByTestId('text-active-body').textContent).toContain(
        'Robotics Club',
      ),
    );
    expect(screen.getByTestId('text-active-body').textContent).toContain('section');
  });

  it('says the device is still on the old body when attaching to a new class fails', async () => {
    const before = await getActiveBody();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('button-change-body'));
    await user.click(await screen.findByTestId('button-add-mode-class'));
    await user.type(screen.getByTestId('input-class-name'), 'English 11');
    vi.spyOn(attendanceStore, 'setActiveBody').mockRejectedValueOnce(new Error('blocked'));
    await user.click(screen.getByTestId('button-class-create'));

    const heading = await screen.findByRole('heading', { name: 'Add students to each period' });
    const step = heading.parentElement as HTMLElement;
    expect(step.textContent).not.toContain('this device is now on');
    expect(within(step).getByTestId('text-class-not-attached').textContent).toBe(
      `This device couldn’t switch to English 11, so it is still on ${before.name}. To take attendance for English 11, open Change body and pick it or one of its periods.`,
    );
    // The class exists; the device really is where the step says.
    expect((await getActiveBody()).id).toBe(before.id);
    expect((await listBodies()).some((body) => body.name === 'English 11')).toBe(true);
    // One message, not a contradicting error under it.
    expect(screen.queryByTestId('text-body-error')).toBeNull();
  });

  it('creates a class with periods, attaches to the class, and offers per-period templates', async () => {
    const delivered = vi
      .spyOn(rosterTemplate, 'deliverRosterTemplateWorkbook')
      .mockResolvedValue({ filename: 'tapin-roster-template-period-3.xlsx', delivery: 'download' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-body'));
    await user.click(await screen.findByTestId('button-add-mode-class'));
    await user.type(screen.getByTestId('input-class-name'), 'English 11');
    await user.click(screen.getByTestId('button-period-count-down'));
    await user.click(screen.getByTestId('button-period-count-down'));
    await user.click(screen.getByTestId('button-class-create'));

    expect(
      await screen.findByRole('heading', { name: 'Add students to each period' }),
    ).toBeTruthy();
    const active = await getActiveBody();
    expect(active.name).toBe('English 11');
    const periods = (await listBodies()).filter((body) => body.parentId === active.id);
    expect(periods.map((body) => body.name)).toEqual(['Period 1', 'Period 2', 'Period 3']);

    await user.click(screen.getByRole('button', { name: 'Download template for Period 3' }));
    expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ id: periods[2].id }));
    await user.click(await screen.findByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('dialog-body-switcher')).toBeNull();
    // Focus goes back to the button that opened the switcher.
    expect(document.activeElement).toBe(screen.getByTestId('button-change-body'));
    await waitFor(() =>
      expect(screen.getByTestId('text-active-body').textContent).toContain('English 11'),
    );
    // The class-wide view is on straight away, with a row per period.
    expect(screen.getByTestId('button-metrics-subtree').getAttribute('aria-pressed')).toBe('true');
    const table = screen.getByTestId('table-period-breakdown');
    expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Period 1',
      'Period 2',
      'Period 3',
    ]);
    // Template downloads are not logged, as on the Students page; creating is not either.
    expect(await attendanceStore.listActivity()).toEqual([]);

    // Reopened, the class sits in the tree as a group.
    await user.click(screen.getByTestId('button-change-body'));
    expect((await screen.findByTestId(`button-body-${active.id}`)).textContent).toContain(
      'English 11 · 3 periods',
    );
  });

  it('shows a per-period breakdown on the class view', async () => {
    const seniorYear = currentSeniorGradYear(new Date().toISOString());
    const { parent, periods } = await attendanceStore.createClassWithPeriods({
      className: 'English 11',
      periodNames: ['Period 1', 'Period 3'],
    });
    const [first, third] = periods;
    // Period 1: two students; one meeting with both, one with one.
    await setActiveBody(first.id as number);
    const [a, b] = await Promise.all(
      ['a', 'b'].map((suffix, index) =>
        addPerson({
          cardUid: `04000000000A${index}0`,
          firstName: `Student${suffix}`,
          lastName: 'One',
          gradYear: seniorYear,
          email: `p1-${suffix}@example.com`,
          enrolledAt: secondsAgo(200),
        }),
      ),
    );
    await recordSessionTap({ sessionId: 'p1-a', uid: a.cardUid, scannedAt: secondsAgo(120), personId: a.id });
    await recordSessionTap({ sessionId: 'p1-a', uid: b.cardUid, scannedAt: secondsAgo(119), personId: b.id });
    await recordSessionTap({ sessionId: 'p1-b', uid: a.cardUid, scannedAt: secondsAgo(60), personId: a.id });
    // Period 3: one student enrolled, no meetings yet.
    await setActiveBody(third.id as number);
    await addPerson({
      cardUid: '04000000000C00',
      firstName: 'Studentc',
      lastName: 'Three',
      gradYear: seniorYear,
      email: 'p3-c@example.com',
      enrolledAt: secondsAgo(200),
    });
    await setActiveBody(parent.id as number);

    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');
    // "This body" alone: the class itself has no taps, and no table.
    expect(screen.queryByTestId('table-period-breakdown')).toBeNull();

    await user.click(screen.getByTestId('button-metrics-subtree'));
    const table = await screen.findByTestId('table-period-breakdown');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(['Period', 'Meetings held', 'Unique present', 'Avg attendance']);

    const firstRow = within(screen.getByTestId(`row-period-${first.id}`)).getAllByRole('cell');
    expect(within(screen.getByTestId(`row-period-${first.id}`)).getByRole('rowheader').textContent).toBe('Period 1');
    // 2 meetings; both students present at least once; (2 + 1) / 2 = 1.5 of 2 = 75%.
    expect(firstRow.map((cell) => cell.textContent)).toEqual(['2', '2 of 2', '75%']);
    const thirdRow = within(screen.getByTestId(`row-period-${third.id}`)).getAllByRole('cell');
    expect(thirdRow.map((cell) => cell.textContent)).toEqual(['0', '0 of 1', '— no meetings yet']);

    await user.click(screen.getByTestId('button-metrics-this-body'));
    expect(screen.queryByTestId('table-period-breakdown')).toBeNull();
  });

  it('exports the class with all its periods, and logs the scope by count only', async () => {
    const seniorYear = currentSeniorGradYear(new Date().toISOString());
    const { parent, periods } = await attendanceStore.createClassWithPeriods({
      className: 'English 11',
      periodNames: ['Period 1', 'Period 3'],
    });
    const [first, third] = periods;
    for (const [index, period] of [first, third].entries()) {
      await setActiveBody(period.id as number);
      const person = await addPerson({
        cardUid: `04000000000D${index}0`,
        firstName: `Student${index}`,
        lastName: 'Class',
        gradYear: seniorYear,
        email: `class-${index}@example.com`,
        enrolledAt: secondsAgo(200),
      });
      await recordSessionTap({
        sessionId: `class-${index}`,
        uid: person.cardUid,
        scannedAt: secondsAgo(100 - index),
        personId: person.id,
      });
    }
    await setActiveBody(parent.id as number);
    const exportSpy = vi
      .spyOn(rangeExport, 'exportSubtreeRangeWorkbook')
      .mockResolvedValue({ ...delivered('English 11 - All periods - All time.xlsx'), bodyCount: 2 });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-export-history'));
    const dialog = await screen.findByTestId('dialog-export');
    // The dashboard shows "This body", so the dialog starts there too.
    expect(within(dialog).getByRole('radio', { name: 'This body only' })).toHaveProperty('checked', true);
    await user.click(within(dialog).getByRole('radio', { name: 'This body + all periods' }));
    await user.click(within(dialog).getByTestId('radio-range-all-time'));
    await user.click(within(dialog).getByTestId('button-export-confirm'));

    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    const [call] = exportSpy.mock.calls[0];
    expect(call.rootId).toBe(parent.id);
    expect(call.bodyPath).toEqual(['English 11']);
    expect(new Set(call.taps.map((tap) => tap.bodyId))).toEqual(new Set([first.id, third.id]));
    expect(call.activity).toBeDefined();
    await waitFor(async () =>
      expect((await attendanceStore.listActivity())[0]).toMatchObject({
        kind: 'export-all',
        filename: 'English 11 - All periods - All time.xlsx',
        scope: 'subtree',
        bodies: 2,
      }),
    );
    const row = (await attendanceStore.listActivity())[0];
    expect(JSON.stringify(row)).not.toMatch(/example\.com|Student|04000000000D/);
  });

  it('offers no class-wide scope for a body without descendants', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('button-export-history'));
    const dialog = await screen.findByTestId('dialog-export');
    expect(within(dialog).queryByTestId('export-scope-options')).toBeNull();
  });

  it('shows a child body with its path and still switches to it', async () => {
    const parent = await getActiveBody();
    const child = await createBody({
      name: 'Finance',
      typeLabel: 'Branch',
      parentId: parent.id,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-body'));
    await user.type(await screen.findByTestId('input-body-search'), 'Finance');

    const button = await screen.findByTestId(`button-body-${child.id}`);
    expect(button.textContent).toContain('Finance');
    expect(button.textContent).toContain('Branch');
    expect(button.textContent).toContain('Club › Finance');
    expect(screen.queryByTestId(`button-body-${parent.id}`)).toBeNull();

    await user.clear(screen.getByTestId('input-body-search'));
    await user.click(screen.getByTestId(`button-body-${child.id}`));

    await waitFor(() =>
      expect(screen.getByTestId('text-active-body').textContent).toContain('Finance'),
    );
    expect((await getActiveBody()).id).toBe(child.id);
  });

  it('rolls metrics up to descendants and counts a shared email once', async () => {
    const parent = await getActiveBody();
    const jane = await addPerson({
      cardUid: '04A1B2C3D4E5F6',
      firstName: 'Jane',
      lastName: 'Smith',
      gradYear: currentSeniorGradYear(new Date().toISOString()),
      email: 'jsmith@stjohnschs.org',
      enrolledAt: secondsAgo(90),
    });
    await recordSessionTap({
      sessionId: 'parent-session',
      uid: jane.cardUid,
      scannedAt: secondsAgo(60),
      personId: jane.id as number,
    });

    const child = await createBody({
      name: 'Finance',
      typeLabel: 'Branch',
      parentId: parent.id,
    });
    await setActiveBody(child.id as number);
    const janeAgain = await addPerson({
      cardUid: '04BBBBBBBBBBBB',
      firstName: 'Jane',
      lastName: 'Smith',
      gradYear: currentSeniorGradYear(new Date().toISOString()),
      email: 'JSmith@stjohnschs.org',
      enrolledAt: secondsAgo(50),
    });
    await recordSessionTap({
      sessionId: 'child-session',
      uid: janeAgain.cardUid,
      scannedAt: secondsAgo(40),
      personId: janeAgain.id as number,
    });
    const ada = await addPerson({
      cardUid: '04CCCCCCCCCCCC',
      firstName: 'Ada',
      lastName: 'Lovelace',
      gradYear: currentSeniorGradYear(new Date().toISOString()),
      email: 'alovelace@stjohnschs.org',
      enrolledAt: secondsAgo(30),
    });
    await recordSessionTap({
      sessionId: 'child-session',
      uid: ada.cardUid,
      scannedAt: secondsAgo(20),
      personId: ada.id as number,
    });
    await setActiveBody(parent.id as number);

    const user = userEvent.setup();
    renderPage();

    expect((await screen.findByTestId('text-unique-students')).textContent).toBe('1');
    await user.click(screen.getByTestId('button-metrics-subtree'));
    await waitFor(() =>
      expect(screen.getByTestId('text-unique-students').textContent).toBe('2'),
    );
    expect(screen.getByTestId('text-enrolled-students').textContent).toBe('2');
    expect(screen.getByTestId('text-rollup-identity').textContent).toMatch(/email/i);
  });
});

describe('DashboardPage retention', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** A graduate with one tap last school year and one this year. */
  async function seedGraduate() {
    const now = new Date().toISOString();
    const start = schoolYearStart(now);
    const lastYear = new Date(
      Date.parse(`${start}T12:00:00.000Z`) - 86_400_000,
    ).toISOString();
    const grace = await addPerson({
      cardUid: '04AAAAAAAAAAAA',
      firstName: 'Grace',
      lastName: 'Old',
      gradYear: currentSeniorGradYear(now) - 1,
      email: 'gold@stjohnschs.org',
      enrolledAt: lastYear,
    });
    await recordSessionTap({
      sessionId: 'last-year',
      uid: grace.cardUid,
      scannedAt: lastYear,
      personId: grace.id as number,
    });
    await recordSessionTap({
      sessionId: 'session-two',
      uid: grace.cardUid,
      scannedAt: secondsAgo(30),
      personId: grace.id as number,
    });
    return { grace, start };
  }

  it('previews, confirms, logs and reloads both retention actions', async () => {
    await seedTwoSessions();
    const { grace } = await seedGraduate();
    const user = userEvent.setup();
    renderPage();

    const historyText = await screen.findByTestId('text-retention-history');
    expect(historyText.textContent).toContain('1 tap');
    expect(historyText.textContent).toContain('1 session');
    expect(screen.getByTestId('text-retention-alumni').textContent).toContain(
      '1 graduated student',
    );

    await user.click(screen.getByTestId('button-purge-history'));
    expect(screen.getByTestId('text-retention-cost').textContent).toContain('1 tap');
    await user.click(screen.getByTestId('button-retention-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('text-retention-done').textContent).toMatch(
        /^Deleted 1 tap from 1 session before /,
      ),
    );
    expect(
      (await attendanceStore.listTapRecords()).some((tap) => tap.sessionId === 'last-year'),
    ).toBe(false);
    await waitFor(() =>
      expect(screen.getByTestId('text-retention-history').textContent).toBe(
        'Nothing older than this school year.',
      ),
    );
    expect(screen.getByTestId('button-purge-history').hasAttribute('disabled')).toBe(true);
    expect(
      within(screen.getByTestId('list-activity')).getAllByRole('listitem')[0].textContent,
    ).toContain('Deleted attendance');

    await user.click(screen.getByTestId('button-remove-alumni'));
    expect(screen.getByTestId('text-retention-cost').textContent).toContain(
      '1 graduated student',
    );
    await user.click(screen.getByTestId('button-retention-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('text-retention-done').textContent).toBe(
        'Removed 1 graduated student and 1 tap.',
      ),
    );
    expect(
      (await attendanceStore.listPersons()).some((person) => person.id === grace.id),
    ).toBe(false);
    await waitFor(() =>
      expect(screen.getByTestId('text-retention-alumni').textContent).toBe(
        'No graduated students on this device.',
      ),
    );
    expect(screen.getByTestId('button-remove-alumni').hasAttribute('disabled')).toBe(true);
    expect(
      within(screen.getByTestId('list-activity')).getAllByRole('listitem')[0].textContent,
    ).toContain('Removed graduated students');
    const logged = await attendanceStore.listActivity();
    expect(logged[0]).toMatchObject({ kind: 'remove-alumni', students: 1, taps: 1 });
    expect(logged[1]).toMatchObject({ kind: 'purge-history', taps: 1, sessions: 1 });
    expect(typeof logged[1].before).toBe('string');
    expect(JSON.stringify(logged)).not.toContain('Grace');
  });

  it('disables both actions when there is nothing to do', async () => {
    await seedTwoSessions();
    renderPage();

    expect((await screen.findByTestId('text-retention-history')).textContent).toBe(
      'Nothing older than this school year.',
    );
    expect(screen.getByTestId('text-retention-alumni').textContent).toBe(
      'No graduated students on this device.',
    );
    expect(screen.getByTestId('button-purge-history').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('button-remove-alumni').hasAttribute('disabled')).toBe(true);
  });
});

describe('DashboardPage body vocabulary', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('offers the saved vocabulary as suggestions when creating a body', async () => {
    await addBodyTypeDef('Branch');
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-body'));

    const options = Array.from(
      document.querySelectorAll('#body-type-suggestions option'),
    ).map((option) => option.getAttribute('value'));
    expect(options).toContain('club');
    expect(options).toContain('Branch');
  });

  it('blocks creating a body until a required custom field is filled, then saves it', async () => {
    await addBodyFieldDef({
      label: 'Advisor email',
      appliesToTypeLabel: 'Section',
      required: true,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-body'));
    await user.type(await screen.findByTestId('input-body-name'), 'Debate');
    await user.type(screen.getByTestId('input-body-type'), 'Section');

    const createButton = await screen.findByTestId('button-body-create');
    expect(createButton.hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('text-create-fields-missing').textContent).toContain(
      'Advisor email',
    );

    await user.type(
      screen.getByTestId('input-create-field-Advisor email'),
      'advisor@stjohnschs.org',
    );
    expect(createButton.hasAttribute('disabled')).toBe(false);
    await user.click(createButton);

    await waitFor(() =>
      expect(screen.getByTestId('text-active-body').textContent).toContain('Debate'),
    );
    const created = (await listBodies()).find((body) => body.name === 'Debate');
    expect(created?.customFields).toEqual({ 'Advisor email': 'advisor@stjohnschs.org' });
  });

  it('edits an existing body’s custom fields from the structure editor', async () => {
    await addBodyFieldDef({ label: 'Room', appliesToTypeLabel: 'club', required: false });
    const root = await getActiveBody();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-body'));
    await user.selectOptions(
      await screen.findByTestId('select-structure-body'),
      String(root.id),
    );
    await user.type(screen.getByTestId('input-structure-field-Room'), '204');
    await user.click(screen.getByTestId('button-structure-save-fields'));

    await waitFor(async () => {
      const saved = (await listBodies()).find((body) => body.id === root.id);
      expect(saved?.customFields).toEqual({ Room: '204' });
    });
  });

  it('blocks changing a body onto a type with a required field it does not have', async () => {
    await addBodyFieldDef({ label: 'Advisor', appliesToTypeLabel: 'team', required: true });
    const root = await getActiveBody();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-change-body'));
    await user.selectOptions(
      await screen.findByTestId('select-structure-body'),
      String(root.id),
    );
    await user.clear(screen.getByTestId('input-structure-type'));
    await user.type(screen.getByTestId('input-structure-type'), 'team');

    const renameButton = screen.getByTestId('button-structure-rename');
    expect(renameButton.hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('text-structure-rename-blocked').textContent).toContain('Advisor');

    // The rename button unblocks once the draft has a value: `renameBody`
    // takes the draft's field values along with the type change and
    // validates+writes both atomically, so a single click here is enough —
    // no separate "Save custom fields" round trip has to land first.
    await user.type(screen.getByTestId('input-structure-field-Advisor'), 'a@b.org');
    expect(renameButton.hasAttribute('disabled')).toBe(false);
    await user.click(renameButton);

    await waitFor(async () => {
      const saved = (await listBodies()).find((body) => body.id === root.id);
      expect(saved?.typeLabel).toBe('team');
      expect(saved?.customFields).toEqual({ Advisor: 'a@b.org' });
    });
  });

  it('reloads bodies after a field-def label rename, so a later custom-field save does not overwrite the migrated key', async () => {
    const field = await addBodyFieldDef({
      label: 'Advisor',
      appliesToTypeLabel: 'club',
      required: false,
    });
    const root = await getActiveBody();
    await attendanceStore.updateBodyCustomFields(root.id as number, { Advisor: 'a@b.org' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-manage-vocabulary'));
    const labelInput = await screen.findByTestId(`input-body-field-label-${field.id}`);
    await user.clear(labelInput);
    // Casing-only, so `updateBodyFieldDef` still migrates the stored key
    // (see the vocab test for that) — this test is about the page's own
    // `bodies` state, not the store.
    await user.type(labelInput, 'advisor');
    await user.click(screen.getByTestId(`button-body-field-save-${field.id}`));
    await waitFor(() => expect(screen.getByDisplayValue('advisor')).toBeTruthy());
    await user.click(screen.getByTestId('button-body-vocabulary-close'));

    await user.click(await screen.findByTestId('button-change-body'));
    await user.selectOptions(
      await screen.findByTestId('select-structure-body'),
      String(root.id),
    );

    // A stale `bodies` array (customFields still keyed "Advisor") would show
    // this input blank instead of the value that now lives under "advisor".
    expect(
      (screen.getByTestId('input-structure-field-advisor') as HTMLInputElement).value,
    ).toBe('a@b.org');
  });

  it('manages the vocabulary from the admin dialog: add, rename, and delete a type', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-manage-vocabulary'));
    await screen.findByTestId('dialog-body-vocabulary');

    await user.type(screen.getByTestId('input-body-type-new'), 'Branch');
    await user.click(screen.getByTestId('button-body-type-add'));

    const addedInput = await screen.findByDisplayValue('Branch');
    const addedId = (addedInput.getAttribute('data-testid') ?? '').replace(
      'input-body-type-',
      '',
    );

    await user.clear(addedInput);
    await user.type(addedInput, 'Division');
    await user.click(screen.getByTestId(`button-body-type-save-${addedId}`));

    // A type-def rename can rewrite bodies' own `typeLabel`, so it reloads
    // through the same page-wide `load()` a body switch uses (see
    // `refreshVocab`) — slower than the vocabulary lists updating, and the
    // delete button below stays disabled (`isWorking`) until it resolves.
    // Waiting on the display value alone can win that race under load.
    const deleteButton = screen.getByTestId(`button-body-type-delete-${addedId}`);
    await waitFor(() => {
      expect(screen.getByDisplayValue('Division')).toBeTruthy();
      expect(deleteButton.hasAttribute('disabled')).toBe(false);
    });

    await user.click(deleteButton);

    await waitFor(() => expect(screen.queryByDisplayValue('Division')).toBeNull());
  });

  it('adds a custom-field definition from the admin dialog', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('button-manage-vocabulary'));
    await user.type(screen.getByTestId('input-body-field-new-label'), 'Advisor email');
    await user.type(screen.getByTestId('input-body-field-new-type'), 'club');
    await user.click(screen.getByTestId('checkbox-body-field-new-required'));
    await user.click(screen.getByTestId('button-body-field-add'));

    await screen.findByTestId('list-body-fields');
    expect(screen.getByDisplayValue('Advisor email')).toBeTruthy();
  });
});
