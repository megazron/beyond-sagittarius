"""Watched cutscene time between the player's inputs, measured in a real playthrough.

The episode smokes take `--watch OUT.json`: their scenes are then played to their ends on the game clock instead of
skipped (every line spoken at its length, every hold held), the choice layer's moments answered with the real keys
as they open, and the Vault and flashback scenes between levels left to play. The game keeps the count itself
(game.ts `watch`): a stretch is the cutscene seconds since the player last did anything, closed by a decision or a
reflex opening or by his getting control back. This module has the scene player and the report.

  python tools/watch_time.py OUT1.json [OUT2.json ...]   prints the report of runs already made
"""
import json
import sys
import time


def watch_scene(page, ev, dt=0.5, limit=4000):
    """Play the scene on screen to its end. Returns when it ends or when the dialogue panel asks something (the smoke's
    own loop answers those). The choice layer's moments are answered here: the first option of a decision, E for a
    reflex (pressed, held for a hold, on each beat)."""
    for _ in range(limit):
        if ev("__bs.moment.open"):
            o = ((ev("__bs.moment.saved") or {}).get("branch") or {}).get("open") or {}
            ev("__bs.step(0.35)"); page.wait_for_timeout(400)  # past the guard against a held key (real time)
            page.keyboard.press("Digit1" if o.get("kind") == "decision" else "KeyE")
            for _ in range(60):
                if not ev("__bs.moment.open"): break
                ev("__bs.step(0.1)")
            continue
        if ev("__bs.branch.open"):
            return
        if ev("__bs.mode") != "scene":
            return
        ev(f"__bs.step({dt})")


def watch_between(page, ev, state, limit_s=900):
    """A Vault or flashback scene between levels, left to play in real time. Returns its wall seconds."""
    t0 = time.time()
    while time.time() - t0 < limit_s:
        if ev("__bs.state") == "game":
            break
        time.sleep(0.5)
    return round(time.time() - t0, 1)


def dump(ev, path, extra=None):
    w = ev("__bs.watch") or {}
    w.update(extra or {})
    json.dump(w, open(path, "w"), indent=1)
    return w


def report(paths):
    for p in paths:
        w = json.load(open(p))
        st = w.get("stretches", [])
        print(f"{p}: {len(st)} stretches")
        by = {}
        for s in st:
            by.setdefault(s["level"], []).append(s)
        tot = 0.0
        for lvl in sorted(by):
            xs = by[lvl]
            sec = sum(s["sec"] for s in xs)
            tot += sec
            longest = max(xs, key=lambda s: s["sec"])
            print(f"  level {lvl}: {sec / 60:.1f} min watched in {len(xs)} stretches; longest {longest['sec'] / 60:.1f} min "
                  f"(ended by {longest['end']}); choices {sum(1 for s in xs if s['end'] == 'choice')}")
        allx = sorted((s["sec"] for s in st), reverse=True)
        if allx:
            print(f"  total {tot / 60:.1f} min; longest stretches (min): {[round(x / 60, 1) for x in allx[:6]]}; "
                  f"over 4 min: {sum(1 for x in allx if x > 240)}")
        for v in w.get("between", []):
            print(f"  between levels: {v}")


if __name__ == "__main__":
    report(sys.argv[1:])
