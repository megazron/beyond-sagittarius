#!/usr/bin/env python3
"""Skin gate: no character ever shows the inside of its body. Every skin surface is shaded grey from the front and
magenta from behind; for every crew member, MegaZroN, Mir and two townsfolk, in the poses the game uses, close-ups of
the neck and collar, both wrists and both ankles from 8 angles are rendered and the magenta pixels counted.
  python tools/skin_gate.py [--url http://localhost:5197/dev/chars.html] [--shots DIR] [--limit 25]
Fails if any close-up shows more than --limit flag pixels (a few stray edge pixels are not a hole)."""
import argparse, math, os, sys, pathlib
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch  # noqa: E402
ap = argparse.ArgumentParser(); ap.add_argument('--url', default='http://localhost:5197/dev/chars.html'); ap.add_argument('--shots', default='')
ap.add_argument('--limit', type=int, default=25); ap.add_argument('--only', default=''); a = ap.parse_args()
POSES = [('idle', 0), ('walk', .9), ('point', 0), ('cheer', 0), ('sit', 0), ('argue', 0)]
SPOTS = [('neck', 'neck', .55), ('wristL', 'handL', .5), ('wristR', 'handR', .5), ('ankleL', 'footL', .55), ('ankleR', 'footR', .55)]
NAMES = ['zenvik', 'draxum', 'lyrra', 'skyvra', 'bolzar', 'nuvexa', 'megazron']
worst, fails = {}, []
if a.shots: os.makedirs(a.shots, exist_ok=True)
with sync_playwright() as pw:
    b = launch(pw)
    for page_q, idxs, label in (('', range(7), None), ('&skin=suit', [1], 'mir'), ('&custom=1', [0, 1], 'townsfolk')):
        pg = b.new_page(viewport={'width': 320, 'height': 320}); pg.set_default_timeout(600000)
        pg.goto(a.url + '?studio=1' + page_q); pg.wait_for_function('window.ready===true', timeout=600000)
        pg.evaluate('flagMode()')
        for i in idxs:
            who = label if label and label != 'townsfolk' else (f'townsfolk{i}' if label == 'townsfolk' else NAMES[i])
            if a.only and who not in a.only.split(','): continue
            pg.evaluate(f"chars.forEach((c,j)=>c.root.visible=j==={i})")
            for pose, amt in POSES:
                pg.evaluate(f"pose('{pose}', {amt}); step(45)")
                for spot, bone, dist in SPOTS:
                    p = pg.evaluate(f"(()=>{{const o=chars[{i}].root.getObjectByName('{bone}'); if(!o) return null; const v=o.getWorldPosition(chars[{i}].root.position.clone()); return [v.x,v.y,v.z];}})()")
                    if not p: continue
                    for k in range(8):
                        yaw = k * math.pi / 4; up = .12 if spot == 'neck' else .05
                        pg.evaluate(f"viewAt({p[0]}, {p[1]}, {p[2]}, {yaw}, {up}, {dist}); step(1)")
                        n = pg.evaluate('flagCount()')
                        key = (who, pose, spot)
                        if n > worst.get(key, (-1,))[0]: worst[key] = (n, k)
                        if n > a.limit and a.shots: pg.screenshot(path=f'{a.shots}/{who}_{pose}_{spot}_{k}.png')
        pg.close()
    b.close()
for (who, pose, spot), (n, k) in sorted(worst.items()):
    if n > a.limit: fails.append(f'{who} {pose} {spot}: {n} px of body interior (angle {k * 45} deg)')
by = {}
for (who, pose, spot), (n, k) in worst.items(): by[who] = max(by.get(who, 0), n)
print('worst flag pixels per character:', ', '.join(f'{w} {n}' for w, n in sorted(by.items())))
print(('FAILED ' + str(len(fails)) + ':\n - ' + '\n - '.join(fails[:40])) if fails else f'OK: no close-up shows the inside of a body (limit {a.limit} px)')
sys.exit(1 if fails else 0)
