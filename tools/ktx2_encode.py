#!/usr/bin/env python3
"""ktx2_encode.py [ROOT]: every colour map (diff_*.webp) under public/textures gets a KTX2 (Basis ETC1S) beside it.

The webp stays (the fallback, and the desktop's 4K). The picture is flipped first, so the KTX2 (never flipped on
upload) lands the way the webp does with flipY. Skips files whose KTX2 is newer. Needs ~/tools/ktx (KTX-Software 4.4).
"""
import os, subprocess, sys, tempfile
from PIL import Image
KTX = os.path.expanduser('~/tools/ktx/KTX-Software-4.4.2-Linux-x86_64')
root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'public', 'textures')
env = dict(os.environ, LD_LIBRARY_PATH=f'{KTX}/lib')
n = before = after = 0
for d, _, fs in os.walk(root):
    for f in sorted(fs):
        if not (f.startswith('diff_') and f.endswith('.webp')): continue
        src = os.path.join(d, f); dst = src[:-5] + '.ktx2'
        before += os.path.getsize(src)
        if os.path.exists(dst) and os.path.getmtime(dst) > os.path.getmtime(src): after += os.path.getsize(dst); continue
        with tempfile.TemporaryDirectory() as t:
            png = os.path.join(t, 'a.png')
            Image.open(src).convert('RGBA' if Image.open(src).mode in ('RGBA', 'LA', 'P') else 'RGB').transpose(Image.FLIP_TOP_BOTTOM).save(png)
            fmt = 'R8G8B8A8_SRGB' if Image.open(png).mode == 'RGBA' else 'R8G8B8_SRGB'
            subprocess.run([f'{KTX}/bin/ktx', 'create', '--format', fmt, '--encode', 'basis-lz', '--clevel', '2', '--qlevel', '160', '--generate-mipmap', png, dst], check=True, env=env)
        n += 1; after += os.path.getsize(dst)
print(f'{n} encoded; colour maps webp {before / 1e6:.1f} MB, ktx2 {after / 1e6:.1f} MB')
