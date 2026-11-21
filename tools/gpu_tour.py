# Zenvora on the real GPU: drives the owner's Windows Chrome over the DevTools protocol (stdlib only, so it runs on the
# Windows Python), takes stills at set spots, measures frame rate and draw calls at each, and records short clips with
# the DevTools screencast (frames are the GPU's own; ffmpeg joins them afterwards, see --join).
#
#   chrome.exe --remote-debugging-port=9333 --user-data-dir=%TEMP%\bs-gpu-profile
#   python.exe tools\gpu_tour.py URL OUTDIR PLAN.json            (Windows side)
#   python3 tools/gpu_tour.py --join OUTDIR                       (WSL side: frames -> MP4)
#
# PLAN.json: {"quality": "ultra", "size": [1280, 720], "steps": [
#   {"shot": "name", "at": [x, z, yaw], "wait": 3, "fps": 3, "eval": "js before the shot"},
#   {"clip": "name", "at": [x, z, yaw], "keys": ["KeyW"], "secs": 8, "eval": "js"} ]}
import base64, json, os, socket, struct, sys, time, urllib.request, subprocess, glob

if sys.argv[1] == '--join':
    out = sys.argv[2]
    for d in sorted(glob.glob(os.path.join(out, 'clip_*'))):
        meta = json.load(open(os.path.join(d, 'frames.json')))
        if len(meta) < 2: continue
        # a concat list with each frame's real duration, so the clip plays at the speed it was played
        with open(os.path.join(d, 'list.txt'), 'w') as f:
            for i, (n, t) in enumerate(meta):
                dur = (meta[i + 1][1] - t) if i + 1 < len(meta) else 1 / 30
                f.write(f"file '{n}'\nduration {max(dur, 0.001):.4f}\n")
        name = os.path.basename(d)[5:]
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', os.path.join(d, 'list.txt'), '-vf', 'fps=30,scale=1280:-2',
                        '-c:v', 'libx264', '-crf', '22', '-pix_fmt', 'yuv420p', os.path.join(out, f'{name}.mp4')], check=True)
        print('joined', name, len(meta), 'frames')
    sys.exit(0)

URL = sys.argv[1]; OUT = sys.argv[2]; PLAN = json.load(open(sys.argv[3])); os.makedirs(OUT, exist_ok=True)
# the DevTools port: the plan's "port", else BS_CDP_PORT, else 9333 (agents sharing the laptop each start their own Chrome)
PORT = int(PLAN.get('port') or os.environ.get('BS_CDP_PORT') or 9333)
errs = []; events = []

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
    def handle(s, r):
        if r.get('method') == 'Runtime.exceptionThrown':
            d = r['params']['exceptionDetails']; errs.append((d.get('text', '') + ' ' + str(d.get('exception', {}).get('description', '')))[:300])
        elif 'method' in r: events.append(r)
    def call(s, method, **params):
        s.i += 1; s.frame(json.dumps({'id': s.i, 'method': method, 'params': params}).encode())
        while True:
            r = json.loads(s.recv())
            if r.get('id') == s.i:
                if 'error' in r: raise RuntimeError(r['error'])
                return r['result']
            s.handle(r)

# tabs left by an earlier run of this tool keep drawing: close them first
for old_tab in json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json')):
    if old_tab.get('type') == 'page' and URL.split('?')[0] in old_tab.get('url', ''):
        try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/close/{old_tab['id']}").read()
        except Exception: pass
t = json.load(urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{PORT}/json/new?about:blank', method='PUT')))
w = WS(t['webSocketDebuggerUrl']); w.call('Page.enable'); w.call('Runtime.enable')
W, H = PLAN.get('size', [1280, 720])
w.call('Emulation.setDeviceMetricsOverride', width=W, height=H, deviceScaleFactor=1, mobile=False)
if PLAN.get('throttle'): w.call('Emulation.setCPUThrottlingRate', rate=PLAN['throttle'])

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
def shot(n):
    open(os.path.join(OUT, f'{n}.jpg'), 'wb').write(base64.b64decode(w.call('Page.captureScreenshot', format='jpeg', quality=88)['data']))
# frame rate over a few seconds, the worst frame, and the draw calls and triangles of the last frame
FPS = """new Promise(r=>{const gl=__bs.gl;let n=0,t0=performance.now(),last=t0,worst=0,calls=0,tris=0,bodies=0,sk=0,tick=0,draw=0;function f(t){n++;worst=Math.max(worst,t-last);last=t;
const p=__bs.perf||{calls:0,tris:0,bodies:0,skinned:0,tick:0,draw:0};calls=Math.max(calls,p.calls);tris=Math.max(tris,p.tris);bodies=Math.max(bodies,p.bodies);sk=Math.max(sk,p.skinned);tick=p.tick;draw=p.draw;
if(t-t0<SEC)requestAnimationFrame(f);else r({fps:+(n*1000/(t-t0)).toFixed(1),worst_ms:+worst.toFixed(0),calls,tris,bodies,skinned:sk,update_ms:+tick.toFixed(1),draw_ms:+draw.toFixed(1),pr:+gl.getPixelRatio().toFixed(2)})}requestAnimationFrame(f)})"""
# one frame's draws and triangles by what they belong to: a body, a prop, scenery; main camera or shadow camera
CENSUS = """new Promise(res=>{const r=__bs.gl,orig=r.renderBufferDirect,out={};
r.renderBufferDirect=function(cam,sc,g,m,obj,grp){let k='scene';for(let o=obj;o;o=o.parent){if(o.userData&&o.userData.isCharacter){k='body';break}}
if(obj.isInstancedMesh)k+='/inst';else if(obj.isSkinnedMesh)k+='/skin';else if(k==='body')k+='/'+(obj.name||obj.geometry.type)+'/'+(m.name||m.type);const pass=cam.isOrthographicCamera?'shadow':'main';const key=pass+':'+k;
const n=g.index?g.index.count:g.attributes.position.count;const inst=obj.isInstancedMesh?obj.count:1;const e=out[key]||(out[key]={calls:0,tris:0});e.calls++;e.tris+=Math.round(n/3*inst);
return orig.apply(this,arguments)};requestAnimationFrame(()=>requestAnimationFrame(()=>{r.renderBufferDirect=orig;res(out)}))})"""
# CPU milliseconds spent issuing one frame's draws, by what they draw (bodies by mesh name and material)
CTIME = """new Promise(res=>{const r=__bs.gl,orig=r.renderBufferDirect,out={};let frames=0;
r.renderBufferDirect=function(cam,sc,g,m,obj,grp){let k='scene';for(let o=obj;o;o=o.parent){if(o.userData&&o.userData.isCharacter){k='body';break}}
k=(cam.isOrthographicCamera?'shadow:':'main:')+k+(k==='body'?'/'+obj.name+'/'+(m.type||''):obj.isInstancedMesh?'/inst':(window.__CTD?'/'+(obj.userData.district||obj.name||obj.geometry.type)+'/'+(m.type||'')+'/'+(obj.parent&&obj.parent.type||''):''));const t0=performance.now();const v=orig.apply(this,arguments);const e=out[k]||(out[k]={n:0,ms:0});e.n++;e.ms+=performance.now()-t0;return v};
const f=()=>{if(++frames<6)requestAnimationFrame(f);else{r.renderBufferDirect=orig;for(const k in out){out[k].n=+(out[k].n/5).toFixed(1);out[k].ms=+(out[k].ms/5).toFixed(2)}res(out)}};requestAnimationFrame(f)})"""
def key(code, down):
    k = code[3:].lower() if code.startswith('Key') else {'ShiftLeft': 'Shift', 'Space': ' '}.get(code, code)
    w.call('Input.dispatchKeyEvent', type='keyDown' if down else 'keyUp', code=code, key=k, windowsVirtualKeyCode=ord(k.upper()) if len(k) == 1 else 16)

q = PLAN.get('quality', 'ultra'); sep = '&' if '?' in URL else '?'
w.call('Page.navigate', url=f'{URL}{sep}quality={q}')
wait("window.__bs && __bs.state==='title' && __bs.ready", 240)
ev("localStorage.removeItem('bs-save-v1'); localStorage.setItem('bs-consent-v1','1')"); w.call('Page.reload'); time.sleep(2)
wait("window.__bs && __bs.state==='title' && __bs.ready", 240)
print('gpu', ev("(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)})()"), flush=True)
ev("document.getElementById('btn-new').click()"); time.sleep(1.5)
wait("document.getElementById('nm-ok')", 30); ev("document.getElementById('nm-ok').click()")
for i in range(300):
    if ev("__bs.mode === 'away' && !!(__bs.away && __bs.away.who)"): break
    if ev('__bs.state') == 'narrator': ev('__bs.skip()')
    time.sleep(1)
if PLAN.get('start') == 'planet':
    # plan "start": "planet": leave Zenvora and skip the films to the planet's free play ("pat" steps teleport there)
    ev('__bs.awayLeave()')
    for i in range(300):
        if ev("__bs.state === 'game' && __bs.mode === 'play'"): break
        ev('__bs.skip()'); time.sleep(1)
time.sleep(PLAN.get('settle', 8))
report = {'quality': q, 'size': [W, H], 'steps': []}
for st in PLAN['steps']:
    if 'eval' in st: ev(st['eval'])
    if 'at' in st: x, z, yaw = st['at']; ev(f"__bs.awayTeleport({x}, {z}, {yaw})")
    if 'pat' in st: x, z, yaw = st['pat']; ev(f"__bs.teleport({x}, {z}, {yaw})")
    for k in st.get('press', []): key(k, True); time.sleep(0.08); key(k, False)
    time.sleep(st.get('wait', 3))
    if 'shot' in st:
        shot(st['shot'])
        row = {'shot': st['shot']}
        if st.get('fps', 3): row.update(ev(FPS.replace('SEC', str(st.get('fps', 3) * 1000)), True))
        if st.get('census'): row['census'] = ev(CENSUS, True)
        if st.get('ctime'): row['ctime'] = ev(CTIME, True)
        if st.get('js'): row['js'] = ev(st['js'], True)
        if st.get('profile'):
            # the main thread's self time by function over a few seconds (top 25)
            w.call('Profiler.enable'); w.call('Profiler.setSamplingInterval', interval=200); w.call('Profiler.start'); time.sleep(st['profile'])
            prof = w.call('Profiler.stop')['profile']; w.call('Profiler.disable')
            open(os.path.join(OUT, f"{st['shot']}.cpuprofile"), 'w').write(json.dumps(prof))
            nodes = {n['id']: n for n in prof['nodes']}; selfc = {}
            for sid in prof.get('samples', []):
                cf = nodes[sid]['callFrame']; k = f"{cf['functionName'] or '(anon)'} {cf['url'].rsplit('/', 1)[-1]}:{cf['lineNumber']}"
                selfc[k] = selfc.get(k, 0) + 1
            tot = max(1, len(prof.get('samples', [])))
            row['profile'] = [(k, round(100 * v / tot, 1)) for k, v in sorted(selfc.items(), key=lambda x: -x[1])[:25]]
            # inclusive time: every function on each sampled stack (once per sample)
            parent = {}
            for n in prof['nodes']:
                for c in n.get('children', []): parent[c] = n['id']
            inc = {}
            for sid in prof.get('samples', []):
                seen = set(); n = sid
                while n is not None:
                    cf = nodes[n]['callFrame']; k = f"{cf['functionName'] or '(anon)'} {cf['url'].rsplit('/', 1)[-1]}:{cf['lineNumber']}"
                    if k not in seen: seen.add(k); inc[k] = inc.get(k, 0) + 1
                    n = parent.get(n)
            row['inclusive'] = [(k, round(100 * v / tot, 1)) for k, v in sorted(inc.items(), key=lambda x: -x[1])[:40]]
        report['steps'].append(row); print(json.dumps(row), flush=True)
    if 'clip' in st:
        d = os.path.join(OUT, f"clip_{st['clip']}"); os.makedirs(d, exist_ok=True)
        events.clear(); meta = []
        w.call('Page.startScreencast', format='jpeg', quality=85, maxWidth=W, maxHeight=H, everyNthFrame=1)
        for k in st.get('keys', []): key(k, True)
        t0 = time.time(); n = 0
        while time.time() - t0 < st['secs']:
            if st.get('steer'): ev(st['steer'])
            w.call('Runtime.evaluate', expression='0')
            for e in events:
                if e['method'] == 'Page.screencastFrame':
                    p = e['params']; fn = f'{n:05d}.jpg'; n += 1
                    open(os.path.join(d, fn), 'wb').write(base64.b64decode(p['data']))
                    meta.append((fn, p['metadata']['timestamp']))
                    w.frame(json.dumps({'id': 999999, 'method': 'Page.screencastFrameAck', 'params': {'sessionId': p['sessionId']}}).encode())
            events.clear(); time.sleep(0.01)
        for k in st.get('keys', []): key(k, False)
        w.call('Page.stopScreencast')
        json.dump(meta, open(os.path.join(d, 'frames.json'), 'w'))
        span = meta[-1][1] - meta[0][1] if len(meta) > 1 else 0
        row = {'clip': st['clip'], 'frames': n, 'screencast_fps': round((n - 1) / span, 1) if span else 0}
        report['steps'].append(row); print(json.dumps(row), flush=True)
report['errors'] = errs[:10]
json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
print('errors', errs[:5])
try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/close/{t['id']}").read()
except Exception: pass
