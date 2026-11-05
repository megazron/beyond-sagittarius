"""Re-downloads and re-encodes every external graphics asset used by the game.

All sources are CC0 (Poly Haven, https://polyhaven.com/license). The script
pulls the 2k JPG maps from the Poly Haven API, resizes them to the sizes each
quality preset uses and writes WebP files into public/textures/. It also
downloads the 1k HDRI into public/hdri/ and bakes the tileable water normal
map (generated here from an FFT wave spectrum, no external source).

Usage:  python tools/fetch_assets.py [--cache DIR]
Needs:  pip install pillow numpy
"""
import argparse
import json
import pathlib
import urllib.request

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEX = ROOT / "public" / "textures"
HDRI = ROOT / "public" / "hdri"
API = "https://api.polyhaven.com/files/"
UA = {"User-Agent": "beyond-sagittarius-fetch-assets/1.0"}

# out name -> (Poly Haven asset id, maps, sizes)
#   maps: diff (albedo, sRGB), nor (OpenGL normal), arm (AO/rough/metal)
TEXTURES = {
    "ground": ("forrest_ground_01", ["diff", "nor"], [2048, 1024, 512]),
    "dirt": ("forest_ground_04", ["diff", "nor"], [2048, 1024, 512]),
    "mud": ("mud_forest", ["diff", "nor"], [2048, 1024, 512]),
    "rock": ("rock_face_03", ["diff", "nor"], [2048, 1024, 512]),
    "bark": ("bark_brown_02", ["diff", "nor", "arm"], [1024, 512]),
    "metal": ("blue_metal_plate", ["nor", "arm"], [1024, 512]),
}
HDRIS = {"sky": ("misty_pines", "1k")}
API_MAP = {"diff": "Diffuse", "nor": "nor_gl", "arm": "arm"}
QUALITY = {"diff": 82, "nor": 88, "arm": 80}


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def cached(cache: pathlib.Path, url: str) -> pathlib.Path:
    p = cache / url.rsplit("/", 1)[-1]
    if not p.exists():
        print("  download", url)
        p.write_bytes(get(url))
    return p


def fetch_textures(cache: pathlib.Path, report: dict):
    for name, (asset, maps, sizes) in TEXTURES.items():
        files = json.loads(get(API + asset))
        out = TEX / name
        out.mkdir(parents=True, exist_ok=True)
        for m in maps:
            src = cached(cache, files[API_MAP[m]]["2k"]["jpg"]["url"])
            img = Image.open(src).convert("RGB")
            for s in sizes:
                dst = out / f"{m}_{s // 1024 if s >= 1024 else s}{'k' if s >= 1024 else ''}.webp"
                im = img if img.width == s else img.resize((s, s), Image.LANCZOS)
                im.save(dst, "WEBP", quality=QUALITY[m], method=6)
                report[str(dst.relative_to(ROOT))] = dst.stat().st_size
        print(f"{name}: {asset}")


def fetch_hdris(cache: pathlib.Path, report: dict):
    HDRI.mkdir(parents=True, exist_ok=True)
    for name, (asset, res) in HDRIS.items():
        files = json.loads(get(API + asset))
        src = cached(cache, files["hdri"][res]["hdr"]["url"])
        dst = HDRI / f"{name}_{res}.hdr"
        dst.write_bytes(src.read_bytes())
        report[str(dst.relative_to(ROOT))] = dst.stat().st_size
        print(f"hdri {name}: {asset}")


def bake_water(report: dict, n: int = 512):
    """Tileable ripple normal map from a directional wave spectrum (periodic by construction)."""
    rng = np.random.default_rng(2189)
    k = np.fft.fftfreq(n) * n
    kx, ky = np.meshgrid(k, k)
    kk = np.hypot(kx, ky) + 1e-6
    wind = np.array([0.8, 0.6])
    dirk = np.abs((kx * wind[0] + ky * wind[1]) / kk) ** 1.5
    amp = np.exp(-((kk / 70.0) ** 2)) * (kk > 2) / kk**1.9 * (0.35 + dirk)
    spec = amp * (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n)))
    h = np.real(np.fft.ifft2(spec))
    h /= np.abs(h).max()
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    s = 18.0
    nx, ny, nz = -gx * s, gy * s, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5
    out = TEX / "water"
    out.mkdir(parents=True, exist_ok=True)
    dst = out / "nor_512.webp"
    Image.fromarray((rgb * 255).astype(np.uint8)).save(dst, "WEBP", quality=90, method=6)
    report[str(dst.relative_to(ROOT))] = dst.stat().st_size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=str(ROOT / ".asset-cache"), help="where downloaded originals are kept")
    args = ap.parse_args()
    cache = pathlib.Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    report: dict = {}
    fetch_textures(cache, report)
    fetch_hdris(cache, report)
    bake_water(report)
    total = 0
    for k, v in sorted(report.items()):
        print(f"{v / 1024:9.1f} KiB  {k}")
        total += v
    print(f"{total / 1024 / 1024:9.2f} MiB  total")


if __name__ == "__main__":
    main()
