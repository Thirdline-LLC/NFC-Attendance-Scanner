// Read by the Capacitor CLI from the package root whenever it runs here
// (`pnpm --filter @workspace/nfc-attendance-scanner exec cap ...`). It sits
// outside tsconfig's `src/**` include, so `pnpm run typecheck` never sees it;
// it is kept valid TypeScript regardless so the CLI (which compiles it with
// its own TS) has nothing to trip on.
//
// After `pnpm add -D @capacitor/cli` lands, delete the local alias below and
// use the CLI's own schema instead so misspelt keys fail at sync time:
//   import type { CapacitorConfig } from '@capacitor/cli';
type CapacitorConfig = {
  appId: string;
  appName: string;
  webDir: string;
  server?: {
    url?: string;
    hostname?: string;
    iosScheme?: string;
    androidScheme?: string;
  };
};

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
