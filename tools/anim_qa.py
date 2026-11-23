#!/usr/bin/env python3
"""Animation QA: every clip, every task with its prop, holds on a spear and a stone (still, thrust, walking, running,
knapping, drilling, a throw), reaches out of range, into the chest and across the body, a hold target that jumps,
and extreme joint ranges, on the six crew, MegaZroN and the twelve townsfolk (the townsfolk run a shorter list).
dev/animqa.ts measures each frame: arms into the torso, one-frame jerks of elbows, wrists and fingertips, hands off
what they hold, props off the palm, and (with --every N) the play capture's pixel flags for skin through cloth and an
inner garment through an outer one, from three views every N frames.
  python tools/anim_qa.py [--serve] [--url http://localhost:5197/dev/chars.html] [--every 10] [--only nuvexa,lyrra]
         [--out anim_qa.json] [--budget tools/anim_qa_budget.json] [--write-budget] [--gpu]
Fails if any scenario's worst value over all bodies is over its budget (tools/anim_qa_budget.json: the worst per
scenario and metric, ratcheted down as fixes land, with a little slack). --write-budget writes the budget from this run.
Software GL as the other gates run it (tools/smoke.py launch: ANGLE on lavapipe Vulkan) unless --gpu (WSLg: ANGLE GL on
Mesa d3d12)."""
import argparse, atexit, json, os, pathlib, signal, subprocess, sys, time, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools' / 'chars'))
from config import CHARS  # noqa: E402
sys.path.insert(0, str(ROOT / 'tools'))
from smoke import launch  # noqa: E402
ap = argparse.ArgumentParser(); ap.add_argument('--url', default='http://localhost:5197/dev/chars.html'); ap.add_argument('--serve', action='store_true')
ap.add_argument('--every', type=int, default=10, help='frames between pixel-flag samples; 0 for none'); ap.add_argument('--only', default='')
ap.add_argument('--scen', default='', help='only these scenarios (comma list)')
ap.add_argument('--out', default='anim_qa.json'); ap.add_argument('--budget', default=str(ROOT / 'tools' / 'anim_qa_budget.json'))
ap.add_argument('--write-budget', action='store_true'); ap.add_argument('--ratchet', default=None, help='with --write-budget: keep the lower of the old budget and this run, except these metrics (comma list, their measure changed)'); ap.add_argument('--gpu', action='store_true'); ap.add_argument('--size', default='480x270')
a = ap.parse_args()
if a.serve:
    port = urllib.parse.urlparse(a.url).port
    srv = subprocess.Popen(['npx', 'vite', '--port', str(port), '--strictPort', '--host', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    atexit.register(lambda: os.killpg(srv.pid, signal.SIGTERM))  # the server and its node child, nothing else
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(1))
    for _ in range(180):
        try: urllib.request.urlopen(a.url, timeout=5); break
        except Exception: time.sleep(1)
NAMES = ['zenvik', 'draxum', 'lyrra', 'skyvra', 'bolzar', 'nuvexa', 'megazron']
IDS = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social', 'megazron']
OUTFITS = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social']
METRICS = ['armPenCm', 'handPenCm', 'meshInCm', 'jerkCm', 'holdErrCm', 'propGapCm', 'mouthCm', 'skinPx', 'clothPx']


def layers(cid):
    cl = CHARS[cid]['clothes']
    return [0.5 if ('boot' in n or 'shoe' in n) else 1 + i for i, (n, _, _) in enumerate(cl)]


def flat(r):
    s = max(1, r['flags']['samples'])
    return {'armPenCm': r['armPenCm'], 'handPenCm': r['handPenCm'], 'meshInCm': r.get('meshInCm', 0), 'jerkCm': r['jerkCm'], 'holdErrCm': 0 if r['holdFree'] or r.get('reach', 0) > 0.97 else r['holdErrCm'],
            'propGapCm': r['propGapCm'], 'mouthCm': r.get('mouthCm', 0), 'skinPx': round(r['flags']['skinPoke'] / s), 'clothPx': round(r['flags']['clothPoke'] / s)}


W_, H_ = map(int, a.size.split('x'))
if a.gpu: os.environ.setdefault('GALLIUM_DRIVER', 'd3d12'); os.environ.setdefault('MESA_D3D12_DEFAULT_ADAPTER_NAME', 'NVIDIA')
rows, errs, t0 = [], [], time.time()
with sync_playwright() as pw:
    b = pw.chromium.launch(headless=False, args=['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu']) if a.gpu else launch(pw)
    for page_q, idxs, label in (('', range(7), None), ('&custom=all', range(12), 'townsfolk')):
        roster = [(i, f'custom_{"mf"[i % 2]}_{OUTFITS[i >> 1]}' if label else NAMES[i]) for i in idxs]
        if a.only: roster = [x for x in roster if x[1] in a.only.split(',')]
        if not roster: continue
        pg = b.new_page(viewport={'width': W_, 'height': H_}); pg.set_default_timeout(900000)
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        pg.goto(a.url + '?studio=1&gate=1&detail=1' + page_q); pg.wait_for_function('window.ready===true', timeout=900000)
        for i, who in roster:
            cid = OUTFITS[i >> 1] if label else IDS[i]
            pg.evaluate(f'setLayers({json.dumps(layers(cid))})'); pg.evaluate(f'gateStart({i})')
            names = pg.evaluate(f'qaNames({str(not label).lower()})')
            if a.scen: names = [n for n in names if n in a.scen.split(',')]
            for n in names:
                r = pg.evaluate(f'qa({i}, {json.dumps(n)}, {a.every})'); r['body'] = who; r.update(flat(r)); rows.append(r)
            mine = [r for r in rows if r['body'] == who]
            w = {m: max(mine, key=lambda r: r[m]) for m in METRICS}
            print(f'{who:18s} ' + '  '.join(f"{m} {w[m][m]} ({w[m]['scenario']})" for m in METRICS), f'[{time.time() - t0:.0f}s]', flush=True)
        pg.close()
    b.close()
json.dump(rows, open(a.out, 'w'), indent=0)
worst = {}
for r in rows:
    d = worst.setdefault(r['scenario'], {m: 0 for m in METRICS})
    for m in METRICS: d[m] = max(d[m], r[m])
print('\nworst over all bodies, per metric:', ', '.join(f"{m} {max(d[m] for d in worst.values())}" for m in METRICS))
print('scenarios over 2.5 cm arm penetration:', sum(1 for d in worst.values() if d['armPenCm'] > 2.5), '/', len(worst),
      '| over 2 cm into the torso surface:', sum(1 for d in worst.values() if d['meshInCm'] > 2), '| over 4 cm jerk:', sum(1 for d in worst.values() if d['jerkCm'] > 4), '| hand off its hold > 3 cm:', sum(1 for d in worst.values() if d['holdErrCm'] > 3))
if a.write_budget:
    # slack: 10% plus 1 cm, so a rerun on another GPU passes; the pixel counts get more (rasterisers differ)
    bud = {s: {m: (round(v * 1.25 + 30) if m.endswith('Px') else round(v * 1.1 + 1.0, 1)) for m, v in d.items()} for s, d in worst.items()}
    if a.ratchet is not None and os.path.isfile(a.budget):
        old = json.load(open(a.budget))['scenarios']; reset = set(a.ratchet.split(','))
        for s_, d in bud.items():
            for m, v in d.items():
                o = old.get(s_, {}).get(m)
                if o is not None and m not in reset and (a.every > 0 or not m.endswith('Px')): d[m] = min(v, o)
                elif o is not None and m.endswith('Px') and a.every <= 0: d[m] = o
    json.dump({'note': 'tools/anim_qa.py --write-budget; lower these as fixes land. Target: arm and hand penetration 0, jerk under 4 cm, holdErr under 2 cm, pixels near 0.', 'every': a.every, 'scenarios': bud}, open(a.budget, 'w'), indent=1)
    print('budget written', a.budget)
fails = [f'page error: {e}' for e in errs[:3]]
if os.path.isfile(a.budget) and os.path.getsize(a.budget) and not a.write_budget:
    B = json.load(open(a.budget))['scenarios']
    for s, d in worst.items():
        for m, v in d.items():
            if m.endswith('Px') and a.every <= 0: continue
            cap = B.get(s, {}).get(m)
            if cap is not None and v > cap:
                who = max((r for r in rows if r['scenario'] == s), key=lambda r: r[m])
                fails.append(f"{s} {m} {v} > {cap} ({who['body']}, {who.get('penAt') if 'Pen' in m else who.get('jerkAt') if m == 'jerkCm' else who.get('holdAt') if m == 'holdErrCm' else ''})")
print(f'{len(fails)} over budget' + (':' if fails else ''))
for f in fails: print('  ', f)
sys.exit(1 if fails else 0)
