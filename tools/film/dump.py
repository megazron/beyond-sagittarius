#!/usr/bin/env python3
"""Plays the title sequence on a held clock and writes every frame's scene to disk for Blender.

  python tools/film/dump.py --out ~/bs-film/dump --from 0 --to 64 --fps 24

Needs a built dist/. Resumable: frames already on disk are skipped. Geometry comes once, in fresh/.
Runs the real film code, so timing, cuts and lip shapes match the game exactly."""
import argparse, base64, json, pathlib, sys, time
from playwright.sync_api import sync_playwright
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from smoke import launch, serve  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True); ap.add_argument('--from', dest='b0', type=float, default=0); ap.add_argument('--to', dest='b1', type=float, default=132)
ap.add_argument('--fps', type=float, default=24); ap.add_argument('--port', type=int, default=4187); ap.add_argument('--quality', default='ultra')
a = ap.parse_args()
out = pathlib.Path(a.out).expanduser(); (out / 'frames').mkdir(parents=True, exist_ok=True); (out / 'fresh').mkdir(exist_ok=True)
BEAT = 0.375
httpd = serve(a.port)
with sync_playwright() as pw:
    b = launch(pw)
    page = b.new_page(viewport={'width': 320, 'height': 180})
    page.on('pageerror', lambda e: print('pageerror', str(e)[:300], flush=True))
    page.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: false, showFps: false}))")
    page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={a.quality}', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function("window.__bs && window.__bs.ready", timeout=300000)
    page.evaluate((HERE / 'dump.js').read_text())
    page.evaluate('__bs.hold(true)'); page.evaluate('__bs.film.start()'); time.sleep(1)

    def step(b_):
        n = page.evaluate('__bs.frames')
        page.evaluate(f'__bs.film.seek({b_}); __bs.advance(1 / 240)')
        page.wait_for_function(f'__bs.frames > {n}', timeout=300000)

    total = int((a.b1 - a.b0) * BEAT * a.fps)
    known = {p.stem for p in (out / 'fresh').glob('*.json')}
    t0 = time.time()
    for f in range(total):
        beat = a.b0 + f / a.fps / BEAT
        idx = round(beat * BEAT * a.fps)
        path = out / 'frames' / f'{idx:05d}.json'
        if path.exists():
            continue
        step(beat); step(beat)
        d = page.evaluate('__filmDump()')
        for k, v in d.pop('fresh').items():
            if k not in known:
                (out / 'fresh' / f'{k}.json').write_text(json.dumps(v)); known.add(k)
        tmp = path.with_suffix('.tmp'); tmp.write_text(json.dumps(d)); tmp.rename(path)
        if f % 24 == 0:
            print(f'{f}/{total} beat {beat:.1f} meshes {len(d["meshes"])} {time.time() - t0:.0f}s', flush=True)
    b.close()
httpd.shutdown()
print('done', flush=True)
