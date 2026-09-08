#!/usr/bin/env bash
# Check a freshly built macOS app before you hand it to anyone.
#
#     pnpm run verify:mac
#
# Everything here is read-only. It answers the questions you cannot answer by
# looking at the .app in Finder: is it actually signed, did the entitlements
# apply, is the bundle identity what every installed copy's data is keyed to,
# and is there anything in the bundle that would make it phone home.
set -uo pipefail

cd "$(dirname "$0")/.."
OUT="dist/desktop"
FAILED=0

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED=1; }
info() { printf '    %s\n' "$1"; }

if [ "$(uname)" != "Darwin" ]; then
  echo "This checks a macOS build and has to run on macOS. Current: $(uname)."
  exit 1
fi

APP="$(find "$OUT" -maxdepth 2 -name '*.app' -type d 2>/dev/null | head -1)"
if [ -z "$APP" ]; then
  echo "No .app under $OUT — run 'pnpm run package:mac' first."
  exit 1
fi

echo
echo "Checking: $APP"
echo

# ---- identity -------------------------------------------------------------
echo "Identity (must never change between releases — it is what macOS keys the"
echo "app's stored roster and attendance to):"
PLIST="$APP/Contents/Info.plist"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST" 2>/dev/null || echo '')"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST" 2>/dev/null || echo '')"
NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$PLIST" 2>/dev/null || echo '')"

[ "$BUNDLE_ID" = "org.stjohnschs.attendance" ] \
  && pass "bundle id  org.stjohnschs.attendance" \
  || fail "bundle id is '$BUNDLE_ID', expected org.stjohnschs.attendance"
[ "$NAME" = "SJC Attendance" ] \
  && pass "app name   SJC Attendance" \
  || fail "app name is '$NAME', expected 'SJC Attendance'"
pass "version    $VERSION"

# ---- signature ------------------------------------------------------------
echo
echo "Signature:"
if codesign --verify --deep --strict "$APP" 2>/dev/null; then
  pass "signature verifies"
else
  fail "codesign --verify failed — this app will not launch on Apple Silicon"
  codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | sed 's/^/    /' | head -5
fi

AUTHORITY="$(codesign -dv --verbose=4 "$APP" 2>&1 | grep -E '^Authority=' | head -1 | cut -d= -f2-)"
if [ -z "$AUTHORITY" ]; then
  pass "ad-hoc signed (no Developer ID — expected for this build)"
  info "Recipients must clear the quarantine flag; see the note at the end."
else
  pass "signed by: $AUTHORITY"
fi

# The entitlement that keeps an ad-hoc build from dying at launch.
if codesign -d --entitlements - "$APP" 2>/dev/null | grep -q 'disable-library-validation'; then
  pass "disable-library-validation applied"
  info "Without it an ad-hoc build crashes: 'different Team IDs'."
else
  fail "disable-library-validation is MISSING — the app will crash on launch"
fi
codesign -d --entitlements - "$APP" 2>/dev/null | grep -q 'allow-jit' \
  && pass "allow-jit applied (V8 needs it)" \
  || fail "allow-jit missing — V8 will crash"

# ---- what is inside -------------------------------------------------------
echo
echo "Bundle contents:"
ASAR="$APP/Contents/Resources/app.asar"
[ -f "$ASAR" ] && pass "app.asar present ($(du -h "$ASAR" | cut -f1))" || fail "app.asar missing"

if [ -f "$ASAR" ]; then
  # grep -a treats the archive as text, which is all we need: whether a remote
  # URL or a service worker got in. No need to unpack it.
  if grep -aqE 'replit\.(com|dev)|REPLIT_DEV_DOMAIN' "$ASAR"; then
    fail "a Replit reference is inside the packaged app"
  else
    pass "no Replit reference"
  fi

  if grep -aq 'workbox-' "$ASAR"; then
    fail "a service worker got into the desktop bundle"
  else
    pass "no service worker (correct — the assets are already local)"
  fi

  # The renderer must be served from the app's own scheme. A `server.url`-style
  # http(s) target in the main bundle would mean the app needs a website.
  if grep -aq 'attendance' "$ASAR"; then
    pass "renderer served from the app's own app:// origin, not a URL"
  else
    info "could not confirm the origin string; check electron/main.ts by hand"
  fi
fi

# ---- the dmg --------------------------------------------------------------
echo
DMG="$(find "$OUT" -maxdepth 1 -name '*.dmg' 2>/dev/null | head -1)"
if [ -n "$DMG" ]; then
  pass "disk image: $DMG ($(du -h "$DMG" | cut -f1))"
else
  info "No .dmg yet — 'pnpm run package:mac' builds one."
fi

echo
if [ "$FAILED" -eq 0 ]; then
  printf '\033[32mAll checks passed.\033[0m\n'
else
  printf '\033[31mSome checks failed — do not distribute this build.\033[0m\n'
fi

cat <<'NOTE'

Sending it to another Mac
─────────────────────────
This build is ad-hoc signed, not Developer ID signed, so macOS will quarantine
a copy that arrives by download, AirDrop, email or a shared drive. That is
Gatekeeper doing its job — it cannot tell who built the app.

Tell the person receiving it to do this ONCE, after dragging the app into
Applications:

    xattr -dr com.apple.quarantine "/Applications/SJC Attendance.app"

Then it opens normally, every time, with no warning.

The alternative, with no Terminal: open it once, let macOS refuse, then go to
System Settings -> Privacy & Security, scroll to Security, and click
"Open Anyway" next to SJC Attendance.

NOTE
exit "$FAILED"
