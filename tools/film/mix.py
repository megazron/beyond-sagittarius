#!/usr/bin/env python3
"""The film's soundtrack, from the same timing as the picture. All sound is synthesised here; only the
voices are takes. Silence is a cue like any other: the crack gets a held breath, the black gets nothing.

  python tools/film/mix.py tools/film/entry_timing.json ~/bs-film/vo/entry out.wav"""
import json, os, sys
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly
tm, vo, out = sys.argv[1], os.path.expanduser(sys.argv[2]), os.path.expanduser(sys.argv[3])
T = json.load(open(tm)); SR = 48000; L = T['length']; N = int(L * SR) + SR; t = np.arange(N) / SR
rng = np.random.default_rng(4); S = {s['id']: s for s in T['shots']}
ramp = lambda a, b: np.clip((t - a) / max(b - a, 1e-3), 0, 1)
sm = lambda x: x * x * (3 - 2 * x)
def bp(x, lo, hi): return sosfilt(butter(2, [lo, hi], btype='band', fs=SR, output='sos'), x)
def lp(x, f): return sosfilt(butter(2, f, btype='low', fs=SR, output='sos'), x)
fall, hit, blk = S['d1']['t0'], S['d2']['t0'], S['d5']['t0']
# how much of the world is left: everything drops to nothing on the crack, and again on black
gate = (1 - .93 * sm(ramp(fall - .25, fall + .05))) * (1 - 0) ; gate = np.where(t > hit - .02, 1.0, gate); gate = gate * (1 - sm(ramp(blk - .05, blk + .02)))
press = sm(ramp(0, S['d2']['t0']))
# the drone: D minor, slow, sub rising with the gravity
drone = sum(a * np.sin(2 * np.pi * f * t + np.sin(t * .13 * (i + 1)) * 1.2) for i, (f, a) in enumerate(((36.7, .5), (55, .22), (73.4, .16), (87.3, .1), (110, .07))))
drone *= .25 + .75 * press
sub = lp(rng.normal(0, 1, N), 40) * 9 * press ** 2
# hull groans: metal under load, more often as it goes
groan = np.zeros(N)
for g in np.arange(S['b1']['t0'], fall, 2.2):
    a = int(g * SR); n = int(SR * (1.6 + rng.random() * 1.6)); f0 = 50 + rng.random() * 70
    ph = np.cumsum(f0 * (1 - .35 * np.linspace(0, 1, n) ** 2 + .05 * np.sin(np.linspace(0, 40, n))) / SR) * 2 * np.pi
    w = (np.sin(ph) + .5 * np.sin(ph * 2.03) + .3 * np.sin(ph * 3.4)) * np.hanning(n) ** .7 * (.3 + .7 * press[a])
    groan[a:a + n] += w[:len(groan[a:a + n])]
# alarm: starts when the deck tilts, dies when the glass goes
alarm = (np.sin(2 * np.pi * 620 * t) + .5 * np.sin(2 * np.pi * 930 * t)) * (np.mod(t, .9) < .22) * ((t > S['b3']['t0']) & (t < fall)) * .1
# the crack: a tick, a thin splintering, then the air leaves
crack = np.zeros(N)
for i in range(46):
    a = int((fall + .5 + rng.random() * 2.2) * SR); n = int(SR * .012)
    crack[a:a + n] += rng.normal(0, 1, n) * np.hanning(n) * (.15 + rng.random() * .4)
crack = bp(crack, 1800, 9000)
boom = np.exp(-np.clip(t - hit, 0, None) * 2.2) * (t >= hit) * (np.sin(2 * np.pi * 42 * t) + lp(rng.normal(0, 1, N), 900) * 4) * 1.1
gale = bp(rng.normal(0, 1, N), 300, 3200) * (.5 + .5 * np.sin(t * 2.1)) * sm(ramp(hit, hit + .4)) * (1 - sm(ramp(S['d4']['t0'], S['d4']['t0'] + 1.2))) * .32
# piano, three times only
def note(f, at, v=.3):
    x = np.zeros(N); a = int(at * SR); n = min(int(SR * 4), N - a); tt = np.arange(n) / SR
    x[a:a + n] = sum(np.sin(2 * np.pi * f * h * tt) * np.exp(-tt * (1.1 + h * .7)) / h for h in (1, 2, 3, 4.01)) * v
    return x
piano = note(146.8, 1.5) + note(220, 5.2, .22) + note(174.6, S['a2']['t0'] + 2) + note(293.7, S['d4']['t0'] + .3, .24) + note(349.2, S['d4']['t0'] + 3, .22) + note(146.8, S['d4']['t0'] + 6, .3)
beat = np.zeros(N)
for h in np.arange(S['d4']['t0'], blk, .85):
    a = int(h * SR); n = int(SR * .16); beat[a:a + n] += np.sin(2 * np.pi * 46 * np.arange(n) / SR) * np.hanning(n)
bed = (drone * .3 + sub * .35 + groan * .24 + alarm) * gate + crack * .9 + boom + gale * (t < blk) + piano * (t < blk + 3.5) + beat * .8 * (t < blk)
# voices, dry and close, with a little room
V = np.zeros(N)
for l in T['lines']:
    w, sr = sf.read(f"{vo}/{l['key']}.wav", dtype='float32'); w = w if w.ndim == 1 else w.mean(1)
    w = resample_poly(w, SR, sr); w = w / max(np.abs(w).max(), 1e-4) * .8
    a = int(l['t0'] * SR); e = min(a + len(w), N); V[a:e] += w[:e - a]
room = np.zeros(N)
for d, g in ((.031, .18), (.057, .12), (.093, .08)): room[int(d * SR):] += V[:-int(d * SR)] * g
duck = 1 - .55 * lp(np.minimum(np.abs(V) * 6, 1), 6)
mix = bed * duck + V + lp(room, 3500)
st = np.stack([mix + .12 * np.roll(bed, 240), mix + .12 * np.roll(bed, -240)], 1)
st = st / np.abs(st).max() * .92
sf.write(out, st.astype(np.float32)[:int(L * SR)], SR, subtype='PCM_16'); print('mix', round(L, 1), 's')
