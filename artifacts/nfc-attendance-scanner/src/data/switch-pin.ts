import {
  getSwitchPinRequired,
  writeSwitchPinRequired,
} from '@/data/attendance-store';
import {
  hasOperatorPin,
  verifyOperatorPin,
  type PinVerification,
} from '@/data/operator-pin';

/**
 * "Require PIN to switch periods" (Design 09 §3), under the protection-toggle
 * rule. The rule is enforced here, by the callee, not by the screen that
 * calls it, which is the same pattern as the lock context's `setPinRequired`:
 *
 * - turning it ON needs no PIN, but it does need a PIN to exist. With no
 *   hash it would guard nothing, so `unset` comes back and nothing changes;
 * - turning it OFF needs the current PIN, verified through
 *   `verifyOperatorPin` (so the lockout is shared). Anything but `ok` changes
 *   nothing and the verdict is returned for the dialog to show. One case
 *   skips the check: the setting is on but there is no PIN at all. There is
 *   nothing to verify then, the setting is not being enforced (see
 *   `isSwitchPinEnforced`), and refusing would leave a switch no one could
 *   ever turn off.
 *
 * Logging is the caller's job, like the lock context's toggle, because only
 * the caller knows whether the change it asked for actually happened.
 */
export async function setSwitchPinRequired(
  required: boolean,
  pin?: string,
): Promise<PinVerification> {
  if (required) {
    if (!(await hasOperatorPin())) return { status: 'unset' };
  } else if (await hasOperatorPin()) {
    if (pin === undefined) {
      throw new Error('Turning off the PIN to switch periods needs the current PIN.');
    }
    const verdict = await verifyOperatorPin(pin);
    if (verdict.status !== 'ok') return verdict;
  }
  await writeSwitchPinRequired(required);
  return { status: 'ok' };
}

/**
 * Whether the scanner should ask for the PIN before switching periods: the
 * setting is on AND a PIN exists. The second half is the no-dead-end rule: a
 * device whose PIN hash has gone (a cleared or hand-edited settings row)
 * switches freely rather than asking for a PIN nobody could enter. It does
 * not depend on the teacher-PIN gate (`pin-required`): a teacher who turned
 * the dashboard gate off on their own device can still ask the kiosk to
 * guard the switch.
 */
export async function isSwitchPinEnforced(): Promise<boolean> {
  const [required, pinExists] = await Promise.all([
    getSwitchPinRequired(),
    hasOperatorPin(),
  ]);
  return required && pinExists;
}
