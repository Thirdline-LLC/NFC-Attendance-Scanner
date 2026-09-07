# Vendored fonts

Two families ship inside the bundle so the kiosk makes no network request at
boot. See the header of `fonts.css` for why, and for how to regenerate them.

| Family | Files | Upstream |
|---|---|---|
| DM Sans | `dm-sans-variable-*.woff2` | https://fonts.google.com/specimen/DM+Sans |
| Space Mono | `space-mono-*.woff2` | https://fonts.google.com/specimen/Space+Mono |

## Licensing — action needed before this is distributed

Both families are published under the **SIL Open Font License 1.1**. That
license requires the full licence text and the fonts' copyright notices to
travel with the font files whenever they are redistributed — and putting a
`.woff2` inside an app bundle, a `.apk` or an `.ipa` is redistribution.

**Neither is in this directory yet.** They were not added when the fonts were
vendored, and they are not reproduced here from memory: a licence text that is
subtly wrong is worse than an obviously missing one.

To close this, fetch the canonical files from upstream and commit them beside
the woff2s:

- The OFL 1.1 text: https://openfontlicense.org/ (or the `OFL.txt` in each
  family's Google Fonts download, which already carries its copyright line).
- The per-family copyright notice, taken from that same `OFL.txt` — do not
  transcribe it by hand.

Save them as `OFL-DM-Sans.txt` and `OFL-Space-Mono.txt`, then replace this
section with a line naming them.

This is a licence-compliance gap, not a functional one: nothing about the app
misbehaves. It is recorded here rather than left silent because the app is
headed for the iOS App Store and Google Play, and both distribute the fonts.
