import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from '@/dashboard/DashboardPage';
import { LockedRoute } from '@/lock/LockedRoute';
import {
  OperatorLockProvider,
  RelockOnScanner,
} from '@/lock/OperatorLockProvider';
import { RosterPage } from '@/roster/RosterPage';
import { ScannerScreen } from '@/scanner/ScannerScreen';

/**
 * Turns Vite's `BASE_URL` into a router basename.
 *
 * Vite reports `./` as BASE_URL when built with a relative base, which is both
 * packaged shells: the Capacitor bundle from `pnpm run build:native` and the
 * Electron renderer from `pnpm run build:electron`. Trimming the trailing
 * slash from that would hand react-router a basename of `.`, which matches no
 * location and renders a blank app. A relative base carries no path prefix to
 * strip -- in both shells the page sits at the origin root, `https://localhost`
 * on Android and `app://attendance` on macOS -- so the basename is simply
 * empty.
 *
 * Exported for its test: the three cases it has to get right (hosted at a
 * domain root, hosted under a sub-path, packaged) are the three ways this app
 * ships, and only one of them is exercised in development.
 */
export function routerBasename(baseUrl: string): string {
  return baseUrl.startsWith('/') ? baseUrl.replace(/\/$/, '') : '';
}

export function AppRouter() {
  return (
    <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
      {/* One unlock per visit to the teacher's side. The way back to the
          scanner is the way the device is handed back, so it relocks there. */}
      <OperatorLockProvider>
        <RelockOnScanner />
        <Routes>
          <Route path="/" element={<ScannerScreen />} />
          <Route
            path="/roster"
            element={
              <LockedRoute>
                <RosterPage />
              </LockedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <LockedRoute>
                <DashboardPage />
              </LockedRoute>
            }
          />
          {/* A kiosk has no address bar to correct a stale or mistyped path
              with, so anything unknown lands back on the scanner. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </OperatorLockProvider>
    </BrowserRouter>
  );
}
