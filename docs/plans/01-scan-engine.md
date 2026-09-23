# Plan 01-scan-engine — Scan engine

**Design:** [design/01-scan-engine.md](../design/01-scan-engine.md) · **Blueprint:** [blueprint-final.md](../blueprint-final.md)

## Dependencies

- local-db persons/taps; domain types; theme copy keys for feedback strings

## File-level tasks (docs→code later; no code in this PR)

1. Inventory current scanner path under `artifacts/nfc-attendance-scanner/src/scanner/`.\n2. Extract normalize/debounce helpers toward `packages/nfc` (later PR).\n3. Ensure pause rules cover Theme/Import/Body dialogs.\n4. Tests: bad read, duplicate, unknown, bind prompt gating.

## Acceptance criteria

- All existing scanner tests green.\n- New dialogs pause capture.\n- UID never logged in activity.

## Copy-pasteable commands

```bash
cd artifacts/nfc-attendance-scanner\npnpm --filter @workspace/nfc-attendance-scanner run typecheck\npnpm --filter @workspace/nfc-attendance-scanner run test -- scanner
```