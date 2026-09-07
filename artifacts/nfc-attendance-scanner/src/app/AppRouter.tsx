import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from '@/dashboard/DashboardPage';
import { RosterPage } from '@/roster/RosterPage';
import { ScannerScreen } from '@/scanner/ScannerScreen';

// Vite reports `./` as BASE_URL when built with a relative base (the Capacitor
// bundle from `pnpm run build:native`). Trimming the trailing slash from that
// would hand react-router a basename of `.`, which matches no location. A
// relative base carries no path prefix to strip -- in the Capacitor shell the
// page sits at the origin root -- so the basename is simply empty.
function routerBasename(baseUrl: string): string {
  return baseUrl.startsWith('/') ? baseUrl.replace(/\/$/, '') : '';
}

export function AppRouter() {
  return (
    <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
      <Routes>
        <Route path="/" element={<ScannerScreen />} />
        <Route path="/roster" element={<RosterPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        {/* A kiosk has no address bar to correct a stale or mistyped path
            with, so anything unknown lands back on the scanner. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}