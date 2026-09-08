import {
  currentRuntimeEnvironment,
  shouldRegisterServiceWorker,
  type RuntimeEnvironment,
} from '@/platform/runtime';

/**
 * Registers the PWA service worker, but only for a hosted production web
 * build.
 *
 * `vite-plugin-pwa` is configured with `injectRegister: null`, so nothing is
 * written into `index.html` and this is the only place registration can
 * happen. That matters because the same `index.html` ships inside the Android
 * APK and the macOS .app, where a worker would be actively harmful: those
 * bundles are already local files, and a second cached copy of them can only
 * ever disagree with the first.
 *
 * Returns the registration when one was made, `null` otherwise, so a caller —
 * or a test — can tell "declined" from "failed".
 */
export async function registerServiceWorker(
  environment: RuntimeEnvironment = currentRuntimeEnvironment(),
): Promise<ServiceWorkerRegistration | null> {
  if (!shouldRegisterServiceWorker(environment)) return null;

  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    typeof navigator.serviceWorker?.register !== 'function'
  ) {
    return null;
  }

  try {
    // Resolved against BASE_URL so the app still works under a sub-path on a
    // static host that does not own the whole domain.
    return await navigator.serviceWorker.register(
      `${import.meta.env.BASE_URL}sw.js`,
      { scope: import.meta.env.BASE_URL },
    );
  } catch {
    // An unregistered worker costs the operator an offline launch, never a
    // scan or a record. It must not stop the app from starting.
    return null;
  }
}
