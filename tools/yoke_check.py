#!/usr/bin/env python3
"""The pilot's hands on the yoke (the pull, shots D1 to D3): each wrist must stay put on its horn while the yoke hauls,
rolls and shakes. New Game (no city), the departure skipped, the cinematic sought to D1, then stepped at 1/30 s with
the wrists logged in the yoke's own frame (__bs.yokeReport). Fails if a wrist moves more than --jitter mm between two
frames or wanders more than --wander mm over the shots, once the grip has closed (the first half second).

  python tools/yoke_check.py [--port 4743] [--shots DIR]
"""
import argparse, json, math, pathlib, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--port', type=int, default=4743)
ap.add_argument('--shots', default='')
ap.add_argument('--jitter', type=float, default=4.0)
ap.add_argument('--wander', type=float, default=15.0)
ap.add_argument('--json', default='')
a = ap.parse_args()
httpd = serve(a.port)
with sync_playwright() as pw:
    b = launch(pw); page = b.new_page(viewport={'width': 960, 'height': 540})
    page.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang:'en',sensitivity:1,invertY:false,volume:0,subtitles:true,showFps:false}));localStorage.setItem('bs-consent-v1','1')")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?prologue=0&quality=web', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function('window.__bs && window.__bs.ready', timeout=300000)
    page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=30000); page.click('#nm-ok')
    page.wait_for_function("__bs.state === 'narrator'", timeout=60000); page.evaluate('__bs.skip()')
    page.wait_for_function("__bs.state === 'cinematic'", timeout=120000)
    page.evaluate('__bs.hold(true)')

    def step(s):
        n = page.evaluate('__bs.frames'); page.evaluate(f'__bs.advance({s})'); page.wait_for_function(f'__bs.frames > {n}', timeout=300000)
    while page.evaluate('__bs.stagePlaying'):
        page.evaluate('__bs.skip()'); step(0.1)
    page.evaluate('__bs.cineSeek(81.5)'); step(1 / 30)
    page.evaluate('__bs.yokeReport(true)')
    shots = pathlib.Path(a.shots) if a.shots else None
    if shots: shots.mkdir(parents=True, exist_ok=True)
    for i in range(int(13.5 * 30)):
        step(1 / 30)
        if shots and i % 15 == 0: page.screenshot(path=str(shots / f'yoke_{i:04d}.jpg'), type='jpeg', quality=80)
    rows = page.evaluate('__bs.yokeReport()') or []
    b.close()
httpd.shutdown()
bad = []
if a.json: pathlib.Path(a.json).write_text(json.dumps(rows))
if len(rows) < 60: bad.append(f'only {len(rows)} cockpit frames logged')
rows = rows[36:]  # the grip closing (about a second from the cut)
for sd in 'LR':
    pts = [r[sd] for r in rows]
    jit = max((math.dist(p, q) for p, q in zip(pts, pts[1:])), default=0) * 1000
    c = [sum(p[i] for p in pts) / max(1, len(pts)) for i in range(3)]
    wan = max((math.dist(p, c) for p in pts), default=0) * 1000
    print(f'{sd}: {len(pts)} frames, frame-to-frame {jit:.1f} mm, wander {wan:.1f} mm, mean {[round(v, 3) for v in c]} (yoke frame)')
    if jit > a.jitter: bad.append(f'{sd} wrist moved {jit:.1f} mm in one frame on the yoke')
    if wan > a.wander: bad.append(f'{sd} wrist wandered {wan:.1f} mm on the yoke')
for x in bad: print('FAIL', x)
print('yoke:', 'ok' if not bad else f'{len(bad)} problems')
sys.exit(1 if bad else 0)
