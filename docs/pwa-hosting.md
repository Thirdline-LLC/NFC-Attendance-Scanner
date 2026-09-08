# The web app and the PWA

The web target is the same React app as the other two, built as a static site
with a web app manifest and a service worker. Once installed it opens and runs
with no network.

It is also the only one of the three that needs hosting: **a browser will not
offer to install a PWA served from `file://` or from a dev server.** The first
install needs a real URL over HTTPS. After that, the app is on the device.

## Build it

```bash
pnpm --filter @workspace/nfc-attendance-scanner run build
```

Output: `artifacts/nfc-attendance-scanner/dist/public/`

```
index.html                  the app shell
manifest.webmanifest        name, icons, standalone, portrait, #0D1E30
sw.js + workbox-*.js        the service worker (22 files, ~984 KiB precached)
assets/                     JS, CSS and the six bundled woff2 faces
icons/                      192, 512, and a 512 maskable
favicon.svg  robots.txt
```

Hosting it under a folder rather than a domain root:

```bash
BASE_PATH=/attendance/ pnpm --filter @workspace/nfc-attendance-scanner run build
```

## Host it

Any static file host. It needs **no application server, no Node, and no
runtime** — the entire app is HTML, CSS, JS and fonts.

Two requirements:

1. **HTTPS.** Service workers and `navigator.storage.persist()` both require a
   secure context. `localhost` counts as secure; a plain-HTTP LAN address does
   not.
2. **A single-page-app rewrite.** `/roster` and `/dashboard` are client-side
   routes with no file behind them, so the host must serve `index.html` for any
   path that does not match a file. Every static host has a name for this
   (Netlify `_redirects`, Vercel `rewrites`, Cloudflare Pages
   `_redirects`, S3+CloudFront "custom error response 404 → /index.html 200",
   nginx `try_files $uri /index.html`).

Recommended headers, none of them required:

```
Cache-Control: no-cache               on /index.html and /sw.js
Cache-Control: public, max-age=31536000, immutable   on /assets/*
```
The filenames under `assets/` are content-hashed, so they are safe to cache
forever; `index.html` and `sw.js` must not be, or a deploy will not be picked
up.

The build already carries a restrictive `Content-Security-Policy` in a meta
tag. Sending the same policy as a real header is strictly better if your host
can.

**No hosting provider has been chosen and nothing has been deployed.** That is
your call — say the word and I will set one up.

## Install it

### Chrome or Edge, desktop

Open the URL. An **install icon** (a monitor with a downward arrow) appears at
the right of the address bar; or ⋮ → **Cast, save and share → Install page as
app**. The app then opens in its own window with no address bar and gets a
launcher entry.

### Chrome, Android

Open the URL, then ⋮ → **Add to Home screen** → **Install**. Chrome usually
offers this by itself after a few seconds.

For the front-desk tablet, prefer the [APK](android-packaging.md): it is a real
app, survives Chrome being cleared, and can be pinned in kiosk mode.

### Safari, macOS 14 Sonoma or newer

Open the URL, then **File → Add to Dock**. The app gets a Dock icon and its own
window.

Two caveats specific to Safari:

- Safari's implementation is younger than Chrome's, and WebKit's storage
  eviction rules are its own. For a Mac that will hold the only copy of a
  roster, prefer the [macOS desktop app](desktop-macos.md), which uses
  Electron's Chromium and a stable data directory.
- macOS 13 and earlier have no "Add to Dock". Use Chrome or Edge there.

### Safari, iPhone or iPad

Share → **Add to Home Screen**.

## Offline

After the first successful load the service worker has precached the entire
shell — HTML, JS, CSS, fonts, icons — so the app opens with the network off.
Scanning, enrolling, the roster, the dashboard and the export all work offline,
because none of them ever needed the network in the first place.

Three honest limits:

- **The very first load needs the network.** Load the app once, on a working
  connection, before relying on it.
- **A browser may evict the data.** The app calls
  `navigator.storage.persist()` at startup to ask for an exemption, but the
  answer is advisory and browsers grant it on their own heuristics.
- **The export is the system of record.** Export at the end of every session
  and send the file somewhere off the device.

## Updating an installed PWA

The worker is built with `registerType: 'prompt'` and
`cleanupOutdatedCaches`. On the next launch after you deploy, the browser
fetches the new worker in the background; it takes effect the next time the app
is fully closed and reopened. Closing every window of the installed app and
opening it again is the reliable way to pick up a deploy.

An update never touches IndexedDB. The roster and the attendance history belong
to the origin, not to the bundle, and survive any number of deploys — **as long
as the app keeps the same origin**. Moving it to a different domain, or from a
domain root to a sub-path, is a new origin as far as the browser is concerned,
and the old data will not be there. Export first. See
[data-and-backup.md](data-and-backup.md).

## What the web build will never do

- Register a service worker in development, in the Android app, or in the macOS
  app. The rule is in `src/platform/runtime.ts` and is covered by tests.
- Fetch anything at runtime. `runtimeCaching` is deliberately empty, the fonts
  are bundled, and there is no analytics, telemetry or update check.
