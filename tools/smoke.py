"""Headless smoke test: serves dist/, starts a new game, skips the cinematic,
checks for page errors and writes screenshots to docs/screenshots/.

Usage: python tools/smoke.py [--quality web|ultra] [--port 4173]
Requires: pip install playwright && playwright install chromium
"""
import argparse
import functools
import http.server
import pathlib
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
SHOTS = ROOT / "docs" / "screenshots"


def launch(p):
    """Launch Chromium; fall back to any installed Playwright Chromium build
    if the one pinned by this Playwright version is missing."""
    gl = ["--use-angle=vulkan", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-gpu"]
    try:
        return p.chromium.launch(args=gl)
    except Exception:
        cache = pathlib.Path.home() / ".cache" / "ms-playwright"
        for exe in sorted(cache.glob("chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell"), reverse=True) + \
                sorted(cache.glob("chromium-*/chrome-linux64/chrome"), reverse=True):
            return p.chromium.launch(args=gl, executable_path=str(exe))
        raise


def serve(port: int):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST))
    handler.log_message = lambda *a, **k: None
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    global SHOTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--quality", default="web")
    ap.add_argument("--port", type=int, default=4173)
    ap.add_argument("--lang", default="en")
    ap.add_argument("--prefix", default="")
    ap.add_argument("--cine-at", type=float, default=0, help="also grab a frame at this cinematic time")
    ap.add_argument("--out", default=str(ROOT / "docs" / "screenshots"), help="screenshot directory")
    args = ap.parse_args()
    SHOTS = pathlib.Path(args.out)
    SHOTS.mkdir(parents=True, exist_ok=True)
    httpd = serve(args.port)
    errors: list[str] = []
    url = f"http://127.0.0.1:{args.port}/index.html?quality={args.quality}"
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(viewport={"width": 1600, "height": 900})
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.add_init_script(f"localStorage.setItem('bs-settings-v1', JSON.stringify({{lang: '{args.lang}', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: true}}))")
        page.goto(url, wait_until="domcontentloaded", timeout=120000)
        page.wait_for_function("window.__bs && window.__bs.state === 'title'", timeout=60000)
        page.wait_for_function("window.__bs.ready", timeout=240000)
        time.sleep(2)
        page.screenshot(path=str(SHOTS / f"{args.prefix}01-title.jpg"), type="jpeg", quality=86)
        page.click("#btn-new")
        page.wait_for_selector("#nm-ok", timeout=10000)  # name screen: keep the default names
        page.click("#nm-ok")
        page.wait_for_function("window.__bs.state === 'cinematic'", timeout=20000)
        shot = lambda name: page.screenshot(path=str(SHOTS / f"{args.prefix}{name}.jpg"), type="jpeg", quality=86)
        # software GL is slow, so jump the timeline to key moments instead of waiting
        for t, name in [(11.5, "02-cinematic-departure"), (36.5, "02b-cinematic-deck"), (44.5, "02c-cinematic-sgr-a"), (55.5, "02d-cinematic-event")]:
            page.evaluate(f"window.__bs.cineSeek({t})")
            time.sleep(3)
            shot(name)
        page.click("#btn-skip")
        page.wait_for_function("window.__bs.state === 'game'", timeout=30000)
        page.wait_for_function("window.__bs.mode === 'wake'", timeout=30000)
        page.evaluate("window.__bs.wakeSeek(13.9)")
        time.sleep(4)
        shot("03-wakeup-sky")
        page.keyboard.press("Enter")  # skip the rest of the wake-up sequence
        page.wait_for_function("window.__bs.mode === 'play'", timeout=30000)
        time.sleep(4)
        shot("04-planet-hud")
        page.keyboard.down("KeyW")
        time.sleep(4)
        page.keyboard.up("KeyW")
        page.keyboard.press("KeyE")
        time.sleep(2)
        shot("05-explore")
        page.evaluate("window.__bs.teleport(-28, -78, 0.73)")
        time.sleep(3)
        shot("06-lake")
        page.evaluate("window.__bs.setTime(17.6)")
        page.evaluate("window.__bs.look(2.4, -0.05)")
        time.sleep(3)
        shot("07-dusk")
        page.evaluate("window.__bs.setTime(22.0)")
        page.evaluate("window.__bs.look(0.73, -0.12)")
        time.sleep(3)
        shot("08-night")
        state = page.evaluate("({state: __bs.state, mode: __bs.mode, level: __bs.level})")
        print("final state:", state)
        browser.close()
    httpd.shutdown()
    real = [e for e in errors if "fonts.g" not in e and "net::ERR" not in e]
    for e in errors:
        print(e)
    if real:
        print(f"FAILED with {len(real)} error(s)")
        sys.exit(1)
    print("OK — no page errors")


if __name__ == "__main__":
    main()
