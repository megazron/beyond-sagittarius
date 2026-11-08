#!/usr/bin/env python3
"""Does everyone stand on the ground that is drawn? Walks the player over a grid and up the steepest slopes of the
green world, then over every stage, and compares the feet and the camera with the drawn surface found by ray.
Fails if the feet are more than 4 cm off it, or the camera dips below it.

  python tools/ground_test.py [--quality web|mobile|ultra]"""
import argparse, math, pathlib, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402
ap = argparse.ArgumentParser(); ap.add_argument('--quality', default='web'); ap.add_argument('--port', type=int, default=4197); a = ap.parse_args()
TOL = .04
fails, worst = [], {}
httpd = serve(a.port)
with sync_playwright() as pw:
    b = launch(pw); page = b.new_page(viewport={'width': 640, 'height': 360})
    page.on('pageerror', lambda e: fails.append(f'pageerror {str(e)[:160]}'))
    page.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: false, showFps: false, tutorialDone: true}))")
    page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={a.quality}', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function("window.__bs && window.__bs.ready", timeout=300000)
    page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=15000); page.click('#nm-ok')
    for _ in range(30):
        if page.evaluate("__bs.state === 'game' && __bs.mode === 'play'"): break
        page.evaluate('__bs.skip()'); time.sleep(3)
    ev = page.evaluate
    ev('__bs.save.level = 3')  # past the limp: full speed for the slopes

    def check(tag, p):
        if p['drawn'] is None or not p.get('grounded'): return
        off = abs(p['feet'] - p['drawn'])
        w = worst.setdefault(tag, [0, 99, 0]); w[0] = max(w[0], off); w[2] += 1
        if p['camDrawn'] is not None: w[1] = min(w[1], p['cam'] - p['camDrawn'])
        if off > TOL: fails.append(f"{tag}: feet {off * 100:.1f} cm off the drawn ground at {p['x']:.1f},{p['z']:.1f}")
        if p['camDrawn'] is not None and p['cam'] < p['camDrawn'] + .05: fails.append(f"{tag}: camera inside the ground at {p['x']:.1f},{p['z']:.1f}")

    L = ev('__bs.layout')
    # a grid over the land, away from the lake
    for gx in range(-5, 6):
        for gz in range(-5, 6):
            x, z = gx * 105, gz * 105
            ev(f'__bs.teleport({x}, {z}, 0)'); ev('__bs.step(0.6)')
            p = ev('__bs.groundProbe()')
            if p['feet'] > -.2: check('green grid', p)
    # the steepest walks: from camp towards the ridge and other high ground, a sample every step
    for tx, tz in [(L['ridge'][0], L['ridge'][2]), (L['pod2'][0], L['pod2'][2]), (L['shelter'][0] + 60, L['shelter'][2] - 40)]:
        sx, sz = tx - 40, tz - 40
        ev(f'__bs.teleport({sx}, {sz}, 0)'); ev('__bs.step(0.2)')
        yaw = math.atan2(-(tx - sx), -(tz - sz))
        ev(f'__bs.look({yaw}, -0.2)')
        page.keyboard.down('KeyW')
        for _ in range(28):
            ev('__bs.step(0.25)'); check('green slope', ev('__bs.groundProbe()'))
        page.keyboard.up('KeyW')
    # into the lake and across: swimming at depth, standing again in the shallows
    ev('__bs.save.stats.stamina = 100')
    ev('__bs.teleport(4, -125, 0)'); ev('__bs.step(0.4)'); ev(f'__bs.look({math.pi / 2}, -0.2)')
    page.keyboard.down('KeyW'); swam = []
    for _ in range(400):
        ev('__bs.step(0.25)'); s_ = ev('__bs.swimProbe()'); swam.append(s_)
        if s_['x'] < -150 or (len(swam) > 20 and not s_['swimming'] and s_['x'] < -110): break
    page.keyboard.up('KeyW')
    deep = [q for q in swam if q['depth'] > 1.4]; wet = [q for q in deep if q['swimming']]
    print(f"lake: {len(swam)} samples, {len(deep)} deep, swimming in {len(wet)}, crossed to x={swam[-1]['x']:.0f}, stood at the end: {not swam[-1]['swimming']}", flush=True)
    if not deep: fails.append('the walk never reached deep water')
    if len(wet) < len(deep): fails.append(f'not swimming in {len(deep) - len(wet)} deep samples')
    if any(q['swimming'] and abs(q['y'] + 1.3) > .05 for q in swam): fails.append('a swimmer was not at the surface')
    if swam[-1]['swimming'] or swam[-1]['depth'] > 1.1: fails.append(f"did not climb out the far side: {swam[-1]}")
    # every stage
    for who, loc in (('explorer', 'ring'), ('builder', 'scree'), ('medic', 'wreck'), ('strong', 'moon'), ('social', 'clouds')):
        ev(f"__bs.goAway('{who}', '{loc}')"); time.sleep(2); ev('__bs.step(2)')
        page.keyboard.down('KeyW')
        for k in range(24):
            ev('__bs.step(0.25)'); check(f'stage {loc}', ev('__bs.groundProbe()'))
            if k % 6 == 5: ev(f'__bs.look({k * .9}, -0.2)')
        page.keyboard.up('KeyW')
        a_ = ev('__bs.away')
        ev('__bs.awayLeave()'); time.sleep(1)
    b.close()
httpd.shutdown()
for k, (o, c, n) in worst.items(): print(f'{k:16} samples {n:4}  worst feet {o * 100:5.1f} cm  lowest camera clearance {c:6.2f} m')
uniq = list(dict.fromkeys(fails))
print(('FAILED ' + str(len(uniq)) + '\n  ' + '\n  '.join(uniq[:20])) if uniq else 'OK: feet on the drawn ground and the camera above it everywhere tested')
sys.exit(1 if uniq else 0)
