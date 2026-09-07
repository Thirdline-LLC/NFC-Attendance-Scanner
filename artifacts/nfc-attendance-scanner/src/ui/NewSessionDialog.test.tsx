import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionMetrics } from '@/scanner/use-attendance-session';
import { NewSessionDialog } from './NewSessionDialog';

const metrics: SessionMetrics = {
  uniqueAttendance: 12,
  totalTaps: 15,
  duplicateTaps: 2,
  unknownCards: 1,
};

function renderDialog(overrides: Partial<SessionMetrics> = {}) {
  const onExport = vi.fn();
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <NewSessionDialog
      metrics={{ ...metrics, ...overrides }}
      onExport={onExport}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onExport, onConfirm, onCancel, unmount: view.unmount };
}

describe('NewSessionDialog', () => {
  afterEach(cleanup);

  it('states the session figures and what rotating costs', () => {
    renderDialog();

    const dialog = screen.getByTestId('dialog-new-session');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(
      dialog.getAttribute('aria-labelledby') ?? '',
    );
    expect(title?.textContent).toBe('Start a new session?');

    expect(screen.getByTestId('text-new-session-counts').textContent).toBe(
      'This session has 15 taps and 12 checked in.',
    );
    // The whole point of the confirmation: retained, but not visible here.
    expect(dialog.textContent).toContain('stay saved on this device');
    expect(dialog.textContent).toContain('no longer appear');
    expect(dialog.textContent).toContain('Export first');
  });

  it('counts a single tap in the singular', () => {
    renderDialog({ totalTaps: 1, uniqueAttendance: 1 });

    expect(screen.getByTestId('text-new-session-counts').textContent).toBe(
      'This session has 1 tap and 1 checked in.',
    );
  });

  it('moves focus into the dialog, onto the harmless button', () => {
    renderDialog();

    const dialog = screen.getByTestId('dialog-new-session');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByTestId('button-dialog-cancel'),
    );
  });

  it('scrolls instead of putting its buttons out of reach', () => {
    renderDialog();

    const overlay = screen.getByTestId('dialog-new-session');
    // jsdom lays nothing out; this is the contract the browser check rests on.
    // Auto margins centre the panel and collapse when the viewport is shorter
    // than it, so Cancel cannot end up below the fold of a kiosk in landscape.
    expect(overlay.className).toContain('overflow-y-auto');
    expect((overlay.firstElementChild as HTMLElement).className).toContain(
      'm-auto',
    );
  });

  it('gives the keyboard back to whatever had it when it closes', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const { unmount } = renderDialog();
    expect(document.activeElement).toBe(
      screen.getByTestId('button-dialog-cancel'),
    );

    unmount();

    // Whatever asked the question is usually the summary's "Start New Session"
    // button, inside an aria-modal dialog that is still open: dropping focus
    // on <body> there leaves the keyboard nowhere.
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('exports without closing, so the operator can then decide', async () => {
    const user = userEvent.setup();
    const { onExport, onConfirm, onCancel } = renderDialog();

    await user.click(screen.getByTestId('button-dialog-export'));

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dialog-new-session')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('confirms and cancels through their own buttons', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderDialog();

    await user.click(screen.getByTestId('button-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('button-dialog-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderDialog();

    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
