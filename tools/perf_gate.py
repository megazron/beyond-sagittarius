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
ap.add_argument('--query', default='', help='extra URL query (e.g. berth=1.7), for bisecting'); ap.add_argument('--spots', default='', help='only these spots, comma separated')
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
# Bodies (2026-11-23, perf agent 26, the owner's pedestrian glitches): nobody in view within 27 m changes between a body
# and a card any more, so whoever walks into the view must already be a body: the caps went up (city.ts BODY_CAP 11 /
# 20 / 24, the painted crowd halved) and the budget with them, the player and the frozen few over the cap included.
# Mobile draws 120 -> 145 with them: the crowd spot drew 139 on CI with the new caps (each body is 2-3 draws). A cost of
# the owner's priority (no pedestrian popping); what it does on a real phone is not measured.
# Web triangles 1.3 M -> 1.45 M (2026-11-24, perf agent 30): the gate spot drew 1 397 602 on ped29/ped30 with FEWER
# people (24 bodies vs main's 25, 36 painted cards vs 64), 1 137 612 on main. Per body (p30/who.py, main 26f8579 vs
# dist-p29i): the difference is the build, not the head count. A body takes its build from where it was last drawn
# (character.ts pickLod: camD is set only when it is drawn) and keeps it in view within SWAP_FAR; on Web the crowd's
# near build is meant out to 32 m (city.ts crowdLodFar, dfd45fe). On main the six of the gate's threes were last drawn
# at the start, 120 m off, and showed at 7 to 10 m in their far build (18 to 25 k triangles, hair 2 to 5 k); on this
# branch the threes are gone (fewer near the routes) and the bodies there are pooled ones never drawn before, in the
# near build (40 to 50 k, hair 16 to 22 k) the design gives anyone within 27 m. Walked up to, main's would be the near
# build too. So the budget follows the near build at the gate, about 4 % over this count; not a licence for more people.
# Mobile bodies 14 -> 16 (2026-11-24, perf agent 30): the story's people past 34 m are drawn outside the cap by design
# (city.ts: blinking them out was someone vanishing down the street). At the phone gate four of them (50-83 m) are in
# view: main drew 13 (8 near + 4 far + you), ped29 15 (10 near, the cap 11 holds). Counting them against the phone
# total instead made them blink out and back 46-82 m off as the near bodies came and went (detector p30/ped_e1_mobile:
# 9 vanishFar, 9 appearFar), so the budget counts them: cap 11 + you + 4 far, the two at your elbow aside.
BUDGET = {'mobile': (145, 760_000, 16), 'web': (580, 1_450_000, 34), 'ultra': (1420, 4_200_000, 36)}

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
# after a teleport: at least `n` drawn frames, then until the triangles drawn per frame stop climbing (the highest of
# each 10 frames within 2% of the one before, twice running), at most `ms` (the CI runner draws 1 to 3 frames a second:
# 120 frames and 60-frame windows never settled there and the job ran past its 30 minutes). A fixed 4 s of wall clock under SwiftShader
# measured "mobile flat" anywhere from 550k to 739k triangles on the same code: how many batches had streamed in by then
# depended on how fast the runner was
SETTLE = """([n, ms]) => new Promise((res) => { let k = 0, hi = 0, prev = -1, calm = 0; const t0 = performance.now();
  const f = () => { k++; hi = Math.max(hi, __bs.perf.tris || 0);
    if (k >= n && k % 10 === 0) { if (prev >= 0 && hi <= prev * 1.02) calm++; else calm = 0; prev = hi; hi = 0; }
    if (calm >= 2 || performance.now() - t0 > ms) res({ frames: k, secs: +((performance.now() - t0) / 1000).toFixed(1), settled: calm >= 2 }); else requestAnimationFrame(f); };
  requestAnimationFrame(f); })"""
fails, report = [], {}
with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'])
    for q in a.quality.split(','):
        page = b.new_page(viewport={'width': 844, 'height': 390} if q == 'mobile' else {'width': 960, 'height': 540})
        errs = []; page.on('pageerror', lambda e: errs.append(str(e)[:200]))
        # a shader that does not compile draws nothing and throws nothing (main 3b1eef8: the facade buildings were gone
        # for an hour, every gate green): ?shadercheck=1 makes three log it, and that fails this gate
        page.on('console', lambda m: errs.append('shader: ' + m.text[:300]) if m.type == 'error' and ('Shader Error' in m.text or 'ERROR: 0:' in m.text) else None)
        page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
        page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={q}&tod=17.5&shadercheck=1' + (f'&{a.query}' if a.query else ''))
        page.wait_for_function("window.__bs && __bs.state === 'title' && __bs.ready", timeout=600000)
        page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=30000); page.click('#nm-ok')
        for i in range(300):
            if page.evaluate("__bs.mode === 'away' && !!(__bs.away && __bs.away.who)"): break
            if page.evaluate('__bs.state') == 'narrator': page.evaluate('__bs.skip()')
            time.sleep(1)
        time.sleep(25)  # every model and its light build in
        D, T, B = BUDGET[q]; rows = {}
        for name, (x, z, yaw) in SPOTS.items():
            if a.spots and name not in a.spots.split(','): continue
            page.evaluate(f"__bs.awayTeleport({x}, {z}, {yaw})"); st = page.evaluate(SETTLE, [20, 15000])
            print(q, name, 'settled', st, flush=True)
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
