#!/usr/bin/env python3
"""No keyboard hints on a touch screen: on a phone (touch, mobile viewport) every menu, the pause page, the codex, the
map and the in-game hints show touch icons or nothing, never a key cap ("Enter", "Esc", "WASD") or a key name, in
English, Hindi and Urdu. Also: a key pressed on a phone (a test bot, a paired keyboard) switches the hints to keys, and
the next finger on any menu switches them back.
  python tools/touch_hints.py"""
import argparse, pathlib, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pw_pin  # noqa: E402,F401  (re-runs under the pinned Playwright)
from playwright.sync_api import sync_playwright  # noqa: E402
from smoke import launch, serve  # noqa: E402

ap = argparse.ArgumentParser(); ap.add_argument('--port', type=int, default=4393); a = ap.parse_args()
# every visible key cap, and any visible text that names a key, inside the overlay layers
SCAN = r"""() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; } return true; };
  const out = [];
  for (const k of document.querySelectorAll('kbd, .kc, .pc')) if (vis(k)) out.push('cap: ' + (k.textContent || k.className).trim().slice(0, 30));
  const words = /(^|[^\w])(Esc|Enter|Space|Tab|WASD|Shift|Ctrl)([^\w]|$)/;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walk.nextNode());) { const tx = n.textContent.trim(); if (tx && words.test(tx) && n.parentElement && vis(n.parentElement) && !n.parentElement.closest('#settings-keys, .bind, .remap')) out.push('text: ' + tx.slice(0, 60)); }
  return out;
}"""
fails = []
httpd = serve(a.port)
with sync_playwright() as pw:
    b = launch(pw)
    ctx = b.new_context(viewport={'width': 844, 'height': 390}, is_mobile=True, has_touch=True, device_scale_factor=1)
    ctx.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page = ctx.new_page()
    page.on('pageerror', lambda e: fails.append(f'pageerror: {str(e)[:200]}'))
    page.goto(f'http://127.0.0.1:{a.port}/index.html?prologue=0&quality=mobile', wait_until='domcontentloaded', timeout=180000)
    page.wait_for_function("window.__bs && __bs.state === 'title' && __bs.ready", timeout=600000)

    def check(where):
        got = page.evaluate(SCAN)
        print(f'{where}: {len(got)} key hints', flush=True)
        for g in got[:8]: print('    ', g, flush=True)
        if got: fails.append(f'{where}: {got[:4]}')

    def tap(sel):
        # a real touch at the element's middle (Playwright's own tap waits for the element to be "stable", which the
        # software renderer's slow frames and the menus' fades can hold off for tens of seconds)
        for _ in range(40):
            r = page.evaluate("(s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.width && b.height ? [b.x + b.width / 2, b.y + b.height / 2] : null; }", sel)
            if r: break
            time.sleep(0.5)
        if not r: fails.append(f'{sel}: not on the screen to tap'); return
        page.touchscreen.tap(r[0], r[1]); time.sleep(0.5)

    def close_modal():
        if page.locator('#m-close').count() and page.locator('#m-close').first.is_visible(): tap('#m-close')
        else: page.evaluate("document.querySelector('#modal')?.classList.add('hidden')")
        time.sleep(0.3)

    for lang in ('en', 'hi', 'ur'):
        page.evaluate(f"__bs.setLang('{lang}')")
        check(f'{lang} title')
        for m, sel in (('settings', '#btn-settings'), ('legal', '#btn-legal'), ('chapters', '#btn-chapters')):
            if not page.locator(sel).count() or not page.locator(sel).first.is_visible(): continue
            tap(sel); check(f'{lang} {m}'); close_modal()
    # a key on a phone switches to key hints; the next finger on a menu switches back
    page.evaluate("__bs.setLang('en')")
    page.keyboard.press('Shift')
    if page.evaluate("document.body.classList.contains('touch')"): fails.append('a key press did not switch the hints to keys')
    tap('#btn-settings')
    if not page.evaluate("document.body.classList.contains('touch')"): fails.append('a tap on a menu did not switch the hints back to touch')
    check('en settings after a key and a tap'); close_modal()
    # into the game: the HUD, the tutorial, the pause page and its tabs (map, codex...)
    tap('#btn-new'); page.wait_for_selector('#nm-ok', timeout=30000); tap('#nm-ok')
    for _ in range(200):
        if page.evaluate("__bs.state === 'game' && (__bs.mode === 'play' || __bs.mode === 'away')"): break
        if page.evaluate('__bs.state') == 'narrator': page.evaluate('__bs.skip()')
        time.sleep(1)
    time.sleep(3)
    for lang in ('en', 'hi', 'ur'):
        page.evaluate(f"__bs.setLang('{lang}')"); time.sleep(0.3)
        check(f'{lang} hud')
        tap('#tb-pause'); time.sleep(0.6)
        if not page.evaluate("!document.querySelector('#modal')?.classList.contains('hidden')"):
            fails.append(f'{lang}: the pause page did not open from the touch button'); continue
        check(f'{lang} pause')
        n = page.locator('#modal-card .main-tabs .tab').count()
        for i in range(n):
            name = page.locator('#modal-card .main-tabs .tab').nth(i).get_attribute('data-tab')
            tap(f'#tab-{name}'); time.sleep(0.4)
            check(f'{lang} pause/{name}')
        close_modal()
    b.close()
httpd.shutdown()
print('FAIL' if fails else 'OK', len(fails), flush=True)
for f in fails[:30]: print('  ', f)
sys.exit(1 if fails else 0)
