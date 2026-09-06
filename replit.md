# NFC Attendance Scanner

A frontend-only kiosk screen for recording HID NFC attendance scans locally in the browser.

## Run & Operate

- `pnpm --filter @workspace/nfc-attendance-scanner run dev` — run the scanner preview
- `pnpm --filter @workspace/nfc-attendance-scanner run typecheck` — typecheck the scanner
- `pnpm --filter @workspace/nfc-attendance-scanner run build` — build the scanner for production

The scanner has no backend, authentication, analytics, API routes, or database server. Scan records are stored in the browser with Dexie/IndexedDB.

## Stack

- pnpm workspaces, TypeScript, React 18, Vite
- Tailwind CSS, react-router-dom, Dexie.js

## Where things live

- `artifacts/nfc-attendance-scanner/src/scanner/` — scanner input and session behavior
- `artifacts/nfc-attendance-scanner/src/data/` — Dexie/IndexedDB persistence
- `artifacts/nfc-attendance-scanner/src/ui/` — feedback and status presentation
- `artifacts/nfc-attendance-scanner/src/app/` — router
- `artifacts/nfc-attendance-scanner/src/lib/` — UID normalization and validation
- `artifacts/nfc-attendance-scanner/src/lib/attendance-export.ts` — local `.xlsx` export formatting

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
