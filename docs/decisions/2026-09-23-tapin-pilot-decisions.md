# Decision — Tapin · SJC pilot locks (2026-09-23)

**Status:** decided · **Product:** Tapin · **Repo:** Thirdline-LLC/NFC-Attendance-Scanner  
**Authority:** Asher Mills (voice) → Chief of Staff  
**Do not merge / implement from this note alone** — docs update only on the blueprint PR.

## D-T1 — Theme signing (UNSIGNED for pilot)

**Decision:** Theme packs (`.nfc-theme`) ship **unsigned** for the pilot. Admins install packs locally on-device. Do **not** implement ed25519 verification yet.

**Seam to keep:** Pack schema retains optional `signature` / `checksums` fields so a signing key can be layered later without restructuring. Pilot loader: accept packs with missing/placeholder signature; still may verify asset SHA-256 locally if present.

**Rationale:** Start unsigned for the SJC pilot; add key infrastructure when scaling to multiple schools.

## D-T2 — Classes/clubs own roster + history; devices attach

**Decision (revised 2026-09-23):** **Classes and clubs (AttendanceBody entities) are first-class.** Each class/club owns its own **roster** and its own **tap history / metrics**. Devices do **not** own rosters.

- A device simply **attaches** to whichever class or club is currently **active** on it.
- **Reassignment** means pointing the device at a different class/club entity.
- The roster and tap history **stay with the entity**, never migrate as “device property,” and are **not wiped** on switch.
- Export remains **optional** — not required before reassignment.

**Clarification:** “Keep old taps” means keep each entity’s **roster and associated tap history**, not orphan device-level rows without a body.

**Supersedes:** (a) earlier “block replace until export,” and (b) the brief “KEEP taps and reassign onto the new body” wording that implied device-owned history.

## D-T3 — GitHub Releases on school Wi‑Fi

**Decision:** School Wi‑Fi reaching GitHub Releases for **app binaries and theme packs** is **not** a restriction. Proceed with GitHub Releases as the update channel.

**Unchanged:** No peer sync of student records; Releases carry binaries/themes only, never attendance DBs.
