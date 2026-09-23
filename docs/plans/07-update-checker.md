# Plan 07-update-checker — Update checker

**Design:** [design/07-update-checker.md](../design/07-update-checker.md) · **Blueprint:** [blueprint-final.md](../blueprint-final.md)

## Dependencies

- GitHub Releases; D1 constraints; theme verifier

## File-level tasks (docs→code later; no code in this PR)

1. `packages/update` Release client (metadata + asset download).\n2. SHA-256 verify against Release checksum files.\n3. Dashboard Update card (PIN).\n4. Theme path delegates to theme activator.\n5. App path: open instructions / download artifact — no electron-updater.\n6. Document private-repo token ops separately from student DB.

## Acceptance criteria

- Checksum fail refuses install.\n- No student data in requests/responses.\n- Offline shows manual Releases link.

## Copy-pasteable commands

```bash
pnpm --filter @workspace/update run test\ngh release view --repo Thirdline-LLC/NFC-Attendance-Scanner
```