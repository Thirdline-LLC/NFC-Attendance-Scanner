import { BrowserRouter, Route, Routes } from 'react-router-dom';
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
      </Routes>
    </BrowserRouter>
  );
}