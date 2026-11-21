#!/usr/bin/env python3
"""Traffic and people in Zenvora: over a simulated minute at several places (the old town's street and gate, downtown,
the market, a midtown row), no car ever overlaps a person (walker, crowd card, body or townsperson), and no district
walker stands on the road outside a crossing. Runs on the stepped clock (__bs.step), so it is the same on any machine.
  python tools/traffic_smoke.py [--quality web] [--port 4386]"""
import argparse, functools, http.server, json, pathlib, sys, threading, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pw_pin  # noqa: E402,F401
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--dist', default=str(pathlib.Path(__file__).resolve().parent.parent / 'dist'))
ap.add_argument('--quality', default='web'); ap.add_argument('--port', type=int, default=4386); ap.add_argument('--secs', type=float, default=60)
a = ap.parse_args()
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), functools.partial(H, directory=a.dist))
threading.Thread(target=srv.serve_forever, daemon=True).start()
SPOTS = {'bazaar': (6.0, 30.0, 3.14), 'gate': (0.0, -55.0, 3.14), 'downtown': (175.0, 70.0, -1.5708), 'market': (-96.0, 40.0, 3.14), 'row': (130.0, -10.0, 1.5708)}
# a car is 4.7 m by 1.9 m; a person a 0.25 m circle
CHECK = """(secs) => { const hits = [], road = []; let n = 0;
  for (let t = 0; t < secs; t += 0.1) {
    __bs.step(0.1); const s = __bs.awayTraffic(); if (!s) break; n++;
    for (const [cx, cz, yaw] of s.cars) { const c = Math.cos(yaw), si = Math.sin(yaw);
      for (const p of s.peds) { const dx = p[0] - cx, dz = p[1] - cz; if (dx * dx + dz * dz > 16) continue;
        const lx = dx * c - dz * si, lz = dx * si + dz * c;
        if (Math.abs(lx) < 1.2 && Math.abs(lz) < 2.6) hits.push([+t.toFixed(1), +cx.toFixed(1), +cz.toFixed(1), +p[0].toFixed(1), +p[1].toFixed(1)]); } }
    for (const p of s.peds) if (p[3] === 1 && p.length === 4 && p[2] === 0) road.push([+t.toFixed(1), +p[0].toFixed(1), +p[1].toFixed(1)]);
  }
  return { steps: n, hits: hits.slice(0, 8), nhits: hits.length, road: road.slice(0, 8), nroad: road.length }; }"""
fails = []
with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = b.new_page(viewport={'width': 960, 'height': 540})
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)[:200]))
    page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={a.quality}&tod=17.5')
    page.wait_for_function("window.__bs && __bs.state === 'title' && __bs.ready", timeout=600000)
    page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=30000); page.click('#nm-ok')
    for i in range(300):
        if page.evaluate("__bs.mode === 'away' && !!(__bs.away && __bs.away.who)"): break
        if page.evaluate('__bs.state') == 'narrator': page.evaluate('__bs.skip()')
        time.sleep(1)
    time.sleep(10)
    for name, (x, z, yaw) in SPOTS.items():
        page.evaluate(f"__bs.awayTeleport({x}, {z}, {yaw})"); page.evaluate('__bs.step(1)')
        r = page.evaluate(CHECK, a.secs)
        print(name, r, flush=True)
        if not r['steps']: fails.append(f'{name}: no traffic state')
        if r['nhits']: fails.append(f"{name}: a car overlapped a person {r['nhits']} times, first {r['hits'][:2]}")
        if r['nroad']: fails.append(f"{name}: a walker stood on the road outside a crossing {r['nroad']} times, first {r['road'][:2]}")
    if errs: fails.append(f'errors {errs[:3]}')
    b.close()
print(json.dumps({'fails': fails}, indent=1))
sys.exit(1 if fails else 0)
