# Plan 02-attendance-bodies-sessions-taps — Bodies / sessions / taps

**Design:** [design/02-attendance-bodies-sessions-taps.md](../design/02-attendance-bodies-sessions-taps.md) · **Blueprint:** [blueprint-final.md](../blueprint-final.md)

## Dependencies

- Dexie migration plan; PIN for reconfigure; export-first gate

## File-level tasks (docs→code later; no code in this PR)

1. Add `bodies` table + `activeBodyId` setting (migration vN).\n2. Backfill: single body from current club semantics.\n3. Thread `bodyId` through taps/sessions/members.\n4. Dashboard Body card + reconfigure wizard (PIN).\n5. Block destructive body replace until export confirmed.

## Acceptance criteria

- One active body enforced.\n- Legacy DBs upgrade with one body and intact taps.\n- Desk cannot switch bodies.

## Copy-pasteable commands

```bash
pnpm --filter @workspace/nfc-attendance-scanner run test -- attendance-store\npnpm --filter @workspace/nfc-attendance-scanner run test -- migrations
```