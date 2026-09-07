#!/usr/bin/env bash
# Regenerate every native app icon and splash image from branding/mark.svg.
#
# Run from artifacts/nfc-attendance-scanner after `cap add ios` / `cap add
# android` have created the platform folders:
#
#     bash branding/generate-icons.sh
#
# It writes only into the two generated asset catalogues, overwriting
# Capacitor's placeholders in place. It adds no files and changes no
# Contents.json / mipmap XML, so the catalogues stay exactly the shape Xcode
# and Android Studio expect.
#
# Why a shell script and not @capacitor/assets: ImageMagick 7 with a librsvg
# delegate is already in this container, and every size below is a one-line
# render. See docs/capacitor-native.md for the full reasoning.
set -euo pipefail

cd "$(dirname "$0")/.."
MARK="branding/mark.svg"
NAVY='#0D1E30'   # --background, hsl(211 56% 12%) in src/index.css
[ -f "$MARK" ] || { echo "missing $MARK" >&2; exit 1; }
command -v magick >/dev/null || { echo "ImageMagick 7 (magick) not found" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# render <pixels> -> a transparent PNG of the whole 512pt design box, in which
# the mark itself is 62% of the height and centred.
render() { magick -depth 8 -background none "$MARK" -resize "${1}x${1}" "$TMP/mark-$1.png"; }

# ---- iOS ---------------------------------------------------------------
IOS_ICON=ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
IOS_SPLASH_DIR=ios/App/App/Assets.xcassets/Splash.imageset
if [ -d "$(dirname "$IOS_ICON")" ]; then
  # 1024x1024, fully opaque: the App Store rejects an icon with an alpha
  # channel, and iOS applies its own corner mask, so no rounding here.
  render 1024
  magick -depth 8 -size 1024x1024 "xc:$NAVY" "$TMP/mark-1024.png" -gravity center -composite \
    -alpha remove -alpha off "$IOS_ICON"
fi
if [ -d "$IOS_SPLASH_DIR" ]; then
  render 970   # 0.355 * 2732: the mark reads as a logo, not a wall of gold
  magick -depth 8 -size 2732x2732 "xc:$NAVY" "$TMP/mark-970.png" -gravity center -composite \
    -alpha remove -alpha off "$TMP/splash.png"
  for f in splash-2732x2732.png splash-2732x2732-1.png splash-2732x2732-2.png; do
    [ -f "$IOS_SPLASH_DIR/$f" ] && cp "$TMP/splash.png" "$IOS_SPLASH_DIR/$f"
  done
fi

# ---- Android -----------------------------------------------------------
RES=android/app/src/main/res
if [ -d "$RES" ]; then
  # The adaptive icon's background is a flat colour resource, not a bitmap.
  cat > "$RES/values/ic_launcher_background.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">$NAVY</color>
</resources>
XML

  # Adaptive foreground: 108dp canvas of which only the middle 66dp is safe
  # from every launcher's mask. At 0.88 the mark's farthest point sits ~27% of
  # the canvas from centre, inside the 33% safe radius.
  for d in mdpi:108 hdpi:162 xhdpi:216 xxhdpi:324 xxxhdpi:432; do
    dens=${d%%:*}; px=${d##*:}
    out="$RES/mipmap-$dens/ic_launcher_foreground.png"
    [ -f "$out" ] || continue
    inner=$(( px * 88 / 100 ))
    render "$inner"
    magick -depth 8 -size "${px}x${px}" xc:none "$TMP/mark-$inner.png" -gravity center -composite "$out"
  done

  # Legacy icons, for launchers older than adaptive support. These are drawn
  # unmasked, so they carry their own shape on a transparent field.
  for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
    dens=${d%%:*}; px=${d##*:}
    sq="$RES/mipmap-$dens/ic_launcher.png"
    rd="$RES/mipmap-$dens/ic_launcher_round.png"
    inset=$(( px * 4 / 100 ))
    edge=$(( px - inset ))
    radius=$(( px * 22 / 100 ))
    mark_sq=$(( px * 86 / 100 ))
    mark_rd=$(( px * 80 / 100 ))
    if [ -f "$sq" ]; then
      render "$mark_sq"
      magick -depth 8 -size "${px}x${px}" xc:none -fill "$NAVY" \
        -draw "roundrectangle $inset,$inset $edge,$edge $radius,$radius" \
        "$TMP/mark-$mark_sq.png" -gravity center -composite "$sq"
    fi
    if [ -f "$rd" ]; then
      render "$mark_rd"
      c=$(( px / 2 ))
      magick -depth 8 -size "${px}x${px}" xc:none -fill "$NAVY" \
        -draw "circle $c,$c $c,$inset" \
        "$TMP/mark-$mark_rd.png" -gravity center -composite "$rd"
    fi
  done

  # Splash bitmaps. styles.xml sets these as the launch window background, so
  # each density and orientation gets its own file at its own aspect ratio.
  while read -r dir w h; do
    out="$RES/$dir/splash.png"
    [ -f "$out" ] || continue
    short=$(( w < h ? w : h ))
    m=$(( short * 355 / 1000 ))
    render "$m"
    magick -depth 8 -size "${w}x${h}" "xc:$NAVY" "$TMP/mark-$m.png" -gravity center -composite \
      -alpha remove -alpha off "$out"
  done <<'SIZES'
drawable 480 320
drawable-land-mdpi 480 320
drawable-land-hdpi 800 480
drawable-land-xhdpi 1280 720
drawable-land-xxhdpi 1600 960
drawable-land-xxxhdpi 1920 1280
drawable-port-mdpi 320 480
drawable-port-hdpi 480 800
drawable-port-xhdpi 720 1280
drawable-port-xxhdpi 960 1600
drawable-port-xxxhdpi 1280 1920
SIZES
fi

echo "icons and splash images regenerated from $MARK"
