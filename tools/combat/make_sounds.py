#!/usr/bin/env python3
"""The fight's sounds, made from nothing (no recordings, no licences): the voices of the creatures of Verdaxis, blows,
bows and slings, the guardian. Writes public/audio/sfx/cb_*.ogg and adds them to the index.
  ~/bs-voice/.venv-tts2/bin/python tools/combat/make_sounds.py [name ...]   (only those names when given; numpy, scipy, soundfile, pyloudnorm, ffmpeg)"""
import json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import make_sounds as M  # the game's own helpers: filters, reverb, loudness, Opus writer
from make_sounds import bp, lp, hp, verb, env, write, SR, SFX

rng = np.random.default_rng(2189)
T = lambda s: np.arange(int(s * SR)) / SR
noise = lambda n: rng.standard_normal(n)
def glide(f0, f1, s, curve=1.0):
    k = np.linspace(0, 1, int(s * SR)) ** curve
    return 2 * np.pi * np.cumsum(f0 + (f1 - f0) * k) / SR
def decay(s, rate): return np.exp(-T(s) * rate)
def pulse(ph, sharp=6.0):
    """A throat: a pulse train, not a sine (rich in harmonics, like vocal folds)."""
    return np.tanh(np.sin(ph) * sharp) * 0.5 + np.sin(ph * 2) * 0.2

def growl(seed, s=1.3, f=58):
    r = np.random.default_rng(seed); n = int(s * SR)
    jit = np.cumsum(r.standard_normal(n)) * 0.0009
    ph = 2 * np.pi * np.cumsum(f * (1 + jit * 0.5 + 0.08 * np.sin(T(s) * 2 * np.pi * 0.7))) / SR
    y = pulse(ph) * (0.75 + 0.25 * np.sin(2 * np.pi * (24 + seed * 3) * T(s)))  # the rattle in it
    y = bp(y, 90, 420) * 1.5 + bp(y, 500, 1300) * 0.7 + bp(noise(n), 300, 1800) * 0.06
    return y * env(n, 0.18, 0.4)
def snarl(seed):
    n = int(0.55 * SR); ph = glide(70, 150, 0.55, 0.6)
    y = pulse(ph, 9) * (0.6 + 0.4 * np.sin(2 * np.pi * 34 * T(0.55)))
    y = bp(y, 150, 1800) + bp(noise(n), 900, 3800) * 0.35 * np.linspace(0.2, 1, n)
    return y * env(n, 0.04, 0.18)
def howl(seed):
    s = 2.2; ph = np.concatenate([glide(190, 300, 0.6), glide(300, 322, 1.0), glide(322, 230, 0.6)])
    y = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph) + bp(noise(len(ph)), 400, 1200) * 0.05
    return verb(y * env(len(ph), 0.25, 0.7), 2.4, 0.45, 2500)
def chitter(seed):
    r = np.random.default_rng(seed); n = int(0.7 * SR); y = np.zeros(n); t = 0.02
    while t < 0.62:
        m = int(0.018 * SR); i = int(t * SR); f = r.uniform(2200, 4200)
        y[i:i + m] += np.sin(2 * np.pi * f * np.arange(m) / SR) * np.exp(-np.arange(m) / SR * 260) * r.uniform(0.5, 1)
        t += r.uniform(0.035, 0.085)
    return bp(y, 1500, 6000)
def shriek(seed):
    s = 0.4; ph = glide(1300 + seed * 150, 2500, s, 0.5) + 6 * np.sin(2 * np.pi * 38 * T(s))
    y = np.tanh(np.sin(ph) * 3) + bp(noise(int(s * SR)), 2500, 7000) * 0.3
    return y * env(int(s * SR), 0.02, 0.2)
def snort(seed):
    s = 0.5; n = int(s * SR)
    y = lp(noise(n), 500) * decay(s, 9) * 2 + np.sin(glide(95, 60, s)) * decay(s, 6) * 0.9
    return y * env(n, 0.01, 0.2)
def bellow(seed):
    s = 1.5; n = int(s * SR); ph = glide(105, 72, s) + 3 * np.sin(2 * np.pi * 9 * T(s))
    y = pulse(ph, 5) * (0.7 + 0.3 * np.sin(2 * np.pi * 17 * T(s)))
    y = bp(y, 70, 300) * 1.6 + bp(y, 350, 900) * 0.8 + lp(noise(n), 700) * 0.12
    return verb(y * env(n, 0.12, 0.6), 1.2, 0.2, 1800)
def squeak(seed):
    s = 0.14; return np.sin(glide(2400 + seed * 200, 3600, s, 0.6)) * env(int(s * SR), 0.01, 0.07)
def hiss(seed):
    s = 1.0; n = int(s * SR); return hp(noise(n), 2500) * decay(s, 3.5) * env(n, 0.05, 0.3) + bp(noise(n), 600, 1500) * decay(s, 6) * 0.3
def whip(seed):
    s = 0.22; n = int(s * SR); k = np.linspace(0, 1, n)
    y = bp(noise(n), 800, 5000) * np.exp(-((k - 0.55) ** 2) / 0.02)
    c = np.zeros(n); i = int(0.6 * n); c[i:i + 200] = noise(200) * np.exp(-np.arange(200) / 30)
    return y + hp(c, 1500) * 1.4
def hum(seed):
    s = 2.4; t = T(s); y = np.sin(2 * np.pi * 55 * t) + 0.6 * np.sin(2 * np.pi * 110.7 * t) + 0.35 * np.sin(2 * np.pi * 164.2 * t) + 0.15 * np.sin(2 * np.pi * 221 * t)
    return verb(y * (0.8 + 0.2 * np.sin(2 * np.pi * 1.3 * t)) * env(len(t), 0.8, 0.9), 2.0, 0.3, 1500)
def beamcharge(seed):
    s = 1.25; ph = glide(160, 2200, s, 2.2); y = np.sin(ph) * 0.7 + np.sin(ph * 1.503) * 0.3 + bp(noise(int(s * SR)), 2000, 6000) * 0.1 * np.linspace(0, 1, int(s * SR))
    return y * env(int(s * SR), 0.2, 0.02) * np.linspace(0.3, 1, int(s * SR))
def beam(seed):
    s = 0.7; t = T(s); y = np.tanh(np.sin(2 * np.pi * 98 * t) * 8) * 0.6 + np.sin(2 * np.pi * 1480 * t + 4 * np.sin(2 * np.pi * 98 * t)) * 0.5 + hp(noise(len(t)), 3000) * 0.3
    return y * env(len(t), 0.01, 0.25)
def stomp(seed):
    s = 1.1; n = int(s * SR); y = np.sin(glide(62, 34, s)) * decay(s, 4) * 1.5 + lp(noise(n), 900) * decay(s, 7) * 0.8 + bp(noise(n), 1500, 4000) * decay(s, 14) * 0.2
    return verb(y, 1.0, 0.2, 1500)
def hit(seed):
    s = 0.22; n = int(s * SR); r = np.random.default_rng(seed)
    return np.sin(glide(r.uniform(95, 130), 55, s)) * decay(s, 22) + lp(noise(n), r.uniform(900, 1600)) * decay(s, 38) * 0.9
def clang(seed):
    s = 0.7; t = T(s); r = np.random.default_rng(seed); y = np.zeros(len(t))
    for f, a in [(820, 1), (1370, 0.7), (2140, 0.5), (3270, 0.35), (4610, 0.2)]: y += a * np.sin(2 * np.pi * f * r.uniform(0.97, 1.03) * t) * np.exp(-t * r.uniform(6, 12))
    y[:300] += noise(300) * np.exp(-np.arange(300) / 40) * 0.8
    return y
def crack(seed):
    s = 0.3; n = int(s * SR); r = np.random.default_rng(seed)
    y = bp(noise(n), 300, 2800) * decay(s, 26); y += np.sin(2 * np.pi * r.uniform(380, 760) * T(s)) * decay(s, 34) * 0.7
    i = int(0.05 * SR); y[i:i + 400] += noise(400) * np.exp(-np.arange(400) / 60) * 0.5
    return y
def twang(seed):
    s = 0.5; t = T(s); f = 170 + seed * 25
    y = sum(np.sin(2 * np.pi * f * k * t + 2 * np.sin(2 * np.pi * 31 * t) * np.exp(-t * 9)) * np.exp(-t * (7 + 4 * k)) / k for k in (1, 2, 3, 5))
    return y + bp(noise(len(t)), 900, 4500) * np.exp(-((t - 0.05) ** 2) / 0.0012) * 0.5
def whirr(seed):
    s = 0.9; t = T(s); return bp(noise(len(t)), 500, 2400) * (0.5 + 0.5 * np.sin(2 * np.pi * (5 + 9 * t) * t)) ** 3 * env(len(t), 0.1, 0.1)
def swing(seed):
    s = 0.28; n = int(s * SR); k = np.linspace(0, 1, n); r = np.random.default_rng(seed)
    return bp(noise(n), 300 + seed * 120, 2200 + seed * 500) * np.exp(-((k - 0.5) ** 2) / r.uniform(0.03, 0.05))
def zap(seed):
    s = 0.2; ph = glide(3200, 260, s, 0.4); y = np.tanh(np.sin(ph) * 4) * decay(s, 12); y[:200] += noise(200) * np.exp(-np.arange(200) / 25)
    return y + np.sin(2 * np.pi * 70 * T(s)) * decay(s, 20) * 0.8
def thud(seed):
    s = 0.6; n = int(s * SR); return np.sin(glide(70, 40, s)) * decay(s, 9) * 1.4 + lp(noise(n), 500) * decay(s, 12) + bp(noise(n), 800, 3000) * decay(s, 5) * 0.12 * env(n, 0.08, 0.3)
def heart(seed):
    s = 0.5; n = int(s * SR); y = np.zeros(n)
    for at, a, f in [(0.0, 1, 52), (0.17, 0.75, 62)]:
        i = int(at * SR); m = int(0.16 * SR); y[i:i + m] += a * np.sin(2 * np.pi * f * np.arange(m) / SR) * np.exp(-np.arange(m) / SR * 26)
    return lp(y, 160)
def rattle(seed):
    r = np.random.default_rng(seed); n = int(0.6 * SR); y = np.zeros(n); t = 0.0
    while t < 0.5:
        i = int(t * SR); m = 900; y[i:i + m] += bp(r.standard_normal(m), 1200, 5000) * np.exp(-np.arange(m) / 90) * r.uniform(0.5, 1); t += r.uniform(0.05, 0.11)
    return y

# the trap cue, made to be heard over a night bed (insects above 4 kHz) and the world's low footfalls: a dry twig
# that snaps in two or three quick cracks (a sharp click with a woody knock under it, 0.5 to 3 kHz), leaves and
# grass pushed aside, and the struggle of something caught (thrashing in the grass, a squeal, a thump on the ground)
def twig(seed):
    r = np.random.default_rng(seed + 40); s = 0.32; n = int(s * SR); y = np.zeros(n); t = 0.01
    for k in range(2 + seed % 2):
        i = int(t * SR); m = int(0.06 * SR); a = 1.0 if k == 0 else r.uniform(0.45, 0.7)
        click = hp(noise(m), 900) * np.exp(-np.arange(m) / (0.0025 * SR))
        knock = np.sin(2 * np.pi * r.uniform(520, 900) * np.arange(m) / SR) * np.exp(-np.arange(m) / (0.012 * SR))
        ring = np.sin(2 * np.pi * r.uniform(1800, 2600) * np.arange(m) / SR) * np.exp(-np.arange(m) / (0.006 * SR))
        y[i:i + m] += (click * 1.0 + knock * 0.8 + ring * 0.35) * a
        t += r.uniform(0.03, 0.07)
    return bp(y, 350, 7000)
def rustle(seed):
    r = np.random.default_rng(seed + 50); s = 0.6; n = int(s * SR); y = np.zeros(n); t = 0.0
    while t < s - 0.05:
        i = int(t * SR); m = int(r.uniform(0.008, 0.03) * SR)
        y[i:i + m] += noise(m) * np.hanning(m) * r.uniform(0.3, 1)
        t += r.uniform(0.004, 0.02)
    k = np.linspace(0, 1, n); swell = np.sin(np.pi * np.clip(k * 1.15, 0, 1)) ** 0.7
    return bp(y, 1200, 6500) * swell
def struggle(seed):
    r = np.random.default_rng(seed + 60); s = 0.9; n = int(s * SR)
    y = np.concatenate([rustle(seed + 7), np.zeros(n)])[:n] * 0.8
    y[int(0.3 * SR):] += np.concatenate([rustle(seed + 11), np.zeros(n)])[: n - int(0.3 * SR)] * 0.7
    for _ in range(2):
        i = int(r.uniform(0.05, 0.5) * SR); q = 0.16; m = int(q * SR)
        y[i:i + m] += np.sin(glide(r.uniform(1700, 2100), r.uniform(2500, 3100), q, 0.5)) * env(m, 0.01, 0.08) * 0.55
    i = int(r.uniform(0.1, 0.6) * SR); m = int(0.12 * SR)
    y[i:i + m] += np.sin(2 * np.pi * 110 * np.arange(m) / SR) * np.exp(-np.arange(m) / (0.02 * SR)) * 0.6
    return y
SOUNDS = [('growl', growl, 3), ('snarl', snarl, 2), ('howl', howl, 1), ('chitter', chitter, 3), ('shriek', shriek, 2), ('snort', snort, 2), ('bellow', bellow, 1),
          ('squeak', squeak, 2), ('hiss', hiss, 2), ('whip', whip, 2), ('hum', hum, 1), ('beamcharge', beamcharge, 1), ('beam', beam, 1), ('stomp', stomp, 1),
          ('hit', hit, 4), ('clang', clang, 2), ('crack', crack, 3), ('twang', twang, 2), ('whirr', whirr, 1), ('swing', swing, 3), ('zap', zap, 2), ('thud', thud, 2),
          ('heart', heart, 1), ('rattle', rattle, 2), ('twig', twig, 3), ('rustle', rustle, 3), ('struggle', struggle, 3)]
def main():
    idx_p = SFX / 'index.json'; index = json.loads(idx_p.read_text())
    only = set(sys.argv[1:])  # names to (re)make; all of them when none are given
    for k in [k for k in index if k.startswith('cb_') and (not only or k.rsplit('_', 1)[0][3:] in only)]: del index[k]
    for name, fn, n in SOUNDS:
        if only and name not in only: continue
        for i in range(1, n + 1):
            y = np.asarray(fn(i), np.float64); y = y / (np.abs(y).max() + 1e-9) * 0.8
            pad = np.zeros(int(0.02 * SR)); y = np.concatenate([y, pad])
            index[f'cb_{name}_{i}'] = write(f'cb_{name}_{i}', y, 'fx')
    idx_p.write_text(json.dumps(dict(sorted(index.items())), indent=0) + '\n')
    print(len([k for k in index if k.startswith('cb_')]), 'fight sounds;', len(index), 'in the index')
if __name__ == '__main__': main()
