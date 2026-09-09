import { PIN_MAX_LENGTH } from '@/data/operator-pin';

/**
 * A person pauses before pressing Enter; a keyboard-wedge reader presses it
 * within about 10 ms of the last character. Anything faster than this is the
 * reader, and on a locked page the reader is typing into the PIN field.
 */
export const MIN_PAUSE_BEFORE_ENTER_MS = 100;

/** What a PIN field keeps of whatever was typed into it. */
export function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, PIN_MAX_LENGTH);
}

/** True when Enter arrived a human-length pause after the previous key. */
export function isHumanEnter(
  lastKeystrokeAt: number | null,
  enterAt: number,
): boolean {
  return (
    lastKeystrokeAt === null ||
    enterAt - lastKeystrokeAt >= MIN_PAUSE_BEFORE_ENTER_MS
  );
}
