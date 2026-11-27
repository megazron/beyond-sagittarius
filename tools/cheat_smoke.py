"""Cheat menu smoke test: every checkpoint loads and its level can be finished from it.

Serves dist/. A real save is put on the page first; then for each checkpoint (src/cheat/snapshots.sealed, see
tools/cheat_snapshots.py) the page is loaded with ?cheat=<id>&cgo=1 and the test checks that the game comes up in play
(or in the scene or film the point is before) with no page error, that the session is marked as a cheat session, and
that the level is then played to its end through the real interaction code (tools/cheat_play.py). After each point the
real save must be exactly what it was. With --opening the opening's points are checked too: each comes up where it
should (the Vault, the city, the film's clock at the point) and the opening then runs on to play on the planet.
Also checked once: the menu opens on the title screen by the URL form, lists the levels, and its toggles take.

Usage: python tools/cheat_smoke.py [--levels 1-21] [--opening] [--only L12.scene1,...] [--preset a|b|ask] [--quality web]
"""
import argparse
import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402
from cheat_play import drive  # noqa: E402
import cheat_snapshots  # noqa: E402

REAL = {"version": 1, "level": 3, "completed": [1, 2], "stats": {"health": 70, "thirst": 60, "hunger": 60, "stamina": 100},
        "inventory": {"stone": 2}, "pos": [0, 0, 0], "yaw": 0, "timeOfDay": 13, "day": 1, "flags": {"drank": True, "ateSafe": True, "tutorialDone": True},
        "collected": [], "names": {}, "branch": {"trust": {}, "record": {"honesty": 0, "mercy": 0, "nerve": 0, "humour": 0}, "log": [], "dead": {}, "pending": [], "open": None, "marks": {}},
        "savedAt": 1}
OPENING = {"open.vault": "narrator", "open.city": "game", "open.lounge": "cinematic", "open.pull": "cinematic", "open.run": "cinematic", "open.film": "film"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4761)
    ap.add_argument("--quality", default="web")
    ap.add_argument("--levels", default="1-21")
    ap.add_argument("--only", default="")
    ap.add_argument("--opening", action="store_true")
    ap.add_argument("--preset", default="a", choices=["a", "b", "ask"])
    ap.add_argument("--rounds", type=int, default=900, help="driver rounds at most per checkpoint")
    a = ap.parse_args()
    lo, hi = (int(x) for x in a.levels.split("-")) if "-" in a.levels else (int(a.levels), int(a.levels))
    data = cheat_snapshots.load()
    bad = cheat_snapshots.problems(data)
    pts = [p for p in data["points"] if lo <= p["level"] <= hi]
    if a.only:
        want = a.only.split(",")
        pts = [p for p in data["points"] if p["id"] in want]
    targets = ([t for t in OPENING] if a.opening else []) + [p["id"] for p in pts]
    if a.opening and not a.only:
        targets[4:4] = [f"open.m{i}" for i in range(1, 7)]
    log = lambda *x: print(*x, flush=True)
    log(f"cheat_smoke: {len(targets)} points ({len(data['points'])} recorded, made from {data.get('made')})")
    httpd = serve(a.port)
    fails: list[str] = list(bad)
    real = json.dumps(REAL)
    base = f"http://127.0.0.1:{a.port}/index.html?prologue=0&quality={a.quality}"
    with sync_playwright() as pw:
        b = launch(pw)
        ctx = b.new_context(viewport={"width": 960, "height": 540})
        ctx.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}))")
        ctx.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
        ctx.add_init_script(f"if (!localStorage.getItem('bs-save-v1')) localStorage.setItem('bs-save-v1', {json.dumps(real)})")
        page = ctx.new_page()
        page.set_default_timeout(120000)
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)
        ev = page.evaluate

        # ---- the menu itself, once ----
        page.goto(base + "&cheat=menu", wait_until="domcontentloaded", timeout=180000)
        page.wait_for_function("window.__bs && window.__bs.state === 'title'", timeout=180000)
        try:
            page.wait_for_selector("#cheat [data-g]", timeout=60000)
            n = ev("document.querySelectorAll('#cheat [data-g] option').length")
            if n != 22:
                fails.append(f"menu lists {n} groups, not the opening and 21 levels")
            page.select_option("#cheat [data-g]", "L12")
            if ev("document.querySelectorAll('#cheat .ch-list button').length") < 1:
                fails.append("menu: level 12 lists no checkpoints")
            page.check("#cheat [data-o=noDamage]")
            if not ev("__bs.cheat.opts.noDamage"):
                fails.append("menu: a toggle did not take")
            url = ev("document.querySelector('#cheat .ch-url').value")
            if "cheat=L12." not in url or "nodmg=1" not in url:
                fails.append(f"menu: the jump's URL is wrong: {url}")
            page.keyboard.press("Escape")
            if ev("__bs.cheat.isOpen"):
                fails.append("menu: Escape did not close it")
        except Exception as e:
            fails.append(f"menu did not open from the URL: {str(e)[:160]}")
        log("menu checked")

        for tid in targets:
            errors.clear()
            t0 = time.time()
            page.goto(base + f"&cheat={tid}&cgo=1&cpick={a.preset}", wait_until="domcontentloaded", timeout=180000)
            try:
                page.wait_for_function("window.__bs && window.__bs.ready", timeout=300000)
                if tid.startswith("open."):
                    want = OPENING.get(tid, "cinematic")
                    page.wait_for_function(f"__bs.state === '{want}'", timeout=180000)
                    if want == "cinematic":
                        time.sleep(1.5)
                        at = ev("__bs.cineTime()")
                        log(f"  {tid}: film clock {at:.1f}")
                    if tid == "open.city":
                        page.wait_for_function("__bs.mode === 'away'", timeout=180000)
                        ev("__bs.awayOutro()")
                    stop = lambda st: st["state"] == "game" and st["mode"] == "play"
                    level = 0
                else:
                    page.wait_for_function("__bs.state === 'game' && ['play', 'scene', 'away', 'craft', 'talk'].includes(__bs.mode) || __bs.state === 'narrator' || __bs.state === 'flashback'", timeout=240000)
                    level = int(tid[1:].split(".")[0])
                    if ev("__bs.level") != level and not tid.endswith(".results"):
                        fails.append(f"{tid}: came up at level {ev('__bs.level')}")
                    stop = lambda st, L=level: (st["level"] or 0) > L
            except Exception as e:
                fails.append(f"{tid}: did not come up ({str(e)[:140]}) state={ev('({s: __bs && __bs.state, m: __bs && __bs.mode, l: __bs && __bs.level})')}")
                continue
            if not ev("__bs.cheat.session"):
                fails.append(f"{tid}: not a cheat session")
            if ev("document.getElementById('cheat-mark').classList.contains('hidden')"):
                fails.append(f"{tid}: no cheat mark on screen")
            try:
                why = drive(page, ev, log, stop, rounds=a.rounds)
            except Exception as e:
                why = f"error: {str(e)[:200]}"
            end = ev("({state: __bs.state, mode: __bs.mode, level: __bs.level})")
            if why != "stop":
                fails.append(f"{tid}: did not finish ({why}) at {end}")
            if ev("localStorage.getItem('bs-save-v1')") != real:
                fails.append(f"{tid}: the real save was written")
            errs = [e for e in errors if "favicon" not in e]
            if errs:
                fails.append(f"{tid}: {errs[:3]}")
            log(f"{tid}: {why} in {time.time() - t0:.0f} s -> {end}")
        b.close()
    httpd.shutdown()
    if fails:
        print("CHEAT SMOKE FAILED:")
        for f in fails:
            print(" -", f)
        sys.exit(1)
    print(f"cheat smoke passed: {len(targets)} points")


if __name__ == "__main__":
    main()
