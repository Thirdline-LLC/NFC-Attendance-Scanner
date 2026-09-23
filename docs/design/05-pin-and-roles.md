# Design 05 — PIN and roles

**Status:** Spec 2026-09-23 · **Plan:** [plans/05-pin-and-roles.md](../plans/05-pin-and-roles.md)  
**Source of truth for shipped behavior:** `docs/data-protection.md`, FERPA kiosk spec.

## Overview

Two roles — **Desk** and **Teacher** — gated by a 4–8 digit teacher PIN (PBKDF2 hash in settings). Extend copy via theme (`teacherRoleLabel`) without weakening the gate. New surfaces (import, theme, body reconfigure, update check) are teacher-only.

## UI notes

- Lock glyph on Students/Dashboard while locked.  
- Unset-PIN banner until first set.  
- Theme strings only; layout stays high-contrast, not playful gradient modals.

## Data flow

`verifyOperatorPin` → in-memory unlock → idle 5 min / navigate to scanner / End Session dismiss → relock. Protected routes do not mount children while locked.

## Edge cases

- Reader burst into PIN field (existing mitigations).  
- Missing `crypto.subtle` → PinUnavailableError copy.  
- No recovery — forgotten PIN ⇒ clear app data after exports.

## FERPA

PIN is a screen gate, not encryption. Does not replace OS disk encryption.

## Out of scope

Biometrics; remote PIN reset; multi-teacher accounts.