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
    ap.add_argument('--secs', type=float, default=120)
    ap.add_argument('--only', default='pull,city,ep1,ep2,ep3')
    ap.add_argument('--allow', type=int, default=0)
    ap.add_argument('--json', default='')
    ap.add_argument('--tick', type=float, default=1 / 30)
    ap.add_argument('--dist', default='', help='a built dist other than dist/')
    a = ap.parse_args()
    want = a.only.split(',')
    # drawn frames a second of game time: two ticks a frame (15 at the default 1/30 s tick, 30 at --tick 0.0166667)
    per = max(1, round(1 / (a.tick * 2)))
    if a.dist:
        import smoke
        smoke.DIST = pathlib.Path(a.dist).resolve()
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

            def step(sec=None, n=1):
                # two ticks of 1/30 s a drawn frame (the watch looks at every tick; a body is posed at full rate
                # for up to three ticks undrawn, character.ts sinceDrawn): half the drawing on a software GPU
                for _ in range(n):
                    ev(f'__bs.advance({sec or a.tick * 2}, {a.tick})')
                    page.wait_for_function(f'__bs.frames > {frames[0]}', timeout=300000)
                    frames[0] = ev('__bs.frames')
            try:
                setup(page, ev, step)
            except Exception as e:  # noqa: BLE001
                fails.append(f'{name}: could not reach the segment ({str(e)[:120]})'); ctx.close(); return
            ev('__bs.hold(true)'); frames[0] = ev('__bs.frames')
            ev('__bs.glitch(true)')
            walk = name != 'pull'
            clips, clip_tests = [], []

            def selftest(where):
                """Every kind put in at the watch's own read, on the nearest other body and on the player, and a body
                put on another for the clip probe: each must be caught (or say why it could not be put in here)."""
                ev("__bs.glitchTest(['pop', 'snap', 'floor', 'float'], 'npc')")
                if walk: ev("__bs.glitchTest(['pop', 'snap', 'floor', 'float', 'wall'], 'player')")
                # one at a time (two on one body in a frame would undo each other): until each is caught, missed or n/a
                for k in range(220 * per // 15):
                    step()
                    if k % 10 == 9 and not any(t['state'] in ('waiting', 'on') for t in ev('__bs.glitches')['summary']['tests']): break
                c = ev('__bs.clipPoke()')
                clip_tests.append({'where': where, **c})

            selftest('start')
            tour = ev('__bs.glitchTour()') if walk else []
            if walk: ev(f"__bs.autoWalk(true, {json.dumps([[q['x'], q['z']] for q in tour])})")
            p0 = ev('__bs.bodyPos')
            n = int(a.secs * per)
            mid = False
            trace = []
            for i in range(n):
                step()
                wp = ev('__bs.walkPlan') if walk and i % per == 0 else None
                # the height flicker can only be put in while he walks: twice on the way
                if walk and i in (3 * per, 20 * per): ev("__bs.glitchTest(['jitter'], 'player')")
                if wp and wp['i'] >= wp['n']: break
                if wp: trace.append([round(i / per, 1)] + [round(v, 2) for v in (ev('__bs.bodyPos') or [0, 0, 0])] + [wp['i'], ev('__bs.mode')])
                if walk and not mid and wp and wp['i'] >= wp['n'] / 2: mid = True; selftest('middle')
                # the pull is a film about 65 s long: its middle round at 20 s, and it ends when the film does
                if not walk and not mid and i >= 20 * per: mid = True; selftest('middle')
                if not walk and i % per == 0 and ev('__bs.state') != 'cinematic': break
                # at a job (the prompt up), do it, as a player would
                if walk and i % 10 == 5 and ev("!!document.getElementById('prompt') && !document.getElementById('prompt').classList.contains('hidden')"):
                    page.keyboard.press('KeyE')
                if i % per == 7:
                    for h in ev('__bs.clipProbe()') or []:
                        if h['kind'] == 'body' and h['depth'] > 0.06: clips.append(h)
                if walk and i % (3 * per) == 0 and ev("__bs.away ? false : (__bs.mode !== 'play')"):
                    ev('__bs.skip()')  # a scene came on the way: let it pass
            wp = ev('__bs.walkPlan') if walk else None
            selftest('end')
            p1 = ev('__bs.bodyPos')
            walked = wp['walked'] if wp else ((((p1[0] - p0[0]) ** 2 + (p1[2] - p0[2]) ** 2) ** 0.5) if p0 and p1 else 0)
            g = ev('__bs.glitches')
            ev('__bs.autoWalk(false)'); ev('__bs.glitch(false)')
            ctx.close()
            sm = g['summary']
            ev_by = dict(sm['by'])
            tests = sm['tests']
            missed = [t for t in tests if t['state'] in ('missed', 'on')]
            # never put in by the end (the film over, nobody near): said so, not counted as caught or missed
            na = [t for t in tests if t['state'] == 'n/a' or t['state'] == 'waiting']
            for t in na:
                if t['state'] == 'waiting': t['why'] = (t.get('why') or 'the segment ended first') + ' (still waiting at the end)'
            caught = [t for t in tests if t['state'] == 'caught']
            for t in missed: fails.append(f"{name}: the watch MISSED a test {t['kind']} on the {t['on']} ({t['who'] or 'nobody'}, at {t['t']} s)")
            for c in clip_tests:
                if c.get('ran') and not c.get('caught'): fails.append(f"{name}: the clip probe MISSED a body put on another ({c['where']})")
            # every kind must have been caught at least once in the segment, where it can happen there
            kinds = ['pop', 'snap'] + (['floor', 'float', 'jitter', 'wall'] if walk else [])
            for k in kinds:
                if not any(t['kind'] == k for t in caught): fails.append(f'{name}: no test {k} was caught (' + '; '.join(sorted({t.get("why") or t['state'] for t in tests if t['kind'] == k})) + ')')
            if walk and walked < 30: fails.append(f'{name}: the player walked only {walked:.1f} m')
            out[name] = {'summary': sm, 'events': [e for e in g['events'] if 'test' not in e][:200], 'clips': clips[:50], 'errors': errs[:5], 'tour': tour, 'walk': wp, 'clip_tests': clip_tests, 'trace': trace}
            bad = sum(ev_by.get(k, 0) for k in HARD)
            first = {}
            for e in g['events']:
                if 'test' not in e: first.setdefault(e['kind'], e)
            stuck = [tour[k]['what'] for k in (wp or {}).get('stuck', [])]
            print(f"{name}: {sm['frames']} frames, {sm['meanBodies']} bodies near on average (max {sm['maxBodies']}), ground known for {sm['groundShare']:.0%} of them; "
                  + (', '.join(f'{k} {v}' for k, v in sorted(ev_by.items())) or 'no glitches') + f'; bodies through bodies {len(clips)}; walked {walked:.1f} m'
                  + (f"; tour {wp['i']}/{wp['n']} points" + (f" (passed over, stuck: {', '.join(stuck)})" if stuck else '') if wp else ''), flush=True)
            print(f"   tests: {len(caught)} caught, {len(missed)} missed, {len(na)} could not be put in"
                  + ''.join(f"\n     n/a {t['kind']}/{t['on']}: {t['why']}" for t in na)
                  + f"; clip probe {sum(1 for c in clip_tests if c.get('caught'))}/{sum(1 for c in clip_tests if c.get('ran'))}", flush=True)
            if tour: print('   tour: ' + ', '.join(q['what'] for q in tour), flush=True)
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
