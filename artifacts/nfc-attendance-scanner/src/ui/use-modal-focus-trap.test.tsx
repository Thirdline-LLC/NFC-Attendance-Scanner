import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { useModalFocusTrap } from '@/ui/use-modal-focus-trap';

function TestDialog() {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(dialogRef);

  return (
    <main>
      <button type="button">Background action</button>
      <div ref={dialogRef} role="dialog" aria-modal="true">
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </div>
    </main>
  );
}

describe('useModalFocusTrap', () => {
  it('wraps Tab and Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TestDialog />);

    const first = screen.getByRole('button', { name: 'First action' });
    const last = screen.getByRole('button', { name: 'Last action' });

    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    unmount();
  });

  it('makes background siblings inert while mounted and restores them', () => {
    const { unmount } = render(<TestDialog />);
    const background = screen.getByRole('button', { name: 'Background action' });

    expect(background).toHaveProperty('inert', true);
    unmount();
    expect(background.inert).not.toBe(true);
  });
});