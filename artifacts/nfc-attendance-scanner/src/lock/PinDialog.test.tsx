import Dexie from 'dexie';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, storeActiveTheme, type ThemePack } from '@workspace/themes';
import * as attendanceStore from '@/data/attendance-store';
import * as operatorPin from '@/data/operator-pin';
import { setOperatorPin, verifyOperatorPin } from '@/data/operator-pin';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { PinDialog } from './PinDialog';

const DATABASE_NAME = 'attendance-scanner-local';

describe('PinDialog', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Dexie.delete(DATABASE_NAME);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('asks to set a PIN on a device that has none, twice, and records it', async () => {
    const onUnlocked = vi.fn();
    const record = vi.spyOn(attendanceStore, 'recordActivity').mockResolvedValue();
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={onUnlocked} onCancel={() => {}} />);

    expect((await screen.findByTestId('text-pin-title')).textContent).toBe(
      'Set a teacher PIN',
    );
    expect(screen.getByTestId('dialog-pin').textContent).toContain('no way to recover');

    await user.type(screen.getByTestId('input-pin'), '2468');
    await user.type(screen.getByTestId('input-pin-confirm'), '2469');
    await user.click(screen.getByTestId('button-pin-submit'));
    expect(screen.getByTestId('text-pin-error').textContent).toBe(
      'The PINs do not match.',
    );
    expect(onUnlocked).not.toHaveBeenCalled();

    await user.clear(screen.getByTestId('input-pin-confirm'));
    await user.type(screen.getByTestId('input-pin-confirm'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
    expect(onUnlocked).toHaveBeenCalledWith('set');
    expect(await verifyOperatorPin('2468')).toEqual({ status: 'ok' });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pin-set' }));
    expect(JSON.stringify(record.mock.calls[0][0])).not.toContain('2468');
  });

  it('unlocks with the right PIN and names a wrong one without saying which digits', async () => {
    await setOperatorPin('2468');
    const onUnlocked = vi.fn();
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={onUnlocked} onCancel={() => {}} />);

    expect((await screen.findByTestId('text-pin-title')).textContent).toBe(
      'Enter the teacher PIN',
    );
    expect(screen.queryByTestId('input-pin-confirm')).toBeNull();

    await user.type(screen.getByTestId('input-pin'), '0000');
    await user.click(screen.getByTestId('button-pin-submit'));
    expect((await screen.findByTestId('text-pin-error')).textContent).toBe(
      'That PIN is not right.',
    );
    expect((screen.getByTestId('input-pin') as HTMLInputElement).value).toBe('');

    await user.type(screen.getByTestId('input-pin'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
  });

  it('counts down a lockout and refuses even the right PIN meanwhile', async () => {
    await setOperatorPin('2468');
    for (let miss = 0; miss < 5; miss += 1) await verifyOperatorPin('0000');
    const onUnlocked = vi.fn();
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={onUnlocked} onCancel={() => {}} />);

    await user.type(await screen.findByTestId('input-pin'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));

    const error = await screen.findByTestId('text-pin-error');
    expect(error.textContent).toMatch(/^Too many tries — wait \d+ seconds\.$/);
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it('ignores a card tapped into the field: digits only, at most eight, and no submit', async () => {
    await setOperatorPin('2468');
    const verify = vi.spyOn(operatorPin, 'verifyOperatorPin');
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={() => {}} onCancel={() => {}} />);

    const field = (await screen.findByTestId('input-pin')) as HTMLInputElement;
    await user.type(field, '04A1B2C3D4E5F6{Enter}');

    expect(field.value).toBe('04123456');
    expect(verify).not.toHaveBeenCalled();
    expect(screen.queryByTestId('text-pin-error')).toBeNull();
  });

  it('honours Enter after a human pause', async () => {
    await setOperatorPin('2468');
    // Only the clock is faked: faking the timers too would freeze
    // fake-indexeddb, which schedules its own work on them.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T20:00:00.000Z'));
    const onUnlocked = vi.fn();
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={onUnlocked} onCancel={() => {}} />);

    const field = await screen.findByTestId('input-pin');
    await user.type(field, '2468');
    await act(async () => {
      vi.setSystemTime(new Date('2026-09-15T20:00:00.150Z'));
    });
    await user.type(field, '{Enter}');

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
  });

  it('changes the PIN only with the current one, and records the change', async () => {
    await setOperatorPin('2468');
    const onChanged = vi.fn();
    const record = vi.spyOn(attendanceStore, 'recordActivity').mockResolvedValue();
    const user = userEvent.setup();
    render(<PinDialog mode="change" onChanged={onChanged} onCancel={() => {}} />);

    expect((await screen.findByTestId('text-pin-title')).textContent).toBe(
      'Change the teacher PIN',
    );
    await user.type(screen.getByTestId('input-pin-current'), '0000');
    await user.type(screen.getByTestId('input-pin'), '1357');
    await user.type(screen.getByTestId('input-pin-confirm'), '1357');
    await user.click(screen.getByTestId('button-pin-submit'));
    expect((await screen.findByTestId('text-pin-error')).textContent).toBe(
      'That PIN is not right.',
    );

    await user.type(screen.getByTestId('input-pin-current'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(await verifyOperatorPin('1357')).toEqual({ status: 'ok' });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'pin-changed' }),
    );
  });

  it('cancels on Escape and on the button', async () => {
    await setOperatorPin('2468');
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={() => {}} onCancel={onCancel} />);
    await screen.findByTestId('input-pin');

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('button-pin-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('says when the settings cannot be read, and retries', async () => {
    const has = vi
      .spyOn(operatorPin, 'hasOperatorPin')
      .mockRejectedValueOnce(new Error('closed'))
      .mockResolvedValueOnce(false);
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={() => {}} onCancel={() => {}} />);

    expect((await screen.findByTestId('text-pin-error')).textContent).toBe(
      "This device isn't letting the app read its settings.",
    );
    await user.click(screen.getByTestId('button-pin-retry'));
    expect((await screen.findByTestId('text-pin-title')).textContent).toBe(
      'Set a teacher PIN',
    );
    expect(has).toHaveBeenCalledTimes(2);
  });

  it('takes its gate title from the active theme, but a wrong PIN is still wrong', async () => {
    await setOperatorPin('2468');
    const pack: ThemePack = {
      ...DEFAULT_THEME,
      meta: { id: 'st-johns', orgName: "St. John's", version: '1.0.0' },
      copy: { ...DEFAULT_THEME.copy, pinGateTitle: 'Enter the club-operator PIN' },
    };
    storeActiveTheme(JSON.stringify(pack));

    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <PinDialog mode="gate" onUnlocked={() => {}} onCancel={() => {}} />
      </ThemeProvider>,
    );

    expect((await screen.findByTestId('text-pin-title')).textContent).toBe(
      'Enter the club-operator PIN',
    );

    await user.type(screen.getByTestId('input-pin'), '0000');
    await user.click(screen.getByTestId('button-pin-submit'));
    expect((await screen.findByTestId('text-pin-error')).textContent).toBe(
      'That PIN is not right.',
    );
  });

  it('takes the generic heading from the theme while no phase is known yet', async () => {
    const pack: ThemePack = {
      ...DEFAULT_THEME,
      meta: { id: 'st-johns', orgName: "St. John's", version: '1.0.0' },
      copy: { ...DEFAULT_THEME.copy, teacherRoleLabel: 'Club Operator PIN' },
    };
    storeActiveTheme(JSON.stringify(pack));
    vi.spyOn(operatorPin, 'hasOperatorPin').mockRejectedValueOnce(new Error('closed'));

    render(
      <ThemeProvider>
        <PinDialog mode="gate" onUnlocked={() => {}} onCancel={() => {}} />
      </ThemeProvider>,
    );

    expect((await screen.findByText('Club Operator PIN')).textContent).toBe(
      'Club Operator PIN',
    );
  });

  it('names the missing Web Crypto rather than crashing', async () => {
    vi.spyOn(operatorPin, 'hasOperatorPin').mockResolvedValue(false);
    vi.spyOn(operatorPin, 'setOperatorPin').mockRejectedValue(
      new operatorPin.PinUnavailableError(),
    );
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={() => {}} onCancel={() => {}} />);

    await user.type(await screen.findByTestId('input-pin'), '2468');
    await user.type(screen.getByTestId('input-pin-confirm'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));

    expect((await screen.findByTestId('text-pin-error')).textContent).toBe(
      'This device cannot secure a PIN — open the app from its installed or https address.',
    );
  });

  describe('verify mode when the PIN vanished before submit', () => {
    it('hands back to onPinMissing instead of turning into a set-PIN form', async () => {
      await setOperatorPin('2468');
      const onVerified = vi.fn();
      const onPinMissing = vi.fn();
      const user = userEvent.setup();
      render(
        <PinDialog
          mode="verify"
          verify={async () => ({ status: 'unset' })}
          onVerified={onVerified}
          onPinMissing={onPinMissing}
          onCancel={() => {}}
        />,
      );

      await user.type(await screen.findByTestId('input-pin'), '2468');
      await user.click(screen.getByTestId('button-pin-submit'));

      await waitFor(() => expect(onPinMissing).toHaveBeenCalledTimes(1));
      expect(onVerified).not.toHaveBeenCalled();
      expect(screen.queryByTestId('input-pin-confirm')).toBeNull();
    });

    it('without onPinMissing, shows a clear message and stays out of the set phase', async () => {
      await setOperatorPin('2468');
      const onVerified = vi.fn();
      const user = userEvent.setup();
      render(
        <PinDialog
          mode="verify"
          verify={async () => ({ status: 'unset' })}
          onVerified={onVerified}
          onCancel={() => {}}
        />,
      );

      await user.type(await screen.findByTestId('input-pin'), '2468');
      await user.click(screen.getByTestId('button-pin-submit'));

      expect((await screen.findByTestId('text-pin-error')).textContent).toMatch(
        /no teacher PIN on this device anymore/,
      );
      expect(screen.queryByTestId('input-pin-confirm')).toBeNull();
      expect(onVerified).not.toHaveBeenCalled();
    });
  });

  it('change mode with no PIN left falls back to setting one, then finishes with onChanged("set")', async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<PinDialog mode="change" onChanged={onChanged} onCancel={() => {}} />);

    await user.type(await screen.findByTestId('input-pin-current'), '2468');
    await user.type(screen.getByTestId('input-pin'), '1357');
    await user.type(screen.getByTestId('input-pin-confirm'), '1357');
    await user.click(screen.getByTestId('button-pin-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('text-pin-title').textContent).toBe('Set a teacher PIN'),
    );
    await user.type(screen.getByTestId('input-pin'), '1357');
    await user.type(screen.getByTestId('input-pin-confirm'), '1357');
    await user.click(screen.getByTestId('button-pin-submit'));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('set'));
    expect(await verifyOperatorPin('1357')).toEqual({ status: 'ok' });
  });

  it('reports "unlocked" when the gate verified an existing PIN', async () => {
    await setOperatorPin('2468');
    const onUnlocked = vi.fn();
    const user = userEvent.setup();
    render(<PinDialog mode="gate" onUnlocked={onUnlocked} onCancel={() => {}} />);
    await user.type(await screen.findByTestId('input-pin'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith('unlocked'));
  });

  it('change mode: a PIN set elsewhere during its set fallback goes back to the change form', async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<PinDialog mode="change" onChanged={onChanged} onCancel={() => {}} />);
    // No PIN to change, so the dialog falls back to setting one.
    await user.type(screen.getByTestId('input-pin-current'), '1111');
    await user.type(screen.getByTestId('input-pin'), '2468');
    await user.type(screen.getByTestId('input-pin-confirm'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('text-pin-title').textContent).toBe('Set a teacher PIN'),
    );

    await setOperatorPin('9753');
    await user.type(screen.getByTestId('input-pin'), '2468');
    await user.type(screen.getByTestId('input-pin-confirm'), '2468');
    await user.click(screen.getByTestId('button-pin-submit'));

    expect((await screen.findByTestId('text-pin-error')).textContent).toBe(
      'A teacher PIN was set on this device in the meantime. Enter it to continue.',
    );
    expect(screen.getByTestId('text-pin-title').textContent).toBe('Change the teacher PIN');
    // The old current-PIN guess is cleared so the retry starts clean.
    expect((screen.getByTestId('input-pin-current') as HTMLInputElement).value).toBe('');
    expect(onChanged).not.toHaveBeenCalled();
    expect(await verifyOperatorPin('9753')).toEqual({ status: 'ok' });
  });
});
