import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

/**
 * One config, three targets. `BUILD_TARGET` picks between them:
 *
 * - `web` (the default) — a static site for any host, absolute `/` base, and
 *   the only target that gets a service worker.
 * - `capacitor` — the bundle `cap sync` copies into the Android app. Relative
 *   base, because the page is served from the app's own origin with no path
 *   prefix, and no service worker: the assets are already on the device, so a
 *   second cache of them would only add a way for the two to disagree.
 * - `electron` — same reasoning, loaded over `file://` from inside the .app.
 *
 * Nothing here reads a Replit variable. `PORT` and `BASE_PATH` are still
 * honoured when set, so existing commands keep working, but both now have
 * defaults so a plain `pnpm run dev` works on a laptop.
 */
type BuildTarget = 'web' | 'capacitor' | 'electron';

const rawTarget = process.env.BUILD_TARGET ?? 'web';

if (rawTarget !== 'web' && rawTarget !== 'capacitor' && rawTarget !== 'electron') {
  throw new Error(
    `Invalid BUILD_TARGET "${rawTarget}": expected web, capacitor or electron.`,
  );
}

const target: BuildTarget = rawTarget;

/** Both packaged shells load the bundle from their own root, so assets are relative. */
const isPackagedShell = target === 'capacitor' || target === 'electron';

const rawPort = process.env.PORT ?? '5173';
const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// A packaged shell must resolve assets relative to the document; a hosted site
// wants a real path so a deep link like /roster still finds /assets/*.
const basePath = process.env.BASE_PATH ?? (isPackagedShell ? './' : '/');


/**
 * A Content-Security-Policy meta tag, added to built HTML only.
 *
 * Defence in depth rather than the primary control: the Electron main process
 * sets the same policy as a real header (a meta tag inside the bundle could be
 * relaxed by whatever compromised the bundle), and a static host should send
 * one too. It is left out of dev builds because Vite's HMR needs a websocket,
 * and out of the Capacitor build because that WebView serves the app from
 * `https://localhost` through Capacitor's own scheme handlers — a policy this
 * repo cannot test on a device is not one to ship to a tablet.
 */
function contentSecurityPolicy(target: BuildTarget) {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // Radix and Recharts write inline style attributes. No inline <script> is
    // allowed, which is the half that matters.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // `frame-ancestors` is deliberately absent: a <meta> CSP cannot carry it,
    // and browsers log an error for trying. The Electron main process sends
    // the same policy WITH it as a real header, which is where it works.
  ].join('; ');

  return {
    name: 'attendance-content-security-policy',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      if (target === 'capacitor') return html;
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

export default defineConfig({
  base: basePath,
  // Exposed to the app as import.meta.env.VITE_BUILD_TARGET so the service
  // worker registration and the export adapter can tell the shells apart.
  define: {
    'import.meta.env.VITE_BUILD_TARGET': JSON.stringify(target),
  },
  plugins: [
    react(),
    tailwindcss(),
    contentSecurityPolicy(target),
    // Only the hosted web build is installable, so it is the only one that
    // gets a manifest and a worker. `injectRegister: null` keeps the plugin
    // from writing a registration snippet into index.html — registration lives
    // in src/pwa/register-service-worker.ts, which is testable and which
    // refuses to run in either shell.
    VitePWA({
      disable: target !== 'web',
      injectRegister: null,
      registerType: 'prompt',
      // Vite's dev server must not serve a worker: a cached dev bundle is the
      // classic "my change did nothing" bug.
      devOptions: { enabled: false },
      includeAssets: ['favicon.svg', 'icons/*.png'],
      workbox: {
        // The kiosk must open with no network, so the whole shell is precached.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // A client-side router serves every route from one document.
        navigateFallback: 'index.html',
        // Nothing is fetched from anywhere else at runtime; an empty list keeps
        // it that way rather than leaving a same-origin catch-all behind.
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'SJC Attendance Scanner',
        short_name: 'SJC Attendance',
        description:
          'Kiosk attendance scanning for a USB HID NFC reader. Records and exports locally; no account, no server.',
        // `id`, `start_url` and `scope` are deliberately ABSENT. vite-plugin-pwa
        // defaults all three from the resolved `base`, and hardcoding them to
        // '/' overrode that: a `BASE_PATH=/attendance/` build — which
        // docs/pwa-hosting.md documents as supported — installed an app whose
        // launcher opened the host root instead of the scanner, and whose
        // start_url sat outside the service worker's own scope, so it had no
        // offline shell either. Every other base-dependent piece (routerBasename,
        // the worker registration) derives from `base`; this one now does too.
        display: 'standalone',
        orientation: 'portrait',
        // --background and --primary from src/index.css, so the splash and the
        // title bar match the app that follows them.
        background_color: '#0D1E30',
        theme_color: '#0D1E30',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    // Loopback by default so a laptop does not publish the kiosk to its
    // network; HOST=0.0.0.0 opts in (the Android emulator and a tablet on the
    // LAN both need it).
    host: process.env.HOST ?? 'localhost',
    fs: { strict: true },
  },
  preview: {
    port,
    host: process.env.HOST ?? 'localhost',
  },
});
