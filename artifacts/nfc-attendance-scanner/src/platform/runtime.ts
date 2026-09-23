import { Capacitor } from '@capacitor/core';

/**
 * Which of the three shells this bundle was built for.
 *
 * Vite stamps `VITE_BUILD_TARGET` in at build time (see `vite.config.ts`), so
 * this is a constant the bundler can fold away rather than a runtime sniff.
 * Under vitest nothing stamps it, which reads as `web` — the default target.
 */
export type BuildTarget = 'web' | 'capacitor' | 'electron';

export function buildTarget(): BuildTarget {
  const declared = import.meta.env.VITE_BUILD_TARGET;
  return declared === 'capacitor' || declared === 'electron' ? declared : 'web';
}

/**
 * The running app's own version (`package.json`'s), stamped in by
 * `vite.config.ts` the same way `VITE_BUILD_TARGET` is. Plan 07's update
 * check compares a Release tag against this. Under vitest nothing stamps it,
 * so a fixed placeholder stands in — tests that care stub the env instead.
 */
export function appVersion(): string {
  const declared = import.meta.env.VITE_APP_VERSION;
  return typeof declared === 'string' && declared.length > 0 ? declared : '0.0.0-dev';
}

/**
 * Everything the service-worker decision depends on, gathered in one object so
 * the rule below can be tested without a build, a WebView or a desktop shell.
 */
export type RuntimeEnvironment = {
  target: BuildTarget;
  /** `import.meta.env.PROD`. A dev bundle must never leave a worker behind. */
  isProduction: boolean;
  /** True inside a Capacitor WebView, whatever the bundle claims to be. */
  isCapacitorNative: boolean;
  /** True when the Electron preload bridge is on `window`. */
  hasDesktopBridge: boolean;
};

/**
 * Whether this process should register the PWA service worker.
 *
 * Only a production **web** build may, and the two runtime checks are
 * deliberately redundant with the target: a worker inside Android or Electron
 * would put a second, independently-updated copy of the app in front of assets
 * that already ship on the device, and the two can then disagree about which
 * version the operator is looking at. A wrong `BUILD_TARGET` must not be able
 * to cause that, so the shell is detected as well as declared.
 */
export function shouldRegisterServiceWorker(
  environment: RuntimeEnvironment,
): boolean {
  if (environment.target !== 'web') return false;
  if (!environment.isProduction) return false;
  if (environment.isCapacitorNative) return false;
  if (environment.hasDesktopBridge) return false;
  return true;
}

/** The live environment, read at the moment of the call. */
export function currentRuntimeEnvironment(): RuntimeEnvironment {
  return {
    target: buildTarget(),
    isProduction: import.meta.env.PROD,
    isCapacitorNative: Capacitor.isNativePlatform(),
    hasDesktopBridge:
      typeof window !== 'undefined' &&
      window.attendanceDesktop !== undefined,
  };
}
