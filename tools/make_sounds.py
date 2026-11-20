#!/usr/bin/env python3
"""Sounds I make from nothing (no recording, no licence to track) for what the recorded library lacks:

  * amb_rain, amb_rain_in: rain outside, and the same rain heard through a roof and a window (a bed for weather)
  * siren_1..3: distant city sirens, a two-tone 2189 wail, far off and smeared by the streets
  * bird_1..8: birdsong phrases for the city's roofs and the planet's trees
  * hover_pass_1..3: a hover car going by, Doppler and all
  * step_metal_1..5: footsteps on the liner's deck plates (from Kenney's CC0 light metal impacts, cut short and damped)
  * crowd_walla: a bed of many people talking far away, made by stacking the game's own voice lines backwards,
    pitched and filtered until no word survives

Writes Opus files to public/audio/sfx/ and adds them to public/audio/sfx/index.json (the rest of that index stays).
Run after tools/fetch_sounds.py (which writes the index afresh): python3 tools/make_sounds.py
(numpy, scipy, soundfile, pyloudnorm, ffmpeg)
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal

ROOT = Path(__file__).resolve().parent.parent
SFX = ROOT / 'public' / 'audio' / 'sfx'
FFMPEG = shutil.which('ffmpeg') or str(Path.home() / '.local' / 'bin' / 'ffmpeg')
KENNEY = Path.home() / 'bs-assets-dl' / 'kenney'
SR = 48000
LUFS = {'bed': -26.0, 'fx': -18.0, 'step': -22.0}
OPUS = {'bed': ['-ac', '2', '-b:a', '40k'], 'fx': ['-ac', '1', '-b:a', '32k'], 'step': ['-ac', '1', '-b:a', '32k']}
rng = np.random.default_rng(2189)


def bp(y, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, hi], 'bandpass', fs=SR, output='sos'), y, axis=0)


def lp(y, f, order=2):
    return signal.sosfilt(signal.butter(order, f, 'lowpass', fs=SR, output='sos'), y, axis=0)


def hp(y, f, order=2):
    return signal.sosfilt(signal.butter(order, f, 'highpass', fs=SR, output='sos'), y, axis=0)


def pink(n):
    w = rng.standard_normal(n)
    b, a = [0.049922035, -0.095993537, 0.050612699, -0.004408786], [1, -2.494956002, 2.017265875, -0.522189400]
    return signal.lfilter(b, a, w)


def verb(y, secs=1.8, wet=0.35, bright=4000):
    """A plain reverb: convolution with decaying noise."""
    n = int(secs * SR)
    ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 7, n))
    ir = lp(ir, bright); ir /= np.sqrt((ir ** 2).sum())
    w = signal.fftconvolve(y, ir)[: len(y)]
    return y * (1 - wet) + w * wet * 2


def loop(y, fade=1.5):
    n = int(fade * SR)
    head, body, tail = y[:n], y[n:-n], y[-n:]
    k = np.linspace(0, 1, n)
    k = k[:, None] if y.ndim == 2 else k
    return np.concatenate([body, tail * (1 - k) + head * k])


def level(y, kind):
    m = pyln.Meter(SR, block_size=min(0.4, max(0.05, len(y) / SR - 0.01)))
    l = m.integrated_loudness(y.astype(np.float64))
    y = y * 10 ** ((LUFS[kind] - l) / 20)
    pk = np.abs(y).max()
    return y / pk * 0.89 if pk > 0.89 else y


def env(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na)
    if nr: e[-nr:] *= np.linspace(1, 0, nr)
    return e


def write(name, y, kind, looped=False):
    y = level(np.asarray(y, np.float32), kind).astype(np.float32)
    with tempfile.TemporaryDirectory() as td:
        w = Path(td, 'a.wav'); sf.write(w, y, SR, subtype='FLOAT')
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(w), '-c:a', 'libopus', *OPUS[kind], '-application', 'audio',
                        '-map_metadata', '-1', str(SFX / f'{name}.ogg')], check=True)
    return {'f': f'{name}.ogg', 'd': round(len(y) / SR, 2), 'loop': looped, 'kind': kind, 'made': True}


# ------------------------------------------------------------------------------------------------ rain
def rain(secs=34.0, indoor=False):
    n = int(secs * SR)
    out = np.zeros((n, 2))
    for ch in range(2):
        hiss = bp(pink(n), 400, 9000) * 0.5
        y = hiss
        # drops: thousands of tiny filtered ticks, a few heavier ones off gutters and leaves
        drops = np.zeros(n)
        for _ in range(int(secs * 900)):
            i = rng.integers(0, n - 400); drops[i] += rng.uniform(0.2, 1) * rng.choice([1, -1])
        tick = np.exp(-np.arange(240) / 22.0) * rng.standard_normal(240)
        y = y + bp(np.convolve(drops, tick)[:n], 1800, 9000) * 0.35
        heavy = np.zeros(n)
        for _ in range(int(secs * 7)):
            i = rng.integers(0, n - 3000); heavy[i] += rng.uniform(0.5, 1)
        plop = np.sin(2 * np.pi * np.linspace(0, 0.05, 2400) * rng.uniform(600, 1200)) * np.exp(-np.arange(2400) / 300)
        y = y + np.convolve(heavy, plop)[:n] * 0.25
        # the low wash of rain on everything far away
        y = y + lp(pink(n), 500) * 0.6
        if indoor:
            # through a roof and a closed window: the top gone, a patter on the glass
            y = lp(y, 1100, 4) * 1.4 + bp(np.convolve(drops[::1], tick)[:n], 900, 2500) * 0.08
        out[:, ch] = y
    return loop(out, 2.0)


# ------------------------------------------------------------------------------------------------ siren
def siren(seed, secs=11.0):
    r = np.random.default_rng(seed)
    n = int(secs * SR); t = np.arange(n) / SR
    period = r.uniform(2.6, 3.4)
    lo, hi = r.uniform(560, 680), r.uniform(1150, 1350)
    sweep = lo + (hi - lo) * (0.5 - 0.5 * np.cos(2 * np.pi * t / period))
    if seed % 2:  # the other kind: a two-tone hi-lo
        sweep = np.where((t // 0.55) % 2 == 0, hi * 0.9, lo * 1.15)
        sweep = signal.sosfiltfilt(signal.butter(1, 30, fs=SR, output='sos'), sweep)
    doppler = 1 + 0.025 * np.tanh((secs / 2 - t) / 2.5)  # coming, then going
    ph = 2 * np.cumsum(np.pi * sweep * doppler / SR)
    y = np.sin(ph) + 0.35 * np.sin(3 * ph) + 0.15 * np.sin(5 * ph)
    y *= 1 + 0.15 * np.sin(2 * np.pi * 7 * t)
    # far away: the air takes the top, the buildings smear it
    y = lp(y, 2200, 3)
    y = verb(y, 2.6, 0.55, 2500)
    a = np.exp(-((t - secs * r.uniform(0.4, 0.6)) / (secs * 0.3)) ** 2)
    return y * a * env(n, 0.5, 1.0)


# ------------------------------------------------------------------------------------------------ birds
def bird(seed):
    r = np.random.default_rng(seed)
    kind = seed % 4
    parts = []
    notes = r.integers(3, 8)
    base = r.uniform(2600, 4800)
    for k in range(notes):
        d = r.uniform(0.05, 0.16) if kind != 2 else r.uniform(0.2, 0.35)
        m = int(d * SR); tt = np.arange(m) / SR
        if kind == 0:   # quick falling chirps
            f = base * (1.25 - 0.5 * tt / d)
        elif kind == 1:  # rising whistle
            f = base * 0.7 * (0.8 + 0.5 * (tt / d) ** 1.5)
        elif kind == 2:  # slow two-note call, like a dove's cousin
            f = np.full(m, base * (0.32 if k % 2 else 0.27))
        else:            # trill
            f = base * (1 + 0.08 * np.sin(2 * np.pi * 38 * tt))
        f = f * (1 + 0.04 * r.standard_normal())
        ph = 2 * np.pi * np.cumsum(f) / SR
        y = np.sin(ph) + 0.12 * np.sin(2 * ph)
        y *= np.sin(np.pi * np.clip(tt / d, 0, 1)) ** 1.5
        parts += [y, np.zeros(int(r.uniform(0.03, 0.12) * SR))]
    y = np.concatenate(parts + [np.zeros(int(0.5 * SR))])
    return verb(hp(y, 1200), 0.9, 0.25, 7000)


# ------------------------------------------------------------------------------------------------ hover pass
def hover(seed, secs=5.0):
    r = np.random.default_rng(seed)
    n = int(secs * SR); t = np.arange(n) / SR
    tc = secs * r.uniform(0.42, 0.55)
    v, dmin = r.uniform(12, 22), r.uniform(4, 9)
    x = v * (t - tc); dist = np.sqrt(x ** 2 + dmin ** 2)
    radial = np.gradient(dist, 1 / SR)
    dop = 343 / (343 + radial)
    gain = 1 / (dist / dmin)
    f0 = r.uniform(85, 130)
    ph = 2 * np.pi * np.cumsum(f0 * dop) / SR
    hum = np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.3 * np.sin(3.01 * ph) + 0.15 * np.sin(5.02 * ph)
    whine_ph = 2 * np.pi * np.cumsum(r.uniform(900, 1400) * dop) / SR
    whine = 0.08 * np.sin(whine_ph)
    air = bp(rng.standard_normal(n), 200, 5000) * 0.6
    air = lp(air * gain ** 0.5, 3500)
    y = (hum * 0.6 + whine + air) * gain
    return y * env(n, 0.3, 0.4)


# ------------------------------------------------------------------------------------------------ metal steps
def metal_steps():
    out = []
    files = sorted((KENNEY / 'impact-sounds').rglob('impactMetal_light_*.ogg'))[:5]
    for f in files:
        y, sr = sf.read(f, dtype='float64')
        if y.ndim > 1: y = y.mean(1)
        y = signal.resample_poly(y, SR, sr)[: int(0.28 * SR)]
        y = lp(y, 3000) * np.exp(-np.arange(len(y)) / (0.05 * SR))
        thud = lp(rng.standard_normal(len(y)), 180) * np.exp(-np.arange(len(y)) / (0.03 * SR)) * 3
        out.append(y + thud)
    return out


# ------------------------------------------------------------------------------------------------ crowd walla
def walla(secs=40.0):
    """Many people talking far off: the game's own lines, reversed (so no word can be heard), pitched up and down,
    scattered over time and both ears, then smeared."""
    vo = sorted((ROOT / 'public/audio/vo/en').glob('*.ogg'))
    if not vo:
        return None
    pick = rng.choice(len(vo), size=min(60, len(vo)), replace=False)
    n = int(secs * SR); out = np.zeros((n, 2))
    with tempfile.TemporaryDirectory() as td:
        for k, i in enumerate(pick):
            w = Path(td, f'{k}.wav')
            rate = rng.uniform(0.86, 1.14)
            subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(vo[i]), '-ac', '1', '-ar', str(int(SR / rate)), str(w)], check=True)
            y, _ = sf.read(w, dtype='float64')
            y = y[::-1] * rng.uniform(0.3, 1)
            at = int(rng.uniform(-0.2, 1) * n)
            pan = rng.uniform(0, 1)
            for ch, g in ((0, np.sqrt(1 - pan)), (1, np.sqrt(pan))):
                for off in (at, at - n):  # wraps round, so the loop has no gap
                    a, b = max(0, off), min(n, off + len(y))
                    if b > a:
                        out[a:b, ch] += y[a - off:b - off] * g
    out = lp(hp(out, 250), 2600)
    out = np.stack([verb(out[:, c], 1.4, 0.5, 3000) for c in range(2)], 1)
    return out


def main():
    idx_p = SFX / 'index.json'
    index = json.loads(idx_p.read_text())
    index['amb_rain'] = write('amb_rain', rain(), 'bed', True)
    index['amb_rain_in'] = write('amb_rain_in', rain(indoor=True), 'bed', True)
    for i in range(1, 4):
        index[f'siren_{i}'] = write(f'siren_{i}', siren(i), 'fx')
    for i in range(1, 9):
        index[f'bird_{i}'] = write(f'bird_{i}', bird(i), 'fx')
    for i in range(1, 4):
        index[f'hover_pass_{i}'] = write(f'hover_pass_{i}', hover(i), 'fx')
    for i, y in enumerate(metal_steps(), 1):
        index[f'step_metal_{i}'] = write(f'step_metal_{i}', y, 'step')
    w = walla()
    if w is not None:
        index['amb_walla'] = write('amb_walla', loop(w, 2.0), 'bed', True)
    idx_p.write_text(json.dumps(dict(sorted(index.items())), indent=0) + '\n')
    print(len(index), 'sounds in the index')


if __name__ == '__main__':
    main()
