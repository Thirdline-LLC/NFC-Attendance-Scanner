import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Person, TapRecord } from '@/data/attendance-store';
import { ExportDialog } from './ExportDialog';

// Noon in New York on Thursday, September 24, 2026.
const NOW = '2026-09-24T16:00:00.000Z';

const casey: Person = {
  id: 1,
  cardUid: '04000000000001',
  firstName: 'Casey',
  lastName: 'Clark',
  gradYear: 2028,
  email: 'casey.clark@example.com',
  enrolledAt: '2026-08-20T13:00:00.000Z',
};

const taps: TapRecord[] = [
  { id: 1, uid: casey.cardUid!, scannedAt: '2026-09-02T16:00:00.000Z', personId: 1, sessionId: 'a', counted: true },
  { id: 2, uid: casey.cardUid!, scannedAt: '2026-09-24T15:00:00.000Z', personId: 1, sessionId: 'b', counted: true },
];

function renderDialog(overrides: Partial<Parameters<typeof ExportDialog>[0]> = {}) {
  const onExport = vi.fn();
  const onCancel = vi.fn();
  render(
    <>
      <button type="button">Export</button>
      <ExportDialog
        bodyPath={['English 11', 'Period 3']}
        taps={taps}
        persons={[casey]}
        isWorking={false}
        onExport={onExport}
        onCancel={onCancel}
        now={NOW}
        {...overrides}
      />
    </>,
  );
  return { onExport, onCancel, dialog: screen.getByRole('dialog', { name: 'Export attendance' }) };
}

afterEach(cleanup);

describe('ExportDialog', () => {
  it('is a labelled modal that opens on This school year, with every preset as a labelled radio', () => {
    const { dialog } = renderDialog();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const group = within(dialog).getByRole('group', { name: /Range/ });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual([
      'Today',
      'Single day',
      'Last 7 days',
      'Past month',
      'Past year',
      'This school year',
      'All time',
      'Custom',
    ]);
    expect(within(dialog).getByRole('radio', { name: 'This school year' })).toHaveProperty('checked', true);
    expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: 'This school year' }));
    expect(screen.getByTestId('text-export-body').textContent).toBe('English 11 › Period 3');
  });

  it('previews what the file will hold, from the same metrics as the workbook', () => {
    renderDialog();
    expect(screen.getByTestId('text-export-range').textContent).toBe('Aug 1, 2026 – Sep 24, 2026');
    const counts = screen.getByTestId('list-export-counts');
    expect(within(counts).getAllByRole('definition').map((node) => node.textContent)).toEqual(['2', '2', '1']);
    expect(screen.getByTestId('text-export-filename').textContent).toBe(
      'English 11 - Period 3 - 2026-08-01 to 2026-09-24.xlsx',
    );
    // The range starts before the oldest tap (Sep 2): the caveat says so.
    expect(screen.getByTestId('text-export-retention').textContent).toContain('Sep 2, 2026');
  });

  it('mentions the Activity sheet only for All time', async () => {
    const user = userEvent.setup();
    const { dialog } = renderDialog();
    expect(dialog.textContent).not.toContain('Activity log');
    await user.click(within(dialog).getByRole('radio', { name: 'All time' }));
    expect(dialog.textContent).toContain('and the Activity log');
    expect(screen.getByTestId('text-export-filename').textContent).toBe('English 11 - Period 3 - All time.xlsx');
  });

  it('shows an empty state for a range with no taps', async () => {
    const user = userEvent.setup();
    const { dialog } = renderDialog();
    await user.click(within(dialog).getByRole('radio', { name: 'Single day' }));
    const day = within(dialog).getByLabelText('Day');
    await user.clear(day);
    await user.type(day, '2026-09-10');
    expect(screen.getByTestId('text-export-empty').textContent).toContain('No taps in this range');
    expect(screen.queryByTestId('list-export-counts')).toBeNull();
  });

  it('refuses a custom range that ends before it starts, and says why', async () => {
    const user = userEvent.setup();
    const { dialog, onExport } = renderDialog();
    await user.click(within(dialog).getByRole('radio', { name: 'Custom' }));
    const from = within(dialog).getByLabelText('From');
    const to = within(dialog).getByLabelText('To');
    await user.clear(from);
    await user.type(from, '2026-09-20');
    await user.clear(to);
    await user.type(to, '2026-09-01');

    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('The start date is after the end date.');
    expect(from.getAttribute('aria-invalid')).toBe('true');
    expect(from.getAttribute('aria-describedby')).toBe(error.id);
    const confirm = within(dialog).getByTestId('button-export-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(confirm);
    expect(onExport).not.toHaveBeenCalled();
  });

  it('exports the chosen range', async () => {
    const user = userEvent.setup();
    const { dialog, onExport } = renderDialog();
    await user.click(within(dialog).getByRole('radio', { name: 'Last 7 days' }));
    await user.click(within(dialog).getByRole('button', { name: 'Export workbook' }));
    expect(onExport).toHaveBeenCalledWith({ preset: 'last-7-days', from: '2026-09-18', to: '2026-09-24' });
  });

  it('closes on Escape and Cancel, but not while exporting', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    cleanup();

    const working = renderDialog({ isWorking: true });
    await user.keyboard('{Escape}');
    expect(working.onCancel).not.toHaveBeenCalled();
    expect(within(working.dialog).getByTestId('button-export-confirm').textContent).toBe('Exporting…');
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    const { dialog } = renderDialog();
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});
