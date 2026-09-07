/**
 * Ask the browser to mark this origin's storage as persistent.
 *
 * Everything the kiosk knows -- the roster and every session's taps -- lives
 * in IndexedDB, which browsers and the WebViews inside a Capacitor shell treat
 * as "best-effort" storage: under disk pressure an engine may evict an
 * origin's data without asking. `navigator.storage.persist()` requests an
 * exemption from that eviction. The answer is advisory (Chromium grants it by
 * engagement heuristics, WebKit by its own rules), so callers treat `true` as
 * a nice-to-have and `false` as "nothing changed"; neither is a reason to
 * block scanning. Exports remain the system of record either way.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  // No `navigator` in non-DOM contexts and no `storage` in older WebViews;
  // both simply mean the request cannot be made.
  const storage =
    typeof navigator === 'undefined' ? undefined : navigator.storage;
  if (!storage || typeof storage.persist !== 'function') return false;

  try {
    // `=== true` keeps the contract boolean even if an engine resolves with
    // something else.
    return (await storage.persist()) === true;
  } catch {
    // Private browsing, a sandboxed WebView, or a flaky engine may reject or
    // throw; the boot sequence must never fail because of it.
    return false;
  }
}
