# Documentation — implementation plan (branch 4 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four documents that describe the kiosk's data handling say what the merged code now does — the two roles and the PIN, the retention schedule, the masked export and its Activity sheet, the activity log, the destination rule, no recovery, and how an inspection request is answered — plus the applicability findings.

**Architecture:** Prose only; no code changes. Each claim quoted from the screen is checked against `src/` with grep before the merge. Written last, so it describes what shipped.

**Spec:** `docs/superpowers/specs/2026-09-08-ferpa-safe-kiosk-design.md`, section 4 ("Docs").

## Global Constraints

- Keep each document's voice: `data-protection.md` is factual and declines to claim compliance; `operating-the-kiosk.md` is for a volunteer with no technical background; `data-and-backup.md` is the safety model; `replit.md` is the developer map.
- Every on-screen string the docs quote must exist verbatim in `src/` (verified with grep in Task 5).
- Branch `docs/data-protection` from `main` at `1f1a72e` or later.

### Task 1: `docs/data-protection.md` — rewrite in place
- [ ] Add the applicability table (COPPA no; FERPA probably not directly, confirm; DC act no) and the FERPA-style bar; the three record kinds now including *Activity*; the two roles with the card-holder-present rule; what the PIN is and is not, no recovery, the unset state; the export's `Card (last 4)` column and the *Activity* sheet; the destination rule; the activity log; the retention schedule; how an inspection request is answered; removal logged as counts only.

### Task 2: `docs/operating-the-kiosk.md`
- [ ] A *Before the first session (teacher)* section: set the PIN at install, what it unlocks, no recovery, students never need it. End Session and the two admin screens now ask for it. The export notice's *school account* line. The dashboard's three new cards in one line each. *The teacher forgot the PIN* under *If something looks wrong*.

### Task 3: `docs/data-and-backup.md`
- [ ] `activity` in the tables list; PIN rows under `settings`; the v6 schema row; a *The teacher PIN* section (not recoverable; what clearing data costs); exports are teacher-only and the full-history one carries the *Activity* sheet; the *never do* list names the three confirmed deletions and extends the UID rule to the file.

### Task 4: `replit.md`
- [ ] Test count; *no accounts* → *the only credential is a local teacher PIN*; `src/lock/`, `src/data/operator-pin.ts`, `src/lib/activity-wording.ts`, `src/ui/RetentionDialog.tsx` in the map; the routes' PIN gates and the dashboard's cards; four new architecture decisions; the PIN dialog in the modal gotcha; the fake-timers gotcha.

### Task 5: Verify and merge
- [ ] `grep` each quoted on-screen string against `src/`; `pnpm run typecheck && pnpm run test` (unchanged code, 509); merge `--no-ff`; confirm the remote is untouched.
