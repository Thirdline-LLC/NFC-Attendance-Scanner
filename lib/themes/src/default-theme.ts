import type { ThemePack } from './schema';

/**
 * Bundled default theme — Thirdline navy palette.
 *
 * Used when no installed theme is active or when a corrupt pack causes
 * fail-closed behaviour. The CSS `:root` variables are already set to these
 * values, so activating the default theme simply removes any overrides.
 */
export const DEFAULT_THEME: Readonly<ThemePack> = {
  v: 1,
  meta: {
    id: 'default',
    orgName: 'Tapin',
    packName: 'Tapin Default',
    version: '1.0.0',
  },
  fonts: {
    heading: 'DM Sans',
    body: 'DM Sans',
  },
  colors: {
    bg: 'hsl(211 56% 12%)',
    fg: 'hsl(43 57% 94%)',
    muted: 'hsl(210 18% 68%)',
    border: 'hsl(210 30% 26%)',
    accent: 'hsl(42 92% 67%)',
    accentFg: 'hsl(211 56% 12%)',
    success: 'hsl(161 55% 65%)',
    danger: 'hsl(8 83% 70%)',
    warning: 'hsl(42 92% 67%)',
    surface: 'hsl(211 48% 16%)',
    shadow: '0 1px 3px rgba(0,0,0,0.35)',
  },
  assets: {
    logoMark: '',
  },
  copy: {
    appName: 'Tapin',
    shortName: 'Tapin',
    deskRoleLabel: 'Desk',
    teacherRoleLabel: 'Teacher PIN',
    checkInCta: 'Check-in',
    enrollCta: 'Enroll',
    endSessionCta: 'End Session',
    pinGateTitle: 'Enter the teacher PIN',
    exportSchoolAccountNotice: 'Send this file only to a school account.',
    emptyRosterHint:
      'Nobody is enrolled on this Tapin device yet — import a roster or enroll the first card.',
  },
  bodyTypePresets: [
    { id: 'club', label: 'Club' },
    { id: 'class', label: 'Class' },
    { id: 'faculty', label: 'Faculty' },
    { id: 'custom', label: 'Custom' },
  ],
};
