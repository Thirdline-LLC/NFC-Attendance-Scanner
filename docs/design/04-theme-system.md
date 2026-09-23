# Design 04 — Runtime theme system

**Status:** Spec 2026-09-23 · **Plan:** [plans/04-theme-system.md](../plans/04-theme-system.md)

## Overview

Neutral core binary loads a signed `.nfc-theme` at runtime. Themes are branding/copy/tokens only. Fallback: bundled `packages/themes/default`.

## Schema (v1)

```
meta: { id, orgName, version, minAppVersion, createdAt }
fonts: { heading, body }          # intentional pairings required
colors: { bg, fg, muted, border, accent, accentFg, success, danger, warning, surface, shadow }
assets: { logoMark, logoWordmark, favicon, splash? }
copy: { appName, shortName, deskRoleLabel, teacherRoleLabel, checkInCta, enrollCta, endSessionCta, pinGateTitle, exportSchoolAccountNotice, emptyRosterHint, … }
bodyTypePresets: [{ id, label }]
layout: { density?, radius?, asymmetryHint? }
checksums: { "assets/…": "sha256:…" }
signature: { alg: "ed25519", keyId, sig }
```

**Forbidden:** members, emails, UIDs, taps, sessions, PIN material, PII paths.

## SJC sample (`packages/themes/orgs/sjc` → `sjc-v1.nfc-theme`)

- `meta.id`: `sjc` · orgName: St. John's College High School  
- Fonts: Playfair Display + Plus Jakarta Sans  
- Colors: near-white surfaces, deep crimson/navy accents, zinc-like borders, shadow-sm  
- Copy: appName `SJC Attendance`; export school-account notice retained  
- Presets: Club, Class, Faculty, Custom  
- Assets: licensed mark/wordmark only — no student photos  

## Load / verify flow

1. Boot → read `active.nfc-theme` from app data.  
2. Verify asset SHA-256 map, then ed25519 with embedded public keyring.  
3. Fail → default theme + teacher-visible banner.  
4. Apply CSS variables + copy dictionary; feed bodyTypePresets.  
5. PIN Theme screen: Install / Activate / Revert; show id+version. IndexedDB untouched.

## Releases

Same GitHub Release as APK/DMG:

- `themes/sjc-v1.nfc-theme`  
- `themes/sjc-v1.nfc-theme.sha256`  
- listed in `CHECKSUMS.txt`  

## FERPA

Themes never carry education records. Update checker may download theme bytes only.

## Out of scope

Per-user themes; remote CMS; unsigned “dev override” in production builds (dev flag only).