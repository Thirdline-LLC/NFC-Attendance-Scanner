import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FeedbackPanel } from '@/ui/FeedbackPanel';
import type { Person } from '@/data/attendance-store';
import type { ScanFeedback, ScannerMode } from '@/scanner/use-attendance-session';

const person: Person = {
  id: 1,
  cardUid: '04A1B2C3D4E5F6',
  firstName: 'Maria',
  lastName: 'Gonzalez',
  gradYear: 2027,
  email: 'mgonzalez27@stjohnschs.org',
  enrolledAt: '2026-09-01T10:00:00.000Z',
};

function renderPanel(
  overrides: {
    feedback?: ScanFeedback;
    mode?: ScannerMode;
    lastUid?: string;
    lastPerson?: Person;
    lastScannedAt?: string;
    rosterEmpty?: boolean;
  } = {},
) {
  render(
    <FeedbackPanel
      feedback={overrides.feedback ?? 'ready'}
      mode={overrides.mode ?? 'checkin'}
      lastUid={overrides.lastUid ?? ''}
      lastPerson={overrides.lastPerson}
      lastScannedAt={overrides.lastScannedAt ?? ''}
      isSaving={false}
      rosterEmpty={overrides.rosterEmpty ?? false}
    />,
  );
  return screen.getByTestId('status-scan-feedback');
}

afterEach(cleanup);

describe('FeedbackPanel first run', () => {
  // The day-one failure: a volunteer opens a kiosk nobody has enrolled on,
  // taps a queue of cards, and every one comes back unknown. The resting
  // panel is the only thing they read before that first tap.
  it('names enrollment as the missing step when nobody is enrolled', () => {
    const panel = renderPanel({ rosterEmpty: true });

    expect(screen.getByTestId('text-scan-status').textContent).toBe(
      'No students enrolled yet',
    );
    expect(panel.textContent).toContain('Switch to Enroll above');
  });

  it('goes back to the plain prompt once somebody is enrolled', () => {
    const panel = renderPanel({ rosterEmpty: false });

    expect(screen.getByTestId('text-scan-status').textContent).toBe(
      'Ready for next tap',
    );
    expect(panel.textContent).not.toContain('Switch to Enroll');
  });

  it('leaves Enroll mode alone — it is already where that advice points', () => {
    renderPanel({ rosterEmpty: true, mode: 'enroll' });

    expect(screen.getByTestId('text-scan-status').textContent).toBe(
      'Ready to enroll',
    );
  });
});

describe('FeedbackPanel scan outcomes', () => {
  // The tap *is* written, and the export credits it once the card is
  // enrolled. "Enroll later" left the volunteer guessing whether the student
  // had just been lost.
  it('says an unknown card was still saved, and what to do about it', () => {
    const panel = renderPanel({
      feedback: 'unknown',
      lastUid: '04A1B2C3D4E5F6',
    });

    expect(screen.getByTestId('text-scan-status').textContent).toBe(
      'Unknown card ••••E5F6 — tap saved',
    );
    expect(panel.textContent).toContain(
      'Switch to Enroll and tap this card to add the student',
    );
  });

  // A red panel repeating the name and the time reads like a failure. It is
  // not one: the student is counted, and tapping again will not help.
  it('tells a repeat tap it already counted', () => {
    const panel = renderPanel({
      feedback: 'duplicate',
      lastPerson: person,
      lastScannedAt: '2026-09-06T15:04:00.000Z',
      lastUid: '04A1B2C3D4E5F6',
    });

    expect(panel.textContent).toContain('Already counted at 11:04 AM');
    expect(panel.textContent).toContain('no need to tap again');
  });

  // Enrolling leaves the station in Enroll mode, where every following tap
  // opens a form instead of recording attendance.
  it('sends the operator back to Check-in after an enrollment', () => {
    const panel = renderPanel({
      feedback: 'enrolled',
      mode: 'enroll',
      lastPerson: person,
      lastUid: '04A1B2C3D4E5F6',
    });

    expect(panel.textContent).toContain(
      'switch to Check-in to record attendance',
    );
  });

  it('sends the operator back to Check-in after an edit', () => {
    const panel = renderPanel({
      feedback: 'updated',
      mode: 'enroll',
      lastPerson: person,
      lastUid: '04A1B2C3D4E5F6',
    });

    expect(panel.textContent).toContain(
      'switch to Check-in to record attendance',
    );
  });
});
