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

/**
 * Moves `target` aside, copies `staged` into its place, clears quarantine.
 *
 * Exit 4 means the installed bundle never moved, so the helper may retry
 * as administrator. Any other failure may have left the previous bundle
 * only in the backup path; that path is restored and not deleted.
 */
export function renderInPlaceSwapScript(): string {
  return `#!/bin/bash
# Tapin bundle swap. Local files only.
# Usage: swap.sh <target.app> <staged.app> <backup.app>
# Exit 4: target was not moved (safe to retry as administrator).
# Exit 1: partial swap. BACKUP may be the only previous app.
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

# Re-entry after mv succeeded, cp failed, and restoring BACKUP failed.
# BACKUP is the only good bundle. Put it back; never rm it first.
if [ -d "$BACKUP" ] && [ ! -d "$TARGET" ]; then
  mv "$BACKUP" "$TARGET" || exit 1
  exit 1
fi

# Leftover from a finished swap whose cleanup did not run. TARGET is the
# installed bundle, so BACKUP is not the only copy.
if [ -d "$BACKUP" ] && [ -d "$TARGET" ]; then
  rm -rf "$BACKUP"
fi

if ! mv "$TARGET" "$BACKUP"; then
  exit 4
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
status=0
/bin/bash "$SWAP" "$TARGET" "$STAGED" "$BACKUP" || status=$?
if [ "$status" -ne 0 ]; then
  log "user-swap-failed"
  # Elevate only when the initial mv failed and the installed bundle is
  # still in place. After a partial swap, BACKUP may be the only previous
  # app — do not run swap.sh again.
  if [ "$status" -eq 4 ]; then
    Q_SWAP=$(printf '%q' "$SWAP")
    Q_TARGET=$(printf '%q' "$TARGET")
    Q_STAGED=$(printf '%q' "$STAGED")
    Q_BACKUP=$(printf '%q' "$BACKUP")
    if ! osascript -e "do shell script \\"/bin/bash $Q_SWAP $Q_TARGET $Q_STAGED $Q_BACKUP\\" with administrator privileges"; then
      log "admin-swap-failed"
      open "$TARGET" >/dev/null 2>&1 || open "$BACKUP" >/dev/null 2>&1 || true
      exit 1
    fi
  else
    log "swap-incomplete"
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
