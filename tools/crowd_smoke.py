#!/usr/bin/env python3
"""Townsfolk stay drawn when you walk up to them: in Zenvora, on each preset, the player stands 2.5, 5, 10, 18 and 28 m
from people standing in the street (facing them, the game's own follow camera) and the test counts the draw calls of
each person's body (their skin and clothes, not props that are always drawn). Every one of them within 30 m must be drawn.
  python tools/crowd_smoke.py [--quality mobile,web,ultra] [--people 8] [--dist DIR]"""
import argparse, functools, http.server, json, math, pathlib, sys, threading, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pw_pin  # noqa: E402,F401  (re-runs under the pinned Playwright)
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--dist', default=str(pathlib.Path(__file__).resolve().parent.parent / 'dist'))
ap.add_argument('--quality', default='mobile,web'); ap.add_argument('--port', type=int, default=4381)
ap.add_argument('--people', type=int, default=8); ap.add_argument('--out', default='')
a = ap.parse_args()

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), functools.partial(H, directory=a.dist))
threading.Thread(target=srv.serve_forever, daemon=True).start()

# draws per person over two frames: every draw call whose object hangs under that person's root
COUNT = """(ids) => new Promise((res) => { const r = __bs.gl, orig = r.renderBufferDirect, roots = new Map(), n = {};
  for (const p of __bs.awayPeople()) if (ids.includes(p.id)) roots.set(p.root, p.id);
  r.renderBufferDirect = function (cam, sc, g, m, obj) { if (!cam.isOrthographicCamera && (obj.name === 'cloth' || obj.name === 'skin_body')) for (let o = obj; o; o = o.parent) { const id = roots.get(o); if (id) { n[id] = (n[id] || 0) + 1; break; } } return orig.apply(this, arguments); };
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => { r.renderBufferDirect = orig; res(n); }))); })"""
fails, report = [], {}
with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'])
    for q in a.quality.split(','):
        page = b.new_page(viewport={'width': 844, 'height': 390} if q == 'mobile' else {'width': 960, 'height': 540})
        errs = []; page.on('pageerror', lambda e: errs.append(str(e)[:200]))
        page.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' else None)
        page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
        page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={q}')
        page.wait_for_function("window.__bs && __bs.state === 'title' && __bs.ready", timeout=600000)
        page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=30000); page.click('#nm-ok')
        for i in range(300):
            if page.evaluate("__bs.mode === 'away' && !!(__bs.away && __bs.away.who)"): break
            if page.evaluate('__bs.state') == 'narrator': page.evaluate('__bs.skip()')
            time.sleep(1)
        time.sleep(6)
        everyone = page.evaluate("__bs.awayPeople().map((p) => ({ id: p.id, walk: p.walk, x: p.pos.x, z: p.pos.z }))")
        people = [p for p in everyone if not p['walk']][:a.people] + [p for p in everyone if p['walk']][:3]
        res = {}
        for p in people:
            row = {}
            for d in (2.5, 5, 10, 18, 28):
                if p['walk']: p.update(page.evaluate(f"(() => {{ const q = __bs.awayPeople().find((x) => x.id === '{p['id']}'); return {{ x: q.pos.x, z: q.pos.z }}; }})()"))
                # stand d metres up the street from them (towards the middle of the road), facing them
                sx = p['x'] * 0.4; dz = math.sqrt(max(0.1, d * d - (p['x'] - sx) ** 2))
                best = 0
                for sgn in (1, -1):
                    px, pz = sx, p['z'] + sgn * dz
                    yaw = math.atan2(p['x'] - px, p['z'] - pz)
                    for y in (yaw, yaw + math.pi):
                        page.evaluate(f"__bs.awayTeleport({px}, {pz}, {y})"); time.sleep(1.2)
                        best = max(best, page.evaluate(COUNT, [p['id']]).get(p['id'], 0))
                        if best: break
                    if best: break
                row[d] = best
                if not best:
                    fails.append(f"{q}: {p['id']} not drawn at {d} m")
                    if a.out: page.screenshot(path=f"{a.out}_{q}_{p['id']}_{d}.jpg", type='jpeg', quality=70, timeout=240000)
            res[p['id']] = row
            print(q, p['id'], row, flush=True)
        # the painted crowd: down among it, every card within 14 m is either still drawn or walked by a visible body
        page.evaluate("__bs.awayTeleport(-5.5, 0, 0)"); time.sleep(2)
        c = page.evaluate("__bs.awayCrowd()")
        print(q, 'crowd near the camera', c, flush=True)
        if c['near'] and c['bodies'] == 0: fails.append(f"{q}: no real body walks the painted crowd near the camera")
        if c['lost']: fails.append(f"{q}: {c['lost']} crowd cards hidden with no body")
        # the districts beyond the old town: downtown and the market, among the walkers
        for (x, z, y) in ((175, 70, -1.5708), (-96, 40, 3.14), (130, -10, 0)):
            page.evaluate(f"__bs.awayTeleport({x}, {z}, {y})"); time.sleep(2.5)
            d = page.evaluate("__bs.awayCrowd()")
            print(q, 'district', (x, z), {k: d.get(k) for k in ('dnear', 'dbodies', 'dlost')}, flush=True)
            if d.get('dlost'): fails.append(f"{q}: {d['dlost']} district walkers within 30 m drawn as nothing at {(x, z)}")
            if d.get('dnear') and not d.get('dbodies'): fails.append(f"{q}: no district walker drawn as a body at {(x, z)}")
        if errs: fails.append(f"{q}: errors {errs[:3]}")
        report[q] = {'people': res, 'crowd': c, 'errors': errs[:5]}
        page.close()
    b.close()
if a.out: pathlib.Path(a.out).write_text(json.dumps(report, indent=1))
print(json.dumps({'fails': fails}, indent=1))
sys.exit(1 if fails else 0)
