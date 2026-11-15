#!/usr/bin/env python3
"""Each body's own poses, taken from the game: every bone's turn as the dev turntable plays the clips (the arms swung
clear of that body's own torso, the head's glances, the sway), for the pose-driven corrective shapes
(tools/chars/pit.py). The shared tools/chars/cap_poses.json was taken from a few bodies; a heavy body holds its arms
further out than a slim one, so its shoulders need their own keys.
  vite, then: python tools/chars/capture_poses.py [--url http://localhost:5197/dev/chars.html] [--only cid,cid]
Writes tools/chars/poses/<cid>.json. The clips start at other times than the skin gate's (another seed) and are sampled
over their whole length, so the shapes learn the clips, not the gate's frames."""
import argparse, json, os, sys, pathlib
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from smoke import launch  # noqa: E402
ap = argparse.ArgumentParser(); ap.add_argument('--url', default='http://localhost:5197/dev/chars.html'); ap.add_argument('--only', default='')
ap.add_argument('--samples', type=int, default=10); a = ap.parse_args()
POSES = [('idle', 0), ('walk', .9), ('point', 0), ('cheer', 0), ('sit', 0), ('argue', 0)]
CREW = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social', 'megazron']
OUTFITS = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social']
out_dir = pathlib.Path(__file__).resolve().parent / 'poses'; out_dir.mkdir(exist_ok=True)
with sync_playwright() as pw:
    b = launch(pw)
    for q, idxs, kind in (('', range(7), 'crew'), ('&skin=suit', [1], 'suit'), ('&custom=all', range(12), 'custom')):
        pg = None
        for i in idxs:
            cid = CREW[i] if kind == 'crew' else 'strong_suit' if kind == 'suit' else f'custom_{"mf"[i % 2]}_{OUTFITS[i >> 1]}'
            if a.only and cid not in a.only.split(','): continue
            if pg is None:
                pg = b.new_page(viewport={'width': 160, 'height': 160}); pg.set_default_timeout(600000)
                pg.goto(a.url + '?studio=1&gate=1' + q); pg.wait_for_function('window.ready===true', timeout=600000)
            pg.evaluate(f'gateStart({i})')
            # another seed than the gate's: the clips start elsewhere in their cycle
            pg.evaluate(f"(()=>{{let s={(i + 1) * 104729 + len(q)}; Math.random=()=>{{s=(s*1103515245+12345)%2147483648; return s/2147483648;}};}})()")
            rec = []
            for pose, amt in POSES:
                pg.evaluate(f"pose('{pose}', {amt}); step(20)")
                for f in range(a.samples):
                    pg.evaluate('step(13)')
                    qs = pg.evaluate(f"(()=>{{const r={{}}; chars[{i}].root.traverse(o=>{{if(o.isBone) r[o.name]=[o.quaternion.x,o.quaternion.y,o.quaternion.z,o.quaternion.w].map(x=>Math.round(x*1e4)/1e4);}}); return r;}})()")
                    rec.append({'pose': pose, 'q': qs})
            json.dump(rec, open(out_dir / f'{cid}.json', 'w'), separators=(',', ':'))
            print(cid, len(rec), flush=True)
        if pg is not None: pg.close()
    b.close()
