import { z } from 'zod';

export const ThemeColorsSchema = z.object({
  bg: z.string(),
  fg: z.string(),
  muted: z.string(),
  border: z.string(),
  accent: z.string(),
  accentFg: z.string(),
  success: z.string(),
  danger: z.string(),
  warning: z.string(),
  surface: z.string(),
  shadow: z.string(),
  /** Optional override for logo/mark background. */
  markBg: z.string().optional(),
  slate: z.string().optional(),
});

export const ThemeFontsSchema = z.object({
  heading: z.string(),
  body: z.string(),
  /** Google Fonts URL to inject when this theme is active. */
  googleFontsUrl: z.string().url().optional(),
});

export const ThemeAssetsSchema = z.object({
  /**
   * Either a data URI (`data:image/svg+xml;base64,...`) for packed packs,
   * or a relative path (`assets/logo-mark.svg`) in source manifests.
   */
  logoMark: z.string(),
  logoWordmark: z.string().optional(),
  favicon: z.string().optional(),
  splash: z.string().optional(),
});

export const ThemeCopySchema = z.object({
  appName: z.string(),
  shortName: z.string(),
  deskRoleLabel: z.string().optional(),
  teacherRoleLabel: z.string().optional(),
  checkInCta: z.string().optional(),
  enrollCta: z.string().optional(),
  endSessionCta: z.string().optional(),
  pinGateTitle: z.string().optional(),
  exportSchoolAccountNotice: z.string().optional(),
  emptyRosterHint: z.string().optional(),
  bodySubtitleHint: z.string().optional(),
  orgLabel: z.string().optional(),
  tagline: z.string().optional(),
});

export const ThemeLayoutSchema = z.object({
  density: z.enum(['compact', 'comfortable', 'spacious']).optional(),
  radius: z.enum(['none', 'sm', 'md', 'lg', 'full']).optional(),
  asymmetryHint: z.string().optional(),
});

export const ThemeBodyPresetSchema = z.object({
  id: z.string(),
  label: z.string(),
});

/**
 * Signature seam for future multi-school signing (D-T1).
 * Pilot packs ship unsigned — `sig: "UNSIGNED_DRAFT_FOR_REVIEW"` is accepted.
 * ed25519 verification is NOT implemented in this release.
 */
export const ThemeSignatureSchema = z.object({
  alg: z.literal('ed25519'),
  keyId: z.string(),
  sig: z.string(),
});

export const ThemePackSchema = z.object({
  v: z.literal(1),
  meta: z.object({
    id: z.string().min(1),
    orgName: z.string().min(1),
    packName: z.string().optional(),
    version: z.string(),
    minAppVersion: z.string().optional(),
    createdAt: z.string().optional(),
    notes: z.string().optional(),
    productName: z.string().optional(),
  }),
  fonts: ThemeFontsSchema,
  colors: ThemeColorsSchema,
  assets: ThemeAssetsSchema,
  copy: ThemeCopySchema,
  bodyTypePresets: z.array(ThemeBodyPresetSchema).optional(),
  layout: ThemeLayoutSchema.optional(),
  /**
   * Optional SHA-256 checksums keyed by asset path or data-URI identifier.
   * Format: `"assets/logo-mark.svg": "sha256:<hex>"`.
   * Seam for future verification; currently informational.
   */
  checksums: z.record(z.string(), z.string()).optional(),
  /**
   * Signature seam (D-T1). Placeholder / UNSIGNED packs are accepted for
   * the pilot. ed25519 verification is deferred until multi-school deploy.
   */
  signature: ThemeSignatureSchema.optional(),
});

export type ThemePack = z.infer<typeof ThemePackSchema>;
export type ThemeColors = z.infer<typeof ThemeColorsSchema>;
export type ThemeCopy = z.infer<typeof ThemeCopySchema>;
export type ThemeFonts = z.infer<typeof ThemeFontsSchema>;
export type ThemeLayout = z.infer<typeof ThemeLayoutSchema>;
export type ThemeBodyPreset = z.infer<typeof ThemeBodyPresetSchema>;

/** Fields forbidden in theme packs (FERPA/privacy). */
export const FORBIDDEN_THEME_FIELDS = [
  'members', 'students', 'roster',
  'emails', 'email',
  'uids', 'uid', 'cardUid',
  'taps', 'sessions',
  'pin', 'pinHash',
] as const;
