#!/usr/bin/env python3
"""Every pose on every body: hands into the torso, body skin out through clothes, and one-frame vertex leaps.
  python tools/rig_check.py [--url http://localhost:5197/dev/rig.html]
Fails if a hand goes more than 2.5 cm into the torso, skin shows 1.5 cm through cloth, or a vertex leaps."""
import argparse, json, pathlib, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch  # noqa: E402
ap = argparse.ArgumentParser(); ap.add_argument('--url', default='http://localhost:5197/dev/rig.html'); ap.add_argument('--out', default=''); ap.add_argument('--only', default=''); a = ap.parse_args()
POSES = [('stand', {}), ('idle', {}), ('walk', {'amount': .35}), ('walk', {'amount': .9}), ('walk', {'amount': 1.3}), ('sit', {}), ('injured', {}), ('lie', {}),
         ('wave', {}), ('point', {}), ('cheer', {}), ('shout', {}), ('argue', {}), ('present', {}), ('write', {}), ('facepalm', {}), ('selfie', {}),
         ('float', {'flail': .85}), ('float', {'flail': .3}), ('swim', {'amount': .6}), ('jump', {})]
HAND, POKE = 2.5, 1.5
rows, fails = [], []
with sync_playwright() as pw:
    b = launch(pw); page = b.new_page(viewport={'width': 64, 'height': 64})
    page.on('pageerror', lambda e: fails.append(f'pageerror {str(e)[:200]}'))
    page.goto(a.url, wait_until='domcontentloaded', timeout=120000); page.wait_for_function('window.ready === true', timeout=300000)
    names = page.evaluate('names')
    for bi, n in enumerate(names):
        if a.only and n not in a.only.split(','): continue
        for pose, o in POSES:
            r = page.evaluate('([b, p, o]) => check(b, p, o)', [bi, pose, o]); r['opts'] = o; rows.append(r)
            bad = []
            if r['handPenCm'] > HAND: bad.append(f"hand {r['handPenCm']} cm into torso")
            if r['clothPokeCm'] > POKE: bad.append(f"skin {r['clothPokeCm']} cm through cloth at {r.get('pokeWhere')} ({r['pokeCount']} verts)")
            if r['jumpCm'] > 0: bad.append(f"vertex leap {r['jumpCm']} cm at {r['jumpWhere']}")
            if bad: fails.append(f"{n} {pose} {o}: " + '; '.join(bad))
        print(n, 'worst hand', max(x['handPenCm'] for x in rows if x['body'] == n), 'cm, cloth', max(x['clothPokeCm'] for x in rows if x['body'] == n), 'cm, leaps', sum(1 for x in rows if x['body'] == n and x['jumpCm'] > 0), flush=True)
    b.close()
if a.out: pathlib.Path(a.out).write_text(json.dumps(rows))
print(f'{len(rows)} pose runs, {len(fails)} problems'); print('\n'.join(fails[:60]))
sys.exit(1 if fails else 0)
