# Vendored fonts

Two families ship inside the bundle so the kiosk makes no network request at
boot. See the header of `fonts.css` for why, and for how to regenerate them.

| Family | Files | Copyright | Upstream |
|---|---|---|---|
| DM Sans | `dm-sans-variable-*.woff2` | 2014 The DM Sans Project Authors | https://github.com/googlefonts/dm-fonts |
| Space Mono | `space-mono-*.woff2` | 2016 The Space Mono Project Authors | https://github.com/googlefonts/spacemono |

## Licensing

Both are under the **SIL Open Font License 1.1**, whose second condition is
that a bundled copy carries the copyright notice and the licence with it.
Embedding a `.woff2` in an app bundle is redistribution, so this applies to
every `.ipa` and `.apk` built here, not just to the repo.

The full text lives in **`public/`**, not beside this file:

- `public/OFL-DM-Sans.txt`
- `public/OFL-Space-Mono.txt`

That location is the point. Nothing imports a `.txt`, so a copy in `src/`
would never reach `dist/` and would never leave the repo — the licence would be
absent from exactly the artefact that redistributes the fonts. Vite copies
`public/` into `dist/` verbatim, `cap sync` copies `dist/` into the native
projects, and the files are served at `/OFL-DM-Sans.txt` and
`/OFL-Space-Mono.txt`.

Both were taken verbatim from the canonical `google/fonts` repository
(`ofl/dmsans/OFL.txt`, `ofl/spacemono/OFL.txt`), which carries each family's
own copyright line. They are not transcriptions.

**If you add or replace a font, copy its `OFL.txt` into `public/` in the same
commit**, and add its copyright line to the `fonts.css` header.
