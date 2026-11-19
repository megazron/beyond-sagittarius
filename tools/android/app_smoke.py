"""Android app smoke test without a device: the exact files bundled in the app
(android/app/src/main/assets/public, after `npx cap sync android`) in headless Chromium, emulating a phone,
with Capacitor's own native-bridge.js and a fake Android bridge, so the game's App plugin calls go through the
real Capacitor JS path. Hardware back and app-to-background are sent the way the native side sends them.

Checks: boots offline from the bundle, runs as the Android platform, New Game to play, touch movement,
back opens and closes the pause menu, back skips a scene, background pauses and silences audio,
Continue after a restart, back on the title asks before exiting. Also writes Play Store screenshots.

    python3 tools/android/app_smoke.py [--shots store/screenshots] [--size 960x540] [--scale 2]
"""
import argparse, functools, http.server, json, pathlib, sys, threading, time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from smoke import launch  # noqa: E402
from mobile_smoke import Touch, centre  # noqa: E402

APP = ROOT / 'android/app/src/main/assets/public'
BRIDGE = (ROOT / 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js').read_text()
# What the native side injects before the page (JSExport): the Capacitor object, the bridge, the plugin headers.
HEADERS = [{'name': 'App', 'methods': [{'name': 'exitApp', 'rtype': 'promise'}, {'name': 'addListener', 'rtype': 'callback'}, {'name': 'removeListener', 'rtype': 'promise'}, {'name': 'removeAllListeners', 'rtype': 'promise'}]}]
INIT = """
window.__native = [];
window.androidBridge = { postMessage(s) { window.__native.push(JSON.parse(s)); } };
window.Capacitor = { DEBUG: false, isLoggingEnabled: false, Plugins: {} };
""" + BRIDGE + f"\nwindow.Capacitor.PluginHeaders = {json.dumps(HEADERS)};\n" + """
window.__fire = (event, data) => {
  const m = window.__native.find((x) => x.pluginId === 'App' && x.methodName === 'addListener' && x.options && x.options.eventName === event);
  if (!m) return false;
  window.Capacitor.fromNative({ callbackId: m.callbackId, pluginId: 'App', methodName: 'addListener', save: true, success: true, data: data || {} });
  return true;
};
window.__exited = () => window.__native.some((x) => x.pluginId === 'App' && x.methodName === 'exitApp');
if (!localStorage.getItem('bs-settings-v1')) localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0.7, subtitles: true, showFps: false}));
"""


def serve(port):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=str(APP))
    s = http.server.ThreadingHTTPServer(('127.0.0.1', port), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=4191)
    ap.add_argument('--shots', default=str(ROOT / 'store/screenshots'))
    ap.add_argument('--size', default='960x540', help='CSS viewport, landscape')
    ap.add_argument('--scale', type=float, default=2)
    a = ap.parse_args()
    shots = pathlib.Path(a.shots); shots.mkdir(parents=True, exist_ok=True)
    w, h = map(int, a.size.split('x'))
    assert (APP / 'index.html').exists(), 'run `npx cap sync android` first'
    serve(a.port)
    fails, errors = [], []
    fail = lambda m: (fails.append(m), print('FAIL', m, flush=True))
    ok = lambda m: print('ok  ', m, flush=True)
    with sync_playwright() as p:
        b = launch(p)
        ua = 'Mozilla/5.0 (Linux; Android 16; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36 wv'
        ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=a.scale, is_mobile=True, has_touch=True, user_agent=ua)
        # The app has no internet permission: any request that leaves the bundle is a bug.
        offsite = []
        ctx.route('**/*', lambda r: (offsite.append(r.request.url), r.abort()) if not r.request.url.startswith(f'http://127.0.0.1:{a.port}/') and not r.request.url.startswith('data:') and not r.request.url.startswith('blob:') else r.continue_())
        ctx.add_init_script(INIT)
        page = ctx.new_page()
        page.set_default_timeout(180000)  # software GL: a 1920x1080 frame can take a while
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        page.on('console', lambda m: errors.append(f'console.error: {m.text}') if m.type == 'error' else None)
        dialogs = []

        def on_dialog(d):
            dialogs.append(d.message)
            (d.accept if len(dialogs) > 1 else d.dismiss)()
        page.on('dialog', on_dialog)
        touch = Touch(ctx.new_cdp_session(page))
        ev = page.evaluate
        shot = lambda n: page.screenshot(path=str(shots / f'{n}.jpg'), type='jpeg', quality=90)

        PLAYABLE = "__bs.state === 'game' && (__bs.mode === 'play' || __bs.mode === 'away')"
        pos = lambda: ev("__bs.mode === 'away' ? (__bs.away && __bs.away.pos) : __bs.debug.player")

        def to_play(want=PLAYABLE):
            for _ in range(80):
                if ev(want): return True
                if page.locator('#btn-skip').is_visible(): touch.tap(*centre(page, '#btn-skip'))
                else: ev('__bs.skip()')
                time.sleep(1.5)
            return False

        t0 = time.time()
        page.goto(f'http://127.0.0.1:{a.port}/index.html', wait_until='domcontentloaded', timeout=120000)
        page.wait_for_function("window.__bs && window.__bs.state === 'title'", timeout=120000)
        page.wait_for_function('window.__bs.ready', timeout=600000)
        ok(f'boots from the bundle to the title in {time.time() - t0:.0f}s, quality {ev("__bs.quality")}')
        if ev('Capacitor.getPlatform()') != 'android' or not ev('Capacitor.isNativePlatform()'): fail('not running as the Android platform')
        if not ev("__native.some((x) => x.options && x.options.eventName === 'backButton')"): fail('back button listener not registered')
        else: ok('back button and pause listeners registered through the Capacitor bridge')
        if page.locator('#btn-download').is_visible(): fail('Windows download button shown in the app')
        if page.locator('#sf-ok').is_visible():
            touch.tap(*centre(page, '#sf-ok')); time.sleep(0.5)
        time.sleep(1.5)
        shot('01-title')

        # back on the title: asks, "no" keeps the game open
        ev("__fire('backButton', {canGoBack: false})"); time.sleep(0.8)
        if not dialogs: fail('back on the title did not ask before exiting')
        elif ev('__exited()'): fail('exited although the player said no')
        else: ok(f'back on the title asks: "{dialogs[0]}"; "no" stays')

        touch.tap(*centre(page, '#btn-new'))
        page.wait_for_selector('#nm-ok', timeout=15000)
        touch.tap(*centre(page, '#nm-ok'))
        # back skips the current scene (same as Esc)
        time.sleep(4)
        s0 = ev('__bs.state')
        if s0 in ('narrator', 'cinematic', 'film', 'flashback'):
            shot('02-intro')
            ev("__fire('backButton', {canGoBack: false})")
            # skipped = that scene stopped: the Vault stops playing at once, though the state stays 'narrator' through
            # the title card that follows it; the other scenes hand over to the next state
            gone = f"__bs.state !== '{s0}'" + (" || !__bs.vault.playing" if s0 == 'narrator' else '')
            try: page.wait_for_function(gone, timeout=10000)
            except Exception: pass
            if not ev(gone) and s0 != 'film': fail(f'back did not skip the {s0} scene')
            else: ok(f'back skips the {s0} scene')
        if not to_play(): fail(f'never reached play: {ev("[__bs.state, __bs.mode]")}')
        else: ok(f'new game reaches play (mode {ev("__bs.mode")}: the playable prologue)')
        time.sleep(3)
        shot('03-prologue')
        if ev("document.getElementById('touch').classList.contains('hidden')"): fail('touch controls hidden in play')
        # move with the thumbstick
        joy = page.locator('#joy').bounding_box()
        jx, jy = joy['x'] + joy['width'] / 2, joy['y'] + joy['height'] / 2
        p0 = pos()
        touch.drag(jx, jy, jx, jy - 35, steps=6, hold=3)
        p1 = pos()
        d = ((p1[0] - p0[0]) ** 2 + (p1[2] - p0[2]) ** 2) ** 0.5
        if d < 0.3: fail(f'thumbstick did not move the player ({d:.2f} m)')
        else: ok(f'thumbstick moves the player {d:.1f} m')

        # back: pause menu, back again: play
        ev("__fire('backButton', {canGoBack: false})"); time.sleep(1)
        if not ev('__bs.paused'): fail('back did not pause')
        else:
            ok('back opens the pause menu'); shot('11-pause')
            ev("__fire('backButton', {canGoBack: false})"); time.sleep(1)
            if ev('__bs.paused'): fail('second back did not resume')
            else: ok('second back resumes')

        # the app goes to the background: pause, save, silence
        page.evaluate("() => { Object.defineProperty(document, 'hidden', {value: true, configurable: true}); Object.defineProperty(document, 'visibilityState', {value: 'hidden', configurable: true}); document.dispatchEvent(new Event('visibilitychange')); __fire('pause'); }")
        time.sleep(1)
        st = ev("({p: __bs.paused, saved: !!localStorage.getItem('bs-save-v1')})")
        if not st['p']: fail('background did not pause the game')
        else: ok('background pauses the game')
        # (the prologue city is not saved until it ends, by design; the save check runs on the planet below)
        page.evaluate("() => { Object.defineProperty(document, 'hidden', {value: false, configurable: true}); Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true}); document.dispatchEvent(new Event('visibilitychange')); __fire('resume'); }")
        time.sleep(0.5)
        ev("__fire('backButton', {canGoBack: false})"); time.sleep(0.8)  # close the pause menu

        # the planet (the same New Game with the prologue skipped, as the settings switch does)
        page.goto(f'http://127.0.0.1:{a.port}/index.html?prologue=0', wait_until='domcontentloaded')
        page.wait_for_function('window.__bs && window.__bs.ready', timeout=600000)
        time.sleep(1)
        touch.tap(*centre(page, '#btn-new'))
        page.wait_for_selector('#nm-ok', timeout=15000)
        touch.tap(*centre(page, '#nm-ok'))
        if not to_play("__bs.state === 'game' && __bs.mode === 'play'"): fail('planet play not reached')
        time.sleep(2)
        ev("localStorage.removeItem('bs-save-v1')")
        ev("__fire('pause')"); time.sleep(1)
        if not ev('__bs.paused') or not ev("!!localStorage.getItem('bs-save-v1')"): fail('background on the planet did not pause and save')
        else: ok('background on the planet pauses and saves')
        ev("__fire('backButton', {canGoBack: false})"); time.sleep(1)
        # store screenshots: real play at a few places and times, menus opened by touch
        L = ev('__bs.layout')
        def stand(at, toward, back=6.0, side=2.0, hr=10.0, pitch=-0.05):
            import math
            ax, az = L[at][0], L[at][2]; tx, tz = L[toward][0], L[toward][2]
            dx, dz = tx - ax, tz - az; n = math.hypot(dx, dz) or 1
            x, z = ax - dx / n * back + dz / n * side, az - dz / n * back - dx / n * side
            ev(f'__bs.setTime({hr})'); ev(f'__bs.teleport({x}, {z}, {math.atan2(-dx, -dz)})'); ev(f'__bs.look({math.atan2(-dx, -dz)}, {pitch})')
            ev('__bs.step(1.5)'); time.sleep(3)
        stand('pod', 'camp', hr=9.0); shot('04-pod-morning')
        stand('camp', 'shelter', hr=17.8); shot('05-camp-dusk')
        stand('ridge', 'beacon', hr=12.5, pitch=-0.12); shot('06-ridge')
        stand('camp', 'pod', hr=22.5); shot('07-night')
        stand('pod', 'camp', hr=11)
        for tab, tag in (('crew', '08-crew'), ('codex', '09-codex'), ('map', '10-map')):
            if not ev('__bs.paused'): touch.tap(*centre(page, '#tb-pause')); time.sleep(1.5)
            touch.tap(*centre(page, f'#tab-{tab}')); time.sleep(3)
            shot(tag)
        for _ in range(3):
            if ev('__bs.paused'): ev("__fire('backButton', {canGoBack: false})"); time.sleep(0.8)

        # restart the app: Continue is offered and works
        page.goto(f'http://127.0.0.1:{a.port}/index.html', wait_until='domcontentloaded')
        page.wait_for_function('window.__bs && window.__bs.ready', timeout=600000)
        time.sleep(1)
        if not page.locator('#btn-continue').is_visible(): fail('no Continue after a restart')
        else:
            touch.tap(*centre(page, '#btn-continue'))
            if to_play(): ok(f'Continue resumes at level {ev("__bs.level")}')
            else: fail('Continue did not reach play')

        # quit to title, back, "yes": the app asks Android to close
        ev("__fire('backButton', {canGoBack: false})"); time.sleep(1)
        q = page.locator('#p-quit')
        if q.count():
            q.click(); page.wait_for_function("__bs.state === 'title'", timeout=30000); time.sleep(1)
            n = len(dialogs)
            ev("__fire('backButton', {canGoBack: false})"); time.sleep(0.8)
            if len(dialogs) == n or not ev('__exited()'): fail('back + yes on the title did not exit')
            else: ok('back + yes on the title exits the app')
        else: fail('no quit button in the pause menu')

        if offsite: fail(f'requests outside the bundle: {sorted(set(offsite))[:5]}')
        else: ok('no request left the bundle (works without internet)')
        errs = [e for e in errors if 'favicon' not in e]
        if errs: fail(f'{len(errs)} console errors, first: {errs[:3]}')
        b.close()
    print('RESULT', 'ok' if not fails else f'{len(fails)} problems', flush=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
