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
 * The previous bundle is removed only after the replacement is in place.
 * A re-run after a partial swap (move succeeded, copy failed, restore
 * failed) puts that bundle back and does not delete it while it is the
 * only remaining app.
 */
export function renderInPlaceSwapScript(): string {
  return `#!/bin/bash
# Tapin bundle swap. Local files only.
# Usage: swap.sh <target.app> <staged.app> <backup.app>
set -u
TARGET="$1"
STAGED="$2"
BACKUP="$3"
# Sibling of the backup, never inside it, so removing BACKUP cannot clear it.
MARKER="$BACKUP.incomplete"

case "$TARGET" in
  *.app) ;;
  *) exit 2 ;;
esac
case "$BACKUP" in
  *.app.tapin-previous) ;;
  *) exit 2 ;;
esac
if [ "$BACKUP" = "$TARGET" ]; then
  exit 2
fi
if [ ! -d "$STAGED" ]; then
  exit 3
fi

# Incomplete swap, or the previous bundle is all that is left: restore it
# before any delete. Covers admin re-entry after mv succeeded, cp failed,
# and mv BACKUP back onto TARGET also failed.
if [ -f "$MARKER" ] || { [ -d "$BACKUP" ] && [ ! -e "$TARGET" ]; }; then
  if [ -d "$BACKUP" ]; then
    if [ -e "$TARGET" ]; then
      rm -rf "$TARGET" || exit 1
      if [ -e "$TARGET" ]; then
        exit 1
      fi
    fi
    if ! mv "$BACKUP" "$TARGET"; then
      exit 1
    fi
  fi
  rm -f "$MARKER" || exit 1
fi

# A finished swap whose backup cleanup did not run. TARGET is the installed
# bundle, so BACKUP is not the only copy.
if [ -d "$BACKUP" ]; then
  if [ ! -d "$TARGET" ]; then
    mv "$BACKUP" "$TARGET" || exit 1
    exit 1
  fi
  rm -rf "$BACKUP" || exit 1
fi

if [ ! -d "$TARGET" ]; then
  exit 1
fi

touch "$MARKER" || exit 1
if ! mv "$TARGET" "$BACKUP"; then
  rm -f "$MARKER"
  exit 1
fi
if ! cp -R "$STAGED" "$TARGET"; then
  rm -rf "$TARGET"
  if [ -e "$TARGET" ]; then
    # Partial copy is still in the way. Leave BACKUP and the marker.
    exit 1
  fi
  if ! mv "$BACKUP" "$TARGET"; then
    exit 1
  fi
  rm -f "$MARKER"
  exit 1
fi
if [ ! -d "$TARGET" ]; then
  exit 1
fi
# Ad-hoc builds downloaded from GitHub are quarantined. Clearing the
# attribute lets the replaced bundle launch. Harmless on a notarized build.
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true
# Drop the marker before removing the previous bundle. A crash in between
# must not look like an incomplete swap whose only copy is already gone.
rm -f "$MARKER" || exit 1
rm -rf "$BACKUP" || exit 1
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
  # Same backup path as the failed attempt. swap.sh restores
  # .tapin-previous when that directory is the only remaining previous app
  # (move succeeded, copy failed, restore failed) and does not rm it first.
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
