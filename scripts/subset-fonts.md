# Building the bundled fonts

**One-time, manual, run locally, outputs committed.** This is deliberately not
part of CI — CI has no Python dependency and never needs one (DESIGN.md §7.2).

```bash
pip install fonttools brotli
python scripts/build_fonts.py
```

The script writes `static/fonts/<id>/{Regular,Bold,Italic,BoldItalic}.ttf`, the
family's `OFL.txt`, and `static/fonts/manifest.json`. Commit all of it.

Current output: 12 families × 4 faces, **3.4 MB** including licences.

## What each step is for

### 1. Static instances, never variable fonts

pdfkit does not apply variation axes. Hand it `Inter[opsz,wght].ttf` and a
"Bold" request silently renders Regular. Ten of the twelve upstream families
are variable-only in `google/fonts`, so the script instantiates them with
`fontTools.varLib.instancer`, pinning **every** axis:

- `wght` to 400 or 700,
- every other axis (`opsz`, `wdth`) to its default.

Pinning only `wght` would leave a partially variable font with its `fvar` table
intact, which puts you straight back in the same hole. The script asserts
`fvar` is gone.

### 2. Subsetting

Unsubsetted this is roughly 12 MB. Subsetting to Latin + Latin Extended-A plus
the ranges the theme actually draws from brings it to 3.4 MB:

```
U+0000-00FF   Basic Latin + Latin-1
U+0100-017F   Latin Extended-A
U+2000-206F   General punctuation (dashes, quotes, bullet)
U+20A0-20BF   Currency
U+2122        Trademark
U+2190-2193   Arrows
U+25A0-25FF   Geometric shapes  ← list bullets
U+2610,U+2611 Ballot boxes      ← task-list checkboxes
U+2713,U+2714 Check marks
```

Layout features kept: `kern`, `liga`, `clig`.

### 3. Grafting the symbols the families never had

**The subset ranges alone are not enough.** Ten of the twelve families ship no
ballot boxes at all, and several have no `◦` (U+25E6) or `▪` (U+25AA). Keeping
a codepoint in the subset spec cannot preserve a glyph that was never in the
source, so those characters would render as blank boxes — pitfall 11, arrived
at from the other direction.

So the script grafts the missing glyphs in from Source Sans 3 (which has all of
them), scaling the donor to the target's units-per-em first with
`fontTools.ttLib.scaleUpem` and merging with `fontTools.merge.Merger`. The
donor family is built first for this reason. Both fonts are OFL-1.1, so the
merged output stays correctly licensed; the licence file is committed beside
each family and listed on `/licenses`.

Grafted glyphs are geometric shapes, so the visual mismatch against the host
family is negligible. If a future family needs a grafted *letterform*, do not
use this mechanism.

## Verifying after a rebuild

```bash
python - <<'PY'
from fontTools.ttLib import TTFont
from pathlib import Path
need = [0x2022, 0x25E6, 0x25AA, 0x2610, 0x2611, 0x2713, 0x00E9, 0x0161, 0x2014, 0x201C, 0x20AC]
bad = []
for d in sorted(p for p in Path('static/fonts').iterdir() if p.is_dir()):
    for face in ['Regular', 'Bold', 'Italic', 'BoldItalic']:
        f = TTFont(d / f'{face}.ttf')
        missing = [hex(c) for c in need if c not in f.getBestCmap()]
        if missing or 'fvar' in f:
            bad.append((d.name, face, missing, 'fvar' in f))
print('PROBLEMS:', bad or 'none')
PY
```

It must print `PROBLEMS: none`. Then load the app and confirm that
`theme.list.bulletChars` and the task-list glyphs render in every family — the
cmap check proves the codepoint is mapped, not that the outline is sensible.

## Adding a family

1. Add a row to `FAMILIES` in `scripts/build_fonts.py`: id, display name,
   category, licence, the `google/fonts` directory, and the upright and italic
   filenames. Use `a.ttf|b.ttf` when regular and bold are separate static files.
2. Re-run the script. `manifest.json` regenerates itself.
3. Re-run the verification above.
4. Confirm the licence is OFL-1.1 or Apache-2.0 and that the family has genuine
   bold and italic cuts. No synthesised faces.
