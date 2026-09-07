// Read by the Capacitor CLI from the package root whenever it runs here
// (`pnpm --filter @workspace/nfc-attendance-scanner exec cap ...`). It sits
// outside tsconfig's `src/**` include, so `pnpm run typecheck` never sees it —
// the CLI's own schema is what catches a misspelt key here, at sync time.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.stjohnschs.attendance',
  appName: 'SJC Attendance Scanner',
  // Must match `build.outDir` in vite.config.ts: `cap sync` copies this
  // directory into ios/App/App/public and android/app/src/main/assets/public.
  webDir: 'dist/public',
  // Deliberately no `server`: the bundle is served from webDir at the app's
  // own origin (capacitor://localhost on iOS, https://localhost on Android),
  // which is what keeps the kiosk working with no network at all. `server.url`
  // is a live-reload development hook, and changing `iosScheme`/`androidScheme`
  // or `hostname` later would move the origin, orphaning the IndexedDB roster
  // and attendance history already stored under the old one.
};

export default config;
