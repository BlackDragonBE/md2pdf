#!/usr/bin/env python
"""Build the twelve bundled font families into static/fonts/.

One-time procedure. Run it locally, commit the outputs, never wire it into CI
(see scripts/subset-fonts.md and DESIGN.md §7.2).

    pip install fonttools brotli
    python scripts/build_fonts.py

What it does per face:

1. Downloads the upstream TTF from google/fonts.
2. If the file is a variable font, pins every axis — `wght` to the face's
   weight, everything else to its default — so the output has no `fvar` table.
   pdfkit ignores variation axes, so a variable file would silently render
   "Bold" as Regular (DESIGN.md §7.1, pitfall 7).
3. Subsets to Latin + Latin Extended-A plus the punctuation, currency, arrow,
   geometric-shape and ballot-box ranges the default theme needs for bullets
   and task checkboxes.
4. Merges in any of the required symbol glyphs the family does not ship at all.
   Ten of the twelve have no ballot boxes (U+2610/U+2611) upstream, and several
   have no white bullet or black small square, so subsetting alone cannot keep
   what was never there — they would render as blank boxes (DESIGN.md §7.2,
   pitfall 11). The donor is Source Sans 3, scaled to the target's upem.
5. Writes static/fonts/<id>/{Regular,Bold,Italic,BoldItalic}.ttf, copies the
   licence next to it, and regenerates static/fonts/manifest.json.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

from fontTools.merge import Merger
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem
from fontTools.varLib import instancer

RAW = "https://raw.githubusercontent.com/google/fonts/main/"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "fonts"

# Latin + Latin Extended-A, general punctuation, currency, trademark, arrows,
# box drawing (tree diagrams), geometric shapes (list bullets) and ballot boxes
# (task list glyphs).
UNICODES = (
    "U+0000-00FF,U+0100-017F,U+2000-206F,U+20A0-20BF,U+2122,"
    "U+2190-2193,U+2500-257F,U+25A0-25FF,U+2610,U+2611,U+2713,U+2714"
)
LAYOUT_FEATURES = ["kern", "liga", "clig"]

# Glyphs the default theme renders directly: list bullets and task checkboxes.
# Every family must end up with all of them (DESIGN.md §7.2 acceptance check).
SYMBOLS = [0x2022, 0x25E6, 0x25AA, 0x2610, 0x2611, 0x2713]

# The light box-drawing set used by `tree`-style directory diagrams, which are
# extremely common in Markdown. Only the two monospace families ship these
# upstream; everywhere else they render as blank boxes.
BOX_DRAWING = [0x2500, 0x2502, 0x250C, 0x2510, 0x2514, 0x2518, 0x251C, 0x2524, 0x252C, 0x2534, 0x253C]

# Which family donates which group. Box drawing comes from a monospace face so
# the segments share one advance width and joins line up in a run.
DONORS = [("source-sans-3", SYMBOLS), ("jetbrains-mono", BOX_DRAWING)]
REQUIRED_SYMBOLS = SYMBOLS + BOX_DRAWING

FACES = [
    ("normal", "Regular", 400, False),
    ("bold", "Bold", 700, False),
    ("italics", "Italic", 400, True),
    ("bolditalics", "BoldItalic", 700, True),
]

# id -> (display name, category, licence, upstream dir, upright file, italic file)
FAMILIES = {
    "inter": ("Inter", "sans", "OFL-1.1", "ofl/inter", "Inter[opsz,wght].ttf", "Inter-Italic[opsz,wght].ttf"),
    "source-sans-3": ("Source Sans 3", "sans", "OFL-1.1", "ofl/sourcesans3", "SourceSans3[wght].ttf", "SourceSans3-Italic[wght].ttf"),
    "lato": ("Lato", "sans", "OFL-1.1", "ofl/lato", "Lato-Regular.ttf|Lato-Bold.ttf", "Lato-Italic.ttf|Lato-BoldItalic.ttf"),
    "work-sans": ("Work Sans", "sans", "OFL-1.1", "ofl/worksans", "WorkSans[wght].ttf", "WorkSans-Italic[wght].ttf"),
    "source-serif-4": ("Source Serif 4", "serif", "OFL-1.1", "ofl/sourceserif4", "SourceSerif4[opsz,wght].ttf", "SourceSerif4-Italic[opsz,wght].ttf"),
    "eb-garamond": ("EB Garamond", "serif", "OFL-1.1", "ofl/ebgaramond", "EBGaramond[wght].ttf", "EBGaramond-Italic[wght].ttf"),
    "merriweather": ("Merriweather", "serif", "OFL-1.1", "ofl/merriweather", "Merriweather[opsz,wdth,wght].ttf", "Merriweather-Italic[opsz,wdth,wght].ttf"),
    "lora": ("Lora", "serif", "OFL-1.1", "ofl/lora", "Lora[wght].ttf", "Lora-Italic[wght].ttf"),
    "jetbrains-mono": ("JetBrains Mono", "mono", "OFL-1.1", "ofl/jetbrainsmono", "JetBrainsMono[wght].ttf", "JetBrainsMono-Italic[wght].ttf"),
    "ibm-plex-mono": ("IBM Plex Mono", "mono", "OFL-1.1", "ofl/ibmplexmono", "IBMPlexMono-Regular.ttf|IBMPlexMono-Bold.ttf", "IBMPlexMono-Italic.ttf|IBMPlexMono-BoldItalic.ttf"),
    "playfair-display": ("Playfair Display", "display", "OFL-1.1", "ofl/playfairdisplay", "PlayfairDisplay[wght].ttf", "PlayfairDisplay-Italic[wght].ttf"),
    "bitter": ("Bitter", "display", "OFL-1.1", "ofl/bitter", "Bitter[wght].ttf", "Bitter-Italic[wght].ttf"),
}

_cache: dict[str, bytes] = {}


def fetch(path: str) -> bytes:
    if path not in _cache:
        url = RAW + path
        print(f"  fetch {url}")
        with urllib.request.urlopen(url) as response:
            _cache[path] = response.read()
    return _cache[path]


def pick_source(spec: str, weight: int) -> str:
    """`a.ttf|b.ttf` means separate static files for regular and bold."""
    parts = spec.split("|")
    return parts[0] if len(parts) == 1 else parts[0 if weight < 500 else 1]


def make_static(raw: bytes, weight: int) -> TTFont:
    font = TTFont(io.BytesIO(raw))
    if "fvar" not in font:
        return font

    # Pin every axis, not just wght: a partially instanced font keeps its fvar
    # table and pdfkit would still render the default instance.
    location = {}
    for axis in font["fvar"].axes:
        if axis.axisTag == "wght":
            location["wght"] = max(axis.minValue, min(axis.maxValue, weight))
        else:
            location[axis.axisTag] = axis.defaultValue

    static = instancer.instantiateVariableFont(font, location, inplace=False, updateFontNames=True)
    assert "fvar" not in static, "instancing left variation axes behind"
    return static


def subset(font: TTFont, target: Path) -> None:
    codepoints = parse_unicodes(UNICODES)

    # Box drawing is all-or-nothing. Lato ships the straight segments but not
    # the junctions, and its own segments are a different advance width from the
    # donor's — keeping the partial set would leave tree diagrams with lines
    # that do not join. If the family cannot do the whole set, drop what it has
    # and let the graft pass supply a consistent one.
    cmap = font.getBestCmap()
    if not all(c in cmap for c in BOX_DRAWING):
        box = set(range(0x2500, 0x2580))
        codepoints = [c for c in codepoints if c not in box]

    options = Options()
    options.layout_features = LAYOUT_FEATURES
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.notdef_outline = True
    options.recalc_bounds = True
    options.drop_tables += ["DSIG"]

    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)

    target.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = None
    font.save(target)


def graft_symbols(target: Path, donor_path: Path, wanted: list[int]) -> list[str]:
    """Merge any of `wanted` the family lacks in from the donor face."""
    font = TTFont(target)
    missing = [c for c in wanted if c not in font.getBestCmap()]
    if not missing:
        return []

    upem = font["head"].unitsPerEm
    font.close()

    donor = TTFont(donor_path)
    options = Options()
    options.layout_features = []
    options.notdef_outline = True
    options.drop_tables += ["DSIG"]
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=missing)
    subsetter.subset(donor)
    scale_upem(donor, upem)

    with tempfile.TemporaryDirectory() as tmp:
        donor_file = os.path.join(tmp, "donor.ttf")
        donor.save(donor_file)
        merged = Merger().merge([str(target), donor_file])
        merged.save(str(target))

    check = TTFont(target)
    still = [c for c in missing if c not in check.getBestCmap()]
    assert not still, f"{target}: could not graft {[hex(c) for c in still]}"
    return [f"U+{c:04X}" for c in missing]


def parse_unicodes(spec: str) -> list[int]:
    out: list[int] = []
    for chunk in spec.split(","):
        chunk = chunk.strip().removeprefix("U+")
        if "-" in chunk:
            lo, hi = chunk.split("-")
            out.extend(range(int(lo, 16), int(hi, 16) + 1))
        else:
            out.append(int(chunk, 16))
    return out


def build() -> None:
    manifest: dict[str, dict] = {}

    # Build every family first, then graft. The donors need glyphs from each
    # other — Source Sans 3 has no box drawing, JetBrains Mono no ballot boxes —
    # so any single build order would need a donor that does not exist yet.
    for font_id in FAMILIES:
        name, category, licence, directory, upright, italic = FAMILIES[font_id]
        print(f"{name} ({font_id})")
        files: dict[str, str] = {}

        for face_key, face_name, weight, is_italic in FACES:
            spec = italic if is_italic else upright
            source = pick_source(spec, weight)
            raw = fetch(f"{directory}/{source}")
            static = make_static(raw, weight)
            target = OUT / font_id / f"{face_name}.ttf"
            subset(static, target)
            files[face_key] = f"{font_id}/{face_name}.ttf"
            print(f"  {face_name:<11} {target.stat().st_size / 1024:7.1f} KB  <- {source}")

        licence_name = "OFL.txt"
        try:
            licence_bytes = fetch(f"{directory}/{licence_name}")
        except Exception:
            licence_name = "LICENSE.txt"
            licence_bytes = fetch(f"{directory}/{licence_name}")
        (OUT / font_id / licence_name).write_bytes(licence_bytes)

        manifest[font_id] = {
            "name": name,
            "category": category,
            "license": licence,
            "url": f"https://github.com/google/fonts/tree/main/{directory}",
            "files": files,
            # Filled in after grafting, once the bytes are final.
            "version": "",
        }

    print("\nGrafting missing symbols")
    for font_id in FAMILIES:
        grafted: list[str] = []
        for _, face_name, _, _ in FACES:
            target = OUT / font_id / f"{face_name}.ttf"
            for donor_id, wanted in DONORS:
                if font_id == donor_id:
                    continue
                grafted += graft_symbols(target, OUT / donor_id / f"{face_name}.ttf", wanted)
        if grafted:
            unique = sorted(set(grafted))
            print(f"  {font_id:<18} +{len(unique)} per face: {' '.join(unique)}")

    # Content version per family, so a rebuild actually reaches people who have
    # already visited. Both the IndexedDB key and the request URL carry it:
    # keyed on the path alone, the browser keeps serving the previously cached
    # bytes forever and a font fix silently never ships.
    for font_id, entry in manifest.items():
        digest = hashlib.sha256()
        for face_name in ("Regular", "Bold", "Italic", "BoldItalic"):
            digest.update((OUT / font_id / f"{face_name}.ttf").read_bytes())
        entry["version"] = digest.hexdigest()[:8]

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    total = sum(p.stat().st_size for p in OUT.rglob("*.ttf"))
    print(f"\nmanifest.json written. {len(manifest)} families, {total / 1024 / 1024:.2f} MB of TTF.")


if __name__ == "__main__":
    if shutil.which("python") is None:
        sys.exit("python not found")
    build()
