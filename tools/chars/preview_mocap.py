#!/usr/bin/env python3
"""Contact sheet of stick figures through a take, to choose time windows."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import amc
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
M = os.path.expanduser('~/bs-mh/mocap')
out = sys.argv[1]
takes = sys.argv[2:]
n = 12
fig, axs = plt.subplots(len(takes), n, figsize=(n * 1.25, len(takes) * 1.9), squeeze=False)
for r, t in enumerate(takes):
    a = amc.Asf(f"{M}/{t.split('_')[0]}.asf")
    G, root, fps = amc.load_amc(f'{M}/{t}.amc', a, fps=30)
    P = amc.fk_positions(a, G, root)
    F = len(root)
    for c in range(n):
        i = int(c * (F - 1) / (n - 1))
        ax = axs[r][c]
        o = root[i]
        for b in a.order[1:]:
            p0 = P[a.parent[b]][i] - o; p1 = P[b][i] - o
            col = 'r' if b.startswith('r') and b != 'root' else 'b' if b.startswith('l') and b != 'lowerback' and b != 'lowerneck' else 'k'
            ax.plot([p0[0], p1[0]], [p0[1], p1[1]], col, lw=1)
            ax.plot([p0[2] + 1.3, p1[2] + 1.3], [p0[1], p1[1]], col, lw=.6)
        ax.set_xlim(-.9, 2.2); ax.set_ylim(-1.1, 1.1); ax.set_aspect('equal'); ax.axis('off')
        ax.set_title(f'{t if c == 0 else ""} {i / fps:.1f}/{F / fps:.0f}', fontsize=6)
plt.tight_layout(pad=.1); plt.savefig(out, dpi=95)
