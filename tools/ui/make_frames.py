#!/usr/bin/env python3
"""UI surfaces for the wrist unit and the field manual: scuffed instrument frames,
keycaps and paper, drawn procedurally with numpy and written to public/ui/.

Run: python tools/ui/make_frames.py   (needs numpy and Pillow)
Slice sizes must match the border-image rules in src/style.css.
"""
import pathlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = pathlib.Path(__file__).resolve().parents[2] / "public" / "ui"
SS = 2  # supersampling


def noise(h, w, sy, sx, seed):
    """Periodic gaussian noise, normalised to 0..1."""
    r = np.random.default_rng(seed).standard_normal((h, w))
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    k = np.exp(-2 * np.pi**2 * ((fy * sy) ** 2 + (fx * sx) ** 2))
    n = np.fft.ifft2(np.fft.fft2(r) * k).real
    n -= n.min()
    return n / n.max()


def sdf(h, w, inset, chamfer):
    """Signed distance to a chamfered rectangle (negative inside)."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float64)
    px = np.abs(x + 0.5 - w / 2)
    py = np.abs(y + 0.5 - h / 2)
    a, b = w / 2 - inset, h / 2 - inset
    d = np.maximum(px - a, py - b)
    return np.maximum(d, (px + py - (a + b - chamfer)) / np.sqrt(2))


def rsdf(h, w, inset, rad):
    """Signed distance to a rounded rectangle."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float64)
    qx = np.abs(x + 0.5 - w / 2) - (w / 2 - inset - rad)
    qy = np.abs(y + 0.5 - h / 2) - (h / 2 - inset - rad)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - rad


def light(d):
    """Top-left lit bevel term from a distance field: +1 facing the light."""
    gy, gx = np.gradient(d)
    n = np.hypot(gx, gy) + 1e-6
    return (-gx - gy) / n / np.sqrt(2)


def scratches(h, w, count, seed, length=(30, 240), width=1):
    im = Image.new("L", (w, h), 0)
    dr = ImageDraw.Draw(im)
    r = np.random.default_rng(seed)
    for _ in range(count):
        x, y = r.uniform(0, w), r.uniform(0, h)
        a, ln = r.normal(0.2, 0.9), r.uniform(*length)
        pts = [(x, y)]
        for _k in range(4):
            a += r.normal(0, 0.06)
            x += np.cos(a) * ln / 4
            y += np.sin(a) * ln / 4
            pts.append((x, y))
        dr.line(pts, fill=int(r.uniform(60, 220)), width=width)
    return np.asarray(im.filter(ImageFilter.GaussianBlur(0.6)), dtype=np.float64) / 255


def mix(a, b, t):
    return a * (1 - t[..., None]) + b * t[..., None]


def rgb(hexcol):
    return np.array([int(hexcol[i : i + 2], 16) for i in (1, 3, 5)], dtype=np.float64)


def save(arr, name, size, quality=92):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA" if arr.shape[2] == 4 else "RGB")
    if size:
        im = im.resize(size, Image.LANCZOS)
    im.save(OUT / name, "WEBP", quality=quality, alpha_quality=90, method=6)
    print(name, im.size, (OUT / name).stat().st_size // 1024, "KB")


def screw(img, cx, cy, r, seed):
    """Slotted screw head, burred from a few too many services."""
    h, w = img.shape[:2]
    y, x = np.mgrid[0:h, 0:w].astype(np.float64)
    d = np.hypot(x - cx, y - cy)
    rng = np.random.default_rng(seed)
    head = np.clip(r - d, 0, 1)
    lit = np.clip(0.55 + ((cx - x) + (cy - y)) / (r * 3.2), 0, 1)
    col = (rgb("#4d4a40")[None, None, :] * (0.55 + 0.9 * lit[..., None]))
    ang = rng.uniform(0, np.pi)
    dx, dy = np.cos(ang), np.sin(ang)
    along = (x - cx) * dx + (y - cy) * dy
    across = np.abs((x - cx) * -dy + (y - cy) * dx)
    slot = np.clip(r * 0.17 - across, 0, 1) * (np.abs(along) < r * 0.86)
    col = mix(col, rgb("#0d0c09")[None, None, :], slot)
    ring = np.clip(1.6 - np.abs(d - r), 0, 1) * 0.6
    sh = np.clip(1 - (np.hypot(x - cx - r * 0.12, y - cy - r * 0.16) - r) / (r * 0.35), 0, 1) * (d >= r)
    img[..., :3] = mix(img[..., :3], np.zeros(3)[None, None, :], sh * 0.6)
    img[..., :3] = mix(img[..., :3], col, head)
    img[..., :3] = mix(img[..., :3], rgb("#0f0e0b")[None, None, :], ring)


def frame(name, px, ring, chamfer, inner_chamfer, paint, seed, screws=0.0, wear=0.6, inner_alpha=255, thick=None):
    """Metal frame around a recess. px: output size; ring: frame width in output px."""
    n = px * SS
    R = ring * SS
    do = sdf(n, n, 0.5 * SS, chamfer * SS)
    di = sdf(n, n, R, inner_chamfer * SS)
    grain_h = noise(n, n, 0.7, 30 * SS, seed)
    grain_v = noise(n, n, 30 * SS, 0.7, seed + 1)
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    top_bottom = np.abs(y - n / 2) > np.abs(x - n / 2)
    grain = np.where(top_bottom, grain_h, grain_v)
    blotch = noise(n, n, 40 * SS, 40 * SS, seed + 2)
    speck = noise(n, n, 2.2 * SS, 2.2 * SS, seed + 3)
    # paint with blotches and fine grain
    base = rgb(paint)[None, None, :] * (0.78 + 0.32 * blotch[..., None] + 0.2 * (grain[..., None] - 0.5))
    # bare metal shows where paint wore off: outer corners and the odd knock
    edge = np.exp(do / (3.2 * SS)) + 0.55 * np.exp(-np.abs(di) / (2.4 * SS))
    fine = noise(n, n, 1.1 * SS, 1.1 * SS, seed + 7)
    wearmap = 0.6 * speck + 0.4 * fine + 0.3 * edge * wear + 0.2 * (blotch - 0.5)
    chip = np.clip((wearmap - 0.76) * 22, 0, 1)
    bare = rgb("#7c786c")[None, None, :] * (0.7 + 0.5 * grain[..., None])
    img = mix(base, bare, chip)
    sc = scratches(n, n, int(px * 0.24), seed + 4, (20 * SS, 130 * SS), max(1, SS - 1))
    img = img + sc[..., None] * 34
    # bevels
    lo = light(do)
    band = np.exp(do / (1.9 * SS))
    img = img + (lo * band)[..., None] * 58
    li = light(-di)
    lip = np.exp(-np.abs(di + 0.6 * SS) / (1.5 * SS))
    img = img + (li * lip)[..., None] * 40
    img = np.dstack([img, np.full((n, n), 255.0)])
    if screws:
        off = (ring * 0.5 + chamfer * 0.12) * SS
        for k, (cx, cy) in enumerate([(off, off), (n - off, off), (off, n - off), (n - off, n - off)]):
            screw(img, cx, cy, screws * SS, seed + 10 + k)
    # recess: dark, shadow falling from the top-left lip
    recess = np.clip(0.5 - di / SS, 0, 1)
    shadow = np.exp(di / (4.5 * SS)) * 0.8
    scr = rgb("#0e0c08")[None, None, :] * (1 - shadow[..., None] * 0.7)
    img[..., :3] = mix(img[..., :3], scr, recess)
    img[..., 3] = np.clip(0.5 - do / SS, 0, 1) * 255 * (1 - recess) + recess * inner_alpha
    save(img, name, (px, px))


def key(name, px, rad, col, seed, down=False, wear=0.5, lit=1.0):
    """Keycap, nine-sliced. Pressed caps sit lower and lose their lip."""
    n = px * SS
    lip = (2 if down else 5) * SS
    d = rsdf(n, n, 1 * SS, rad * SS)
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    # top surface sits above the lip
    dt = rsdf(n, n, 1 * SS, rad * SS)
    dtop = np.maximum(dt, -(n - lip - 1 * SS - y) + 0)  # cut at lip line, softened below
    speck = noise(n, n, 1.7 * SS, 1.7 * SS, seed)
    blotch = noise(n, n, 24 * SS, 24 * SS, seed + 1)
    base = rgb(col)[None, None, :] * (0.86 + 0.26 * blotch[..., None] + 0.12 * (speck[..., None] - 0.5))
    img = base.copy()
    # dome: brighter along the top, dim towards the lip
    grad = np.clip(1 - y / (n * 0.92), 0, 1)
    img = img * (0.8 + 0.38 * lit * grad[..., None])
    edge = np.exp(dt / (3 * SS))
    wearmap = speck + 0.34 * edge * wear + 0.1 * (blotch - 0.5)
    chip = np.clip((wearmap - 0.84) * 18, 0, 1)
    img = mix(img, rgb("#6f6b60")[None, None, :] * (0.8 + 0.3 * speck[..., None]), chip * wear)
    img = img + (light(d) * np.exp(d / (1.6 * SS)))[..., None] * 44 * lit
    # lip
    lipm = np.clip((y - (n - lip - 2 * SS)) / SS, 0, 1)
    img = mix(img, rgb("#0b0a08")[None, None, :] + 8, lipm * 0.86)
    alpha = np.clip(0.5 - d / SS, 0, 1) * 255
    save(np.dstack([img, alpha]), name, (px, px))


def paper_tile(name, px, seed):
    n = px
    fib_a = noise(n, n, 0.6, 7, seed)
    fib_b = noise(n, n, 7, 0.6, seed + 1)
    cloud = noise(n, n, 60, 60, seed + 2)
    fine = noise(n, n, 0.8, 0.8, seed + 3)
    v = 0.5 * fib_a + 0.5 * fib_b
    base = rgb("#d6ccb3")[None, None, :]
    img = base * (0.9 + 0.1 * cloud[..., None] + 0.09 * (v[..., None] - 0.5) + 0.06 * (fine[..., None] - 0.5))
    # foxing: sparse brown specks
    fox = np.clip((noise(n, n, 2.4, 2.4, seed + 4) - 0.8) * 9, 0, 1)
    img = mix(img, rgb("#a98e62")[None, None, :], fox * 0.55)
    save(img, name, None, 90)


def page_frame(name, px, seed):
    """Worn edge of a manual page: ragged outline, thumb grime, ring stain, staples."""
    n = px * SS
    d = rsdf(n, n, 6 * SS, 3 * SS)
    rag = noise(n, n, 5 * SS, 5 * SS, seed) - 0.5
    rag2 = noise(n, n, 1.4 * SS, 1.4 * SS, seed + 1) - 0.5
    dd = d + rag * 3 * SS + rag2 * 1.6 * SS
    cloud = noise(n, n, 34 * SS, 34 * SS, seed + 2)
    fine = noise(n, n, 1.2 * SS, 1.2 * SS, seed + 3)
    img = rgb("#d6ccb3")[None, None, :] * (0.9 + 0.1 * cloud[..., None] + 0.05 * (fine[..., None] - 0.5))
    age = np.exp(dd / (9 * SS)) * (0.5 + 0.8 * cloud)
    img = mix(img, rgb("#8a7346")[None, None, :], np.clip(age, 0, 1) * 0.34)
    rim = np.exp(-np.abs(dd) / (1.6 * SS))
    img = mix(img, rgb("#efe7d2")[None, None, :], rim * 0.5)
    alpha = np.clip(0.5 - dd / SS, 0, 1) * 255
    save(np.dstack([img, alpha]), name, (px, px), 90)


def metal_tile(name, px, seed):
    n = px
    g = noise(n, n, 0.6, 26, seed)
    b = noise(n, n, 30, 30, seed + 1)
    img = rgb("#2d2c26")[None, None, :] * (0.8 + 0.3 * b[..., None] + 0.28 * (g[..., None] - 0.5))
    sc = scratches(n, n, 26, seed + 2, (14, 90))
    img = img + sc[..., None] * 18
    save(img, name, None, 90)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    frame("bezel.webp", 320, 44, 18, 8, "#3a3830", 11, screws=7.5, wear=0.75)
    frame("plate.webp", 96, 11, 7, 3, "#37352e", 23, screws=0, wear=0.8, inner_alpha=224)
    key("key.webp", 96, 7, "#39372f", 31)
    key("key-down.webp", 96, 7, "#2b2a24", 32, down=True, lit=0.5)
    key("key-hot.webp", 96, 7, "#c4771f", 33, wear=0.75, lit=0.85)
    key("key-hot-down.webp", 96, 7, "#94591a", 34, down=True, wear=0.75, lit=0.5)
    paper_tile("paper.webp", 512, 41)
    page_frame("page.webp", 256, 47)
    metal_tile("metal.webp", 256, 53)


if __name__ == "__main__":
    main()
