import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type InertState = {
  count: number;
  wasInert: boolean;
};

const inertStates = new WeakMap<HTMLElement, InertState>();

function setBackgroundInert(dialog: HTMLElement): () => void {
  const backgroundElements: HTMLElement[] = [];
  let branch: HTMLElement | null = dialog;

  while (branch?.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (!(sibling instanceof HTMLElement) || sibling === branch) continue;

      const state = inertStates.get(sibling);
      if (state) {
        state.count += 1;
      } else {
        inertStates.set(sibling, { count: 1, wasInert: sibling.inert });
        sibling.inert = true;
      }
      backgroundElements.push(sibling);
    }

    branch = branch.parentElement;
  }

  return () => {
    for (const element of backgroundElements) {
      const state = inertStates.get(element);
      if (!state) continue;

      state.count -= 1;
      if (state.count === 0) {
        element.inert = state.wasInert;
        inertStates.delete(element);
      }
    }
  };
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.closest('[hidden]') === null &&
      getComputedStyle(element).display !== 'none' &&
      getComputedStyle(element).visibility !== 'hidden',
  );
}

/**
 * Keeps keyboard focus inside a mounted modal and makes the rest of the
 * document unreachable while it is active. Initial focus and restoration stay
 * with the dialog component because each flow has a different safest target.
 */
export function useModalFocusTrap(
  dialogRef: RefObject<HTMLElement | null>,
  active = true,
): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!active || !dialog) return;

    const restoreBackground = setBackgroundInert(dialog);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const focused = document.activeElement;

      if (event.shiftKey && (focused === first || !dialog.contains(focused))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focused === last || !dialog.contains(focused))) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && dialog.contains(event.target)) return;
      getFocusableElements(dialog)[0]?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      restoreBackground();
    };
  }, [active, dialogRef]);
}