import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceBody } from '@/data/attendance-store';
import { BodySwitcherDialog } from './BodySwitcherDialog';

const at = '2026-09-01T12:00:00.000Z';

/** English 11 with five periods (one archived, entered out of id order), plus a lone club. */
function seededBodies(): AttendanceBody[] {
  return [
    { id: 1, name: 'Chess', typeLabel: 'club', createdAt: at, parentId: null, sortOrder: 0 },
    { id: 2, name: 'English 11', typeLabel: 'class', createdAt: at, parentId: null, sortOrder: 1 },
    { id: 7, name: 'Period 7', typeLabel: 'period', createdAt: at, parentId: 2, sortOrder: 4 },
    { id: 3, name: 'Period 1', typeLabel: 'period', createdAt: at, parentId: 2, sortOrder: 0 },
    { id: 4, name: 'Period 3', typeLabel: 'period', createdAt: at, parentId: 2, sortOrder: 1 },
    { id: 5, name: 'Period 4', typeLabel: 'period', createdAt: at, parentId: 2, sortOrder: 2 },
    { id: 6, name: 'Period 6', typeLabel: 'period', createdAt: at, parentId: 2, sortOrder: 3 },
    {
      id: 8,
      name: 'Period 8',
      typeLabel: 'period',
      createdAt: at,
      parentId: 2,
      sortOrder: 5,
      archivedAt: at,
    },
  ];
}

function renderDialog(overrides: Partial<Parameters<typeof BodySwitcherDialog>[0]> = {}) {
  const props: Parameters<typeof BodySwitcherDialog>[0] = {
    bodies: seededBodies(),
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

describe('BodySwitcherDialog tree', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows a parent as "English 11 · 5 periods", not counting the archived one', () => {
    renderDialog();
    expect(screen.getByTestId('button-body-2').textContent).toContain('English 11 · 5 periods');
    expect(screen.getByTestId('text-body-children-2').textContent).toBe('· 5 periods');
    // A body with no children has no disclosure button.
    expect(screen.queryByTestId('button-toggle-body-1')).toBeNull();
  });

  it('lists the children indented under the parent in sortOrder', () => {
    renderDialog();
    const group = document.getElementById('body-children-2') as HTMLElement;
    const names = within(group)
      .getAllByRole('button')
      .filter((button) => button.dataset.testid?.startsWith('button-body-'))
      .map((button) => button.textContent?.split(' ·')[0]);
    expect(names).toEqual(['Period 1', 'Period 3', 'Period 4', 'Period 6', 'Period 7', 'Period 8']);
  });

  it('collapses and expands with aria-expanded and aria-controls', async () => {
    const user = userEvent.setup();
    renderDialog();
    const toggle = screen.getByTestId('button-toggle-body-2');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('body-children-2');
    expect(toggle.getAttribute('aria-label')).toBe('English 11: 5 periods');

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('body-children-2')?.hidden).toBe(true);
    expect(screen.queryByRole('button', { name: /Period 3/ })).toBeNull();

    // Keyboard: the toggle is a real button, so Enter reopens it.
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /Period 3/ })).toBeTruthy();
  });

  it('search shows matches flat, even inside a collapsed group', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByTestId('button-toggle-body-2'));
    await user.type(screen.getByTestId('input-body-search'), 'Period 4');

    const match = screen.getByTestId('button-body-5');
    expect(match.textContent).toContain('English 11 › Period 4');
    expect(screen.queryByTestId('button-toggle-body-2')).toBeNull();
  });

  it('selecting a child and restoring an archived one still work', async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    await user.click(screen.getByTestId('button-body-4'));
    expect(props.onSelect).toHaveBeenCalledWith(4);
    await user.click(screen.getByTestId('button-restore-body-8'));
    expect(props.onRestore).toHaveBeenCalledWith(8);
  });
});
