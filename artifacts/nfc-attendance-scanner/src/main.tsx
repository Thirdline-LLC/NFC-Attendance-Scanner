import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { requestPersistentStorage } from '@/lib/storage-persistence';
import { registerServiceWorker } from '@/pwa/register-service-worker';

import './index.css';

// Fire-and-forget: the answer is advisory and must not delay first paint.
// Whether a given WebView grants it is only interesting while developing
// (see docs/capacitor-native.md), so the result never reaches a production
// console.
void requestPersistentStorage().then((persisted) => {
  if (import.meta.env.DEV) {
    console.info(
      `[storage] persistent storage ${persisted ? 'granted' : 'not granted'}`,
    );
  }
});

// Also fire-and-forget, and also advisory: the worker is what lets an
// installed PWA open with no network, and it declines to register itself in
// development, in the Android shell and in the desktop app. See
// `src/pwa/register-service-worker.ts` for why each of those is excluded.
void registerServiceWorker();

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
