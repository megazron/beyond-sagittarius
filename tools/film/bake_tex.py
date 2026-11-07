#!/usr/bin/env python3
"""The game colours skin and eyes in its shaders. Cycles wants plain textures: same maths, done once.
  python tools/film/bake_tex.py <dump-dir> <out-dir>"""
import glob, json, os, sys
import numpy as np
from PIL import Image
TEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'models', 'crew', 'tex')
dump, out = os.path.expanduser(sys.argv[1]), os.path.expanduser(sys.argv[2]); os.makedirs(out, exist_ok=True)


def lin(h):
    c = np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], np.float32) / 255
    return np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)


def srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= .0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - .055)


done = set()
for f in glob.glob(f'{dump}/fresh/*.json'):
    m = json.load(open(f))['material'].get('film')
    if not m or m['kind'] != 'skin':
        continue
    key = f"{m['marks']}_{m['sex']}_{m['skin']:06x}"
    if key in done:
        continue
    done.add(key)
    sk = np.asarray(Image.open(f"{TEX}/skin_{m['sex']}.webp").convert('RGB'), np.float32) / 255
    S = sk.shape[0]
    mk = np.asarray(Image.open(f"{TEX}/{m['marks']}_marks.webp").convert('RGB').resize((S, S), Image.BILINEAR), np.float32) / 255
    sr = sk[..., 0:1] * 2
    skin, shade, lip, glow, over = (lin(m[k]) for k in ('skin', 'shade', 'lip', 'glow', 'over'))
    sc = shade + (skin - shade) * np.clip((sr - .45) / .55, 0, 1)
    sc = sc * np.clip(sr, .3, 1.45) ** .85
    sc = sc + (lip * 1.1 - sc) * sk[..., 1:2] * .6
    sc = sc + (shade * .35 - sc) * mk[..., 1:2]
    sc = sc + (over * np.clip(sr, .6, 1.2) - sc) * mk[..., 2:3]
    sc = sc + (glow - sc) * mk[..., 0:1] * .5
    Image.fromarray((srgb(sc) * 255).astype(np.uint8)).save(f'{out}/{key}.png')
    Image.fromarray((mk[..., 0] * 255).astype(np.uint8)).save(f'{out}/{key}_glow.png')
    print(key, flush=True)
