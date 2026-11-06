"""Mobile smoke test: emulated phones (touch, small viewports, portrait and
landscape) in headless Chromium. Checks the automatic Mobile preset, the
touch overlay (joystick, drag-to-look, buttons), the touch tutorial text,
tap-friendly menus / name screen, safe layout (nothing off-screen, no page
scroll, HUD panels not overlapping) and writes screenshots.

Usage: python tools/mobile_smoke.py [--port 4175] [--shots DIR] [--device "iPhone 13"]
"""
import argparse
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent

DEVICES = [
    ("iphone13-portrait", "iPhone 13", False),
    ("pixel7-landscape", "Pixel 7", True),
]


class Touch:
    """Raw multi-touch through CDP, so the page sees real pointer/touch events."""

    def __init__(self, cdp):
        self.cdp = cdp

    def send(self, kind, pts):
        self.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in pts]})

    def drag(self, x0, y0, x1, y1, steps=12, hold=0.0, tid=1, during=None):
        self.send("touchStart", [(tid, (x0, y0))])
        for k in range(1, steps + 1):
            f = k / steps
            self.send("touchMove", [(tid, (x0 + (x1 - x0) * f, y0 + (y1 - y0) * f))])
            time.sleep(0.03)
        if during:
            during()
        if hold:
            time.sleep(hold)
        self.send("touchEnd", [])

    def tap(self, x, y):
        self.send("touchStart", [(1, (x, y))])
        time.sleep(0.05)
        self.send("touchEnd", [])


def centre(page, sel):
    try:
        page.locator(sel).wait_for(state="visible", timeout=15000)
    except Exception:
        raise AssertionError(f"{sel} hidden: " + str(page.evaluate("({s: __bs.state, m: __bs.mode, p: __bs.paused, d: __bs.device, modal: !document.getElementById('modal').classList.contains('hidden'), card: document.getElementById('modal-card').innerText.slice(0, 80), tut: __bs.tutorial})")))
    page.locator(sel).scroll_into_view_if_needed(timeout=5000)  # a real thumb scrolls the menu
    b = page.locator(sel).bounding_box()
    assert b, f"{sel} not visible"
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


LAYOUT_JS = """() => {
  const vw = innerWidth, vh = innerHeight, out = [];
  const box = (s) => { const e = document.querySelector(s); if (!e || e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return null;
    const r = e.getBoundingClientRect(); return r.width && r.height ? r : null; };
  const sels = ['.quest', '#tb-act', '#tb-inv', '#tb-pause', '#tb-codex', '#tutorial'];
  const rects = {};
  for (const s of sels) { const r = box(s); if (!r) continue; rects[s] = r;
    if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) out.push(`${s} off-screen ${JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round))}`); }
  const pairs = [['.quest', '#tb-pause'], ['#tutorial', '#tb-act'], ['#tutorial', '#tb-inv'], ['#tb-inv', '#tb-act'], ['#tutorial', '.quest'], ['.quest', '#tb-codex'], ['#tb-codex', '#tb-pause'], ['#tutorial', '#tb-codex']];
  for (const [a, b] of pairs) { const A = rects[a], B = rects[b]; if (!A || !B) continue;
    if (A.left < B.right - 2 && B.left < A.right - 2 && A.top < B.bottom - 2 && B.top < A.bottom - 2) out.push(`${a} overlaps ${b}`); }
  const se = document.scrollingElement;
  if (se.scrollWidth > vw + 1 || se.scrollHeight > vh + 1) out.push(`page scrolls ${se.scrollWidth}x${se.scrollHeight} > ${vw}x${vh}`);
  return out;
}"""


def run_device(p, tag, device_name, landscape, shots, port, failures, log):
    dev = dict(p.devices[device_name])
    if landscape:
        w, h = dev["viewport"]["width"], dev["viewport"]["height"]
        dev["viewport"] = {"width": max(w, h), "height": min(w, h)}
        dev.pop("screen", None)
    dev["device_scale_factor"] = min(2, dev.get("device_scale_factor", 2))  # software GL
    dev.pop("default_browser_type", None)
    browser = launch(p)
    ctx = browser.new_context(**dev)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.add_init_script("if (!localStorage.getItem('bs-settings-v1')) localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}))")
    touch = Touch(ctx.new_cdp_session(page))
    shot = lambda name: page.screenshot(path=str(shots / f"{tag}-{name}.jpg"), type="jpeg", quality=82)
    ev = page.evaluate
    fail = lambda m: failures.append(f"[{tag}] {m}")

    page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded", timeout=120000)
    page.wait_for_function("window.__bs && window.__bs.state === 'title'", timeout=60000)
    page.wait_for_function("window.__bs.ready", timeout=300000)
    q = ev("__bs.quality")
    log(f"[{tag}] viewport {dev['viewport']} quality {q}")
    if q != "mobile":
        fail(f"expected the Mobile preset, got {q}")
    time.sleep(1.5)
    # first launch: the safety notice and the accept, with a thumb
    page.wait_for_selector("#sf-ok", timeout=5000)
    shot("00-safety")
    box = page.locator("#safety .safety-card").bounding_box()
    if box["x"] < 0 or box["x"] + box["width"] > dev["viewport"]["width"] + 1 or box["y"] < 0 or box["y"] + box["height"] > dev["viewport"]["height"] + 1:
        fail(f"safety card off-screen: {box}")
    if page.locator("#sf-ok").bounding_box()["height"] < 40:
        fail("accept button too small to tap")
    touch.tap(*centre(page, "#sf-ok"))
    time.sleep(0.4)
    if not ev("__bs.consent") or page.locator("#sf-ok").is_visible():
        fail("safety card did not accept by touch")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("window.__bs && window.__bs.ready", timeout=300000)
    time.sleep(1)
    if page.locator("#sf-ok").is_visible():
        fail("safety card came back after accepting")
    shot("01-title")
    for m in ev(LAYOUT_JS):
        fail(f"title: {m}")
    # the title buttons must be big enough to tap
    b = page.locator("#btn-new").bounding_box()
    if b["height"] < 40:
        fail(f"New Game button only {b['height']}px tall")

    touch.tap(*centre(page, "#btn-new"))
    page.wait_for_selector("#nm-ok", timeout=10000)
    touch.tap(*centre(page, "#nm-scientist"))
    page.keyboard.type("Vortyx")
    time.sleep(0.5)
    shot("02-names")
    if ev("document.scrollingElement.scrollWidth") > ev("innerWidth") + 1:
        fail("name screen scrolls sideways")
    page.locator("#nm-ok").scroll_into_view_if_needed()
    touch.tap(*centre(page, "#nm-ok"))
    page.wait_for_function("window.__bs.state === 'narrator' && window.__bs.vault.playing", timeout=30000)
    time.sleep(3)
    shot("02b-narrator")
    touch.tap(*centre(page, "#btn-skip"))  # MegaZroN skips with a tap
    page.wait_for_function("window.__bs.state === 'cinematic'", timeout=20000)
    ev("__bs.cineSeek(11.5)")
    time.sleep(3)
    shot("03-cinematic")
    touch.tap(*centre(page, "#btn-skip"))
    page.wait_for_function("window.__bs.state === 'film'", timeout=20000)
    touch.tap(*centre(page, "#btn-skip"))  # the title sequence skips on its own tap
    page.wait_for_function("window.__bs.state === 'game' && window.__bs.mode === 'wake'", timeout=60000)
    time.sleep(1.5)
    touch.tap(*centre(page, "#btn-skip"))  # skip the wake-up by tapping
    page.wait_for_function("window.__bs.mode === 'play'", timeout=30000)
    time.sleep(2.5)

    # ---- touch overlay + tutorial ----
    if ev("document.getElementById('touch').classList.contains('hidden')"):
        fail("touch controls hidden in play")
    tut = ev("__bs.tutorial")
    log(f"[{tag}] tutorial:", tut)
    if not tut or tut["step"] != "look":
        fail(f"tutorial did not start on 'look': {tut}")
    txt = ev("document.querySelector('#tutorial .tut-text').textContent")
    if "Drag" not in txt:
        fail(f"hint is not the touch variant: {txt!r}")
    shot("04-hud-tutorial")
    for m in ev(LAYOUT_JS):
        fail(f"hud: {m}")

    vw, vh = dev["viewport"]["width"], dev["viewport"]["height"]
    yaw0 = ev("__bs.debug.yaw")
    touch.drag(vw * 0.75, vh * 0.45, vw * 0.45, vh * 0.42, steps=14)
    touch.drag(vw * 0.75, vh * 0.45, vw * 0.5, vh * 0.5, steps=14)
    time.sleep(0.5)
    yaw1 = ev("__bs.debug.yaw")
    log(f"[{tag}] drag-to-look yaw {yaw0:.2f} -> {yaw1:.2f}")
    if abs(yaw1 - yaw0) < 0.3:
        fail("drag on the world did not turn the camera")
    ev("__bs.step(1.3)")
    page.wait_for_function("__bs.tutorial && __bs.tutorial.step === 'move'", timeout=15000)

    # joystick: push up for a while
    p0 = ev("__bs.debug.player")
    jx, jy = vw * 0.18, vh * 0.8
    touch.drag(jx, jy, jx, jy - 30, steps=6, during=lambda: ev("__bs.step(3)"))  # short of the rim: a walk
    time.sleep(0.3)
    p1 = ev("__bs.debug.player")
    moved = ((p1[0] - p0[0]) ** 2 + (p1[2] - p0[2]) ** 2) ** 0.5
    log(f"[{tag}] joystick moved {moved:.1f} m")
    if moved < 2:
        fail(f"joystick barely moved the player ({moved:.2f} m)")
    ev("__bs.step(1.3)")
    page.wait_for_function("__bs.tutorial && __bs.tutorial.step === 'sprint'", timeout=15000)
    # pushing the stick to the rim runs: no sprint button
    ran = []
    touch.drag(jx, jy, jx, jy - 90, steps=6, during=lambda: (ev("__bs.step(2.5)"), ran.append(ev("document.getElementById('joy').classList.contains('run')"))))
    if not any(ran):
        fail("stick at the rim did not start a run")
    ev("__bs.step(1.3)")
    page.wait_for_function("__bs.tutorial && __bs.tutorial.step === 'jump'", timeout=15000)
    # stand where nothing is in reach, so the context button jumps
    for spot in ((30, 40), (60, -30), (-40, 60), (90, 20), (20, 90)):
        ev(f"__bs.teleport({spot[0]}, {spot[1]}, 0.73)")
        ev("__bs.step(0.2)")
        time.sleep(0.3)
        if not ev("document.body.classList.contains('can-act')"):
            break
    touch.tap(*centre(page, "#tb-act"))
    time.sleep(0.5)
    ev("__bs.step(1.3)")
    page.wait_for_function("__bs.tutorial && __bs.tutorial.step === 'interact'", timeout=15000)
    # walk to the marked stone/branch: the same button now uses it
    ev("__bs.gotoObjective(0.4)")
    ev("__bs.step(0.3)")
    time.sleep(0.6)
    if not ev("document.body.classList.contains('can-act')"):
        fail("context button not lit next to an item")
    shot("05-interact")
    touch.tap(*centre(page, "#tb-act"))
    time.sleep(0.5)
    ev("__bs.step(1.3)")
    page.wait_for_function("__bs.tutorial && __bs.tutorial.step === 'menu'", timeout=15000)
    touch.tap(*centre(page, "#tb-inv"))
    page.wait_for_selector("#wheel .wseg", timeout=5000)
    time.sleep(0.3)
    shot("06-wheel")
    wb = page.locator("#wheel").bounding_box()
    touch.tap(wb["x"] + wb["width"] / 2, wb["y"] + wb["height"] / 2)
    time.sleep(0.3)
    if ev("__bs.wheelOpen"):
        fail("wheel did not close")
    touch.tap(*centre(page, "#tb-pause"))
    page.wait_for_selector("#tab-map", timeout=5000)
    touch.tap(*centre(page, "#tab-inventory"))
    page.wait_for_selector(".inv-list", timeout=5000)
    time.sleep(0.4)
    shot("07-inventory")
    if ev("document.querySelectorAll('.inv-list li:not(.empty)').length") < 1:
        fail("inventory shows nothing after a pickup")
    touch.tap(*centre(page, "#tab-crew"))
    page.wait_for_selector(".crew-grid", timeout=30000)
    time.sleep(0.4)
    shot("07b-crew")
    touch.tap(*centre(page, "#tab-map"))
    page.wait_for_selector("#map-chart", timeout=5000)
    time.sleep(0.6)
    shot("07c-map")
    touch.tap(*centre(page, "#tab-objectives"))
    page.wait_for_selector(".levels", timeout=5000)
    touch.tap(*centre(page, "#m-close"))
    time.sleep(0.3)
    ev("__bs.step(1.3)")
    page.wait_for_function("__bs.tutorial === null", timeout=20000)
    if not ev("__bs.save.flags.tutorialDone"):
        fail("tutorial finished but not remembered in the save")

    # pause menu by tap, then settings, then resume
    touch.tap(*centre(page, "#tb-pause"))
    page.wait_for_selector("#p-resume", timeout=5000)
    time.sleep(0.3)
    shot("08-pause")
    touch.tap(*centre(page, "#p-set"))
    page.wait_for_selector("#set-vol", timeout=5000)
    time.sleep(0.3)
    shot("09-settings")
    for m in ev(LAYOUT_JS):
        if "page scrolls" in m:
            fail(f"settings: {m}")
    touch.tap(*centre(page, "#m-close"))
    page.wait_for_selector("#p-resume", timeout=5000)
    time.sleep(0.2)
    touch.tap(*centre(page, "#p-resume"))
    time.sleep(0.5)
    if ev("__bs.paused"):
        fail("still paused after Resume")
    # pinch-zoom must not zoom the page
    scale = ev("visualViewport ? visualViewport.scale : 1")
    if abs(scale - 1) > 0.01:
        fail(f"page zoomed to {scale}")
    ev("__bs.teleport(-28, -78, 0.73)")
    time.sleep(2.5)
    shot("10-lake")

    # ---- Chapter Two on a phone: codex, minigame, discovery, dialogue ----
    ev("""(() => { const s = __bs.save; s.level = 11; s.completed = [1,2,3,4,5,6,7,8,9,10]; s.flags.crewCamp = true; s.flags.ch2Intro = true;
        Object.assign(s.inventory, { nodule: 2, stone: 1, branch: 2 }); })()""")
    ev("__bs.gotoObjective(0.4)")
    ev("__bs.step(0.4)")
    time.sleep(0.5)
    if not ev("document.body.classList.contains('can-act')"):
        fail(f"no craft prompt at camp: {ev('__bs.prompt')}")
    touch.tap(*centre(page, "#tb-act"))
    time.sleep(0.3)
    ev("__bs.step(0.1)")
    page.wait_for_selector("#craft:not(.hidden)", timeout=10000)
    shot("11-craft")
    b = page.locator("#mg-main").bounding_box()
    if b["height"] < 44 or b["y"] + b["height"] > vh + 1:
        fail(f"craft button unusable: {b}")
    for _ in range(4000):
        c = ev("__bs.craft")
        if not c:
            break
        if c["failed"]:
            touch.tap(*centre(page, "#mg-main"))
            continue
        lo, hi = c["band"]
        if lo + 0.03 < c["v"] < hi - 0.03:
            bx = page.locator("#mg-main").bounding_box()
            touch.tap(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2)
        ev("__bs.step(0.05)")
    page.wait_for_selector("#disc:not(.hidden)", timeout=5000)
    time.sleep(0.3)
    shot("12-discovery")
    if "Sharp stone" not in page.inner_text("#disc"):
        fail("no sharp-tool warning on the knapping discovery")
    touch.tap(*centre(page, "#disc-ok"))
    ev("__bs.step(0.3)")
    if "knapping" not in ev("__bs.save.discoveries"):
        fail("discovery not saved")
    ev("__bs.step(0.5)")
    touch.tap(*centre(page, "#tb-codex"))
    page.wait_for_selector(".cx-ages", timeout=5000)
    time.sleep(0.3)
    shot("13-codex")
    if ev("document.scrollingElement.scrollWidth") > ev("innerWidth") + 1:
        fail("codex scrolls sideways")
    touch.tap(*centre(page, ".cx-node[data-id=knapping]"))
    time.sleep(0.3)
    if "conchoidal" in page.inner_text(".cx-detail:not(.hidden)") or "Flint breaks" not in page.inner_text(".cx-detail:not(.hidden)"):
        fail("codex entry did not open by touch")
    touch.tap(*centre(page, ".cx-node[data-id=shiphome]"))
    time.sleep(0.3)
    if "Planned" not in page.inner_text(".cx-detail:not(.hidden)"):
        fail("planned entry not locked in the codex")
    shot("14-codex-entry")
    touch.tap(*centre(page, "#m-close"))
    ev("__bs.step(0.3)")
    n = next(x for x in ev("__bs.npcs") if x["id"] == "trader")
    ev(f"__bs.teleport({n['pos'][0] + 1}, {n['pos'][2]}, 0)")
    ev("__bs.step(0.2)")
    n = next(x for x in ev("__bs.npcs") if x["id"] == "trader")
    ev(f"__bs.teleport({n['pos'][0] + 1}, {n['pos'][2]}, 0)")
    ev("__bs.step(0.1)")
    time.sleep(0.3)
    touch.tap(*centre(page, "#tb-act"))
    time.sleep(0.3)
    ev("__bs.step(0.1)")
    page.wait_for_selector("#dialog:not(.hidden)", timeout=10000)
    time.sleep(0.3)
    shot("15-dialogue")
    b = page.locator("#dialog").bounding_box()
    if b["x"] < -1 or b["x"] + b["width"] > vw + 1 or b["y"] < -1 or b["y"] + b["height"] > vh + 1:
        fail(f"dialogue panel off-screen: {b}")
    touch.tap(*centre(page, '#dlg-choices button[data-c="ch.trade"]'))
    time.sleep(0.2)
    if ev("__bs.talk.node") != "shop":
        fail("dialogue choice did not work by touch")
    touch.tap(*centre(page, '#dlg-choices button[data-c="ch.tradeflint"]'))
    time.sleep(0.2)
    if ev("__bs.save.inventory.flint") < 1:
        fail("touch trade did not deliver")
    touch.tap(*centre(page, '#dlg-choices button[data-c="ch.bye"]'))
    time.sleep(0.2)
    ev("__bs.step(0.2)")
    if ev("__bs.mode") != "play":
        fail("did not return to play after the dialogue")
    ctx.close()
    browser.close()
    real = [e for e in errors if "fonts.g" not in e and "net::ERR" not in e]
    for e in real:
        fail(e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4175)
    ap.add_argument("--shots", default=str(ROOT / "docs" / "screenshots" / "mobile"))
    ap.add_argument("--only", default="", help="run only devices whose tag contains this")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)
    httpd = serve(args.port)
    failures: list[str] = []
    log = lambda *a: print(*a, flush=True)
    with sync_playwright() as p:
        for tag, name, landscape in DEVICES:
            if args.only and args.only not in tag:
                continue
            try:
                run_device(p, tag, name, landscape, shots, args.port, failures, log)
            except Exception as e:  # keep testing the other device
                line = e.__traceback__.tb_next.tb_lineno if e.__traceback__.tb_next else 0
                failures.append(f"[{tag}] exception at line {line}: {e}")
    httpd.shutdown()
    for f in failures:
        print("FAIL:", f)
    if failures:
        print(f"FAILED ({len(failures)})")
        sys.exit(1)
    print("OK: mobile layouts, touch controls and tutorial work")


if __name__ == "__main__":
    main()
