#!/usr/bin/env python3
"""strip.py out.jpg dir f0 step n [cols]: contact sheet of film frames."""
import sys
from PIL import Image
out, d, f0, st, n = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
cols = int(sys.argv[6]) if len(sys.argv) > 6 else 8
w = 1800 // cols
rows = (n + cols - 1) // cols
W = Image.new('RGB', (cols * w, rows * w))
for i in range(n):
    W.paste(Image.open(f'{d}/f{f0 + i * st:04d}.jpg').resize((w, w)), ((i % cols) * w, (i // cols) * w))
W.save(out, quality=85)
