# Security policy

Tapin is a device-local kiosk: there is no server, no API, no account system
and no cloud storage. Every roster and every attendance tap lives in the
browser's IndexedDB on the device that scanned it. The only network calls the
installed app makes are a teacher-initiated check of public GitHub Releases
for app and theme updates — see [docs/data-protection.md](docs/data-protection.md)
and [docs/data-and-backup.md](docs/data-and-backup.md) for exactly what that
does and does not send.

That shrinks the attack surface a lot, but it does not remove it: the app
still runs on a real device, still parses files it did not create (roster
imports, theme packs, downloaded updates), and still guards a PIN. If you find
a way past any of that, we want to know before it reaches a school.

## Reporting a vulnerability

Please use GitHub's private reporting flow rather than a public issue:

1. Go to the [Security tab](https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/security) on this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, the affected build (web, Android, or macOS) and, if you
   have one, a reproduction.

This keeps the report private until a fix ships. Do not open a public issue
or discuss an unpatched vulnerability anywhere else.

## What is, and is not, in scope

**In scope:**
- Anything that could read, exfiltrate, or leak roster or attendance data off
  the device without the operator exporting it themselves.
- Bypasses of the teacher PIN, or ways to reach PIN-gated screens without it.
- Ways a crafted roster import, theme pack (`.nfc-theme`), or update asset
  could execute code, corrupt data, or escape its intended sandbox.
- Issues in the Electron main-process bridge (`electron/`) that would let the
  renderer read or write outside the export flow's allow-listed filename and
  destination.

**Out of scope:**
- Physical access to an unlocked device — that is a school procedure question,
  not a code fix.
- The fact that a stolen or borrowed device without a PIN set shows student
  names; setting a teacher PIN on first install is the documented mitigation
  (see [docs/operating-the-kiosk.md](docs/operating-the-kiosk.md)).
- Denial of service against the optional update check (it is teacher-initiated
  and non-critical to daily operation).

## No student data in reports

Never include real student names, emails, or card UIDs in a report. This
project's own contribution rules ([CLAUDE.md](CLAUDE.md)) forbid handling real
student records at all — use a synthetic example if you need to show data
shape.

## Supported versions

Only the latest tagged Release is supported. There is no long-term-support
branch; schools running an older build should update through the in-app
"Check for updates" flow or by downloading the latest DMG/APK from
[Releases](https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases).
