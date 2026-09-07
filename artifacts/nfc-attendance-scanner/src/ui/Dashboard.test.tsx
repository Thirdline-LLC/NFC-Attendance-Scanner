import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Person, TapRecord } from '@/data/attendance-store';
import {
  computeDashboardMetrics,
  type DashboardMetrics,
} from '@/lib/attendance-metrics';

import { Dashboard } from './Dashboard';

afterEach(cleanup);

const at = (isoDate: string, time = '16:00:00') => `${isoDate}T${time}.000Z`;
const NOW = at('2026-09-15');

const jordan: Person = {
  id: 1,
  cardUid: '04A1B2C3D4E5F6',
  firstName: 'Jordan',
  lastName: 'Lee',
  gradYear: 2027,
  email: 'jlee27@stjohnschs.org',
  enrolledAt: at('2026-09-01'),
};

const priya: Person = {
  id: 2,
  cardUid: '04F6E5D4C3B2A1',
  firstName: 'Priya',
  lastName: 'Nair',
  gradYear: 2028,
  email: 'pnair28@stjohnschs.org',
  enrolledAt: at('2026-09-01'),
};

// Distinctive so a leak of the full UID cannot hide inside the masked form.
const STRAY_UID = '04DEADBEEF1234';
const STRAY_UID_2 = '04CAFEF00D5678';

function tap(
  sessionId: string,
  uid: string,
  scannedAt: string,
  personId: number | null,
): TapRecord {
  return { sessionId, uid, scannedAt, personId, counted: personId !== null };
}

const taps: TapRecord[] = [
  tap('a', jordan.cardUid, at('2026-09-01'), 1),
  tap('a', priya.cardUid, at('2026-09-01', '16:05:00'), 2),
  tap('b', jordan.cardUid, at('2026-09-08'), 1),
  tap('b', STRAY_UID, at('2026-09-08', '16:05:00'), null),
  tap('b', STRAY_UID, at('2026-09-08', '16:06:00'), null),
  tap('c', STRAY_UID_2, at('2026-09-14', '20:30:00'), null),
];

const populated = computeDashboardMetrics(taps, [jordan, priya], NOW);
const empty = computeDashboardMetrics([], [], NOW);

function withYtd(
  base: DashboardMetrics,
  ytd: Partial<DashboardMetrics['ytd']>,
): DashboardMetrics {
  return { ...base, ytd: { ...base.ytd, ...ytd } };
}

const text = (testId: string) => screen.getByTestId(testId).textContent;

describe('Dashboard numbers', () => {
  it('shows the average against the target with a rounded percentage', () => {
    render(<Dashboard metrics={populated} />);

    // Sessions a: 2, b: 1, c: 0 => average 1, 2% of 50.
    expect(text('text-average-attendance')).toBe('1');
    expect(text('text-attendance-target')).toBe('50');
    expect(text('text-percent-of-target')).toBe('2%');
    expect(text('text-sessions-count')).toBe('3');
    expect(text('text-unique-students')).toBe('2');
    expect(text('text-enrolled-students')).toBe('2');
  });

  it('rounds only for display', () => {
    render(
      <Dashboard
        metrics={withYtd(populated, {
          averageAttendance: 33.333,
          percentOfTarget: 66.666,
        })}
      />,
    );

    expect(text('text-average-attendance')).toBe('33.3');
    expect(text('text-percent-of-target')).toBe('67%');
  });

  it('caps the bar at full while still reporting a percentage over 100', () => {
    render(
      <Dashboard
        metrics={withYtd(populated, { averageAttendance: 60, percentOfTarget: 120 })}
      />,
    );

    expect(text('text-percent-of-target')).toBe('120%');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('names the latest and best sessions', () => {
    render(<Dashboard metrics={populated} />);

    expect(screen.getByText('Latest session').parentElement?.textContent).toContain(
      'Sep 14, 2026',
    );
    expect(screen.getByText('Best session').parentElement?.textContent).toContain(
      'Sep 1, 2026',
    );
  });
});

describe('Dashboard empty state', () => {
  it('says so instead of presenting zero as a measurement', () => {
    render(<Dashboard metrics={empty} />);

    expect(screen.getByTestId('text-no-sessions').textContent).toBe(
      'No sessions yet this school year',
    );
    expect(text('text-sessions-count')).toBe('0');
    expect(screen.queryByText('Latest session')).toBeNull();
  });

  it('keeps the empty-state message off a year with sessions', () => {
    render(<Dashboard metrics={populated} />);

    expect(screen.queryByTestId('text-no-sessions')).toBeNull();
  });

  it('still lists grades 9 through 12 with nobody enrolled', () => {
    render(<Dashboard metrics={empty} />);

    const rows = within(screen.getByTestId('list-grade-breakdown')).getAllByRole(
      'listitem',
    );

    expect(rows.map((row) => row.textContent)).toEqual([
      'Grade 90 / 0',
      'Grade 100 / 0',
      'Grade 110 / 0',
      'Grade 120 / 0',
    ]);
  });
});

describe('Dashboard grade breakdown', () => {
  it('shows attended against enrolled for each grade', () => {
    render(<Dashboard metrics={populated} />);

    const list = screen.getByTestId('list-grade-breakdown');

    // Jordan (2027) is a senior, Priya (2028) a junior, in fall 2026.
    expect(within(list).getByTestId('row-grade-12').textContent).toBe('Grade 121 / 1');
    expect(within(list).getByTestId('row-grade-11').textContent).toBe('Grade 111 / 1');
    expect(within(list).getByTestId('row-grade-9').textContent).toBe('Grade 90 / 0');
    expect(within(list).queryByTestId('row-grade-alumni')).toBeNull();
  });
});

describe('Dashboard unidentified taps', () => {
  it('counts taps and cards and lists each card by its masked UID', () => {
    const { container } = render(<Dashboard metrics={populated} />);

    expect(text('text-unidentified-taps')).toBe('3');
    expect(text('text-unidentified-cards')).toBe('2');

    const items = within(screen.getByTestId('list-unidentified-cards')).getAllByRole(
      'listitem',
    );
    // Most recently seen first.
    expect(items[0].textContent).toContain('••••5678');
    expect(items[0].textContent).toContain('1 tap');
    // 20:30 UTC on Sep 14 is 4:30 PM EDT.
    expect(items[0].textContent).toContain('Sep 14, 4:30 PM');
    expect(items[1].textContent).toContain('••••1234');
    expect(items[1].textContent).toContain('2 taps');

    // The full UID must never reach the page, in any attribute or text.
    expect(container.innerHTML).not.toContain(STRAY_UID);
    expect(container.innerHTML).not.toContain(STRAY_UID_2);
    expect(container.innerHTML).not.toContain('DEADBEEF');
  });

  it('tells the operator to enroll the cards from Enroll mode', () => {
    render(<Dashboard metrics={populated} />);

    expect(screen.getByText(/Enroll each one from Enroll mode/)).toBeTruthy();
  });

  it('says every tap matched when there is nothing to enroll', () => {
    render(<Dashboard metrics={empty} />);

    expect(text('text-unidentified-taps')).toBe('0');
    expect(text('text-unidentified-cards')).toBe('0');
    expect(screen.queryByTestId('list-unidentified-cards')).toBeNull();
    expect(screen.getByText('Every tap on record matched an enrolled card.')).toBeTruthy();
  });

  it('lists at most five cards and counts the rest', () => {
    const many: TapRecord[] = Array.from({ length: 7 }, (_, i) =>
      tap('s', `04000000000${String(i).padStart(3, '0')}`, at('2026-09-08', `16:0${i}:00`), null),
    );

    render(<Dashboard metrics={computeDashboardMetrics(many, [], NOW)} />);

    expect(
      within(screen.getByTestId('list-unidentified-cards')).getAllByRole('listitem'),
    ).toHaveLength(5);
    expect(screen.getByText('and 2 more cards')).toBeTruthy();
  });
});

describe('Dashboard chrome', () => {
  it('states that everything is local', () => {
    render(<Dashboard metrics={populated} />);

    expect(screen.getByTestId('text-local-only').textContent).toContain('Local only.');
    expect(screen.getByText(/2026–27 school year/)).toBeTruthy();
  });

  it('offers a refresh only when given a handler, and disables it while loading', async () => {
    const { rerender } = render(<Dashboard metrics={populated} />);
    expect(screen.queryByTestId('button-refresh-dashboard')).toBeNull();

    const onRefresh = vi.fn();
    rerender(<Dashboard metrics={populated} onRefresh={onRefresh} />);
    await userEvent.setup().click(screen.getByTestId('button-refresh-dashboard'));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(<Dashboard metrics={populated} onRefresh={onRefresh} isLoading />);
    const button = screen.getByTestId('button-refresh-dashboard') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Refreshing');
  });

  it('offers the whole-history export only when given a handler', async () => {
    const { rerender } = render(<Dashboard metrics={populated} />);
    expect(screen.queryByTestId('button-export-history')).toBeNull();

    const onExportAll = vi.fn();
    rerender(<Dashboard metrics={populated} onExportAll={onExportAll} />);
    await userEvent.setup().click(screen.getByTestId('button-export-history'));

    expect(onExportAll).toHaveBeenCalledTimes(1);
  });
});
