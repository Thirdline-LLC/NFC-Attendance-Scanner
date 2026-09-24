# Plan 08 — Configurable body hierarchy

**Design:** [design/08-configurable-body-hierarchy.md](../design/08-configurable-body-hierarchy.md)  
**Status:** 08a done · 08b deferred · 08c deferred  
**Baseline:** Plans 02–07 on `main` (`fb7c142` at the time this plan was approved).

Bodies, labels, and depth are configuration. This plan does not add a club mode or a class mode.

## 08a — shipped

Data model, tree operations, picker, desk subtitle, and dashboard roll-up.

1. Extend `AttendanceBody` with `parentId`, `sortOrder`, `customFields`, `archivedAt`. Dexie version 8. Flat bodies become roots. Indexes on `parentId` and `sortOrder`. D-T2 unchanged: the body owns roster and taps; `activeBodyId` attaches to any non-archived node.
2. Hierarchy operations: create child, create root, reparent (cycle-safe), rename, archive (cannot activate an archived body; cannot archive the active body), restore, list the tree in `sortOrder`. Soft depth warning at 6. No hard depth cap.
3. `typeLabel` stays a free string. Theme presets are datalist suggestions. Product copy on the dashboard body card is generic.
4. `BodySwitcherDialog` is a tree picker with search, path, and type label. It stays on the PIN-gated dashboard. The scanner has no switch control; the subtitle shows `name · typeLabel` or the path.
5. Dashboard toggle: “This body” vs “This body + descendants.” Subtree reads are `bodyId ∈ descendants`. Roll-up unique attendance uses email (lowercased) then `cardUid`. Unknown cards are summed per body. Export remains the active body only.
6. Tests: flat → root migration, cycle rejection, subtree dedupe, body switcher (including a child path), desk subtitle with no mid-queue switch.

### Files

- `artifacts/nfc-attendance-scanner/src/data/attendance-store.ts` — schema v8, migration, hierarchy writes, subtree reads
- `artifacts/nfc-attendance-scanner/src/data/body-hierarchy.ts` — tree order, cycle check, path, depth warning
- `artifacts/nfc-attendance-scanner/src/lib/attendance-metrics.ts` — `computeRollupDashboardMetrics`
- `artifacts/nfc-attendance-scanner/src/ui/BodySwitcherDialog.tsx` — tree picker
- `artifacts/nfc-attendance-scanner/src/ui/Dashboard.tsx` — scope toggle, generic body card
- `artifacts/nfc-attendance-scanner/src/dashboard/DashboardPage.tsx` — wires scope and structure edits
- `artifacts/nfc-attendance-scanner/src/scanner/ScannerScreen.tsx` — subtitle only

## 08b — deferred

Body-type vocabulary and custom-field definitions as admin UI.

- `BodyTypeDef` `{ id, label, sortOrder }` stored locally. Admin can rename and delete entries. Creating a body can add a one-off label to that list.
- `BodyFieldDef` `{ id, label, appliesToTypeLabel, required, sortOrder }`. Values already have a home on `AttendanceBody.customFields`.
- Screens to edit those definitions. Not in 08a.

## 08c — deferred

Exchange of a whole subtree.

- Optional subtree workbook (one sheet per body, or one sheet with a Body Path column).
- Workbook metadata columns `Body Path`, `Parent Body`, `Body Id`.
- Optional multi-body pack import that creates missing nodes. v1 import still requires the active body to match and does not auto-create a path.
- Filenames may gain a path slug. Not in 08a.

## Acceptance (08a)

- An admin can nest bodies, rename them, and reparent them without losing roster or taps.
- No code path requires `typeLabel` to be a club, class, or any other fixed word.
- Check-in records taps for `activeBodyId` only. The device can attach to a parent or a descendant. The desk does not switch bodies mid-queue.
- The dashboard can show the active body alone or the subtree roll-up.
- A flat database migrates with every body as a root and the same active body.
- Single-body roster import/export still works. Records stay on the device.

## Commands

```bash
pnpm --filter @workspace/nfc-attendance-scanner run test -- body-hierarchy attendance-store.hierarchy attendance-store.migrations attendance-metrics DashboardPage ScannerScreen
pnpm --filter @workspace/nfc-attendance-scanner run typecheck
```
