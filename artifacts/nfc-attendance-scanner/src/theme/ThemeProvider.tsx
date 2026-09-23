import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_THEME,
  applyThemeToDom,
  clearActiveTheme,
  loadThemePack,
  readActiveThemeJson,
  removeThemeFromDom,
  storeActiveTheme,
  storeInstalledPack,
  type ThemePack,
} from '@workspace/themes';

export type ThemeState = {
  /** Currently active theme (default or installed). */
  active: ThemePack;
  /** True when the active theme is not the bundled default. */
  isCustom: boolean;
  /**
   * Non-null when the last install/load produced a teacher-visible banner
   * (corrupt pack → fell back to default; or checksum warning).
   */
  banner: string | null;
  /** Install a new pack from a JSON string. Returns an error string or null. */
  installPack: (json: string) => Promise<string | null>;
  /** Activate a previously installed pack by id. */
  activatePack: (id: string) => Promise<void>;
  /** Revert to the bundled default theme. */
  revertToDefault: () => void;
  /** Dismiss the teacher banner. */
  dismissBanner: () => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

const NULL_THEME_STATE: ThemeState = {
  active: DEFAULT_THEME,
  isCustom: false,
  banner: null,
  installPack: async () => null,
  activatePack: async () => {},
  revertToDefault: () => {},
  dismissBanner: () => {},
};

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  return ctx ?? NULL_THEME_STATE;
}

/**
 * Boot-time theme loader.
 *
 * Reads the active theme from localStorage, validates it, and applies CSS
 * variables to the document. Falls back to the bundled default on any error,
 * setting `banner` so the teacher sees a warning.
 *
 * IndexedDB (Dexie / student records) is never touched.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ThemePack>(DEFAULT_THEME);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    const stored = readActiveThemeJson();
    if (!stored) return;

    loadThemePack(stored).then((result) => {
      if (!result.ok) {
        setBanner(
          `Theme load failed — reverted to default. ${result.error}`,
        );
        return;
      }
      setActive(result.pack);
      applyThemeToDom(result.pack);
      if (result.warnings.length > 0) {
        setBanner(`Theme loaded with warnings: ${result.warnings.join(' ')}`);
      }
    });
  }, []);

  const installPack = useCallback(async (json: string): Promise<string | null> => {
    const result = await loadThemePack(json);
    if (!result.ok) return result.error;

    const { pack, warnings } = result;
    storeInstalledPack(pack.meta.id, json);
    storeActiveTheme(json);
    setActive(pack);
    applyThemeToDom(pack);
    setBanner(
      warnings.length > 0
        ? `Theme installed with warnings: ${warnings.join(' ')}`
        : null,
    );
    return null;
  }, []);

  const activatePack = useCallback(async (id: string): Promise<void> => {
    if (id === 'default') {
      clearActiveTheme();
      removeThemeFromDom();
      setActive(DEFAULT_THEME);
      setBanner(null);
      return;
    }
    const { readInstalledPack } = await import('@workspace/themes');
    const stored = readInstalledPack(id);
    if (!stored) return;

    const result = await loadThemePack(stored);
    if (!result.ok) {
      setBanner(`Cannot activate theme: ${result.error}`);
      return;
    }
    storeActiveTheme(stored);
    setActive(result.pack);
    applyThemeToDom(result.pack);
    setBanner(
      result.warnings.length > 0
        ? `Theme activated with warnings: ${result.warnings.join(' ')}`
        : null,
    );
  }, []);

  const revertToDefault = useCallback(() => {
    clearActiveTheme();
    removeThemeFromDom();
    setActive(DEFAULT_THEME);
    setBanner(null);
  }, []);

  const dismissBanner = useCallback(() => setBanner(null), []);

  const value = useMemo<ThemeState>(
    () => ({
      active,
      isCustom: active.meta.id !== 'default',
      banner,
      installPack,
      activatePack,
      revertToDefault,
      dismissBanner,
    }),
    [active, banner, installPack, activatePack, revertToDefault, dismissBanner],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
