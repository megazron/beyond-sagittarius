#!/usr/bin/env python3
"""Skin and cloth in play: every crew member, MegaZroN, Mir and the twelve creator bodies (the townsfolk), through the
actions the game gives them (idle 10 s, walk, run, turn, sit, talk, argue, point, cheer), seen from the game's own
follow camera (fov 60, near 0.1) at 5.2 m from four sides and at 2.4 m (talking distance) from the front and the side.
Every few frames three flag passes count: skin out through cloth (yellow), an inner garment out through an outer one
(cyan) and skin seen from behind (magenta). Writes a frame sheet per character of its worst frames, and a JSON report.
  python tools/play_capture.py --url http://localhost:5197/dev/chars.html [--detail 0.6] [--out DIR] [--only scientist,mir]
Runs on the real GPU when there is one (WSLg: ANGLE GL on Mesa d3d12), or on software GL with --soft."""
import argparse, base64, io, json, math, os, pathlib, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / 'chars'))
from config import CHARS  # noqa: E402
ap = argparse.ArgumentParser(); ap.add_argument('--url', default='http://localhost:5197/dev/chars.html'); ap.add_argument('--detail', default='1')
ap.add_argument('--out', default='play_capture'); ap.add_argument('--only', default=''); ap.add_argument('--soft', action='store_true')
ap.add_argument('--clips', action='store_true', help='also a short MP4 per character in normal shading (walk, run, turn, sit, argue, cheer)')
ap.add_argument('--big', action='store_true', help='also each worst view full size');
ap.add_argument('--serve', action='store_true', help='start Vite on the URL\'s port for the run, and stop it after');
ap.add_argument('--size', default='960x540'); ap.add_argument('--every', type=int, default=8, help='frames between flag samples (30 fps clock)')
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
import atexit, signal, subprocess, time, urllib.parse, urllib.request
if a.serve:
    port = urllib.parse.urlparse(a.url).port
    srv = subprocess.Popen(['npx', 'vite', '--port', str(port), '--strictPort'], cwd=pathlib.Path(__file__).resolve().parent.parent,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    atexit.register(lambda: os.killpg(srv.pid, signal.SIGTERM))  # the server and its node child, nothing else
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(1))  # so a stopped run stops its server too
    for _ in range(120):
        try: urllib.request.urlopen(a.url, timeout=5); break
        except Exception: time.sleep(1)
W_, H_ = map(int, a.size.split('x'))
NAMES = ['zenvik', 'draxum', 'lyrra', 'skyvra', 'bolzar', 'nuvexa', 'megazron']
IDS = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social', 'megazron']
OUTFITS = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social']
# (name, pose, ground speed m/s, turn rad/s, seconds, talking)
ACTIONS = [('idle', 'idle', 0, 0, 10, False), ('walk', 'idle', 1.4, 0, 3, False), ('run', 'idle', 3.6, 0, 3, False), ('turn', 'idle', 0.9, 2.2, 3, False),
           ('sit', 'sit', 0, 0, 3, False), ('talk', 'idle', 0, 0, 3, True), ('argue', 'argue', 0, 0, 3, True), ('point', 'point', 0, 0, 3, False), ('cheer', 'cheer', 0, 0, 3, False)]
CAMS = [('back', 0, 5.2), ('side', math.pi / 2, 5.2), ('front', math.pi, 5.2), ('3q', -2.4, 5.2), ('talk', math.pi, 2.4), ('talkside', -math.pi / 2, 2.4)]


def layers(cid):
    cl = CHARS[cid]['clothes']
    return [0.5 if ('boot' in n or 'shoe' in n) else 1 + i for i, (n, _, _) in enumerate(cl)]


GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if a.soft else ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu']
if not a.soft: os.environ.setdefault('GALLIUM_DRIVER', 'd3d12'); os.environ.setdefault('MESA_D3D12_DEFAULT_ADAPTER_NAME', 'NVIDIA')
report = {}
try:
    from PIL import Image
except ImportError:
    Image = None
with sync_playwright() as pw:
    b = pw.chromium.launch(headless=a.soft, args=GL)
    for page_q, idxs, label in (('', range(7), None), ('&skin=suit', [1], 'mir'), ('&custom=all', range(12), 'townsfolk')):
        roster = [(i, label if label == 'mir' else (f'custom_{"mf"[i % 2]}_{OUTFITS[i >> 1]}' if label == 'townsfolk' else NAMES[i])) for i in idxs]
        if a.only: roster = [x for x in roster if x[1] in a.only.split(',')]
        if not roster: continue
        pg = b.new_page(viewport={'width': W_, 'height': H_}); pg.set_default_timeout(600000)
        pg.goto(a.url + f'?studio=1&gate=1&detail={a.detail}' + page_q); pg.wait_for_function('window.ready===true', timeout=600000)
        for i, who in roster:
            cid = 'strong_suit' if who == 'mir' else (OUTFITS[i >> 1] if label == 'townsfolk' else IDS[i])
            pg.evaluate(f'setLayers({json.dumps(layers(cid))})'); pg.evaluate(f'gateStart({i})')
            rep = report[who] = {}
            shots = []
            for act, pose, v, w, sec, talk in ACTIONS:
                pg.evaluate(f'resetPos({i})')
                step = lambda n: pg.evaluate(f"for (let k = 0; k < {n}; k++) act({i}, '{pose}', {v}, {w}, 1/30, {str(talk).lower()})")
                step(20)
                tot = {'skinPoke': 0, 'clothPoke': 0, 'back': 0}; worst = (0, None, None)
                for f in range(0, int(sec * 30), a.every):
                    step(1 if f == 0 else a.every)
                    for cn, yo, d in CAMS:
                        pg.evaluate(f'followCam({i}, {yo}, {d})')
                        r = pg.evaluate('poke(false)')
                        for k in tot: tot[k] += r[k]
                        s = r['skinPoke'] + r['clothPoke'] + r['back']
                        if s > worst[0]: worst = (s, cn, f)
                rep[act] = {**tot, 'worst': worst[0], 'worst_cam': worst[1], 'worst_frame': worst[2]}
                # the worst view again, as a picture (the same deterministic clock: replay to that frame)
                if worst[1] is not None:
                    pg.evaluate(f'gateStart({i})'); pg.evaluate(f'resetPos({i})')
                    step(20 + worst[2] + 1)
                    yo, d = [(c[1], c[2]) for c in CAMS if c[0] == worst[1]][0]
                    pg.evaluate(f'followCam({i}, {yo}, {d})'); r = pg.evaluate('poke(true)')
                    shots.append((f'{act} {worst[1]} {worst[0]}px', r['url']))
                    if a.big: open(f'{a.out}/{who}_{act}_{worst[1]}.jpg', 'wb').write(base64.b64decode(r['url'].split(',', 1)[1]))
                pg.evaluate(f'gateStart({i})')
            if a.clips:
                import subprocess, tempfile
                tmp = tempfile.mkdtemp(); n = 0
                for act, pose, v, w, sec, talk in [x for x in ACTIONS if x[0] in ('walk', 'run', 'turn', 'sit', 'argue', 'cheer')]:
                    pg.evaluate(f'gateStart({i})'); pg.evaluate(f'resetPos({i})')
                    for f in range(int(sec * 30)):
                        pg.evaluate(f"act({i}, '{pose}', {v}, {w}, 1/30, {str(talk).lower()})")
                        if f % 2: continue
                        pg.evaluate(f'followCam({i}, {-2.4 if act != "sit" else 2.6}, 3.4)'); pg.evaluate('renderNow()')
                        pg.screenshot(path=f'{tmp}/{n:05d}.jpg', type='jpeg', quality=88); n += 1
                subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '15', '-i', f'{tmp}/%05d.jpg', '-vf', 'scale=480:-2', '-c:v', 'libx264', '-crf', '30', '-pix_fmt', 'yuv420p', f'{a.out}/{who}.mp4'], check=True)
                subprocess.run(['rm', '-rf', tmp])
                pg.evaluate(f'gateStart({i})')
            print(who, ' '.join(f"{k}:{x['skinPoke']}/{x['clothPoke']}/{x['back']}" for k, x in rep.items()), flush=True)
            if Image and shots:
                tw, th = W_ // 3, H_ // 3; sheet = Image.new('RGB', (tw * 3, th * math.ceil(len(shots) / 3)), (20, 20, 20))
                from PIL import ImageDraw
                for k, (cap, url) in enumerate(shots):
                    im = Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).resize((tw, th))
                    ImageDraw.Draw(im).text((6, 4), f'{who} {cap}', fill=(255, 255, 255))
                    sheet.paste(im, ((k % 3) * tw, (k // 3) * th))
                sheet.save(f'{a.out}/{who}.jpg', quality=85)
        pg.close()
    b.close()
json.dump(report, open(f'{a.out}/report.json', 'w'), indent=1)
tot = {w: sum(x['skinPoke'] + x['clothPoke'] + x['back'] for x in r.values()) for w, r in report.items()}
print('flag pixels per character (all actions, all views):', ', '.join(f'{w} {n}' for w, n in tot.items()))
