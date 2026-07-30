#!/usr/bin/env python
"""Pack the Twemoji SVG set into static/emoji/ for colour emoji in the PDF.

One-time procedure, same deal as build_fonts.py: run it locally, commit the
outputs, never wire it into CI.

    python scripts/build_emoji.py

Why artwork and not a font: PDF has no colour-font concept, so pdfkit can only
ever embed monochrome outlines. The one route to colour is drawing the emoji as
artwork inline with the text, which needs patches/pdfmake+0.2.23.patch.

Why SVG and not a PNG sprite sheet: vector stays sharp in print, and it keeps
the invariant that a generated PDF embeds no image XObjects.

Why one archive and not 3,720 loose files: `globPatterns` in vite.config.ts
includes `svg`, so loose files would be *precached on first visit* — the exact
opposite of lazy. One archive matches no glob and is fetched only when a
document actually contains an emoji.

The extension is `.bin`, not `.gz`, on purpose: static servers map `.gz` to
`Content-Encoding: gzip`, so the browser transparently decompresses it and the
gunzip in artwork.ts then fails on already-plain JSON. artwork.ts sniffs the
gzip magic bytes anyway, so it survives a server that does this regardless.

Why gzipped JSON and not a ZIP: a ZIP deflates each entry separately, which
throws away the redundancy between 3,720 near-identical documents — it came out
at 3.9 MB against 1.5 MB for the same files as one gzip stream. Gzip also needs
no archive parsing in the browser: fflate (already a dependency) gunzips, and
the result is a plain object.

Naming follows Twemoji: lowercase hex codepoints joined by `-`, with U+FE0F
stripped. `src/lib/emoji/artwork.ts` builds the same key from a cluster.
"""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

PACKAGE = "@twemoji/svg"
VERSION = "15.0.0"
TARBALL = f"https://registry.npmjs.org/@twemoji/svg/-/svg-{VERSION}.tgz"

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "emoji"
ARCHIVE = OUT / "twemoji.bin"
MANIFEST = OUT / "manifest.json"

# Twemoji is CC-BY 4.0. The attribution lives on the About page.
LICENSE = "CC-BY-4.0"
HOMEPAGE = "https://github.com/jdecked/twemoji"

WHITESPACE = re.compile(rb">\s+<")


def fetch(url: str) -> bytes:
    print(f"  fetch {url}")
    with urllib.request.urlopen(url) as response:
        return response.read()


def build() -> None:
    raw = fetch(TARBALL)
    print(f"  {len(raw) / 1024:.0f} KB tarball")

    svgs: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.name.endswith(".svg"):
                continue
            handle = tar.extractfile(member)
            if handle is None:
                continue
            # Cheap, lossless: Twemoji ships no gradients, masks or filters, so
            # collapsing inter-tag whitespace is the only safe win without
            # pulling in SVGO.
            svgs[Path(member.name).name] = WHITESPACE.sub(b"><", handle.read().strip())

    if not svgs:
        sys.exit("no SVGs found in the tarball")

    OUT.mkdir(parents=True, exist_ok=True)
    # Keys are the Twemoji basename without `.svg`, which is exactly the lookup
    # key artwork.ts builds from a cluster. Sorted, separators fixed and mtime
    # zeroed so identical input rebuilds to identical bytes, and therefore to an
    # identical version hash.
    payload = json.dumps(
        {name[: -len(".svg")]: svgs[name].decode("utf-8") for name in sorted(svgs)},
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    print(f"  {len(payload) / 1024 / 1024:.1f} MB of JSON before compression")

    with gzip.GzipFile(ARCHIVE, "wb", compresslevel=9, mtime=0) as gz:
        gz.write(payload)

    digest = hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()[:8]
    MANIFEST.write_text(
        json.dumps(
            {
                "file": "twemoji.bin",
                "version": digest,
                "count": len(svgs),
                "name": "Twemoji",
                "license": LICENSE,
                "url": HOMEPAGE,
                "source": f"{PACKAGE}@{VERSION}",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"\n  {len(svgs)} emoji -> {ARCHIVE.stat().st_size / 1024:.0f} KB")
    print(f"  version {digest}")
    print(f"  manifest.json written")


if __name__ == "__main__":
    build()
