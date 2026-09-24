import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceBody, BodyFieldDef } from '@/data/attendance-store';
import { ExportCancelledError } from '@/platform/desktop-bridge';
import { BodySwitcherDialog } from './BodySwitcherDialog';
import { ClassTemplateFollowUp } from './ClassSetupForm';

const at = '2026-09-01T12:00:00.000Z';
const club: AttendanceBody = { id: 1, name: 'Club', typeLabel: 'club', createdAt: at, parentId: null };

function renderDialog(overrides: Partial<Parameters<typeof BodySwitcherDialog>[0]> = {}) {
  const props: Parameters<typeof BodySwitcherDialog>[0] = {
    bodies: [club],
    activeBodyId: 1,
    isWorking: false,
    error: null,
    typeDefs: [],
    fieldDefs: [],
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onReparent: vi.fn(),
    onCreateClass: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
    onSaveCustomFields: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<BodySwitcherDialog {...props} />);
  return props;
}

function rowValues(): string[] {
  return screen
    .getAllByRole('textbox', { name: /^Name of / })
    .map((input) => (input as HTMLInputElement).value);
}

function previewRows(): string[] {
  return within(screen.getByTestId('preview-class-periods'))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '');
}

describe('Class with periods setup', () => {
  afterEach(() => {
    cleanup();
  });

  it('starts on Single body with the existing form unchanged', () => {
    renderDialog();
    expect(screen.getByTestId('button-add-mode-single').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('input-body-name')).toBeTruthy();
    expect(screen.getByTestId('button-body-create').textContent).toBe('Create and switch');
    expect(screen.queryByTestId('form-class-setup')).toBeNull();
  });

  it('the stepper adds and drops rows at the end without touching typed names', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByTestId('button-add-mode-class'));

    expect(screen.getByTestId('text-period-count').textContent).toBe('5');
    expect(rowValues()).toEqual(['Period 1', 'Period 2', 'Period 3', 'Period 4', 'Period 5']);

    const second = screen.getByRole('textbox', { name: 'Name of period 2' });
    await user.clear(second);
    await user.type(second, 'Period 3');
    await user.click(screen.getByTestId('button-period-count-down'));
    await user.click(screen.getByTestId('button-period-count-down'));
    expect(rowValues()).toEqual(['Period 1', 'Period 3', 'Period 3']);
    await user.click(screen.getByTestId('button-period-count-up'));
    expect(rowValues()).toEqual(['Period 1', 'Period 3', 'Period 3', 'Period 4']);
    expect(screen.getByTestId('text-period-count').textContent).toBe('4');
  });

  it('the stepper stops at 1 and 10', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByTestId('button-add-mode-class'));
    for (let i = 0; i < 6; i += 1) await user.click(screen.getByTestId('button-period-count-up'));
    expect(screen.getByTestId('text-period-count').textContent).toBe('10');
    expect(screen.getByTestId('button-period-count-up')).toHaveProperty('disabled', true);
    for (let i = 0; i < 12; i += 1) {
      const down = screen.getByTestId('button-period-count-down') as HTMLButtonElement;
      if (down.disabled) break;
      await user.click(down);
    }
    expect(screen.getByTestId('text-period-count').textContent).toBe('1');
    expect(screen.getByTestId('button-period-count-down')).toHaveProperty('disabled', true);
  });

  it('previews the class with its rows in order, and blocks Create until valid', async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    await user.click(screen.getByTestId('button-add-mode-class'));
    const create = screen.getByTestId('button-class-create') as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    await user.type(screen.getByTestId('input-class-name'), 'English 11');
    expect(screen.getByTestId('preview-class-name').textContent).toBe('English 11 · class');
    expect(create.disabled).toBe(false);

    // Real bell periods, typed over the defaults.
    const bells = ['1', '3', '4', '6', '7'];
    for (const [index, bell] of bells.entries()) {
      const input = screen.getByTestId(`input-period-name-${index}`);
      await user.clear(input);
      await user.type(input, bell);
    }
    expect(previewRows()).toEqual(bells.map((bell) => `${bell} · period`));

    // A duplicate is flagged on its row and blocks Create.
    const last = screen.getByTestId('input-period-name-4');
    await user.clear(last);
    await user.type(last, '3');
    expect(screen.getByTestId('text-period-error-4').textContent).toBe(
      'Another row already has this name.',
    );
    expect(last.getAttribute('aria-invalid')).toBe('true');
    expect(create.disabled).toBe(true);

    // A blank row too.
    await user.clear(last);
    expect(screen.getByTestId('text-period-error-4').textContent).toBe('Give this row a name.');
    expect(create.disabled).toBe(true);
    await user.type(last, '7');

    const childLabel = screen.getByTestId('input-period-type-label');
    await user.clear(childLabel);
    await user.type(childLabel, 'section');
    expect(previewRows()[0]).toBe('1 · section');
    expect(create.textContent).toBe('Create class and 5 sections');

    await user.click(create);
    expect(props.onCreateClass).toHaveBeenCalledWith({
      className: 'English 11',
      parentTypeLabel: 'class',
      childTypeLabel: 'section',
      periodNames: bells,
    });
  });

  it('says when a type label needs a custom field this form cannot fill', async () => {
    const user = userEvent.setup();
    const fieldDefs: BodyFieldDef[] = [
      { id: 1, label: 'Room', appliesToTypeLabel: 'period', required: true },
    ];
    renderDialog({ fieldDefs });
    await user.click(screen.getByTestId('button-add-mode-class'));
    await user.type(screen.getByTestId('input-class-name'), 'English 11');
    expect(screen.getByTestId('text-class-fields-blocked').textContent).toMatch(
      /Room is required for a period/,
    );
    expect(screen.getByTestId('button-class-create')).toHaveProperty('disabled', true);
  });
});

describe('Add students to each period', () => {
  afterEach(() => {
    cleanup();
  });

  const parent: AttendanceBody = {
    id: 2,
    name: 'English 11',
    typeLabel: 'class',
    createdAt: at,
    parentId: null,
  };
  const periods: AttendanceBody[] = [
    { id: 3, name: 'Period 1', typeLabel: 'period', createdAt: at, parentId: 2, sortOrder: 0 },
    { id: 4, name: 'Period 3', typeLabel: 'period', createdAt: at, parentId: 2, sortOrder: 1 },
  ];

  it('replaces the switcher with the template step and focuses its heading', () => {
    renderDialog({ classSetup: { parent, periods } });
    const heading = screen.getByRole('heading', { name: 'Add students to each period' });
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByTestId('input-body-search')).toBeNull();
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe(heading.id);
    const rows = within(screen.getByTestId('list-class-templates')).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Period 1'),
      expect.stringContaining('Period 3'),
    ]);
  });

  it('downloads a template pre-filled with that period, then offers Done', async () => {
    const user = userEvent.setup();
    const deliver = vi
      .fn()
      .mockResolvedValue({ filename: 'tapin-roster-template-period-3.xlsx', delivery: 'download' });
    const onDone = vi.fn();
    render(
      <ClassTemplateFollowUp parent={parent} periods={periods} onDone={onDone} deliverTemplate={deliver} />,
    );
    expect(screen.getByTestId('button-class-followup-done').textContent).toBe('Skip for now');

    await user.click(screen.getByRole('button', { name: 'Download template for Period 3' }));
    expect(deliver).toHaveBeenCalledWith(periods[1]);
    await waitFor(() =>
      expect(screen.getByTestId('text-class-template-4').textContent).toContain(
        'tapin-roster-template-period-3.xlsx',
      ),
    );
    expect(screen.getByTestId('text-class-template-3').textContent).toBe('');
    await user.click(screen.getByTestId('button-class-followup-done'));
    expect(screen.queryByText('Skip for now')).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a cancelled Save dialog reads as cancelled, not failed', async () => {
    const user = userEvent.setup();
    const deliver = vi.fn().mockRejectedValue(new ExportCancelledError());
    render(
      <ClassTemplateFollowUp parent={parent} periods={periods} onDone={vi.fn()} deliverTemplate={deliver} />,
    );
    await user.click(screen.getByTestId('button-class-template-3'));
    await waitFor(() =>
      expect(screen.getByTestId('text-class-template-3').textContent).toBe(
        'Cancelled. No file was written.',
      ),
    );
    expect(screen.getByTestId('button-class-followup-done').textContent).toBe('Skip for now');
  });

  it('Skip for now closes through onCancel', async () => {
    const user = userEvent.setup();
    const props = renderDialog({ classSetup: { parent, periods } });
    await user.click(screen.getByTestId('button-class-followup-done'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});
