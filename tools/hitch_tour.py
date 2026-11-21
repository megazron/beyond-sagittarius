# A full play on the real GPU with every long frame logged and its likely cause: drives the owner's Windows Chrome over
# the DevTools protocol (stdlib only, so it runs on the Windows Python), from the title through MegaZroN's Vault, the
# Zenvora prologue (walking, then every task), the take-off, the opening films and the first minutes on the planet.
#
#   chrome.exe --remote-debugging-port=PORT --user-data-dir=...
#   python.exe tools\hitch_tour.py URL OUT.json [--quality web] [--size 1280x720] [--throttle 4] [--port 9444]
#
# Per segment: frames, mean fps, 95th-percentile frame time, frames over 50 ms. Every frame over 50 ms is listed with
# what changed during it: shader programs compiled (dprog), textures and geometries uploaded (dtex, dgeo), JS heap
# freed (a drop is a GC), draw calls, and the game's state; the main thread's long tasks are counted beside it.
import base64, json, os, socket, struct, sys, time, urllib.request

args = sys.argv[1:]
def opt(name, default):
    if name in args: i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default
Q = opt('--quality', 'web'); SIZE = opt('--size', '1280x720'); THR = float(opt('--throttle', '0')); PORT = int(opt('--port', '9444'))
PROF = [x for x in opt('--profile', '').split(',') if x]; STOP = opt('--stop-after', '')
URL, OUT = args[0], args[1]
W, H = map(int, SIZE.split('x'))

class WS:
    def __init__(s, url):
        h = url.split('/', 3); host, port = h[2].split(':'); s.c = socket.create_connection((host, int(port))); k = base64.b64encode(os.urandom(16)).decode()
        s.c.sendall(f"GET /{h[3]} HTTP/1.1\r\nHost: {h[2]}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {k}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        b = b''
        while b'\r\n\r\n' not in b: b += s.c.recv(1)
        s.i = 0
    def rd(s, n):
        b = b''
        while len(b) < n:
            x = s.c.recv(n - len(b))
            if not x: raise EOFError
            b += x
        return b
    def recv(s):
        data = b''
        while True:
            a, b = s.rd(2); fin = a & 128; op = a & 15; n = b & 127
            if n == 126: n = struct.unpack('>H', s.rd(2))[0]
            elif n == 127: n = struct.unpack('>Q', s.rd(8))[0]
            p = s.rd(n)
            if op == 9: s.frame(p, 10); continue
            data += p
            if fin: return data
    def frame(s, p, op=1):
        m = os.urandom(4); n = len(p); h = bytes([128 | op])
        h += bytes([128 | n]) if n < 126 else bytes([128 | 126]) + struct.pack('>H', n) if n < 65536 else bytes([128 | 127]) + struct.pack('>Q', n)
        s.c.sendall(h + m + bytes(c ^ m[i % 4] for i, c in enumerate(p)))
    def call(s, method, **params):
        s.i += 1; s.frame(json.dumps({'id': s.i, 'method': method, 'params': params}).encode())
        while True:
            r = json.loads(s.recv())
            if r.get('id') == s.i:
                if 'error' in r: raise RuntimeError(r['error'])
                return r['result']

LOGGER = r"""
window.__hitch = { seg: 'load', long: [], segs: {}, tasks: 0, taskMs: 0 };
try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { __hitch.tasks++; __hitch.taskMs += e.duration; } }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
(() => {
  let last = 0, prev = null;
  const snap = () => { const b = window.__bs, info = b && b.gl && b.gl.info;
    return { prog: info && info.programs ? info.programs.length : 0, tex: info ? info.memory.textures : 0, geo: info ? info.memory.geometries : 0,
      calls: (b && b.perf && b.perf.calls) || 0, tris: (b && b.perf && b.perf.tris) || 0, heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
      state: b && b.state, mode: b && b.mode }; };
  const f = (t) => {
    const s = snap(), h = __hitch;
    if (last) {
      const dt = t - last, g = h.segs[h.seg] || (h.segs[h.seg] = { n: 0, sum: 0, over50: 0, over100: 0, dts: [], calls: 0, tris: 0 });
      g.n++; g.sum += dt; if (dt > 50) g.over50++; if (dt > 100) g.over100++; g.dts.push(dt); g.calls = Math.max(g.calls, s.calls); g.tris = Math.max(g.tris, s.tris);
      if (dt > 50 && prev) h.long.push({ t: +(t / 1000).toFixed(2), ms: Math.round(dt), seg: h.seg, state: s.state, mode: s.mode,
        dprog: s.prog - prev.prog, dtex: s.tex - prev.tex, dgeo: s.geo - prev.geo, calls: s.calls, tris: s.tris, heapMB: +((s.heap - prev.heap) / 1e6).toFixed(1) });
    }
    last = t; prev = s; requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
})();
"""

for old_tab in json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json')):
    if old_tab.get('type') == 'page' and URL.split('?')[0] in old_tab.get('url', ''):
        try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/close/{old_tab['id']}").read()
        except Exception: pass
t = json.load(urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{PORT}/json/new?about:blank', method='PUT')))
w = WS(t['webSocketDebuggerUrl']); w.call('Page.enable'); w.call('Runtime.enable')
w.call('Emulation.setDeviceMetricsOverride', width=W, height=H, deviceScaleFactor=1, mobile=False)
if THR: w.call('Emulation.setCPUThrottlingRate', rate=THR)
w.call('Page.addScriptToEvaluateOnNewDocument', source="localStorage.setItem('bs-consent-v1','1'); localStorage.removeItem('bs-save-v1');" + LOGGER)

def ev(x, aw=False):
    r = w.call('Runtime.evaluate', expression=x, returnByValue=True, awaitPromise=aw)
    if 'exceptionDetails' in r: raise RuntimeError(str(r['exceptionDetails'])[:300])
    return r['result'].get('value')
def wait(x, sec):
    t0 = time.time()
    while time.time() - t0 < sec:
        try:
            if ev(x): return True
        except RuntimeError: pass
        time.sleep(0.25)
    print('TIMEOUT', x, flush=True); return False
PROFS = {}; cur = ['load']
def prof_stop():
    # the main thread's time by function (inclusive, top 40) over the segment that just ended
    if cur[0] not in PROF: return
    prof = w.call('Profiler.stop')['profile']; w.call('Profiler.disable')
    open(OUT.replace('.json', f'_{cur[0]}.cpuprofile'), 'w').write(json.dumps(prof))
    nodes = {n['id']: n for n in prof['nodes']}; parent = {}
    for n in prof['nodes']:
        for c in n.get('children', []): parent[c] = n['id']
    inc, tot = {}, max(1, len(prof.get('samples', [])))
    dt = (prof['endTime'] - prof['startTime']) / 1e3 / tot
    for sid in prof.get('samples', []):
        seen = set(); n = sid
        while n is not None:
            cf = nodes[n]['callFrame']; k = f"{cf['functionName'] or '(anon)'} {cf['url'].rsplit('/', 1)[-1]}:{cf['lineNumber']}"
            if k not in seen: seen.add(k); inc[k] = inc.get(k, 0) + 1
            n = parent.get(n)
    PROFS[cur[0]] = [(k, round(v * dt)) for k, v in sorted(inc.items(), key=lambda x: -x[1])[:60]]
    print('profile', cur[0], PROFS[cur[0]][:25], flush=True)
def prof_start(n):
    if n in PROF: w.call('Profiler.enable'); w.call('Profiler.setSamplingInterval', interval=500); w.call('Profiler.start')
class Stop(Exception): pass
def seg(n):
    prof_stop()
    if cur[0] == STOP: raise Stop()
    cur[0] = n; prof_start(n)
    ev(f"__hitch.seg = {json.dumps(n)}"); print('segment', n, flush=True)
def key(code, down):
    k = code[3:].lower() if code.startswith('Key') else {'ShiftLeft': 'Shift', 'Space': ' '}.get(code, code)
    w.call('Input.dispatchKeyEvent', type='keyDown' if down else 'keyUp', code=code, key=k, windowsVirtualKeyCode=ord(k.upper()) if len(k) == 1 else 16)
def hold(keys, secs, steer=None):
    for k in keys: key(k, True)
    t0 = time.time()
    while time.time() - t0 < secs:
        if steer: ev(steer)
        time.sleep(0.5)
    for k in keys: key(k, False)

sep = '&' if '?' in URL else '?'
T0 = time.time()
w.call('Page.navigate', url=f'{URL}{sep}quality={Q}'); time.sleep(0.3)
prof_start('load')
wait("window.__bs && __bs.state==='title' && __bs.ready", 300)
print('loaded in', round(time.time() - T0, 1), 's', flush=True)
try:
  seg('title'); time.sleep(5)
  ev("document.getElementById('btn-new').click()"); wait("document.getElementById('nm-ok')", 30)
  seg('vault'); ev("document.getElementById('nm-ok').click()")
  wait("__bs.state === 'narrator'", 60); time.sleep(12); ev("__bs.state === 'narrator' && __bs.skip()")
  seg('zenvora_arrive'); wait("__bs.mode === 'away' && !!(__bs.away && __bs.away.who)", 300); time.sleep(8)
  seg('zenvora_walk'); hold(['KeyW'], 25, "__bs.debug && (__bs.debug.yaw = (__bs.debug.yaw || 0))")
  seg('zenvora_run'); hold(['KeyW', 'ShiftLeft'], 15)
  seg('zenvora_tasks')
  for _ in range(30):
      s = ev('__bs.away')
      if not s or not s.get('next'): break
      for _try in range(5):
          ev('__bs.awayGoNext()'); time.sleep(1.2); key('KeyE', True); time.sleep(0.1); key('KeyE', False); time.sleep(1.5)
          n = ev('__bs.away')
          if not n or n.get('next') != s.get('next'): break
  seg('takeoff'); wait('__bs.awayOutroOn', 60); time.sleep(10); ev("__bs.skip && document.getElementById('btn-skip') && document.getElementById('btn-skip').click()")
  seg('films'); wait("__bs.state === 'cinematic' || __bs.state === 'film'", 120); time.sleep(45)
  for _ in range(12):
      if ev("__bs.state === 'game'"): break
      ev('__bs.skip()'); time.sleep(4)
  seg('planet_wake'); wait("__bs.state === 'game'", 120); time.sleep(15)
  seg('planet_walk'); wait("__bs.mode === 'play'", 120); hold(['KeyW'], 30)
  seg('planet_run'); hold(['KeyW', 'ShiftLeft'], 20)
  seg('end')
except Stop: pass
h = ev("JSON.stringify(__hitch)")
h = json.loads(h)
rep = {'quality': Q, 'size': [W, H], 'throttle': THR, 'gpu': ev("(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)})()"),
       'segments': {}, 'long': h['long'], 'longtasks': h['tasks'], 'longtask_ms': round(h['taskMs']), 'profiles': PROFS}
for n, g in h['segs'].items():
    d = sorted(g['dts'])
    rep['segments'][n] = {'frames': g['n'], 'fps': round(1000 * g['n'] / max(1, g['sum']), 1), 'p95_ms': round(d[int(len(d) * 0.95)] if d else 0, 1),
                          'max_ms': round(d[-1] if d else 0), 'over50': g['over50'], 'over100': g['over100'], 'max_calls': g['calls'], 'max_tris': g['tris']}
json.dump(rep, open(OUT, 'w'), indent=1)
for n, g in rep['segments'].items(): print(n, g, flush=True)
print('long frames', len(rep['long']), flush=True)
try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/close/{t['id']}").read()
except Exception: pass
