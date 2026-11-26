"""Physics glitch check over the opening, the city and Episodes One to Three (src/core/glitch.ts and core/clipprobe.ts).

Each segment runs on a held clock in steps of 1/30 s with the glitch watch on, the player walking itself to the next task
or objective (__bs.autoWalk). Counted: pops (a body jumping or snapping round in one frame in view), limb snaps, feet
under the ground, standing in the air, the player's height flickering on stairs and slopes, the player inside a wall
after the frame, and (sampled once a second by the clip probe) bodies through each other or the set. Segments:
  pull    the opening's pull and the run to the pods (the deck, zero gravity at the end; pops and limbs only)
  city    Zenvora: the walk from home along the list's first tasks
  ep1     Verdaxis, Episode One's first level after the wake-up
  ep2     Episode Two (level 11) from a save
  ep3     Episode Three (level 15) from a save
Fails when any segment has more than its allowance (--allow, default 0) of pops, snaps, floor or wall events.

  python tools/glitch_check.py [--port 4761] [--secs 20] [--only city,ep1] [--json OUT.json]
"""
import argparse
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402
from episode3_smoke import save_at_11, save_at_15  # noqa: E402

HARD = ('pop', 'snap', 'floor', 'wall', 'jitter', 'float')
SET = "localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false, tutorialDone: true%s})); localStorage.setItem('bs-consent-v1', '1');"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=4761)
    ap.add_argument('--quality', default='web')
    ap.add_argument('--secs', type=float, default=20)
    ap.add_argument('--only', default='pull,city,ep1,ep2,ep3')
    ap.add_argument('--allow', type=int, default=0)
    ap.add_argument('--json', default='')
    a = ap.parse_args()
    want = a.only.split(',')
    httpd = serve(a.port)
    out, fails = {}, []
    with sync_playwright() as pw:
        b = launch(pw)

        def run(name, setup, prologue, save=None):
            ctx = b.new_context(viewport={'width': 640, 'height': 360})
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            ctx.add_init_script(SET % ('' if prologue else ', skipPrologue: true'))
            if save: ctx.add_init_script(f"if (!sessionStorage.getItem('gl')) {{ sessionStorage.setItem('gl', '1'); localStorage.setItem('bs-save-v1', {json.dumps(json.dumps(save))}); }}")
            page.goto(f'http://127.0.0.1:{a.port}/index.html?choices=0&quality={a.quality}', wait_until='domcontentloaded', timeout=120000)
            page.wait_for_function("window.__bs && window.__bs.state === 'title'", timeout=90000)
            page.wait_for_function('window.__bs.ready', timeout=300000)
            ev = page.evaluate
            frames = [ev('__bs.frames')]

            def step(sec=1 / 30, n=1):
                for _ in range(n):
                    ev(f'__bs.advance({sec})')
                    page.wait_for_function(f'__bs.frames > {frames[0]}', timeout=300000)
                    frames[0] = ev('__bs.frames')
            try:
                setup(page, ev, step)
            except Exception as e:  # noqa: BLE001
                fails.append(f'{name}: could not reach the segment ({str(e)[:120]})'); ctx.close(); return
            ev('__bs.hold(true)'); frames[0] = ev('__bs.frames')
            ev('__bs.glitch(true)')
            walk = name != 'pull'
            if walk: ev('__bs.autoWalk(true)')
            clips = []
            n = int(a.secs * 30)
            for i in range(n):
                step()
                if walk and i % 30 == 0 and ev('__bs.away') and not ev('__bs.away').get('next'): break
                if i % 30 == 15:
                    for h in ev('__bs.clipProbe()') or []:
                        if h['kind'] == 'body' and h['depth'] > 0.06: clips.append(h)
                if walk and i % 90 == 0 and ev("__bs.away ? false : (__bs.mode !== 'play')"):
                    ev('__bs.skip()')  # a scene came on the way: let it pass
            g = ev('__bs.glitches')
            ev('__bs.autoWalk(false)'); ev('__bs.glitch(false)')
            ctx.close()
            ev_by = g['summary']['by']
            out[name] = {'summary': g['summary'], 'events': g['events'][:200], 'clips': clips[:50], 'errors': errs[:5]}
            bad = sum(ev_by.get(k, 0) for k in HARD)
            first = {}
            for e in g['events']:
                first.setdefault(e['kind'], e)
            print(f"{name}: {g['summary']['frames']} frames, {g['summary']['meanBodies']} bodies near on average; "
                  + (', '.join(f'{k} {v}' for k, v in sorted(ev_by.items())) or 'no glitches') + f'; bodies through bodies {len(clips)}', flush=True)
            for k, e in first.items():
                print(f"   first {k}: {e['who']} at {e['t']} s, {e['detail']} at {e['at']}", flush=True)
            if bad > a.allow: fails.append(f'{name}: {bad} glitches')
            if errs: fails.append(f'{name}: page error {errs[0][:100]}')

        def opening(page, ev, step):
            page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=15000); page.click('#nm-ok')
            page.wait_for_function("__bs.state === 'narrator'", timeout=60000); ev('__bs.skip()')
            page.wait_for_function("__bs.state === 'cinematic'", timeout=120000)
            ev('__bs.hold(true)')
            step(0.1, 2); ev('__bs.cineSeek(97)'); step(0.1)

        def city(page, ev, step):
            page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=15000); page.click('#nm-ok')
            page.wait_for_function("__bs.state === 'narrator'", timeout=60000); ev('__bs.skip()')
            page.wait_for_function("__bs.mode === 'away' && __bs.away && __bs.away.who", timeout=300000)
            page.wait_for_timeout(2500)

        def ep1(page, ev, step):
            page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=15000); page.click('#nm-ok')
            page.wait_for_function("__bs.state === 'narrator'", timeout=60000); ev('__bs.skip()')
            page.wait_for_function("__bs.state === 'cinematic'", timeout=120000)
            for _ in range(4):
                ev('__bs.skip()'); page.wait_for_timeout(600)
            page.wait_for_function("__bs.state === 'film' || __bs.state === 'game'", timeout=120000); ev('__bs.skip()')
            page.wait_for_function("__bs.state === 'game'", timeout=180000)
            for _ in range(20):
                if ev('__bs.mode') == 'play': break
                ev('__bs.skip()'); page.wait_for_timeout(1500)

        def from_save(page, ev, step):
            page.click('#btn-continue')
            page.wait_for_function("__bs.state === 'game'", timeout=180000)
            for _ in range(30):
                if ev('__bs.mode') == 'play': break
                ev('__bs.skip()'); page.wait_for_timeout(1500)

        if 'pull' in want: run('pull', opening, False)
        if 'city' in want: run('city', city, True)
        if 'ep1' in want: run('ep1', ep1, False)
        if 'ep2' in want: run('ep2', from_save, False, save_at_11())
        if 'ep3' in want: run('ep3', from_save, False, save_at_15())
        b.close()
    httpd.shutdown()
    if a.json: pathlib.Path(a.json).write_text(json.dumps(out, indent=1))
    print(('FAILED: ' + '; '.join(fails)) if fails else 'OK: no physics glitches over ' + ', '.join(out))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
