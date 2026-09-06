import { describe, expect, it } from 'vitest';

import {
  currentSeniorGradYear,
  deriveGrade,
  formatMeetingDate,
} from './attendance-export';

// Noon UTC keeps every case comfortably inside the same Eastern calendar day,
// so the assertions do not depend on the daylight-saving offset.
const at = (isoDate: string) => `${isoDate}T16:00:00.000Z`;

const FALL_2026 = at('2026-09-15');
const SPRING_2027 = at('2027-03-10');
const FALL_2027 = at('2027-09-15');
const SPRING_2028 = at('2028-03-10');

describe('currentSeniorGradYear', () => {
  it('advances to the next calendar year once August arrives', () => {
    expect(currentSeniorGradYear(at('2026-08-01'))).toBe(2027);
    expect(currentSeniorGradYear(FALL_2026)).toBe(2027);
    expect(currentSeniorGradYear(at('2026-12-31'))).toBe(2027);
  });

  it('keeps the calendar year from January through July', () => {
    expect(currentSeniorGradYear(at('2027-01-05'))).toBe(2027);
    expect(currentSeniorGradYear(SPRING_2027)).toBe(2027);
    expect(currentSeniorGradYear(at('2027-07-31'))).toBe(2027);
  });

  it('treats the July/August boundary as the school-year rollover', () => {
    expect(currentSeniorGradYear(at('2026-07-31'))).toBe(2026);
    expect(currentSeniorGradYear(at('2026-08-01'))).toBe(2027);
  });
});

describe('deriveGrade', () => {
  it('puts the class of 2027 in grade 12 in fall 2026 (the reported bug)', () => {
    expect(deriveGrade(2027, FALL_2026)).toBe('12');
  });

  it('grades the 2026-2027 school year correctly in the fall', () => {
    expect(deriveGrade(2027, FALL_2026)).toBe('12');
    expect(deriveGrade(2028, FALL_2026)).toBe('11');
    expect(deriveGrade(2029, FALL_2026)).toBe('10');
    expect(deriveGrade(2030, FALL_2026)).toBe('9');
  });

  it('reports the same grades in the spring of that school year', () => {
    expect(deriveGrade(2027, SPRING_2027)).toBe('12');
    expect(deriveGrade(2028, SPRING_2027)).toBe('11');
    expect(deriveGrade(2029, SPRING_2027)).toBe('10');
    expect(deriveGrade(2030, SPRING_2027)).toBe('9');
  });

  it('advances every class by one grade in the next school year', () => {
    expect(deriveGrade(2028, FALL_2027)).toBe('12');
    expect(deriveGrade(2029, FALL_2027)).toBe('11');
    expect(deriveGrade(2030, FALL_2027)).toBe('10');

    expect(deriveGrade(2028, SPRING_2028)).toBe('12');
    expect(deriveGrade(2029, SPRING_2028)).toBe('11');
    expect(deriveGrade(2030, SPRING_2028)).toBe('10');
  });

  it('holds a grade steady across the calendar-year boundary', () => {
    expect(deriveGrade(2027, at('2026-12-31'))).toBe('12');
    expect(deriveGrade(2027, at('2027-01-01'))).toBe('12');
  });

  it('rolls the senior class over to alumni in August, not at graduation', () => {
    expect(deriveGrade(2027, at('2027-05-30'))).toBe('12');
    expect(deriveGrade(2027, at('2027-07-31'))).toBe('12');
    expect(deriveGrade(2027, at('2027-08-01'))).toBe('Alumni');
    expect(deriveGrade(2027, FALL_2027)).toBe('Alumni');
  });

  it('labels classes too far out as below grade 9', () => {
    expect(deriveGrade(2031, FALL_2026)).toBe('Below 9');
    expect(deriveGrade(2032, FALL_2026)).toBe('Below 9');
  });

  it('handles a scan late in the Eastern evening on the last day of July', () => {
    // 2026-07-31 23:30 EDT is 2026-08-01 03:30 UTC — still the old school year.
    expect(deriveGrade(2027, '2026-08-01T03:30:00.000Z')).toBe('11');
    // 2026-08-01 00:30 EDT is 2026-08-01 04:30 UTC — the new one.
    expect(deriveGrade(2027, '2026-08-01T04:30:00.000Z')).toBe('12');
  });
});

describe('formatMeetingDate', () => {
  it('formats in the export time zone', () => {
    expect(formatMeetingDate(FALL_2026)).toBe('2026-09-15');
  });
});
