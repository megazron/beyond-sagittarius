#!/usr/bin/env python3
"""Frame time in the real game: the Zenvora street at the flat and down among the crowd (the prologue, played from a new
game), MegaZroN in the Vault, free play after the wake-up and the camp scene with the whole crew close up. Per scene:
median and 95th-percentile frame time, frame rate, main-thread time in animation-frame callbacks (cpu_ms; on software
GL it includes waiting for the GPU, tools/crowd_cpu.py gives the bodies' own CPU time), and the draw calls and
triangles each frame sends to WebGL (every pass: shadows, the scene, post), which mean the same on any GPU.
  python tools/frame_time.py --soft [--quality web] [--out FILE] [--dist DIR --public DIR] [--url-extra '&prologue=1']
Phones: --quality mobile --size 844x390 --throttle 4 --nodraw is Chrome's mid-range phone model (4x CPU slowdown) with
the draw calls counted but not executed, so cpu_ms is the main thread a phone spends (SwiftShader's own drawing left out).
--profile PREFIX writes a .cpuprofile per scene and prints the top self times; --census prints what the draw calls of
one frame are, by pass and by kind of object.
--soft draws with SwiftShader (WSL's d3d12 GL path ran at about one frame a second here). --dist/--public measure an
older build made without copying public/; builds from before the prologue was the default need --url-extra '&prologue=1'."""
import argparse, json, pathlib, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pw_pin  # noqa: E402,F401  (re-runs under the pinned Playwright)
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import functools, http.server, os, threading  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--dist', default=str(pathlib.Path(__file__).resolve().parent.parent / 'dist'))
ap.add_argument('--quality', default='web'); ap.add_argument('--port', type=int, default=4191)
ap.add_argument('--out', default=''); ap.add_argument('--soft', action='store_true'); ap.add_argument('--secs', type=float, default=6)
ap.add_argument('--only', default='street,cutscene,play'); ap.add_argument('--shots', default='')
ap.add_argument('--url-extra', default='', help='more URL flags (&prologue=1 for builds from before the prologue was the default)');
ap.add_argument('--size', default='960x540'); ap.add_argument('--frames', type=int, default=20, help='at least this many frames')
ap.add_argument('--public', default='', help='serve files missing from --dist from here (a build made without copying public/)')
ap.add_argument('--throttle', type=float, default=0, help='CPU slowdown while measuring (4 = Chrome\'s mid-range phone)')
ap.add_argument('--nodraw', action='store_true', help='count draw calls but do not execute them (CPU time only)')
ap.add_argument('--profile', default='', help='write PREFIX_scene.cpuprofile and print the top self times')
ap.add_argument('--census', action='store_true', help='print one frame\'s draw calls by pass and kind of object')
ap.add_argument('--deep', type=int, default=0, help='census: name this many ancestors (and the geometry type)')
a = ap.parse_args()

class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = super().translate_path(path)
        if a.public and not os.path.exists(p): p = os.path.join(a.public, os.path.relpath(p, a.dist))
        return p
    def log_message(self, *x, **k): pass
h = functools.partial(H, directory=a.dist)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if a.soft else ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu']
GL += ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
MEASURE = """([sec, minN]) => new Promise((res) => { const d = [], cpu = [], calls = [], tris = []; let last = performance.now(); const t0 = last;
  const W = window.__ft; W.on = true;
  function f(t) { d.push(t - last); last = t; cpu.push(W.cpu); calls.push(W.calls); tris.push(W.idx / 3);
    if (t - t0 < sec * 1000 || d.length < minN + 1) requestAnimationFrame(f); else { W.on = false;
    for (const x of [d, cpu, calls, tris]) x.shift();
    const med = (x) => { const s = [...x].sort((p, q) => p - q); return s[s.length >> 1] || 0; };
    const p95 = (x) => { const s = [...x].sort((p, q) => p - q); return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] || 0; };
    res({ median_ms: +med(d).toFixed(2), p95_ms: +p95(d).toFixed(2), fps: +(d.length * 1000 / (t - t0)).toFixed(1), frames: d.length,
      cpu_ms: +med(cpu).toFixed(2), draw_calls: med(calls), triangles_k: +(med(tris) / 1000).toFixed(1),
      passes: Object.fromEntries(Object.entries(W.vpl).filter(([k, v]) => v[1] > 4).map(([k, v]) => [k, [Math.round(v[0] / 1000), v[1]]])) }); } }
  requestAnimationFrame(f); })"""
# per frame: the main thread's time in animation-frame callbacks (the game's update and its draw calls), and every draw
# call and index it sent to WebGL (instanced ones times their instances): what the GPU is asked to do, whatever GPU it is
INIT = """(() => { const W = window.__ft = { cpu: 0, calls: 0, idx: 0, on: false, t: 0 }; const raf = window.requestAnimationFrame.bind(window);
  let pending = 0;
  window.requestAnimationFrame = (cb) => raf((t) => { if (t !== W.t) { if (W.t) { W.cpu = pending; W.calls = W.c; W.idx = W.i; W.vpl = W.vp; } W.t = t; pending = 0; W.c = 0; W.i = 0; W.vp = {}; }
    const a = performance.now(); cb(t); pending += performance.now() - a; });
  W.c = 0; W.i = 0; const P = WebGL2RenderingContext.prototype;
  // triangles and calls per viewport size, which tells the passes apart (the shadow map is square)
  W.vp = {}; W.vpl = {}; const vpo = P.viewport; let vk = '?'; P.viewport = function (...x) { vk = x[2] + 'x' + x[3]; return vpo.apply(this, x); };
  const wrap = (n, f) => { const o = P[n]; P[n] = function (...x) { W.c++; const k = f(x); W.i += k; const e = W.vp[vk] || (W.vp[vk] = [0, 0]); e[0] += k / 3; e[1]++;
    if (window.__nodraw) return; return o.apply(this, x); }; };
  wrap('drawElements', (x) => x[1]); wrap('drawArrays', (x) => x[2]);
  wrap('drawElementsInstanced', (x) => x[1] * x[4]); wrap('drawArraysInstanced', (x) => x[2] * x[3]); wrap('drawRangeElements', (x) => x[3]); })()"""
# one frame's draw calls by pass (shadow or not) and by what is drawn: the nearest named ancestor, or the object's
# userData.perf tag, its kind and its material
CENSUS = """() => new Promise((res) => { const r = __bs.gl; const orig = r.renderBufferDirect; const out = {};
  r.renderBufferDirect = function (cam, scene, geo, mat, obj, grp) {
    let tag = ''; for (let o = obj; o && !tag; o = o.parent) tag = o.userData.perf || '';
    if (!tag) { const ch = [obj.name ? obj.name.slice(0, 16) : window.__deep ? geo.type.replace('Geometry', '') + (window.__deep > 4 && geo.parameters ? '(' + Object.values(geo.parameters).slice(0, 2).map((v) => +(+v).toFixed(2)).join('x') + ')' : '') : '']; for (let o = obj.parent; o && ch.length < (window.__deep || 3); o = o.parent) ch.push(o.isScene ? 'S' : (o.name || o.type).slice(0, 16)); tag = ch.join('<'); }
    const kind = obj.isSkinnedMesh ? 'skin' : obj.isInstancedMesh ? 'inst' : obj.isBatchedMesh ? 'batch' : obj.isSprite ? 'sprite' : obj.isPoints ? 'pts' : obj.isLine ? 'line' : 'mesh';
    const k = (cam.isOrthographicCamera ? 'SHADOW ' : '') + tag + ' ' + kind + ' ' + (mat.name || mat.type).slice(0, 18);
    out[k] = (out[k] || 0) + 1; return orig.apply(this, arguments); };
  requestAnimationFrame(() => requestAnimationFrame(() => { r.renderBufferDirect = orig;
    const by = {}; for (const [k, v] of Object.entries(out)) { const t = k.split(' ').slice(0, k.startsWith('SHADOW') ? 2 : 1).join(' '); by[t] = (by[t] || 0) + v; }
    res({ total: Object.values(out).reduce((x, y) => x + y, 0), by_tag: Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 40),
      top: Object.entries(out).sort((x, y) => y[1] - x[1]).slice(0, 50) }); })); })"""
want = a.only.split(',')
res = {'dist': a.dist, 'quality': a.quality}
with sync_playwright() as pw:
    b = pw.chromium.launch(headless=a.soft, args=GL)
    page = b.new_page(viewport=dict(zip(('width', 'height'), map(int, a.size.split('x')))))
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)[:200]))
    page.on('console', lambda m: errs.append('console: ' + m.text[:300]) if m.type == 'error' else None)
    # a fresh profile, consent given
    page.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
    page.add_init_script(INIT)
    if a.nodraw: page.add_init_script("window.__nodraw = true")
    if a.deep: page.add_init_script(f"window.__deep = {a.deep}")
    page.goto(f'http://127.0.0.1:{a.port}/index.html?quality={a.quality}{a.url_extra}')
    page.wait_for_function("window.__bs && __bs.state === 'title' && __bs.ready", timeout=600000)
    res['gpu'] = page.evaluate("(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)})()")
    page.click('#btn-new'); page.wait_for_selector('#nm-ok', timeout=30000); page.click('#nm-ok')
    def shot(n):
        if not a.shots: return
        pathlib.Path(a.shots).mkdir(parents=True, exist_ok=True)
        try: page.screenshot(path=f'{a.shots}/{a.quality}_{n}.jpg', type='jpeg', quality=70, timeout=120000)
        except Exception as e: print('no screenshot', n, str(e)[:80], flush=True)
    def measure(name):
        if a.throttle:
            cdp = page.context.new_cdp_session(page); cdp.send('Emulation.setCPUThrottlingRate', {'rate': a.throttle})
        page.evaluate(MEASURE, [1, 2])
        if a.profile:
            pc = page.context.new_cdp_session(page); pc.send('Profiler.enable'); pc.send('Profiler.setSamplingInterval', {'interval': 500}); pc.send('Profiler.start')
        res[name] = page.evaluate(MEASURE, [a.secs, a.frames]); print(name, res[name], flush=True)
        if a.profile:
            from collections import Counter
            prof = pc.send('Profiler.stop')['profile']
            pathlib.Path(f'{a.profile}_{name}.cpuprofile').write_text(json.dumps(prof))
            self_t = Counter(); byid = {n['id']: n for n in prof['nodes']}
            for sid, d in zip(prof.get('samples', []), prof.get('timeDeltas', [])):
                cf = byid[sid]['callFrame']; self_t[f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1]}:{cf['lineNumber']}"] += d / 1000
            tot = sum(self_t.values()) or 1
            print('PROFILE', name, [(k, round(v / tot * 100, 1)) for k, v in self_t.most_common(40)], flush=True)
        if a.census:
            c = page.evaluate(CENSUS); res[name]['census'] = c['by_tag']
            print('CENSUS', name, c['total'], json.dumps(c['by_tag']), '\n  ', json.dumps(c['top']), flush=True)
        if a.throttle: cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
        shot(name)
    def until(cond, act, tries=200, wait=1.0):
        for i in range(tries):
            st = page.evaluate("[__bs.state, __bs.mode, !!(__bs.away && __bs.away.who)]")
            if page.evaluate(cond): return True
            if i % 10 == 0: print('waiting:', cond, st, flush=True)
            act(st); time.sleep(wait)
        return False
    # the Zenvora prologue is the street (every build since it was made plays it on a new game, whatever comes before)
    if 'street' in want:
        ok = until("__bs.mode === 'away' && !!(__bs.away && __bs.away.who)", lambda st: page.evaluate('__bs.skip()') if st[0] == 'narrator' else None)
        if ok:
            time.sleep(6)  # the hero view out of the flat eases back first
            measure('street_spawn')
            # down on the street, looking along it: the walkers, the groups and the stalls ahead
            page.evaluate("__bs.awayTeleport(0, 40, 0)"); time.sleep(4)
            measure('street')
        page.evaluate("__bs.awayLeave()")
    # a cutscene: MegaZroN in the Vault (the same scene in every build)
    if 'cutscene' in want:
        time.sleep(3)
        page.evaluate("__bs.sceneTest('intro')")
        if until("__bs.state === 'narrator' && __bs.vault.playing", lambda st: None, tries=120):
            time.sleep(4); measure('cutscene_vault')
    # free play after the wake-up, then the camp scene with the whole crew close up
    if 'play' in want:
        def on(st):
            page.evaluate('__bs.skip()')
            if st[1] == 'wake': page.keyboard.press('Enter')
            if st[1] == 'away': page.evaluate('__bs.awayLeave()')
        if until("__bs.state === 'game' && __bs.mode === 'play'", on, tries=300):
            time.sleep(3); measure('play')
            page.evaluate("__bs.gameScene('camp')")
            if until("__bs.mode === 'scene'", lambda st: None, tries=60):
                time.sleep(3); measure('cutscene_camp')
    res['errors'] = errs[:5]
    b.close()
print(json.dumps(res, indent=1))
if a.out: pathlib.Path(a.out).write_text(json.dumps(res, indent=1))
