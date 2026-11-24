#!/usr/bin/env python3
"""Words on 3D surfaces read the right way round: in Zenvora (every street, the avenue districts, the towers) and on
the planet, every mesh whose texture holds words (shop signs, hanging signs, neon, billboards, banners, boards) is
checked triangle by triangle in world space (src/core/textfaces.ts): not mirrored, not upside down on an upright
surface, and not a two-sided material (that shows the words mirrored from behind). The audit first proves itself on
probe signs (one good, one mirrored, one upside down, one two-sided, one two-faced). Phones and the web preset build
the city differently (halved canvases, fewer signs), so both are checked.
  python tools/sign_faces.py [--quality mobile,web]"""
import argparse, json, pathlib, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pw_pin  # noqa: E402,F401  (re-runs under the pinned Playwright)
from playwright.sync_api import sync_playwright  # noqa: E402
from smoke import launch, serve  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--quality', default='mobile,web'); ap.add_argument('--port', type=int, default=4391); ap.add_argument('--out', default='')
a = ap.parse_args()
WANT_PROBE = ['both two-sided', 'mirror mirrored', 'upside upside down']
fails, report = [], {}
httpd = serve(a.port)
with sync_playwright() as pw:
    b = launch(pw)
    for q in a.quality.split(','):
        page = b.new_page(viewport={'width': 844, 'height': 390} if q == 'mobile' else {'width': 960, 'height': 540})
        page.on('pageerror', lambda e: fails.append(f'{q} pageerror: {str(e)[:200]}'))
        page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
        page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={q}', wait_until='domcontentloaded', timeout=180000)
        page.wait_for_function("window.__bs && __bs.state === 'title' && __bs.ready", timeout=600000)
        probe = page.evaluate('__bs.textFacesProbe()')
        print(q, 'probe:', probe, flush=True)
        if probe != WANT_PROBE: fails.append(f'{q} probe: the audit found {probe}, expected {WANT_PROBE}')
        planet = page.evaluate('__bs.textFaces()')
        page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=30000); page.click('#nm-ok')
        for i in range(300):
            if page.evaluate("__bs.mode === 'away' && !!(__bs.away && __bs.away.who)"): break
            if page.evaluate('__bs.state') == 'narrator': page.evaluate('__bs.skip()')
            time.sleep(1)
        time.sleep(4)
        city = page.evaluate('__bs.textFaces()')
        for where, r in (('planet', planet), ('zenvora', city)):
            print(f"{q} {where}: {r['checked']} triangles with words checked, {len(r['issues'])} issues", flush=True)
            for i in r['issues'][:30]: print('   ', i['why'], i['name'], i['at'], i['tris'], flush=True)
            for i in r['issues']: fails.append(f"{q} {where}: {i['why']} {i['name']} at {i['at']}")
        if city['checked'] < 50: fails.append(f'{q}: only {city["checked"]} sign triangles found in Zenvora (the audit lost the signs?)')
        report[q] = {'probe': probe, 'planet': planet, 'zenvora': city}
        page.close()
    b.close()
httpd.shutdown()
if a.out: pathlib.Path(a.out).write_text(json.dumps(report, indent=1))
print('FAIL' if fails else 'OK', len(fails), flush=True)
for f in fails[:40]: print('  ', f)
sys.exit(1 if fails else 0)
