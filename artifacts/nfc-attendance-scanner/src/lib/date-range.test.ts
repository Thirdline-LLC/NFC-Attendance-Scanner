import { describe, expect, it } from 'vitest';

import { formatSessionDate } from '@/lib/session-formatting';
import {
  addMonths,
  formatRangeForFilename,
  formatRangeLabel,
  isCalendarDay,
  rangeContainsDay,
  resolveDateRange,
  schoolYearRange,
  type DateRange,
} from './date-range';

// Noon in New York on Thursday, September 24, 2026.
const NOW = '2026-09-24T16:00:00.000Z';

function resolved(request: Parameters<typeof resolveDateRange>[0], now = NOW): DateRange {
  const result = resolveDateRange(request, now);
  if (!result.ok) throw new Error(result.error);
  return result.range;
}

describe('resolveDateRange presets', () => {
  it('resolves each rolling preset to an inclusive span ending today', () => {
    expect(resolved({ preset: 'today' })).toEqual({ preset: 'today', from: '2026-09-24', to: '2026-09-24' });
    expect(resolved({ preset: 'last-7-days' })).toMatchObject({ from: '2026-09-18', to: '2026-09-24' });
    expect(resolved({ preset: 'past-month' })).toMatchObject({ from: '2026-08-25', to: '2026-09-24' });
    expect(resolved({ preset: 'past-year' })).toMatchObject({ from: '2025-09-25', to: '2026-09-24' });
    expect(resolved({ preset: 'school-year' })).toMatchObject({ from: '2026-08-01', to: '2026-09-24' });
    expect(resolved({ preset: 'all-time' })).toMatchObject({ from: null, to: null });
  });

  it('takes "today" from the school calendar, so 11:30 pm is still today', () => {
    // 23:30 in New York on Sep 24 is already Sep 25 in UTC.
    const late = '2026-09-25T03:30:00.000Z';
    expect(resolved({ preset: 'today' }, late)).toMatchObject({ from: '2026-09-24', to: '2026-09-24' });
    // A minute past local midnight is the next day.
    const justAfter = '2026-09-25T04:01:00.000Z';
    expect(resolved({ preset: 'today' }, justAfter)).toMatchObject({ from: '2026-09-25' });
  });

  it('starts the school year on August 1 of the year in session', () => {
    expect(resolved({ preset: 'school-year' }, '2026-07-31T16:00:00.000Z')).toMatchObject({
      from: '2025-08-01',
      to: '2026-07-31',
    });
    expect(resolved({ preset: 'school-year' }, '2026-08-01T16:00:00.000Z')).toMatchObject({
      from: '2026-08-01',
      to: '2026-08-01',
    });
    expect(schoolYearRange(NOW)).toEqual(resolved({ preset: 'school-year' }));
  });

  it('clamps month arithmetic to the end of the shorter month', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2028-03-31', -1)).toBe('2028-02-29');
    expect(resolved({ preset: 'past-month' }, '2026-03-31T16:00:00.000Z')).toMatchObject({
      from: '2026-03-01',
      to: '2026-03-31',
    });
  });

  it('crosses a daylight-saving change without losing or gaining a day', () => {
    // US clocks fall back on Nov 1, 2026.
    expect(resolved({ preset: 'last-7-days' }, '2026-11-03T17:00:00.000Z')).toMatchObject({
      from: '2026-10-28',
      to: '2026-11-03',
    });
  });
});

describe('resolveDateRange validation', () => {
  it('needs a real day for Single day', () => {
    expect(resolveDateRange({ preset: 'day' }, NOW)).toEqual({ ok: false, error: 'Choose the day to export.' });
    expect(resolveDateRange({ preset: 'day', day: '2026-02-31' }, NOW).ok).toBe(false);
    expect(resolved({ preset: 'day', day: '2026-09-02' })).toMatchObject({ from: '2026-09-02', to: '2026-09-02' });
  });

  it('needs both custom dates, in order; one day is allowed', () => {
    expect(resolveDateRange({ preset: 'custom', from: '2026-09-01' }, NOW)).toEqual({
      ok: false,
      error: 'Choose both a start and an end date.',
    });
    expect(resolveDateRange({ preset: 'custom', from: '2026-09-10', to: '2026-09-01' }, NOW)).toEqual({
      ok: false,
      error: 'The start date is after the end date.',
    });
    expect(resolved({ preset: 'custom', from: '2026-09-10', to: '2026-09-10' })).toMatchObject({
      from: '2026-09-10',
      to: '2026-09-10',
    });
  });

  it('recognises calendar days only', () => {
    expect(isCalendarDay('2026-09-24')).toBe(true);
    expect(isCalendarDay('2026-9-24')).toBe(false);
    expect(isCalendarDay('2026-13-01')).toBe(false);
    expect(isCalendarDay(undefined)).toBe(false);
  });
});

describe('rangeContainsDay', () => {
  const range: DateRange = { preset: 'custom', from: '2026-09-01', to: '2026-09-24' };

  it('includes both ends and nothing outside them', () => {
    expect(rangeContainsDay(range, '2026-08-31')).toBe(false);
    expect(rangeContainsDay(range, '2026-09-01')).toBe(true);
    expect(rangeContainsDay(range, '2026-09-24')).toBe(true);
    expect(rangeContainsDay(range, '2026-09-25')).toBe(false);
  });

  it('files a tap by its local day: 11:59 pm is in, 12:00 am the next day is out', () => {
    expect(rangeContainsDay(range, formatSessionDate('2026-09-25T03:59:59.000Z'))).toBe(true);
    expect(rangeContainsDay(range, formatSessionDate('2026-09-25T04:00:00.000Z'))).toBe(false);
    // And the first minute of Sep 1 is in.
    expect(rangeContainsDay(range, formatSessionDate('2026-09-01T04:00:00.000Z'))).toBe(true);
  });

  it('has no bounds for All time', () => {
    expect(rangeContainsDay({ preset: 'all-time', from: null, to: null }, '1999-01-01')).toBe(true);
  });
});

describe('range labels', () => {
  it('writes file and reader labels', () => {
    const span: DateRange = { preset: 'custom', from: '2026-09-01', to: '2026-09-24' };
    expect(formatRangeForFilename(span)).toBe('2026-09-01 to 2026-09-24');
    expect(formatRangeLabel(span)).toBe('Sep 1, 2026 – Sep 24, 2026');
    const day: DateRange = { preset: 'day', from: '2026-09-02', to: '2026-09-02' };
    expect(formatRangeForFilename(day)).toBe('2026-09-02');
    expect(formatRangeLabel(day)).toBe('Sep 2, 2026');
    const all: DateRange = { preset: 'all-time', from: null, to: null };
    expect(formatRangeForFilename(all)).toBe('All time');
    expect(formatRangeLabel(all)).toBe('All time');
  });
});
