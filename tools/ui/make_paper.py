#!/usr/bin/env python3
"""The choice layer's materials, drawn here from noise and arithmetic (no photos, no generated art):

- slip.webp: a Ledger slip torn from the book (9-slice for CSS border-image: the edges repeat, the corners stay).
  Cream laid paper with fibres, a little foxing near the edges, the top edge cut by a blade, the other three torn
  with a pale fibrous rim where the tear went through the paper.
- slip-dark.webp: the same slip in the Ledger's ink-blue binding cloth, for the "act" plates (a hand, a grab).
- brass.webp: a brushed brass name plate (9-slice) with a bevel and two pins, for "You are <name>".
- seal.webp: a pressed wax seal with an uneven rim, the key's place left plain in the middle.

Run: python3 tools/ui/make_paper.py   (numpy, Pillow). Seeds are fixed: the output is the same every run.
"""
import math
import pathlib

import numpy as np
from PIL import Image, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "textures" / "ui"


def value_noise(h, w, cells_y, cells_x, rng):
    """Smooth periodic value noise in [0,1] (periodic so the 9-slice middles repeat without a seam)."""
    g = rng.random((cells_y, cells_x))
    y = np.linspace(0, cells_y, h, endpoint=False)
    x = np.linspace(0, cells_x, w, endpoint=False)
    yi, xi = np.floor(y).astype(int), np.floor(x).astype(int)
    fy, fx = y - yi, x - xi
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    y0, y1 = yi % cells_y, (yi + 1) % cells_y
    x0, x1 = xi % cells_x, (xi + 1) % cells_x
    a = g[y0][:, x0]; b = g[y0][:, x1]; c = g[y1][:, x0]; d = g[y1][:, x1]
    fx = fx[None, :]; fy = fy[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(h, w, base, octaves, rng, aspect=1.0):
    out = np.zeros((h, w)); amp = 1.0; tot = 0.0
    for o in range(octaves):
        cy = max(1, int(base * 2 ** o)); cx = max(1, int(base * aspect * 2 ** o))
        out += amp * value_noise(h, w, cy, cx, rng); tot += amp; amp *= 0.5
    return out / tot


def edge_profile(n, rng, amp, jag):
    """A periodic 1D tear: slow wander plus fine jags (pixels inward from the edge)."""
    t = np.arange(n) / n
    v = np.zeros(n)
    for k in range(1, 7):
        v += rng.normal() / k ** 1.2 * np.sin(2 * math.pi * k * t + rng.random() * 6.28)
    v = (v - v.min()) / (np.ptp(v) + 1e-9)
    fine = rng.random(n)
    fine = np.convolve(np.concatenate([fine[-3:], fine, fine[:3]]), np.ones(3) / 3, "same")[3:-3]
    return amp * v + jag * fine


def fibres(h, w, count, rng, length=(6, 26)):
    """Short curved paper fibres: a light/dark signed map."""
    m = np.zeros((h, w))
    for _ in range(count):
        x, y = rng.random() * w, rng.random() * h
        a = rng.random() * math.pi; L = rng.uniform(*length); s = rng.choice([-1, 1]) * rng.uniform(0.3, 1)
        bend = rng.normal() * 0.05
        for i in range(int(L)):
            a += bend
            x += math.cos(a); y += math.sin(a)
            xi, yi = int(x) % w, int(y) % h
            m[yi, xi] += s
    return Image.fromarray(np.clip(m * 60 + 128, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))


def slip(w, h, seed, base, ink_edge, rim, cut_top=True):
    rng = np.random.default_rng(seed)
    # body colour: mottled, laid lines, fibres, foxing towards the edges
    mott = fbm(h, w, 3, 5, rng, aspect=w / h)
    laid = 0.5 + 0.5 * np.sin(np.arange(h)[:, None] * (2 * math.pi / 5.0)) * np.ones((1, w))
    fib = (np.asarray(fibres(h, w, int(w * h / 90), rng), float) - 128) / 128
    col = np.array(base, float)[None, None, :] * np.ones((h, w, 1))
    col *= (0.93 + 0.1 * mott)[..., None]
    col *= (0.992 + 0.008 * laid)[..., None]
    col += fib[..., None] * np.array([7, 6, 5])
    # tear: alpha with periodic profiles; distance from the torn line for the rim and the aged edge
    alpha = np.ones((h, w)); d_edge = np.full((h, w), 99.0)
    yy, xx = np.mgrid[0:h, 0:w]
    sides = {
        "top": (edge_profile(w, rng, 2 if cut_top else 7, 1 if cut_top else 3), yy, xx),
        "bottom": (edge_profile(w, rng, 11, 4), h - 1 - yy, xx),
        "left": (edge_profile(h, rng, 8, 4), xx, yy),
        "right": (edge_profile(h, rng, 8, 4), w - 1 - xx, yy),
    }
    for name, (prof, dist, along) in sides.items():
        p = prof[along] + 1.5
        dd = dist - p
        alpha = np.minimum(alpha, np.clip(dd + 0.5, 0, 1))
        d_edge = np.minimum(d_edge, dd)
    # the torn rim: pale fibre where the paper split (not on the blade-cut top)
    rim_k = np.clip(1 - np.abs(d_edge - 1.2) / 2.2, 0, 1) * (0.6 + 0.4 * fbm(h, w, 6, 3, rng, aspect=w / h))
    if cut_top:
        top_d = yy - sides["top"][0][xx] - 1.5
        rim_k *= np.clip((top_d - 2) / 3, 0, 1) + (top_d > d_edge + 0.5)
        rim_k = np.clip(rim_k, 0, 1)
    col = col * (1 - rim_k[..., None]) + np.array(rim, float)[None, None, :] * rim_k[..., None]
    # age: darker towards the edge, uneven foxing spots
    age = np.clip(1 - d_edge / 14, 0, 1) ** 1.6 * (0.5 + 0.8 * fbm(h, w, 4, 4, rng, aspect=w / h))
    col = col * (1 - 0.22 * age[..., None]) + np.array(ink_edge, float)[None, None, :] * 0.22 * age[..., None]
    fox = np.clip((fbm(h, w, 9, 3, rng, aspect=w / h) - 0.68) * 6, 0, 1) * np.clip(1 - d_edge / 40, 0, 1)
    col = col * (1 - 0.18 * fox[..., None]) + np.array([150, 105, 60], float)[None, None, :] * 0.18 * fox[..., None]
    rgba = np.dstack([np.clip(col, 0, 255), alpha * 255]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def brass(w, h, seed):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    brush = fbm(h, w, 40, 3, rng, aspect=0.05)  # long horizontal streaks
    light = 0.55 + 0.45 * np.cos((yy / h - 0.32) * math.pi * 1.1)  # a soft band of light across the plate
    base = np.array([150, 112, 58], float)
    hi = np.array([228, 196, 136], float)
    k = np.clip(light * (0.8 + 0.35 * brush), 0, 1.2)
    col = base[None, None] * (1 - k[..., None] * 0.7) + hi[None, None] * (k[..., None] * 0.7)
    # bevel: lit top-left, shadow bottom-right, 5 px
    b = 5.0
    dl, dt, dr, db = xx, yy, w - 1 - xx, h - 1 - yy
    edge = np.minimum.reduce([dl, dt, dr, db])
    bevel = np.clip(1 - edge / b, 0, 1)
    lit = ((dt < db) & (dt == edge)) | ((dl < dr) & (dl == edge))
    col = np.where((bevel > 0)[..., None] & lit[..., None], col * (1 - bevel[..., None] * 0.1) + 255 * bevel[..., None] * 0.25, col)
    col = np.where((bevel > 0)[..., None] & ~lit[..., None], col * (1 - bevel[..., None] * 0.45), col)
    # an engraved line inside the bevel
    groove = (np.abs(edge - 9) < 0.8)
    col[groove] *= 0.55
    groove_hi = (np.abs(edge - 10.2) < 0.6)
    col[groove_hi] = np.minimum(255, col[groove_hi] * 1.18)
    # two pins at the ends
    for cx in (17, w - 18):
        r = np.hypot(xx - cx, yy - h / 2)
        pin = r < 4.2
        sh = np.clip(1 - (np.hypot(xx - cx + 1.3, yy - h / 2 + 1.3)) / 4.2, 0, 1)
        col[pin] = (np.array([120, 86, 36])[None] + (sh[pin][:, None] * np.array([130, 120, 90])[None]))
        ring = (r >= 4.2) & (r < 5.4)
        col[ring] *= 0.5
    # rounded corners 4 px
    alpha = np.ones((h, w))
    for cx, cy in ((4, 4), (w - 5, 4), (4, h - 5), (w - 5, h - 5)):
        m = ((xx < 4) if cx == 4 else (xx > w - 5)) & ((yy < 4) if cy == 4 else (yy > h - 5))
        alpha[m] = np.clip(4.5 - np.hypot(xx - cx, yy - cy), 0, 1)[m]
    return Image.fromarray(np.dstack([np.clip(col, 0, 255), alpha * 255]).astype(np.uint8), "RGBA")


def seal(s, seed):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:s, 0:s].astype(float)
    c = s / 2
    dx, dy = xx - c, yy - c
    r, a = np.hypot(dx, dy), np.arctan2(dy, dx)
    # uneven pooled rim: radius wanders with angle
    wob = np.zeros_like(a)
    for k in range(2, 11):
        wob += rng.normal() / k * np.sin(k * a + rng.random() * 6.28)
    R = s * 0.44 * (1 + 0.035 * wob)
    alpha = np.clip(R - r + 0.5, 0, 1)
    # height: a pooled outer lip, a pressed flat middle, a raised ring of the stamp
    t = r / R
    lip = np.exp(-((t - 0.9) / 0.08) ** 2) * 0.9
    ring = np.exp(-((t - 0.66) / 0.03) ** 2) * 0.55
    dish = -0.25 * np.clip(1 - t / 0.6, 0, 1)
    hgt = lip + ring + dish + 0.06 * fbm(s, s, 8, 3, rng)
    gy, gx = np.gradient(hgt)
    shade = np.clip(0.75 - (gx * -0.7 + gy * -0.7) * 9, 0, 1.6)
    base = np.array([128, 24, 22], float)
    col = base[None, None] * shade[..., None]
    spec = np.clip((-(gx + gy) * 9 - 0.35), 0, 1) ** 2
    col += spec[..., None] * np.array([255, 170, 150]) * 0.6
    # a few tiny bubbles in the wax
    for _ in range(14):
        bx, by = c + rng.normal() * s * 0.2, c + rng.normal() * s * 0.2
        rr = np.hypot(xx - bx, yy - by)
        col[rr < 1.4] *= 0.7
    return Image.fromarray(np.dstack([np.clip(col, 0, 255), alpha * 255]).astype(np.uint8), "RGBA")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # 2x pixels; CSS slices them at 36 px of the image (18 px on screen)
    slip(480, 176, 11, base=(240, 230, 208), ink_edge=(120, 90, 55), rim=(252, 248, 236)).save(OUT / "slip.webp", lossless=False, quality=88, alpha_quality=90)
    slip(480, 176, 23, base=(34, 44, 58), ink_edge=(10, 12, 18), rim=(92, 98, 104)).save(OUT / "slip-dark.webp", lossless=False, quality=88, alpha_quality=90)
    slip(640, 240, 37, base=(238, 228, 205), ink_edge=(110, 82, 50), rim=(252, 248, 236), cut_top=False).save(OUT / "card.webp", lossless=False, quality=88, alpha_quality=90)
    brass(320, 64, 5).save(OUT / "brass.webp", lossless=False, quality=90, alpha_quality=95)
    seal(256, 3).save(OUT / "seal.webp", lossless=False, quality=90, alpha_quality=95)
    for f in sorted(OUT.glob("*.webp")):
        print(f.name, f.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
