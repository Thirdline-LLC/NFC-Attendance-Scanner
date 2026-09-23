export { ThemePackSchema, FORBIDDEN_THEME_FIELDS } from './schema';
export type {
  ThemePack,
  ThemeColors,
  ThemeCopy,
  ThemeFonts,
  ThemeLayout,
  ThemeBodyPreset,
} from './schema';

export { DEFAULT_THEME } from './default-theme';

export { loadThemePack } from './loader';
export type { LoadResult } from './loader';

export { applyThemeToDom, removeThemeFromDom } from './apply';

export {
  storeActiveTheme,
  readActiveThemeJson,
  clearActiveTheme,
  storeInstalledPack,
  readInstalledPack,
  removeInstalledPack,
  listInstalledPackIds,
  readActiveThemeId,
} from './storage';

export { verifyChecksums, scanForForbiddenFields } from './verify';
export type { ChecksumResult } from './verify';

export { colorToHslComponents, hexToHslComponents, adjustLightness, isLightColor } from './colors';
