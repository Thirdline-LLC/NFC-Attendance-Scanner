# Design 06 — Export and system of record

**Status:** Spec 2026-09-23 · **Plan:** [plans/06-export-and-sor.md](../plans/06-export-and-sor.md)  
**Source:** `docs/data-and-backup.md`.

## Overview

PIN-gated exports feed the **school workbook (OneDrive)** SoR. Device IndexedDB is a cache. Session export, all-history (+ Activity sheet), roster export. Masked card column. Body name/type included as metadata columns where useful (not PII beyond existing name/email).

**Amended by [Design 09](09-multi-period-classes-and-range-export.md) step 5:** the dashboard export is now a date-range export of the active body (Export dialog: Today … All time, Custom). Each file has Summary, Attendance (filtered to the range) and By meeting sheets; the Activity sheet is kept only for **All time**, which is the whole-history record this design describes. Range exports are logged `export-range` with their dates; All time stays `export-all`. The scanner's session export is unchanged. **Step 6:** when the active body has descendants, the same dialog offers **This body + all periods** (the children's own label, or "children"): the workbook adds a **Summary by period** sheet (one row per descendant at any depth, full path, archived ones marked, then a total that counts each person once) and a **Period** column (the body path) on Summary, Attendance and By meeting. Each tap is resolved against its own body's roster. File names read `English 11 - All periods - <range>.xlsx`; the log row adds `scope: 'subtree'` and a body count.

## UI notes

- Success copy always ends with school-account sentence (theme-overridable wording, same duty).  
- No gamified “share to social” affordances.

## Data flow

Teacher action → build workbook → platform delivery (download / Documents+share / Save dialog) → `recordActivity` counts only.

## Edge cases

- Web download cannot confirm disk write.  
- Debug vs release Android signing mismatch wipes data — export first.  
- One device per meeting — no app-side merge.

## FERPA

Exports are disclosures; school policy owns retention outside the app. Activity log never stores names/UIDs.

## Out of scope

Direct OneDrive OAuth upload; automatic email of workbooks.