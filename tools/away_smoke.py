#!/usr/bin/env python3
"""A crew member on their own stage: enter, do every task with the real interact input, come back.
  python tools/away_smoke.py [--shot PATH]"""
import argparse, pathlib, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402
ap = argparse.ArgumentParser(); ap.add_argument('--shot', default=''); ap.add_argument('--port', type=int, default=4195); a = ap.parse_args()
fails = []
httpd = serve(a.port)
with sync_playwright() as pw:
    b = launch(pw); page = b.new_page(viewport={'width': 960, 'height': 540})
    page.on('pageerror', lambda e: fails.append(f'pageerror: {str(e)[:200]}'))
    page.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false, tutorialDone: true}))")
    page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?quality=mobile', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function("window.__bs && window.__bs.ready", timeout=300000)
    page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=15000); page.click('#nm-ok')
    for _ in range(30):
        if page.evaluate("__bs.state === 'game' && __bs.mode === 'play'"): break
        page.evaluate('__bs.skip()'); time.sleep(3)
    page.wait_for_function("__bs.state === 'game' && __bs.mode === 'play'", timeout=120000)
    page.evaluate("__bs.goAway('explorer', 'ring')"); time.sleep(3)
    print('mode', page.evaluate('__bs.mode'), page.evaluate('__bs.away'), flush=True)
    if page.evaluate('__bs.mode') != 'away': fails.append('did not enter the stage')
    if a.shot: page.screenshot(path=a.shot, type='jpeg', quality=85, timeout=120000)
    for _ in range(12):
        s = page.evaluate('__bs.away')
        if not s: break
        n = s
        for _try in range(4):  # a frame can take seconds under load: a press may land between two of them
            page.evaluate('__bs.awayGoNext()'); time.sleep(1.5); page.keyboard.press('KeyE'); time.sleep(1.5)
            n = page.evaluate('__bs.away')
            if not n or n['next'] != s['next']: break
        print('after', s['next'], '->', n and n['next'], flush=True)
        if n and n['next'] == s['next']: fails.append(f"task {s['next']} did not complete")
    time.sleep(1)
    if page.evaluate('__bs.mode') != 'play': fails.append(f"did not come back: {page.evaluate('__bs.mode')}")
    b.close()
httpd.shutdown()
print(('FAILED ' + '; '.join(fails)) if fails else 'OK: stage entered, every task done, back on the green world', flush=True)
sys.exit(1 if fails else 0)
