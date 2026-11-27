"""Plays the game on from wherever it is, through the real interaction code, until a test says stop.

The loop of tools/levels_smoke.py without its checks and photographs, for tools/cheat_smoke.py (a level played to its
end from a cheat checkpoint) and capture plans: it answers the difficulty question with Story, steps the story's
fights to their end, closes the path tree, answers choices with the first option (`pick`) and presses reflexes, skips
the Vault, memories and scenes, plays the craft panels with real keys, and otherwise walks to the objective marker
(__bs.gotoObjective) and presses E (__bs.act), with game time stepped by __bs.step.

    from cheat_play import drive
    why = drive(page, ev, log, stop=lambda st: st['level'] > 12, rounds=900)   # 'stop', 'stuck', 'dead' or 'rounds'
"""
import time

from levels_smoke import play_craft

MODAL = "!document.getElementById('modal').classList.contains('hidden')"


def drive(page, ev, log, stop, rounds=900, pick="Digit1"):
    taken, last_prog, stuck = set(), "", 0
    for it in range(rounds):
        st = ev("({state: __bs.state, level: __bs.level, mode: __bs.mode, hound: __bs.state === 'game' && __bs.save ? __bs.hound : null})")
        if stop(st):
            return "stop"
        lvl = st["level"]
        if ev(MODAL + " && !!document.querySelector('[data-diff]')"):
            ev("document.querySelector('[data-diff=\"story\"]').click()"); ev("__bs.step(0.2)"); continue
        if ev(MODAL + " && !!document.getElementById('cb-goon')"):
            ev("document.getElementById('cb-goon').click()"); time.sleep(0.8); continue
        enc = ev("__bs.combat && __bs.combat.run ? {id: __bs.combat.run.id, phase: __bs.combat.run.phase, out: __bs.combat.run.outcome && __bs.combat.run.outcome.result} : null")
        if enc:
            if enc["out"]:
                time.sleep(0.6); ev("__bs.step(0.5)"); continue
            if enc["id"] == "night.defence" and enc["phase"] == "prep":
                ev("__bs.combat.run.ready()")
            if enc["id"] in ("fish.spear", "hunt.first") and ev("__bs.combat.run.t") > 6:
                ev("__bs.combat.leaveEncounter()")
            ev("__bs.step(4)"); continue
        if page.locator(".pt-cols").is_visible():
            page.click("#m-close"); time.sleep(0.5); continue
        if ev("__bs.branch.open") or ev("__bs.moment.open"):
            time.sleep(0.4)
            if page.locator("#qte-btn").is_visible():
                page.keyboard.press("KeyE")
            elif ev("!!document.querySelector('#dlg-choices button[data-c=\"e1.night.o.brace\"]')"):
                ev("document.querySelector('#dlg-choices button[data-c=\"e1.night.o.brace\"]').click()")
            else:
                page.keyboard.press(pick)
            ev("__bs.step(0.2)"); continue
        if st["state"] in ("narrator", "flashback", "cinematic", "film"):
            time.sleep(1.0)
            ev("__bs.skip()"); time.sleep(0.5); continue
        if st["state"] != "game":
            time.sleep(0.5); stuck += 1
            if stuck > 120:
                return "stuck"
            continue
        if st["mode"] == "wake":
            page.keyboard.press("Enter"); ev("__bs.step(0.5)"); time.sleep(0.3); continue
        if st["mode"] == "scene":
            for _ in range(8):
                ev("__bs.step(0.2)")
                if ev("__bs.branch.open"):
                    break
            if not ev("__bs.branch.open"):
                time.sleep(0.3); ev("__bs.skip()"); ev("__bs.step(0.1)")
            continue
        if st["mode"] == "dead":
            page.click("#d-retry"); ev("__bs.step(1)"); continue
        if st["mode"] == "craft":
            if ev("__bs.craft"):
                play_craft(page, ev, taken, [], log)
            if page.locator("#disc h2").is_visible():
                page.keyboard.press("Enter"); ev("__bs.step(0.2)")
            continue
        if page.locator("#disc h2").is_visible():
            page.click("#disc-ok"); ev("__bs.step(0.2)"); continue
        if st["mode"] == "talk":
            page.keyboard.press("Escape"); ev("__bs.step(0.2)"); stuck += 1; continue
        if lvl == 21 and "acids" in (ev("__bs.save.discoveries") or []):
            ev("__bs.step(1)"); time.sleep(0.05); stuck += 1
        prog = ev("JSON.stringify([__bs.level, Object.keys(__bs.save.flags).length, __bs.save.discoveries, __bs.save.inventory])")
        if prog != last_prog:
            last_prog, stuck = prog, 0
        stuck += 1
        if stuck > 160:
            log("stuck:", ev("({level: __bs.level, mode: __bs.mode, prompt: __bs.prompt, objective: __bs.objective})"))
            return "stuck"
        h = st["hound"]
        if lvl == 7 and h and h["state"] not in ("hidden", "flee"):
            if h["window"]:
                ev("__bs.act()"); ev("__bs.step(1.6)")
            else:
                ev("__bs.step(0.25)")
            continue
        target = ev("__bs.gotoObjective()")
        ev("__bs.step(0.2)")
        label = ev("__bs.act()")
        ev("__bs.step(0.3)")
        if label is None and target is None:
            ev("__bs.step(1.0)")
        for _ in range(24):
            if ev("__bs.mode") != "away":
                break
            if ev("__bs.branch.open"):
                page.keyboard.press("Space"); ev("__bs.step(0.4)"); continue
            ev("__bs.awayGoNext()"); ev("__bs.step(0.3)"); page.keyboard.press("KeyE"); time.sleep(.5); ev("__bs.step(0.5)")
    return "rounds"
