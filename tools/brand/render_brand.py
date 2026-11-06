"""Exports the PNGs from the SVGs written by make_logo.py, using Playwright Chromium.

Usage: python tools/brand/render_brand.py
Writes public/brand/*.png, electron/build/icon.png and docs/social-preview.png.
"""
import base64
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from smoke import launch  # noqa: E402

BRAND = ROOT / "public" / "brand"
BACKDROP = ROOT / "docs" / "brand-backdrop.jpg"  # a frame of Sagittarius A* from the cinematic


def data_uri(path: pathlib.Path) -> str:
    kind = {".svg": "image/svg+xml", ".jpg": "image/jpeg"}[path.suffix]
    return f"data:{kind};base64,{base64.b64encode(path.read_bytes()).decode()}"


def export(page, svg: str, out: pathlib.Path, w: int, h: int):
    page.set_viewport_size({"width": w, "height": h})
    page.set_content(f'<body style="margin:0;background:transparent"><img src="{data_uri(BRAND / svg)}" style="display:block;width:{w}px;height:{h}px"></body>')
    page.wait_for_function("document.images[0].complete")
    page.screenshot(path=str(out), omit_background=True)
    print(out.relative_to(ROOT), f"{out.stat().st_size // 1024} KB")


def social(page, out: pathlib.Path):
    page.set_viewport_size({"width": 1280, "height": 640})
    page.set_content(f"""<body style="margin:0;width:1280px;height:640px;overflow:hidden;position:relative;background:#05070d">
      <img src="{data_uri(BACKDROP)}" style="position:absolute;inset:0;width:1280px;height:640px;object-fit:cover;object-position:50% 50%">
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse 62% 70% at 50% 50%,rgba(5,7,13,.8),rgba(5,7,13,.45) 70%,rgba(5,7,13,.2))"></div>
      <img src="{data_uri(BRAND / 'logo.svg')}" style="position:absolute;left:50%;top:50%;width:820px;transform:translate(-50%,-50%)">
    </body>""")
    page.wait_for_function("[...document.images].every(i => i.complete)")
    page.screenshot(path=str(out))
    print(out.relative_to(ROOT), f"{out.stat().st_size // 1024} KB")


def main():
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page()
        logo_w = 1600
        box = page.evaluate("s => { const d = new DOMParser().parseFromString(s, 'image/svg+xml'); return d.documentElement.getAttribute('viewBox').split(' ').map(Number); }",
                            (BRAND / "logo.svg").read_text())
        export(page, "logo.svg", BRAND / "logo.png", logo_w, round(logo_w * box[3] / box[2]))
        for size in (512, 1024):
            export(page, "logo-mark.svg", BRAND / f"logo-mark-{size}.png", size, size)
        export(page, "app-icon.svg", ROOT / "electron" / "build" / "icon.png", 1024, 1024)
        export(page, "app-icon.svg", BRAND / "apple-touch-icon.png", 180, 180)
        if BACKDROP.exists():
            social(page, ROOT / "docs" / "social-preview.png")
        browser.close()


if __name__ == "__main__":
    main()
