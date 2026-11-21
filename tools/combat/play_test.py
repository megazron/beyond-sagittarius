#!/usr/bin/env python3
"""The fight in the real game, in a browser: every set piece starts, shows its creatures, takes input from the keys,
ends with an outcome and puts the world back; the touch buttons are finger-sized; the draw calls stay in budget.
  python3 tools/combat/play_test.py [--quality web] [--out DIR] [--port 4391]"""
import argparse, functools, http.server, json, pathlib, sys, threading, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import pw_pin  # noqa: E402,F401
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--dist', default=str(pathlib.Path(__file__).resolve().parent.parent.parent / 'dist'))
ap.add_argument('--quality', default='web'); ap.add_argument('--port', type=int, default=4391); ap.add_argument('--out', default='')
a = ap.parse_args()
out = pathlib.Path(a.out) if a.out else None
if out: out.mkdir(parents=True, exist_ok=True)
# draw calls a fight may add over the same view without it (creatures, particles, projectiles, marks, HUD is DOM)
BUDGET = {'mobile': 150, 'web': 260, 'ultra': 420}

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x, **k): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), functools.partial(H, directory=a.dist))
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, name, detail=''):
    print(('ok    ' if c else 'FAIL  ') + name + (('  ' + str(detail)) if detail and not c else ''), flush=True)
    if not c: fails.append(name)

def boot(b, q, mobile=False):
    ctx = b.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True, device_scale_factor=2) if mobile else b.new_context(viewport={'width': 1120, 'height': 630})
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300]))
    page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={q}&prologue=0')
    page.wait_for_function("window.__bs && __bs.state === 'title' && __bs.ready", timeout=600000)
    page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=30000); page.click('#nm-ok')
    for i in range(400):
        st, mode = page.evaluate("[__bs.state, __bs.mode]")
        if st == 'game' and mode == 'play': break
        page.evaluate('__bs.skip()'); time.sleep(0.5)
    page.evaluate("__bs.save.flags.tutorialDone = true; __bs.tutorial && __bs.tutorialNext && 0")
    for i in range(12):
        if not page.evaluate('!!__bs.tutorial'): break
        page.evaluate('__bs.tutorialNext()'); time.sleep(0.2)
    return page, errs

D = "__bs.combat.debug()"
def step(page, sec): page.evaluate(f"__bs.step({sec})")
def shot(page, name):
    if out:
        time.sleep(0.6)
        try: page.screenshot(path=str(out / f'{name}.png'), timeout=60000)
        except Exception as e: print('no picture', name, str(e)[:80], flush=True)

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'])
    page, errs = boot(b, a.quality)
    ok(page.evaluate("!!__bs.combat"), 'the fight is part of the game')
    base = page.evaluate("JSON.stringify({ inv: __bs.save.inventory, pos: __bs.debug.player, hour: __bs.save.timeOfDay })")
    amb = page.evaluate(D)
    ok(len(amb['enemies']) >= 6, 'free play: Verdaxis has its animals', len(amb['enemies']))
    ok(not amb['engaged'], 'free play: hands free and nothing near, the fight leaves the controls alone')
    time.sleep(1.5); calls0 = page.evaluate("__bs.perf.calls")
    # ---- each set piece
    for enc in ['arena', 'hunt.first', 'night.defence', 'chase.escape', 'stealth.pass']:
        page.evaluate(f"__bs.combat.trial('{enc}')"); time.sleep(0.3); step(page, 1.0)
        d = page.evaluate(D)
        ok(d['encounter'] == enc and len(d['enemies']) >= (0 if enc == 'night.defence' else 1), f'{enc}: starts', d['encounter'])
        ok(d['engaged'] and page.evaluate("!document.getElementById('cb-hud').classList.contains('off')"), f'{enc}: the fight HUD is up')
        ok(d['views'] == len(d['enemies']), f'{enc}: every creature has a body', f"{d['views']} of {len(d['enemies'])}")
        if enc == 'arena':
            # keys: next weapon until the bow is up, aim, draw, loose
            for i in range(12):
                if page.evaluate(D)['player']['weapon'] == 'bow': break
                page.evaluate("__bs.combat.testTap('KeyR')"); step(page, 0.1)
            ok(page.evaluate(D)['player']['weapon'] == 'bow', 'arena: the weapon key walks through what you carry')
            page.evaluate("__bs.combat.testHold('Mouse2', true); __bs.combat.testHold('Mouse0', true)"); step(page, 1.2)
            ok(page.evaluate(D)['player']['act'] == 'charge', 'arena: holding attack while aiming draws the bow', page.evaluate(D)['player']['act'])
            ok(page.evaluate("document.querySelector('#cb-hud .ret').classList.contains('on')"), 'arena: the reticle shows while aiming')
            shot(page, 'arena_aim')
            page.evaluate("__bs.combat.testHold('Mouse0', false)"); step(page, 0.3)
            ok(page.evaluate(D)['stats']['shots'] == 1, 'arena: letting go looses the arrow', page.evaluate(D)['stats']['shots'])
            page.evaluate("__bs.combat.testHold('Mouse2', false)"); step(page, 0.5)
            # the kit brings creatures out
            page.evaluate("__bs.combat.testTap('KeyT')"); step(page, 0.1)
            ok(page.evaluate("document.querySelectorAll('#cb-pick button').length") >= 4, 'arena: the kit opens with creatures to bring out')
            page.evaluate("document.querySelector('#cb-pick button').click()"); step(page, 0.5)
            ok(len(page.evaluate(D)['enemies']) >= 5, 'arena: a pack of Skritch comes out')
            # roll and guard
            st0 = page.evaluate(D)['player']['stamina']
            page.evaluate("__bs.combat.testTap('KeyV')"); step(page, 0.2)
            ok(page.evaluate(D)['player']['act'] == 'roll', 'arena: the roll key rolls'); step(page, 1.0)
            ok(page.evaluate(D)['player']['stamina'] < st0, 'arena: a roll costs stamina')
            # melee: club, swing at whatever is there
            for i in range(12):
                if page.evaluate(D)['player']['weapon'] == 'club': break
                page.evaluate("__bs.combat.testTap('KeyR')"); step(page, 0.1)
            page.evaluate("__bs.combat.testTap('Mouse0')"); step(page, 0.15)
            ok(page.evaluate(D)['player']['act'] in ('windup', 'active'), 'arena: a click swings the club', page.evaluate(D)['player']['act'])
            step(page, 3); shot(page, 'arena_pack')
            # wake the guardian and let it work
            g = [e for e in page.evaluate(D)['enemies'] if e['kind'] == 'guardian'][0]
            page.evaluate(f"__bs.teleport({g['x']} - 3, {g['z']})"); step(page, 6)
            g2 = [e for e in page.evaluate(D)['enemies'] if e['kind'] == 'guardian'][0]
            ok(g2['state'] != 'dormant', 'arena: come close and the guardian wakes', g2['state'])
            ok(page.evaluate("document.querySelector('#cb-hud .boss').classList.contains('on')"), 'arena: its bar is on the screen')
            shot(page, 'arena_guardian')
            calls = page.evaluate("new Promise((r) => { let m = 0, n = 0; const f = () => { m = Math.max(m, __bs.perf.calls); if (++n < 40) requestAnimationFrame(f); else r(m); }; f(); setTimeout(() => r(Math.max(m, __bs.perf.calls)), 20000); })")
            ok(calls - calls0 < BUDGET[a.quality], f'arena: a full fight adds {calls - calls0} draw calls (budget {BUDGET[a.quality]})', calls)
        elif enc == 'hunt.first':
            shot(page, 'hunt')
            ok(any(e['kind'] == 'nibbet' for e in d['enemies']) and any(e['kind'] == 'mossback' for e in d['enemies']), 'hunt: grazers small and large are in the meadow')
        elif enc == 'night.defence':
            ok(d['phase'] == 'prep', 'night: begins with time to prepare')
            page.evaluate("__bs.combat.testTap('KeyT')"); step(page, 0.1)
            ok(page.evaluate("[...document.querySelectorAll('#cb-pick button')].filter((b) => !b.disabled).length") >= 4, 'night: the kit offers traps you can afford')
            page.evaluate("document.querySelector('#cb-pick button').click()"); step(page, 3)
            ok(page.evaluate("__bs.combat.activeSim.traps.length") == 1, 'night: a trap goes into the ground after its setting time')
            page.evaluate("__bs.combat.run.ready()"); step(page, 20); shot(page, 'night_wave1')
            d = page.evaluate(D)
            ok(d['phase'] == 'wave1' and sum(1 for e in d['enemies'] if e['kind'] == 'skritch') == 4, 'night: the first wave comes out of the dark', d['phase'])
            ok(page.evaluate("__bs.save.timeOfDay") > 20 or page.evaluate("__bs.save.timeOfDay") < 6, 'night: it is night')
        elif enc == 'chase.escape':
            step(page, 3); shot(page, 'chase')
            ok(any(e['kind'] == 'hound' and e['aware'] for e in page.evaluate(D)['enemies']), 'chase: the hunter is already after you')
        elif enc == 'stealth.pass':
            shot(page, 'stealth')
            ok(any(e['kind'] == 'hound' and e['state'] == 'asleep' for e in page.evaluate(D)['enemies']), 'stealth: the hunter is asleep by day')
            # walk straight at it: the breath moment opens
            h = [e for e in d['enemies'] if e['kind'] == 'hound'][0]
            page.evaluate(f"__bs.teleport({h['x']} - 6.5, {h['z']})"); step(page, 0.3)
            for i in range(30):
                if page.evaluate(D)['tension']: break
                step(page, 0.1); time.sleep(0.1)
            ok(page.evaluate(D)['tension'], 'stealth: beside the sleeper the breath moment opens')
            shot(page, 'tension_breath')
            for i in range(80):
                if not page.evaluate(D)['tension']: break
                step(page, 0.2); time.sleep(0.05)
            ok(not page.evaluate(D)['tension'], 'stealth: the moment ends on its own if you do nothing')
        # leave: the world is as it was
        page.evaluate("__bs.combat.leaveEncounter()")
        for i in range(60):
            step(page, 0.2); time.sleep(0.1)
            if not page.evaluate(D)['encounter']: break
        ok(page.evaluate(D)['encounter'] is None, f'{enc}: ends')
        page.evaluate("document.getElementById('cb-back') && document.getElementById('cb-back').click()")
        now = page.evaluate("JSON.stringify({ inv: __bs.save.inventory, pos: __bs.debug.player, hour: __bs.save.timeOfDay })")
        A, B = json.loads(base), json.loads(now)
        ok(A['inv'] == B['inv'], f'{enc}: a trial leaves the bag as it was', B['inv'])
        ok(abs(A['pos'][0] - B['pos'][0]) < 1 and abs(A['pos'][2] - B['pos'][2]) < 1 and abs(A['hour'] - B['hour']) < 0.2, f'{enc}: and puts you back where and when you were')
        ok(page.evaluate("__bs.mode") == 'play' and not page.evaluate(D)['engaged'], f'{enc}: free play goes on')
    # an outcome reaches whoever asked (the story's side of the API)
    page.evaluate("window.__out = null; __bs.combat.startEncounter('hunt.first', { story: { poisoned: true } }).then((o) => { window.__out = o; }); 0"); step(page, 1)
    page.evaluate("__bs.combat.leaveEncounter()")
    for i in range(60):
        step(page, 0.2); time.sleep(0.1)
        if page.evaluate("!!window.__out"): break
    o = page.evaluate("window.__out")
    ok(o and o['id'] == 'hunt.first' and o['result'] == 'spared' and o['flags'].get('hunt.spared') is True, 'API: startEncounter resolves with the outcome and its flags', o)
    page.evaluate("window.__t = null; __bs.combat.tension({ kind: 'quick' }).then((r) => { window.__t = r; }); 0")
    for i in range(60):
        step(page, 0.2); time.sleep(0.05)
        if page.evaluate("!!window.__t"): break
    ok(page.evaluate("window.__t && window.__t.passed === false"), 'API: a tension moment resolves (failed, nobody pressed)', page.evaluate("JSON.stringify({ t: window.__t, open: __bs.combat.tensionUi.open, ring: __bs.combat.tensionUi.cur && __bs.combat.tensionUi.cur.T.ring, endT: __bs.combat.tensionUi.cur && __bs.combat.tensionUi.cur.endT, vis: document.visibilityState })"))
    # the Action menu from pause
    page.keyboard.press('Escape'); page.wait_for_selector('#p-action', timeout=10000); page.click('#p-action')
    ok(page.evaluate("document.querySelectorAll('[data-enc]').length") == 5, 'menu: Action lists the five set pieces')
    page.click('[data-cb="difficulty"] [data-v="story"]')
    ok(page.evaluate("JSON.parse(localStorage.getItem('bs-settings-v1')).combat.difficulty") == 'story', 'menu: difficulty is saved')
    for lang in ['hi', 'ur']:
        page.evaluate(f"__bs.setLang('{lang}')")
    shot(page, 'menu')
    ok(not errs, 'no page errors', errs[:3])
    page.context.close()
    # ---- a phone: the buttons
    page, errs = boot(b, 'mobile', mobile=True)
    page.evaluate("__bs.combat.trial('arena')"); time.sleep(0.3); step(page, 1.0)
    page.touchscreen.tap(300, 150); time.sleep(0.5); step(page, 0.2); time.sleep(0.5)
    sizes = page.evaluate("[...document.querySelectorAll('#cb-touch button')].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return [b.className, Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)]; })")
    ok(len(sizes) >= 5, 'phone: the fight buttons are on the screen', sizes)
    ok(all(w >= 48 and h >= 48 for _, w, h, _, _ in sizes), 'phone: every button is at least 48 px', sizes)
    def overlap(p, q): return not (p[3] + p[1] <= q[3] or q[3] + q[1] <= p[3] or p[4] + p[2] <= q[4] or q[4] + q[2] <= p[4])
    ok(not any(overlap(p, q) for i, p in enumerate(sizes) for q in sizes[i + 1:]), 'phone: no two buttons overlap', sizes)
    act = page.evaluate("(() => { const r = document.getElementById('tb-act').getBoundingClientRect(); return ['act', Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)]; })()")
    ok(not any(overlap(act, q) for q in sizes), 'phone: none sits on the game\'s own button', [act, sizes])
    b0 = page.evaluate("document.querySelector('#cb-touch .atk').getBoundingClientRect().toJSON()")
    page.touchscreen.tap(b0['x'] + b0['width'] / 2, b0['y'] + b0['height'] / 2); step(page, 0.12)
    ok(page.evaluate(D)['player']['act'] != 'idle', 'phone: the attack button attacks', page.evaluate(D)['player']['act'])
    shot(page, 'phone_arena')
    time.sleep(1); calls = page.evaluate("__bs.perf.calls")
    print('phone arena draw calls', calls)
    ok(not errs, 'phone: no page errors', errs[:3])
    b.close()
print(f"\ncombat play test: {len(fails)} failed")
sys.exit(1 if fails else 0)
