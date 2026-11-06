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


def data_uri(path: pathlib.Path) -> str:
    return f"data:image/svg+xml;base64,{base64.b64encode(path.read_bytes()).decode()}"


def export(page, svg: str, out: pathlib.Path, w: int, h: int):
    page.set_viewport_size({"width": w, "height": h})
    page.set_content(f'<body style="margin:0;background:transparent"><img src="{data_uri(BRAND / svg)}" style="display:block;width:{w}px;height:{h}px"></body>')
    page.wait_for_function("document.images[0].complete")
    page.screenshot(path=str(out), omit_background=True)
    print(out.relative_to(ROOT), f"{out.stat().st_size // 1024} KB")


def social(page, out: pathlib.Path):
    """1280x640 card: seeded starfield, a soft nebula and the logo."""
    page.set_viewport_size({"width": 1280, "height": 640})
    page.set_content(f"""<body style="margin:0;width:1280px;height:640px;overflow:hidden;position:relative;
        background:radial-gradient(ellipse 46% 60% at 58% 44%,rgba(255,150,70,.20),transparent 70%),
                   radial-gradient(ellipse 60% 80% at 30% 62%,rgba(96,60,190,.26),transparent 72%),
                   radial-gradient(ellipse 50% 70% at 84% 30%,rgba(40,130,200,.18),transparent 70%),#05070d">
      <canvas id="s" width="1280" height="640" style="position:absolute;inset:0"></canvas>
      <img src="{data_uri(BRAND / 'logo.svg')}" style="position:absolute;left:50%;top:50%;width:860px;transform:translate(-50%,-50%);filter:drop-shadow(0 0 30px rgba(120,200,255,.3))">
      <script>
        let seed = 2189; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const c = document.getElementById('s').getContext('2d');
        for (let i = 0; i < 700; i++) {{
          const m = r() ** 3, tint = r();
          c.fillStyle = tint < .15 ? '#ffd9b0' : tint < .35 ? '#bfe0ff' : '#ffffff';
          c.globalAlpha = .18 + m * .8;
          c.beginPath(); c.arc(r() * 1280, r() * 640, .4 + m * 1.3, 0, 7); c.fill();
        }}
      </script>
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
        social(page, ROOT / "docs" / "social-preview.png")
        browser.close()


if __name__ == "__main__":
    main()
