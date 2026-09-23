# Design 03 — Roster import

**Status:** Spec 2026-09-23 · **Plan:** [plans/03-roster-import.md](../plans/03-roster-import.md)  
**Aligns with:** `docs/operating-the-kiosk.md` pre-enroll section (extend for body scope + CSV + `.nfc-pack`).

## Overview

PIN-gated bulk load of members into the **active body** from CSV, `.xlsx`, or signed `.nfc-pack`, so first meeting does not require typing every student. Cards bind later by tap. Manual Enroll remains.

## Schema

| Column | Required | Notes |
|---|---|---|
| `first_name` | yes | |
| `last_name` | yes | |
| `grad_year` | yes* | Soft-required for students; faculty packs may use blank + type faculty |
| `email` | no | Derive if school rule exists |
| `body_name` | no | If present must match active body name |
| `body_type` | no | If present must match active typeLabel |
| `card` / `card_uid` | ignored | Never bind from file |

Match for update: email if present, else first+last+grad_year within body.

Results: `added` | `updated` | `unchanged` | `refused` (line number + reason). **Never delete** members missing from file.

### `.nfc-pack` (v1)

```json
{
  "v": 1,
  "body": { "name": "Robotics", "typeLabel": "club" },
  "members": [{ "first_name": "Avery", "last_name": "Chen", "grad_year": 2028, "email": "achen28@stjohnschs.org" }],
  "signature": { "alg": "ed25519", "keyId": "thirdline-roster-1", "sig": "…" }
}
```

No taps, no full card UIDs. Signature optional in Wave “import unsigned xlsx” path; **signed pack required** only when distributing packs as Release assets (if ever). Day-to-day school workbook files stay unsigned CSV/xlsx behind PIN.

## Sample template

See `templates/roster-template.csv`:

```csv
first_name,last_name,grad_year,email,body_name,body_type
Avery,Chen,2028,achen28@stjohnschs.org,Robotics,club
```

## UI flow

1. Teacher PIN → Students (or Body admin).  
2. Confirm active body banner.  
3. Download template **or** Export roster (headers).  
4. Choose file → parse → preview counts + refused lines.  
5. Confirm → write Dexie; `activity` `import-roster` with counts only.  
6. First meeting: unknown card + uncarded members → “Whose card is ••••?”  

## Edge cases

- Duplicate emails → refuse row.  
- body_name mismatch → refuse entire file or row (prefer entire file for packs).  
- Re-import idempotent.  
- Faculty without grad_year — allowed when typeLabel is faculty.

## FERPA

Import is local write only. Source file handling is the teacher’s; app does not upload the spreadsheet.

## Out of scope

Auto-pull from OneDrive API; Google Classroom sync; deleting via import.