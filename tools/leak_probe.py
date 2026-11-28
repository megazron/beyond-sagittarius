"""Geometry leak probe: one long session on the planet from a cheat checkpoint, played on by tools/cheat_play.py, with
the renderer's geometry count and the census of geometries drawn and since dropped from every scene without dispose()
(?geocensus=1, src/core/geocensus.ts) taken every few dozen driver rounds. The groups that only grow are the leak.

Usage: python tools/leak_probe.py [--from L14.start] [--levels 3] [--chunks 12] [--rounds 60] [--json OUT]
"""
import argparse, json, pathlib, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import smoke  # noqa: E402
from cheat_play import drive  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4767)
    ap.add_argument("--dist", default="")
    ap.add_argument("--from", dest="start", default="L14.start")
    ap.add_argument("--levels", type=int, default=3)
    ap.add_argument("--chunks", type=int, default=12)
    ap.add_argument("--rounds", type=int, default=60)
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    if a.dist: smoke.DIST = pathlib.Path(a.dist).resolve()
    httpd = smoke.serve(a.port)
    L = int(a.start[1:].split(".")[0])
    out = []
    with sync_playwright() as pw:
        b = smoke.launch(pw); ctx = b.new_context(viewport={"width": 640, "height": 360}); page = ctx.new_page()
        ctx.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
        page.goto(f"http://127.0.0.1:{a.port}/index.html?prologue=0&quality=web&geocensus=1&cheat={a.start}&cgo=1&cpick=a", wait_until="domcontentloaded", timeout=180000)
        page.wait_for_function("window.__bs && window.__bs.ready && __bs.state === 'game'", timeout=300000)
        ev = page.evaluate
        t0 = time.time()
        for c in range(a.chunks + 1):
            g = ev("__bs.geoCensus()"); st = ev("({level: __bs.level, mode: __bs.mode})")
            row = {"chunk": c, "secs": round(time.time() - t0), **st, "gpu": g["gpu"], "alive": g["alive"], "inScene": g["inScene"], "lost": g["lost"], "top": g["top"][:15]}
            out.append(row)
            print(f"[{row['secs']:5d}s] L{st['level']} {st['mode']}: gpu {g['gpu']}, alive {g['alive']}, in scenes {g['inScene']}, dropped {g['lost']}", flush=True)
            for lab, n in g["top"][:8]: print(f"     {n:5d}  {lab}", flush=True)
            if c == a.chunks: break
            why = drive(page, ev, lambda *x: None, lambda st: (st["level"] or 0) > L + a.levels, rounds=a.rounds)
            if why == "stop": print("reached the last level", flush=True)
        b.close()
    httpd.shutdown()
    if a.json: pathlib.Path(a.json).write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
