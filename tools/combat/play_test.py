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
    for enc in ['arena', 'hunt.first', 'night.defence', 'chase.escape', 'stealth.pass', 'fish.spear']:
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
            # every weapon held in the hand, through blows, a block and a throw where it has one: the drawn shaft
            # never inside the body, the left hand on a spear's shaft (view/melee.ts; numbers from the real skeleton)
            for wpn in ['spear', 'club', 'throwstick', 'torch', 'handaxe', 'rock']:
                for i in range(16):
                    if page.evaluate(D)['player']['weapon'] == wpn: break
                    page.evaluate("__bs.combat.testTap('KeyR')"); step(page, 0.1)
                if page.evaluate(D)['player']['weapon'] != wpn: continue
                page.evaluate("__bs.combat.testPoseStats(true)")
                # (held a moment first: a rock or a stick is thrown on the first click and is then out of the hand, so the
                # frames measured with it were 7 to 18 by chance of the step; the gate needs more than 10)
                step(page, 0.8)
                for i in range(3): page.evaluate("__bs.combat.testTap('Mouse0')"); step(page, 0.7)
                page.evaluate("__bs.combat.testHold('KeyQ', true)"); step(page, 0.6); page.evaluate("__bs.combat.testHold('KeyQ', false)"); step(page, 0.5)
                ps = page.evaluate("__bs.combat.testPoseStats(true)")
                # what is drawn each frame: the arms are solved again on the bones after the character has posed them
                # (view/body.ts fixArms), so the hands land on the weapon whatever the step; the shaft against the body's
                # shapes as fitted to this model's own skin
                print(f'pose {wpn}', json.dumps(ps), flush=True)
                ok(ps['frames'] > 10 and ps['shaftIn'] <= 0.01, f'arena: the {wpn} stays out of the body (within 1 cm) through blows and a block', json.dumps(ps))
                # (the weapon rides on the right hand, so that hand is on it by construction; this is how far the grip is
                # from where the pose put it: a low carry grip at the edge of a walking arm's reach misses by up to 3 cm)
                ok(ps['handOff'] <= 0.04, f'arena: the {wpn} is where the pose put it (within 4 cm)', json.dumps(ps))
                if wpn == 'spear': ok(ps['leftOff'] <= 0.02, 'arena: the left hand stays on the spear shaft (within 2 cm)', json.dumps(ps))
            # the bow, the sling and the spear-thrower: aimed, drawn or whirled, let go and made ready again, the arms out
            # of the body (view/ranged.ts, the same elbow swing as the melee rig)
            for wpn in ['bow', 'sling', 'atlatl']:
                for i in range(16):
                    if page.evaluate(D)['player']['weapon'] == wpn: break
                    page.evaluate("__bs.combat.testTap('KeyR')"); step(page, 0.1)
                if page.evaluate(D)['player']['weapon'] != wpn: continue
                page.evaluate("__bs.combat.testPoseStats(true)")
                for i in range(2):
                    page.evaluate("__bs.combat.testHold('Mouse2', true); __bs.combat.testHold('Mouse0', true)"); step(page, 1.0)
                    page.evaluate("__bs.combat.testHold('Mouse0', false)"); step(page, 1.2)
                page.evaluate("__bs.combat.testHold('Mouse2', false)"); step(page, 0.3)
                ps = page.evaluate("__bs.combat.testPoseStats(true)")
                print(f'pose {wpn}', json.dumps(ps), flush=True)
                # the arms as drawn (re-solved on the bones after the character posed them, view/ranged.ts fixArms),
                # against the body's shapes turned with the chest (a side-on archer, a wound-up sling)
                print(f'  {wpn}: arm depth in the body shapes {ps["rangedArmIn"] * 100:.1f} cm at {ps.get("rangedWhere")} (solve {ps.get("rangedSolveIn", 0) * 100:.1f})', flush=True)
                ok(ps['rangedArmIn'] <= 0.02, f'arena: with the {wpn} the arms stay out of the body (within 2 cm)', json.dumps(ps))
            # wake the guardian and let it work
            g = [e for e in page.evaluate(D)['enemies'] if e['kind'] == 'guardian'][0]
            # (the ranged section can leave him down: no wake while down (ai.ts), and the arena's revive after 2.5 s came
            # inside the 6 s some runs and not others. Wait for the revive first)
            for _ in range(40):
                if not page.evaluate(D)['player']['down']: break
                step(page, 0.1)
            page.evaluate(f"__bs.teleport({g['x']} - 3, {g['z']})"); step(page, 0.2)
            # (it failed twice, dormant after 6 s: the wake is inside 4.5 m and not while down, so print where the body
            # really is a moment after the teleport and at the end, and whether it is down)
            d0 = page.evaluate(D); pl0 = d0['player']
            print(f"  guardian wake: guardian {g['x']:.1f},{g['z']:.1f}; 0.2 s after the teleport the body at {pl0['x']:.1f},{pl0['z']:.1f} (d {((pl0['x'] - g['x']) ** 2 + (pl0['z'] - g['z']) ** 2) ** 0.5:.2f}) down {pl0['down']} act {pl0['act']} hp {pl0['hp']}", flush=True)
            step(page, 5.8)
            d1 = page.evaluate(D); pl1 = d1['player']
            g2 = [e for e in d1['enemies'] if e['kind'] == 'guardian'][0]
            why = f"{g2['state']}; body at {pl1['x']:.1f},{pl1['z']:.1f} d {((pl1['x'] - g2['x']) ** 2 + (pl1['z'] - g2['z']) ** 2) ** 0.5:.2f} down {pl1['down']} act {pl1['act']}"
            ok(g2['state'] != 'dormant', 'arena: come close and the guardian wakes', why)
            ok(page.evaluate("document.querySelector('#cb-hud .boss').classList.contains('on')"), 'arena: its bar is on the screen')
            shot(page, 'arena_guardian')
            # what the fight itself adds: the same view, the same frame state, with and without its draws
            WORST = "new Promise((r) => { let m = 0, n = 0; const f = () => { m = Math.max(m, __bs.perf.calls); if (++n < 20) requestAnimationFrame(f); else r(m); }; f(); setTimeout(() => r(Math.max(m, __bs.perf.calls)), 20000); })"
            page.evaluate("__bs.combat.testHideDraws(true)"); time.sleep(0.5); base_calls = page.evaluate(WORST)
            page.evaluate("__bs.combat.testHideDraws(false)"); time.sleep(0.5); calls = page.evaluate(WORST)
            ok(calls - base_calls < BUDGET[a.quality], f'arena: a full fight adds {calls - base_calls} draw calls (budget {BUDGET[a.quality]})', f'{base_calls} -> {calls}')
            print('arena draw calls without and with the fight', base_calls, calls, flush=True)
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
        elif enc == 'fish.spear':
            shot(page, 'fish')
            ok(sum(1 for e in d['enemies'] if e['kind'] == 'darter') >= 3, 'fish: darters hold in the shallows in front of the bank')
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
    page.evaluate("window.__out = null; __bs.combat.startEncounter('hunt.first', { story: { poisoned: true } }).then((o) => { window.__out = o; }); 0"); step(page, 0.3)
    # (the first fight the story starts asks how hard fights should be: answered here, checked in the story section)
    page.evaluate("(() => { const b = document.querySelector('[data-diff=\"normal\"]'); b && b.click(); return 1; })()"); step(page, 1)
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
    # (clicked in the page, as the difficulty below: Playwright's click waits for "stable" and the pause menu's fade under
    # the software renderer kept it unstable for tens of seconds now and then; perf agent 26's note)
    page.keyboard.press('Escape'); time.sleep(0.5)
    if not page.evaluate("!!(window.__bs && __bs.paused)"): page.keyboard.press('Escape')
    page.wait_for_selector('#p-action', state='attached', timeout=10000)
    page.evaluate("document.getElementById('p-action').click()")
    page.wait_for_selector('[data-enc]', state='attached', timeout=10000)
    ok(page.evaluate("document.querySelectorAll('[data-enc]').length") == 6, 'menu: Action lists the six set pieces')
    # (the button clicked in the page: Playwright's own click waits for the menu to be "stable" under the software renderer
    # and timed out at 30 s in about one CI run in three; what is checked here is that the choice is saved)
    page.wait_for_selector('[data-cb="difficulty"] [data-v="story"]', state='attached', timeout=30000)
    page.evaluate("""document.querySelector('[data-cb="difficulty"] [data-v="story"]').click()""")
    ok(page.evaluate("JSON.parse(localStorage.getItem('bs-settings-v1')).combat.difficulty") == 'story', 'menu: difficulty is saved')
    for lang in ['hi', 'ur']:
        page.evaluate(f"__bs.setLang('{lang}')")
    shot(page, 'menu')
    ok(not errs, 'no page errors', errs[:3])
    page.context.close()
    # ---- the story's own night: started by the level, not the menu or the address (src/game/fights.ts)
    page, errs = boot(b, a.quality)
    page.evaluate("""(() => { const s = __bs.save; s.level = 7; s.flags.spear = true; s.flags.fire = true; s.flags.shelter = true; s.flags.houndGone = false;
      s.flags.slept = false; s.timeOfDay = 20.2; })()""")
    for i in range(80):
        if page.evaluate("!document.getElementById('modal').classList.contains('hidden') && !!document.querySelector('[data-diff]') || !!(__bs.combat.run)"): break
        step(page, 0.5); time.sleep(0.1)
    ok(page.evaluate("!document.getElementById('modal').classList.contains('hidden') && !!document.querySelector('[data-diff]') && !__bs.combat.run"), 'story: the first story fight asks how hard fights should be (at the start of the night, before any of it)')
    # the question holds the game still on real frames (the main loop, not the test's step): the clock does not move
    h0 = page.evaluate("__bs.save.timeOfDay"); time.sleep(2.5); h1 = page.evaluate("__bs.save.timeOfDay")
    ok(abs(h1 - h0) < 1e-6, 'story: the world waits while the difficulty question is open', [h0, h1])
    # a second caller while it is open waits for the same answer: one modal, one answer closes it, both go on
    page.evaluate("window.__q2 = 0; __bs.combat.ensureAsked(() => { window.__q2 = 1; }); 1")
    ok(page.evaluate("document.querySelectorAll('#modal [data-diff]').length") == 3 and page.evaluate("window.__q2") == 0, 'story: asking again while the question is open opens nothing new')
    page.evaluate("""document.querySelector('#modal [data-diff="normal"]').click()"""); step(page, 0.5); time.sleep(0.4)  # (the modal hides 130 ms after it is closed)
    ok(page.evaluate("document.getElementById('modal').classList.contains('hidden') && window.__q2 === 1"), 'story: one answer closes it and every caller goes on')
    # then the night's own scene (night.ts FirstNight): noises beyond the light and the choice; brace is the fight at the fire
    for i in range(60):
        if page.evaluate("!!document.querySelector('#dlg-choices button[data-c=\"e1.night.o.brace\"]') && __bs.branch.open"): break
        step(page, 0.25); time.sleep(0.1)
    ok(page.evaluate("!!document.querySelector('#dlg-choices button[data-c=\"e1.night.o.brace\"]') && __bs.branch.open"), 'story: the night asks hide, brace or run', page.evaluate("[__bs.mode, __bs.branch.open, __bs.save.flags['e1.night']]"))
    page.evaluate("document.querySelector('#dlg-choices button[data-c=\"e1.night.o.brace\"]').click()")
    for i in range(40):
        if page.evaluate("!!(__bs.combat && __bs.combat.run)"): break
        step(page, 0.25); time.sleep(0.1)
    d = page.evaluate(D)
    ok(d['encounter'] == 'night.defence', 'story: level 7 at night, braced, starts the night at the fire by itself', d['encounter'])
    ok(page.evaluate("JSON.parse(localStorage.getItem('bs-settings-v1')).combat.asked") is True, 'story: the answer is kept (asked once)')
    for i in range(12):
        step(page, 0.25); time.sleep(0.1)
        if page.evaluate("!!__bs.combat.teaching"): break
    tw = page.evaluate("__bs.combat.teaching")
    if not tw: print('teaching', page.evaluate("JSON.stringify({hints: __bs.save.combat && __bs.save.combat.hints, d: __bs.combat.debug().player, eng: __bs.combat.engaged})"), flush=True)
    ok(bool(tw) and tw['w'] == 'spear' and '<kbd>' in tw['html'], 'story: the spear in the hand for the first time shows its controls (keys)', tw)
    ok(page.evaluate("document.querySelector('#cb-hud .teach').classList.contains('on')"), 'story: the controls card is on the screen')
    shot(page, 'story_night_teach')
    inv0 = page.evaluate("JSON.stringify(__bs.save.inventory)")
    # spend the bag, then save in the middle of the fight: the save keeps the moment before it began
    page.evaluate("__bs.save.inventory.branch = 0; __bs.save.stats.health = 40"); step(page, 0.2)
    page.evaluate("window.dispatchEvent(new Event('beforeunload'))"); time.sleep(0.3)
    sv = page.evaluate("JSON.parse(localStorage.getItem('bs-save-v1'))")
    ok(json.dumps(sv['inventory'], sort_keys=True) == json.dumps(json.loads(inv0), sort_keys=True) and sv['timeOfDay'] < 21 and not sv['flags'].get('e1.night'),
       'story: a save in the middle of the fight is the moment before it', [sv['inventory'], sv['timeOfDay'], sv['flags'].get('e1.night')])
    # go down: the fight offers to try again
    page.evaluate("__bs.combat.activeSim.player.down = true"); step(page, 3.0); time.sleep(0.3); step(page, 2.0)
    ok(page.evaluate("!document.getElementById('modal').classList.contains('hidden') && !!document.getElementById('cb-retry')"), 'story: a lost fight offers to try again from its start')
    ok(page.evaluate("!!document.getElementById('cb-easier') && !!document.getElementById('cb-goon')"), 'story: and easier, or go on as it is')
    shot(page, 'story_night_lost')
    page.evaluate("document.getElementById('cb-retry').click()"); step(page, 0.5)
    d = page.evaluate(D)
    ok(d['encounter'] == 'night.defence' and d['phase'] == 'prep' and not d['player']['down'], 'story: trying again starts the night over', [d['encounter'], d['phase']])
    ok(page.evaluate("JSON.stringify(__bs.save.inventory)") == inv0 and page.evaluate("__bs.save.level") == 7, 'story: trying again gives the bag back and keeps the story where it was')
    # load the save made in the middle of the night: the night comes again by itself
    page.evaluate("window.dispatchEvent(new Event('beforeunload'))"); time.sleep(0.3)
    page.reload(timeout=180000, wait_until='commit'); page.wait_for_function("window.__bs && __bs.state === 'title' && __bs.ready", timeout=600000)
    page.wait_for_function("(() => { const b = document.getElementById('btn-continue'); return b && !b.classList.contains('hidden'); })()", timeout=60000)
    page.evaluate("document.getElementById('btn-continue').click()")
    for i in range(240):
        if page.evaluate("!!(__bs.combat && __bs.combat.run)"): break
        st = page.evaluate("[__bs.state, __bs.mode, !!__bs.save]")
        if st[0] == 'game' and st[2]:
            if st[1] != 'play': page.evaluate('__bs.skip()')
            step(page, 0.5)
        elif st[0] not in ('title', 'loading'): page.evaluate('__bs.skip()')
        time.sleep(0.25)
    ok(page.evaluate("__bs.combat.run && __bs.combat.run.id") == 'night.defence', 'story: loading a save from the middle of the night meets the night again')
    ok(not page.evaluate("__bs.branch.open"), 'story: the reloaded night does not ask its question again')
    # leave the fight: his line after the night (a short scene), then the level goes on
    page.evaluate("__bs.combat.leaveEncounter()")
    for i in range(40):
        step(page, 0.5); time.sleep(0.15)
        if page.evaluate("!__bs.combat.run && !!__bs.save.flags.houndGone"): break
    ok(page.evaluate("!__bs.combat.run && __bs.save.flags.houndGone"), 'story: the night over, the level goes on (sleep)', page.evaluate("[!!__bs.combat.run, __bs.save.flags.houndGone]"))
    ok(not errs, 'story: no page errors', errs[:3])
    page.context.close()
    # ---- a phone: the buttons
    page, errs = boot(b, 'mobile', mobile=True)
    page.evaluate("__bs.combat.trial('arena')"); time.sleep(0.3); step(page, 1.0)
    # a finger on the world itself (the 3D view): the start banner and the toasts sit over the middle of the screen
    # for a few seconds, and a tap that lands on one of them may not count as a finger on the view
    pt = page.evaluate("""(() => { const c = document.querySelector('canvas'); for (const [x, y] of [[300, 150], [420, 300], [200, 320], [600, 250], [120, 200]]) { const e = document.elementFromPoint(x, y); if (e === c) return [x, y]; } return [420, 300]; })()""")
    page.touchscreen.tap(pt[0], pt[1]); time.sleep(0.5); step(page, 0.2); time.sleep(0.5)
    for i in range(10):
        if page.evaluate("[...document.querySelectorAll('#cb-touch button')].filter((b) => b.offsetParent).length") >= 5: break
        step(page, 0.2); time.sleep(0.3)
    print('phone: after the tap', page.evaluate("({device: __bs.combat.device, free: __bs.combat.debug().engaged, touch: document.getElementById('cb-touch').className, paused: __bs.paused, modal: !document.getElementById('modal').classList.contains('hidden')})"), flush=True)
    tw = page.evaluate("__bs.combat.teaching")
    ok(bool(tw) and '<svg' in tw['html'], 'phone: a weapon\'s first controls card shows the touch buttons', tw)
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
