#!/usr/bin/env python3
"""Continuity check of the opening films: the departure lounge, the journey, the pull and the run to the pods.

New Game (no city), the Vault skipped, then the cinematic played on a held clock in small steps with the continuity log
on (src/cinematic/continuity.ts). Fails on any break an audience would see between shots of the same room: furniture
appearing or vanishing, someone sitting at one cut and standing at the next without being seen to get up, someone
somewhere they could not have walked to while off screen, and pops inside a shot (a jump, a snap turn, a posture change
between two frames). Also fails when a loose prop on the floor sits inside a piece of furniture.

  python tools/continuity_check.py [--port 4741] [--step 0.1] [--json OUT.json]

Needs a built dist/ (npm run build). Prints each break with the cinematic clock, the shot and who.
"""
import argparse
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=4741)
    ap.add_argument('--quality', default='web')
    ap.add_argument('--step', type=float, default=0.1)
    ap.add_argument('--limit', type=float, default=400, help='cinematic seconds at most')
    ap.add_argument('--json', default='')
    a = ap.parse_args()
    httpd = serve(a.port)
    errors = []
    with sync_playwright() as pw:
        b = launch(pw)
        page = b.new_page(viewport={'width': 640, 'height': 360})
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        page.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}))")
        page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
        page.goto(f'http://127.0.0.1:{a.port}/index.html?prologue=0&contlog=1&quality={a.quality}', wait_until='domcontentloaded', timeout=120000)
        page.wait_for_function("window.__bs && window.__bs.state === 'title'", timeout=90000)
        page.wait_for_function('window.__bs.ready', timeout=300000)
        page.click('#btn-new')
        page.wait_for_selector('#nm-ok', timeout=15000)
        page.click('#nm-ok')
        page.wait_for_function("__bs.state === 'narrator'", timeout=60000)
        page.evaluate('__bs.skip()')
        page.wait_for_function("__bs.state === 'cinematic'", timeout=120000)
        page.evaluate('__bs.hold(true)')
        page.evaluate('__bs.contLog(true)')
        t, frames = 0.0, page.evaluate('__bs.frames')
        while page.evaluate("__bs.state === 'cinematic'") and t < a.limit:
            if page.evaluate('__bs.branch.open'):
                # a choice or a quick-time moment waits for a player: take the first option
                page.keyboard.press('KeyE' if page.locator('#qte-btn').is_visible() else 'Digit1')
            page.evaluate(f'__bs.advance({a.step})')
            page.wait_for_function(f'__bs.frames > {frames}', timeout=300000)
            frames = page.evaluate('__bs.frames')
            t += a.step
            if int(t / a.step) % 300 == 0:
                print(f'  {t:.0f} s of film, clock {page.evaluate("__bs.cineTime()"):.1f}', flush=True)
        res = page.evaluate('__bs.continuity')
        props = page.evaluate('__bs.deckOverlaps ? __bs.deckOverlaps() : []')
        b.close()
    httpd.shutdown()
    cuts = [c for c in res['cuts'] if c['at'] == 'in']
    print(f"{len(cuts)} shots logged over {t:.1f} s; {len(res['seen'])} posture changes seen on screen")
    if a.json:
        pathlib.Path(a.json).write_text(json.dumps({'cuts': res['cuts'], 'seen': res['seen'], 'breaks': res['breaks'], 'props': props}, indent=1))
    for x in res['breaks']:
        print(f"BREAK {x['kind']:9} {x['clock']:7.2f}s {x['from']:>5} -> {x['shot']:<5} {x.get('id', ''):10} {x['detail']}")
    for p in props:
        print(f'BREAK prop      {p}')
    for e in errors:
        print('ERROR', e)
    bad = len(res['breaks']) + len(props) + len(errors)
    print('continuity:', 'ok' if not bad else f'{bad} problems')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
