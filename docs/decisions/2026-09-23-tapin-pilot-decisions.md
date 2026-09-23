# Decision — Tapin · SJC pilot locks (2026-09-23)

**Status:** decided · **Product:** Tapin · **Repo:** Thirdline-LLC/NFC-Attendance-Scanner  
**Authority:** Asher Mills (voice) → Chief of Staff  
**Do not merge / implement from this note alone** — docs update only on the blueprint PR.

## D-T1 — Theme signing (UNSIGNED for pilot)

**Decision:** Theme packs (`.nfc-theme`) ship **unsigned** for the pilot. Admins install packs locally on-device. Do **not** implement ed25519 verification yet.

**Seam to keep:** Pack schema retains optional `signature` / `checksums` fields so a signing key can be layered later without restructuring. Pilot loader: accept packs with missing/placeholder signature; still may verify asset SHA-256 locally if present.

**Rationale:** Start unsigned for the SJC pilot; add key infrastructure when scaling to multiple schools.

## D-T2 — Body-replace keeps taps

**Decision:** When a device switches club/class (active `AttendanceBody`), **KEEP** existing taps on the device and **reassign** them as appropriate to the new body context (product rule: do not wipe history on swap). Export remains available but is **not required** before reassignment. Do **not** block the swap for export.

**Supersedes:** Earlier blueprint preference to “block replace until export confirmed.”

## D-T3 — GitHub Releases on school Wi‑Fi

**Decision:** School Wi‑Fi reaching GitHub Releases for **app binaries and theme packs** is **not** a restriction. Proceed with GitHub Releases as the update channel.

**Unchanged:** No peer sync of student records; Releases carry binaries/themes only, never attendance DBs.
