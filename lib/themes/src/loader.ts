import { ThemePackSchema, type ThemePack } from './schema';
import { DEFAULT_THEME } from './default-theme';
import { verifyChecksums, scanForForbiddenFields } from './verify';

export type LoadResult =
  | { ok: true; pack: ThemePack; warnings: string[] }
  | { ok: false; error: string; fallback: ThemePack };

/**
 * Parse and validate a `.nfc-theme` JSON string.
 *
 * Behaviour:
 * - Corrupt JSON or Zod validation failure → `{ ok: false }` with fallback=DEFAULT_THEME.
 * - Forbidden fields (FERPA) → `{ ok: false }`.
 * - Optional checksum mismatch → warning in `{ ok: true, warnings }`, theme still applied.
 * - Missing/placeholder `signature.sig` → accepted (D-T1 pilot).
 * - ed25519 verification is NOT implemented; the signature field is a seam only.
 */
export async function loadThemePack(json: string): Promise<LoadResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {
      ok: false,
      error: 'Theme pack is not valid JSON.',
      fallback: DEFAULT_THEME,
    };
  }

  const forbidden = scanForForbiddenFields(raw);
  if (forbidden.length > 0) {
    return {
      ok: false,
      error: `Theme pack contains forbidden fields: ${forbidden.join(', ')}. Themes must not carry student records.`,
      fallback: DEFAULT_THEME,
    };
  }

  const result = ThemePackSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return {
      ok: false,
      error: `Theme pack failed validation: ${issues}`,
      fallback: DEFAULT_THEME,
    };
  }

  const pack = result.data;
  const warnings: string[] = [];

  const checkResult = await verifyChecksums(pack);
  if (!checkResult.ok) {
    warnings.push(
      `Checksum mismatch for: ${checkResult.failed.join(', ')}. Assets may have been modified.`,
    );
  }

  return { ok: true, pack, warnings };
}

export { DEFAULT_THEME };
