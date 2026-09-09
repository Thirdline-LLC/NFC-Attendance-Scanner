import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetentionDialog } from './RetentionDialog';

afterEach(cleanup);

function renderDialog(overrides: Partial<Parameters<typeof RetentionDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <RetentionDialog
      title="Delete attendance before Aug 1, 2026?"
      cost="This deletes 300 taps across 12 sessions."
      isWorking={false}
      confirmLabel="Delete permanently"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

describe('RetentionDialog', () => {
  it('names what goes, says it cannot be undone, and starts on Cancel', () => {
    renderDialog();
    const dialog = screen.getByTestId('dialog-retention');
    expect(dialog.textContent).toContain('Delete attendance before Aug 1, 2026?');
    expect(dialog.textContent).toContain('Cannot be undone');
    expect(screen.getByTestId('text-retention-cost').textContent).toContain('300 taps');
    expect(document.activeElement).toBe(screen.getByTestId('button-retention-cancel'));
  });

  it('confirms and cancels, by button and by Escape', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderDialog();

    await user.click(screen.getByTestId('button-retention-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('button-retention-cancel'));
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('holds the confirm button while working and says when nothing was deleted', () => {
    renderDialog({ isWorking: true, failed: true });
    expect(screen.getByTestId('button-retention-confirm').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('text-retention-failed').textContent).toContain('Nothing was deleted');
  });
});
