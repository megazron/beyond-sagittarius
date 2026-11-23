#!/usr/bin/env python3
"""Perf gate for Zenvora: software GL cannot measure frame rate, but it can count. At set spots on each preset this
checks the draw calls, triangles and real bodies of a frame against budgets (set from the frame-time targets: Mobile 30
fps on a mid-range phone, Web 60 and Ultra 30 on a laptop GPU, measured with tools/gpu_tour.py), so a change that
doubles the draw calls fails here instead of on a phone. Counts are the worst frame of a second at each spot.
  python tools/perf_gate.py [--quality mobile,web,ultra] [--dist DIR] [--out report.json]"""
import argparse, functools, http.server, json, pathlib, sys, threading, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pw_pin  # noqa: E402,F401
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--dist', default=str(pathlib.Path(__file__).resolve().parent.parent / 'dist'))
ap.add_argument('--quality', default='mobile,web,ultra'); ap.add_argument('--port', type=int, default=4387); ap.add_argument('--out', default='')
a = ap.parse_args()

# x, z, yaw
SPOTS = {'flat': (12.4, 68.4, 3.14), 'bazaar': (6.0, 50.0, 3.14), 'crowd': (-5.5, 0.0, 0.0), 'gate': (0.0, -60.0, 3.14),
         'square': (60.0, 30.0, -1.5708), 'downtown': (175.0, 70.0, -1.5708), 'market': (-96.0, 40.0, 3.14), 'waterfront': (-270.0, 60.0, 3.14), 'park': (10.0, 200.0, 3.14)}
# draws, triangles, bodies (the player aside is included in bodies: cap + 1)
# The budgets are set from this test's own counts under software GL (1.2: phones 44 to 94 draws and up to 0.58 M
# triangles, Web 130 to 470 and 1.03 M, Ultra 135 to 1,180 and 3.45 M: there every body near the gate is drawn in the
# shadow pass too), with about a fifth of headroom over the worst spot, so honest growth passes and a doubling does not.
# Web's bodies (2026-11-23): 10 in the crowd on main bd16cf8 (the story's people, never a card and drawn out to 48 m, use
# more than the cap of five, and the walkers held near you and the two within reach are bodies over it since a3f6225 and
# 0905d5e, so nobody you walk into is a card). A ceiling that took those back made a walker at 2.5 m a card again
# (crowd_smoke, soak_smoke's bump test failed on perf23-land 9b83112), so the budget is set over the design instead:
# 12, a fifth over the 10. The crowd spot's draws (240 to 255) and triangles (0.72 to 0.81 M) stay far under theirs.
BUDGET = {'mobile': (120, 720_000, 4), 'web': (580, 1_300_000, 12), 'ultra': (1420, 4_200_000, 16)}

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), functools.partial(H, directory=a.dist))
threading.Thread(target=srv.serve_forever, daemon=True).start()
# the worst frame of the second, and what drew its triangles (object paths, main pass M or shadow S), for a failure's log
WORST = """(ms) => new Promise((res) => { let calls = 0, tris = 0, bodies = 0, sk = 0, t0 = performance.now(); const r = __bs.gl, orig = r.renderBufferDirect; let cur = {}, top = null;
  const name = (obj) => { const parts = []; for (let o = obj; o && parts.length < 4; o = o.parent) { let n = o.name || ''; if (o.userData && o.userData.isCharacter) n = 'BODY'; if (n) parts.push(n); }
    return (parts.reverse().join('/') || obj.type) + (obj.isBatchedMesh ? ' [batch]' : obj.isInstancedMesh ? ' [inst ' + obj.count + ']' : obj.isSkinnedMesh ? ' [skin]' : ''); };
  r.renderBufferDirect = function (cam, sc, g, m, obj, grp) { const a = r.info.render.triangles; const v = orig.apply(this, arguments);
    const k = (cam.isOrthographicCamera ? 'S ' : 'M ') + name(obj) + ' |' + (m.name || m.type); cur[k] = (cur[k] || 0) + r.info.render.triangles - a; return v; };
  const f = () => { const p = __bs.perf; calls = Math.max(calls, p.calls); bodies = Math.max(bodies, p.bodies); sk = Math.max(sk, p.skinned);
    if (p.tris > tris) { tris = p.tris; top = cur; } cur = {};
    if (performance.now() - t0 < ms) requestAnimationFrame(f); else { r.renderBufferDirect = orig;
      res({ calls, tris, bodies, skinned: sk, top: Object.entries(top || {}).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => k + ' ' + Math.round(v)) }); } };
  requestAnimationFrame(f); })"""
fails, report = [], {}
with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'])
    for q in a.quality.split(','):
        page = b.new_page(viewport={'width': 844, 'height': 390} if q == 'mobile' else {'width': 960, 'height': 540})
        errs = []; page.on('pageerror', lambda e: errs.append(str(e)[:200]))
        page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
        page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={q}&tod=17.5')
        page.wait_for_function("window.__bs && __bs.state === 'title' && __bs.ready", timeout=600000)
        page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=30000); page.click('#nm-ok')
        for i in range(300):
            if page.evaluate("__bs.mode === 'away' && !!(__bs.away && __bs.away.who)"): break
            if page.evaluate('__bs.state') == 'narrator': page.evaluate('__bs.skip()')
            time.sleep(1)
        time.sleep(25)  # every model and its light build in
        D, T, B = BUDGET[q]; rows = {}
        for name, (x, z, yaw) in SPOTS.items():
            page.evaluate(f"__bs.awayTeleport({x}, {z}, {yaw})"); time.sleep(4)
            r = page.evaluate(WORST, 1500); top = r.pop('top'); rows[name] = r
            print(q, name, r, flush=True)
            if r['calls'] > D: fails.append(f"{q} {name}: {r['calls']} draw calls (budget {D})")
            if r['tris'] > T:
                fails.append(f"{q} {name}: {r['tris']} triangles (budget {T})")
                print('  worst frame by triangles:\n   ' + '\n   '.join(top), flush=True)
            if r['bodies'] > B: fails.append(f"{q} {name}: {r['bodies']} bodies drawn (budget {B})")
            if r['calls'] < 10: fails.append(f"{q} {name}: nothing drawn")
        if errs: fails.append(f"{q}: errors {errs[:3]}")
        report[q] = rows
        page.close()
    b.close()
if a.out: pathlib.Path(a.out).write_text(json.dumps(report, indent=1))
print(json.dumps({'fails': fails}, indent=1))
sys.exit(1 if fails else 0)
