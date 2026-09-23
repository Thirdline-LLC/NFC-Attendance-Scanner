# Plan 03-roster-import — Roster import

**Design:** [design/03-roster-import.md](../design/03-roster-import.md) · **Blueprint:** [blueprint-final.md](../blueprint-final.md)

## Dependencies

- Plan 02 active body; PIN; activity import-roster; templates/

## File-level tasks (docs→code later; no code in this PR)

1. Keep xlsx import; add CSV parser in `packages/roster-import`.\n2. Add body_name/body_type validation.\n3. Optional `.nfc-pack` JSON parse + signature verify hook.\n4. Preview UI: added/updated/unchanged/refused.\n5. Ship `templates/roster-template.csv`.

## Acceptance criteria

- Idempotent re-import.\n- Never deletes.\n- Card column ignored.\n- Mismatch body fields refuse cleanly.

## Copy-pasteable commands

```bash
pnpm --filter @workspace/nfc-attendance-scanner run test -- import\n# generate headers from empty device:\n# Students → Export roster
```