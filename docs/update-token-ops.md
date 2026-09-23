# Update-checker token — device ops, not student data

**Plan:** [plans/07-update-checker.md](plans/07-update-checker.md) · **Design:** [design/07-update-checker.md](design/07-update-checker.md)

The Dashboard's "Check for updates" card reads `Thirdline-LLC/NFC-Attendance-Scanner`
on GitHub Releases (`lib/update`'s `fetchLatestRelease`, and — on the macOS
build only — the download-and-verify IPC handler in `electron/main.ts`).

## While the repo is public

No token is needed. `fetchLatestRelease` and the asset-download handler both
work anonymously; GitHub just rate-limits unauthenticated requests to 60/hour
per IP, shared by every kiosk behind the same school NAT. A "GitHub is
rate-limiting this network" message in the card means that, not a bug.

## If the repo goes private

A **fine-grained personal access token** with **read-only Contents access**
to this one repo is enough for both the metadata call and the asset
download — no other scope. Set it as `TAPIN_UPDATE_TOKEN` in the environment
the packaged macOS app launches with (`launchd`/MDM profile, or a
school-managed `.env` outside the app bundle). `electron/main.ts` reads it
straight from `process.env` and sends it as `Authorization: Bearer` on the
two GitHub requests it makes — it is never logged, never written to disk,
and never reaches `attendance-scanner-local` (the student-data database) or
any activity-log row.

The renderer's own metadata check has no way to receive this token at all —
`fetchLatestRelease`'s `token` option exists for exactly this environment
variable path in the main process; nothing in `src/` reads
`TAPIN_UPDATE_TOKEN` or any other secret.

## Rotating it

1. Revoke the old fine-grained token from the GitHub organization's token
   settings.
2. Issue a new one with the same scope (Contents: read-only, this repo only).
3. Update the environment variable on each managed Mac and redeploy the
   `launchd`/MDM config. No app code change, no rebuild.

## Keep separate from student data, always

- Never put this token in `docs/data-and-backup.md`'s backup instructions,
  in an exported workbook, or in an activity-log entry.
- Never request or accept a token scoped beyond this one repo's Contents.
- If a token is ever suspected compromised, revoke it immediately — it grants
  read access to this repository's Releases only, never to any school system.
