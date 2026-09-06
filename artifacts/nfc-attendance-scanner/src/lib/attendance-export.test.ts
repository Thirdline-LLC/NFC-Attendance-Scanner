import { describe, expect, it } from 'vitest';

import {
  COMMENCEMENT_DATES,
  commencementDate,
  currentSeniorGradYear,
  deriveGrade,
  formatMeetingDate,
  hasGraduated,
} from './attendance-export';

// Injected in place of the real config so these cases do not move when a real
// commencement date is added to COMMENCEMENT_DATES.
const COMMENCEMENTS = { 2027: '2027-05-29', 2028: '2028-06-03' };

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

  it('falls back to the August rollover for a class with no commencement date', () => {
    expect(deriveGrade(2027, at('2027-05-30'), {})).toBe('12');
    expect(deriveGrade(2027, at('2027-07-31'), {})).toBe('12');
    expect(deriveGrade(2027, at('2027-08-01'), {})).toBe('Alumni');
    expect(deriveGrade(2027, FALL_2027, {})).toBe('Alumni');
  });

  it('turns the senior class over at commencement once a date is on file', () => {
    expect(deriveGrade(2027, at('2027-05-28'), COMMENCEMENTS)).toBe('12');
    // Commencement day itself still counts as grade 12.
    expect(deriveGrade(2027, at('2027-05-29'), COMMENCEMENTS)).toBe('12');
    expect(deriveGrade(2027, at('2027-05-30'), COMMENCEMENTS)).toBe('Alumni');
    expect(deriveGrade(2027, at('2027-07-31'), COMMENCEMENTS)).toBe('Alumni');
    expect(deriveGrade(2027, FALL_2027, COMMENCEMENTS)).toBe('Alumni');
  });

  it('leaves the underclasses on the August ladder over that summer', () => {
    // The juniors do not become seniors early just because the seniors left.
    expect(deriveGrade(2028, at('2027-06-15'), COMMENCEMENTS)).toBe('11');
    expect(deriveGrade(2029, at('2027-06-15'), COMMENCEMENTS)).toBe('10');
    expect(deriveGrade(2028, at('2027-08-01'), COMMENCEMENTS)).toBe('12');
  });

  it('graduates each class on its own date', () => {
    expect(deriveGrade(2028, at('2028-06-02'), COMMENCEMENTS)).toBe('12');
    expect(deriveGrade(2028, at('2028-06-04'), COMMENCEMENTS)).toBe('Alumni');
  });

  it('ignores a malformed commencement entry rather than graduating early', () => {
    expect(deriveGrade(2027, at('2027-06-15'), { 2027: 'May 29 2027' })).toBe('12');
    // Month 00 passes a naive YYYY-MM-DD shape check and sorts below every real
    // date, which would otherwise graduate the class on day one of senior year.
    expect(deriveGrade(2027, FALL_2026, { 2027: '2027-00-29' })).toBe('12');
    expect(deriveGrade(2027, FALL_2026, { 2027: '2027-02-31' })).toBe('12');
  });

  it('holds a class in grade 12 when its ceremony runs past the August rollover', () => {
    const delayed = { 2027: '2027-08-15' };
    expect(deriveGrade(2027, at('2027-07-20'), delayed)).toBe('12');
    expect(deriveGrade(2027, at('2027-08-05'), delayed)).toBe('12');
    expect(deriveGrade(2027, at('2027-08-15'), delayed)).toBe('12');
    expect(deriveGrade(2027, at('2027-08-16'), delayed)).toBe('Alumni');
  });

  it('uses the Eastern calendar day to place the commencement boundary', () => {
    // 2027-05-29 23:30 EDT is 2027-05-30 03:30 UTC — still commencement day.
    expect(deriveGrade(2027, '2027-05-30T03:30:00.000Z', COMMENCEMENTS)).toBe('12');
    // 2027-05-30 00:30 EDT is 2027-05-30 04:30 UTC — the day after.
    expect(deriveGrade(2027, '2027-05-30T04:30:00.000Z', COMMENCEMENTS)).toBe('Alumni');
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

describe('commencementDate', () => {
  it('returns a recorded date and rejects a malformed one', () => {
    expect(commencementDate(2027, COMMENCEMENTS)).toBe('2027-05-29');
    expect(commencementDate(2030, COMMENCEMENTS)).toBeNull();
    expect(commencementDate(2027, { 2027: '5/29/2027' })).toBeNull();
  });

  it('rejects a date outside the class year or off the calendar', () => {
    expect(commencementDate(2027, { 2027: '2026-05-29' })).toBeNull();
    expect(commencementDate(2027, { 2027: '2027-00-29' })).toBeNull();
    expect(commencementDate(2027, { 2027: '2027-13-01' })).toBeNull();
    expect(commencementDate(2027, { 2027: '2027-02-31' })).toBeNull();
    expect(commencementDate(2027, { 2027: '2027-02-28' })).toBe('2027-02-28');
  });

  it('accepts every date actually configured in COMMENCEMENT_DATES', () => {
    // Vacuous while the map is empty; it becomes live coverage as real dates
    // are added, and the same checks run at runtime in commencementDate.
    for (const [gradYear, date] of Object.entries(COMMENCEMENT_DATES)) {
      expect(commencementDate(Number(gradYear))).toBe(date);
    }
  });
});

describe('hasGraduated', () => {
  it('is false for a class with no date on file', () => {
    expect(hasGraduated(2027, at('2027-06-15'), {})).toBe(false);
  });

  it('flips the day after commencement', () => {
    expect(hasGraduated(2027, at('2027-05-29'), COMMENCEMENTS)).toBe(false);
    expect(hasGraduated(2027, at('2027-05-30'), COMMENCEMENTS)).toBe(true);
  });
});
