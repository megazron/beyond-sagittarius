"""The opening's choices: that they are asked, that they branch, and that they persist.

New Game (no city) with ?choices=1, the Vault skipped, then the lounge and the pull on a held clock. Each of the seven
moments over the lounge, the pull and the pods is answered with the real keys (a number for a decision, E pressed, held
or not pressed for a reflex). Checks: each answer is in the opening's save on disk the moment it is given; lines change
with the answers (the lounge's own-up line gives way to the blame lines, Zenvik's "come look at this" is not said when he
checks again); the bonds and the Ledger show; a reload part way through and Continue resume the opening without asking
an answered moment again; the answers, trust and flags come with you to the planet, and the opening's save is replaced.
No outcome is named in the log (CI logs are public): moments are numbered.

  python tools/choices_check.py [--port 4751] [--quality web]

Needs a built dist/ (npm run build).
"""
import argparse
import pathlib
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402

# (moment, how to answer, the pick it must log): a digit picks a decision's option, 'E' presses, 'HOLD' keeps E down,
# None lets the time run out
PLAN = [
    ('e1.lounge', 'Digit2', 'blame'),
    ('e1.reading', 'Digit2', 'check'),
    ('e1.brace', 'E', 'pass'),
    ('e1.reach', 'Digit2', 'bolzar'),
    ('e1.hold', 'HOLD', 'pass'),
    ('e1.breath', None, 'fail'),
    ('e1.handcore', 'Digit1', 'hand'),
]
# written timeline times (cinematic.ts: S = 39 plus the cue's offset), a little before each cue
AT = {'e1.reading': 68.2, 'e1.brace': 98.2, 'e1.reach': 100.3, 'e1.hold': 101.9, 'e1.breath': 133.3, 'e1.handcore': 158.2}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=4751)
    ap.add_argument('--quality', default='web')
    a = ap.parse_args()
    httpd = serve(a.port)
    fails, errors = [], []
    with sync_playwright() as pw:
        b = launch(pw)
        ctx = b.new_context(viewport={'width': 960, 'height': 540})
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        ctx.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: true, showFps: false}))")
        ctx.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
        url = f'http://127.0.0.1:{a.port}/index.html?prologue=0&choices=1&quality={a.quality}'
        ev = page.evaluate
        frames = [0]

        def step(sec=0.1, n=1):
            for _ in range(n):
                ev(f'__bs.advance({sec})')
                page.wait_for_function(f'__bs.frames > {frames[0]}', timeout=300000)
                frames[0] = ev('__bs.frames')

        def opened():
            s = ev('__bs.moment.saved')
            return (s or {}).get('branch', {}).get('open')

        def answer(i, mid, how, want):
            # wait for the moment to open (a decision or a reflex over the film)
            for _ in range(400):
                if ev('__bs.moment.open'):
                    break
                step()
            else:
                fails.append(f'moment {i + 1} never opened'); return
            o = opened()
            if not o or o.get('id') != mid:
                fails.append(f'moment {i + 1}: a different moment opened ({o and o.get("kind")} {o and o.get("id")}, film at {ev("__bs.cineTime()"):.1f})')
            step(0.35); page.wait_for_timeout(400)  # past the guard against a held key (it counts real time)
            if how == 'HOLD':
                page.keyboard.down('KeyE')
                for _ in range(60):
                    step(0.05)
                    if not ev('__bs.moment.open'): break
                page.keyboard.up('KeyE')
            elif how == 'E':
                page.keyboard.press('KeyE')
            elif how:
                page.keyboard.press(how)
            for _ in range(200):
                if not ev('__bs.moment.open'): break
                step()
            step(0.1, 3)
            log = (ev('__bs.moment.saved') or {}).get('branch', {}).get('log', [])
            got = next((e['pick'] for e in log if e['id'] == mid), None)
            if got != want: fails.append(f'moment {i + 1}: logged {"nothing" if got is None else "another answer"} on disk (log: {[e["id"] for e in log]})')
            else: print(f'moment {i + 1}: answered and on disk', flush=True)

        def start(cont=False):
            page.goto(url, wait_until='domcontentloaded', timeout=120000)
            page.wait_for_function("window.__bs && window.__bs.state === 'title'", timeout=90000)
            page.wait_for_function('window.__bs.ready', timeout=300000)
            ev('__bs.moment.ready')
            if cont:
                page.click('#btn-continue')
            else:
                page.click('#btn-new')
                page.wait_for_selector('#nm-ok', timeout=15000)
                page.click('#nm-ok')
            page.wait_for_function("__bs.state === 'narrator'", timeout=60000)
            ev('__bs.skip()')
            page.wait_for_function("__bs.state === 'cinematic'", timeout=120000)
            ev('__bs.hold(true)')
            frames[0] = ev('__bs.frames')

        def through_lounge(expect_fork):
            # to the lounge (the stage starts at 14.2 s on the written clock), then beat by beat while it plays: True
            # when its choice opens, False when the lounge ends without one
            ev('__bs.cineSeek(13.9)')
            for _ in range(60):
                step(0.1)
                if ev('__bs.stagePlaying'): break
            for _ in range(120):
                if ev('__bs.moment.open'): return True
                if not ev('__bs.stagePlaying'): return False
                ev('__bs.nextBeat()'); step(0.1, 2)
            return False

        def finish_lounge():
            for _ in range(200):
                if not ev('__bs.stagePlaying'): return
                if ev('__bs.moment.open'): step(0.5); continue
                ev('__bs.nextBeat()'); step(0.1, 2)

        start()
        saved = ev('__bs.moment.saved')
        if not saved or not saved.get('flags', {}).get('openingLive'):
            fails.append('no save on disk at the start of the opening')
        if not through_lounge(True): fails.append('the lounge choice never opened')
        answer(0, *PLAN[0])
        finish_lounge()
        said = ev('__bs.moment.said')
        if 'dep.5b' not in said or 'dep.6b' not in said: fails.append('the lounge did not play the lines of the answer given')
        if 'dep.5' in said or 'dep.6' in said: fails.append('the lounge played the lines of an answer not given')
        for i, (mid, how, want) in enumerate(PLAN[1:4], 1):
            ev(f'__bs.cineSeek({AT[mid]})'); step(0.1)
            answer(i, mid, how, want)
        # (no more film here: the next moment, the hold, is a second away and would time out unanswered)
        if 'cine.line4' in ev('__bs.moment.said'): fails.append('a line was said that the answer took away')
        shown = ev('__bs.moment.log')
        if not any(x['what'] == 'bond' for x in shown): fails.append('no bond meter shown')
        if not any(x['what'] == 'ledger' for x in shown): fails.append('no Ledger line shown')

        # a reload part way through: Continue resumes the opening and asks nothing already answered
        start(cont=True)
        if through_lounge(False): fails.append('an answered moment was asked again after Continue')
        finish_lounge()
        for mid in ('e1.reading', 'e1.brace', 'e1.reach'):
            ev(f'__bs.cineSeek({AT[mid]})'); step(0.1, 12)
            if ev('__bs.moment.open'): fails.append('an answered moment was asked again after Continue'); break
        else: print('Continue: answered moments passed over', flush=True)
        for i, (mid, how, want) in enumerate(PLAN[4:], 4):
            ev(f'__bs.cineSeek({AT[mid]})'); step(0.1)
            answer(i, mid, how, want)
        # to the end of the opening and onto the planet
        ev('__bs.hold(false)')
        for _ in range(3):
            if ev("__bs.state") == 'cinematic': ev('__bs.skip()')
            page.wait_for_timeout(1500)
        page.wait_for_function("__bs.state === 'film'", timeout=120000)
        ev('__bs.skip()')
        page.wait_for_function("__bs.state === 'game'", timeout=180000)
        page.wait_for_timeout(1500)
        st = ev('__bs.branch.state')
        ids = {e['id']: e['pick'] for e in (st or {}).get('log', [])}
        if any(ids.get(m) != w for m, _, w in PLAN): fails.append('the opening\'s answers did not come to the planet')
        disk = ev('__bs.moment.saved') or {}
        if disk.get('flags', {}).get('openingLive'): fails.append('the opening\'s save was not replaced on the planet')
        if not any(k.startswith('explorer>') for k in (st or {}).get('trust', {})): fails.append('trust did not come to the planet')
        # the episodes' scene moments (branch/moments.ts): loaded on the choice layer, and one answered and one let go
        # in a scene where you stand, each written to disk at once, the second changing the line that follows
        eps = page.evaluate('__bs.moment.episodes') or []
        if len(eps) < 12: fails.append(f'only {len(eps)} episode moments loaded on the choice layer')
        for _ in range(40):
            if ev('__bs.mode') == 'play': break
            ev('__bs.skip()'); page.wait_for_timeout(1500)
        def ep_moment(n, mid, press, line=None, flag=None):
            for _ in range(60):
                if ev('__bs.mode') == 'play': break
                if not ev('__bs.moment.open'): ev('__bs.skip()')
                page.wait_for_timeout(500)
            if not ev(f'__bs.moment.episodeTest({mid!r}, {line!r}, {flag!r})'.replace('None', 'undefined')): fails.append(f'episode moment {n}: no scene could start (mode {ev("__bs.mode")})'); return
            try: page.wait_for_function('__bs.moment.open', timeout=15000)
            except Exception: fails.append(f'episode moment {n} never opened on the layer'); return
            if press: page.wait_for_timeout(300); page.keyboard.press('KeyE' if press is True else press)
            page.wait_for_function('!__bs.moment.open', timeout=20000)
            page.wait_for_timeout(400)
            log = ((ev('__bs.moment.saved') or {}).get('branch') or {}).get('log', [])
            got = next((e['pick'] for e in log if e['id'] == mid), None)
            want = flag if press not in (True, False, None) else ('pass' if press else 'fail')
            if got != want: fails.append(f'episode moment {n}: logged {"nothing" if got is None else "another answer"} on disk')
            if line:
                page.wait_for_function("__bs.mode === 'play'", timeout=30000)
                if line not in ev('__bs.moment.said'): fails.append(f'episode moment {n}: the line its answer brings was not said')
            print(f'episode moment {n}: {"pressed" if press else "let go"}, saved at once' + (', its line said' if line else ''), flush=True)
        ep_moment(1, 'e2m.tap', True)
        ep_moment(2, 'e2m.spark', False, 'e2m.py.miss', 'e2m.spark.missed')
        # a decision of the episodes (Hoh-Ma's question): the first option shown, by its number; its line follows
        ep_moment(3, 'e3d.hohma', 'Digit1', 'e3d.hm.truth', 'truth')
        b.close()
    httpd.shutdown()
    fails += errors[:5]
    print(('FAILED: ' + '; '.join(fails)) if fails else 'OK: seven moments asked, answered, saved at once, kept across a reload, branched lines, carried to the planet; the episodes\' moments on the layer')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
