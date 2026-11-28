"""The Ledger's questions in the browser: the board, the closing beats and "previously" on Continue.

Serves dist/. Through the cheat menu's checkpoints (the real save is never touched):
  - L11.start: the Ledger opens, QUESTIONS shows five questions, eleven entries and four things walked past; the switch
    carries a dot until the board is opened, and nothing is new after it.
  - L<n>.hook for a few levels: the closing beat starts within 20 s, marks itself played, and the game is back in play
    after it (skipped once it has started).
  - L14.start with recap=always: three lines over the black, a key skips them, and play begins.
Nothing of the story is printed (keys and counts only).

Usage: python tools/mystery_smoke.py [--hooks 0,7,13] [--quality web]
"""
import argparse
import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4767)
    ap.add_argument("--quality", default="web")
    ap.add_argument("--hooks", default="0,7,13")
    a = ap.parse_args()
    log = lambda *x: print(*x, flush=True)
    httpd = serve(a.port)
    fails: list[str] = []
    base = f"http://127.0.0.1:{a.port}/index.html?prologue=0&quality={a.quality}"
    with sync_playwright() as pw:
        b = launch(pw)
        ctx = b.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}))")
        ctx.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
        page = ctx.new_page()
        page.set_default_timeout(120000)
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        ev = page.evaluate

        def jump(target: str, extra: str = ""):
            errors.clear()
            page.goto(base + f"&cheat={target}&cgo=1&cpick=a{extra}", wait_until="domcontentloaded", timeout=180000)
            page.wait_for_function("window.__bs && window.__bs.ready", timeout=300000)

        def wait_play(sec=240):
            page.wait_for_function("__bs.state === 'game' && __bs.mode === 'play'", timeout=sec * 1000)

        # ---- the board ----
        try:
            jump("L11.start")
            wait_play()
            time.sleep(1.0)
            bd = ev("__bs.mystery.board()")
            log(f"board at L11: {len(bd['questions'])} questions, {sum(1 for c in bd['clues'] if c['found'])} entries, past {bd['past']}, new {bd['fresh']}")
            ev("__bs.mystery.ledger()")
            page.wait_for_selector("#modal-card .my-switch", timeout=20000)
            if not ev("!!document.querySelector('#modal-card .my-switch .my-dot')"):
                fails.append("board: no dot on QUESTIONS before it was opened")
            page.click("#modal-card .my-switch button[data-v=q]")
            time.sleep(0.4)
            nq = ev("document.querySelectorAll('#modal-card .my-q').length")
            nc = ev("document.querySelectorAll('#modal-card .my-c[data-qs]').length")
            npast = ev("document.querySelectorAll('#modal-card .my-c.past').length")
            log(f"  drawn: {nq} questions, {nc} entries, {npast} walked past")
            if (nq, nc, npast) != (5, 11, 4):
                fails.append(f"board at L11: {nq} questions, {nc} entries, {npast} walked past (want 5, 11, 4)")
            page.hover("#modal-card .my-q")
            time.sleep(0.2)
            if not ev("!!document.querySelector('#modal-card .my-threads path')"):
                fails.append("board: no threads drawn on hover")
            if ev("__bs.mystery.board().fresh") != 0:
                fails.append("board: still new after opening")
            page.keyboard.press("Escape")
        except Exception as e:
            fails.append(f"board: {str(e)[:200]}")
        if errors:
            fails.append(f"board: page errors {errors[:2]}")

        # ---- the closing beats ----
        for n in [int(x) for x in a.hooks.split(",") if x != ""]:
            try:
                jump(f"L{n}.hook")
                page.wait_for_function("__bs.state === 'game'", timeout=240000)
                # software GL runs few frames a second: step the clock until the beat begins (it waits 1.5 s of play)
                for _ in range(120):
                    if ev("__bs.mystery.playing"):
                        break
                    ev("__bs.step(0.25)")
                    time.sleep(0.2)
                if not ev("__bs.mystery.playing"):
                    raise RuntimeError(f"did not start: {ev('__bs.mystery.why')} mode={ev('__bs.mode')}")
                t0 = time.time()
                if not ev(f"!!__bs.save.flags['hook-{n}']"):
                    fails.append(f"hook {n}: not marked played when it started")
                time.sleep(3.0)
                for _ in range(40):
                    if not ev("__bs.mystery.playing") and ev("__bs.mode") == "play":
                        break
                    ev("__bs.skip()"); ev("__bs.step(0.2)"); time.sleep(0.3)
                page.wait_for_function("!__bs.mystery.playing && __bs.mode === 'play'", timeout=30000)
                log(f"hook {n}: played, back in play {time.time() - t0:.1f}s after it began")
                if ev("__bs.mystery.holding"):
                    fails.append(f"hook {n}: still holding the story after it played")
            except Exception as e:
                fails.append(f"hook {n}: {str(e)[:200]} state={ev('({s: __bs && __bs.state, m: __bs && __bs.mode})')}")
            if errors:
                fails.append(f"hook {n}: page errors {errors[:2]}")

        # ---- previously ----
        try:
            jump("L14.start", "&recap=always")
            page.wait_for_selector("#my-recap .my-rl.in", timeout=240000)
            n = ev("document.querySelectorAll('#my-recap .my-rl').length")
            if n != 3:
                fails.append(f"recap: {n} lines, not three")
            time.sleep(1.0)
            page.keyboard.press("Space")
            page.wait_for_function("!document.getElementById('my-recap')", timeout=10000)
            wait_play(60)
            log(f"recap: {n} lines, skipped, in play")
        except Exception as e:
            fails.append(f"recap: {str(e)[:200]}")
        if errors:
            fails.append(f"recap: page errors {errors[:2]}")
        b.close()
    httpd.shutdown()
    for f in fails:
        log("FAIL", f)
    log("mystery_smoke:", "ok" if not fails else f"{len(fails)} problems")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
