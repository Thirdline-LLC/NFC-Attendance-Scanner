import { describe, expect, it } from 'vitest';

import {
  shouldRegisterServiceWorker,
  type RuntimeEnvironment,
} from '@/platform/runtime';

/** A hosted production web build: the one case that may register a worker. */
function webProduction(
  overrides: Partial<RuntimeEnvironment> = {},
): RuntimeEnvironment {
  return {
    target: 'web',
    isProduction: true,
    isCapacitorNative: false,
    hasDesktopBridge: false,
    ...overrides,
  };
}

describe('shouldRegisterServiceWorker', () => {
  it('registers for a production web build', () => {
    expect(shouldRegisterServiceWorker(webProduction())).toBe(true);
  });

  it('never registers in development', () => {
    // A worker cached against a dev bundle is how an edit comes to do nothing.
    expect(
      shouldRegisterServiceWorker(webProduction({ isProduction: false })),
    ).toBe(false);
  });

  it('never registers in the Capacitor build', () => {
    expect(
      shouldRegisterServiceWorker(webProduction({ target: 'capacitor' })),
    ).toBe(false);
  });

  it('never registers in the Electron build', () => {
    expect(
      shouldRegisterServiceWorker(webProduction({ target: 'electron' })),
    ).toBe(false);
  });

  it('refuses inside a Capacitor WebView even if the bundle claims to be web', () => {
    // The redundancy is the point: a wrong BUILD_TARGET must not be able to
    // put a second, independently-updated copy of the app on a tablet whose
    // assets already ship in the APK.
    expect(
      shouldRegisterServiceWorker(webProduction({ isCapacitorNative: true })),
    ).toBe(false);
  });

  it('refuses inside the desktop shell even if the bundle claims to be web', () => {
    expect(
      shouldRegisterServiceWorker(webProduction({ hasDesktopBridge: true })),
    ).toBe(false);
  });
});
