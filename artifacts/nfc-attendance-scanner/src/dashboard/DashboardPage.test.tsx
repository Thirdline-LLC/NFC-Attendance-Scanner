import Dexie from 'dexie';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as attendanceStore from '@/data/attendance-store';
import { addPerson, recordSessionTap, type Person } from '@/data/attendance-store';
import * as attendanceExport from '@/lib/attendance-export';
import { currentSeniorGradYear } from '@/lib/attendance-export';
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

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

/**
 * Two sessions, four taps: one student at both meetings, one at the first
 * only, and one card nobody has enrolled.
 */
async function seedTwoSessions(): Promise<{ jane: Person; ada: Person }> {
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
      .spyOn(attendanceExport, 'exportAttendanceWorkbook')
      .mockResolvedValue({
        filename: 'attendance-2026-09-07-20260907T000000Z.xlsx',
        delivery: 'download',
      });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    await user.click(screen.getByTestId('button-export-history'));

    expect(exportSpy).toHaveBeenCalledTimes(1);
    const [exportedTaps, exportedPersons] = exportSpy.mock.calls[0];
    expect(exportedTaps).toHaveLength(5);
    expect(new Set(exportedTaps.map((tap) => tap.sessionId))).toEqual(
      new Set(['legacy', 'session-one', 'session-two']),
    );
    expect(exportedPersons).toHaveLength(2);
  });

  it('names the file it handed to the browser', async () => {
    await seedTwoSessions();
    vi.spyOn(attendanceExport, 'exportAttendanceWorkbook').mockResolvedValue({
      filename: 'attendance-2026-09-07-20260907T000000Z.xlsx',
      delivery: 'download',
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('dashboard');

    await user.click(screen.getByTestId('button-export-history'));

    expect(screen.getByTestId('text-export-saved').textContent).toContain(
      'attendance-2026-09-07-20260907T000000Z.xlsx',
    );
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
      .spyOn(attendanceStore, 'listTapRecords')
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

    vi.spyOn(attendanceStore, 'listTapRecords').mockRejectedValueOnce(
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
