"""Walk into the city's walkers with the keys (not a teleport) and log, every step, the body budget, who is wanted and
pinned, the lens and each held walker's body. The owner: "pedestrians change when touched or bumped". Used by soak_smoke
(the gate) and on its own: python tools/bump_probe.py --url 'http://127.0.0.1:PORT/index.html?quality=web' [--log f]."""
import json, math, time

REACH = 4.5  # metres: anyone a body this close to you is being bumped (city.ts CONTACT)
STATE = "(()=>{const c=__bs.awayCrowd(),p=__bs.awayCam;return {c,p:p?[p.x,p.z]:null}})()"


def _where(st, kind):
    """{id: (x, z)} of every walker the test may aim at: bodies, and on the old town's street the painted cards too."""
    w = {k: (v[2], v[3]) for k, v in _walkers(st, kind).items()}
    if kind == 'crowd':
        for r in st['c'].get('dbg', {}).get('nearCards', []): w.setdefault(r[0], (r[1], r[2]))
    return w


def _walkers(st, kind):
    """{id: (body, look, x, z)} of whoever walks as a body: 'crowd' the old town's painted crowd, 'peds' the districts'."""
    rows = st['c'].get('held', []) if kind == 'crowd' else st['c'].get('dbg', {}).get('peds', [])
    return {r[0]: (r[1], r[2], r[4], r[5]) for r in rows}


def bump(page, at, kind='crowd', rounds=4, log=None, say=print):
    """Bump `rounds` walkers near `at` (x, z). Each round: one teleport to 5 m from the nearest untested body, 2 s to
    settle, then W held and the body turned at them each step, through them and 1.5 m past. A swap is any walker who
    was a body within 4.5 m of the player becoming a card or another body. Returns a list of failures."""
    fails = []; reached = 0
    spots = [at] if isinstance(at[0], (int, float)) else list(at)
    for sp in spots:  # the first spot where somebody walks as a body (the bodies load on first sight)
        page.evaluate(f"__bs.awayTeleport({sp[0]}, {sp[1]}, 0)")
        for _ in range(45):
            time.sleep(1); page.evaluate('__bs.step(0.1)')
            if len(_walkers(page.evaluate(STATE), kind)) >= 2: break
        st = page.evaluate(STATE)
        if _walkers(st, kind): break
        c = st['c']; say(f'{kind}: no body at {sp}: near {c.get("near")} room {c.get("room")} dbg {json.dumps(c.get("dbg", {}))[:300]}')
    tested = set()
    for rnd in range(rounds):
        st = page.evaluate(STATE); w = _walkers(st, kind); p = st['p']; wh = _where(st, kind)
        # a body first, nearest first; a painted card if nobody near is a body
        cur = sorted((k for k in wh if k not in tested), key=lambda k: (k not in w, math.hypot(wh[k][0] - p[0], wh[k][1] - p[1])))
        if not cur: say(f'{kind} round {rnd}: nobody left to bump'); break
        tgt = cur[0]; tested.add(tgt); x, z = wh[tgt]
        # start 5 m off, across their path (they walk along z): from the side the street is wider on
        sx = x + (5 if x < 0 else -5)
        page.evaluate(f"__bs.awayTeleport({sx:.2f}, {z:.2f}, {math.atan2(-(x - sx), 0):.3f})")
        time.sleep(2.0)
        st = page.evaluate(STATE); w = _walkers(st, kind)
        if tgt not in _where(st, kind): say(f'{kind} round {rnd}: walker {tgt} out of sight after the teleport'); continue
        ref = {k: v[:2] for k, v in w.items()}  # who is whom once settled
        body, look = ref.get(tgt, ('card', '-'))
        hit, passed, t0, closest, last_near, last_d, flat = None, None, time.time(), 99.0, set(), 99.0, 0
        page.evaluate("__bs.key('KeyW', true)")
        try:
            while time.time() - t0 < 40:
                st = page.evaluate(STATE); w = _walkers(st, kind); p = st['p']
                if log: log.write(json.dumps({'kind': kind, 'round': rnd, 'tgt': tgt, 't': round(time.time() - t0, 2), 'p': p, 'dbg': st['c'].get('dbg'), 'held': st['c'].get('held')}) + '\n')
                # everyone who was a body and is now within reach must still be the same body
                # (further off, a walker going back to a card is the ordinary distance swap, not a bump: logged, not failed)
                for k, (b0, l0) in ref.items():
                    now = w.get(k)
                    if now and k in last_near and (now[0], now[1]) != (b0, l0): hit = (k, 'became body', now[:2]); break
                    if not now and k in last_near: hit = (k, f'became a card within {REACH} m of you', None); break
                    if not now and k == tgt and k in ref: say(f'  walker {tgt} let go {last_d:.1f} m off, before reaching them: {json.dumps(st["c"].get("dbg", {}))[:400]}'); break
                # a painted card you walk into reads as cardboard, and the lens hides it: within 1.2 m nobody is a card
                eb = st['c'].get('dbg', {}).get('elbowCards', 0) if kind == 'crowd' else 0
                flat = flat + 1 if eb else 0
                if flat >= 3 and not hit: hit = ('-', f'{eb} painted card(s) within 1.2 m of you for {flat} steps', None)
                if hit:
                    say(f'  state: {json.dumps(st["c"].get("dbg", {}))[:600]}'); break
                wh = _where(st, kind)
                if tgt not in wh: break
                last_near = {k for k, v in w.items() if math.hypot(v[2] - p[0], v[3] - p[1]) < REACH}
                ref.update({k: v[:2] for k, v in w.items() if k not in ref})
                tx, tz = wh[tgt]; d = math.hypot(tx - p[0], tz - p[1]); closest = min(closest, d); last_d = d
                if passed is None and (d < 0.7 or (closest < 1.6 and d > closest + 0.3)): passed = time.time()
                if passed and time.time() - passed > 1.5: break
                if passed is None: page.evaluate(f"__bs.awayYaw({math.atan2(-(tx - p[0]), -(tz - p[1])):.3f})")
                # the game steps on as well as drawing: on software GL a few frames a second would never get there
                page.evaluate('__bs.step(0.1)'); time.sleep(0.05)
        finally:
            page.evaluate("__bs.key('KeyW', false)")
        say(f'{kind} round {rnd}: walker {tgt} body {body} look {look}, closest {closest:.2f} m -> {"same" if not hit else hit}')
        if closest > 1.6: say(f'  (did not reach them: closest {closest:.2f} m)')
        else: reached += 1
        if hit: fails.append(f'bump test ({kind}): walker {hit[0]} {hit[1]} {hit[2] or ""} while walking into walker {tgt}')
    if not reached: fails.append(f'bump test ({kind}): never got within 1.6 m of a walker drawn as a body (the test did not test)')
    return fails


if __name__ == '__main__':
    import argparse, sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import pw_pin  # noqa: F401
    from playwright.sync_api import sync_playwright
    ap = argparse.ArgumentParser(); ap.add_argument('--url', required=True); ap.add_argument('--log', default='')
    ap.add_argument('--rounds', type=int, default=4); ap.add_argument('--peds', default='175,70')
    a = ap.parse_args()
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = b.new_page(viewport={'width': 960, 'height': 540})
        page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
        page.goto(a.url)
        page.wait_for_function("window.__bs && __bs.state === 'title' && __bs.ready", timeout=600000)
        page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=30000); page.click('#nm-ok')
        for i in range(300):
            if page.evaluate("__bs.mode === 'away' && !!(__bs.away && __bs.away.who)"): break
            if page.evaluate('__bs.state') == 'narrator': page.evaluate('__bs.skip()')
            time.sleep(1)
        lg = open(a.log, 'w') if a.log else None
        f = bump(page, (-5.5, 0), 'crowd', a.rounds, lg)
        if a.peds: f += bump(page, tuple(float(v) for v in a.peds.split(',')), 'peds', a.rounds, lg)
        b.close()
    print(json.dumps({'fails': f}, indent=1))
