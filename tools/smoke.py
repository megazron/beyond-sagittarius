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
        page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
        page.add_init_script(f"localStorage.setItem('bs-settings-v1', JSON.stringify({{lang: '{args.lang}', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: true}}))")
        page.goto(url, wait_until="domcontentloaded", timeout=120000)
        page.wait_for_function("window.__bs && window.__bs.state === 'title'", timeout=60000)
        page.wait_for_function("window.__bs.ready", timeout=240000)
        time.sleep(2)
        page.screenshot(path=str(SHOTS / f"{args.prefix}01-title.jpg"), type="jpeg", quality=86, timeout=180000)
        page.click("#btn-new")
        page.wait_for_selector("#nm-ok", timeout=10000)  # character creator
        page.click("#cc-random")
        page.click("#cc-reset")
        page.click('.seg[data-k="gender"] button[data-v="f"]')
        page.click('.seg[data-k="gender"] button[data-v="m"]')
        page.screenshot(path=str(SHOTS / f"{args.prefix}01a-creator.jpg"), type="jpeg", quality=86, timeout=180000)
        page.click("#nm-ok")
        shot = lambda name: page.screenshot(path=str(SHOTS / f"{args.prefix}{name}.jpg"), type="jpeg", quality=86, timeout=180000)
        page.wait_for_function("window.__bs.state === 'narrator' && window.__bs.vault.playing", timeout=20000)
        time.sleep(6)
        shot("01b-narrator-vault")
        page.keyboard.press("Enter")  # MegaZroN is skippable
        page.wait_for_function("window.__bs.state === 'cinematic'", timeout=20000)
        # software GL is slow, so jump the timeline to key moments instead of waiting
        page.evaluate("window.__bs.cineSeek(33.45)")
        time.sleep(6)
        shot("02b-cinematic-deck")
        # every spoken shot must keep its speaker in frame
        # wait for each shot to register: under load a frame takes seconds, and a fixed sleep skips shots unseen
        for _ in range(40):
            seen = page.evaluate("__bs.frameReport.length")
            page.evaluate("__bs.nextBeat()")
            try:
                page.wait_for_function(f"__bs.frameReport.length > {seen}", timeout=4000)
            except Exception:
                pass
            if page.evaluate("__bs.frameReport.length") >= 20:
                break
        report = page.evaluate("__bs.frameReport")
        bad = [r for r in report if abs(r["x"]) > 0.9 or abs(r["y"]) > 0.9]
        print("framed shots:", len(report), "re-aimed:", sum(1 for r in report if r["fixed"]))
        if len(report) < 10 or bad:
            errors.append(f"console.error: speaker out of frame: {bad[:3]} ({len(report)} shots)")
        page.evaluate("window.__bs.skip()")  # leave the deck scene
        time.sleep(1)
        for t, name in [(11.5, "02-cinematic-departure"), (44.5, "02c-cinematic-sgr-a"), (55.5, "02d-cinematic-event")]:
            page.evaluate(f"window.__bs.cineSeek({t})")
            time.sleep(3)
            shot(name)
        page.click("#btn-skip")
        page.wait_for_function("window.__bs.state === 'film' && window.__bs.film.playing", timeout=30000)
        # the title sequence: a frame from each act, then the skip must land on the wake-up
        for b, name in [(26, "02e-film-ring"), (40, "02f-film-scatter"), (66.5, "02g-film-landing")]:
            page.evaluate(f"window.__bs.film.seek({b})")
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
        # subtitles are independent of the game language: English game, Hindi subtitles
        print("step: settings", flush=True)
        page.keyboard.press("Escape")
        page.wait_for_selector("#p-set", timeout=10000)
        page.evaluate("document.getElementById('p-set').click()")
        page.wait_for_selector('.seg[data-seg="subLang"] button[data-v="hi"]', timeout=20000)
        page.evaluate("document.querySelector('.seg[data-seg=subLang] button[data-v=hi]').click()")
        page.evaluate("document.getElementById('m-close').click()")
        page.evaluate("document.getElementById('p-resume').click()")
        page.evaluate("__bs.sayTest('dlg.8.1')")
        sub = page.evaluate("__bs.subtitleText") or ""
        if not any("\u0900" <= c <= "\u097f" for c in sub):
            errors.append(f"console.error: subtitle language setting ignored: {sub!r}")
        if page.evaluate("document.querySelector('.obj-title').textContent") != page.evaluate("document.querySelector('.obj-title').textContent.normalize()") or any("\u0900" <= c <= "\u097f" for c in page.evaluate("document.querySelector('.obj-title').textContent")):
            errors.append("console.error: UI changed language with the subtitles")
        print("step: skins", flush=True)
        # skins menu: nothing locked is listed, and a wrong code is refused
        page.keyboard.press("Escape")
        page.wait_for_selector("#p-skins", timeout=10000)
        page.evaluate("document.getElementById('p-skins').click()")  # at 1 fps software GL the menu never reads as stable to Playwright
        page.wait_for_selector("#skin-code", timeout=10000)
        if page.locator('#skin-strong button').count() != 1:
            errors.append("console.error: a locked skin is visible")
        page.fill("#skin-code", "wrong-code")
        page.click("#skin-try")
        page.wait_for_function("document.getElementById('skin-msg').textContent.length > 0", timeout=5000)
        page.evaluate("document.getElementById('m-close').click()")
        page.wait_for_selector("#p-resume", timeout=10000)
        page.evaluate("document.getElementById('p-resume').click()")
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
    print("OK: no page errors")


if __name__ == "__main__":
    main()
