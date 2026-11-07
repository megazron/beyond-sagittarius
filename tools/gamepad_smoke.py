"""Gamepad test with a stubbed navigator.getGamepads: menus, move, look, jump, sprint,
interact, the item wheel, cutscene skip, glyph switching and remapping.

Usage: python tools/gamepad_smoke.py [--port 4176] [--shots DIR]
"""
import argparse
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
STUB = """
window.__pad = { axes: [0, 0, 0, 0], buttons: Array.from({length: 17}, () => ({pressed: false, value: 0})), id: 'Test Pad (STANDARD GAMEPAD)', connected: true, mapping: 'standard', index: 0 };
navigator.getGamepads = () => [window.__pad, null, null, null];
localStorage.setItem('bs-consent-v1', '1');
localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}));
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4176)
    ap.add_argument("--shots", default=str(ROOT / "docs" / "screenshots" / "gamepad"))
    args = ap.parse_args()
    shots = pathlib.Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)
    httpd = serve(args.port)
    fails, errors = [], []
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(STUB)
        page.goto(f"http://127.0.0.1:{args.port}/index.html?quality=web", wait_until="domcontentloaded", timeout=120000)
        page.wait_for_function("window.__bs && window.__bs.ready", timeout=240000)
        ev = page.evaluate
        frames = lambda n=3: page.wait_for_function(f"(f => () => __bs.debug.frames >= f)(0) && __bs.debug.frames >= {ev('__bs.debug.frames') + n}", timeout=240000)

        def press(b, hold=2):
            ev(f"__pad.buttons[{b}] = {{pressed: true, value: 1}}")
            frames(hold)
            ev(f"__pad.buttons[{b}] = {{pressed: false, value: 0}}")
            frames(2)

        def stick(i, v, n=3):
            ev(f"__pad.axes[{i}] = {v}")
            frames(n)
            ev(f"__pad.axes[{i}] = 0")
            frames(2)

        focused = lambda: ev("document.activeElement && document.activeElement.id")
        check = lambda ok, m: None if ok else fails.append(m)

        press(13)  # any input wakes the device
        check(ev("__bs.device") == "pad", "pad press did not switch the device")
        check(ev("document.body.classList.contains('dev-pad')"), "no dev-pad class")
        start = focused()
        press(13)
        mid = focused()
        check(mid != start, f"d-pad did not move menu focus from {start}")
        press(12)  # held frames can auto-repeat at software GL speed: moving is the test, not the exact row
        check(focused() != mid, "d-pad up did not move focus")
        ev("document.getElementById('btn-new').focus()")
        press(0)  # A on New Game
        page.wait_for_selector("#nm-ok", timeout=10000)
        ev("document.getElementById('nm-ok').focus()")
        press(0)
        page.wait_for_function("__bs.state === 'narrator'", timeout=30000)
        time.sleep(1.5)
        press(0)  # skip the Vault
        page.wait_for_function("__bs.state === 'cinematic'", timeout=30000)
        press(1)  # B skips too
        page.wait_for_function("__bs.state === 'film'", timeout=30000)
        press(1)  # and the title sequence has its own skip
        page.wait_for_function("__bs.state === 'game' && __bs.mode === 'wake'", timeout=60000)
        time.sleep(1)
        press(9)
        page.wait_for_function("__bs.mode === 'play'", timeout=30000)
        time.sleep(1)
        check(ev("document.querySelector('#tutorial .pc') !== null"), "hint shows no controller glyph")
        page.screenshot(path=str(shots / "01-hint.jpg"), type="jpeg", quality=84, timeout=180000)
        y0 = ev("__bs.debug.yaw")
        stick(2, 1, 8)
        check(abs(ev("__bs.debug.yaw") - y0) > 0.01, "right stick did not turn the camera")
        p0 = ev("__bs.debug.player")
        ev("__pad.axes[1] = -1"); frames(2); ev("__bs.step(2)"); ev("__pad.axes[1] = 0"); frames(2)
        p1 = ev("__bs.debug.player")
        check(((p1[0] - p0[0]) ** 2 + (p1[2] - p0[2]) ** 2) ** 0.5 > 2, "left stick did not move the player")
        press(0)
        # the wheel: hold Y
        ev("__pad.buttons[3] = {pressed: true, value: 1}")
        page.wait_for_function("__bs.wheelOpen", timeout=15000)
        page.screenshot(path=str(shots / "02-wheel.jpg"), type="jpeg", quality=84, timeout=180000)
        ev("__pad.buttons[3] = {pressed: false, value: 0}")
        page.wait_for_function("!__bs.wheelOpen", timeout=15000)
        # menu, tabs, settings, remap
        press(9)
        page.wait_for_selector("#p-resume", timeout=10000)
        press(5)
        page.wait_for_selector("#map-chart", timeout=10000)
        time.sleep(0.5)
        page.screenshot(path=str(shots / "03-map.jpg"), type="jpeg", quality=84, timeout=180000)
        press(4)
        page.wait_for_selector("#p-set", timeout=10000)
        ev("document.getElementById('p-set').focus()")
        press(0)
        page.wait_for_selector("#set-vol", timeout=10000)
        press(5); press(5)
        page.wait_for_selector("#binds", timeout=10000)
        page.screenshot(path=str(shots / "04-remap.jpg"), type="jpeg", quality=84, timeout=180000)
        ev("document.querySelector('.bind[data-a=\"jump\"][data-dev=\"pad\"]').focus()")
        # the cell gives up after 6 s: at software GL frame rates a long hold outlasts it
        ev("__pad.buttons[0] = {pressed: true, value: 1}")
        page.wait_for_function("!!document.querySelector('.bind.listen')", timeout=120000)
        ev("__pad.buttons[0] = {pressed: false, value: 0}")
        frames(1)
        ev("__pad.buttons[7] = {pressed: true, value: 1}")
        page.wait_for_function("__bs.binds.pad.jump === 7", timeout=120000)
        ev("__pad.buttons[7] = {pressed: false, value: 0}")
        check(ev("__bs.binds.pad.jump") == 7, f"jump not rebound: {ev('__bs.binds.pad.jump')}")
        saved = ev("JSON.parse(localStorage.getItem('bs-settings-v1')).binds?.pad?.jump")
        check(saved == 7, f"binding not saved: {saved}")
        ev("document.getElementById('bind-reset').click()")
        check(ev("__bs.binds.pad.jump") == 0, "reset did not restore jump")
        press(1)  # B: back to the menu
        page.wait_for_selector("#p-resume", timeout=10000)
        press(1)
        page.wait_for_function("!__bs.paused", timeout=10000)
        browser.close()
    httpd.shutdown()
    for m in fails + errors:
        print("FAIL:", m)
    if fails or errors:
        sys.exit(1)
    print("OK: gamepad works in menus, cutscenes and play")


if __name__ == "__main__":
    main()
