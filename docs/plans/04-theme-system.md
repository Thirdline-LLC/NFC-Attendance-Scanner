# Plan 04-theme-system — Theme system

**Design:** [design/04-theme-system.md](../design/04-theme-system.md) · **Blueprint:** [blueprint-final.md](../blueprint-final.md)

## Dependencies

- packages/themes; update checker for assets; UI CSS variables

## File-level tasks (docs→code later; no code in this PR)

1. Scaffold `packages/themes` with Zod schema + default theme.\n2. Verifier (sha256 + ed25519 public keyring).\n3. Apply tokens to CSS variables in `packages/ui`.\n4. PIN Theme admin screen.\n5. Author SJC source under `packages/themes/orgs/sjc`; pack script → `.nfc-theme`.\n6. CI: pack example + verify fixture.

## Acceptance criteria

- Tampered pack refused; default loads.\n- Runtime swap without rebuild.\n- Pack fixtures contain zero student fields.

## Copy-pasteable commands

```bash
pnpm --filter @workspace/themes run test\n# after pack script exists:\n# pnpm --filter @workspace/themes run pack -- sjc
```