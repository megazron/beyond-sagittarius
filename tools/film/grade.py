#!/usr/bin/env python3
"""Lens effects the game draws in its last pass, applied to rendered frames: flash, zoom blur, speed
lines, two-tone impact frames. Plus a little grain, so denoised frames don't look like plastic.

  python tools/film/grade.py <render-dir> <fx.json> <out-dir>     fx.json: frame number -> fx"""
import glob, json, os, sys
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

src, fxp, out = (os.path.expanduser(x) for x in sys.argv[1:4]); os.makedirs(out, exist_ok=True)
FX = json.load(open(fxp)); rng = np.random.default_rng(5)
for f in sorted(glob.glob(f'{src}/*.png')):
    n = os.path.basename(f)[:-4]; dst = f'{out}/{n}.png'
    if os.path.exists(dst):
        continue
    a = np.asarray(Image.open(f).convert('RGB'), np.float32) / 255
    H, W, _ = a.shape; fx = FX.get(str(int(n)), {})
    z = fx.get('zoom', 0)
    if z > .002:
        cx, cy = [v * s for v, s in zip(fx.get('at', (.5, .5)), (W, H))]
        y, x = np.mgrid[0:H, 0:W].astype(np.float32); acc = np.zeros_like(a); T = 9
        for i in range(T):
            k = 1 + z * i / T
            for c in range(3):
                acc[..., c] += map_coordinates(a[..., c], [cy + (y - cy) / k, cx + (x - cx) / k], order=1, mode='nearest')
        a = acc / T
    l = fx.get('lines', 0)
    if l > .01:
        y, x = np.mgrid[0:H, 0:W].astype(np.float32); ang = np.arctan2(y - H / 2, x - W / 2); r = np.hypot(x - W / 2, y - H / 2) / (H * .9)
        t = np.sin(ang * 90 + int(n) * 2.1) * np.sin(ang * 37 - int(n) * 1.3)
        a = a + (np.clip((t - .72) * 6, 0, 1) * np.clip(r - .35, 0, 1) * l)[..., None]
    if fx.get('ink', 0) > .01:
        L = a @ np.array((.3, .6, .1), np.float32); m = (L > .34).astype(np.float32)[..., None]
        d, w = np.array(fx.get('dark', (.02, .02, .05)), np.float32), np.array(fx.get('light', (1, .95, .85)), np.float32)
        a = a + (d + (w - d) * m - a) * fx['ink']
    fl = fx.get('flash')
    if fl:
        a = a + np.array(fl, np.float32)
    a = a + rng.normal(0, .009, (H, W, 1)).astype(np.float32)
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(dst)
print('graded')
