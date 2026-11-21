# Records the game as a player sees and hears it: the owner's Windows Chrome on the real GPU, driven over the DevTools
# protocol. Pictures come from the DevTools screencast (the page as composited, subtitles and HUD included), sound from
# the game's own master bus through a MediaRecorder, both stamped on the same clock; --join lays them together as MP4.
# Stdlib only, so it runs on the Windows Python.
#
#   chrome.exe --remote-debugging-port=9334 --user-data-dir=%TEMP%\bs-life-gpu --autoplay-policy=no-user-gesture-required
#              --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --window-size=1300,820
#   python.exe tools\gpu_capture.py URL OUTDIR PLAN.json     (Windows side; OUTDIR may be a \\wsl.localhost\ path)
#   python3 tools/gpu_capture.py --join OUTDIR                (WSL side: frames + sound -> NAME.mp4, lined up by the
#                                                             sync marks every recording starts and ends with)
#
# PLAN.json: {"port": 9334, "size": [1280, 720], "steps": [
#   {"eval": "js"}, {"wait": "js condition", "secs": 60}, {"sleep": 2},
#   {"rec": "name", "secs": 20, "eval": "js at the start", "keys": [["KeyW", 0, 6]], "until": "js condition"}]}
# keys: [code, start second, length]. A recording also stops early when `until` turns true.
import base64, json, os, queue, socket, struct, subprocess, sys, threading, time, urllib.request, glob

if len(sys.argv) > 2 and sys.argv[1] == '--join':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import wave
    import numpy as np
    from PIL import Image
    from av_marks import tone_onsets, corner_patch, corner_onsets, align_marks, FM
    out = sys.argv[2]; FPS = 30; SR = 48000; bad = []
    for d in sorted(glob.glob(os.path.join(out, 'rec_*'))):
        meta = json.load(open(os.path.join(d, 'meta.json')))
        frames = meta['frames']
        if len(frames) < 2:
            continue
        name = os.path.basename(d)[4:]
        dst = os.path.join(out, f'{name}.mp4')
        t0 = frames[0][1]; T = [f[1] - t0 for f in frames]
        a = os.path.join(d, 'audio.webm')
        pcm = None
        if os.path.exists(a) and os.path.getsize(a) > 0 and meta.get('audio_t0'):
            raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', a, '-ac', '2', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True, check=True).stdout
            pcm = np.frombuffer(raw, dtype=np.int16).reshape(-1, 2).astype(np.float32) / 32768
        # sound file time -> picture time: p = off + a * rate. First guess from the recorder's start stamp (late when the
        # page is busy: it is stamped by an event on the main thread); then from the sync marks, if there are any.
        off, rate, note = (meta['audio_t0'] - t0) if pcm is not None else 0.0, 1.0, 'stamp'
        lo, hi = 0.0, T[-1]
        if pcm is not None and meta.get('marks'):
            tones = tone_onsets(pcm.mean(1), SR, freq=FM)
            def pic(t_a, t_b):
                sel = [i for i, t in enumerate(T) if t_a <= t <= t_b]
                return corner_onsets([T[i] for i in sel], [corner_patch(Image.open(os.path.join(d, frames[i][0]))) for i in sel])
            ps, pe = pic(0, 3.2), pic(T[-1] - 3.2, T[-1])
            ts, te = tones[tones + off < 3.6], tones[tones + off > T[-1] - 3.6]
            ms, me = align_marks(ps, ts + off), align_marks(pe, te + off)
            if len(ms) >= 2:
                off0 = off
                # the median mark: single marks scatter by about a frame either way (the square shows on the next
                # composited frame; the beep starts on the next audio quantum)
                ds = float(np.median([x[1] for x in ms])); off = off0 - ds; note = f'marks (recorder stamp was {ds * 1000:+.0f} ms off)'
                lo = ps[-1] + 0.3
                pairs = [(pt, pt + dd - off0) for pt, dd in ms]  # (picture time, sound file time) per mark
                if len(me) >= 2:
                    de = float(np.median([x[1] for x in me])) - ds  # sound minus picture at the end, after the start fix
                    p0 = ms[0][0]; a0_ = p0 - off  # the first start mark's sound, in file time, sits at picture time p0
                    span = me[0][0] - p0
                    if abs(de) > 0.015 and span > 5:
                        rate = span / (span + de)  # sound ran long (de > 0) or short: stretch it onto the picture
                        off = p0 - a0_ * rate
                    hi = pe[0] - 0.15
                    pairs += [(pt, pt + dd - off0) for pt, dd in me]
                    note += f', end {de * 1000:+.0f} ms over {span:.0f} s'
                resid = [(off + af * rate) - pt for pt, af in pairs]
                worst = max(resid, key=abs)
                note += f', marks after the fix {min(resid) * 1000:+.0f}..{max(resid) * 1000:+.0f} ms'
                if abs(worst) > 0.1:
                    bad.append(name)
            else:
                note = f'NO MARKS FOUND (picture {len(ps)}, sound {len(ts)}): sound placed by the recorder stamp'
                bad.append(name)
        n_out = int((hi - lo) * FPS) + 1
        cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', str(FPS), '-c:v', 'mjpeg', '-i', '-']
        if pcm is not None:
            # output sample k is at picture time lo + k / SR; it comes from sound file time (p - off) / rate
            k = np.arange(int((hi - lo) * SR) + SR // 10)
            src = ((lo + k / SR) - off) / rate * SR
            ok = (src >= 0) & (src < len(pcm) - 1)
            o = np.zeros((len(k), 2), dtype=np.float32)
            if rate == 1.0:
                i = np.round(src).astype(int); o[ok] = pcm[i[ok]]
            else:
                for c in range(2):
                    o[ok, c] = np.interp(src[ok], np.arange(len(pcm)), pcm[:, c])
            wav = os.path.join(d, 'aligned.wav')
            with wave.open(wav, 'wb') as wf:
                wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(SR)
                wf.writeframes((np.clip(o, -1, 1) * 32767).astype(np.int16).tobytes())
            cmd += ['-i', wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '160k', '-shortest']
        cmd += ['-vf', 'scale=1280:-2', '-c:v', 'libx264', '-crf', '24', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst]
        pr = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        j = 0; cache = (None, b'')
        for kk in range(n_out):
            # constant 30 fps from the frames' own timestamps: each output frame shows the newest frame at or before it
            t = lo + kk / FPS
            while j + 1 < len(frames) and T[j + 1] <= t:
                j += 1
            if cache[0] != j:
                cache = (j, open(os.path.join(d, frames[j][0]), 'rb').read())
            pr.stdin.write(cache[1])
        pr.stdin.close()
        if pr.wait() != 0:
            raise SystemExit(f'ffmpeg failed on {name}')
        print('joined', name, len(frames), 'frames', f'{hi - lo:.1f}s', ('sound by ' + note + (f', stretched x{rate:.4f}' if rate != 1 else '')) if pcm is not None else 'silent', flush=True)
    # a capture that recorded the sync test (`{"rec": "sync", "eval": "__bs.syncTest(8)"}`) is checked: no clip goes out
    # with picture and sound apart
    rc = 1 if bad else 0
    if bad:
        print('NO SYNC MARKS in', bad)
    if os.path.exists(os.path.join(out, 'sync.mp4')):
        r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'av_sync.py'), '--mp4', os.path.join(out, 'sync.mp4')])
        rc = rc or r.returncode
    sys.exit(rc)

URL, OUT, PLAN = sys.argv[1], sys.argv[2], json.load(open(sys.argv[3]))
PORT = PLAN.get('port', 9334)
os.makedirs(OUT, exist_ok=True)


class CDP:
    def __init__(s, url):
        h = url.split('/', 3); host, port = h[2].split(':')
        s.c = socket.create_connection((host, int(port)))
        k = base64.b64encode(os.urandom(16)).decode()
        s.c.sendall(f"GET /{h[3]} HTTP/1.1\r\nHost: {h[2]}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {k}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        b = b''
        while b'\r\n\r\n' not in b:
            b += s.c.recv(1)
        s.i, s.lock, s.waiting, s.events = 0, threading.Lock(), {}, queue.Queue()
        s.idlock = threading.Lock()
        s.on_event = None
        threading.Thread(target=s.reader, daemon=True).start()

    def rd(s, n):
        b = b''
        while len(b) < n:
            x = s.c.recv(n - len(b))
            if not x:
                raise EOFError
            b += x
        return b

    def recv(s):
        data = b''
        while True:
            a, b = s.rd(2); fin = a & 128; op = a & 15; n = b & 127
            if n == 126: n = struct.unpack('>H', s.rd(2))[0]
            elif n == 127: n = struct.unpack('>Q', s.rd(8))[0]
            p = s.rd(n)
            if op == 9:
                s.frame(p, 10); continue
            data += p
            if fin:
                return data

    def frame(s, p, op=1):
        m = os.urandom(4); n = len(p); h = bytes([128 | op])
        h += bytes([128 | n]) if n < 126 else bytes([128 | 126]) + struct.pack('>H', n) if n < 65536 else bytes([128 | 127]) + struct.pack('>Q', n)
        with s.lock:
            s.c.sendall(h + m + bytes(c ^ m[i % 4] for i, c in enumerate(p)))

    def reader(s):
        while True:
            try:
                r = json.loads(s.recv())
            except Exception:
                return
            if 'id' in r and r['id'] in s.waiting:
                s.waiting[r['id']].put(r)
            elif s.on_event:
                s.on_event(r)

    def call(s, method, **params):
        # frames are acknowledged from their own threads: the id must be taken under a lock, or two calls share one
        # and an answer goes to the wrong caller (a recording then died with a timeout while the page was fine)
        with s.idlock:
            s.i += 1; i = s.i; q = queue.Queue(); s.waiting[i] = q
        s.frame(json.dumps({'id': i, 'method': method, 'params': params}).encode())
        r = q.get(timeout=120)
        s.waiting.pop(i, None)
        if 'error' in r:
            raise RuntimeError(r['error'])
        return r['result']


errs = []
# one game at a time in this browser: earlier tabs would share the GPU with the recording
for old in json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json/list')):
    if old.get('type') == 'page':
        try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/close/{old['id']}").read()
        except Exception: pass
t = json.load(urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{PORT}/json/new?about:blank', method='PUT')))
w = CDP(t['webSocketDebuggerUrl'])
rec = {'dir': None, 'frames': [], 'n': 0}


def on_event(r):
    m = r.get('method')
    if m == 'Page.screencastFrame':
        p = r['params']
        threading.Thread(target=lambda: w.call('Page.screencastFrameAck', sessionId=p['sessionId']), daemon=True).start()
        if rec['dir']:
            n = f"f{rec['n']:05d}.jpg"; rec['n'] += 1
            open(os.path.join(rec['dir'], n), 'wb').write(base64.b64decode(p['data']))
            rec['frames'].append([n, p['metadata']['timestamp']])
    elif m == 'Runtime.exceptionThrown':
        d = r['params']['exceptionDetails']
        errs.append((d.get('text', '') + ' ' + str(d.get('exception', {}).get('description', '')))[:300])


w.on_event = on_event
w.call('Page.enable'); w.call('Runtime.enable')
W, H = PLAN.get('size', [1280, 720])
w.call('Emulation.setDeviceMetricsOverride', width=W, height=H, deviceScaleFactor=1, mobile=False)


def ev(x, aw=False):
    r = w.call('Runtime.evaluate', expression=x, returnByValue=True, awaitPromise=aw)
    if 'exceptionDetails' in r:
        raise RuntimeError(str(r['exceptionDetails'])[:300])
    return r['result'].get('value')


def wait(x, sec):
    t0 = time.time()
    while time.time() - t0 < sec:
        try:
            if ev(x):
                return True
        except RuntimeError:
            pass
        time.sleep(0.2)
    print('TIMEOUT', x, flush=True)
    return False


KEYS = {'KeyW': ('w', 87), 'KeyA': ('a', 65), 'KeyS': ('s', 83), 'KeyD': ('d', 68), 'KeyE': ('e', 69), 'Space': (' ', 32),
        'ShiftLeft': ('Shift', 16), 'Escape': ('Escape', 27), 'Enter': ('Enter', 13), 'KeyF': ('f', 70), 'KeyQ': ('q', 81)}


def key(code, down):
    k, vk = KEYS.get(code, (code, 0))
    w.call('Input.dispatchKeyEvent', type='keyDown' if down else 'keyUp', code=code, key=k, windowsVirtualKeyCode=vk)


TAP = """(async () => {
  const s = window.__bs && window.__bs.audioTap ? window.__bs.audioTap() : null; if (!s) return 0;  // a dev page has no game: pictures only
  const mr = new MediaRecorder(s, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 });
  const chunks = []; mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  window.__rec = { mr, chunks, t0: 0, tc: Date.now() / 1000 };
  await new Promise((r) => { mr.onstart = () => { window.__rec.t0 = Date.now() / 1000; r(); }; mr.start(500); });
  return window.__rec.t0; })()"""
STOP = """(async () => {
  const R = window.__rec; if (!R) return null;
  await new Promise((r) => { R.mr.onstop = r; R.mr.stop(); });
  const b = new Blob(R.chunks, { type: 'audio/webm' });
  const u = new Uint8Array(await b.arrayBuffer()); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  window.__rec = null; return btoa(s); })()"""

w.call('Page.navigate', url=URL)
wait(PLAN.get("ready", "window.__bs && window.__bs.ready"), 180)
for st in PLAN['steps']:
    if 'rec' in st:
        d = os.path.join(OUT, 'rec_' + st['rec']); os.makedirs(d, exist_ok=True)
        for f in glob.glob(os.path.join(d, '*.jpg')):
            os.remove(f)
        rec.update(dir=d, frames=[], n=0)
        a0 = ev(TAP, True); tc = ev('window.__rec ? window.__rec.tc : null')
        w.call('Page.startScreencast', format='jpeg', quality=82, maxWidth=W, maxHeight=H, everyNthFrame=1)
        # sync marks before the recording's own start and after its end (beep + corner square, `__bs.syncMark`): the join
        # lines sound up to picture by them, so a late recorder start under load cannot shift the sound
        marks = st.get('marks', True) and ev('!!(window.__bs && window.__bs.syncMark)')
        if marks:
            time.sleep(0.4); ev('__bs.syncMark(3)'); time.sleep(2.0)
        if st.get('eval'):
            ev(st['eval'])
        t0 = time.time(); pend = sorted([[s0, 'down', c] for c, s0, _ in st.get('keys', [])] + [[s0 + n, 'up', c] for c, s0, n in st.get('keys', [])])
        while time.time() - t0 < st['secs']:
            el = time.time() - t0
            while pend and pend[0][0] <= el:
                _, kind, c = pend.pop(0); key(c, kind == 'down')
            for e in st.get('at', []):
                if not e.get('done') and el >= e['t']:
                    e['done'] = True
                    try: ev(e['js'])
                    except RuntimeError as x: print('at-eval', x)
            if st.get('until'):
                try:
                    if ev(st['until']):
                        break
                except RuntimeError:
                    pass
            time.sleep(0.05)
        for _, kind, c in pend:
            if kind == 'up':
                key(c, False)
        if marks:
            ev('__bs.syncMark(3)'); time.sleep(1.9)
        w.call('Page.stopScreencast')
        time.sleep(0.3)
        b64 = ev(STOP, True)
        if b64:
            open(os.path.join(d, 'audio.webm'), 'wb').write(base64.b64decode(b64))
        json.dump({'frames': rec['frames'], 'audio_t0': a0, 'audio_call': tc, 'marks': bool(marks)}, open(os.path.join(d, 'meta.json'), 'w'))
        rec['dir'] = None
        fps = len(rec['frames']) / max(0.1, (rec['frames'][-1][1] - rec['frames'][0][1])) if len(rec['frames']) > 1 else 0
        print('rec', st['rec'], len(rec['frames']), 'frames', f'{fps:.1f} fps', 'sound' if b64 else 'no sound', flush=True)
    elif 'eval' in st:
        try:
            r = ev(st['eval'], st.get('await', False))
            if st.get('save'):
                open(os.path.join(OUT, st['save']), 'w').write(str(r))  # the whole result, for results too long to print
            print('eval', str(r)[:200], flush=True)
        except RuntimeError as x:
            print('eval error', x, flush=True)
    elif 'wait' in st:
        wait(st['wait'], st.get('secs', 60))
    elif 'sleep' in st:
        time.sleep(st['sleep'])
    elif 'shot' in st:
        open(os.path.join(OUT, st['shot'] + '.jpg'), 'wb').write(base64.b64decode(w.call('Page.captureScreenshot', format='jpeg', quality=88)['data']))
print('errors', errs[:10])
json.dump({'errors': errs}, open(os.path.join(OUT, 'errors.json'), 'w'))
