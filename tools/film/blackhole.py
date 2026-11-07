#!/usr/bin/env python3
"""A black hole as an HDR environment: every pixel's ray is bent through Schwarzschild space, then hits
the accretion disk or the stars. All procedural, nothing sourced.

  python tools/film/blackhole.py out.hdr [--w 4096] [--phase 0]

The equirect is centred on the hole. Blender rotates it to wherever a shot wants the hole."""
import argparse, sys
import numpy as np
from scipy.ndimage import gaussian_filter

ap = argparse.ArgumentParser()
ap.add_argument('out'); ap.add_argument('--w', type=int, default=4096); ap.add_argument('--phase', type=float, default=0.0)
ap.add_argument('--cam', type=float, default=26.0); ap.add_argument('--tilt', type=float, default=8.0)
a = ap.parse_args()
W, H = a.w, a.w // 2
RS = 1.0                                     # Schwarzschild radius
IN, OUT = 2.6 * RS, 13.0 * RS                # disk edges
rng = np.random.default_rng(7)


def write_hdr(path, img):
    h, w, _ = img.shape
    with open(path, 'wb') as f:
        f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n' + f'-Y {h} +X {w}\n'.encode())
        m = img.max(2); e = np.ceil(np.log2(np.maximum(m, 1e-32))); s = np.exp2(8 - e)
        rgb = np.clip(img * s[..., None], 0, 255).astype(np.uint8)
        ee = np.clip(e + 128, 0, 255).astype(np.uint8); ee[m < 1e-30] = 0
        f.write(np.concatenate([rgb, ee[..., None]], 2).tobytes())


def noise_disk(r, ph):
    """Hot filaments that wind tighter inwards. Pure function of disk coordinates."""
    out = np.zeros_like(r)
    wind = ph + 2.6 * np.log(np.maximum(r, 1e-3)) + a.phase * 3.0 / np.maximum(r, 1) ** 1.5
    for k, (fa, fr, amp) in enumerate(((3, 3.1, .5), (7, 6.3, .3), (13, 11., .2), (29, 23., .12), (61, 47., .07))):
        s = rng.uniform(0, 6.28, 2)
        out += amp * np.sin(wind * fa + s[0] + 1.7 * np.sin(np.log(np.maximum(r, 1e-3)) * fr + s[1]))
    return 0.5 + 0.5 * np.tanh(out * 1.7)


def blackbody(t):
    """Rough colour from temperature 0..1: deep orange to blue white."""
    c = np.stack([np.clip(1.15 - 0.15 * (1 - t), 0, 1.3), .25 + .72 * t ** .8, .04 + .95 * t ** 2.2], -1)
    return c


def stars(d):
    """Background sky by final direction: a few bright points over a faint band."""
    lon = np.arctan2(d[:, 0], d[:, 2]); lat = np.arcsin(np.clip(d[:, 1], -1, 1))
    S = 2048
    u = ((lon / (2 * np.pi) + .5) * S * 2).astype(int) % (S * 2); v = np.clip(((lat / np.pi + .5) * S).astype(int), 0, S - 1)
    return STAR[v, u]


S = 2048
base = np.zeros((S, S * 2, 3), np.float32)
n = 26000
ys = rng.integers(0, S, n); xs = rng.integers(0, S * 2, n)
br = rng.pareto(2.2, n).astype(np.float32) * .35
tint = np.stack([1 + rng.normal(0, .18, n), np.ones(n), 1 + rng.normal(0, .25, n)], 1).astype(np.float32)
base[ys, xs] = br[:, None] * tint
STAR = gaussian_filter(base, (.7, .7, 0))
lat = (np.arange(S)[:, None] / S - .5) * np.pi
band = np.exp(-(lat / .28) ** 2) * (.5 + .5 * gaussian_filter(rng.normal(0, 1, (S, S * 2)), 40, mode='wrap') * 40)
STAR = STAR + np.clip(band, 0, 2)[..., None].astype(np.float32) * np.array((.014, .012, .02), np.float32)

# rays: equirect centred on +z = towards the hole
y, x = np.mgrid[0:H, 0:W].astype(np.float32)
lon = ((x + .5) / W - .5) * 2 * np.pi; la = (.5 - (y + .5) / H) * np.pi
D = np.stack([np.cos(la) * np.sin(lon), np.sin(la), np.cos(la) * np.cos(lon)], -1).reshape(-1, 3)
tilt = np.radians(a.tilt)
cam = np.array([0, a.cam * np.sin(tilt), -a.cam * np.cos(tilt)])
# aim the view centre at the hole
f = -cam / np.linalg.norm(cam); r_ = np.cross([0, 1, 0], f); r_ /= np.linalg.norm(r_); u_ = np.cross(f, r_)
R = np.stack([r_, u_, f], 1)
img = np.zeros((H * W, 3), np.float32)
CH = 1 << 18
for s0 in range(0, len(D), CH):
    d = (D[s0:s0 + CH] @ R.T).astype(np.float64)
    p = np.tile(cam, (len(d), 1)); v = d.copy()
    h2 = (np.cross(p, v) ** 2).sum(1)
    col = np.zeros((len(d), 3)); trans = np.ones(len(d)); live = np.ones(len(d), bool)
    for it in range(420):
        idx = np.nonzero(live)[0]
        if not len(idx):
            break
        P, Vv = p[idx], v[idx]
        r2 = (P * P).sum(1); r = np.sqrt(r2)
        ds = np.clip(.09 * r, .03, 1.6)
        acc = -1.5 * RS * h2[idx, None] * P / (r2 ** 2.5)[:, None]
        Vn = Vv + acc * ds[:, None]
        Pn = P + Vn * ds[:, None]
        # crossing the disk plane y=0
        c = (P[:, 1] * Pn[:, 1]) < 0
        if c.any():
            t = P[c, 1] / (P[c, 1] - Pn[c, 1]); hit = P[c] + (Pn[c] - P[c]) * t[:, None]
            rr = np.hypot(hit[:, 0], hit[:, 2]); ph = np.arctan2(hit[:, 2], hit[:, 0])
            on = (rr > IN) & (rr < OUT)
            if on.any():
                ii = idx[c][on]; rr, ph = rr[on], ph[on]
                edge = np.clip((rr - IN) / .5, 0, 1) * np.clip((OUT - rr) / 4.5, 0, 1)
                temp = np.clip((IN / rr) ** 1.1, 0, 1)
                # orbital motion: one side comes at us, brighter and bluer
                beta = np.sqrt(.5 * RS / rr)
                vdir = np.stack([-np.sin(ph), np.zeros_like(ph), np.cos(ph)], 1) * beta[:, None]
                nd = Vn[c][on]; nd = nd / np.linalg.norm(nd, axis=1, keepdims=True)
                g = np.sqrt(1 - beta ** 2) / (1 - (vdir * -nd).sum(1))
                I = edge * (.25 + 1.25 * noise_disk(rr, ph)) * temp ** 2.1 * 16 * g ** 3.2
                op = np.clip(.6 + .4 * edge, 0, .94)
                col[ii] += (trans[ii] * op * I)[:, None] * blackbody(np.clip(temp * g ** .7, 0, 1))
                trans[ii] *= 1 - op
        p[idx], v[idx] = Pn, Vn
        fall = r < RS * 1.02
        gone = (r > a.cam * 1.6) & ((P * Vn).sum(1) > 0)
        live[idx[fall | gone | (trans[idx] < .02)]] = False
        trans[idx[fall]] = 0
    vv = v / np.linalg.norm(v, axis=1, keepdims=True)
    sky = stars((vv @ R).astype(np.float32))
    img[s0:s0 + CH] = col + sky * trans[:, None]
    print(f'{s0 + CH}/{len(D)}', flush=True)
write_hdr(a.out, img.reshape(H, W, 3))
print('wrote', a.out)
