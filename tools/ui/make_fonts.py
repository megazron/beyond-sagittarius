#!/usr/bin/env python3
"""Self-hosted game fonts: fetch the OFL sources from google/fonts, subset them to
the scripts the game uses and write woff2 files to public/fonts/ with OFL.txt.

Run: python tools/ui/make_fonts.py [--cache DIR]   (needs fonttools and brotli)
"""
import argparse
import io
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "fonts"
RAW = "https://raw.githubusercontent.com/google/fonts/main/ofl/"

LATIN = "U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+2013,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2032-2033,U+20AC,U+2122,U+2212"
DEVA = "U+0900-097F,U+1CD0-1CF6,U+200C-200D,U+20B9,U+25CC,U+A8E0-A8FF,U+0020-0040,U+2018-2019,U+201C-201D,U+2026"
ARAB = "U+0600-06FF,U+0750-077F,U+200C-200F,U+25CC,U+FB50-FDFF,U+FE70-FEFF,U+0020-0040,U+2018-2019,U+201C-201D,U+2026"

# out name, family dir, file, unicode set, axis limits
FONTS = [
    ("vt323", "vt323", "VT323-Regular.ttf", LATIN, None),
    ("barlow-condensed-500", "barlowcondensed", "BarlowCondensed-Medium.ttf", LATIN, None),
    ("barlow-condensed-600", "barlowcondensed", "BarlowCondensed-SemiBold.ttf", LATIN, None),
    ("barlow-500", "barlow", "Barlow-Medium.ttf", LATIN, None),
    ("courier-prime-400", "courierprime", "CourierPrime-Regular.ttf", LATIN, None),
    ("courier-prime-700", "courierprime", "CourierPrime-Bold.ttf", LATIN, None),
    ("rajdhani-500", "rajdhani", "Rajdhani-Medium.ttf", DEVA, None),
    ("rajdhani-700", "rajdhani", "Rajdhani-Bold.ttf", DEVA, None),
    ("noto-sans-devanagari", "notosansdevanagari", "NotoSansDevanagari[wdth,wght].ttf", DEVA, {"wdth": 100, "wght": (400, 700)}),
    ("tiro-devanagari-hindi", "tirodevanagarihindi", "TiroDevanagariHindi-Regular.ttf", DEVA, None),
    ("noto-naskh-arabic", "notonaskharabic", "NotoNaskhArabic[wght].ttf", ARAB, {"wght": (400, 700)}),
    ("noto-nastaliq-urdu", "notonastaliqurdu", "NotoNastaliqUrdu[wght].ttf", ARAB, {"wght": (400, 700)}),
]


def fetch(cache: pathlib.Path, rel: str) -> pathlib.Path:
    path = cache / rel.replace("/", "_")
    if not path.exists():
        url = RAW + urllib.parse.quote(rel)
        for attempt in range(8):  # DNS drops out on this box
            try:
                path.write_bytes(urllib.request.urlopen(url, timeout=60).read())
                break
            except urllib.error.URLError:
                if attempt == 7:
                    raise
                time.sleep(4)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="/tmp/bs-fonts")
    args = ap.parse_args()
    cache = pathlib.Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    licences = {}
    for name, fam, file, uni, limits in FONTS:
        src = fetch(cache, f"{fam}/{file}")
        licences[fam] = fetch(cache, f"{fam}/OFL.txt").read_text(encoding="utf-8")
        font = TTFont(src)
        if limits:
            font = instancer.instantiateVariableFont(font, limits)
            buf = io.BytesIO()
            font.save(buf)  # reload: the instancer leaves lazy tables the subsetter trips on
            buf.seek(0)
            font = TTFont(buf, lazy=False)
        opt = subset.Options()
        opt.layout_features = ["*"]
        opt.flavor = "woff2"
        opt.name_IDs = ["*"]
        opt.notdef_outline = True
        sub = subset.Subsetter(opt)
        sub.populate(unicodes=subset.parse_unicodes(uni))
        sub.subset(font)
        font.flavor = "woff2"
        dest = OUT / f"{name}.woff2"
        font.save(dest)
        print(f"{dest.name}: {dest.stat().st_size // 1024} KB")
    text = "Game fonts, subset from the SIL Open Font License originals. No Reserved Font Name is declared by these families.\n"
    for fam, lic in licences.items():
        text += f"\n\n===== {fam} =====\n\n{lic}"
    (OUT / "OFL.txt").write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
