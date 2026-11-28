#!/usr/bin/env python3
"""Continuity check of the opening films: the departure lounge, the journey, the pull and the run to the pods.

New Game (no city), the Vault skipped, then the cinematic played on a held clock in small steps with the continuity log
on (src/cinematic/continuity.ts). Fails on any break an audience would see between shots of the same room: furniture
appearing or vanishing, someone sitting at one cut and standing at the next without being seen to get up, someone
somewhere they could not have walked to while off screen, and pops inside a shot (a jump, a snap turn, a posture change
between two frames). Also fails when a loose prop on the floor sits inside a piece of furniture.

It goes on past the pull into the title sequence, up to the white (one event, one time), and also fails on: a change of
place with no travel shown (lounge, passage, pod bay), the ship's state going backwards (gravity, lights, hull, loose
things, the hatch, the air), someone on the floor with gravity off, the camera crossing the line over a cut (most pairs
swap sides, or most movers turn round), and the sound bed (a bed cut on a picture cut, dead air, alarm lamps flashing
with no alarm heard). --answers a|b plays it with the opening's choices on and answers them one way or the other with
the real keys (moments are numbered in the log, never named).

In the run to the pods it also fails on a hand that is meant to be closed on a rail or on another's hand and is not
there, and on two bodies inside each other; the largest gap of each hand and the least distance between each two bodies
are printed whether they fail or not. --stills DIR saves a picture every --stills-every seconds of film from
--stills-from (cinematic seconds) on, to look at the staging without a GPU take (the pictures are SwiftShader's: for
where people and cameras are, not for how it looks).

  python tools/continuity_check.py [--port 4741] [--step 0.1] [--answers a|b] [--json OUT.json]
      [--stills DIR --stills-from 153.5 --stills-every 0.5 --fast 0.25 --until 186 --size 960x540]

Needs a built dist/ (npm run build). Prints each break with the cinematic clock, the shot and who.
"""
import argparse
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402


# how each of the opening's moments is answered, by the order they come in: a digit, E pressed, HOLD, or None (time runs out)
ANSWERS = {'a': ['Digit1', 'Digit1', 'E', 'Digit1', 'HOLD', None, 'Digit1'], 'b': ['Digit2', 'Digit2', None, 'Digit2', None, None, 'Digit2']}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=4741)
    ap.add_argument('--quality', default='web')
    ap.add_argument('--step', type=float, default=0.1)
    ap.add_argument('--limit', type=float, default=400, help='cinematic seconds at most')
    ap.add_argument('--json', default='')
    ap.add_argument('--answers', default='', choices=['', 'a', 'b'])
    ap.add_argument('--stills', default='', help='a folder for pictures of the film')
    ap.add_argument('--stills-from', type=float, default=153.5, help='cinematic seconds (the call to the pods is at 153.5)')
    ap.add_argument('--stills-every', type=float, default=0.5)
    ap.add_argument('--fast', type=float, default=0, help='with --stills: the step before --stills-from (the check itself is then not the full one)')
    ap.add_argument('--until', type=float, default=0, help='with --stills: stop at this cinematic second')
    ap.add_argument('--size', default='640x360')
    a = ap.parse_args()
    httpd = serve(a.port)
    errors = []
    with sync_playwright() as pw:
        b = launch(pw)
        vw, vh = (int(x) for x in a.size.split('x'))
        page = b.new_page(viewport={'width': vw, 'height': vh})
        if a.stills: pathlib.Path(a.stills).mkdir(parents=True, exist_ok=True)
        shot_at = -1.0
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        page.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}))")
        page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
        page.goto(f'http://127.0.0.1:{a.port}/index.html?prologue=0&contlog=1&quality={a.quality}{'&choices=1' if a.answers else ''}', wait_until='domcontentloaded', timeout=120000)
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
        plan, asked, seen_id = list(ANSWERS.get(a.answers, [])), 0, None

        def step(sec):
            nonlocal frames
            page.evaluate(f'__bs.advance({sec})')
            page.wait_for_function(f'__bs.frames > {frames}', timeout=300000)
            frames = page.evaluate('__bs.frames')

        def running():
            st = page.evaluate('__bs.state')
            return st == 'cinematic' or (st == 'film' and (not page.evaluate('__bs.film.playing') or page.evaluate('__bs.film.beat') < 31))

        while running() and t < a.limit:
            if page.evaluate('__bs.branch && __bs.branch.open'):
                # (the old panel) a choice or a quick-time moment waits for a player: take the first option
                page.keyboard.press('KeyE' if page.locator('#qte-btn').is_visible() else 'Digit1')
            if a.answers and page.evaluate('__bs.moment.open'):
                o = ((page.evaluate('__bs.moment.saved') or {}).get('branch') or {}).get('open') or {}
                if o.get('id') != seen_id:
                    seen_id = o.get('id'); how = plan[asked] if asked < len(plan) else None; asked += 1
                    print(f'  moment {asked} open at {t:.1f} s', flush=True)
                    step(0.35); page.wait_for_timeout(400)  # past the guard against a held key (it counts real time)
                    if how == 'HOLD':
                        page.keyboard.down('KeyE')
                        for _ in range(60):
                            step(0.05)
                            if not page.evaluate('__bs.moment.open'): break
                        page.keyboard.up('KeyE')
                    elif how == 'E':
                        page.keyboard.press('KeyE')
                    elif how:
                        page.keyboard.press(how)
            ct = page.evaluate('__bs.cineTime()') if a.stills else 0
            if a.stills and a.until and ct >= a.until and page.evaluate('__bs.state') == 'cinematic':
                break
            if a.stills and ct >= a.stills_from and t - shot_at >= a.stills_every - 1e-6:
                shot_at = t
                page.screenshot(path=str(pathlib.Path(a.stills) / f'c{ct:07.2f}.jpg'), type='jpeg', quality=80)
            st = a.fast if a.stills and a.fast and ct < a.stills_from - 1 else a.step
            step(st)
            t += st
            if int(round(t / a.step)) % 300 == 0:
                print(f'  {t:.0f} s of film, clock {page.evaluate("__bs.cineTime()"):.1f}', flush=True)
        res = page.evaluate('__bs.continuity')
        props = page.evaluate('__bs.deckOverlaps ? __bs.deckOverlaps() : []')
        b.close()
    httpd.shutdown()
    cuts = [c for c in res['cuts'] if c['at'] == 'in']
    print(f"{len(cuts)} shots logged over {t:.1f} s; {len(res['seen'])} posture changes seen on screen")
    if a.json:
        pathlib.Path(a.json).write_text(json.dumps({'cuts': res['cuts'], 'seen': res['seen'], 'breaks': res['breaks'], 'props': props}, indent=1))
    w = res.get('worst') or {}
    for k, v in sorted((w.get('grip') or {}).items(), key=lambda kv: -kv[1]):
        print(f'  hand  {k:40} at most {v * 100:5.1f} cm off')
    for k, v in sorted((w.get('near') or {}).items(), key=lambda kv: kv[1])[:8]:
        print(f'  near  {k:40} at least {v:5.2f} m apart')
    for x in res['breaks']:
        print(f"BREAK {x['kind']:9} {x['clock']:7.2f}s {x.get('from') or '':>5} -> {x.get('shot') or '':<5} {x.get('id') or '':10} {x['detail']}")
    for p in props:
        print(f'BREAK prop      {p}')
    for e in errors:
        print('ERROR', e)
    bad = len(res['breaks']) + len(props) + len(errors)
    print('continuity:', 'ok' if not bad else f'{bad} problems')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
