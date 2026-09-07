import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import type { Person } from '@/data/attendance-store';
import { RosterManager } from './RosterManager';

import '../index.css';

const longNamedPerson: Person = {
  id: 7,
  cardUid: '04ABCDEF123456',
  firstName: 'Alexandria',
  lastName: 'Montgomery-Wellington-Smythe',
  gradYear: 2027,
  email: 'alexandria.montgomery-wellington-smythe.2027@stjohnschs.org',
  enrolledAt: '2026-09-01T12:06:00.000Z',
};

function bounds(element: Element) {
  return element.getBoundingClientRect();
}

it('keeps long-name roster actions visible and the layout inside the viewport', async () => {
  const onRemove = vi.fn();
  const user = userEvent.setup();

  render(
    <RosterManager
      persons={[longNamedPerson]}
      onSave={vi.fn().mockResolvedValue(true)}
      isSaving={false}
      saveError={false}
      onRemove={onRemove}
    />,
  );

  const row = screen.getByTestId('row-person-7');
  const rosterContainer = screen.getByTestId('table-roster').parentElement;
  const actions = within(row).getByTestId('actions-person-7');
  const edit = within(actions).getByRole('button', {
    name: 'Edit Alexandria Montgomery-Wellington-Smythe',
  });
  const remove = within(actions).getByRole('button', {
    name: 'Remove Alexandria Montgomery-Wellington-Smythe',
  });

  expect(rosterContainer).not.toBeNull();

  const viewportWidth = document.documentElement.clientWidth;
  const pageWidth = Math.max(
    document.documentElement.scrollWidth,
    document.body.scrollWidth,
  );
  expect(pageWidth).toBeLessThanOrEqual(viewportWidth);
  expect(rosterContainer!.scrollWidth).toBeLessThanOrEqual(
    rosterContainer!.clientWidth,
  );

  const actionBounds = bounds(actions);
  const editBounds = bounds(edit);
  const removeBounds = bounds(remove);
  expect(actionBounds.right).toBeLessThanOrEqual(viewportWidth);
  expect(editBounds.width).toBeGreaterThan(0);
  expect(removeBounds.width).toBeGreaterThan(0);
  expect(editBounds.left).toBeGreaterThanOrEqual(actionBounds.left);
  expect(removeBounds.right).toBeLessThanOrEqual(actionBounds.right);

  const gap = removeBounds.left - editBounds.right;
  expect(gap).toBeCloseTo(parseFloat(getComputedStyle(actions).columnGap), 1);
  expect(gap).toBeGreaterThanOrEqual(7);

  await user.click(edit);
  expect(edit.getAttribute('aria-expanded')).toBe('true');

  await user.click(remove);
  expect(onRemove).toHaveBeenCalledWith(longNamedPerson);
});