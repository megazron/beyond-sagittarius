"""Level smoke test for "The First 24 Hours" (levels 1-10).

Serves dist/, starts a new game through the name screen with custom names,
then plays every level through the real interaction code: it teleports the
player next to the current objective (the same point the compass marker uses)
and presses "E" via window.__bs.act(), advancing game time with
window.__bs.step() so software-GL frame rates don't matter. Level 7's
predator fight is played by bracing the spear inside the charge window.

Afterwards it reloads, continues the save and checks that level, names and the
rescued crewmate persist, then renders the HUD in Hindi and Urdu.

Usage: python tools/levels_smoke.py [--quality web|ultra] [--shots DIR]
Requires: pip install playwright && playwright install chromium
"""
import argparse
import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent

PLAYER = "Quorvex"
EXPLORER = "Skyvra"  # the crew keep their call-signs


def check_i18n():
    dicts = {l: json.loads((ROOT / "src" / "i18n" / f"{l}.json").read_text(encoding="utf-8")) for l in ("en", "hi", "ur")}
    problems = []
    for l in ("hi", "ur"):
        missing = [k for k in dicts["en"] if k not in dicts[l]]
        extra = [k for k in dicts[l] if k not in dicts["en"]]
        if missing or extra:
            problems.append(f"{l}: missing {missing} extra {extra}")
    for l, d in dicts.items():
        for k in [f"level.{n}.{f}" for n in range(1, 11) for f in ("title", "desc")]:
            if k not in d:
                problems.append(f"{l}: no {k}")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quality", default="web")
    ap.add_argument("--port", type=int, default=4174)
    ap.add_argument("--shots", default=str(ROOT / "docs" / "screenshots" / "levels"))
    args = ap.parse_args()
    shots = pathlib.Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)
    failures = check_i18n()
    httpd = serve(args.port)
    errors: list[str] = []
    url = f"http://127.0.0.1:{args.port}/index.html?quality={args.quality}"
    log = lambda *a: print(*a, flush=True)
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.add_init_script("if (!localStorage.getItem('bs-settings-v1')) localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}))")
        page.goto(url, wait_until="domcontentloaded", timeout=120000)
        page.evaluate("localStorage.removeItem('bs-save-v1')")
        page.wait_for_function("window.__bs && window.__bs.state === 'title'", timeout=60000)
        page.wait_for_function("window.__bs.ready", timeout=240000)
        shot = lambda name: page.screenshot(path=str(shots / f"{args.quality}-{name}.jpg"), type="jpeg", quality=84)
        ev = page.evaluate

        # ---- name screen ----
        page.click("#btn-new")
        page.wait_for_selector("#nm-scientist", timeout=10000)
        page.fill("#nm-scientist", PLAYER)
        time.sleep(0.5)
        shot("00-names")
        page.click("#nm-ok")
        # ---- MegaZroN opens the game: skippable ----
        page.wait_for_function("window.__bs.state === 'narrator' && window.__bs.vault.playing", timeout=20000)
        time.sleep(4)
        if ev("__bs.vault.line") < 0:
            failures.append("narrator scene did not start speaking")
        if not ev("__bs.voiceDuration('mz.intro.1')"):
            failures.append("no voice line for mz.intro.1")
        if not ev("__bs.voice.played"):
            failures.append("voice playback hook never fired")
        shot("00b-narrator")
        page.click("#btn-skip")
        page.wait_for_function("window.__bs.state === 'cinematic'", timeout=20000)
        page.click("#btn-skip")
        page.wait_for_function("window.__bs.state === 'game' && window.__bs.mode === 'wake'", timeout=60000)
        time.sleep(1)
        page.keyboard.press("Enter")
        page.wait_for_function("window.__bs.mode === 'play'", timeout=30000)
        names = ev("__bs.save.names")
        log("names in save:", names)
        if names.get("scientist") != PLAYER or "explorer" in names:
            failures.append(f"names not saved correctly: {names}")

        # ---- tutorial: every step needs the real input ----
        def expect_step(name):
            for _ in range(40):
                tu = ev("__bs.tutorial")
                if tu and tu["step"] == name:
                    return True
                ev("__bs.step(0.3)")
                time.sleep(0.05)
            failures.append(f"tutorial never reached step {name}: {ev('__bs.tutorial')}")
            return False

        if expect_step("look"):
            shot("00c-tutorial")
            page.mouse.move(640, 360)
            page.mouse.down()
            for k in range(14):
                page.mouse.move(640 + k * 40, 360 + (k % 3) * 8)
                time.sleep(0.03)
            page.mouse.up()
            ev("__bs.step(0.2)")
            if ev("__bs.tutorial && __bs.tutorial.step") == "look":
                # headless Chromium may not grant pointer lock: dragging must work anyway
                failures.append("mouse look did not advance the tutorial")
                ev("__bs.tutorialNext()")
        def hold_until(keys, step_next):
            """Hold keys, turning if something blocks the way, until the tutorial moves on."""
            for i in range(12):
                # re-press each round: a late pointer-lock grant blurs the window and drops held keys
                for k in keys:
                    page.keyboard.up(k)
                    page.keyboard.down(k)
                ev("__bs.step(1)")
                tu = ev("__bs.tutorial")
                if not tu or tu["step"] == step_next:
                    break
                log("  still on", tu["step"], "at", [round(v, 1) for v in ev("__bs.debug.player")], "keys", keys)
                ev(f"__bs.look({i * 1.3}, -0.15)")
            for k in keys:
                page.keyboard.up(k)

        expect_step("move")
        hold_until(["KeyW"], "sprint")
        expect_step("sprint")
        hold_until(["KeyW", "ShiftLeft"], "jump")
        expect_step("jump")
        page.keyboard.press("Space"); ev("__bs.step(0.1)")
        expect_step("interact")
        ev("__bs.gotoObjective(0.4)"); ev("__bs.step(0.2)")
        page.keyboard.press("KeyE"); ev("__bs.step(0.2)")
        expect_step("inventory")
        page.keyboard.press("KeyI"); time.sleep(0.3)
        if not page.locator(".inv-list").count():
            failures.append("inventory panel did not open")
        page.keyboard.press("KeyI")
        expect_step("crew")
        page.keyboard.press("KeyC"); time.sleep(0.3); page.keyboard.press("KeyC")
        expect_step("objectives")
        page.keyboard.press("KeyJ"); time.sleep(0.3); page.keyboard.press("KeyJ")
        expect_step("compass")
        ev("__bs.step(9)")
        if ev("__bs.tutorial") or not ev("__bs.save.flags.tutorialDone"):
            failures.append("tutorial did not finish or was not remembered")

        # ---- play levels 1-10 ----
        # flag -> (screenshot name, hour of day for the shot)
        shots_at = {"fire": ("04-fire", 21.0), "shelter": ("05-shelter", 17.4), "splint": ("09-crew", 9.5), "crewCamp": ("09b-crew-camp", 20.5), "beacon": ("10-beacon", 21.5)}

        def frame(x, z, dist, side, pitch, y=None, look_h=0.8):
            """Photo camera `dist` m from a point, looking at it; the player stands aside."""
            import math
            a = 2.2 + side
            gy = ev(f"__bs.groundAt({x}, {z})") if y is None else y
            cx, cz = x + math.sin(a) * dist, z + math.cos(a) * dist
            cy = ev(f"__bs.groundAt({cx}, {cz})") + 1.2 + dist * max(0.0, -pitch)
            ev(f"__bs.teleport({x + math.sin(a + 1.4) * 2.6}, {z + math.cos(a + 1.4) * 2.6}, {a})")
            ev(f"__bs.photo([{cx}, {cy}, {cz}], [{x}, {gy + look_h}, {z}])")

        n_scenes = 0
        scene_seen = []

        def skip_scene(state):
            for _ in range(60):
                time.sleep(0.25)
                if ev("__bs.state") == "game":
                    return True
                if (state == "narrator" and ev("__bs.vault.playing")) or (state == "flashback" and ev("document.body.classList.contains('flashback')")):
                    time.sleep(2.5)
                    if state not in scene_seen or len(scene_seen) < 5:
                        shot(f"scene-{len(scene_seen)}-{state}")
                    scene_seen.append(state)
                    ev("__bs.skip()")
                    page.wait_for_function("window.__bs.state === 'game'", timeout=20000)
                    return True
            return False

        taken = set()
        seen_levels = []
        last_level = 0
        stuck = 0
        hound_seen = False
        for it in range(900):
            st = ev("({state: __bs.state, level: __bs.level, mode: __bs.mode, hound: __bs.hound, crew: __bs.crew, busy: __bs.save && null})")
            lvl = st["level"]
            if st["state"] in ("narrator", "flashback"):
                # between-level scenes: let them start, photograph, skip
                if not skip_scene(st["state"]):
                    failures.append(f"scene stuck on level {lvl}")
                    break
                continue
            if st["mode"] == "scene":
                n_scenes += 1
                ev("__bs.step(1.5)")
                time.sleep(1.5)
                if n_scenes <= 3:
                    shot(f"09-scene-{n_scenes}")
                ev("__bs.skip()")
                ev("__bs.step(0.1)")
                continue
            if lvl != last_level:
                log(f"-> level {lvl}  (iteration {it})")
                seen_levels.append(lvl)
                last_level = lvl
                stuck = 0
            if lvl > 10:
                break
            if st["mode"] == "dead":
                failures.append(f"died on level {lvl}")
                page.click("#d-retry")
                ev("__bs.step(1)")
                continue
            stuck += 1
            if stuck > 160:
                failures.append(f"stuck on level {lvl}: {ev('({prompt: __bs.prompt, save: __bs.save.flags, inv: __bs.save.inventory})')}")
                break
            h = st["hound"]
            if lvl == 7 and h and h["state"] not in ("hidden", "flee"):
                hound_seen = True
                if h["window"]:
                    ev("__bs.act()")
                    ev("__bs.step(1.6)")
                    if "hound" not in taken:
                        taken.add("hound")
                        hp = ev("__bs.hound")["pos"]
                        frame(hp[0], hp[2], 4.0, 0.0, -0.2, look_h=0.6)
                        time.sleep(3)
                        shot("07-hound")
                        ev("__bs.photo(null)")
                else:
                    ev("__bs.step(0.25)")
                continue
            target = ev("__bs.gotoObjective()")
            ev("__bs.step(0.2)")
            label = ev("__bs.act()")
            ev("__bs.step(0.3)")
            if label is None and target is None:
                ev("__bs.step(1.0)")  # a dialogue or fade is running
            # screenshots once a level's key prop exists
            done_flags = ev("__bs.save.flags")
            for key, (name, hour) in shots_at.items():
                if done_flags.get(key) and name not in taken:
                    taken.add(name)
                    L = ev("__bs.layout")
                    if key == "splint":
                        ev("__bs.step(4.5)")  # let the dialogue finish, she stands up
                        c = ev("__bs.crew")["pos"]
                        frame(c[0], c[2], 3.2, 0.55, -0.1)
                    elif key == "crewCamp":
                        ev("__bs.step(6)")
                        frame(L["campSeat"][0], L["campSeat"][2], 3.4, 0.5, -0.12)
                    elif key == "beacon":
                        frame(L["beacon"][0], L["beacon"][2], 9, -0.3, 0.25)
                    else:
                        frame(L["camp"][0], L["camp"][2], 6.5, 0.35, -0.12)
                    saved_t = ev("__bs.save.timeOfDay")
                    ev(f"__bs.setTime({hour})")
                    time.sleep(3.5)
                    shot(f"{name}")
                    ev("__bs.photo(null)")
                    ev(f"__bs.setTime({saved_t})")
        # chapter end: the final Vault scene follows the beacon
        ev("__bs.step(6)")
        for _ in range(60):
            cur = ev("__bs.state")
            if cur != "game":
                break
            time.sleep(0.2)
            ev("__bs.step(0.5)")
        if ev("__bs.state") == "narrator":
            skip_scene("narrator")
        flags = ev("__bs.save.flags")
        for sc in ("l3", "fight", "l7", "ch1"):
            if not flags.get(f"seen-{sc}"):
                failures.append(f"scene {sc} never played")
        final = ev("({level: __bs.level, completed: __bs.save.completed, flags: __bs.save.flags, crew: __bs.crew, hits: __bs.save.houndHits})")
        log("final:", json.dumps(final)[:600])
        if final["level"] != 11:
            failures.append(f"did not finish the arc: level {final['level']}")
        if sorted(final["completed"]) != list(range(1, 11)):
            failures.append(f"completed list wrong: {final['completed']}")
        if not hound_seen or (final["hits"] or 0) < 3:
            failures.append("predator fight did not happen")
        if final["crew"]["mode"] != "camp":
            failures.append(f"crewmate not at camp: {final['crew']}")
        obj = page.inner_text("#objective")
        log("objective panel:", obj.replace("\n", " | "))
        ev("__bs.step(3)")
        time.sleep(3)
        shot("11-arc-complete")
        # crew panel shows the custom names
        page.keyboard.press("KeyC")
        time.sleep(1)
        crew_txt = page.inner_text("#modal-card")
        if PLAYER not in crew_txt or EXPLORER not in crew_txt:
            failures.append("custom names missing from crew panel")
        shot("12-crew-panel")
        page.keyboard.press("KeyC")

        # ---- NPCs: they exist, and talking to one works ----
        npcs = ev("__bs.npcs")
        log("npcs:", [n["id"] for n in npcs])
        if len(npcs) < 5:
            failures.append(f"expected five NPCs: {npcs}")
        t = next(n for n in npcs if n["id"] == "trader")
        ev(f"__bs.teleport({t['pos'][0] + 1}, {t['pos'][2]}, 0)")
        ev("__bs.step(0.3)")
        if ev("__bs.act()") != "npc-trader":
            failures.append("could not talk to the trader")

        # ---- persistence: reload and continue ----
        ev("__bs.save && window.dispatchEvent(new Event('beforeunload'))")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("window.__bs && window.__bs.ready", timeout=240000)
        page.click("#btn-continue")
        page.wait_for_function("window.__bs.mode === 'play'", timeout=30000)
        ev("__bs.step(2)")
        re = ev("({level: __bs.level, names: __bs.save.names, crew: __bs.crew})")
        log("after reload:", re)
        if re["level"] != 11 or re["names"].get("scientist") != PLAYER or re["crew"]["mode"] != "camp":
            failures.append(f"save did not persist: {re}")

        # ---- other languages ----
        for lang in ("hi", "ur"):
            ev(f"localStorage.setItem('bs-settings-v1', JSON.stringify({{lang: '{lang}', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}}))")
            page.reload(wait_until="domcontentloaded")
            page.wait_for_function("window.__bs && window.__bs.ready", timeout=240000)
            page.click("#btn-continue")
            page.wait_for_function("window.__bs.mode === 'play'", timeout=30000)
            time.sleep(3)
            d = ev("document.documentElement.dir")
            if lang == "ur" and d != "rtl":
                failures.append("Urdu is not RTL")
            txt = page.inner_text("#hud")
            if "level." in txt or "item." in txt or "{" in txt:
                failures.append(f"{lang}: untranslated key in HUD: {txt[:200]}")
            shot(f"13-hud-{lang}")
        browser.close()
    httpd.shutdown()
    real = [e for e in errors if "fonts.g" not in e and "net::ERR" not in e]
    for e in real:
        print(e)
    failures += real
    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print(f"OK - levels {seen_levels} completed, no page errors")


if __name__ == "__main__":
    main()
