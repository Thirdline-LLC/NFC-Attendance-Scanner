# Plan 06-export-and-sor — Export and SoR

**Design:** [design/06-export-and-sor.md](../design/06-export-and-sor.md) · **Blueprint:** [blueprint-final.md](../blueprint-final.md)

## Dependencies

- Mask helper; activity; body metadata columns optional

## File-level tasks (docs→code later; no code in this PR)

1. Confirm maskCardUid on all export paths.\n2. Add body name/type columns to roster/attendance sheets if missing.\n3. Keep school-account notice (theme override of wording only).\n4. Docs cross-link SoR procedure.

## Acceptance criteria

- No full UID in any sheet.\n- Activity sheet counts only.\n- Export tests cover masking.

## Copy-pasteable commands

```bash
pnpm --filter @workspace/nfc-attendance-scanner run test -- attendance-export
```