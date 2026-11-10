"""Downloads and packs the CC0 assets of Zenvora (the prologue city).

Everything comes from Poly Haven (CC0, https://polyhaven.com/license):
textures for facades, pavement, road and the flat's interior go to public/textures/city/<name>/,
models are fetched as 1k glTF, their textures shrunk to 512 px (mobile memory), and each is packed with
gltfpack (meshopt, quantised) into public/models/city/<name>.glb.

Usage:  python tools/fetch_city.py [--cache DIR] [--only textures,models]
"""
import argparse
import json
import pathlib
import shutil
import tempfile

from PIL import Image

import fetch_assets as fa

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEX = ROOT / "public" / "textures" / "city"
OUT = ROOT / "public" / "models" / "city"

# name: (poly haven asset, sizes)
TEXTURES = {
    "plaster": ("painted_plaster_wall", [1024, 512]),
    "peeling": ("peeling_painted_wall", [1024, 512]),
    "brick": ("painted_worn_brick", [1024, 512]),
    "pavement": ("brick_pavement_02", [1024, 512]),
    "road": ("asphalt_02", [1024, 512]),
    "shutter": ("painted_metal_shutter", [512]),
    "planks": ("brown_planks_05", [512]),
    "parapet": ("concrete_block_wall", [512]),
    "floor": ("floor_tiles_06", [1024, 512]),
    "wall_in": ("blue_plaster_wall", [512]),
}

MODELS = [
    # shopfronts and street furniture
    "rollershutter_door", "rollershutter_window_01", "street_lamp_01", "street_lamp_02", "metal_trash_can",
    "utility_box_01", "power_box_01", "fire_hydrant", "modular_street_seating", "painted_wooden_bench",
    "potted_plant_01", "potted_plant_02", "planter_box_01", "security_light", "caged_hanging_light", "trashbag",
    # stalls and the chai stall
    "plastic_monobloc_chair_01", "plastic_crate_01", "plastic_crate_02", "wooden_crate_01", "cardboard_box_01",
    "wicker_basket_01", "wicker_basket_02", "food_apple_01", "food_pomegranate_01", "food_lime_01",
    "food_pears_asian_01", "brass_pot_01", "brass_diya_lantern", "tea_set_01", "folding_wooden_stool",
    "round_wooden_table_01", "pot_enamel_01",
    # the flat
    "ceiling_fan", "sofa_02", "old_bed_frame", "drawer_cabinet", "dining_table", "dining_chair_02", "wall_clock",
    "vintage_electric_kettle", "wooden_bookshelf_worn",
]


def fetch_textures(cache: pathlib.Path, report: dict):
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
                report[str(dst.relative_to(ROOT))] = dst.stat().st_size
        print(f"texture {name}: {asset}")


def fetch_models(cache: pathlib.Path, report: dict):
    OUT.mkdir(parents=True, exist_ok=True)
    for asset in MODELS:
        src = fa.model_source(cache, asset)
        with tempfile.TemporaryDirectory() as t:
            work = pathlib.Path(t) / asset
            shutil.copytree(src, work)
            # 512 px textures: plenty for props seen at street distance, and kind to phones
            for p in (work / "textures").glob("*"):
                im = Image.open(p)
                if max(im.size) > 512:
                    im.thumbnail((512, 512), Image.LANCZOS)
                    im.save(p, quality=85) if p.suffix.lower() in (".jpg", ".jpeg") else im.save(p)
            dst = OUT / f"{asset}.glb"
            fa.gltfpack("-i", str(work / f"{asset}.gltf"), "-o", str(dst), "-c", "-kn", "-vp", "14", "-vt", "12")
            report[str(dst.relative_to(ROOT))] = dst.stat().st_size
        print(f"model {asset}: {dst.stat().st_size // 1024} KB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=str(pathlib.Path.home() / ".cache" / "bs-assets"))
    ap.add_argument("--only", default="textures,models")
    a = ap.parse_args()
    cache = pathlib.Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)
    report = {}
    if "textures" in a.only:
        fetch_textures(cache, report)
    if "models" in a.only:
        fetch_models(cache, report)
    total = sum(report.values())
    print(f"{len(report)} files, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
