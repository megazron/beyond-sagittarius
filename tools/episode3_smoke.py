"""Episode Three smoke test ("A Place to Stay", levels 15 to 21; built so far: levels 15 to 21).

Serves dist/, writes a save that stands at the start of level 15 (Episode Two finished), continues it, and plays the
episode through the real interaction code, as tools/levels_smoke.py does: it teleports next to the objective marker
and presses "E" through window.__bs.act(), steps game time, answers each choice with the option given in --picks,
plays the craft panels with real key events (ruining one try on purpose, so the failure line is heard), answers the
difficulty question and steps the firing night's fight to its end. Then it checks the flags each beat sets, that the
Ledger page was read, and that a reload keeps it all.

With --outcome AT (a moment with a sealed outcome, e.g. e3.wall) the run sets the flags given in --flags on the save, fails
every hold-steady at that moment (an arrow key held across it), and then checks the sealed outcome itself: its effects
took, its own lines were spoken, every later line follows it (nobody it took speaks again, a rule's swapped line is the
one used) and the crew panel and the roster agree. The log names no outcome, person or line. --from 19 starts from a
save at level 19 with levels 15 to 18 done (faster; the choices of the default picks).

Usage: python tools/episode3_smoke.py [--quality web|mobile] [--picks e2.snare=far,e2.kiln=kept,...] [--shots DIR]
       [--from 15|19] [--flags a,b] [--outcome AT]
"""
import argparse
import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402
from levels_smoke import play_craft  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP = "(() => { const b = document.getElementById('btn-skip'); if (b && b.offsetParent) b.click(); })()"
DEFAULT_PICKS = {"e3.site": "rise", "e3.door": "lee", "e3.field": "half", "e3.dose": "boy", "e3.wall": "hold", "e3.kit": "kept", "e3.pello": "ask", "e3.name": "clay"}

# Episode One done: what the levels before 11 leave on the save (flags the old levels and Episode One set)
EP1_FLAGS = ["drank", "ateSafe", "pitBuilt", "fire", "shelter", "spear", "slept", "signal", "crewCamp", "arcEnd", "houndGone",
             "e1.night", "e1.dawn", "inv.goodStone", "inv.flake", "inv.woodBone", "inv.fireDrill", "inv.fireSpear", "cb.fed",
             "seen-l3", "seen-fight", "seen-l7", "seen-ch1", "tutDone", "medicHint", "played.explorer", "fire.high", "cb.night.held",
             "e1.stoneSeen", "e1.fruitSeen", "nightMsg", "safetyJoke", "beaconBuilt", "transmitter"]


def save_at_11():
    flags = {k: True for k in EP1_FLAGS}
    return {
        "version": 1, "level": 11, "completed": list(range(1, 11)),
        "stats": {"health": 100, "thirst": 90, "hunger": 90, "stamina": 100},
        "inventory": {"stone": 3, "branch": 4, "tinder": 2, "flint": 1}, "pos": [0, 0, 0], "yaw": 0,
        "timeOfDay": 10.0, "day": 2, "flags": flags, "collected": [], "names": {}, "houndHits": 0,
        "discoveries": [], "crafts": {"failed": 0},
        "branch": {"trust": {"explorer>scientist": 3}, "record": {"honesty": 1, "mercy": 1, "nerve": 1, "humour": 0},
                   "log": [{"id": "e1.fire", "pick": "high", "t": 0}], "dead": {}, "pending": [], "open": None, "marks": {}},
        "savedAt": 1,
    }



EP2_DONE = ["e2.l11.intro", "e2.snareSet", "e2.snare.near", "e2.voiceDone", "e2.called", "e2.met", "e2.l12.glue", "e2.l13.intro", "e2.pyriteDone",
            "e2.cairnDone", "e2.cairn.six", "e2.l14.intro", "e2.potsMade", "e2.kiln.decided", "e2.kiln.kept", "e2.nightDone", "e2.done", "inv.cordage",
            "inv.haft", "inv.hafting", "inv.bowDrill", "inv.pyrite", "inv.ochre", "inv.pottery", "seen-ep2", "ch2Intro"]


def save_at_15():
    s = save_at_11()
    s["level"] = 15; s["completed"] = list(range(1, 15)); s["day"] = 10
    for k in EP2_DONE:
        s["flags"][k] = True
    s["discoveries"] = ["knapping", "cordage", "haft", "fire", "pottery"]
    s["inventory"].update({"pot": 3, "cord": 1, "stone": 3, "sand": 1})
    s["branch"]["trust"]["oomsa>scientist"] = 2
    s["branch"]["log"] += [{"id": d, "pick": p, "t": 0} for d, p in (("e2.snare", "near"), ("e2.voice", "shout"), ("e2.stranger", "give"), ("e2.mark", "six"), ("e2.kiln", "kept"))]
    return s


# levels 15 to 18 done (the default picks: rise, lee, half, boy): what those levels leave on the save
E3_DONE = ["e3.l15.intro", "e3.seen.camp", "e3.seen.reeds", "e3.seen.rise", "e3.siteDone", "e3.axeTried", "e3.felled", "inv.polishedAxe",
           "e3.l16.intro", "e3.frameUp", "e3.thatched", "e3.houseDone", "inv.frame", "inv.lever", "e3.wk.copy", "e3.cut",
           "e3.l17.intro", "e3.wheat", "e3.bread", "inv.grain", "e3.fieldIntro", "e3.fieldDone", "inv.farming",
           "e3.l18.intro", "e3.boiled", "e3.doseDone", "inv.medicine", "played.builder",
           "e3.site.rise", "e3.door.lee", "e3.field.half", "e3.dose.boy"]


def save_at_19():
    s = save_at_15()
    s["level"] = 19; s["completed"] = list(range(1, 19)); s["day"] = 30
    for k in E3_DONE:
        s["flags"][k] = True
    s["discoveries"] += ["polish", "frame", "grain", "farming", "remedy"]
    s["branch"]["log"] += [{"id": d, "pick": p, "t": 0, "kind": "decision", "level": 15, "day": 11, "at": 0}
                           for d, p in (("e3.site", "rise"), ("e3.door", "lee"), ("e3.field", "half"), ("e3.dose", "boy"))]
    return s


def sealed_ep3():
    sys.path.insert(0, str(ROOT / "tools"))
    from story_seal import unseal
    return unseal((ROOT / "src/game/branch/episode3.sealed").read_text())


# every subtitle the game shows, with the level it showed at (the cutscenes and ui.say both come through ui.subtitle)
SUB_LOG = """(() => { if (window.__subs) return; window.__subs = []; const u = __bs.game.ui, o = u.subtitle.bind(u);
  u.subtitle = (k, w) => { if (k) window.__subs.push([__bs.level, k, w || '']); return o(k, w); }; })()"""


def check_outcome(ev, sealed, at, failures, log, disc_html):
    """The sealed outcome at `at`: its effects, its lines, and that what follows respects it. Logs nothing by name."""
    o = next((x for x in sealed.get("outcomes", []) if x["at"] == at), None)
    if not o:
        failures.append(f"no sealed outcome at {at}"); return
    f = ev("__bs.save.flags"); dead = ev("__bs.branch.state.dead") or {}
    if not f.get(o["id"]):
        failures.append(f"outcome at {at} never happened"); return
    lost = []
    for e in o["effects"]:
        if "flag" in e and not f.get(e["flag"]):
            failures.append(f"outcome at {at}: a flag effect did not take")
        if "kill" in e:
            lost.append(e["kill"])
            if e["kill"] not in dead:
                failures.append(f"outcome at {at}: a kill effect did not take")
    subs = ev("window.__subs || []")
    own = {b["key"] for b in o["beats"] + o.get("after", []) if b.get("key")}
    spoken = {k for _, k, _ in subs}
    for k in own:
        if k not in spoken:
            failures.append(f"outcome at {at}: one of its own lines was never shown")
    # (in the order shown: everything after the outcome's last own line)
    last = max((i for i, (_, k, _) in enumerate(subs) if k in own), default=len(subs))
    for who in lost:
        name = f"crew.{who}.name"
        late = [k for _, k, w in subs[last + 1:] if w == name]
        if late:
            failures.append(f"outcome at {at}: {len(late)} later line(s) by someone it took")
        st = ev(f"__bs.game.story.crewStatus({who!r})")
        if st.get("unlocked") or st.get("play"):
            failures.append(f"outcome at {at}: the crew panel still offers someone it took")
        if ev(f"(() => {{ const r = __bs.game.revealDue; return !!r && r.id === {who!r}; }})()"):
            failures.append(f"outcome at {at}: the roster would still tell the story of someone it took")
    for key, rule in sealed.get("lines", {}).items():
        for sw in rule.get("swap", []):
            if key in spoken:
                failures.append(f"outcome at {at}: a line was spoken as written where the story had changed it")
            if key.startswith("codex.") and disc_html is not None:
                want = sealed.get("strings", {}).get("en", {}).get(sw["key"])
                if want and want not in disc_html:
                    failures.append(f"outcome at {at}: the codex card did not follow it")
            elif not key.startswith("codex.") and sw["key"] not in spoken:
                failures.append(f"outcome at {at}: a changed line was never shown")
    log(f"outcome at {at}: checked ({len(o['effects'])} effects, {len(own)} own lines, {len(sealed.get('lines', {}))} line rules)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quality", default="web")
    ap.add_argument("--port", type=int, default=4181)
    ap.add_argument("--picks", default="")
    ap.add_argument("--shots", default="")
    ap.add_argument("--from", dest="start", type=int, default=15, choices=(15, 19))
    ap.add_argument("--flags", default="")
    ap.add_argument("--outcome", default="")
    args = ap.parse_args()
    sealed = sealed_ep3() if args.outcome else None
    fail_at = 19 if args.outcome == "e3.wall" else None
    disc_html = None
    holding = False
    picks = dict(DEFAULT_PICKS)
    for kv in filter(None, args.picks.split(",")):
        k, v = kv.split("=")
        picks[k] = v
    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    errors: list[str] = []
    httpd = serve(args.port)
    url = f"http://127.0.0.1:{args.port}/index.html?prologue=0&quality={args.quality}&diff=story"
    log = lambda *a: print(*a, flush=True)
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.set_default_timeout(120000)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        sv = save_at_19() if args.start == 19 else save_at_15()
        for k in filter(None, args.flags.split(",")):
            sv["flags"][k] = True
        save = json.dumps(sv)
        page.add_init_script("if (!localStorage.getItem('bs-settings-v1')) localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}))")
        page.goto(url, wait_until="domcontentloaded", timeout=120000)
        page.evaluate(f"localStorage.setItem('bs-save-v1', {json.dumps(save)})")
        page.reload(wait_until="domcontentloaded", timeout=120000)
        page.wait_for_function("window.__bs && window.__bs.ready", timeout=240000)
        ev = page.evaluate
        shot = (lambda name: page.screenshot(path=str(shots / f"{args.quality}-{name}.jpg"), type="jpeg", quality=84)) if shots else (lambda name: None)
        if page.locator("#sf-ok").is_visible():
            page.click("#sf-ok")
        page.click("#btn-continue")
        page.wait_for_function("window.__bs.mode === 'play'", timeout=180000)
        ev("__bs.step(1)")
        ev(SUB_LOG)
        log("start:", ev("({level: __bs.level, day: __bs.save.day, t: __bs.save.timeOfDay})"))

        answered, fights, seen, taken = [], [], [], set()
        last, stuck, busy_n = 0, 0, 0
        for it in range(2600):
            lvl = ev("__bs.level")
            if lvl != last:
                log(f"-> level {lvl} (iteration {it})", ev("({flags: Object.keys(__bs.save.flags).filter(k => k.startsWith('e3.')).join(' ')})"))
                seen.append(lvl); last = lvl; stuck = 0; busy_n = 0
            if lvl > 21:
                break
            if ev("!document.getElementById('modal').classList.contains('hidden') && !!document.querySelector('[data-diff]')"):
                ev("document.querySelector('[data-diff=\"story\"]').click()"); ev("__bs.step(0.2)"); continue
            if ev("!document.getElementById('modal').classList.contains('hidden') && !!document.getElementById('cb-goon')"):
                fights.append("lost"); ev("document.getElementById('cb-goon').click()"); time.sleep(0.6); continue
            enc = ev("__bs.combat && __bs.combat.run ? {id: __bs.combat.run.id, phase: __bs.combat.run.phase, out: __bs.combat.run.outcome && __bs.combat.run.outcome.result} : null")
            if enc:
                if not fights or fights[-1] != enc["id"]:
                    fights.append(enc["id"]); log("fight:", enc["id"], "level", lvl); shot(f"e3-fight-{enc['id']}")
                if enc["out"]:
                    time.sleep(0.5); ev("__bs.step(0.5)"); continue
                if enc["id"] == "night.defence" and enc["phase"] == "prep":
                    ev("__bs.combat.run.ready()")
                ev("__bs.step(4)"); continue
            if ev("__bs.branch.open"):
                time.sleep(0.4)
                opts = ev("[...document.querySelectorAll('#dlg-choices button')].map(b => b.dataset.c)")
                did = False
                for d, o in picks.items():
                    want = f"{d}.o.{o}"
                    if want in opts:
                        shot(f"e3-choice-{d}")
                        ev(f"document.querySelector('#dlg-choices button[data-c=\"{want}\"]').click()")
                        answered.append((d, o)); did = True; break
                if not did:
                    log("choice not in plan, taking the first:", opts)
                    answered.append(("?", opts[0] if opts else None)); page.keyboard.press("Digit1")
                ev("__bs.step(0.2)"); continue
            st = ev("({state: __bs.state, mode: __bs.mode})")
            if st["state"] == "narrator":
                time.sleep(1.5); shot("e2-ledger"); ev(SKIP); time.sleep(1); continue
            if st["mode"] == "scene" and args.outcome and lvl >= 19:
                # with --outcome the scenes after the moment play out (their lines are checked), not skipped
                for _ in range(400):
                    ev("__bs.step(0.3)"); time.sleep(0.05)
                    if ev("__bs.branch.open") or ev("__bs.mode") != "scene":
                        break
                continue
            if st["mode"] == "scene":
                for _ in range(8):
                    ev("__bs.step(0.2)")
                    if ev("__bs.branch.open"):
                        break
                if ev("__bs.branch.open"):
                    continue
                n = len(taken); taken.add(f"scene{it}")
                if n < 80:
                    shot(f"e3-scene-{lvl}-{it}")
                ev("__bs.skip()"); ev("__bs.step(0.1)"); continue
            if st["mode"] == "craft":
                cr = ev("__bs.craft")
                if cr:
                    shot(f"e3-craft-{cr['id']}")
                    play_craft(page, ev, taken, failures, log, ruin_once=cr["id"] if cr["id"] in ("pottery", "haft", "grain") else None)
                if page.locator("#disc h2").is_visible():
                    log("discovery:", page.inner_text("#disc h2")); page.keyboard.press("Enter"); ev("__bs.step(0.2)")
                continue
            if page.locator("#disc h2").is_visible():
                if lvl == 19:
                    disc_html = page.inner_text("#disc")
                log("discovery:", page.inner_text("#disc h2")); shot(f"e3-disc-{lvl}"); page.click("#disc-ok"); ev("__bs.step(0.2)"); continue
            if st["mode"] == "talk":
                # a decision panel is a talk too: it can open between the check above and this one (CI-picks run: the
                # name panel was closed with Escape, nothing chosen)
                time.sleep(0.3)
                if ev("__bs.branch.open"):
                    continue
                if lvl >= 21:
                    log("escape from a talk:", ev("({choices: [...document.querySelectorAll('#dlg-choices button')].map(b => b.dataset.c), flags: Object.keys(__bs.save.flags).filter(k => k.startsWith('e3.p') || k.startsWith('e3.n'))})"))
                page.keyboard.press("Escape"); ev("__bs.step(0.2)"); stuck += 1; continue
            if st["mode"] == "away":
                for _ in range(24):
                    if ev("__bs.mode") != "away":
                        break
                    if fail_at == lvl and ev("!!(__bs.combat && __bs.combat.debug().tension)"):
                        # every hold steady here fails: the marker is pushed off the band and held there
                        if not holding:
                            page.keyboard.down("KeyA"); holding = True
                        time.sleep(0.15); ev("__bs.step(0.3)"); continue
                    if holding:
                        page.keyboard.up("KeyA"); holding = False
                    if ev("__bs.branch.open"):
                        # Draxum's wall (level 19) asks on his own stage: take the planned pick there too
                        time.sleep(0.4)
                        opts = ev("[...document.querySelectorAll('#dlg-choices button')].map(b => b.dataset.c)") or []
                        hit = next(((d, o) for d, o in picks.items() if f"{d}.o.{o}" in opts), None)
                        if hit:
                            shot(f"e3-choice-{hit[0]}"); ev(f"document.querySelector('#dlg-choices button[data-c=\"{hit[0]}.o.{hit[1]}\"]').click()"); answered.append(hit)
                        else:
                            page.keyboard.press("Space")
                        ev("__bs.step(0.4)"); continue
                    ev("__bs.awayGoNext()"); ev("__bs.step(0.3)"); page.keyboard.press("KeyE"); time.sleep(.4); ev("__bs.step(0.5)")
                continue
            # a scene's real-time moment (a hold steady, a quick press) or a timed beat: the story is busy, not stuck
            if ev("!!(__bs.ep3 && __bs.ep3.busy)") and busy_n < 900:
                busy_n += 1; time.sleep(0.15); ev("__bs.step(0.3)"); continue
            stuck += 1
            if stuck > 220:
                failures.append(f"stuck on level {lvl}: {ev('({prompt: __bs.prompt, mode: __bs.mode, inv: __bs.save.inventory, flags: Object.keys(__bs.save.flags).filter(k => k.startsWith(\"e2.\"))})')}")
                break
            ev("__bs.gotoObjective()"); ev("__bs.step(0.2)")
            label = ev("__bs.act()"); ev("__bs.step(0.3)")
            if label is None:
                ev("__bs.step(1.0)")

        # the level after the last built one says so once in plain play: a crew member's own story (the roster) or a card
        # can come first, so play those out
        for _ in range(120):
            if ev("__bs.level") >= 22 and ev("__bs.mode") == "play":
                break
            m = ev("__bs.mode")
            if m == "away":
                if ev("__bs.branch.open"):
                    page.keyboard.press("Space")
                ev("__bs.awayGoNext()"); ev("__bs.step(0.3)"); page.keyboard.press("KeyE"); time.sleep(.3)
            elif page.locator("#disc h2").is_visible():
                page.click("#disc-ok")
            elif m == "scene":
                ev(SKIP); ev("__bs.skip()")
            ev("__bs.step(0.5)")
        log("after the last level:", ev("({mode: __bs.mode, level: __bs.level, ep3: __bs.ep3, ledger: !!__bs.save.flags['e3.ledger']})"))
        f = ev("__bs.save.flags")
        log("answered:", answered)
        log("discoveries:", ev("__bs.save.discoveries"))
        log("e3 flags:", sorted(k for k in f if k.startswith("e3.") or k.startswith("inv.p")))
        if args.outcome:
            check_outcome(ev, sealed, args.outcome, failures, log, disc_html)
        want = ["e3.l15.intro", "e3.seen.camp", "e3.seen.reeds", "e3.seen.rise", "e3.siteDone", "e3.axeTried", "e3.felled", "inv.polishedAxe",
                "e3.l16.intro", "e3.frameUp", "e3.thatched", "e3.houseDone", "inv.frame", "inv.lever",
                # the save has trust 2 and no bite from the firing night: Wen-Ka copies him, and the axe slips on a knot
                "e3.wk.copy", "e3.cut",
                "e3.l17.intro", "e3.wheat", "e3.bread", "inv.grain", "e3.fieldIntro", "e3.fieldDone", "inv.farming",
                "e3.l18.intro", "e3.boiled", "e3.doseDone", "inv.medicine",
                "e3.l19.intro", "e3.wallDone", "played.strong",
                "e3.l20.intro", "inv.irrigation", "e3.kitDone", "e3.l21.intro", "e3.harvest", "e3.stored", "e3.stormDone", "e3.pelloDone", "e3.named", "e3.ledger"]
        if picks.get("e3.site") == "camp":
            want.append("e3.ditch")
        for k in want:
            if not f.get(k):
                failures.append(f"flag never set: {k}")
        for n in ("polish", "frame", "grain", "farming", "remedy", "icewall", "irrigation", "salt"):
            if n not in ev("__bs.save.discoveries"):
                failures.append(f"not discovered: {n}")
        house = ev("__bs.ep3 && __bs.ep3.house")
        log("house:", house)
        if not house or house["parts"] < 40:
            failures.append(f"no house standing at the site: {house}")
        got = dict(answered)
        for d in ("e3.site", "e3.door", "e3.field", "e3.dose", "e3.wall", "e3.kit", "e3.pello", "e3.name"):
            if args.start == 19 and d in ("e3.site", "e3.door", "e3.field", "e3.dose"):
                continue
            if d not in got:
                failures.append(f"decision never asked: {d}")
        log_ids = {e["id"]: e["pick"] for e in ev("__bs.branch.state.log")}
        for d, o in got.items():
            if d.startswith("e3.") and log_ids.get(d) != o:
                failures.append(f"branch log: {d} = {log_ids.get(d)}, wanted {o}")
            if d.startswith("e3.") and not f.get(f"{d}.{o}"):
                failures.append(f"choice flag not set: {d}.{o}")
        field = ev("__bs.ep3 && __bs.ep3.field")
        log("field:", field)
        want_rows = 9 if picks.get("e3.field") == "all" else 5
        if not field or field["rows"] != want_rows:
            failures.append(f"field rows: {field}, wanted {want_rows}")
        if ev("__bs.level") != 22:
            failures.append(f"did not reach level 22: {ev('__bs.level')}")

        # ---- reload: everything Episode Three set is still there ----
        ev("window.dispatchEvent(new Event('beforeunload'))")
        page.reload(wait_until="domcontentloaded", timeout=240000)
        page.wait_for_function("window.__bs && window.__bs.ready", timeout=240000)
        page.click("#btn-continue")
        page.wait_for_function("window.__bs.mode === 'play'", timeout=180000)
        ev("__bs.step(1)")
        f2 = ev("__bs.save.flags")
        if ev("__bs.level") != 22 or not f2.get("e3.felled") or not f2.get("e3.houseDone") or not f2.get("e3.ledger") or "salt" not in ev("__bs.save.discoveries"):
            failures.append("Episode Three did not survive a reload")
        field2 = ev("__bs.ep3 && __bs.ep3.field")
        if not field2 or field2["rows"] != want_rows:
            failures.append(f"the field did not come back after a reload: {field2}")

        # ---- an old-design save at level 18 (charcoal, lime and salt made) starts Episode Three at level 15 ----
        old = save_at_11(); old["level"] = 18; old["completed"] = list(range(1, 18)); old["discoveries"] = ["knapping", "cordage", "fire", "pottery", "charcoal", "lime", "salt"]
        # (a reload saves the running game over it on the way out: a new page, then the old save, then a reload)
        page.close()
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.set_default_timeout(120000)
        ev = page.evaluate
        page.goto(url, wait_until="domcontentloaded", timeout=120000)
        page.wait_for_function("window.__bs && window.__bs.ready", timeout=240000)
        page.evaluate(f"localStorage.setItem('bs-save-v1', {json.dumps(json.dumps(old))}); localStorage.setItem('bs-settings-v1', JSON.stringify({{lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}}))")
        page.reload(wait_until="domcontentloaded", timeout=240000)
        page.wait_for_function("window.__bs && window.__bs.ready", timeout=240000)
        if page.locator("#sf-ok").is_visible():
            page.click("#sf-ok")
        page.click("#btn-continue")
        page.wait_for_function("window.__bs.mode === 'play'", timeout=180000)
        ev("__bs.step(1)")
        mig = ev("({level: __bs.level, migrated: !!__bs.save.flags['e3.migrated'], done2: !!__bs.save.flags['e2.done'], completed: __bs.save.completed.length})")
        log("old save:", mig)
        if mig["level"] != 15 or not mig["migrated"] or not mig["done2"] or mig["completed"] != 14:
            failures.append(f"an old level 18 save did not start Episode Three at 15: {mig}")
        browser.close()
    httpd.shutdown()
    real = [e for e in errors if "fonts.g" not in e and "net::ERR" not in e]
    for e in real:
        print(e)
    failures += real
    if failures:
        print(f"FAILED ({len(failures)}):")
        for x in failures:
            print(" -", x)
        sys.exit(1)
    print(f"OK - Episode Three levels {seen} played, picks {answered}")


if __name__ == "__main__":
    main()
