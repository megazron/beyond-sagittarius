"""Downloads the CC0 surfaces of the Vault of the Last Ledger (the narrator's hall), for the game and the film.

Everything comes from Poly Haven (CC0, https://polyhaven.com/license). Each set goes to
public/textures/vault/<name>/ as diff/nor/rough webp, the layout tools/film/render_shot.py reads for 'pbr' materials.

Usage:  python tools/fetch_vault.py [--cache DIR]
"""
import argparse
import json
import pathlib

from PIL import Image

import fetch_assets as fa

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEX = ROOT / "public" / "textures" / "vault"

# name: (poly haven asset, sizes)
TEXTURES = {
    "floor": ("granite_tile_02", [1024, 512]),   # polished stone floor, tinted to basalt
    "pillar": ("granite_wall", [1024, 512]),     # the pillars and the roof ring
    "brass": ("metal_plate", [1024, 512]),       # worked metal, tinted brass: rings, caps, shelves, the orrery
    "desk": ("dark_wood", [1024, 512]),          # the writing desk
    "binding": ("brown_leather", [1024, 512]),   # the Ledger's cover
}


def bake_page():
    """The Ledger's open pages, drawn here (original): two columns of handwriting on old paper, a gutter shadow, a flat normal."""
    import random
    r = random.Random(7)
    from PIL import ImageDraw, ImageFilter
    W = H = 1024
    img = Image.new("RGB", (W, H), (232, 220, 192)); d = ImageDraw.Draw(img)
    for _ in range(9000):  # paper grain
        x, y = r.randrange(W), r.randrange(H); c = r.randrange(205, 236); d.point((x, y), (c, c - 10, c - 34))
    for y in range(44, H - 40, 26):
        for x0 in (48, 544):
            x = x0
            while x < x0 + 430:
                # one word in a running hand: a wavy stroke with loops, ascenders and descenders
                w = r.randint(18, 70); pts = []
                for i in range(w // 2 + 1):
                    t = i / max(1, w // 2); xx = x + t * w
                    yy = y + 3.2 * __import__("math").sin(i * 1.9 + x) + (-9 if r.random() < .08 else 7 if r.random() < .05 else 0)
                    pts.append((xx, yy))
                d.line(pts, fill=(48, 28, 16), width=2, joint="curve")
                x += w + r.randint(8, 16)
    for i in range(18):  # gutter shadow
        d.line([(505 + i, 0), (505 + i, H)], fill=(160 + i * 3, 148 + i * 3, 124 + i * 3), width=1)
        d.line([(536 - i, 0), (536 - i, H)], fill=(160 + i * 3, 148 + i * 3, 124 + i * 3), width=1)
    img = img.filter(ImageFilter.GaussianBlur(.6))
    out = TEX / "page"; out.mkdir(parents=True, exist_ok=True)
    img.save(out / "diff_1k.webp", "WEBP", quality=86, method=6)
    Image.new("RGB", (64, 64), (128, 128, 255)).resize((1024, 1024)).save(out / "nor_1k.webp", "WEBP", quality=90, method=6)
    print("texture page: drawn")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=str(pathlib.Path.home() / ".cache" / "bs-assets"))
    a = ap.parse_args()
    cache = pathlib.Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, (asset, sizes) in TEXTURES.items():
        files = json.loads(fa.get(fa.API + asset))
        out = TEX / name
        out.mkdir(parents=True, exist_ok=True)
        for m, short in (("Diffuse", "diff"), ("nor_gl", "nor"), ("Rough", "rough")):
            if m not in files:
                continue
            img = Image.open(fa.cached(cache, files[m]["2k"]["jpg"]["url"])).convert("RGB")
            for s in sizes:
                dst = out / f"{short}_{fa.size_name(s)}.webp"
                (img if img.width == s else img.resize((s, s), Image.LANCZOS)).save(dst, "WEBP", quality=82 if short == "diff" else 88, method=6)
                total += dst.stat().st_size
        print(f"texture {name}: {asset}")
    bake_page()
    print(f"{total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
