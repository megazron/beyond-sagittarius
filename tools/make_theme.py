#!/usr/bin/env python3
"""Composes and renders the title theme, "The Scatter". Everything here is original and
synthesised from scratch: no samples, no borrowed melody.

Writes two stems that start together, so the settings sliders keep working:
  public/audio/music/theme.mp3      the music
  public/audio/music/theme_sfx.mp3  the sound design, placed on the cuts

Timing comes from src/cinematic/beatmap.json, the file the montage cuts to.

Run: python tools/make_theme.py [--wav DIR]
Needs numpy, scipy and ffmpeg.
"""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

ROOT = Path(__file__).resolve().parent.parent
MAP = json.loads((ROOT / 'src/cinematic/beatmap.json').read_text())
SR = 44100
BEAT = 60 / MAP['bpm']
BARS = MAP['beatsPerBar']
S = MAP['sections']
TAIL = 3.0
N = int((MAP['length'] * BEAT + TAIL) * SR)
rng = np.random.default_rng(2189)

NOTE = {'C': 0, 'Db': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'Gb': 6, 'G': 7, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11}


def hz(n):
    """'A4' -> frequency."""
    name, octave = n[:-1], int(n[-1])
    return 440.0 * 2 ** ((NOTE[name] + 12 * (octave + 1) - 69) / 12)


CHORDS = {
    'Dm': ['D', 'F', 'A'], 'Bb': ['Bb', 'D', 'F'], 'C': ['C', 'E', 'G'], 'Am': ['A', 'C', 'E'], 'F': ['F', 'A', 'C'],
    'Gm': ['G', 'Bb', 'D'], 'A': ['A', 'Db', 'E'], 'D': ['D', 'Gb', 'A'], 'Asus': ['A', 'D', 'E'],
}


def stereo(n=N):
    return np.zeros((n, 2))


def put(bus, sig, beat, gain=1.0, pan=0.0):
    """Mix a mono or stereo signal into a bus at a beat."""
    i = int(beat * BEAT * SR)
    if i >= len(bus):
        return
    if sig.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * l, sig * r], 1) * 1.414
    n = min(len(sig), len(bus) - i)
    bus[i:i + n] += sig[:n] * gain


def lp(x, f, order=2):
    return sosfilt(butter(order, min(f, SR * 0.45), 'lp', fs=SR, output='sos'), x, axis=0)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'hp', fs=SR, output='sos'), x, axis=0)


def bp(x, a, b, order=2):
    return sosfilt(butter(order, [a, b], 'bp', fs=SR, output='sos'), x, axis=0)


def sweep_lp(x, f0, f1, curve=1.0):
    """Lowpass opening over the length of the signal, in blocks with carried state."""
    n, out, pos, zi = len(x), np.zeros_like(x), 0, None
    block = 2048
    while pos < n:
        k = (pos / n) ** curve
        f = f0 * (f1 / f0) ** k
        a = 1 - np.exp(-2 * np.pi * f / SR)
        seg = x[pos:pos + block]
        y = np.empty_like(seg)
        z = zi if zi is not None else np.zeros(seg.shape[1:]) if seg.ndim > 1 else 0.0
        for i in range(len(seg)):
            z = z + a * (seg[i] - z)
            y[i] = z
        out[pos:pos + block] = y
        zi = z
        pos += block
    return out


_tables = {}


def table(freq, shape):
    """One band-limited cycle: no aliasing on the high notes."""
    key = (shape, int(np.log2(max(freq, 20)) * 4))
    if key not in _tables:
        n = 4096
        ph = np.arange(n) / n * 2 * np.pi
        top = max(1, int(17000 / max(freq, 20)))
        t = np.zeros(n)
        for h in range(1, top + 1):
            if shape == 'saw':
                t += np.sin(h * ph) / h
            elif shape == 'square' and h % 2:
                t += np.sin(h * ph) / h
        _tables[key] = t / np.max(np.abs(t))
    return _tables[key]


def osc(freq, dur, shape='saw', phase=None, vib=None):
    """freq may be a number or an array over time."""
    n = int(dur * SR)
    f = np.full(n, float(freq)) if np.isscalar(freq) else freq[:n]
    if vib is not None:
        f = f * vib[:n]
    ph = np.cumsum(f) / SR + (rng.random() if phase is None else phase)
    t = table(float(np.mean(f)), shape)
    return np.interp((ph % 1) * len(t), np.arange(len(t)), t, period=len(t))


def env(n, a=0.005, d=0.1, s=0.7, r=0.05):
    e = np.ones(n) * s
    ai, di, ri = int(a * SR), int(d * SR), int(r * SR)
    ai = min(ai, n)
    e[:ai] = np.linspace(0, 1, ai)
    if di:
        m = min(di, n - ai)
        e[ai:ai + m] = np.linspace(1, s, di)[:m]
    if ri:
        m = min(ri, n)
        e[n - m:] *= np.linspace(1, 0, m)
    return e


def supersaw(freq, dur, voices=5, spread=0.012, shape='saw'):
    out = np.zeros((int(dur * SR), 2))
    for i in range(voices):
        k = (i - (voices - 1) / 2) / max(1, (voices - 1) / 2)
        s = osc(freq * (1 + k * spread), dur, shape)
        l, r = np.cos((k + 1) * np.pi / 4), np.sin((k + 1) * np.pi / 4)
        out[:, 0] += s * l
        out[:, 1] += s * r
    return out / voices ** 0.5


def piano(freq, dur=3.5, vel=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for h in range(1, 9):
        f = freq * h * np.sqrt(1 + 0.0004 * h * h)
        y += np.sin(2 * np.pi * f * t) * np.exp(-t * (0.9 + h * 0.75)) / h ** 1.4
    y += lp(rng.standard_normal(n), 2600) * np.exp(-t * 90) * 0.12 * vel
    return y * vel * env(n, 0.002, 0, 1, 0.1)


def kick(g=1.0):
    n = int(0.34 * SR)
    t = np.arange(n) / SR
    f = 46 + 115 * np.exp(-t * 34)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11)
    y += lp(rng.standard_normal(n), 5000) * np.exp(-t * 320) * 0.5
    return np.tanh(y * 2.2) * 0.8 * g


def snare(g=1.0):
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * (185 + 70 * np.exp(-t * 60)) * t) * np.exp(-t * 26)
    noise = hp(rng.standard_normal(n), 1300) * np.exp(-t * 17)
    return np.tanh((body * 0.9 + noise * 0.75) * 1.7) * 0.72 * g


def hat(open_=False, g=1.0):
    n = int((0.3 if open_ else 0.06) * SR)
    t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 7500) * np.exp(-t * (11 if open_ else 80)) * 0.3 * g


def crash(g=1.0, dur=4.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = hp(rng.standard_normal(n), 3200) * np.exp(-t * 1.5)
    for f in (3120, 4470, 5610, 7120, 8840):
        y += np.sin(2 * np.pi * f * t + rng.random() * 6) * np.exp(-t * 2.2) * 0.09
    return y * 0.55 * g


def tom(freq, g=1.0):
    n = int(0.7 * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * np.cumsum(freq * (1 + 0.8 * np.exp(-t * 26))) / SR) * np.exp(-t * 6.5)
    y += lp(rng.standard_normal(n), 1800) * np.exp(-t * 60) * 0.25
    return np.tanh(y * 1.5) * 0.8 * g


def reverb(sec=2.4, tone=5200, predelay=0.02):
    n = int(sec * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-t * 6.9 / sec)[:, None]
    ir = lp(ir, tone)
    ir[:int(predelay * SR)] = 0
    return ir / np.sqrt(np.sum(ir ** 2, axis=0))


def wet(x, ir, mix):
    y = np.stack([fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in (0, 1)], 1)
    return x + y * mix


def delay(x, beats, fb=0.35, mix=0.3, taps=4):
    d = int(beats * BEAT * SR)
    out = x.copy()
    for k in range(1, taps + 1):
        s = np.zeros_like(x)
        s[d * k:] = x[:-d * k]
        if k % 2:
            s = s[:, ::-1]
        out += s * mix * fb ** (k - 1)
    return out


def chord_notes(name, octave):
    """Close voicing starting at the root in an octave."""
    out, last = [], -1
    for n in CHORDS[name]:
        o = octave
        v = NOTE[n] + 12 * o
        while v <= last:
            o += 1
            v = NOTE[n] + 12 * o
        last = v
        out.append(f'{n}{o}')
    return out


def power(name, beats, g=1.0, mute=False):
    """Stacked distorted saws: the guitar wall, made of oscillators."""
    root = CHORDS[name][0]
    lo = 2 if NOTE[root] >= 5 else 3
    dur = beats * BEAT
    f = hz(f'{root}{lo}')
    sig = np.zeros((int(dur * SR), 2))
    for mult, gain in ((1, 1), (1.5, 0.8), (2, 0.7)):
        sig += supersaw(f * mult, dur, 3, 0.004) * gain
    sig = np.tanh(sig * (3.2 if not mute else 2.4))
    sig = lp(sig, 1100 if mute else 3400)
    sig = hp(sig, 90)
    e = env(len(sig), 0.002, 0.09 if mute else 0.2, 0.25 if mute else 0.75, 0.03)
    return sig * e[:, None] * 0.34 * g


def pad(name, beats, octave=3, cut=1400):
    dur = beats * BEAT
    sig = np.zeros((int(dur * SR), 2))
    for n in chord_notes(name, octave):
        sig += supersaw(hz(n), dur, 5, 0.006)
    sig = lp(sig, cut)
    return sig * env(len(sig), 0.5, 0, 1, 0.5)[:, None] * 0.11


def lead(notes, start):
    """(note or None, beats) list -> stereo line with glide and vibrato into the note."""
    total = sum(b for _, b in notes)
    dur = total * BEAT + 0.3
    n = int(dur * SR)
    f = np.zeros(n)
    amp = np.zeros(n)
    pos, last = 0.0, None
    for note, b in notes:
        i, j = int(pos * BEAT * SR), int((pos + b) * BEAT * SR)
        if note:
            tgt = hz(note)
            g = int(0.035 * SR)
            f[i:j] = tgt
            if last:
                m = min(g, j - i)
                f[i:i + m] = np.geomspace(last, tgt, m)
            t = np.arange(j - i) / SR
            vib = 1 + 0.006 * np.sin(2 * np.pi * 5.6 * t) * np.clip((t - 0.22) / 0.2, 0, 1)
            f[i:j] *= vib
            amp[i:j] = 1 - 0.25 * np.clip(t / (b * BEAT), 0, 1)
            amp[j - min(int(0.02 * SR), j - i):j] *= np.linspace(1, 0.1, min(int(0.02 * SR), j - i))
            last = tgt
        pos += b
    f[f == 0] = 220
    amp = lp(amp, 120)
    a = osc(f, dur, 'saw') + 0.7 * osc(f * 1.004, dur, 'saw') + 0.5 * osc(f * 0.5, dur, 'square')
    b_ = osc(f * 0.996, dur, 'saw') + 0.7 * osc(f * 1.002, dur, 'square')
    sig = np.stack([a, b_], 1) * amp[:, None]
    return lp(np.tanh(sig * 1.3), 5200) * 0.17


def make_music():
    drums, bass, gtr, keys, ld, arp = (stereo() for _ in range(6))

    # ---- Horizon: held breath ----
    motif = [(0, 'D5', 0.8), (3, 'A4', 0.6), (6, 'F5', 0.75), (8, 'E5', 0.7), (11, 'D5', 0.6), (14, 'A4', 0.5)]
    for b, n, v in motif:
        put(keys, piano(hz(n), 4, v), b, 0.5, 0.15)
    for b in (0, 8):
        put(keys, pad('Dm', 9, 3, 700), b, 1.0)
    for b in range(0, 32, 4):  # heartbeat
        for off, g in ((0, 1), (0.75, 0.6)):
            n = int(0.3 * SR)
            t = np.arange(n) / SR
            put(drums, np.sin(2 * np.pi * 52 * t) * np.exp(-t * 16) * 0.75, b + off, g * (0.55 + 0.45 * (b / 32)))

    # ---- Build: bars 5 to 8 ----
    prog = ['Bb', 'C', 'Am', 'A']
    for i, c in enumerate(prog):
        b = S['build'] + i * 4
        put(keys, pad(c, 4.4, 3, 1000 + i * 700), b, 1.0 + i * 0.1)
        put(keys, piano(hz(chord_notes(c, 4)[0]), 3, 0.7), b, 0.45, -0.2)
        for k, n in enumerate(chord_notes(c, 4) + chord_notes(c, 5)[:1]):
            put(keys, piano(hz(n), 1.6, 0.45), b + 1 + k * 0.5, 0.3, 0.3)
        # rolling arp, sixteenths, opening up
        tones = chord_notes(c, 4) + chord_notes(c, 5)
        for s in range(16):
            if b + s * 0.25 >= S['silence']:
                break
            n = tones[[0, 2, 1, 3, 2, 4, 3, 5][s % 8]]
            d = 0.16
            y = osc(hz(n), d, 'square') * np.exp(-np.arange(int(d * SR)) / SR * 26)
            put(arp, lp(y, 900 + (i * 16 + s) * 55), b + s * 0.25, 0.1 + i * 0.03, 0.5 * np.sin(s * 0.8))
        # toms march up
        pat = [0, 1.5, 3] if i < 2 else [0, 1, 1.5, 2.5, 3, 3.5]
        for p in pat:
            put(drums, tom(70 + i * 12 + p * 5, 0.6 + i * 0.1), b + p, 0.75, 0.3 * np.sin(p * 2))
    # snare roll into the silence
    b = S['build'] + 12.0
    k = 0
    while b < S['silence']:
        put(drums, snare(0.35 + 0.65 * k / 22), b, 0.75)
        b += 0.5 if k < 4 else 0.25 if k < 10 else 0.125
        k += 1

    # ---- Drop ----
    def beat_bar(b, c, stab=False, fill=False):
        """One bar of the driving rock beat with bass and wall."""
        root = CHORDS[c][0]
        lo = hz(f'{root}1' if NOTE[root] >= 5 else f'{root}2')
        for off in (0, 1.5, 2.5):
            put(drums, kick(), b + off, 1.0)
        for off in (1, 3):
            put(drums, snare(), b + off, 1.0)
        for off in np.arange(0, 4, 0.5):
            put(drums, hat(off == 3.5), b + off, 0.75, 0.2)
        for s in range(8):
            d = 0.5 * BEAT * 0.92
            y = osc(lo, d, 'saw') + 0.7 * osc(lo * 2, d, 'square') * 0.3
            y = lp(y, 520) * env(len(y), 0.002, 0.03, 0.8, 0.01)
            put(bass, np.tanh(y * 2.2), b + s * 0.5, 0.42)
        put(gtr, power(c, 1.5), b, 0.95, 0)
        for off in (1.5, 2, 2.5, 3, 3.5):
            put(gtr, power(c, 0.45, mute=True), b + off, 0.8)
        if fill:
            for i, off in enumerate((3, 3.25, 3.5, 3.75)):
                put(drums, tom(170 - i * 28), b + off, 0.9, 0.4 - i * 0.26)

    drop = ['Bb', 'C', 'Am', 'Dm', 'Bb', 'C']
    for i, c in enumerate(drop):
        beat_bar(S['drop'] + i * 4, c, fill=i in (3, 5))
        put(keys, pad(c, 4.2, 4, 3000), S['drop'] + i * 4, 1.1)
    put(drums, crash(1.1), S['drop'], 1.0)
    put(drums, crash(0.8), S['drop'] + 16, 1.0, -0.3)
    # the hook: climbs twice, the second time higher
    hook = [('F5', 1), ('G5', .5), ('A5', 1.5), ('Bb5', 1),
            ('C6', 1.5), ('Bb5', .5), ('A5', 1), ('G5', 1),
            ('A5', 1), ('E5', .5), ('A5', .5), ('C6', 1.5), ('B5', .5),
            ('A5', 3), ('F5', .5), ('G5', .5),
            ('F5', 1), ('G5', .5), ('A5', 1.5), ('D6', 1),
            ('E6', 1.5), ('D6', .5), ('C6', 1), ('Bb5', 1),
            ('A5', 8)]
    put(ld, lead(hook, S['drop']), S['drop'], 1.0)

    # ---- Planet: the band falls away ----
    for i, c in enumerate(['Gm', 'Asus']):
        b = S['planet'] + i * 4
        put(keys, pad(c, 4.4, 3, 1500), b, 1.5)
        put(keys, piano(hz(chord_notes(c, 5)[0]), 3.5, 0.8), b, 0.5, 0.2)
        for off in (0, 1.5, 2.5, 3):
            put(drums, kick(0.85), b + off, 0.85)
            d = 0.5 * BEAT
            root = hz(f'{CHORDS[c][0]}2' if NOTE[CHORDS[c][0]] < 5 else f'{CHORDS[c][0]}1')
            y = lp(osc(root, d, 'saw'), 420) * env(int(d * SR), 0.002, 0.04, 0.7, 0.01)
            put(bass, np.tanh(y * 2), b + off, 0.42)
    for off, g in ((6, .4), (6.5, .5), (7, .7), (7.25, .8), (7.5, .9), (7.75, 1)):
        put(drums, snare(g), S['planet'] + off, 0.8)

    # ---- Landing: three turns of a four-bar groove, a stab on every impact ----
    land = ['Dm', 'Bb', 'F', 'C'] * 3
    for i, c in enumerate(land):
        b = S['landing'] + i * 4
        beat_bar(b, c, fill=i % 2 == 1)
        put(keys, pad(c, 4.2, 4, 2200), b, 0.75)
        if i % 2 == 0:
            for n in chord_notes(c, 4) + chord_notes(c, 3):
                y = supersaw(hz(n), 0.45, 5, 0.008)
                y = lp(y, 3800) * env(len(y), 0.002, 0.12, 0.3, 0.1)[:, None]
                put(keys, y, b, 0.34)
            put(drums, crash(0.5, 2), b, 1.0, 0.25 if i % 4 else -0.25)
    # a small answer in the gap after each joke
    answer = [('D6', .5), ('C6', .5), ('A5', 1), ('C6', .5), ('D6', 1.5)]
    for i in range(1, 12, 2):
        if i < 11:
            put(ld, lead(answer, 0), S['landing'] + i * 4 + 0, 0.42)

    # ---- Rise ----
    for i, c in enumerate(['Bb', 'C']):
        b = S['rise'] + i * 4
        put(gtr, power(c, 4), b, 1.0)
        put(keys, pad(c, 4.2, 4, 3400 + 1500 * i), b, 1.3)
        n = hz(f'{CHORDS[c][0]}1' if NOTE[CHORDS[c][0]] >= 5 else f'{CHORDS[c][0]}2')
        for s in range(8):
            d = 0.5 * BEAT * 0.9
            y = lp(osc(n, d, 'saw'), 500) * env(int(d * SR), 0.002, 0.03, 0.8, 0.01)
            put(bass, np.tanh(y * 2.2), b + s * 0.5, 0.42)
    b, k = float(S['rise']), 0
    while b < S['hit'] - 0.25:
        put(drums, snare(0.45 + 0.55 * k / 40), b, 0.85)
        if k % 4 == 0:
            put(drums, kick(0.8), b, 0.9)
        b += 0.5 if k < 8 else 0.25 if k < 16 else 0.125
        k += 1
    put(ld, lead([('A5', 2), ('Bb5', 2), ('C6', 2), ('Db6', 1), ('E6', 0.75), (None, 0.25)], 0), S['rise'], 1.0)

    # ---- The hit: D major, where everything has been in minor ----
    hit = S['hit']
    put(drums, kick(1.4), hit, 1.1)
    put(drums, crash(1.5, 6), hit, 1.0)
    put(drums, crash(1.0, 6), hit, 0.8, 0.5)
    put(drums, tom(58, 1.4), hit, 1.0)
    put(gtr, power('D', 7) * np.exp(-np.arange(int(7 * BEAT * SR)) / SR * 0.55)[:, None], hit, 1.15)
    y = pad('D', 12, 4, 3600) * np.exp(-np.arange(int(12 * BEAT * SR)) / SR * 0.4)[:, None]
    put(keys, y, hit, 2.2)
    for n in ('D3', 'A3', 'D4', 'Gb4', 'A4', 'D5'):
        put(keys, piano(hz(n), 6, 1), hit, 0.42)
    tail = [('A5', 1), ('D6', 2), ('Gb6', 3), ('A6', 6)]
    y = lead(tail, 0)
    y *= np.linspace(1, 0.25, len(y))[:, None]
    put(ld, y, hit, 0.9)

    # ---- mix ----
    ir_big, ir_room = reverb(2.8), reverb(0.9, 7000)
    keys = wet(keys, ir_big, 0.42)
    arp = delay(arp, 0.75, 0.4, 0.4)
    arp = wet(arp, ir_big, 0.3)
    ld = delay(ld, 0.75, 0.35, 0.25)
    ld = wet(ld, ir_big, 0.3)
    drums = wet(drums, ir_room, 0.14)
    gtr = wet(gtr, ir_room, 0.1)

    # the pad ducks under the kick in the drop: that's the pump
    pump = np.ones(N)
    ks = [S['drop'] + i * 4 + o for i in range(6) for o in (0, 1.5, 2.5)] + [S['landing'] + i * 4 + o for i in range(12) for o in (0, 1.5, 2.5)]
    t = np.arange(int(0.26 * SR)) / SR
    dip = 1 - 0.5 * np.exp(-t * 14)
    for b in ks:
        i = int(b * BEAT * SR)
        n = min(len(dip), N - i)
        pump[i:i + n] = np.minimum(pump[i:i + n], dip[:n])
    keys *= pump[:, None]
    gtr *= (0.55 + 0.45 * pump)[:, None]

    mix = drums * 0.95 + bass * 0.9 + gtr * 0.95 + keys * 0.8 + ld * 1.05 + arp * 0.9
    # silence means silence
    i, j = int((S['silence'] + 0.02) * BEAT * SR), int(S['drop'] * BEAT * SR)
    w = np.ones(N)
    w[i - 600:i] = np.linspace(1, 0, 600)
    w[i:j] = 0
    mix *= w[:, None]
    return master(mix)


def master(x, peak=0.89):
    x = hp(x, 28)
    # glue: the drop sets the level, the hit leans into the soft clip above it
    i, j = int(S['drop'] * BEAT * SR), int(S['planet'] * BEAT * SR)
    x = x / np.percentile(np.abs(x[i:j]), 99.8) * 1.15
    x = np.tanh(x)
    x = x / np.max(np.abs(x)) * peak
    fade = int(0.5 * SR)
    x[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return x


def noise_rise(dur, f0=300, f1=7000, g=1.0):
    n = int(dur * SR)
    y = rng.standard_normal((n, 2))
    y = sweep_lp(y, f0, f1, 0.8) * np.linspace(0, 1, n)[:, None] ** 2
    return y * g


def whoosh(dur=0.42, pan_from=-0.9, pan_to=0.9, g=1.0):
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    y = bp(rng.standard_normal(n), 500, 5200) * np.sin(np.pi * t) ** 1.5
    pan = pan_from + (pan_to - pan_from) * t
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return np.stack([y * l, y * r], 1) * 1.1 * g


def boom(g=1.0, dur=2.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * np.cumsum(36 + 80 * np.exp(-t * 7)) / SR) * np.exp(-t * 2.4)
    y += lp(rng.standard_normal(n), 900) * np.exp(-t * 5) * 0.7
    y += hp(rng.standard_normal(n), 1800) * np.exp(-t * 30) * 0.5
    return np.tanh(y * 1.8) * g


def groan(dur=3.0, f=70):
    """Metal under load: inharmonic partials wandering against each other."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k, m in enumerate((1, 1.83, 2.71, 4.13, 5.9)):
        w = np.cumsum(f * m * (1 + 0.05 * np.sin(2 * np.pi * (0.4 + k * 0.23) * t + k))) / SR
        y += np.sin(2 * np.pi * w) / (k + 1.5)
    return bp(y, 80, 2600) * np.sin(np.pi * t / dur) ** 0.7 * 0.8


def pop(g=1.0):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    y = hp(rng.standard_normal(n), 900) * np.exp(-t * 38)
    for f in (420, 910, 1730):
        y += np.sin(2 * np.pi * f * t) * np.exp(-t * 16) * 0.4
    return y * g


def glass(g=1.0):
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    y = hp(rng.standard_normal(n), 2600) * np.exp(-t * 6) * 0.6
    for _ in range(90):
        at = int(rng.random() ** 2 * n * 0.8)
        m = int(0.09 * SR)
        f = 2300 + rng.random() * 7000
        s = np.sin(2 * np.pi * f * np.arange(m) / SR) * np.exp(-np.arange(m) / SR * 80) * (0.3 + rng.random() * 0.5) * np.exp(-at / SR * 2)
        y[at:at + m] += s[:n - at]
    return y * 0.8 * g


def air(dur, g=1.0):
    n = int(dur * SR)
    y = bp(rng.standard_normal((n, 2)), 180, 1900)
    return y * np.sin(np.pi * np.arange(n) / n)[:, None] ** 0.6 * 0.5 * g


def splash(g=1.0):
    n = int(2.2 * SR)
    t = np.arange(n) / SR
    y = bp(rng.standard_normal(n), 300, 6000) * np.exp(-t * 2.6)
    for _ in range(50):
        at = int((0.15 + rng.random() * 1.2) * SR)
        m = int(0.05 * SR)
        s = np.sin(2 * np.pi * (500 + rng.random() * 1800) * np.arange(m) / SR) * np.exp(-np.arange(m) / SR * 110) * 0.3
        y[at:at + m] += s
    return y * g


def make_sfx():
    fx = stereo()
    # Act I
    put(fx, noise_rise(12, 60, 500, 0.16), 0, 1.0)
    n = int(12 * SR)
    t = np.arange(n) / SR
    put(fx, np.sin(2 * np.pi * 31 * t) * 0.32 * np.clip(t / 4, 0, 1), 0, 1.0)  # the hole, more felt than heard
    put(fx, groan(4.2, 64), 6, 0.75, -0.3)
    put(fx, groan(3.0, 92), 10, 0.5, 0.4)
    for i, b in enumerate(MAP['plates']):
        put(fx, pop(0.7), b, 0.75, 0.6 * np.sin(i * 2.1))
    put(fx, glass(1), MAP['glass'], 0.9)
    put(fx, boom(0.7), MAP['glass'], 0.8)
    put(fx, air(4.8, 1), MAP['glass'], 0.85)
    put(fx, noise_rise(1.4, 400, 8000, 0.5), MAP['sections']['silence'] - 3.7, 1.0)
    # Act II
    put(fx, boom(1.0, 3), S['drop'], 1.0)
    for i, b in enumerate(MAP['whooshes']):
        s = 1 if i % 2 else -1
        put(fx, whoosh(0.5, -0.9 * s, 0.9 * s), b - 0.25, 0.55)
    put(fx, noise_rise(1.5, 700, 9000, 0.45), 48, 1.0)
    for b in MAP['faceHits']:
        put(fx, pop(1), b, 0.6)
        put(fx, boom(0.4, 0.5), b, 0.6)
    put(fx, noise_rise(3, 90, 900, 0.3), 56, 1.0)
    # Act III: each comet screams in, then lands exactly on the downbeat
    for i, b in enumerate(MAP['impacts']):
        put(fx, whoosh(0.8, 0.7 * (-1) ** i, -0.2 * (-1) ** i), b - 2, 0.8)
        put(fx, boom(1.1), b, 1.0)
        if i == 1:
            put(fx, splash(1), b, 0.9)
    for b in MAP['cards']:
        put(fx, pop(0.8), b, 0.45)
    # the giant walking behind Skyvra
    for off in (4, 6):
        put(fx, boom(0.55, 1.2), 88 + off, 0.8)
    # Act IV
    put(fx, noise_rise(4.5, 120, 9000, 0.6), S['rise'] - 4, 1.0)
    put(fx, noise_rise(3, 500, 12000, 0.8), S['hit'] - 8, 1.0)
    put(fx, boom(1.4, 4), S['hit'], 1.0)
    put(fx, air(4.5, 0.25), S['hit'] + 1, 1.0)
    return master(fx, 0.8)


def encode(x, name, wavdir):
    out = ROOT / 'public/audio/music' / name
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        wav = Path(wavdir or td) / (out.stem + '.wav')
        pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
        import wave
        with wave.open(str(wav), 'wb') as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav), '-c:a', 'libmp3lame', '-b:a', '160k', str(out)], check=True)
    print(name, f'{out.stat().st_size / 1e6:.2f} MB')


def report(x):
    for k in ('horizon', 'build', 'drop', 'planet', 'landing', 'rise', 'hit'):
        i = int(S[k] * BEAT * SR)
        seg = x[i:i + int(4 * BEAT * SR)]
        print(f'{k:9s} rms {20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9):6.1f} dB  peak {np.max(np.abs(seg)):.2f}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wav', help='keep the WAVs in this folder')
    a = ap.parse_args()
    music = make_music()
    report(music)
    encode(music, 'theme.mp3', a.wav)
    sfx = make_sfx()
    report(sfx)
    encode(sfx, 'theme_sfx.mp3', a.wav)


if __name__ == '__main__':
    main()
