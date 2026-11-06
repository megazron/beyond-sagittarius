#!/usr/bin/env python3
"""Plays every cutscene on a hand-stepped clock and saves frames for review.

The game's clock is held (window.__bs.hold), then moved one step at a time, so software GL
sees the same film a real GPU does. One frame per second by default.

  python tools/cutscene_qa.py --out DIR                      every scene
  python tools/cutscene_qa.py --out DIR --only film,vault-l3 some of them
  python tools/cutscene_qa.py --out DIR --film-beats 8,24,28 frames at chosen montage beats
  python tools/cutscene_qa.py --out DIR --sheets docs/screenshots/qa   also write contact sheets

Scenes: opening (Vault intro, departure, deck, the event), film, wake, vault-l3, vault-l7, vault-ch1,
fight, rescue, camp, beacon. Needs a built dist/ (npm run build).
"""
import argparse
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
ALL = ['opening', 'film', 'wake', 'vault-l3', 'vault-l7', 'vault-ch1', 'fight', 'rescue', 'camp', 'beacon']


class Run:
    def __init__(self, page, out, step):
        self.page, self.out, self.step, self.n = page, out, step, 0
        self.errors = []

    def advance(self, sec):
        done = self.page.evaluate('__bs.frames')
        self.page.evaluate(f'__bs.advance({sec})')
        self.page.wait_for_function(f'__bs.frames > {done}', timeout=300000)

    def shot(self, folder, tag):
        d = self.out / folder
        d.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(d / f'{tag}.jpg'), type='jpeg', quality=72, timeout=180000)
        self.n += 1

    def play(self, folder, running, step=None, limit=400):
        """Step and shoot until `running` (a JS expression) goes false."""
        step = step or self.step
        t, last = 0.0, time.time()
        while self.page.evaluate(running) and t < limit:
            self.advance(step)
            t += step
            self.shot(folder, f'{t:06.1f}')
            if time.time() - last > 30:
                print(f'  {folder} {t:.0f}s', flush=True)
                last = time.time()
        print(f'{folder}: {t:.0f} s', flush=True)
        return t


def to_game(r):
    """Past the opening and into free play."""
    p = r.page
    p.evaluate('__bs.hold(false)')
    for _ in range(12):
        if p.evaluate("__bs.state === 'game' && __bs.mode === 'play'"):
            break
        p.evaluate('__bs.skip()')
        time.sleep(4)
    p.wait_for_function("__bs.state === 'game' && __bs.mode === 'play'", timeout=120000)
    time.sleep(1)
    p.evaluate('window.localStorage.setItem("x", "1")')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default=','.join(ALL))
    ap.add_argument('--quality', default='web')
    ap.add_argument('--port', type=int, default=4179)
    ap.add_argument('--lang', default='en')
    ap.add_argument('--width', type=int, default=960)
    ap.add_argument('--height', type=int, default=540)
    ap.add_argument('--step', type=float, default=1.0)
    ap.add_argument('--film-step', type=float, default=0.75, help='the sequence cuts fast: finer than the rest')
    ap.add_argument('--film-beats', default='')
    ap.add_argument('--sheets', default='')
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    want = a.only.split(',')
    httpd = serve(a.port)
    errors = []
    with sync_playwright() as pw:
        b = launch(pw)
        page = b.new_page(viewport={'width': a.width, 'height': a.height})
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
        page.add_init_script(f"localStorage.setItem('bs-settings-v1', JSON.stringify({{lang: '{a.lang}', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}}))")
        page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")  # same test-profile setting as smoke.py
        page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={a.quality}', wait_until='domcontentloaded', timeout=120000)
        page.wait_for_function("window.__bs && window.__bs.state === 'title'", timeout=90000)
        page.wait_for_function('window.__bs.ready', timeout=300000)
        # CSS fades run on the wall clock: make them instant so a frame shows the fade's end state
        page.add_style_tag(content='#fade{transition:none !important} *{animation-duration:0.01s !important}')
        r = Run(page, out, a.step)

        if a.film_beats:
            page.evaluate('__bs.hold(true)')
            page.evaluate('__bs.film.start()')
            time.sleep(0.5)
            for x in [float(v) for v in a.film_beats.split(',')]:
                page.evaluate(f'__bs.film.seek({x})')
                r.advance(1 / 30)
                r.advance(1 / 30)
                r.shot('beats', f'{x:06.2f}')
            print('frames:', r.n)
        else:
            page.click('#btn-new')
            page.wait_for_selector('#nm-ok', timeout=15000)
            page.click('#nm-ok')
            page.wait_for_function("__bs.state === 'narrator' && __bs.vault.playing", timeout=30000)
            page.evaluate('__bs.hold(true)')
            if 'opening' in want:
                r.play('opening', "__bs.state === 'narrator' || __bs.state === 'cinematic'")
            else:
                page.evaluate('__bs.skip()')
                r.advance(0.1)
                time.sleep(1)
                page.wait_for_function("__bs.state === 'cinematic'", timeout=30000)
                for _ in range(2):
                    page.evaluate('__bs.skip()')
                    r.advance(0.1)
            page.wait_for_function("__bs.state === 'film'", timeout=30000)
            if 'film' in want:
                r.play('film', "__bs.state === 'film' && __bs.film.playing", a.film_step, 80)
            else:
                page.evaluate('__bs.skip()')
                r.advance(0.1)
            page.wait_for_function("__bs.state === 'game'", timeout=60000)
            if 'wake' in want:
                r.play('wake', "__bs.mode === 'wake'", limit=40)
            to_game(r)
            for name, go, state in [
                ('vault-l3', "__bs.sceneTest('l3')", "__bs.state === 'narrator'"),
                ('vault-l7', "__bs.sceneTest('l7')", "__bs.state === 'narrator'"),
                ('vault-ch1', "__bs.sceneTest('ch1')", "__bs.state === 'narrator'"),
                ('fight', "__bs.sceneTest('fight')", "__bs.state === 'flashback'"),
                ('rescue', "__bs.gameScene('rescue')", "__bs.mode === 'scene'"),
                ('camp', "__bs.gameScene('camp')", "__bs.mode === 'scene'"),
                ('beacon', "__bs.gameScene('beacon')", "__bs.mode === 'scene'"),
            ]:
                if name not in want:
                    continue
                page.evaluate('__bs.hold(false)')
                page.evaluate(go)
                page.wait_for_function(state, timeout=30000)
                time.sleep(1.2)
                page.evaluate('__bs.hold(true)')
                r.play(name, state)
                page.evaluate('__bs.hold(false)')
                page.wait_for_function("__bs.state === 'game' && __bs.mode === 'play'", timeout=60000)
                time.sleep(1.5)
        b.close()
    httpd.shutdown()
    real = [e for e in errors if 'fonts.g' not in e and 'net::ERR' not in e]
    for e in real[:12]:
        print(e)
    print(f'{r.n} frames, {len(real)} errors')
    if a.sheets:
        dest = pathlib.Path(a.sheets)
        dest.mkdir(parents=True, exist_ok=True)
        for d in sorted(p for p in out.iterdir() if p.is_dir()):
            files = sorted(d.glob('*.jpg'))
            for i in range(0, len(files), 30):
                lst = out / f'.{d.name}.txt'
                lst.write_text(''.join(f"file '{f.resolve()}'\n" for f in files[i:i + 30]))
                subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(lst), '-vf', 'scale=320:-1,tile=6x5:padding=2', '-frames:v', '1', '-q:v', '6', str(dest / f'{d.name}-{i // 30 + 1}.jpg')], check=True)
                lst.unlink()
    sys.exit(1 if real else 0)


if __name__ == '__main__':
    main()
