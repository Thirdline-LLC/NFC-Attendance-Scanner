# Templates

## `roster-template.csv`

A static copy of the roster CSV the Tapin importer reads (`first_name,last_name,grad_year,email,body_name,body_type`). In the app, the Students page has a **Download template** button that builds the same file with your active body already filled in, so you should use that when you can.

**Delete both example rows (Avery Chen, Jordan Lee) entirely before importing.** Don't just clear their email: when a row has no email, the importer builds a school address from the name and graduation year, and the row would import as a real student.

As a safety net, the example rows' graduation years are written as `2028 (example)` / `2027 (example)`. The importer only accepts a plain four-digit year, so it refuses a leftover example row, even with its email cleared. The example rows' `body_name` / `body_type` are left blank so they never trigger the body check, which means the rest of the file still imports into whichever body is active. Your own rows need a plain year such as `2028`.

The in-app **Download template** example row (Avery Chen) uses the same `2028 (example)` year, so it gets the same safety net.

- **Required columns:** `first_name`, `last_name`, `grad_year`.
- **Optional columns:**
  - `email`: used to match a student on re-import.
  - `body_name` / `body_type`: if filled in on any row, they must match the active body, or the whole file is refused. Leave both blank to skip that check.
- There is no card column. Cards bind when they're first tapped at the scanner.
- Re-importing never deletes students.

## Other files

- `body-pack.nfc-pack.example.json`: an example `.nfc-pack` shape (Design 03).
- `theme-pack.nfc-theme.example.json`: an example theme pack.
