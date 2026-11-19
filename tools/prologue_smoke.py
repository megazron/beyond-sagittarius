#!/usr/bin/env python3
"""The default new-game flow: MegaZroN's cold open in the Vault, the title card, the playable Zenvora prologue (every
task done with the real interact input), the take-off (letterboxed, skipped with its own button), the orbit card, then
the opening films. Also checks that the settings switch leaves the city out.
  python tools/prologue_smoke.py [--quality web] [--shot PATH]"""
import argparse, pathlib, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402
ap = argparse.ArgumentParser(); ap.add_argument('--quality', default='web'); ap.add_argument('--port', type=int, default=4197); ap.add_argument('--shot', default='')
a = ap.parse_args(); fails = []
serve(a.port)
SET = "localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false, tutorialDone: true%s}))"
with sync_playwright() as pw:
    b = launch(pw)
    for skip in (False, True):
        page = b.new_page(viewport={'width': 1280, 'height': 720}); page.set_default_timeout(120000)
        page.on('pageerror', lambda e: fails.append(f'pageerror: {str(e)[:200]}'))
        page.add_init_script(SET % (', skipPrologue: true' if skip else ''))
        page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
        page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={a.quality}', wait_until='domcontentloaded', timeout=180000)
        page.wait_for_function('window.__bs && window.__bs.ready', timeout=300000)
        page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=60000); page.click('#nm-ok')
        if skip:
            time.sleep(8)
            if page.evaluate('__bs.mode') == 'away': fails.append('settings switch did not skip the prologue')
            else: print('skip: opening films directly, mode', page.evaluate('__bs.mode'), flush=True)
            page.close(); continue
        # the cold open comes first now: MegaZroN, skippable
        try:
            page.wait_for_function("window.__bs.state === 'narrator' && window.__bs.vault.playing", timeout=120000)
            print('cold open: MegaZroN in the Vault', flush=True)
            page.click('#btn-skip')
        except Exception:
            fails.append('the new game did not open on MegaZroN')
        if not page.wait_for_selector('#title-card', timeout=60000): fails.append('no title card')
        page.wait_for_function("window.__bs.mode === 'away' && window.__bs.away && window.__bs.away.who", timeout=300000)
        if a.shot: page.screenshot(path=f'{a.shot}_city.jpg', type='jpeg', quality=85, timeout=180000)
        done = 0
        for _ in range(30):
            s = page.evaluate('__bs.away')
            if not s or not s['next']: break
            for _try in range(5):
                page.evaluate('__bs.awayGoNext()'); page.evaluate('__bs.step(0.3)'); page.keyboard.press('KeyE'); page.evaluate('__bs.step(0.5)')
                n = page.evaluate('__bs.away')
                if not n or n['next'] != s['next']: break
                time.sleep(0.5)
            if n and n['next'] == s['next']: fails.append(f"task {s['next']} did not complete"); break
            done += 1
        print('prologue tasks done', done, flush=True)
        try:
            # the take-off: letterboxed, with its Skip
            page.wait_for_function('__bs.awayOutroOn', timeout=60000)
            if not page.locator('#btn-skip').is_visible(): fails.append('the take-off has no Skip button')
            page.evaluate('__bs.step(0.1)'); time.sleep(2)
            if a.shot: page.screenshot(path=f'{a.shot}_takeoff.jpg', type='jpeg', quality=85, timeout=180000)
            page.click('#btn-skip')
            print('take-off played and skipped', flush=True)
        except Exception:
            fails.append('no take-off scene after the last task')
        try:
            page.wait_for_function("document.querySelector('#title-card') && document.querySelector('#title-card').textContent.includes('ORBIT')", timeout=60000)
            print('orbit card', flush=True)
        except Exception:
            fails.append('no orbit card after the take-off')
        try:
            # then the films
            page.wait_for_function("!window.__bs.away && window.__bs.state === 'cinematic'", timeout=180000)
            print('after the prologue: state', page.evaluate('__bs.state'), flush=True)
        except Exception:
            fails.append('the prologue never handed over to the opening films')
        page.close()
    b.close()
print(('FAILED ' + '; '.join(fails)) if fails else 'OK: MegaZroN, the title card, the Zenvora prologue to the end, the take-off, the orbit card, the opening films; the switch skips the city')
sys.exit(1 if fails else 0)
