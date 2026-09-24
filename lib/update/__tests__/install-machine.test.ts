import { describe, expect, it } from 'vitest';
import {
  initialUpdateInstallState,
  reduceUpdateInstall,
  type UpdateInstallState,
} from '../src/install-machine';

function apply(
  events: Parameters<typeof reduceUpdateInstall>[1][],
  start: UpdateInstallState = initialUpdateInstallState(),
): UpdateInstallState {
  return events.reduce(reduceUpdateInstall, start);
}

describe('update install state machine', () => {
  it('labels the check as "Checking for updates"', () => {
    const state = reduceUpdateInstall(initialUpdateInstallState(), { type: 'check' });
    expect(state.phase).toBe('checking');
    expect(state.label).toBe('Checking for updates');
  });

  it('labels a current install "Up to date"', () => {
    const state = apply([{ type: 'check' }, { type: 'up-to-date' }]);
    expect(state.phase).toBe('up-to-date');
    expect(state.label).toBe('Up to date');
  });

  it('walks Downloading → Installing → Relaunching only after the teacher confirms', () => {
    const available = apply([
      { type: 'check' },
      { type: 'available', version: '1.0.1' },
    ]);
    expect(available.phase).toBe('available');
    expect(available.latestVersion).toBe('1.0.1');
    expect(available.label).toBe('Update available');

    const downloading = reduceUpdateInstall(available, { type: 'confirm' });
    expect(downloading.label).toBe('Downloading');

    const installing = reduceUpdateInstall(downloading, { type: 'installing' });
    expect(installing.label).toBe('Installing');

    const relaunching = reduceUpdateInstall(installing, { type: 'relaunching' });
    expect(relaunching.label).toBe('Relaunching');
    expect(relaunching.latestVersion).toBe('1.0.1');
  });

  it('refuses to install, or to skip Installing, before a confirmed download', () => {
    const idle = initialUpdateInstallState();
    expect(reduceUpdateInstall(idle, { type: 'installing' })).toBe(idle);
    expect(reduceUpdateInstall(idle, { type: 'confirm' })).toBe(idle);
    expect(reduceUpdateInstall(idle, { type: 'relaunching' })).toBe(idle);

    const available = apply([
      { type: 'check' },
      { type: 'available', version: '1.0.1' },
    ]);
    expect(reduceUpdateInstall(available, { type: 'installing' })).toBe(available);
    expect(reduceUpdateInstall(available, { type: 'relaunching' })).toBe(available);

    const downloading = reduceUpdateInstall(available, { type: 'confirm' });
    expect(reduceUpdateInstall(downloading, { type: 'relaunching' })).toBe(downloading);
  });

  it('stops on checksum failure and will not continue into Installing', () => {
    const downloading = apply([
      { type: 'check' },
      { type: 'available', version: '1.0.1' },
      { type: 'confirm' },
    ]);
    const failed = reduceUpdateInstall(downloading, {
      type: 'failed',
      message: 'The download did not match its published checksum. Nothing was installed.',
    });
    expect(failed.phase).toBe('error');
    expect(failed.label).toBe('Update failed');
    expect(failed.message).toMatch(/checksum/);
    expect(reduceUpdateInstall(failed, { type: 'installing' })).toBe(failed);
    expect(reduceUpdateInstall(failed, { type: 'relaunching' })).toBe(failed);

    const retried = reduceUpdateInstall(failed, { type: 'confirm' });
    expect(retried.phase).toBe('downloading');
    expect(retried.label).toBe('Downloading');
    expect(retried.latestVersion).toBe('1.0.1');
  });

  it('records a network failure during the check without leaving "checking"', () => {
    const checking = reduceUpdateInstall(initialUpdateInstallState(), { type: 'check' });
    const failed = reduceUpdateInstall(checking, {
      type: 'failed',
      message: 'Could not reach GitHub. Check the network connection.',
    });
    expect(failed.phase).toBe('error');
    expect(failed.message).toMatch(/Could not reach GitHub/);
  });

  it('does not interrupt an in-progress install with another check', () => {
    const downloading = apply([
      { type: 'check' },
      { type: 'available', version: '1.0.1' },
      { type: 'confirm' },
    ]);
    expect(reduceUpdateInstall(downloading, { type: 'check' })).toBe(downloading);
  });

  it('ignores "up to date" unless a check is in flight', () => {
    const idle = initialUpdateInstallState();
    expect(reduceUpdateInstall(idle, { type: 'up-to-date' })).toBe(idle);
  });
});
