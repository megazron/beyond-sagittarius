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
    for who, loc in (('explorer', 'ring'), ('builder', 'scree'), ('medic', 'wreck'), ('strong', 'moon'), ('social', 'clouds')):
        page.evaluate(f"__bs.goAway('{who}', '{loc}')"); time.sleep(3)
        if page.evaluate('__bs.mode') != 'away': fails.append(f'{loc}: did not enter'); continue
        if a.shot: page.screenshot(path=f'{a.shot}_{loc}.jpg', type='jpeg', quality=85, timeout=180000)
        for _ in range(14):
            s = page.evaluate('__bs.away')
            if not s: break
            n = s
            for _try in range(5):  # a frame can take seconds under load: a press may land between two of them
                page.evaluate('__bs.awayGoNext()'); time.sleep(1.5); page.keyboard.press('KeyE'); time.sleep(1.5)
                n = page.evaluate('__bs.away')
                if not n or n['next'] != s['next']: break
            if n and n['next'] == s['next']: fails.append(f"{loc}: task {s['next']} did not complete"); break
        time.sleep(1)
        print(loc, 'mode after:', page.evaluate('__bs.mode'), flush=True)
        if page.evaluate('__bs.mode') != 'play': fails.append(f"{loc}: did not come back")
    # the Crew tab offers whoever has had their story told
    page.keyboard.press('KeyC'); time.sleep(4)
    print('play buttons:', page.evaluate("[...document.querySelectorAll('.crew-play')].map((b) => b.dataset.play)"), flush=True)
    if page.evaluate("document.querySelectorAll('.crew-play').length") < 5: fails.append('crew tab does not offer all five')
    b.close()
httpd.shutdown()
print(('FAILED ' + '; '.join(fails)) if fails else 'OK: five stages entered, every task done, back on the green world, Play as offered', flush=True)
sys.exit(1 if fails else 0)
