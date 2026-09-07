import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Person, TapRecord } from '@/data/attendance-store';

/**
 * The Eastern date formatting sits on the hot path of both the export and the
 * dashboard: a term is thousands of taps and every one of them is formatted.
 * Wall-clock assertions would be flaky on a shared container, so these count
 * the work instead — how many `Intl.DateTimeFormat` objects get built, and how
 * many times a tap's timestamp is formatted.
 *
 * The numbers matter. Constructing a formatter per call cost ~1.3 s for a
 * 5,000-tap export and the same again for the dashboard; caching the two
 * formatters and filtering the year-to-date taps once took the pair to ~75 ms
 * and ~40 ms.
 */

type Counts = { constructed: number; formatted: number };

/**
 * Runs `work` against a counting `Intl.DateTimeFormat`.
 *
 * The modules are re-imported inside, because their formatters are cached in
 * module scope: a copy imported earlier in the run would already hold real
 * formatters and would count nothing.
 */
async function measure(
  work: (modules: {
    metrics: typeof import('@/lib/attendance-metrics');
    exporter: typeof import('@/lib/attendance-export');
  }) => void,
): Promise<Counts> {
  const RealDateTimeFormat = Intl.DateTimeFormat;
  const counts: Counts = { constructed: 0, formatted: 0 };

  function Counting(
    this: unknown,
    ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
  ) {
    counts.constructed += 1;
    const real = new RealDateTimeFormat(...args);
    const formatToParts = real.formatToParts.bind(real);
    real.formatToParts = ((date?: Date | number) => {
      counts.formatted += 1;
      return formatToParts(date);
    }) as typeof real.formatToParts;
    return real;
  }

  Intl.DateTimeFormat = Counting as unknown as typeof Intl.DateTimeFormat;
  try {
    vi.resetModules();
    const [metrics, exporter] = await Promise.all([
      import('@/lib/attendance-metrics'),
      import('@/lib/attendance-export'),
    ]);
    work({ metrics, exporter });
  } finally {
    Intl.DateTimeFormat = RealDateTimeFormat;
  }

  return counts;
}

const TAP_COUNT = 200;

const persons: Person[] = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  cardUid: `04${index.toString(16).toUpperCase().padStart(12, '0')}`,
  firstName: 'Student',
  lastName: `Number${index}`,
  gradYear: 2026 + (index % 4),
  email: `student${index}@stjohnschs.org`,
  enrolledAt: '2025-09-01T12:00:00.000Z',
}));

const taps: TapRecord[] = Array.from({ length: TAP_COUNT }, (_, index) => {
  const person = persons[index % persons.length];
  return {
    id: index + 1,
    uid: person.cardUid,
    scannedAt: new Date(
      Date.UTC(2025, 8, 10, 22, 30) + index * 60_000,
    ).toISOString(),
    personId: person.id ?? null,
    sessionId: `session-${index % 8}`,
    counted: index < persons.length,
  };
});

const NOW = '2025-10-01T16:00:00.000Z';

describe('Eastern formatting cost', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('builds its formatters once, however many taps it formats', async () => {
    const counts = await measure(({ exporter }) => {
      const rows = exporter.buildAttendanceRows(taps, persons);
      expect(rows).toHaveLength(TAP_COUNT);
    });

    // One formatter for the timestamp shape, one for the year/month shape
    // `deriveGrade` needs. Built per call, this was over a thousand.
    expect(counts.constructed).toBeLessThanOrEqual(2);
    expect(counts.formatted).toBeGreaterThan(TAP_COUNT);
  });

  it('formats each tap once when the dashboard narrows to the school year', async () => {
    const counts = await measure(({ metrics }) => {
      const computed = metrics.computeDashboardMetrics(taps, persons, NOW);
      expect(computed.ytd.sessionsCount).toBe(8);
    });

    expect(counts.constructed).toBeLessThanOrEqual(2);
    // The year-to-date filter formats every tap's Eastern date; running it
    // twice — once for the summary and again for the grade breakdown — put
    // two full passes over the term's history on every dashboard load.
    // Everything else here is per session or per student, so a single pass
    // stays well under one and a half times the tap count.
    expect(counts.formatted).toBeLessThan(TAP_COUNT * 1.5);
  });
});
