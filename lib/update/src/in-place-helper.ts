/**
 * The shell helper that runs after the app has quit.
 *
 * The bundle is in use for as long as this process is alive, so the swap
 * cannot happen in-process. The main process writes these two scripts, spawns
 * the helper detached, then quits. The helper waits for that pid, moves the
 * old bundle aside, copies the staged one into its place, and relaunches.
 *
 * Nothing here talks to the network. Student data lives in Application
 * Support, not in the bundle, and is not mentioned.
 */

/** Moves `target` aside, copies `staged` into its place, clears quarantine. */
export function renderInPlaceSwapScript(): string {
  return `#!/bin/bash
# Tapin bundle swap. Local files only.
# Usage: swap.sh <target.app> <staged.app> <backup.app>
set -u
TARGET="$1"
STAGED="$2"
BACKUP="$3"

case "$TARGET" in
  *.app) ;;
  *) exit 2 ;;
esac
if [ ! -d "$STAGED" ]; then
  exit 3
fi

# Move aside first so a failed copy can be rolled back. rm -rf only removes
# the backup after the new bundle is in place, or a partial copy that did
# not finish.
rm -rf "$BACKUP"
if ! mv "$TARGET" "$BACKUP"; then
  exit 1
fi
if ! cp -R "$STAGED" "$TARGET"; then
  rm -rf "$TARGET"
  mv "$BACKUP" "$TARGET" || exit 1
  exit 1
fi
# Ad-hoc builds downloaded from GitHub are quarantined. Clearing the
# attribute lets the replaced bundle launch. Harmless on a notarized build.
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true
rm -rf "$BACKUP"
exit 0
`;
}

/**
 * Waits for the app pid, runs the swap as the current user, and — if
 * `/Applications` is not writable — asks macOS for an administrator password
 * once. Then opens the new bundle.
 */
export function renderInPlaceHelperScript(): string {
  return `#!/bin/bash
# Tapin in-place relaunch. Local files only — no network, no student data.
# Usage: replace.sh <pid> <target.app> <staged.app> <log> <swap.sh>
set -u
PID="$1"
TARGET="$2"
STAGED="$3"
LOG="$4"
SWAP="$5"

log() { printf '%s\\n' "$1" >> "$LOG"; }

case "$TARGET" in
  *.app) ;;
  *) log "bad-target"; exit 2 ;;
esac
case "$STAGED" in
  ""|/) log "bad-staged"; exit 2 ;;
esac
if [ ! -d "$STAGED" ] || [ ! -f "$SWAP" ]; then
  log "staged-missing"
  exit 3
fi

i=0
while [ "$i" -lt 120 ]; do
  if ! kill -0 "$PID" 2>/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 0.25
done
if kill -0 "$PID" 2>/dev/null; then
  log "still-running"
  exit 1
fi

BACKUP="\${TARGET}.tapin-previous"
if ! /bin/bash "$SWAP" "$TARGET" "$STAGED" "$BACKUP"; then
  log "user-swap-failed"
  # Standard accounts cannot write /Applications. One local password prompt.
  Q_SWAP=$(printf '%q' "$SWAP")
  Q_TARGET=$(printf '%q' "$TARGET")
  Q_STAGED=$(printf '%q' "$STAGED")
  Q_BACKUP=$(printf '%q' "$BACKUP")
  if ! osascript -e "do shell script \\"/bin/bash $Q_SWAP $Q_TARGET $Q_STAGED $Q_BACKUP\\" with administrator privileges"; then
    log "admin-swap-failed"
    open "$TARGET" >/dev/null 2>&1 || open "$BACKUP" >/dev/null 2>&1 || true
    exit 1
  fi
fi

# Only the directory this run created (tapin-update-…) may be removed.
# dirname of a path we did not stage — /Applications, /, /tmp — is left alone.
STAGED_PARENT=$(dirname "$STAGED")
case "$STAGED_PARENT" in
  *tapin-update-*) rm -rf "$STAGED_PARENT" ;;
  *) log "skip-cleanup" ;;
esac
open "$TARGET"
log "relaunched"
`;
}
