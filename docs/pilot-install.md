# Pilot install (Mac)

For whoever is setting up the first Mac at a pilot school. This walks through
installing Tapin from a public GitHub Release, clearing Gatekeeper's one-time
warning, setting the teacher PIN, installing the school's theme pack, and
creating the first class. No build tools, no terminal beyond one copy-pasted
command, and no developer account needed.

If something here does not match what you see on screen, the feature docs are
the source of truth: [docs/desktop-macos.md](desktop-macos.md) for the app
itself, [docs/design/04-theme-system.md](design/04-theme-system.md) for theme
packs, and [docs/design/09-multi-period-classes-and-range-export.md](design/09-multi-period-classes-and-range-export.md)
for class setup.

## 1. Download the Release

Go to [Releases](https://github.com/Thirdline-LLC/NFC-Attendance-Scanner/releases)
and open the latest one. Download two files from **Assets**:

- **`SJC Attendance-<version>-arm64.dmg`** — the Mac installer. Pilot devices
  are Apple Silicon; there is no Intel build.
- **`tapin-sjc-v<version>.nfc-theme`** — the St. John's theme pack. You do not
  need this file yet, but grab it now while you are on the Release page.

Optionally also download the matching `.sha256` files and verify:

```bash
shasum -a 256 -c "SJC Attendance-<version>-arm64.dmg.sha256"
```

## 2. Install the app

1. Double-click the `.dmg` to mount it.
2. Drag **SJC Attendance** onto the **Applications** shortcut in the window
   that opens.
3. Eject the disk image.

The app is still named **SJC Attendance** on disk and in Finder — that is the
locked application identity, not a mistake. On screen, the product introduces
itself as **Tapin**. See the README's
[Application identity](../README.md#application-identity) section if that
seems inconsistent.

## 3. Clear Gatekeeper's quarantine flag

This build is ad-hoc signed, not notarized (no Apple Developer account has
been used yet — see [docs/deferred-apple-developer.md](deferred-apple-developer.md)).
The first time you open it, macOS refuses with:

> **"SJC Attendance" Not Opened**
> Apple could not verify "SJC Attendance" is free of malware that may harm
> your Mac or compromise your privacy.

There is no "Open Anyway" button in that dialog on modern macOS. Clear the
flag once from Terminal instead:

```bash
xattr -dr com.apple.quarantine "/Applications/SJC Attendance.app"
```

Then open the app normally — no warning, every time after. If you would
rather not use Terminal: open the app once and let macOS refuse, then go to
**System Settings → Privacy & Security**, scroll to the Security section, and
click **Open Anyway** next to *SJC Attendance*. Same result, more clicks.
Full detail, including what changes with a future notarized build, is in
[docs/desktop-macos.md §4–5](desktop-macos.md).

## 4. Set the teacher PIN

The app opens with no PIN set and a red banner saying the records are open —
that is expected on a fresh install, and it is telling the truth.

1. Press **End Session**.
2. Choose a PIN, 4 to 8 digits, and enter it twice to confirm.
3. **Write it down somewhere safe.** There is no recovery path; a forgotten
   PIN means clearing the app's data, which loses everything not yet exported.

Only the teacher needs the PIN. Anyone at the desk can check students in and
enroll new cards without it. Full front-desk behaviour is in
[docs/operating-the-kiosk.md](operating-the-kiosk.md).

## 5. Install the SJC theme pack

With the PIN set, you can reach the PIN-gated Dashboard:

1. Enter the teacher PIN to open the Dashboard.
2. Find the **Theme** section and press **Install pack**.
3. Choose the `tapin-sjc-v<version>.nfc-theme` file you downloaded in step 1.

The pack applies immediately — school name, colors, fonts and copy — with no
restart. It carries no student data; a theme pack is branding only (fonts,
colors, copy, a logo mark). If anything looks wrong, **Revert to default**
returns to the neutral Tapin look with no data loss.

## 6. Set up the first class

Still on the Dashboard:

1. Press **Add a body**.
2. Choose **Class with periods** (use **Single body** instead for a club or a
   single section that meets once a day).
3. Enter the class name (e.g. "English 11") and how many periods it meets —
   period names auto-fill "Period 1" … "Period N" and are editable to match
   real bell periods.
4. Review the preview, then **Create**. One action creates the class and every
   period at once; nothing here needs to be built one at a time.
5. For each period, either **Download template** to get a pre-filled roster
   spreadsheet you can fill in and re-upload, or **Skip for now** and add
   students later from the Students page.

The device attaches to the new class. The scanner shows a period switcher
whenever the active body has siblings, so the front desk can move between
periods across the day without going back to the Dashboard. See
[Design 09](design/09-multi-period-classes-and-range-export.md) for the full
behaviour, including the optional **Require PIN to switch periods** setting
for an unattended kiosk.

## 7. You're done

At this point the device has:

- A teacher PIN set.
- The St. John's theme pack installed and active.
- At least one class with its periods created.

From here, day-to-day use is [docs/operating-the-kiosk.md](operating-the-kiosk.md).
When a new Release ships, the Dashboard's **Check for updates** button reads
public Release metadata and can replace the installed app in place — see
[docs/desktop-macos.md §9](desktop-macos.md) — or repeat steps 1–3 by hand with
the new DMG.
