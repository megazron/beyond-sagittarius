"""Level smoke test for "The First 24 Hours" (levels 1-10).

Serves dist/, starts a new game through the name screen with custom names,
then plays every level through the real interaction code: it teleports the
player next to the current objective (the same point the compass marker uses)
and presses "E" via window.__bs.act(), advancing game time with
window.__bs.step() so software-GL frame rates don't matter. Level 7's
night is the fight at the fire (the combat set piece, started by the story
itself), and level 8 begins with breakfast (spear fishing or the hunt): the
test answers the difficulty question, says it is ready, steps the fight to its
end and takes "go on" if it is lost.

Afterwards it reloads, continues the save and checks that level, names and the
rescued crewmate persist, then renders the HUD in Hindi and Urdu.

Usage: python tools/levels_smoke.py [--quality web|ultra] [--shots DIR]
Requires: pip install playwright && playwright install chromium
"""
import argparse
import json
import os
import pathlib
import re
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402
from watch_time import watch_scene, watch_between, dump, report  # noqa: E402

# the last level that can be played (src/ui/ui.ts PLAYABLE_LEVELS): Episode Three ends at level 21
LAST = 21
ROOT = pathlib.Path(__file__).resolve().parent.parent

PLAYER = "Quorvex"
EXPLORER = "Skyvra"  # the crew keep their call-signs


def check_i18n():
    dicts = {l: json.loads((ROOT / "src" / "i18n" / f"{l}.json").read_text(encoding="utf-8")) for l in ("en", "hi", "ur")}
    problems = []
    import voice_check
    problems += voice_check.problems()[:20]
    for l in ("hi", "ur"):
        # a g.f. key is a feminine form, and which lines need one differs by language (Hindi and Urdu verbs agree with a
        # first-person speaker, English does not): it only needs its plain line to exist
        gf = lambda k: k.startswith("g.f.")
        missing = [k for k in dicts["en"] if k not in dicts[l] and not gf(k)]
        extra = [k for k in dicts[l] if (k[4:] if gf(k) else k) not in dicts["en"]]
        if missing or extra:
            problems.append(f"{l}: missing {missing} extra {extra}")
    for l, d in dicts.items():
        dashes = [k for k, v in d.items() if "\u2014" in v]
        if dashes:
            problems.append(f"{l}: em dash in {dashes[:5]}")
        for k in [f"level.{n}.{f}" for n in range(1, 22) for f in ("title", "desc")]:
            if k not in d:
                problems.append(f"{l}: no {k}")
    return problems


def check_voice():
    """Every voiced line exists in every language; science text stays free of quantities."""
    voice = json.loads((ROOT / "src" / "i18n" / "voice.json").read_text(encoding="utf-8"))
    problems = []
    for l in ("en", "hi", "ur"):
        d = json.loads((ROOT / "src" / "i18n" / f"{l}.json").read_text(encoding="utf-8"))
        problems += [f"{l}: voiced key {k} has no text" for k in voice["lines"] if k not in d]
    en = json.loads((ROOT / "src" / "i18n" / "en.json").read_text(encoding="utf-8"))
    for k, v in en.items():
        if k.startswith(("codex.", "teach.", "mg.")) and re.search(r"\d\s*(%|g\b|kg|ml|l\b|litre|gram|degree|°|parts?\b)", v):
            problems.append(f"science text reads like a recipe: {k}")
    return problems


def play_craft(page, ev, seen, failures, log, ruin_once=None):
    """Finish the running minigame through real key events; simulated time."""
    held = False
    side = "KeyA"
    ruined = False
    for _ in range(6000):
        c = ev("__bs.craft")
        if not c:
            break
        if held and c["kind"] != "heat":
            page.keyboard.up("Space")
            held = False
        if c["failed"]:
            if held:
                page.keyboard.up("Space")
                held = False
            page.keyboard.press("Space")
            continue
        lo, hi = c["band"]
        v, kind = c["v"], c["kind"]
        mid = (lo + hi) / 2
        if ruin_once == c["id"] and kind == "heat" and not ruined:
            # hold far too long: the run is ruined and costs no materials
            before = ev("__bs.save.inventory")
            page.keyboard.down("Space")
            for _ in range(200):
                ev("__bs.step(0.1)")
                if ev("__bs.craft.failed"):
                    break
            page.keyboard.up("Space")
            ruined = True
            if not ev("__bs.craft.failed"):
                failures.append("overheating did not ruin the run")
            if ev("__bs.save.inventory") != before:
                failures.append("a ruined run spent materials")
            if ev("__bs.save.crafts.failed") < 1:
                failures.append("failure not counted in the save")
            continue
        if kind == "tap":
            if lo + 0.012 < v < hi - 0.012:
                page.keyboard.press("Space")
        elif kind == "heat":
            want = v < mid
            if want and not held:
                page.keyboard.down("Space")
                held = True
            elif not want and held:
                page.keyboard.up("Space")
                held = False
        elif kind == "rhythm":
            if v < mid:
                page.keyboard.press(side)
                side = "KeyD" if side == "KeyA" else "KeyA"
        elif kind == "mix":
            if v < lo + 0.005:
                page.keyboard.press("KeyD")
            elif v > hi - 0.005:
                page.keyboard.press("KeyA")
            else:
                page.keyboard.press("Space")
            continue
        ev("__bs.step(0.05)")
    if held:
        page.keyboard.up("Space")
    if ev("__bs.craft"):
        failures.append(f"minigame never finished: {ev('__bs.craft')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quality", default="web")
    ap.add_argument("--port", type=int, default=4174)
    ap.add_argument("--shots", default=str(ROOT / "docs" / "screenshots" / "levels"))
    ap.add_argument("--watch", default="", help="play every scene to its end and write the watched time (tools/watch_time.py) here")
    ap.add_argument("--last", type=int, default=LAST, help="with --watch: stop after this level")
    ap.add_argument("--snapshots", default="", help="record the cheat menu's checkpoints on the way (?cheatrec=1) and write them here as JSON (tools/cheat_snapshots.py seals them)")
    args = ap.parse_args()
    shots = pathlib.Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)
    failures = check_i18n() + check_voice()
    httpd = serve(args.port)
    errors: list[str] = []
    url = f"http://127.0.0.1:{args.port}/index.html?prologue=0&quality={args.quality}"
    if args.snapshots:
        url += "&cheatrec=1"
    log = lambda *a: print(*a, flush=True)
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.set_default_timeout(120000)  # clicks and waits on a loaded machine: generous, and they return as soon as the page is ready
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.add_init_script("if (!localStorage.getItem('bs-settings-v1')) localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}))")
        # (p32) a 5 s wait that fails here prints the page's last modal opens and closes and its long tasks (the main thread
        # held over 200 ms), to tell a slow page from a modal opened again over the one being closed
        page.add_init_script("window.__longT = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration > 200) { window.__longT.push([Math.round(e.startTime), Math.round(e.duration)]); if (window.__longT.length > 30) window.__longT.shift(); } }).observe({ type: 'longtask', buffered: true }); } catch (e) {}")
        _wfs = page.wait_for_selector
        # (p32, modal-land CI 45454504900: the codex opened at 65.32 s in the 2 ms between a 15.6 s and a 7.2 s task of the
        # world's first frames after Continue under SwiftShader, and the 5 s wait for it ran out inside the 7.2 s one. So a
        # wait that runs out waits for the page to draw two frames, however long, and is tried once more: 5 s of a page
        # that is drawing, not 5 s of a page held by the software renderer)
        def _wfs_logged(sel, **kw):
            try:
                return _wfs(sel, **kw)
            except Exception:
                try:
                    log("wait_for_selector ran out:", sel, kw, "now", page.evaluate("Math.round(performance.now())"))
                    log("  modal log:", page.evaluate("window.__modalLog || null"))
                    log("  long tasks:", page.evaluate("window.__longT || null"))
                except Exception as e2:
                    log("  (could not read the page:", e2, ")")
                page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))")
                r = _wfs(sel, **kw)
                log("  ...found after the page drew again:", sel, "now", page.evaluate("Math.round(performance.now())"), "long tasks:", page.evaluate("(window.__longT || []).slice(-4)"))
                return r
        page.wait_for_selector = _wfs_logged
        page.goto(url, wait_until="domcontentloaded", timeout=120000)
        page.evaluate("localStorage.removeItem('bs-save-v1')")
        page.wait_for_function("window.__bs && window.__bs.state === 'title'", timeout=60000)
        page.wait_for_function("window.__bs.ready", timeout=240000)
        shot = lambda name: page.screenshot(path=str(shots / f"{args.quality}-{name}.jpg"), type="jpeg", quality=84, timeout=120000)
        ev = page.evaluate

        def close_menus():
            """Menus fade out on a timer, and slow frames can swallow a toggle: end with none open."""
            for _ in range(40):
                if ev("document.getElementById('modal').classList.contains('hidden')"):
                    return
                if not ev("document.getElementById('modal').classList.contains('leaving')"):
                    page.keyboard.press("Escape")
                time.sleep(0.2)
            failures.append("a menu would not close")

        # ---- first launch: safety notice and terms, one accept ----
        if not page.locator("#safety .safety-card").is_visible():
            failures.append("safety card missing on first launch")
        shot("00-safety")
        card = page.inner_text("#safety")
        if "Do not try this at home" not in card or "Terms" not in card:
            failures.append(f"safety card text wrong: {card[:120]}")
        page.click("#sf-legal")
        page.wait_for_selector(".legal", timeout=5000)
        page.click("#m-close")
        page.wait_for_selector("#sf-ok", timeout=5000)
        if ev("__bs.consent"):
            failures.append("consent recorded before accepting")
        page.click("#sf-ok")
        if not ev("__bs.consent") or page.locator("#safety .safety-card").is_visible():
            failures.append("accepting did not dismiss and remember the card")
        tech = ev("__bs.tech")
        if len(tech["ages"]) != 9 or {n["age"] for n in tech["nodes"]} != set(tech["ages"]):
            failures.append(f"tech tree does not cover nine ages: {tech['ages']}")
        ids = {n["id"] for n in tech["nodes"]}
        for n in tech["nodes"]:
            if not set(n["requires"]) <= ids:
                failures.append(f"tech {n['id']} needs unknown {n['requires']}")
        log("tech:", len(tech["nodes"]), "nodes,", sum(n["status"] == "playable" for n in tech["nodes"]), "playable")

        # ---- name screen ----
        page.click("#btn-new")
        page.wait_for_selector("#nm-scientist", timeout=60000)
        page.fill("#nm-scientist", PLAYER)
        time.sleep(0.5)
        shot("00-names")
        page.click("#nm-ok")
        # ---- MegaZroN opens the game: skippable ----
        page.wait_for_function("window.__bs.state === 'narrator' && window.__bs.vault.playing", timeout=20000)
        # the cold open starts on a silent beat on the room: wait for his first line (software GL runs the scene slowly)
        try: page.wait_for_function("window.__bs.vault.said.length > 0", timeout=60000)
        except Exception: pass
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
        page.wait_for_function("window.__bs.state === 'film'", timeout=20000)
        page.click("#btn-skip")  # the title sequence skips on its own tap
        page.wait_for_function("window.__bs.state === 'game' && window.__bs.mode === 'wake'", timeout=60000)
        time.sleep(1)
        page.keyboard.press("Enter")
        page.wait_for_function("window.__bs.mode === 'play'", timeout=180000)
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
            last = None
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
                if i in (1, 6):
                    log("  input:", ev("__bs.inputState"), ev("({paused: __bs.paused, modal: !document.getElementById('modal').classList.contains('hidden'), lock: !!document.pointerLockElement, yaw: __bs.debug.yaw, tut: __bs.tutorial, state: __bs.state, frames: __bs.debug.frames})"))
                # turn only when something blocks the way: turning every round walks a small circle that never gets anywhere
                pos = ev("__bs.debug.player")
                if i and last is not None and ((pos[0] - last[0]) ** 2 + (pos[2] - last[2]) ** 2) ** 0.5 < 0.1:
                    ev(f"__bs.look({i * 1.3}, -0.15)")
                last = pos
            for k in keys:
                page.keyboard.up(k)

        expect_step("move")
        # the look drag must be over before walking: a held button slows him to a shuffle and holds the view
        page.mouse.move(640, 360); page.mouse.up(); ev("__bs.step(0.2)")
        hold_until(["KeyW"], "sprint")
        expect_step("sprint")
        if os.environ.get("BS_STOP_AFTER_MOVE"):
            sys.exit(0)
        hold_until(["KeyW", "ShiftLeft"], "jump")
        expect_step("jump")
        page.keyboard.press("Space"); ev("__bs.step(0.1)")
        expect_step("interact")
        ev("__bs.gotoObjective(0.4)"); ev("__bs.step(0.2)")
        page.keyboard.press("KeyE"); ev("__bs.step(0.2)")
        log("  after E:", ev("({prompt: __bs.prompt, player: __bs.debug.player, inv: __bs.save.inventory, tut: __bs.tutorial})"))
        expect_step("menu")
        page.keyboard.press("KeyI")
        try:  # a loaded machine can take seconds to draw a menu: poll for it, don't guess a delay
            page.wait_for_selector(".inv-list", timeout=20000)
        except Exception:
            failures.append("inventory did not open")
        page.keyboard.press("KeyI"); time.sleep(0.3)
        page.keyboard.press("KeyC"); time.sleep(0.3); page.keyboard.press("KeyC"); time.sleep(0.3)
        page.keyboard.press("KeyJ"); time.sleep(0.3); page.keyboard.press("KeyJ"); time.sleep(0.3)
        close_menus()
        ev("__bs.step(1.3)")
        if ev("__bs.tutorial") or not ev("__bs.save.flags.tutorialDone"):
            failures.append(f"hints did not finish or were not remembered: {ev('__bs.tutorial')}")

        # ---- choices: keys, countdown, timers off, surviving a reload ----
        def entry(i):
            return next((e for e in ev("__bs.branch.state.log") if e["id"] == i), None)

        def demo(call="demo('debug.timed')", want="#dlg-choices .dlg-c"):
            ev(f"__bs.branch.{call}")
            ev("__bs.step(0.2)")
            page.wait_for_selector(want, timeout=5000)
            time.sleep(0.4)  # the guard against a stray skip tap

        demo()
        if ev("document.querySelectorAll('#dlg-choices .dlg-c').length") != 3 or not page.locator("#dlg-timer").is_visible():
            failures.append("timed choice: no three options and a ring")
        if page.locator("#btn-skip").is_visible():
            failures.append("skip button shows over a choice")
        page.keyboard.press("Enter")  # nothing highlighted: must neither pick nor skip
        ev("__bs.step(0.1)")
        if not ev("__bs.branch.open"):
            failures.append("Enter with nothing highlighted closed the panel")
        shot("14-choice")
        page.keyboard.press("Digit2")
        ev("__bs.step(0.2)")
        e = entry("debug.timed")
        if not e or e["pick"] != "joke":
            failures.append(f"digit key did not pick option 2: {e}")
        if not any(x["id"] == "debug.timed" for x in ev("__bs.branch.savedLog")):
            failures.append("decision was not autosaved")
        demo()
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter")
        ev("__bs.step(0.2)")
        e = entry("debug.timed")
        if not e or e["pick"] != "joke":
            failures.append(f"arrows and Enter did not pick option 2: {e}")
        demo()
        ev("__bs.step(7)")
        e = entry("debug.timed")
        if ev("__bs.branch.open") or not e or e["pick"] != "silent" or not e.get("timedOut"):
            failures.append(f"timer did not fall back to silence: {e}")
        demo("demoQte('debug.qte')", "#qte-btn")
        page.keyboard.press("KeyE")
        ev("__bs.step(0.2)")
        if (entry("debug.qte") or {}).get("pick") != "pass":
            failures.append("quick-time key press did not pass")
        demo("demoQte('debug.qte')", "#qte-btn")
        ev("__bs.step(3)")
        if (entry("debug.qte") or {}).get("pick") != "fail":
            failures.append("quick-time window did not fail on its own")
        # timers off, through the real Settings
        ev("__bs.step(0.5)")
        page.keyboard.press("Escape")
        page.click("#p-set")
        page.click(".sub-tabs [data-pane=system]")
        page.click("[data-seg=timers] button[data-v='0']")
        shot("15-settings-timers")
        page.click("#m-close")
        page.click("#p-resume")
        demo()
        ev("__bs.step(30)")
        if not ev("__bs.branch.open") or page.locator("#dlg-timer").is_visible():
            failures.append("timers off: the panel still counts down")
        page.keyboard.press("Digit1")
        ev("__bs.step(0.2)")
        demo("demoQte('debug.qte')", "#qte-btn")
        ev("__bs.step(30)")
        if not ev("__bs.branch.open"):
            failures.append("timers off: quick-time prompt did not wait")
        page.keyboard.press("Space")
        ev("__bs.step(0.2)")
        ev("__bs.step(0.5)")
        page.keyboard.press("Escape")
        page.click("#p-set")
        page.click(".sub-tabs [data-pane=system]")
        page.click("[data-seg=timers] button[data-v='1']")
        page.click("#m-close")
        page.click("#p-resume")
        # a reload with the panel open brings the panel back
        demo()
        page.reload(wait_until="domcontentloaded", timeout=240000)
        page.wait_for_function("window.__bs && window.__bs.ready", timeout=240000)
        page.click("#btn-continue")
        page.wait_for_function("window.__bs.mode === 'play'", timeout=180000)
        ev("__bs.step(1)")
        if not ev("__bs.branch.open"):
            failures.append("reload with a choice open dropped the choice")
        else:
            time.sleep(0.4)
            page.keyboard.press("Digit1")
            ev("__bs.step(0.2)")
        if ev("__bs.branch.state.open"):
            failures.append("answered choice is still marked open")
        ev("__bs.step(0.5)")

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

        answered = []
        between = []
        fights = []  # the set pieces the story started: [id, result]
        trees = []

        def small_actions():
            """The hidden actions: share food with Pello, hand Tovik's flint back."""
            def visit(who):
                """Walk up and open the conversation."""
                for _ in range(6):
                    n = next(x for x in ev("__bs.npcs") if x["id"] == who)
                    ev(f"__bs.teleport({n['pos'][0] + 0.8}, {n['pos'][2]}, 0)")
                    ev("__bs.step(0.2)")
                    if ev("__bs.act()") == f"npc-{who}":
                        return True
                failures.append(f"could not reach {who}")
                return False

            def say(label):
                """Pick a line by its label, or report what was offered."""
                talk = ev("__bs.talk")
                if not talk or label not in talk["choices"]:
                    failures.append(f"{label} not offered: {talk}")
                    if talk:
                        page.keyboard.press("Escape")
                    return
                page.keyboard.press(f"Digit{talk['choices'].index(label) + 1}")
                ev("__bs.step(0.1)")

            ev("__bs.save.stats.hunger = 80")
            if visit("trav"):
                say("ch.bye")
            if visit("trav"):  # second visit: nobody has offered him a biscuit
                say("ch.share")
                say("ch.bye")
            if not entry("c1.pello.share"):
                failures.append("sharing food with Pello was not recorded")
            ev("__bs.save.inventory.branch += 2")
            flint = ev("__bs.save.inventory.flint")
            if visit("trader"):
                say("ch.trade")
                say("ch.tradeflint")
                say("ch.bye")
            if ev("__bs.save.inventory.flint") != flint + 2:
                failures.append("Tovik did not overpay")
            if visit("trader"):
                say("ch.returnflint")
                say("ch.bye")
            if not entry("c1.tovik.return") or ev("__bs.save.inventory.flint") != flint + 1:
                failures.append("could not give Tovik's flint back")
            ev("__bs.step(1)")

        taken = set()
        shown = {}
        seen_levels = []
        last_level = 0
        stuck = 0
        last_prog = ""
        hound_seen = False
        night_asked = False
        for it in range(2400):  # Episode Three (levels 15 to 21) needs more rounds: its holds and scenes run in real time
            st = ev("({state: __bs.state, level: __bs.level, mode: __bs.mode, hound: __bs.hound, crew: __bs.crew, busy: __bs.save && null})")
            lvl = st["level"]
            # the story's own fights (src/game/fights.ts): nothing but the story starts them here
            if ev("!document.getElementById('modal').classList.contains('hidden') && !!document.querySelector('[data-diff]')"):
                log("difficulty asked at level", lvl, ev("({t: __bs.save.timeOfDay, enc: __bs.combat.debug().encounter})"))
                ev("document.querySelector('[data-diff=\"story\"]').click()")
                ev("__bs.step(0.2)")
                log("after the answer:", ev("({modal: !document.getElementById('modal').classList.contains('hidden'), diff: !!document.querySelector('[data-diff]'), enc: __bs.combat.debug().encounter, out: __bs.combat.run && __bs.combat.run.outcome, gone: !!__bs.save.flags.houndGone})"))
                continue
            if ev("!document.getElementById('modal').classList.contains('hidden') && !!document.getElementById('cb-goon')"):
                fights.append([ev("__bs.combat.run && __bs.combat.run.id"), "lost"])
                ev("document.getElementById('cb-goon').click()")
                time.sleep(0.8)
                continue
            enc = ev("__bs.combat && __bs.combat.run ? {id: __bs.combat.run.id, phase: __bs.combat.run.phase, out: __bs.combat.run.outcome && __bs.combat.run.outcome.result} : null")
            if enc:
                if not fights or fights[-1][0] != enc["id"] or fights[-1][1] is not None:
                    fights.append([enc["id"], None])
                    log(f"fight started by the story: {enc['id']} (level {lvl})")
                    shot(f"07-fight-{enc['id']}")
                if enc["out"]:
                    fights[-1][1] = enc["out"]
                    time.sleep(0.6)
                    ev("__bs.step(0.5)")
                    continue
                if enc["id"] == "night.defence" and enc["phase"] == "prep":
                    ev("__bs.combat.run.ready()")
                if enc["id"] in ("fish.spear", "hunt.first") and ev("__bs.combat.run.t") > 6:
                    ev("__bs.combat.leaveEncounter()")
                ev("__bs.step(4)")
                continue
            if page.locator(".pt-cols").is_visible():
                # the path tree opens by itself after each chapter
                time.sleep(0.5)
                shot(f"16-path-tree-{len(trees) + 1}")
                tree = ev("({taken: document.querySelectorAll('.pt-b.taken').length, closed: document.querySelectorAll('.pt-b.locked, .pt-b.secret').length, ends: document.querySelectorAll('[data-ending]').length})")
                log("path tree:", tree)
                trees.append(tree)
                if tree["ends"] != 4 or (len(trees) == 1 and (tree["taken"] != 6 or tree["closed"] < 3)):
                    failures.append(f"path tree content: {tree}")
                page.click("#m-close")
                page.wait_for_selector(".pt-cols", state="hidden", timeout=5000)
                continue
            if ev("__bs.branch.open"):
                time.sleep(0.4)
                if page.locator("#qte-btn").is_visible():
                    page.keyboard.press("KeyE")
                elif ev("!!document.querySelector('#dlg-choices button[data-c=\"e1.night.o.brace\"]')"):
                    # the first night's question (night.ts): brace the spear, so the night is the fight at the fire
                    shot("14n-night-choice")
                    night_asked = True
                    ev("document.querySelector('#dlg-choices button[data-c=\"e1.night.o.brace\"]').click()")
                else:
                    opts = ev("document.querySelectorAll('#dlg-choices .dlg-c').length")
                    # Episode Two's choices (levels 11 to 14) are checked by tools/episode2_smoke.py
                    if lvl < 11:
                        answered.append(opts)
                    shot(f"14c-choice-{len(answered)}")
                    page.keyboard.press("Digit1")  # big fire, then the truth
                ev("__bs.step(0.2)")
                continue
            if st["mode"] == "play" and lvl == 6 and "small" not in taken:
                taken.add("small")
                small_actions()
            if st["state"] in ("narrator", "flashback") and args.watch:
                between.append({"level": lvl, "state": st["state"], "wall_s": watch_between(page, ev, st["state"])}); continue
            if st["state"] in ("narrator", "flashback"):
                # between-level scenes: let them start, photograph, skip
                if not skip_scene(st["state"]):
                    failures.append(f"scene stuck on level {lvl}")
                    log(f"scene stuck on level {lvl}:", ev("({state: __bs.state, mode: __bs.mode, modal: !document.getElementById('modal').classList.contains('hidden'), diff: !!document.querySelector('[data-diff]'), fb: document.body.classList.contains('flashback'), vault: __bs.vault && __bs.vault.playing, enc: __bs.combat && __bs.combat.debug().encounter})"))
                    break
                continue
            if st["mode"] == "scene" and args.watch:
                watch_scene(page, ev); continue
            if st["mode"] == "scene":
                n_scenes += 1
                for _ in range(8):  # small steps: a quick-time window must not pass unseen
                    ev("__bs.step(0.2)")
                    if ev("__bs.branch.open"):
                        break
                if ev("__bs.branch.open"):
                    continue
                time.sleep(1.5)
                if n_scenes <= 3:
                    shot(f"09-scene-{n_scenes}")
                ev("__bs.skip()")
                ev("__bs.step(0.1)")
                continue
            if lvl == 7 and it % 5 == 0:
                log("level 7 state:", ev("({state: __bs.state, mode: __bs.mode, t: __bs.save.timeOfDay, modal: !document.getElementById('modal').classList.contains('hidden'), diff: !!document.querySelector('[data-diff]'), enc: __bs.combat && __bs.combat.debug().encounter, night: __bs.save.flags['e1.night'], gone: __bs.save.flags.houndGone})"))
            if lvl != last_level:
                log(f"-> level {lvl}  (iteration {it})")
                seen_levels.append(lvl)
                last_level = lvl
                stuck = 0
            if lvl > (args.last if args.watch else LAST):
                break
            if st["mode"] == "dead":
                failures.append(f"died on level {lvl}")
                page.click("#d-retry")
                ev("__bs.step(1)")
                continue
            if st["mode"] == "craft":
                cr = ev("__bs.craft")
                if cr:
                    if cr["id"] not in taken:
                        taken.add(cr["id"])
                        if cr["id"] in ("knapping", "pottery", "acids"):
                            ev("__bs.step(0.4)")
                            time.sleep(0.4)
                            shot(f"20-craft-{cr['id']}")
                    play_craft(page, ev, taken, failures, log, ruin_once="pottery")
                if page.locator("#disc h2").is_visible():
                    title = page.inner_text("#disc h2")
                    warns = ev("[...document.querySelectorAll('#disc .warn')].map(e => e.dataset.warn)")
                    shown[title] = warns
                    if title == "Pottery":
                        time.sleep(0.4)
                        shot("21-discovery")
                    page.keyboard.press("Enter")
                    ev("__bs.step(0.2)")
                continue
            if page.locator("#disc h2").is_visible():
                # Episode Two shows its discovery cards after the scene that makes the thing, outside the panel
                shown[page.inner_text("#disc h2")] = ev("[...document.querySelectorAll('#disc .warn')].map(e => e.dataset.warn)")
                page.click("#disc-ok")
                ev("__bs.step(0.2)")
                continue
            if st["mode"] == "talk":  # the loop walked into Skyvra: leave, the story goes on
                page.keyboard.press("Escape")
                ev("__bs.step(0.2)")
                stuck += 1
                continue
            if lvl == 21 and "acids" in ev("__bs.save.discoveries"):
                ev("__bs.step(1)")  # the finale starts on its own
                time.sleep(0.05)
                stuck += 1
                continue
            # stuck means no progress: a level with many beats (Episode Two's level 13: rain, the bow drill, its card, the
            # pyrite, then the shelter) used more than 160 rounds while every beat was still moving it on
            prog = ev("JSON.stringify([Object.keys(__bs.save.flags).length, __bs.save.discoveries, __bs.save.inventory])")
            if prog != last_prog:
                last_prog = prog
                stuck = 0
            stuck += 1
            if stuck in (40, 100, 150):
                log(f"no progress for {stuck} rounds on level {lvl}:", ev("({mode: __bs.mode, objective: __bs.objective, me: __bs.me, ep2: __bs.ep2, ep3: __bs.ep3, engaged: !!(__bs.combat && __bs.combat.engaged), busy: __bs.save && __bs.save.flags && Object.keys(__bs.save.flags).filter(k => k.startsWith('e2.')).slice(-4)})"))
            if stuck > 160:
                log(f"stuck on level {lvl}", ev("({prompt: __bs.prompt, talk: __bs.talk, inv: __bs.save.inventory, mode: __bs.mode, paused: __bs.paused, modal: !document.getElementById('modal').classList.contains('hidden')})"))
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
            # someone else's stage: do their tasks through the real interact input
            for _ in range(24):
                if ev("__bs.mode") != "away":
                    break
                if ev("__bs.branch.open"):
                    page.keyboard.press("Space"); ev("__bs.step(0.4)"); continue
                ev("__bs.awayGoNext()"); ev("__bs.step(0.3)"); page.keyboard.press("KeyE"); time.sleep(.5); ev("__bs.step(0.5)")
            # screenshots once a level's key prop exists
            done_flags = ev("__bs.save.flags")
            for key, (name, hour) in shots_at.items():
                if done_flags.get(key) and name not in taken and ev("__bs.mode") == "play":
                    taken.add(name)
                    L = ev("__bs.layout")
                    if key == "splint":
                        frame(L["camp"][0], L["camp"][2], 6.5, 0.35, -0.12)
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
        if args.watch:
            for _ in range(240):  # the chapter's last scenes and its Vault scene, played
                if ev("__bs.state") in ("narrator", "flashback"):
                    between.append({"level": ev("__bs.level"), "state": ev("__bs.state"), "wall_s": watch_between(page, ev, "narrator")})
                elif ev("__bs.mode") == "scene":
                    watch_scene(page, ev)
                ev("__bs.step(0.5)")
            dump(ev, args.watch, {"between": between}); report([args.watch])
            browser.close(); httpd.shutdown(); return
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
        if len(trees) < 2:
            try:
                page.wait_for_selector(".pt-cols", state="visible", timeout=20000)
                trees.append({})
                shot("16-path-tree-2")
                page.click("#m-close")
                page.wait_for_selector(".pt-cols", state="hidden", timeout=5000)
            except Exception as e:
                log("no second path tree:", str(e)[:120])
        if len(trees) != 2:
            failures.append(f"path tree should open after each chapter, opened {len(trees)} times")
        if args.snapshots:
            rec = ev("__bs.cheat.recorded")
            pathlib.Path(args.snapshots).write_text(json.dumps(rec))
            log(f"cheat checkpoints: {len(rec['points'])} points, {len(rec['saves'])} saves -> {args.snapshots}")
        b = ev("__bs.branch.state")
        log("branch state:", json.dumps({k: b[k] for k in ("trust", "record", "pending", "open", "dead")}))
        picks = {e["id"]: e["pick"] for e in b["log"]}
        for k, v in {"c1.splint": "pass", "c1.fire": "big", "c1.accuse": "truth", "c1.rescue.early": "done", "c1.pello.share": "done", "c1.tovik.return": "done"}.items():
            if picks.get(k) != v:
                failures.append(f"branch log: {k} = {picks.get(k)}")
        # Episode One 1.1 adds a three-way choice when the walk passes a red fruit in level 2 (e1.fruit); it may or may not
        # come up on this route
        if [n for n in answered if n != 3] != [2, 4] or answered.count(3) > 1:
            failures.append(f"expected a two-way then a four-way choice (trust unlocks the fourth): {answered}")
        if b["pending"] or b["open"] or b["dead"]:
            failures.append(f"branch state not settled: {b['pending']} {b['open']} {b['dead']}")
        if b["trust"].get("explorer>scientist") != 5:
            failures.append(f"Skyvra's trust: {b['trust']}")
        said = ev("__bs.branch.comments('ch1')")
        log("MegaZroN says:", said)
        if "mz.br.truth" not in said or "mz.br.kind" not in said or len(said) != 3:
            failures.append(f"MegaZroN comments: {said}")
        # the dead don't speak: a line is skipped, or swapped for its fallback
        if ev("__bs.branch.lineIfDead('medic', {key: 'rad.medic', who: 'medic'})") is not None:
            failures.append("a dead crewmate's line was not skipped")
        if ev("__bs.branch.lineIfDead('medic', {key: 'rad.medic', who: 'medic', fallback: 'br.rad.static'})")["key"] != "br.rad.static":
            failures.append("a dead crewmate's line did not use its fallback")
        flags = ev("__bs.save.flags")
        for sc in ("l3", "fight", "l7", "ch1", "ep2"):
            if not flags.get(f"seen-{sc}"):
                failures.append(f"scene {sc} never played")
        final = ev("({level: __bs.level, completed: __bs.save.completed, flags: __bs.save.flags, crew: __bs.crew, hits: __bs.save.houndHits})")
        log("final:", json.dumps(final)[:600])
        if final["level"] != LAST + 1:
            failures.append(f"did not finish the arc: level {final['level']}")
        if sorted(final["completed"]) != list(range(1, LAST + 1)):
            failures.append(f"completed list wrong: {final['completed']}")
        log("fights:", fights)
        ids = [f[0] for f in fights]
        if not night_asked:
            failures.append("the first night never asked hide, brace or run")
        if "night.defence" not in ids:
            failures.append(f"the first night's fight did not start from the story: {fights}")
        if not any(i in ids for i in ("fish.spear", "hunt.first")):
            failures.append(f"the morning's food fight did not start from the story: {fights}")
        if not final["flags"].get("houndGone") or not (final["flags"].get("cb.night.held") or final["flags"].get("scarred")):
            failures.append("the first night did not end through the fight")
        if not final["flags"].get("cb.fed"):
            failures.append("breakfast did not happen")
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
        close_menus()

        # ---- discoveries: save, warnings, codex, planned entries stay locked ----
        disc = ev("__bs.save.discoveries")
        log("discoveries:", disc)
        tech = ev("__bs.tech")
        playable = [n["id"] for n in tech["nodes"] if n["status"] == "playable"]
        if sorted(disc) != sorted(playable):
            failures.append(f"discoveries {disc} != playable {playable}")
        if any(n["state"] != "planned" for n in tech["nodes"] if n["status"] == "planned"):
            failures.append("a planned entry is not locked")
        need_warn = {"Hafting with glue": "sharp", "Fire on demand": "fire", "Pottery": "heat", "Polished stone axe": "sharp"}
        for title, cat in need_warn.items():
            if cat not in shown.get(title, []):
                failures.append(f"no {cat} warning on the {title} discovery: {shown.get(title)}")
        ev("__bs.step(0.5)")
        page.keyboard.press("KeyK")
        page.wait_for_selector(".cx-ages", timeout=5000)
        if "Do not try this at home" not in page.inner_text("#modal-card"):
            failures.append("codex lacks the safety notice")
        if ev("document.querySelectorAll('.cx-node').length") != len(tech["nodes"]):
            failures.append("codex does not list every entry")
        cx = lambda i: (ev(f"document.querySelector('.cx-node[data-id={i}]').scrollIntoView({{block: 'center'}})"), page.click(f".cx-node[data-id={i}]"))  # the menu footer sits over the last rows
        cx("polish")
        body = page.inner_text(".cx-done .cx-detail:not(.hidden)")
        if "wet sand" not in body or page.locator(".cx-detail:not(.hidden) .warn").count() < 1:
            failures.append(f"codex entry incomplete: {body[:120]}")
        time.sleep(0.3)
        shot("22-codex")
        cx("bronze")
        if ev("document.querySelector('.cx-node[data-id=bronze]').dataset.state") != "planned" or "Planned" not in page.inner_text(".cx-planned .cx-detail:not(.hidden)"):
            failures.append("planned entry not shown as locked in the codex")
        page.keyboard.press("KeyK")
        close_menus()
        ev("__bs.step(0.2)")

        # ---- endings read the record: one stay and one home ending, whatever was chosen ----
        ends = ev("__bs.endings")
        log("endings on this record:", ends)
        if not ends or ends["stay"] not in ("stay.together", "stay.alone") or ends["home"] not in ("home.everyone", "home.without"):
            failures.append(f"endings not evaluated: {ends}")

        # a level can end in someone's reveal: play it out first
        for _ in range(60):
            ev("__bs.step(1)")
            if ev("__bs.mode") == "away" and ev("!!__bs.arrival"):
                # (arrivals, game/arrival.ts: the first visit to someone's world plays their landing with the controls off,
                # and the teleport waits for it; land5's run stayed on the world all 60 rounds) the Skip button's way past it
                ev("__bs.skip()"); time.sleep(0.6); ev("__bs.step(0.5)")
            elif ev("__bs.mode") == "away":
                ev("__bs.awayGoNext()"); ev("__bs.step(0.3)"); page.keyboard.press("KeyE"); time.sleep(.5); ev("__bs.step(0.5)")
            elif ev("__bs.mode") == "play" and not ev("__bs.revealDue"):
                break
        if ev("__bs.revealDue"):
            failures.append("a reveal never played")
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
        if not ev("__bs.talk") or ev("__bs.mode") != "talk":
            failures.append("trader did not open the dialogue panel")
        ev("__bs.save.inventory.branch = 2; __bs.save.inventory.flint = 0")
        time.sleep(0.3)
        shot("23-dialogue")
        log("before trade:", ev("({mode: __bs.mode, state: __bs.state, talk: __bs.talk && __bs.talk.choices, due: __bs.revealDue, modal: !!document.querySelector('#modal:not(.hidden), .modal.open'), buttons: [...document.querySelectorAll('#dlg-choices button')].map(b => b.dataset.c)})"))
        page.click('#dlg-choices button[data-c="ch.trade"]')
        page.click('#dlg-choices button[data-c="ch.tradeflint"]')
        if ev("__bs.save.inventory.flint") != 1 or ev("__bs.save.inventory.branch") != 0:
            failures.append("trade choice did not swap the items")
        if ev("__bs.talk.node") != "sold":
            failures.append(f"trade did not reach the deal line: {ev('__bs.talk')}")
        page.keyboard.press("Escape")
        ev("__bs.step(0.2)")
        if ev("__bs.mode") != "play" or ev("__bs.paused"):
            failures.append("leaving a conversation did not return to play")
        loc = next(n for n in npcs if n["id"] == "local")
        ev(f"__bs.teleport({loc['pos'][0] + 1}, {loc['pos'][2]}, 0)")
        ev("__bs.step(0.3)")
        for _ in range(3):
            n = next(x for x in ev("__bs.npcs") if x["id"] == "local")
            ev(f"__bs.teleport({n['pos'][0] + 1}, {n['pos'][2]}, 0)")
            ev("__bs.step(0.1)")
            if ev("__bs.act()") == "npc-local":
                break
        page.keyboard.press("Digit1") if ev("__bs.talk.choices[0]") == "ch.cord" else page.click('#dlg-choices button[data-c="ch.cord"]')
        if not ev("__bs.save.flags['tip-cordage']"):
            failures.append("Oom-Sa did not teach cordage")
        page.keyboard.press("Escape")
        ev("__bs.step(0.2)")
        # Skyvra re-makes what ran out, at camp
        Lc = ev("__bs.layout")["campSeat"]
        ev(f"__bs.teleport({Lc[0] + 1.2}, {Lc[2] + 0.4}, 0)")
        ev("__bs.step(0.3)")
        if ev("__bs.act()") != "skyvra":
            failures.append("could not talk to Skyvra at camp")
        else:
            page.click('#dlg-choices button[data-c="ch.next"]')
            if ev("__bs.talk.node") != "next":
                failures.append("Skyvra's choice did not advance")
            page.keyboard.press("Escape")
            ev("__bs.step(0.2)")

        # ---- persistence: reload and continue ----
        ev("__bs.save && window.dispatchEvent(new Event('beforeunload'))")
        page.reload(wait_until="domcontentloaded", timeout=240000)
        page.wait_for_function("window.__bs && window.__bs.ready", timeout=240000)
        page.click("#btn-continue")
        page.wait_for_function("window.__bs.mode === 'play'", timeout=180000)
        ev("__bs.step(2)")
        re = ev("({level: __bs.level, names: __bs.save.names, crew: __bs.crew})")
        log("after reload:", re)
        if not page.locator("#safety .safety-card").count() == 0 and page.locator("#safety .safety-card").is_visible():
            failures.append("safety card came back after being accepted")
        if len(ev("__bs.save.discoveries")) != len(disc):
            failures.append("discoveries lost on reload")
        if re["level"] != LAST + 1 or re["names"].get("scientist") != PLAYER or re["crew"]["mode"] != "camp":
            failures.append(f"save did not persist: {re}")

        # ---- a decision can't be taken back ----
        if re.get("level") == 11:
            ev("__bs.branch.demo('c1.accuse')")
            ev("__bs.step(1)")
            if ev("__bs.branch.open"):
                failures.append("an answered decision was offered again after reload")
            n = len([e for e in ev("__bs.branch.state.log") if e["id"] == "c1.accuse"])
            if n != 1 or next(e for e in ev("__bs.branch.savedLog") if e["id"] == "c1.accuse")["pick"] != "truth":
                failures.append("decision changed after reload")

        # ---- chapter select: read the tree, replay without touching the main story ----
        page.keyboard.press("Escape")
        time.sleep(0.2)
        page.click("#tab-ledger")
        # Chapter Two (levels 11 to 21) has no path nodes yet: its page shows the trust and record columns only
        page.wait_for_selector(".path-tree" if LAST + 1 > 21 else ".pt-cols", timeout=5000)
        page.click("#tab-pause")
        page.click("#p-quit")
        page.wait_for_function("window.__bs.state === 'title'", timeout=60000)
        page.click("#btn-chapters")
        page.wait_for_selector("[data-ch='1']", timeout=5000)
        shot("17-chapters")
        page.click("[data-ch='1']")
        page.wait_for_selector("#pt-replay", timeout=5000)
        before = ev("localStorage.getItem('bs-save-v1')")
        page.click("#pt-replay")
        page.wait_for_function("window.__bs.state === 'game' && window.__bs.mode === 'wake'", timeout=60000)
        page.keyboard.press("Enter")
        page.wait_for_function("window.__bs.mode === 'play'", timeout=180000)
        ev("__bs.step(1)")
        ev("window.dispatchEvent(new Event('beforeunload'))")
        rp = ev("({replay: __bs.save.replay, level: __bs.level, log: __bs.branch.state.log.length, tut: __bs.tutorial})")
        log("replay:", rp)
        if rp["replay"] != 1 or rp["level"] != 1 or rp["log"] or rp["tut"]:
            failures.append(f"replay did not start clean: {rp}")
        if ev("localStorage.getItem('bs-save-v1')") != before or not ev("localStorage.getItem('bs-save-replay-v1')"):
            failures.append("replay touched the main save")

        # ---- other languages ----
        for lang in ("hi", "ur"):
            ev(f"localStorage.setItem('bs-settings-v1', JSON.stringify({{lang: '{lang}', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}}))")
            page.reload(wait_until="domcontentloaded", timeout=240000)
            page.wait_for_function("window.__bs && window.__bs.ready", timeout=240000)
            page.click("#btn-continue")
            page.wait_for_function("window.__bs.mode === 'play'", timeout=180000)
            time.sleep(3)
            d = ev("document.documentElement.dir")
            if lang == "ur" and d != "rtl":
                failures.append("Urdu is not RTL")
            txt = page.inner_text("#hud")
            if "level." in txt or "item." in txt or "{" in txt:
                failures.append(f"{lang}: untranslated key in HUD: {txt[:200]}")
            shot(f"13-hud-{lang}")
            page.keyboard.press("KeyK")
            page.wait_for_selector(".cx-ages", timeout=5000)
            ev("document.querySelector('.cx-node[data-id=glass]').scrollIntoView({block: 'center'})")
            ev("document.querySelector('.cx-node[data-id=glass]').scrollIntoView({block: 'center'})")
            ev("document.querySelector('.cx-node[data-id=glass]').click()")
            time.sleep(1)
            shot(f"24-codex-{lang}")
            ctext = page.inner_text("#modal-card")
            if "codex." in ctext or "tech." in ctext or "warn." in ctext:
                failures.append(f"{lang}: untranslated key in the codex")
            page.keyboard.press("KeyK")
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
