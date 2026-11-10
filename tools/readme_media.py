#!/usr/bin/env python3
"""Real footage for the README, on a held clock so a slow machine films the same thing a fast one plays.

  python tools/readme_media.py [--out DIR]   needs a built dist/ and ffmpeg

Writes gameplay.gif (forest walk), title.gif (the fall, stopping before the landings), and stills."""
import argparse, pathlib, subprocess, sys, time, shutil
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402
ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser(); ap.add_argument('--out', default=str(pathlib.Path.home() / 'bs-review/readme')); ap.add_argument('--port', type=int, default=4193)
a = ap.parse_args(); out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)


def gif(src, name, fps, width, colors=128):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(fps), '-i', f'{src}/%04d.jpg', '-vf',
                    f'scale={width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors={colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', str(out / name)], check=True)
    print(name, round((out / name).stat().st_size / 1e6, 2), 'MB', flush=True)


httpd = serve(a.port)
with sync_playwright() as pw:
    b = launch(pw); page = b.new_page(viewport={'width': 1280, 'height': 720})
    page.on('pageerror', lambda e: print('pageerror', str(e)[:200], flush=True))
    page.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}))")
    page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?prologue=0&quality=web', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function("window.__bs && window.__bs.ready", timeout=300000)
    page.add_style_tag(content='#fade{transition:none !important}')

    def adv(s):
        n = page.evaluate('__bs.frames'); page.evaluate(f'__bs.advance({s})'); page.wait_for_function(f'__bs.frames > {n}', timeout=120000)

    page.screenshot(path=str(out / 'title.jpg'), type='jpeg', quality=86)
    # the fall: Act I and II only
    page.evaluate('__bs.hold(true)'); page.evaluate('__bs.film.start()'); time.sleep(.5)
    d = out / 'f_title'; shutil.rmtree(d, ignore_errors=True); d.mkdir()
    n = 0
    for i in range(int((48 - 18) * 4)):
        bt = 18 + i / 4
        page.evaluate(f'__bs.film.seek({bt})'); adv(1 / 60); adv(1 / 60); n += 1
        page.screenshot(path=str(d / f'{n:04d}.jpg'), type='jpeg', quality=82)
    page.evaluate('__bs.hold(false)'); page.evaluate('__bs.skip()'); time.sleep(1)
    gif(d, 'title.gif', 10, 560)
    b.close()
    # a fresh page for play
    b = launch(pw); page = b.new_page(viewport={'width': 1280, 'height': 720})
    page.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: false, showFps: false, tutorialDone: true}))")
    page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?prologue=0&quality=web', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function("window.__bs && window.__bs.ready", timeout=300000)
    page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=15000); page.click('#nm-ok')
    for _ in range(30):
        if page.evaluate("__bs.state === 'game' && __bs.mode === 'play'"): break
        page.evaluate('__bs.skip()'); time.sleep(3)
    page.wait_for_function("__bs.state === 'game' && __bs.mode === 'play'", timeout=120000)
    time.sleep(2); page.evaluate('__bs.setTime(9.5)')
    page.evaluate('__bs.hold(true)'); adv(.2)
    d = out / 'f_play'; shutil.rmtree(d, ignore_errors=True); d.mkdir()
    page.keyboard.down('w'); n = 0
    for i in range(64):
        if i == 22: page.keyboard.down('d')
        if i == 34: page.keyboard.up('d')
        adv(1 / 10); n += 1
        page.screenshot(path=str(d / f'{n:04d}.jpg'), type='jpeg', quality=82)
    page.keyboard.up('w')
    gif(d, 'gameplay.gif', 10, 560)
    page.screenshot(path=str(out / 'forest.jpg'), type='jpeg', quality=86)
    b.close()
httpd.shutdown(); print('done', flush=True)
