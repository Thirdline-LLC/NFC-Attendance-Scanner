# Design 06 — Export and system of record

**Status:** Spec 2026-09-23 · **Plan:** [plans/06-export-and-sor.md](../plans/06-export-and-sor.md)  
**Source:** `docs/data-and-backup.md`.

## Overview

PIN-gated exports feed the **school workbook (OneDrive)** SoR. Device IndexedDB is a cache. Session export, all-history (+ Activity sheet), roster export. Masked card column. Body name/type included as metadata columns where useful (not PII beyond existing name/email).

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