/**
 * Teacher-confirmed macOS update progress.
 *
 * The Dashboard prints `label` for the phases a teacher sees. Transitions are
 * strict on purpose: an install cannot start without a check, and it cannot
 * jump from "Downloading" to "Relaunching" without "Installing". A checksum
 * or network failure lands on `error` and stays there until the next check.
 */

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'relaunching'
  | 'error';

export const UPDATE_PHASE_LABEL: Record<UpdatePhase, string> = {
  idle: '',
  checking: 'Checking for updates',
  'up-to-date': 'Up to date',
  available: 'Update available',
  downloading: 'Downloading',
  installing: 'Installing',
  relaunching: 'Relaunching',
  error: 'Update failed',
};

export type UpdateInstallState = {
  phase: UpdatePhase;
  label: string;
  message: string | null;
  latestVersion: string | null;
};

export type UpdateInstallEvent =
  | { type: 'check' }
  | { type: 'up-to-date' }
  | { type: 'available'; version: string }
  /** Checked, but there is nothing to install (web shell, no asset, default theme). */
  | { type: 'settled' }
  | { type: 'confirm' }
  | { type: 'installing' }
  | { type: 'relaunching' }
  | { type: 'failed'; message: string }
  | { type: 'reset' };

const BUSY: ReadonlySet<UpdatePhase> = new Set(['downloading', 'installing', 'relaunching']);

export function initialUpdateInstallState(): UpdateInstallState {
  return { phase: 'idle', label: UPDATE_PHASE_LABEL.idle, message: null, latestVersion: null };
}

function move(
  state: UpdateInstallState,
  phase: UpdatePhase,
  patch: { message?: string | null; latestVersion?: string | null } = {},
): UpdateInstallState {
  return {
    phase,
    label: UPDATE_PHASE_LABEL[phase],
    message: patch.message ?? null,
    latestVersion:
      patch.latestVersion !== undefined ? patch.latestVersion : state.latestVersion,
  };
}

export function reduceUpdateInstall(
  state: UpdateInstallState,
  event: UpdateInstallEvent,
): UpdateInstallState {
  switch (event.type) {
    case 'check':
      if (BUSY.has(state.phase)) return state;
      return move(state, 'checking', { message: null, latestVersion: null });

    case 'up-to-date':
      if (state.phase !== 'checking') return state;
      return move(state, 'up-to-date');

    case 'available':
      if (state.phase !== 'checking') return state;
      return move(state, 'available', { latestVersion: event.version });

    case 'settled':
      if (state.phase !== 'checking') return state;
      return move(state, 'idle');

    case 'confirm':
      // `error` is included so a failed download can be retried without
      // another metadata check. The card only sends this after the teacher
      // has already been shown an available update.
      if (state.phase !== 'available' && state.phase !== 'error') return state;
      return move(state, 'downloading');

    case 'installing':
      if (state.phase !== 'downloading') return state;
      return move(state, 'installing');

    case 'relaunching':
      if (state.phase !== 'installing') return state;
      return move(state, 'relaunching');

    case 'failed':
      // A finished "up to date" check is not a failure, and there is nothing
      // to fail before a check has started.
      if (state.phase === 'idle' || state.phase === 'up-to-date') return state;
      return move(state, 'error', { message: event.message });

    case 'reset':
      if (BUSY.has(state.phase)) return state;
      return initialUpdateInstallState();

    default:
      return state;
  }
}
