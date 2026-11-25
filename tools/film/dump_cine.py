#!/usr/bin/env python3
"""Plays the opening cinematic (the pull) on a held clock and writes every frame's scene to disk for Blender,
like dump.py does for the title sequence.

  ~/.venvs/bs-test/bin/python tools/film/dump_cine.py --out ~/bs-film/a4 --from 47.4 --to 50.8 --fps 24

--from/--to are cinematic seconds (the pull starts at 39.0). Needs a built dist/. Resumable. The frame numbers are
the cinematic time times fps, so a shot's frames can be matched back to the game's clock."""
import argparse, json, pathlib, sys, time
from playwright.sync_api import sync_playwright
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from smoke import launch, serve  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True); ap.add_argument('--from', dest='t0', type=float, required=True); ap.add_argument('--to', dest='t1', type=float, required=True)
ap.add_argument('--fps', type=float, default=24); ap.add_argument('--port', type=int, default=4188); ap.add_argument('--quality', default='ultra')
a = ap.parse_args()
out = pathlib.Path(a.out).expanduser(); (out / 'frames').mkdir(parents=True, exist_ok=True); (out / 'fresh').mkdir(exist_ok=True)
httpd = serve(a.port)
with sync_playwright() as pw:
    b = launch(pw)
    page = b.new_page(viewport={'width': 320, 'height': 180})
    page.on('pageerror', lambda e: print('pageerror', str(e)[:300], flush=True))
    page.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: false, showFps: false}))")
    page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?prologue=0&quality={a.quality}', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function("window.__bs && window.__bs.ready", timeout=300000)
    page.evaluate("document.getElementById('sf-ok') && document.getElementById('sf-ok').click(); document.getElementById('btn-new').click()")
    time.sleep(2)
    page.evaluate("document.querySelector('#nm-ok') && document.querySelector('#nm-ok').click()")
    page.wait_for_function("window.__bs.state === 'narrator'", timeout=120000); time.sleep(1)
    page.evaluate('__bs.skip()')
    page.wait_for_function("window.__bs.state === 'cinematic'", timeout=120000); time.sleep(1)
    page.evaluate((HERE / 'dump.js').read_text() + '\n;0')
    # land a second before the range and let the shot's own enter/update settle, then hold the clock
    page.evaluate(f'__bs.cineSeek({a.t0 - 1.0})'); time.sleep(0.5)
    page.evaluate('__bs.hold(true)')

    def step(dt):
        n = page.evaluate('__bs.frames')
        page.evaluate(f'__bs.advance({dt})')
        page.wait_for_function(f'__bs.frames > {n}', timeout=300000)

    for _ in range(24):  # the second before: at the film's rate, so eased things (gaze, face) arrive as they would
        step(1 / 24)
    total = int(round((a.t1 - a.t0) * a.fps)); known = {p.stem for p in (out / 'fresh').glob('*.json')}; t0 = time.time()
    for f in range(total):
        idx = int(round(a.t0 * a.fps)) + f
        step(1 / a.fps)
        d = page.evaluate('__filmDump()')
        d['cineT'] = a.t0 + f / a.fps
        for k, v in d.pop('fresh').items():
            if k not in known:
                (out / 'fresh' / f'{k}.json').write_text(json.dumps(v)); known.add(k)
        path = out / 'frames' / f'{idx:05d}.json'; tmp = path.with_suffix('.tmp'); tmp.write_text(json.dumps(d)); tmp.rename(path)
        if f % 12 == 0:
            print(f'{f}/{total} meshes {len(d["meshes"])} {time.time() - t0:.0f}s', flush=True)
    b.close()
httpd.shutdown()
print('done', flush=True)
