#!/usr/bin/env python3
"""A long journey through Zenvora, and leaving and coming back, must not pile up. The owner: "The game lags and crashes
the farther you go from the spawn point." Checks, on software GL (counts and the main thread's own milliseconds only):
  1. the GPS route search from the far corners of the districts back to the flat is quick (it was 0.2 to 0.7 s on a
     laptop, four times a second, out there);
  2. after the old town, downtown, the north, the park, the bay and the market twice over and back to the flat, the
     renderer's geometries and textures and the JS heap (after a GC) are back near where they started;
  3. leaving the city and coming back, twice, holds the same: a visit no longer leaves the last one behind;
  4. a lost WebGL context is survived: the game pauses, and draws again once the context is back.
  python tools/soak_smoke.py [--quality web] [--port 4387]"""
import argparse, functools, http.server, json, math, pathlib, sys, threading, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pw_pin  # noqa: E402,F401
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--dist', default=str(pathlib.Path(__file__).resolve().parent.parent / 'dist'))
ap.add_argument('--quality', default='web'); ap.add_argument('--port', type=int, default=4387)
ap.add_argument('--route-ms', type=float, default=150, help='most one route search may take (the old router: 600+ on CI)')
a = ap.parse_args()
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), functools.partial(H, directory=a.dist))
threading.Thread(target=srv.serve_forever, daemon=True).start()

HOME = (12.4, 68.4)
ROUTE = [HOME, (0, 20), (0, -60), (60, 30), (175, 70), (330, 300), (10, 200), (0, 310), (-150, 250), (-270, 60), (-290, -90), (-96, 40), HOME]
FAR = [(290.0, 260.0), (-290.0, -90.0), (330.0, 300.0)]
MEM = "(()=>{window.gc&&window.gc();const m=performance.memory||{};const g=__bs.gpuMem;return {geo:g.geometries,tex:g.textures,progs:g.programs,heap:Math.round((m.usedJSHeapSize||0)/1e6)}})()"
fails = []

def walk(page, pts, step=30):
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(x1 - x0, z1 - z0) / step))
        for k in range(1, n + 1):
            x, z = x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n
            page.evaluate(f"__bs.awayTeleport({x:.1f}, {z:.1f}, {math.atan2(-(x1 - x0), -(z1 - z0)):.2f})")
            time.sleep(0.35)

def settle(page, sec=8):
    time.sleep(sec); return page.evaluate(MEM)

def near(name, now, ref, k_geo=1.08, k_heap=1.25):
    msg = f"{name}: {now} vs {ref}"
    print(msg, flush=True)
    if now['geo'] > ref['geo'] * k_geo + 15: fails.append(f'{name}: geometries {ref["geo"]} -> {now["geo"]}')
    if now['tex'] > ref['tex'] * k_geo + 10: fails.append(f'{name}: textures {ref["tex"]} -> {now["tex"]}')
    if ref['heap'] and now['heap'] > ref['heap'] * k_heap + 40: fails.append(f'{name}: JS heap {ref["heap"]} -> {now["heap"]} MB')

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc', '--enable-precise-memory-info'])
    page = b.new_page(viewport={'width': 960, 'height': 540})
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)[:200]))
    page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={a.quality}')
    page.wait_for_function("window.__bs && __bs.state === 'title' && __bs.ready", timeout=600000)
    page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=30000); page.click('#nm-ok')
    for i in range(300):
        if page.evaluate("__bs.mode === 'away' && !!(__bs.away && __bs.away.who)"): break
        if page.evaluate('__bs.state') == 'narrator': page.evaluate('__bs.skip()')
        time.sleep(1)
    who = page.evaluate('__bs.away.who')
    # first a lap that loads whatever loads on first sight, then the reference: what is left after it, at the flat
    walk(page, ROUTE)
    page.evaluate(f"__bs.awayTeleport({HOME[0]}, {HOME[1]}, 3.14)")
    ref = settle(page)
    print('reference after one lap', ref, flush=True)
    # 1. the route search from far out, each time to a fresh target (no cached route)
    for i, (x, z) in enumerate(FAR):
        page.evaluate(f"__bs.awayTeleport({x}, {z}, 0)"); time.sleep(1)
        r = page.evaluate(f"__bs.awayRoute({x}, {z}, {HOME[0] + 0.7 * (i + 1)}, {HOME[1]})")
        print('route from', (x, z), r, flush=True)
        if r and r['ms'] > a.route_ms: fails.append(f'route search from {(x, z)} took {r["ms"]:.0f} ms (at most {a.route_ms})')
    # 1b. bump into the painted crowd's walkers: whoever walks as a body stays that same body (the owner: "the pedestrians
    # suddenly change when touched or bumped into"; in the lens the body was let go and the card drawn instead)
    page.evaluate("__bs.awayTeleport(-5.5, 0, 0)")
    for i in range(60):  # the crowd's bodies load on first sight
        time.sleep(1); held = page.evaluate("__bs.awayCrowd().held") or []
        if len(held) >= 2: break
    print('crowd bodies near the street', held, flush=True)
    if not held: fails.append('bump test: no crowd walker was a body near (-5.5, 0)')
    for card, body, look, d, x, z in held[:4]:
        # walk into them: from 3 m to the side, 0.4 m a step (a teleport onto them would jump the camera as well)
        hit = None
        for k in range(14):
            now = {h[0]: h for h in (page.evaluate("__bs.awayCrowd().held") or [])}
            h = now.get(card)
            if h is None or h[1] != body or h[2] != look: hit = (k, h); break
            px, pz = h[4] + max(0.0, 3.0 - 0.4 * k), h[5]
            page.evaluate(f"__bs.awayTeleport({px:.2f}, {pz:.2f}, 1.5708)"); page.evaluate('__bs.step(0.1)')
        if hit: fails.append(f'bump test: the walker of card {card} (body {body}, look {look}) became {hit[1]} at step {hit[0]} of walking into them')
    print('bump test done', flush=True)
    # 1c. time, not distance (the owner: "the longer we play the game, the laggier it gets"): six minutes in the bazaar,
    # moving between two spots, sampled every 30 s. The game's own update time (main thread, measurable even on software
    # GL), the heap after a GC and what the renderer holds must stay flat
    TS = "(()=>{window.gc&&window.gc();const m=performance.memory||{};const g=__bs.gpuMem;return {tick:+__bs.perf.tick.toFixed(2),geo:g.geometries,tex:g.textures,progs:g.programs,heap:Math.round((m.usedJSHeapSize||0)/1e6)}})()"
    samples = []
    for k in range(12):
        page.evaluate(f"__bs.awayTeleport(6.0, {50.0 if k % 2 == 0 else 42.0}, {3.14 if k % 2 == 0 else 0})")
        time.sleep(30); samples.append(page.evaluate(TS)); print('time', (k + 1) * 30, 's', samples[-1], flush=True)
    first, last = samples[1:3], samples[-2:]
    avg = lambda rows, k: sum(r[k] for r in rows) / len(rows)
    if avg(last, 'tick') > avg(first, 'tick') * 1.5 + 3: fails.append(f"over time: update {avg(first, 'tick'):.1f} -> {avg(last, 'tick'):.1f} ms")
    for k, f, c in (('geo', 1.05, 10), ('tex', 1.05, 8), ('progs', 1.05, 6), ('heap', 1.2, 40)):
        if avg(last, k) > avg(first, k) * f + c: fails.append(f'over time: {k} {avg(first, k):.0f} -> {avg(last, k):.0f}')
    # 2. two more laps, back to the flat
    walk(page, ROUTE); walk(page, ROUTE)
    page.evaluate(f"__bs.awayTeleport({HOME[0]}, {HOME[1]}, 3.14)")
    near('after two more laps', settle(page), ref)
    # 3. leave and come back, twice: the second visit must not hold more than the first
    visits = []
    for v in range(3):
        page.evaluate("__bs.awayLeave()"); time.sleep(4)
        page.evaluate(f"__bs.goAway('{who}', 'city')")
        ok = False
        for i in range(240):
            if page.evaluate("__bs.mode === 'away' && !!(__bs.away && __bs.away.who)"): ok = True; break
            if page.evaluate('__bs.state') == 'narrator': page.evaluate('__bs.skip()')
            time.sleep(1)
        if not ok: fails.append(f'visit {v + 2}: the city did not come back'); break
        page.evaluate(f"__bs.awayTeleport({HOME[0]}, {HOME[1]}, 3.14)")
        visits.append(settle(page, 12)); print('visit', v + 2, visits[-1], flush=True)
    if len(visits) == 3: near('third visit vs second', visits[2], visits[1], 1.05, 1.15)
    # 4. a lost context: paused, then drawing again
    f0 = page.evaluate("(window.__ext=__bs.gl.getContext().getExtension('WEBGL_lose_context'), __bs.debug.frames)")
    if page.evaluate('!!window.__ext'):
        page.evaluate('__ext.loseContext()'); time.sleep(2)
        page.evaluate('__ext.restoreContext()')
        # three.js uploads everything again and every shader compiles again: on software GL that is a long wait
        t0 = time.time(); r0 = None; drawn = False
        while time.time() - t0 < 150:
            time.sleep(3)
            if page.evaluate('__bs.gl.getContext().isContextLost()'): continue
            r = page.evaluate('__bs.gl.info.render.frame')
            if r0 is not None and r > r0: drawn = True; break
            r0 = r
        print('context lost and restored: drawing again', drawn, f'after {time.time() - t0:.0f} s', flush=True)
        if not drawn: fails.append('the game did not draw again within 150 s after the WebGL context came back')
    if errs: fails.append(f'errors {errs[:3]}')
    b.close()
print(json.dumps({'fails': fails}, indent=1))
sys.exit(1 if fails else 0)
