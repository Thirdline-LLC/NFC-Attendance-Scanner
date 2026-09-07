import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { requestPersistentStorage } from '@/lib/storage-persistence';

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
