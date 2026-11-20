#!/usr/bin/env python3
"""Zenvora in pictures and short clips: the minimap and the GPS line, the side streets and their squares, the full map,
the flat, and walking up to people. Frames are stepped by the game's own clock (__bs.hold), so a slow GPU gives the same
clip. Writes JPEGs and, with --clips, MP4s (ffmpeg).
  python tools/city_tour.py --out DIR [--quality web] [--clips] [--gpu]"""
import argparse, functools, http.server, pathlib, subprocess, sys, tempfile, threading, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pw_pin  # noqa: E402,F401
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--dist', default=str(pathlib.Path(__file__).resolve().parent.parent / 'dist'))
ap.add_argument('--out', default='city_tour'); ap.add_argument('--quality', default='web'); ap.add_argument('--port', type=int, default=4391)
ap.add_argument('--clips', action='store_true'); ap.add_argument('--gpu', action='store_true', help='ANGLE on the GPU instead of SwiftShader')
ap.add_argument('--size', default='960x540'); ap.add_argument('--fps', type=int, default=15); ap.add_argument('--secs', type=float, default=6)
a = ap.parse_args(); out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), functools.partial(H, directory=a.dist))
threading.Thread(target=srv.serve_forever, daemon=True).start()
GL = ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] if a.gpu else ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
W, Hh = map(int, a.size.split('x'))
with sync_playwright() as pw:
    b = pw.chromium.launch(headless=not a.gpu, args=GL + ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'])
    page = b.new_page(viewport={'width': W, 'height': Hh})
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)[:200]))
    page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={a.quality}')
    page.wait_for_function("window.__bs && __bs.state === 'title' && __bs.ready", timeout=600000)
    print('gpu', page.evaluate("(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)})()"), flush=True)
    page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=30000); page.click('#nm-ok')
    for i in range(300):
        if page.evaluate("__bs.mode === 'away' && !!(__bs.away && __bs.away.who)"): break
        if page.evaluate('__bs.state') == 'narrator': page.evaluate('__bs.skip()')
        time.sleep(1)
    time.sleep(8)
    shot = lambda n: page.screenshot(path=str(out / f'{n}.jpg'), type='jpeg', quality=80, timeout=240000)
    def at(x, z, yaw, n, wait=3):
        page.evaluate(f"__bs.awayTeleport({x}, {z}, {yaw})"); time.sleep(wait); shot(n); print('shot', n, flush=True)
    at(12.4, 68.4, 3.14, '1_flat')                # inside the flat, the GPS line to the door
    at(6.0, 60.0, 3.14, '2_street_minimap')       # down the street, minimap top right
    at(14.0, 30.0, -1.5708, '3_side_street')      # the east side street, looking along it
    at(60.0, 30.0, -1.5708, '4_square_fountain')  # the square with the light fountain
    at(-60.0, -44.0, 1.5708, '5_square_statue')   # the west square, the statue
    at(-5.5, 0.0, 0.0, '6_crowd')                 # among the crowd
    page.keyboard.press('KeyM'); time.sleep(3); shot('7_full_map'); page.keyboard.press('Escape'); time.sleep(1)
    if a.clips:
        def clip(name, setup, keys, secs):
            setup(); time.sleep(2)
            tmp = tempfile.mkdtemp(); page.evaluate('__bs.hold(true)')
            for k in keys: page.keyboard.down(k)
            n = int(secs * a.fps)
            for f in range(n):
                done = page.evaluate('__bs.frames'); page.evaluate(f'__bs.advance({1 / a.fps})')
                page.wait_for_function(f'__bs.frames > {done}', timeout=240000)
                page.screenshot(path=f'{tmp}/{f:05d}.jpg', type='jpeg', quality=85, timeout=240000)
            for k in keys: page.keyboard.up(k)
            page.evaluate('__bs.hold(false)')
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(a.fps), '-i', f'{tmp}/%05d.jpg', '-vf', 'scale=960:-2', '-c:v', 'libx264', '-crf', '26', '-pix_fmt', 'yuv420p', str(out / f'{name}.mp4')], check=True)
            subprocess.run(['rm', '-rf', tmp]); print('clip', name, flush=True)
        clip('walk_street_gps', lambda: page.evaluate("__bs.awayTeleport(7.5, 62, 3.14)"), ['KeyW'], a.secs)
        clip('walk_into_crowd', lambda: page.evaluate("__bs.awayTeleport(-5.8, 14, 3.14)"), ['KeyW'], a.secs)
        clip('side_street_square', lambda: page.evaluate("__bs.awayTeleport(16, 30, -1.5708)"), ['KeyW', 'ShiftLeft'], a.secs)
    print('errors', errs[:5])
    b.close()
