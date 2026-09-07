import { describe, expect, it } from 'vitest';
import {
  formatSessionDate,
  formatSessionDateLabel,
  formatSessionDateTime,
  formatSessionLastSeen,
} from './session-formatting';

describe('session formatting contract', () => {
  it('uses the same local calendar date at the Eastern midnight boundary', () => {
    expect(formatSessionDate('2027-01-15T04:59:59.000Z')).toBe('2027-01-14');
    expect(formatSessionDate('2027-01-15T05:00:00.000Z')).toBe('2027-01-15');
    expect(formatSessionDateLabel('2027-01-15')).toBe('Jan 15, 2027');
  });

  it('keeps date-time labels on the same local day through both DST changes', () => {
    expect(formatSessionDateTime('2027-03-14T06:59:00.000Z')).toBe(
      'Mar 14, 2027, 1:59 AM',
    );
    expect(formatSessionDateTime('2027-03-14T07:01:00.000Z')).toBe(
      'Mar 14, 2027, 3:01 AM',
    );
    expect(formatSessionDateTime('2027-11-07T05:30:00.000Z')).toBe(
      'Nov 7, 2027, 1:30 AM',
    );
    expect(formatSessionDateTime('2027-11-07T06:30:00.000Z')).toBe(
      'Nov 7, 2027, 1:30 AM',
    );
    expect(formatSessionLastSeen('2027-11-07T06:30:00.000Z')).toBe(
      'Nov 7, 1:30 AM',
    );
  });
});