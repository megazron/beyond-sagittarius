#!/usr/bin/env python3
"""Mouth tracks for every voice clip, read from the audio itself.

For each public/audio/vo/<lang>/*.mp3 this writes one entry in lipsync.json:
25 frames per second, three values 0..9 per frame as a digit string:
  open  : loudness envelope (jaw)
  round : share of energy below 700 Hz in voiced frames (oo, oh)
  wide  : share of energy above 2 kHz (ee, s)
The game plays these against the clip's clock, so silence means a closed mouth.

Run: python tools/tts/lipsync.py   (numpy + ffmpeg only; fast, safe to re-run)
"""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
FFMPEG = shutil.which('ffmpeg') or str(Path.home() / '.local' / 'bin' / 'ffmpeg')
SR, FPS = 16000, 25
HOP = SR // FPS


def pcm(path: Path) -> np.ndarray:
    raw = subprocess.run([FFMPEG, '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def track(x: np.ndarray) -> str:
    n = len(x) // HOP
    if n < 2:
        return ''
    win = np.hanning(HOP * 2)
    freqs = np.fft.rfftfreq(HOP * 2, 1 / SR)
    low, high = freqs < 700, freqs > 2000
    rms, rnd, wide = np.zeros(n), np.zeros(n), np.zeros(n)
    for i in range(n):
        seg = x[i * HOP:i * HOP + HOP * 2]
        if len(seg) < HOP * 2:
            seg = np.pad(seg, (0, HOP * 2 - len(seg)))
        s = np.abs(np.fft.rfft(seg * win)) ** 2
        tot = s.sum() + 1e-9
        rms[i] = np.sqrt(np.mean(seg ** 2))
        rnd[i] = s[low].sum() / tot
        wide[i] = s[high].sum() / tot
    ref = np.percentile(rms, 95) + 1e-6
    op = np.clip((rms / ref - 0.08) / 0.92, 0, 1) ** 0.75
    # jaws don't teleport: a short smooth keeps consonants from flickering
    k = np.array([0.25, 0.5, 0.25])
    op = np.convolve(op, k, 'same')
    rnd = np.clip((rnd - 0.72) / 0.25, 0, 1) * (op > 0.12)
    wide = np.clip((wide - 0.04) / 0.3, 0, 1) * (op > 0.08)
    q = lambda a: ''.join(str(int(round(v * 9))) for v in a)
    return f'{q(op)}|{q(rnd)}|{q(wide)}'


def main():
    for d in sorted((ROOT / 'public' / 'audio' / 'vo').iterdir()):
        if not d.is_dir():
            continue
        out = {f.stem: track(pcm(f)) for f in sorted(d.glob('*.mp3'))}
        (d / 'lipsync.json').write_text(json.dumps(out, separators=(',', ':')))
        print(d.name, len(out), (d / 'lipsync.json').stat().st_size // 1024, 'KiB')


if __name__ == '__main__':
    main()
