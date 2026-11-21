"""Picture/sound sync of a capture, measured: record `__bs.syncTest(N)` (a white screen and a 1.5 kHz beep on the audio
clock every second, held 0.15 s) as a rec named `sync`, then this compares the flashes with the beeps.
  python3 tools/av_sync.py REC_DIR            (raw: frame timestamps + the recorder's start stamp, no mark fix)
  python3 tools/av_sync.py --mp4 FILE.mp4     (joined video; exit 1 if off by more than 60 ms or drifting 40 ms)
Beeps are found by pitch (tools/av_marks.py), so game sound under the test does not pair with the wrong flash."""
import json, os, subprocess, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from av_marks import tone_onsets, screen_onsets, align


def pcm(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768


if sys.argv[1] == '--mp4':
    mp4 = sys.argv[2]
    c = tone_onsets(pcm(mp4))
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', mp4, '-vf', 'scale=32:18,format=gray', '-f', 'rawvideo', '-'], capture_output=True, check=True).stdout
    fr = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 18 * 32).mean(1)
    f = screen_onsets(np.arange(len(fr)) / 30.0, fr)
else:
    d = sys.argv[1]; m = json.load(open(os.path.join(d, 'meta.json'))); fr = m['frames']; t0 = fr[0][1]
    c = tone_onsets(pcm(os.path.join(d, 'audio.webm'))) + (m['audio_t0'] - t0)
    b = [np.asarray(Image.open(os.path.join(d, n)).convert('L').resize((32, 18))).mean() for n, _ in fr]
    f = screen_onsets([t - t0 for _, t in fr], b)
p = align(f, c, near=0.45, ordered=False)
print(f'flashes {len(f)} beeps {len(c)} paired {len(p)}')
if len(p) >= 3:
    o = np.array([x[1] for x in p]) * 1000
    # the median is the offset; the drift is the slope through the pairs near it (a stray beep from the game, or a
    # flash caught a frame late, does not move either)
    t = np.array([x[0] for x in p]); med = np.median(o); keep = np.abs(o - med) < 80
    k = np.polyfit(t[keep], o[keep], 1) if keep.sum() >= 3 else np.array([0.0, med])
    drift = k[0] * (t[keep][-1] - t[keep][0]) if keep.sum() >= 3 else 0.0
    print('sound minus picture (ms): ' + ' '.join(f'{x:.0f}' for x in o))
    print('offset %.0f ms (median of %d), drift %.0f ms over %.0f s' % (med, keep.sum(), drift, t[-1] - t[0]))
    bad = abs(med) > 60 or abs(drift) > 40 or keep.sum() < 3
    print('av_sync:', 'FAIL' if bad else 'ok')
    sys.exit(1 if bad else 0)
print('av_sync: FAIL (too few flash/beep pairs)')
sys.exit(1)
