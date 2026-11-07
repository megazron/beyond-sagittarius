#!/usr/bin/env python3
"""The film's lens effects per frame, for tools/film/grade.py. Fast: nothing but numbers.
  python tools/film/dump_fx.py out.json"""
import json, pathlib, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from smoke import launch, serve  # noqa: E402
out = pathlib.Path(sys.argv[1]).expanduser(); BEAT = .375; FPS = 24; res = {}
httpd = serve(4188)
with sync_playwright() as pw:
    b = launch(pw); page = b.new_page(viewport={'width': 64, 'height': 36})
    page.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', sensitivity: 1, invertY: false, volume: 0, subtitles: false, showFps: false}))")
    page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page.goto('http://127.0.0.1:4188/index.html?quality=mobile', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function("window.__bs && window.__bs.ready", timeout=300000)
    page.evaluate('__bs.hold(true)'); page.evaluate('__bs.film.start()'); time.sleep(1)
    for f in range(int(132 * BEAT * FPS)):
        n = page.evaluate('__bs.frames')
        page.evaluate(f'__bs.film.seek({f / FPS / BEAT}); __bs.advance(1 / 240)')
        page.wait_for_function(f'__bs.frames > {n}', timeout=120000)
        fx = page.evaluate('(() => { const f = __bs.film.fx; const c = (x) => x ? [x.r, x.g, x.b] : undefined; return { ...f, dark: c(f.dark), light: c(f.light) }; })()')
        res[f] = {k: v for k, v in fx.items() if v is not None}
    b.close()
httpd.shutdown(); out.write_text(json.dumps(res)); print('fx frames', len(res))
