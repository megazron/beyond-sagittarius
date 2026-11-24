#!/usr/bin/env python3
"""Each of the six arrivals plays from its first frame to control, with no page errors (game/arrival.ts).
Zenvik's is the wake-up: it is played through, not skipped. Each friend's plays the first time they are taken to
their own world; the test steps it on the game clock, then checks that the body is theirs to move, that it is hurt
(slower, a limp or a held arm) and that the first-aid task is the first thing to do.
  python tools/landing_smoke.py [--quality web|mobile] [--shots DIR]"""
import argparse, pathlib, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402

ap = argparse.ArgumentParser(); ap.add_argument('--quality', default='web'); ap.add_argument('--port', type=int, default=4196); ap.add_argument('--shots', default='')
a = ap.parse_args()
fails, log = [], lambda *x: print(*x, flush=True)
FIRST = {'explorer': 'splint', 'strong': 'shoulder', 'medic': 'bind', 'builder': 'strap', 'social': 'ribs'}
STAGE = {'explorer': 'ring', 'strong': 'moon', 'medic': 'wreck', 'builder': 'scree', 'social': 'clouds'}
shots = pathlib.Path(a.shots) if a.shots else None
if shots: shots.mkdir(parents=True, exist_ok=True)
httpd = serve(a.port)
with sync_playwright() as pw:
    b = launch(pw); page = b.new_page(viewport={'width': 960, 'height': 540})
    page.on('pageerror', lambda e: fails.append(f'pageerror: {str(e)[:240]}'))
    page.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false, tutorialDone: true}))")
    page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?prologue=0&quality={a.quality}', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function('window.__bs && window.__bs.ready', timeout=300000)
    page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=15000); page.click('#nm-ok')
    ev = page.evaluate
    # past the films, up to the wake-up (not through it)
    for _ in range(40):
        if ev("__bs.state === 'game' && (__bs.mode === 'wake' || __bs.mode === 'play')"): break
        ev('__bs.skip()'); time.sleep(3)
    page.wait_for_function("__bs.state === 'game' && (__bs.mode === 'wake' || __bs.mode === 'play')", timeout=120000)
    if ev('__bs.mode') != 'wake': fails.append('the wake-up was skipped before it could be played')
    else:
        ev('__bs.hold(true)')
        t = 0.0
        # the wake is stretched so no line is cut off (game.ts wakeRate): with the English takes loaded its 22.2 s of cues
        # take about 46 s of game time (wake.line3 is 6.7 s in a 3.4 s slot), so 40 held seconds ended inside it and
        # the 30 s on the free clock after that are only a few seconds of game time on CI's software GL
        # played to its end (not skipped) the wake hands to 1.1's acted thirst scene (waking.ts thirst: mode 'scene', about
        # 6 s and a line), then play: held through that too, as the free clock is a few frames a second on CI
        while ev("__bs.mode") in ('wake', 'scene') and t < 90:
            n = ev('__bs.frames'); ev('__bs.advance(1)'); page.wait_for_function(f'__bs.frames > {n}', timeout=120000); t += 1
            if shots and int(t) % 4 == 0: page.screenshot(path=str(shots / f'wake_{int(t):02d}.jpg'), type='jpeg', quality=70)
        ev('__bs.hold(false)')
        try: page.wait_for_function("__bs.mode === 'play'", timeout=30000)
        except Exception: fails.append(f'wake: did not reach play ({t:.0f} s played)')
        log('wake played', t, 's; mode', ev('__bs.mode'))
        w = ev('__bs.wounds')
        if not w or w['who'] != 'scientist': fails.append(f'wake: no wounds after the fall: {w}')
        elif not w['effects']['limp']: fails.append(f"wake: not limping on day one: {w['effects']}")
    for who, loc in STAGE.items():
        ev(f"__bs.goAway('{who}', '{loc}')")
        try: page.wait_for_function("__bs.mode === 'away' && !!__bs.away", timeout=60000)
        except Exception: fails.append(f'{who}: did not enter {loc}'); continue
        arr = ev('__bs.arrival')
        if not arr or arr['id'] != who: fails.append(f'{who}: no arrival on the first visit ({arr})'); ev('__bs.awayOutro()'); time.sleep(2); continue
        dur = arr['dur']; ev('__bs.hold(true)'); t = 0.0
        while ev('!!__bs.arrival') and t < dur + 6:
            n = ev('__bs.frames'); ev('__bs.advance(1)'); page.wait_for_function(f'__bs.frames > {n}', timeout=120000); t += 1
            if shots and int(t) % 3 == 0: page.screenshot(path=str(shots / f'{who}_{int(t):02d}.jpg'), type='jpeg', quality=70)
        if ev('!!__bs.arrival'): fails.append(f'{who}: arrival still playing after {t:.0f} s (of {dur})')
        # control: the body moves under the player's keys, hurt
        p0 = ev('__bs.away.pos'); page.keyboard.down('KeyW')
        for _ in range(3): n = ev('__bs.frames'); ev('__bs.advance(0.5)'); page.wait_for_function(f'__bs.frames > {n}', timeout=120000)
        page.keyboard.up('KeyW'); p1 = ev('__bs.away.pos')
        ev('__bs.hold(false)')
        moved = ((p1[0] - p0[0]) ** 2 + (p1[2] - p0[2]) ** 2) ** 0.5
        w = ev('__bs.wounds')
        nxt = ev('__bs.away.next')
        log(f'{who}: arrival {t:.0f}/{dur} s, moved {moved:.2f} m, next {nxt}, effects {w and w["effects"]}')
        if moved < 0.2: fails.append(f'{who}: no control after the arrival (moved {moved:.2f} m)')
        if not w or w['who'] != who or w['effects']['speed'] > 0.95: fails.append(f'{who}: not hurt after the arrival: {w}')
        if nxt != FIRST[who]: fails.append(f'{who}: first task is {nxt}, not first aid ({FIRST[who]})')
        ev('__bs.awayOutro()')
        try: page.wait_for_function("__bs.mode === 'play'", timeout=30000)
        except Exception: fails.append(f'{who}: did not come back to Verdaxis')
        time.sleep(1)
    # a second visit is a job: no arrival again
    ev("__bs.goAway('medic', 'wreck')"); time.sleep(3)
    if ev('!!__bs.arrival'): fails.append('medic: the arrival played again on a second visit')
    ev('__bs.awayOutro()'); time.sleep(2)
    b.close()
httpd.shutdown()
for f in fails: print('FAIL', f)
print('landing_smoke:', 'FAILED' if fails else 'ok')
sys.exit(1 if fails else 0)
