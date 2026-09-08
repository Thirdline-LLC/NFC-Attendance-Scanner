#!/usr/bin/env bash
# Render the PWA and macOS icons from branding/mark.svg.
#
#     bash branding/generate-app-icons.sh
#
# Companion to generate-icons.sh, which does the iOS and Android asset
# catalogues. This one writes:
#
#   public/icons/icon-192.png            PWA, any purpose
#   public/icons/icon-512.png            PWA, any purpose
#   public/icons/icon-maskable-512.png   PWA, maskable (mark inside the safe circle)
#   public/favicon.svg                   the mark itself, replacing the placeholder
#   electron/resources/icon.png          1024px source electron-builder turns into .icns
#
# Only rsvg-convert is required (librsvg2-bin on Debian/Ubuntu,
# `brew install librsvg` on macOS). Every size is rendered from a wrapper SVG
# rather than resampled from a bitmap, so nothing is ever scaled twice.
set -euo pipefail

cd "$(dirname "$0")/.."
MARK="branding/mark.svg"
NAVY='#0D1E30'   # --background, hsl(211 56% 12%) in src/index.css

[ -f "$MARK" ] || { echo "missing $MARK" >&2; exit 1; }
command -v rsvg-convert >/dev/null || {
  echo "rsvg-convert not found (apt: librsvg2-bin, brew: librsvg)" >&2
  exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# rsvg-convert refuses to follow an external <image xlink:href>, and does so
# silently: referencing mark.svg produced three icons that were nothing but a
# navy square. The mark's markup is therefore inlined into each wrapper.
mark_body() {
  # Everything between the opening <svg ...> tag and the closing </svg>. The
  # first ">" in the file closes that opening tag; no attribute contains one.
  awk 'BEGIN { RS = "\0" }
       {
         body = substr($0, index($0, ">") + 1)
         print substr(body, 1, index(body, "</svg>") - 1)
       }' "$MARK"
}

BODY="$(mark_body)"

# A 512-unit canvas of flat navy with the mark centred at `scale` of full size.
# 1.0 reproduces mark.svg's own framing; the maskable icon uses 0.62 so the
# whole mark sits inside the 40%-radius safe circle Android and Chrome mask to.
wrapper() {
  local scale="$1" out="$2" offset
  offset="$(awk -v s="$scale" 'BEGIN { printf "%.4f", 256 - 256 * s }')"
  cat > "$out" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="$NAVY"/>
  <g transform="translate($offset,$offset) scale($scale)">
$BODY
  </g>
</svg>
SVG
}

wrapper 1.00 "$TMP/plain.svg"
wrapper 0.62 "$TMP/maskable.svg"

mkdir -p public/icons electron/resources

rsvg-convert -w 192 -h 192 "$TMP/plain.svg"    -o public/icons/icon-192.png
rsvg-convert -w 512 -h 512 "$TMP/plain.svg"    -o public/icons/icon-512.png
rsvg-convert -w 512 -h 512 "$TMP/maskable.svg" -o public/icons/icon-maskable-512.png

# electron-builder turns a single square PNG of at least 512px into the .icns
# it needs; 1024 is the largest slice macOS asks for, so nothing is upscaled.
rsvg-convert -w 1024 -h 1024 "$TMP/plain.svg" -o electron/resources/icon.png

# The browser tab. The placeholder here was an orange square belonging to no
# part of this app.
cp "$MARK" public/favicon.svg

echo "app icons regenerated from $MARK"
