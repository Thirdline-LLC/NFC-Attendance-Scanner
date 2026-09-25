import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSwitchPinRequired, writeSetting } from './attendance-store';
import { setOperatorPin } from './operator-pin';
import { isSwitchPinEnforced, setSwitchPinRequired } from './switch-pin';

// A test-only PIN, set in fake-indexeddb.
const PIN = '2468';

describe('Require PIN to switch periods (Design 09 §3)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete('attendance-scanner-local');
  });

  it('is off by default, and anything but the literal "true" reads as off', async () => {
    expect(await getSwitchPinRequired()).toBe(false);
    await writeSetting('switch-pin-required', 'yes');
    expect(await getSwitchPinRequired()).toBe(false);
  });

  it('turns on without a PIN being typed, once a PIN exists', async () => {
    await setOperatorPin(PIN);
    expect(await setSwitchPinRequired(true)).toEqual({ status: 'ok' });
    expect(await getSwitchPinRequired()).toBe(true);
    expect(await isSwitchPinEnforced()).toBe(true);
  });

  it('refuses to turn on with no PIN on the device', async () => {
    expect(await setSwitchPinRequired(true)).toEqual({ status: 'unset' });
    expect(await getSwitchPinRequired()).toBe(false);
  });

  it('turns off only with the current PIN', async () => {
    await setOperatorPin(PIN);
    await setSwitchPinRequired(true);

    await expect(setSwitchPinRequired(false)).rejects.toThrow(/needs the current PIN/);
    expect((await setSwitchPinRequired(false, '1357')).status).toBe('wrong');
    expect(await getSwitchPinRequired()).toBe(true);

    expect(await setSwitchPinRequired(false, PIN)).toEqual({ status: 'ok' });
    expect(await getSwitchPinRequired()).toBe(false);
    expect(await isSwitchPinEnforced()).toBe(false);
  });

  it('is not enforced when the PIN hash is gone, and can then be turned off without one', async () => {
    // A hand-edited device: the setting says on, but there is no PIN at all.
    await writeSetting('switch-pin-required', 'true');
    expect(await isSwitchPinEnforced()).toBe(false);
    expect(await setSwitchPinRequired(false)).toEqual({ status: 'ok' });
    expect(await getSwitchPinRequired()).toBe(false);
  });

  it('does not depend on the teacher-PIN gate being on', async () => {
    await setOperatorPin(PIN);
    await writeSetting('pin-required', 'false');
    await setSwitchPinRequired(true);
    expect(await isSwitchPinEnforced()).toBe(true);
  });
});
