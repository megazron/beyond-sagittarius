"""Picture/sound sync of a capture, measured: record `__bs.syncTest(N)` (a white frame and a click on the audio clock
every second) as a rec named `sync`, then this compares flashes with clicks.
  python3 tools/av_sync.py REC_DIR            (raw: frame timestamps + audio_t0)
  python3 tools/av_sync.py --mp4 FILE.mp4     (joined video; exit 1 if off by more than 60 ms or drifting 40 ms)"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image

def clicks(wav_cmd):
    raw = subprocess.run(wav_cmd, capture_output=True, check=True).stdout
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    sr = 48000; e = np.abs(a); out = []; i = 0; thr = 0.25 * e.max()
    while i < len(e):
        if e[i] > thr: out.append(i / sr); i += int(0.5 * sr)
        else: i += 1
    return np.array(out)

def flashes(times, bright):
    out = []; prev = False
    for t, b in zip(times, bright):
        on = b > 200
        if on and not prev: out.append(t)
        prev = on
    return np.array(out)

def pair(f, c):
    res = []
    for x in f:
        j = np.argmin(np.abs(c - x))
        if abs(c[j] - x) < 0.45: res.append((x, c[j] - x))
    return res

if sys.argv[1] == '--mp4':
    mp4 = sys.argv[2]
    c = clicks(['ffmpeg', '-v', 'error', '-i', mp4, '-ac', '1', '-ar', '48000', '-f', 's16le', '-'])
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', mp4, '-vf', 'scale=32:18,format=gray', '-f', 'rawvideo', '-'], capture_output=True, check=True).stdout
    fr = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 18 * 32).mean(1)
    f = flashes(np.arange(len(fr)) / 30.0, fr)
else:
    d = sys.argv[1]; m = json.load(open(os.path.join(d, 'meta.json'))); fr = m['frames']; t0 = fr[0][1]
    c = clicks(['ffmpeg', '-v', 'error', '-i', os.path.join(d, 'audio.webm'), '-ac', '1', '-ar', '48000', '-f', 's16le', '-']) + (m['audio_t0'] - t0)
    b = [np.asarray(Image.open(os.path.join(d, n)).convert('L').resize((32, 18))).mean() for n, _ in fr]
    f = flashes([t - t0 for _, t in fr], b)
p = pair(f, c)
print(f'flashes {len(f)} clicks {len(c)} paired {len(p)}')
if p:
    o = np.array([x[1] for x in p]) * 1000
    print('sound minus picture (ms): first %.0f last %.0f mean %.0f min %.0f max %.0f' % (o[0], o[-1], o.mean(), o.min(), o.max()))
    print('drift over the take: %.0f ms in %.0f s' % (o[-1] - o[0], p[-1][0] - p[0][0]))
    bad = abs(o.mean()) > 60 or abs(o[-1] - o[0]) > 40
    print('av_sync:', 'FAIL' if bad else 'ok')
    sys.exit(1 if bad else 0)
sys.exit(1)
