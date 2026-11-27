#!/usr/bin/env python3
"""A first-time player's opening: a fresh profile (nothing stored), the safety card, New Game, Begin, then MegaZroN's
scene in the Vault played to its end with no Skip. Every line must be said in order, the picture must be on screen
(not black) and moving (not frozen) the whole time, nothing may go to the console as an error, no file may fail to
load, and the scene must hand over to the title card and then the playable city.
  python tools/intro_smoke.py [--quality web] [--port 4199] [--shots DIR]"""
import argparse, base64, json, pathlib, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from smoke import launch, serve  # noqa: E402

ap = argparse.ArgumentParser(); ap.add_argument('--quality', default='web'); ap.add_argument('--port', type=int, default=4199); ap.add_argument('--shots', default='')
a = ap.parse_args(); fails = []; errors = []
serve(a.port)
shots = pathlib.Path(a.shots) if a.shots else None
if shots: shots.mkdir(parents=True, exist_ok=True)

# what the player sees (page screenshot: the fade, the subtitles and the 3D view together), as a 32x18 grey grid
GRID = """async (b64) => { const im = new Image(); im.src = 'data:image/jpeg;base64,' + b64; await im.decode();
  const c = document.createElement('canvas'); c.width = 32; c.height = 18; const g = c.getContext('2d'); g.drawImage(im, 0, 0, 32, 18);
  const d = g.getImageData(0, 0, 32, 18).data, out = []; for (let i = 0; i < d.length; i += 4) out.push(Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]));
  return out; }"""

with sync_playwright() as pw:
    b = launch(pw)
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    page = ctx.new_page(); page.set_default_timeout(180000)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {str(e)[:200]}'))
    page.on('console', lambda m: errors.append(f'console.error: {m.text[:200]}') if m.type == 'error' else None)
    page.on('requestfailed', lambda r: errors.append(f'failed: {r.url[-90:]} {r.failure}') if 'favicon' not in r.url else None)
    page.on('response', lambda r: errors.append(f'http {r.status}: {r.url[-90:]}') if r.status >= 400 and 'favicon' not in r.url else None)
    # was the title card still up when the city began under it (not gone on a timer, leaving a black screen)?
    page.add_init_script("window.__cardAtGame = null; setInterval(() => { if (window.__cardAtGame === null && window.__bs && window.__bs.state === 'game') window.__cardAtGame = !!document.querySelector('#title-card'); }, 30);")
    page.add_init_script("window.__cards = []; new MutationObserver(() => { const c = document.querySelector('#title-card'); if (c && c.textContent && window.__cards[window.__cards.length - 1] !== c.textContent) window.__cards.push(c.textContent); }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true })")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={a.quality}', wait_until='domcontentloaded', timeout=180000)
    page.wait_for_function('window.__bs && window.__bs.ready', timeout=400000)
    if page.evaluate('localStorage.length') != 0: fails.append('the profile was not fresh')
    # a first launch shows the safety card; the player accepts it like anyone would
    if page.locator('#sf-ok').is_visible(): page.click('#sf-ok')
    else: fails.append('no safety card on a fresh profile')
    page.click('#btn-new')
    page.wait_for_selector('#nm-ok', timeout=60000); page.click('#nm-ok')
    t_new = time.time()
    try:
        page.wait_for_function("window.__bs.state === 'narrator' && window.__bs.vault.playing", timeout=60000)
    except Exception:
        fails.append(f"New Game did not open MegaZroN's scene (state {page.evaluate('__bs.state')})")
    script = page.evaluate('__bs.vaultScript') or []
    print(f'narrator opened after {time.time() - t_new:.1f}s; {len(script)} lines', flush=True)
    samples, t0 = [], time.time()
    # the scene itself: from the black before it starts until its last beat (after it the state stays 'narrator' under the
    # title card and the city's loading, where a screenshot can wait out a long build on software GL)
    while page.evaluate("window.__bs.state === 'narrator' && (window.__bs.vault.playing || window.__bs.vault.line < 0)") and time.time() - t0 < 400:
        st = page.evaluate("({ line: __bs.vault.line, playing: __bs.vault.playing, fade: +(document.getElementById('fade').style.opacity || 0) })")
        try: jpg = page.screenshot(type='jpeg', quality=60, timeout=60000)
        except Exception: continue
        grid = page.evaluate(GRID, base64.b64encode(jpg).decode())
        samples.append({'t': round(time.time() - t0, 1), 'line': st['line'] if st['playing'] else -1, 'mean': sum(grid) / len(grid), 'grid': grid, 'fade': st['fade']})
        if shots and len(samples) % 4 == 1: (shots / f'intro_{len(samples):03d}.jpg').write_bytes(jpg)
        time.sleep(0.8)
    took = time.time() - t0
    said = page.evaluate('__bs.vault.said')
    print(f'narrator played {took:.1f}s, {len(samples)} looks, said {said}', flush=True)
    if time.time() - t0 >= 400: fails.append('the narrator scene never ended by itself')
    if not script or said != script: fails.append(f'lines out of order or missing: said {said}, script {script}')
    # on screen: the scene's middle (past the fade in, before the fade out) is never black, and never frozen
    # (the first beat is the fade in from black)
    mid = [s for s in samples if 1 <= s['line'] and s['fade'] < 0.5]
    dark = [s for s in mid if s['mean'] < 6]
    if len(mid) < 3: fails.append(f'the scene was on screen for only {len(mid)} looks')
    if dark: fails.append(f'black frames inside the scene at {[s["t"] for s in dark][:8]}')
    still = 0
    for p, q in zip(mid, mid[1:]):
        diff = sum(abs(x - y) for x, y in zip(p['grid'], q['grid'])) / len(p['grid'])
        still = still + 1 if diff < 0.4 else 0
        if still >= 4: fails.append(f'the picture froze around {q["t"]}s'); break
    means = [round(s['mean']) for s in mid]
    print('brightness through the scene', means, flush=True)
    cuts = page.evaluate('__bs.voice.cuts')
    if any(c['cut'].startswith('mz.intro') for c in cuts): fails.append(f'a narrator line was cut off: {cuts}')
    # then the title card and the playable city
    try:
        page.wait_for_function("window.__cards.length > 0", timeout=60000)
        print('title card', page.evaluate('window.__cards'), flush=True)
    except Exception:
        fails.append('no title card after the narrator')
    try:
        page.wait_for_function("window.__bs.mode === 'away' && window.__bs.away && window.__bs.away.who", timeout=400000)
        print('reached the city', page.evaluate('__bs.away.who'), flush=True)
        # the lens is the scene's own: the Vault's depth of field must not ride into the city (it did: its last beat kept
        # setting it after the scene had ended, and the whole city and the take-off were out of focus on the GPU)
        time.sleep(1.5)
        lens = page.evaluate("(() => { const i = __bs.rnd.stageInfo(); return { focus: i.focus, aperture: i.aperture, dof: !!__bs.rnd.dof }; })()")
        print('lens in the city:', lens, flush=True)
        held = page.evaluate('window.__cardAtGame')
        print('title card still up as the city began:', held, flush=True)
        if held is not True: fails.append('the title card was gone before the city began (a black screen with nothing on it while the city loads)')
        if lens['aperture'] > 0: fails.append(f'the city is drawn through a lens left on by the scene before it: {lens}')
        if shots: page.screenshot(path=str(shots / 'intro_city.jpg'), type='jpeg', quality=70)
    except Exception:
        fails.append(f"the narrator did not hand over to the city (state {page.evaluate('__bs.state')}, mode {page.evaluate('__bs.mode')})")
    page.close(); b.close()
fails += errors[:12]
print(('FAILED ' + '; '.join(fails)) if fails else 'OK: fresh profile, New Game, MegaZroN played to the end on screen and moving, every line in order, no console errors or missing files, the title card, the city')
sys.exit(1 if fails else 0)
