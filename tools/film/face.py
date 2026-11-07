"""Facial performance for rendered scenes: emotion per line, plus the small things that make a face alive.

Layers, per frame, as weights on the 34 CC0 expression units:
  emotion   arrives before the words (react first, speak second), leaves after them
  voice     brows lift on loud or high moments of the actual audio envelope
  life      blinks on phrase ends, trembling in grief or fear, nostrils on the breath, left and right never equal
"""
import math
import numpy as np

B = lambda w: {'eyebrows-left-inner-up': w, 'eyebrows-right-inner-up': w}
EMO = {
    'fear': {**B(.9), 'eye-left-opened-up': .7, 'eye-right-opened-up': .7, 'mouth-depression-retraction': .45, 'neck-platysma': .6},
    'grief': {**B(1.0), 'eyebrows-left-down': .25, 'eyebrows-right-down': .25, 'eye-left-slit': .35, 'eye-right-slit': .35, 'mouth-depression': .7, 'nose-left-elevation': .25, 'nose-right-elevation': .25},
    'anger': {'eyebrows-left-down': 1, 'eyebrows-right-down': 1, 'eye-left-slit': .45, 'eye-right-slit': .45, 'nose-left-elevation': .55, 'nose-right-elevation': .55, 'mouth-retraction': .4, 'neck-platysma': .5},
    'strain': {'eyebrows-left-down': .7, 'eyebrows-right-down': .7, 'eye-left-slit': .65, 'eye-right-slit': .65, 'mouth-retraction': .75, 'neck-platysma': .9, 'nose-left-dilatation': .6, 'nose-right-dilatation': .6},
    'tender': {**B(.4), 'mouth-corner-puller': .25, 'eye-left-slit': .2, 'eye-right-slit': .2},
    'shock': {**B(.5), 'eyebrows-left-up': .8, 'eyebrows-right-up': .8, 'eye-left-opened-up': 1, 'eye-right-opened-up': 1, 'mouth-part-later': .4},
    'suspicion': {'eyebrows-left-down': .75, 'eyebrows-right-up': .25, 'eye-left-slit': .5, 'eye-right-slit': .3, 'mouth-compression': .4},
    'calm': {},
}
TREMBLE = {'grief': .28, 'fear': .2, 'strain': .12}


def smooth(a, b, x):
    t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t)


def noise(t, s):
    return (math.sin(t + s) + .6 * math.sin(t * 1.73 + s * 2.3) + .3 * math.sin(t * 2.91 + s * 3.7)) / 1.9


def track(names, cues, t, seed=0.0, env=None, lip=None):
    """Weights for one character at time t. cues: [{t0, t1, emotion, k, react}], env(t) -> 0..1 voice level."""
    w = dict.fromkeys(names, 0.0); tr = 0.0
    for c in cues:
        a = smooth(c['t0'] - c.get('react', .6), c['t0'] + .1, t) * (1 - smooth(c['t1'] + .2, c['t1'] + 1.4, t)) * c.get('k', 1)
        if a <= 0: continue
        for u, v in EMO[c['emotion']].items():
            # no face is symmetrical: each side drifts on its own
            w[u] = max(w[u], a * v * (1 + .14 * noise(t * .9, seed + sum(map(ord, u)) % 17)))
        tr = max(tr, a * TREMBLE.get(c['emotion'], 0))
    if tr:
        q = tr * (.6 + .4 * noise(t * 2.1, seed + 3))
        w['mouth-compression'] += q * (.5 + .5 * math.sin(t * 47 + seed)); w['mouth-depression'] += q * (.5 + .5 * math.sin(t * 39 + seed + 1))
        for s in ('eyebrows-left-inner-up', 'eyebrows-right-inner-up'): w[s] += q * .35 * math.sin(t * 31 + seed)
    if lip:
        # the mouth follows this take's own sound, a frame ahead of it, as a mouth does
        o, r, wd = lip
        w['mouth-open'] += .62 * o; w['mouth-pursing'] += .55 * r; w['mouth-part-later'] += .5 * wd; w['mouth-retraction'] += .2 * wd
    if env:
        v = env(t)
        for s in ('eyebrows-left-up', 'eyebrows-right-up'): w[s] += .3 * v * v
        w['neck-platysma'] += .35 * v * v
    br = .5 + .5 * math.sin(t * 1.9 + seed)
    w['nose-left-dilatation'] += .22 * br; w['nose-right-dilatation'] += .18 * br
    # blinks: at the ends of phrases, and now and then
    for c in cues:
        d = t - c['t1'] - .08
        if 0 <= d < .22: b = math.sin(d / .22 * math.pi); w['eye-left-closure'] = max(w['eye-left-closure'], b); w['eye-right-closure'] = max(w['eye-right-closure'], b * .97)
    k = (t + seed) % 3.7
    if k < .2: b = math.sin(k / .2 * math.pi); w['eye-left-closure'] = max(w['eye-left-closure'], b); w['eye-right-closure'] = max(w['eye-right-closure'], b)
    return w


def kabsch(a, b):
    """Rotation and translation taking points a onto b."""
    ca, cb = a.mean(0), b.mean(0); H = (a - ca).T @ (b - cb); U, _, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T)); R = Vt.T @ np.diag([1, 1, d]) @ U.T
    return R, ca, cb


def apply(baked, bind, delta, names, w):
    """Add the units to one frame of a head, in the head's own frame. baked: world vertices (y up)."""
    wt = np.array([w.get(n, 0.0) for n in names], np.float32)
    if not wt.any(): return baked
    # the skull is what moves rigidly: fit on the top of the head, away from the jaw
    top = bind[:, 1] > np.percentile(bind[:, 1], 45)
    R, _, _ = kabsch(bind[top], baked[top])
    d = np.tensordot(wt, delta, 1)
    return baked + d @ R.T
