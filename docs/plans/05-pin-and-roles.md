# Plan 05-pin-and-roles — PIN and roles

**Design:** [design/05-pin-and-roles.md](../design/05-pin-and-roles.md) · **Blueprint:** [blueprint-final.md](../blueprint-final.md)

## Dependencies

- Existing lock module; theme copy; new teacher routes

## File-level tasks (docs→code later; no code in this PR)

1. Map new routes (theme, body, update) through LockedRoute.\n2. Wire theme strings for PIN dialog titles.\n3. Audit desk vs teacher matrix in docs + tests.

## Acceptance criteria

- New teacher surfaces gated.\n- Idle/nav relock unchanged.\n- Unset banner still shows.

## Copy-pasteable commands

```bash
pnpm --filter @workspace/nfc-attendance-scanner run test -- lock\npnpm --filter @workspace/nfc-attendance-scanner run test -- PinDialog
```