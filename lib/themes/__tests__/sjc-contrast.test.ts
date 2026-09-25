import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(__dirname, '../orgs/tapin-sjc/manifest.json'), 'utf-8'),
) as { colors: Record<string, string> };

type Rgb = [number, number, number];

function hex(value: string): Rgb {
  const h = value.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` composited over `bg` — how `bg-[hsl(var(--primary)/.12)]` renders. */
function tint(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return fg.map((c, i) => alpha * c + (1 - alpha) * (bg[i] as number)) as Rgb;
}

// WCAG 2.x AA for normal-size text.
const AA = 4.5;

describe('tapin-sjc accent contrast (WCAG AA)', () => {
  const { accent, accentFg, bg, surface } = manifest.colors as Record<string, string>;
  const accentRgb = hex(accent!);

  it('primary button text (accentFg on accent) reaches AA', () => {
    expect(contrast(hex(accentFg!), accentRgb)).toBeGreaterThanOrEqual(AA);
  });

  it.each([
    ['surface', surface!],
    ['bg', bg!],
  ])('accent text on its 12%% tint over %s reaches AA', (_name, base) => {
    expect(contrast(accentRgb, tint(accentRgb, hex(base), 0.12))).toBeGreaterThanOrEqual(AA);
  });

  it.each([
    ['surface', surface!],
    ['bg', bg!],
  ])('accent text directly on %s reaches AA', (_name, base) => {
    expect(contrast(accentRgb, hex(base))).toBeGreaterThanOrEqual(AA);
  });
});
