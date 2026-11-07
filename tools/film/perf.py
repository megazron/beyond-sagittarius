#!/usr/bin/env python3
"""Timing plus takes -> performance: emotion cues per character, and mouth curves from the audio itself.
  ~/bs-voice/.venv-tts2/bin/python tools/film/perf.py tools/film/entry_timing.json ~/bs-film/vo/entry ~/bs-film/entry_perf.json"""
import json, os, sys
import numpy as np, librosa
tm, vo, out = sys.argv[1], os.path.expanduser(sys.argv[2]), os.path.expanduser(sys.argv[3])
T = json.load(open(tm)); P = {}; FPS = 24
n = int(T['length'] * FPS) + 2
for l in T['lines']:
    p = P.setdefault(l['who'], dict(cues=[], open=[0.0] * n, round=[0.0] * n, wide=[0.0] * n))
    p['cues'].append(dict(t0=l['t0'], t1=l['t1'], emotion=l['emotion'], k=l['k'], react=.7))
    y, sr = librosa.load(f"{vo}/{l['key']}.wav", sr=16000)
    hop = sr // FPS
    rms = librosa.feature.rms(y=y, frame_length=hop * 2, hop_length=hop)[0]; rms = rms / max(rms.max(), 1e-5)
    cen = librosa.feature.spectral_centroid(y=y, sr=sr, n_fft=1024, hop_length=hop)[0]
    c = np.clip((cen - 900) / 1800, 0, 1)
    for i, v in enumerate(rms):
        f = int(l['t0'] * FPS) + i
        if f >= n: break
        o = float(v) ** .7; k = float(c[min(i, len(c) - 1)])
        p['open'][f] = max(p['open'][f], o); p['wide'][f] = o * k; p['round'][f] = o * (1 - k)
json.dump(P, open(out, 'w')); print({k: len(v['cues']) for k, v in P.items()})
