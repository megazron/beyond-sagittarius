#!/usr/bin/env python3
"""The CPU side of a street full of bodies: dev/crowd.html (six crew and a crowd of creator bodies, as Zenvora has them)
in a checkout, through Vite's dev server, timing every body's animate() alone (no WebGL in that number, so it means the
same on any GPU or on software GL). --tree points at another checkout (an older commit's worktree): the page is
copied in first, so commits can be compared.
  python tools/crowd_cpu.py [--tree DIR] [--n 60] [--frames 90] [--out FILE]"""
import argparse, json, os, pathlib, shutil, signal, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser(); ap.add_argument('--tree', default=str(ROOT)); ap.add_argument('--n', type=int, default=60)
ap.add_argument('--frames', type=int, default=90); ap.add_argument('--port', type=int, default=5231); ap.add_argument('--out', default='')
ap.add_argument('--size', default='480x270')
a = ap.parse_args()
tree = pathlib.Path(a.tree)
if tree != ROOT:
    for f in ('crowd.html', 'crowd.ts'): shutil.copy(ROOT / 'dev' / f, tree / 'dev' / f)
srv = subprocess.Popen(['npx', 'vite', '--port', str(a.port), '--strictPort'], cwd=tree, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
res = {'tree': str(tree)}
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        w, h = map(int, a.size.split('x'))
        pg = b.new_page(viewport={'width': w, 'height': h}); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        for _ in range(60):
            try: pg.goto(f'http://127.0.0.1:{a.port}/dev/crowd.html?n={a.n}', timeout=60000); break
            except Exception: time.sleep(2)
        pg.wait_for_function('window.ready === true', timeout=900000)
        pg.wait_for_function(f'window.animMs().frames >= {a.frames}', timeout=1800000, polling=2000)
        res.update(pg.evaluate('animMs()')); res['draw'] = pg.evaluate('info()'); res['errors'] = errs[:3]
        b.close()
finally:
    os.killpg(srv.pid, signal.SIGTERM); srv.wait(timeout=20)  # the server and its node child, nothing else
    if tree != ROOT:
        for f in ('crowd.html', 'crowd.ts'): (tree / 'dev' / f).unlink(missing_ok=True)
print(json.dumps(res))
if a.out: pathlib.Path(a.out).write_text(json.dumps(res, indent=1))
