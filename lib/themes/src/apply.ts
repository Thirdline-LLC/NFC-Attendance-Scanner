import type { ThemePack } from './schema';
import {
  colorToHslComponents,
  adjustLightness,
  isLightColor,
} from './colors';

const FONT_LINK_ID = 'nfc-theme-fonts';
const STYLE_ID = 'nfc-theme-vars';

const RADIUS_MAP: Record<string, string> = {
  none: '0rem',
  sm: '0.375rem',
  md: '0.5rem',
  lg: '1rem',
  full: '9999px',
};

/**
 * Build a CSS `--var: value;` block for all theme tokens.
 *
 * Maps theme pack colour fields to the HSL-component CSS variables that the
 * existing Tailwind/CSS setup consumes (e.g. `--background: 210 17% 97%`).
 */
function buildCssVars(pack: ThemePack): string {
  const c = pack.colors;

  const bg = colorToHslComponents(c.bg);
  const fg = colorToHslComponents(c.fg);
  const border = colorToHslComponents(c.border);
  const accent = colorToHslComponents(c.accent);
  const accentFg = colorToHslComponents(c.accentFg);
  const surface = colorToHslComponents(c.surface);
  const danger = colorToHslComponents(c.danger);
  const success = colorToHslComponents(c.success);
  const mutedFg = colorToHslComponents(c.muted);

  const light = isLightColor(bg);
  const mutedBg = adjustLightness(bg, light ? -5 : 5);
  const secondary = adjustLightness(surface, light ? -3 : 3);

  const radius = pack.layout?.radius
    ? (RADIUS_MAP[pack.layout.radius] ?? '1rem')
    : '1rem';

  const bodyFamily = `'${pack.fonts.body}', system-ui, sans-serif`;
  const headingFamily = `'${pack.fonts.heading}', Georgia, serif`;

  const lines: string[] = [
    `  --background: ${bg};`,
    `  --foreground: ${fg};`,
    `  --border: ${border};`,
    `  --input: ${border};`,
    `  --ring: ${accent};`,
    `  --card: ${surface};`,
    `  --card-foreground: ${fg};`,
    `  --primary: ${accent};`,
    `  --primary-foreground: ${accentFg};`,
    `  --secondary: ${secondary};`,
    `  --secondary-foreground: ${fg};`,
    `  --muted: ${mutedBg};`,
    `  --muted-foreground: ${mutedFg};`,
    `  --accent: ${success};`,
    `  --accent-foreground: ${accentFg};`,
    `  --destructive: ${danger};`,
    `  --destructive-foreground: ${accentFg};`,
    `  --radius: ${radius};`,
    `  --app-font-sans: ${bodyFamily};`,
    `  --app-font-display: ${headingFamily};`,
    `  --theme-shadow: ${c.shadow};`,
  ];

  if (c.markBg) {
    lines.push(`  --theme-mark-bg: ${c.markBg};`);
  }

  if (pack.assets.logoMark) {
    lines.push(`  --theme-logo-mark: url("${pack.assets.logoMark}");`);
  }
  if (pack.assets.logoWordmark) {
    lines.push(`  --theme-logo-wordmark: url("${pack.assets.logoWordmark}");`);
  }

  return `:root {\n${lines.join('\n')}\n}`;
}

/**
 * Apply a theme pack to the browser document.
 *
 * - Injects (or updates) a `<style id="nfc-theme-vars">` element in `<head>`.
 * - Injects (or updates) a Google Fonts `<link>` when the pack provides one.
 * - Safe to call multiple times — always replaces the previous injection.
 */
export function applyThemeToDom(pack: ThemePack, doc: Document = document): void {
  const css = buildCssVars(pack);

  let styleEl = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = STYLE_ID;
    doc.head.appendChild(styleEl);
  }
  styleEl.textContent = css;

  let linkEl = doc.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
  if (pack.fonts.googleFontsUrl) {
    if (!linkEl) {
      linkEl = doc.createElement('link');
      linkEl.id = FONT_LINK_ID;
      linkEl.rel = 'stylesheet';
      doc.head.appendChild(linkEl);
    }
    linkEl.href = pack.fonts.googleFontsUrl;
  } else if (linkEl) {
    linkEl.remove();
  }
}

/**
 * Remove any active theme injection, restoring the CSS `:root` defaults.
 */
export function removeThemeFromDom(doc: Document = document): void {
  doc.getElementById(STYLE_ID)?.remove();
  doc.getElementById(FONT_LINK_ID)?.remove();
}
