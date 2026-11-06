"""Re-downloads and re-encodes every external graphics asset used by the game.

All sources are CC0 (Poly Haven, https://polyhaven.com/license). The script
pulls the 2k JPG maps from the Poly Haven API, resizes them to the sizes each
quality preset uses and writes WebP files into public/textures/. It also
downloads the 1k HDRI into public/hdri/ and bakes the tileable water normal
map (generated here from an FFT wave spectrum, no external source).

Scanned models: every model in MODELS is downloaded as glTF, split into its
single rocks or plants, centred, decimated to three LODs with gltfpack and
packed into public/models/world/pack_lod{0,1,2}.glb (quantised, meshopt
compressed) with a manifest.json. Their textures go to public/textures/m/.

Foliage: real twig and leaf scans are cut out of their sheets and composed into
branch cards (public/textures/foliage/).

--desktop instead writes the 4K maps of every texture set to desktop-assets/
(gitignored, shipped only with the Windows build).

Usage:  python tools/fetch_assets.py [--cache DIR] [--only textures,models,foliage,hdri,water,erosion] [--desktop]
Needs:  pip install pillow numpy scipy; node (runs gltfpack through npx)
"""
import argparse
import json
import pathlib
import shutil
import struct
import subprocess
import tempfile
import time
import urllib.request

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEX = ROOT / "public" / "textures"
MODELS_OUT = ROOT / "public" / "models" / "world"
DESKTOP = ROOT / "desktop-assets"
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
# Bark of the fir and of the pine scans replaces the old generic bark for the forest.
TEXTURES["bark_fir"] = ("fir_tree_01", ["bark_diff", "bark_nor_gl"], [1024, 512])
HDRIS = {"sky": ("misty_pines", "1k")}

# out name, Poly Haven id, node filter (None = whole file), kind, LOD triangle targets.
ROCK, BIG, WOOD, PLANT = (5000, 1300, 280), (9000, 2600, 700), (4500, 1200, 280), (2400, 900, 260)
MODELS = [
    ("boulder_a", "boulder_01", None, "rock", ROCK),
    ("boulder_b", "namaqualand_boulder_03", None, "rock", ROCK),
    ("boulder_c", "namaqualand_boulder_04", None, "rock", ROCK),
    ("moss_a", "rock_moss_set_01", "rock01", "rock", ROCK),
    ("moss_b", "rock_moss_set_01", "rock04", "rock", ROCK),
    ("moss_c", "rock_moss_set_01", "rock05", "rock", ROCK),
    ("moss_d", "rock_moss_set_02", "rock12", "rock", ROCK),
    ("moss_e", "rock_moss_set_02", "rock10", "rock", ROCK),
    ("outcrop_a", "rock_face_01", None, "outcrop", BIG),
    ("outcrop_b", "rock_face_02", None, "outcrop", BIG),
    ("outcrop_c", "mountainside", None, "outcrop", BIG),
    ("outcrop_d", "namaqualand_cliff_01", None, "outcrop", BIG),
    ("stump_a", "tree_stump_01", None, "stump", WOOD),
    ("stump_b", "tree_stump_02", None, "stump", WOOD),
    ("log_a", "dead_tree_trunk", None, "log", WOOD),
    ("log_b", "dead_tree_trunk_02", None, "log", WOOD),
    ("roots_a", "pine_roots", "pine_roots_a", "roots", WOOD),
    ("roots_b", "root_cluster_01", None, "roots", WOOD),
    ("branch_a", "dry_branches_medium_01", "_a", "branch", (1500, 500, 120)),
    ("branch_b", "dry_branches_medium_01", "_b", "branch", (1500, 500, 120)),
    ("fern_a", "fern_02", "_b", "plant", PLANT),
    ("fern_b", "fern_02", "_c", "plant", PLANT),
    ("fern_c", "fern_02", "_a", "plant", PLANT),
    ("shrub_a", "shrub_02", "_a", "shrub", (3500, 1400, 400)),
    ("shrub_b", "shrub_02", "_b", "shrub", (3500, 1400, 400)),
    ("shrub_c", "shrub_02", "_c", "shrub", (3500, 1400, 400)),
    ("nettle_a", "nettle_plant", "tall_a", "plant", PLANT),
    ("nettle_b", "nettle_plant", "medium_a", "plant", PLANT),
    ("weed_a", "weed_plant_02", "_a_", "plant", PLANT),
    ("weed_b", "weed_plant_02", "_b_", "plant", PLANT),
]
MAT_PREFIX = {"pine_roots": "a_"}  # models with several texture sets: the one MODELS uses
ALPHA_SETS = {"fern_02", "shrub_02", "nettle_plant", "weed_plant_02"}

# Foliage cards: sheet with twig or leaf scans -> composed card
FOLIAGE = {
    "fir": ("fir_tree_01", "twig", "fir"),
    "pine": ("pine_tree_01", "twig", "pine"),
    "leaf": ("island_tree_01", "leaves", "leaf"),
}
API_MAP = {"diff": "Diffuse", "nor": "nor_gl", "arm": "arm"}
QUALITY = {"diff": 82, "nor": 88, "arm": 80}


def size_name(s: int) -> str:
    return f"{s // 1024}k" if s >= 1024 else str(s)


def get(url: str) -> bytes:
    for attempt in range(8):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                return r.read()
        except OSError as e:
            if attempt == 7:
                raise
            print("  retry", url, e)
            time.sleep(4 + attempt * 4)
    raise RuntimeError(url)


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
            key = API_MAP.get(m, m)
            short = "diff" if "diff" in m else "nor" if "nor" in m else m
            src = cached(cache, files[key]["2k"]["jpg"]["url"])
            img = Image.open(src).convert("RGB")
            for s in sizes:
                dst = out / f"{short}_{size_name(s)}.webp"
                im = img if img.width == s else img.resize((s, s), Image.LANCZOS)
                im.save(dst, "WEBP", quality=QUALITY[short], method=6)
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


# ---------- scanned models ----------

COMP = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_accessor(g: dict, bins: list, i: int) -> np.ndarray:
    a = g["accessors"][i]
    v = g["bufferViews"][a["bufferView"]]
    dt = np.dtype(COMP[a["componentType"]])
    n = NCOMP[a["type"]]
    off = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = v.get("byteStride", dt.itemsize * n)
    raw = np.frombuffer(bins[v["buffer"]], np.uint8, count=(a["count"] - 1) * stride + dt.itemsize * n, offset=off)
    if stride == dt.itemsize * n:
        return raw.view(dt).reshape(a["count"], n).copy()
    return np.lib.stride_tricks.as_strided(raw[: 0 + dt.itemsize * n].view(dt), (a["count"], n), (stride, dt.itemsize)).copy()


def node_matrix(n: dict) -> np.ndarray:
    if "matrix" in n:
        return np.array(n["matrix"], np.float64).reshape(4, 4).T
    x, y, z, w = n.get("rotation", [0, 0, 0, 1])
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4)
    m[:3, :3] = r * np.array(n.get("scale", [1, 1, 1]))
    m[:3, 3] = n.get("translation", [0, 0, 0])
    return m


def model_source(cache: pathlib.Path, asset: str) -> pathlib.Path:
    """Downloads the 1k glTF of a model; returns its folder."""
    d = cache / "models" / asset
    f = d / f"{asset}.gltf"
    if f.exists():
        return d
    info = json.loads(get(API + asset))["gltf"]["1k"]["gltf"]
    (d / "textures").mkdir(parents=True, exist_ok=True)
    for rel, v in info["include"].items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(get(v["url"]))
    f.write_bytes(get(info["url"]))
    return d


def extract(d: pathlib.Path, asset: str, node_filter) -> dict:
    """Merges the selected nodes of a glTF into one centred, grounded mesh."""
    g = json.loads((d / f"{asset}.gltf").read_text())
    bins = [(d / b["uri"]).read_bytes() for b in g["buffers"]]
    P, N, U, I, base = [], [], [], [], 0
    for n in g["nodes"]:
        if "mesh" not in n or (node_filter and node_filter not in n.get("name", "")):
            continue
        m = node_matrix(n)
        for prim in g["meshes"][n["mesh"]]["primitives"]:
            at = prim["attributes"]
            p = read_accessor(g, bins, at["POSITION"]).astype(np.float64)
            nr = read_accessor(g, bins, at["NORMAL"]).astype(np.float64)
            uv = read_accessor(g, bins, at["TEXCOORD_0"]).astype(np.float64)
            ix = read_accessor(g, bins, prim["indices"]).astype(np.uint32).ravel()
            p = p @ m[:3, :3].T + m[:3, 3]
            nr = nr @ np.linalg.inv(m[:3, :3])
            nr /= np.maximum(np.linalg.norm(nr, axis=1, keepdims=True), 1e-9)
            P.append(p); N.append(nr); U.append(uv); I.append(ix + base)
            base += len(p)
    p = np.concatenate(P)
    lo, hi = p.min(0), p.max(0)
    p -= np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    return {"p": p.astype(np.float32), "n": np.concatenate(N).astype(np.float32), "uv": np.concatenate(U).astype(np.float32), "i": np.concatenate(I)}


def write_glb(path: pathlib.Path, meshes: dict):
    """Minimal GLB: one node, mesh and material per named entry."""
    g = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [], "materials": [], "accessors": [], "bufferViews": [], "buffers": [{}]}
    blob = bytearray()

    def add(arr: np.ndarray, ctype: int, typ: str, target: int, bounds=False):
        while len(blob) % 4:
            blob.append(0)
        g["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": arr.nbytes, "target": target})
        blob.extend(arr.tobytes())
        a = {"bufferView": len(g["bufferViews"]) - 1, "componentType": ctype, "count": len(arr) if arr.ndim > 1 else arr.size, "type": typ}
        if bounds:
            a["min"], a["max"] = arr.min(0).tolist(), arr.max(0).tolist()
        g["accessors"].append(a)
        return len(g["accessors"]) - 1

    for name, m in meshes.items():
        prim = {"attributes": {"POSITION": add(m["p"], 5126, "VEC3", 34962, True), "NORMAL": add(m["n"], 5126, "VEC3", 34962), "TEXCOORD_0": add(m["uv"], 5126, "VEC2", 34962)},
                "indices": add(m["i"].astype(np.uint32), 5125, "SCALAR", 34963), "material": len(g["materials"])}
        g["materials"].append({"name": name})
        g["meshes"].append({"name": name, "primitives": [prim]})
        g["nodes"].append({"name": name, "mesh": len(g["meshes"]) - 1})
        g["scenes"][0]["nodes"].append(len(g["nodes"]) - 1)
    while len(blob) % 4:
        blob.append(0)
    g["buffers"][0]["byteLength"] = len(blob)
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(blob)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))


def read_glb(path: pathlib.Path) -> dict:
    data = path.read_bytes()
    jlen = struct.unpack_from("<I", data, 12)[0]
    g = json.loads(data[20:20 + jlen])
    bins = [data[20 + jlen + 8:]]
    prim = g["meshes"][0]["primitives"][0]
    at = prim["attributes"]
    return {"p": read_accessor(g, bins, at["POSITION"]), "n": read_accessor(g, bins, at["NORMAL"]), "uv": read_accessor(g, bins, at["TEXCOORD_0"]), "i": read_accessor(g, bins, prim["indices"]).ravel().astype(np.uint32)}


def gltfpack(*args):
    subprocess.run(["npx", "--yes", "gltfpack", *args], check=True, capture_output=True, cwd=pathlib.Path.home())


def fetch_models(cache: pathlib.Path, report: dict):
    MODELS_OUT.mkdir(parents=True, exist_ok=True)
    lods: list[dict] = [{}, {}, {}]
    manifest = {}
    with tempfile.TemporaryDirectory() as tmp:
        t = pathlib.Path(tmp)
        for name, asset, node, kind, targets in MODELS:
            d = model_source(cache, asset)
            m = extract(d, asset, node)
            tris = len(m["i"]) // 3
            write_glb(t / "src.glb", {name: m})
            for k, target in enumerate(targets):
                ratio = min(1.0, target / tris)
                out = t / f"{name}_{k}.glb"
                gltfpack("-i", str(t / "src.glb"), "-o", str(out), "-noq", "-kv", "-si", f"{ratio:.5f}", "-se", ("0.02", "0.06", "0.25")[k], "-sv", *(["-sa"] if k == 2 else []))
                lods[k][name] = read_glb(out)
            p = m["p"]
            manifest[name] = {
                "set": asset, "kind": kind, "alpha": asset in ALPHA_SETS,
                "radius": round(float(np.hypot(p[:, 0], p[:, 2]).max()), 3), "height": round(float(p[:, 1].max()), 3),
                "tris": [len(lods[k][name]["i"]) // 3 for k in range(3)], "source": f"https://polyhaven.com/a/{asset}",
            }
            print(f"model {name}: {asset} {tris} -> {manifest[name]['tris']}")
        for k in range(3):
            raw = t / f"pack{k}.glb"
            dst = MODELS_OUT / f"pack_lod{k}.glb"
            write_glb(raw, lods[k])
            gltfpack("-i", str(raw), "-o", str(dst), "-c", "-kn", "-km", "-kv", "-vp", "14", "-vt", "12", "-vn", "8")
            report[str(dst.relative_to(ROOT))] = dst.stat().st_size
    (MODELS_OUT / "manifest.json").write_text(json.dumps(manifest, indent=0))


def fetch_model_textures(cache: pathlib.Path, report: dict):
    for asset in sorted({m[1] for m in MODELS}):
        model_textures(cache, asset, TEX / "m" / asset, [1024, 512], report)


def model_textures(cache: pathlib.Path, asset: str, out: pathlib.Path, sizes: list, report: dict, res: str = "1k"):
    d = model_source(cache, asset) if res == "1k" else None
    out.mkdir(parents=True, exist_ok=True)
    files = json.loads(get(API + asset))

    def load(key: str, alt: str) -> Image.Image:
        if d is not None and (d / "textures" / f"{asset}_{alt}_1k.jpg").exists():
            return Image.open(d / "textures" / f"{asset}_{alt}_1k.jpg")
        return Image.open(cached(cache, files[key][res]["jpg"]["url"]))

    pre = MAT_PREFIX.get(asset, "")
    diff = load(f"{pre}diff" if pre else "Diffuse", f"{pre}diff").convert("RGB")
    nor = load(f"{pre}nor_gl", f"{pre}nor_gl").convert("RGB")
    alpha = None
    if asset in ALPHA_SETS:
        alpha = Image.open(cached(cache, files["Alpha"][res]["png"]["url"])).convert("L")
    for s in sizes:
        im = diff.resize((s, s), Image.LANCZOS)
        if alpha is not None:
            im = im.convert("RGBA")
            im.putalpha(alpha.resize((s, s), Image.LANCZOS))
        dst = out / f"diff_{size_name(s)}.webp"
        im.save(dst, "WEBP", quality=78, method=6, exact=True)
        report[str(dst.relative_to(ROOT))] = dst.stat().st_size
        dst = out / f"nor_{size_name(s)}.webp"
        nor.resize((s, s), Image.LANCZOS).save(dst, "WEBP", quality=80, method=6)
        report[str(dst.relative_to(ROOT))] = dst.stat().st_size


# ---------- foliage cards ----------

def sprites(diff: Image.Image, alpha: Image.Image, min_area: int, top_frac=1.0, left_frac=0.0):
    """Cuts the separate twigs or leaves out of a scan sheet."""
    a = np.asarray(alpha.convert("L")) > 100
    h, w = a.shape
    a = a.copy()
    a[int(h * top_frac):, :] = False
    a[:, : int(w * left_frac)] = False
    lab, n = ndimage.label(ndimage.binary_dilation(a, iterations=2))
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if (lab[sl] == i + 1).sum() < min_area:
            continue
        box = (sl[1].start, sl[0].start, sl[1].stop, sl[0].stop)
        c = diff.crop(box).convert("RGBA")
        c.putalpha(alpha.convert("L").crop(box).point(lambda v: 255 if v > 128 else v * 2))
        c.putalpha(Image.fromarray(np.where(lab[sl] == i + 1, np.asarray(c.getchannel("A")), 0).astype(np.uint8)))
        out.append(c)
    return out


def stamp(card: Image.Image, spr: Image.Image, x: float, y: float, length: float, angle: float, value: float, rng):
    """Pastes a sprite whose long axis points up, base at (x, y), rotated by `angle` degrees."""
    k = length / max(spr.height, 1)
    im = spr.resize((max(1, int(spr.width * k)), max(1, int(spr.height * k))), Image.LANCZOS)
    arr = np.asarray(im).astype(np.float32)
    arr[..., :3] *= value * (1 + rng.normal(0, 0.04, 3))
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    pad = Image.new("RGBA", (im.height * 2 + 2, im.height * 2 + 2), (0, 0, 0, 0))
    pad.alpha_composite(im, (pad.width // 2 - im.width // 2, pad.height // 2 - im.height))
    rot = pad.rotate(-angle, Image.BICUBIC)
    ox, oy = int(x - pad.width / 2), int(y - pad.height / 2)
    layer = Image.new("RGBA", card.size, (0, 0, 0, 0))
    layer.paste(rot, (ox, oy))
    card.alpha_composite(layer)


def finish_card(card: Image.Image, name: str, report: dict, sizes=(1024, 512)):
    """Bleeds colour under the transparent parts, so mip-maps don't fringe, and saves RGBA WebP."""
    arr = np.asarray(card).astype(np.float32)
    a = arr[..., 3] > 8
    idx = ndimage.distance_transform_edt(~a, return_distances=False, return_indices=True)
    rgb = arr[..., :3][idx[0], idx[1]]
    out = TEX / "foliage"
    out.mkdir(parents=True, exist_ok=True)
    full = Image.fromarray(np.dstack([rgb, arr[..., 3]]).astype(np.uint8), "RGBA")
    for s in sizes:
        dst = out / f"{name}_{size_name(s)}.webp"
        h = s * card.height // card.width
        full.resize((s, h), Image.LANCZOS).save(dst, "WEBP", quality=82, alpha_quality=92, method=6, exact=True)
        report[str(dst.relative_to(ROOT))] = dst.stat().st_size


def clean(spr: list, leafy: bool) -> list:
    """Drops what isn't a twig or leaf: bark patches, sticks and pale filler quads in the sheets."""
    keep = []
    for c in spr:
        a = np.asarray(c).astype(np.float32)
        m = a[..., 3] > 128
        if m.sum() < 500:
            continue
        rgb = a[m][:, :3]
        fill = m.mean()
        green = rgb[:, 1].mean() / max(rgb[:, 2].mean(), 1)
        if rgb.mean() > 150 or green < 1.05 or (not leafy and (fill > 0.5 or min(c.size) < 60)):
            continue
        if not leafy and c.width > c.height:
            c = c.rotate(90, expand=True)
        keep.append(c)
    return keep


def fir_card(spr: list, rng, reach_k=1.0) -> Image.Image:
    """Fir bough: a stem carrying alternating twigs, dark inner layer first. Left half: bough. Right half: spray."""
    W, H = 2048, 2048
    card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    spr = sorted(spr, key=lambda s: -s.height)
    for cx, n, reach in ((W * 0.25, 30, 560), (W * 0.75, 22, 440)):
        reach *= reach_k
        for layer, value in ((0, 0.5), (1, 0.95)):
            for i in range(n):
                t = i / (n - 1)
                y = H * 0.985 - t * H * 0.9
                s = spr[int(rng.integers(0, len(spr)))]
                side = 1 if (i + layer) % 2 else -1
                L = reach * (1 - t * 0.68) * rng.uniform(0.85, 1.12) * (1.1 if layer == 0 else 1)
                ang = side * rng.uniform(30, 58) * (1 - 0.3 * t)
                stamp(card, s, cx + rng.normal(0, 8), y, L, ang, value * rng.uniform(0.82, 1.12), rng)
        stamp(card, spr[0], cx, H * 0.17, 300, rng.normal(0, 4), 1.0, rng)
    return card


def leaf_card(spr: list, rng) -> Image.Image:
    """Left half: a leafy twig. Right half: a dense round cluster for crown volume."""
    W, H = 2048, 2048
    card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for i in range(110):
        t = rng.uniform(0, 1)
        s = spr[int(rng.integers(0, len(spr)))]
        y = H * 0.98 - t * H * 0.94
        off = rng.normal(0, 150 * (1.1 - t))
        stamp(card, s, W * 0.25 + off, y, rng.uniform(150, 230), (1 if off > 0 else -1) * rng.uniform(20, 75), rng.uniform(0.62, 1.12), rng)
    for i in range(300):
        a, r = rng.uniform(0, 6.283), np.sqrt(rng.uniform(0, 1)) * 760
        s = spr[int(rng.integers(0, len(spr)))]
        stamp(card, s, W * 0.75 + np.cos(a) * r * 0.45, H / 2 + np.sin(a) * r, rng.uniform(130, 210), rng.uniform(-180, 180), rng.uniform(0.55, 1.12) * (1 - r / 2600), rng)
    return card


def fetch_foliage(cache: pathlib.Path, report: dict):
    rng = np.random.default_rng(2189)
    for name, (asset, stem, kind) in FOLIAGE.items():
        files = json.loads(get(API + asset))
        diff = Image.open(cached(cache, files[f"{stem}_diff"]["2k"]["png"]["url"])).convert("RGB")
        alpha = Image.open(cached(cache, files[f"{stem}_alpha"]["2k"]["png"]["url"]))
        if kind == "fir":
            spr = clean(sprites(diff, alpha, 4000, top_frac=0.8, left_frac=0.14), False)
            spr = sorted(spr, key=lambda c: -int((np.asarray(c.getchannel("A")) > 128).sum()))[:6]  # the rest are stems
        elif kind == "pine":
            spr = clean(sprites(diff, alpha, 4000, top_frac=0.46), False)
        else:
            spr = clean(sprites(diff, alpha, 6000), True)
        print(f"foliage {name}: {asset}, {len(spr)} sprites")
        finish_card(leaf_card(spr, rng) if kind == "leaf" else fir_card(spr, rng, 0.85 if kind == "pine" else 1.0), name, report)


def fetch_desktop(cache: pathlib.Path, report: dict):
    """4K maps for the Cinematic preset; written outside public/ and never committed."""
    for name, (asset, maps, _) in TEXTURES.items():
        files = json.loads(get(API + asset))
        out = DESKTOP / "textures" / name
        out.mkdir(parents=True, exist_ok=True)
        for m in maps:
            short = "diff" if "diff" in m else "nor" if "nor" in m else m
            img = Image.open(cached(cache, files[API_MAP.get(m, m)]["4k"]["jpg"]["url"])).convert("RGB")
            dst = out / f"{short}_4k.webp"
            img.save(dst, "WEBP", quality=QUALITY[short], method=6)
            report[str(dst.relative_to(ROOT))] = dst.stat().st_size
    for asset in sorted({m[1] for m in MODELS}):
        model_textures(cache, asset, DESKTOP / "textures" / "m" / asset, [4096], report, res="4k")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=str(ROOT / ".asset-cache"), help="where downloaded originals are kept")
    ap.add_argument("--only", default="textures,hdri,water,models,foliage,erosion", help="comma list of steps")
    ap.add_argument("--desktop", action="store_true", help="only write the 4K maps to desktop-assets/")
    args = ap.parse_args()
    cache = pathlib.Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    report: dict = {}
    steps = set(args.only.split(","))
    if args.desktop:
        fetch_desktop(cache, report)
        steps = set()
    if "textures" in steps:
        fetch_textures(cache, report)
    if "hdri" in steps:
        fetch_hdris(cache, report)
    if "water" in steps:
        bake_water(report)
    if "models" in steps:
        fetch_models(cache, report)
    if "models" in steps or "modeltex" in steps:
        fetch_model_textures(cache, report)
    if "foliage" in steps:
        fetch_foliage(cache, report)
    if "erosion" in steps:
        subprocess.run(["node", "--experimental-strip-types", "--no-warnings", "tools/bake_erosion.ts"], check=True, cwd=ROOT)
    total = 0
    for k, v in sorted(report.items()):
        print(f"{v / 1024:9.1f} KiB  {k}")
        total += v
    print(f"{total / 1024 / 1024:9.2f} MiB  total")


if __name__ == "__main__":
    main()
