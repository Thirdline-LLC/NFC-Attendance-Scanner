/**
 * Colour utilities for the theme system.
 *
 * The existing CSS uses `hsl(var(--<name>))` where `--<name>` holds only the
 * three HSL components without the `hsl()` wrapper, e.g. `210 30% 26%`.
 * These helpers convert the colour strings used in theme packs (hex, rgba,
 * hsl) into that bare-components format so the same CSS variables work.
 */

function rgbToHslComponents(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = d / (l > 0.5 ? 2 - max - min : max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Convert a hex colour (`#rrggbb` or `#rgb`) to HSL components.
 * Returns null if the input is not a valid hex colour.
 */
export function hexToHslComponents(hex: string): string | null {
  const m = hex.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;

  const raw = m[1];
  let r: number, g: number, b: number;
  if (raw.length === 3) {
    r = parseInt(raw[0] + raw[0], 16) / 255;
    g = parseInt(raw[1] + raw[1], 16) / 255;
    b = parseInt(raw[2] + raw[2], 16) / 255;
  } else {
    r = parseInt(raw.slice(0, 2), 16) / 255;
    g = parseInt(raw.slice(2, 4), 16) / 255;
    b = parseInt(raw.slice(4, 6), 16) / 255;
  }

  return rgbToHslComponents(r, g, b);
}

/**
 * Convert any supported colour format to HSL components string.
 *
 * Accepts: `#rrggbb`, `#rgb`, `rgb(r,g,b)`, `rgba(r,g,b,a)`,
 * `hsl(h s% l%)`, `hsl(h, s%, l%)`.
 *
 * Returns the input unchanged if no known format is recognised — the caller
 * is responsible for deciding whether that is safe to use.
 */
export function colorToHslComponents(color: string): string {
  const trimmed = color.trim();

  const hexResult = hexToHslComponents(trimmed);
  if (hexResult) return hexResult;

  const rgbaMatch = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbaMatch) {
    return rgbToHslComponents(
      parseInt(rgbaMatch[1]) / 255,
      parseInt(rgbaMatch[2]) / 255,
      parseInt(rgbaMatch[3]) / 255,
    );
  }

  const hslMatch = trimmed.match(/hsl\(\s*(\d+)\s+(\d+)%\s+(\d+)%\s*\)/);
  if (hslMatch) {
    return `${hslMatch[1]} ${hslMatch[2]}% ${hslMatch[3]}%`;
  }

  const hslCommaMatch = trimmed.match(/hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)/);
  if (hslCommaMatch) {
    return `${hslCommaMatch[1]} ${hslCommaMatch[2]}% ${hslCommaMatch[3]}%`;
  }

  return trimmed;
}

/** Parse HSL components string into `{ h, s, l }` numbers. */
function parseHslComponents(hsl: string): { h: number; s: number; l: number } | null {
  const m = hsl.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!m) return null;
  return { h: parseFloat(m[1]), s: parseFloat(m[2]), l: parseFloat(m[3]) };
}

/** Adjust the lightness of an HSL-components string by `delta` percentage points. */
export function adjustLightness(hslComponents: string, delta: number): string {
  const parsed = parseHslComponents(hslComponents);
  if (!parsed) return hslComponents;
  const clamped = Math.max(0, Math.min(100, parsed.l + delta));
  return `${parsed.h} ${parsed.s}% ${Math.round(clamped)}%`;
}

/** Return true when the colour appears to be a light shade (L > 60%). */
export function isLightColor(hslComponents: string): boolean {
  const parsed = parseHslComponents(hslComponents);
  return parsed ? parsed.l > 60 : false;
}
