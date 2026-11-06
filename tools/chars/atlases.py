#!/usr/bin/env python3
"""Rebuild cloth atlases only."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__)); sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import numpy as np, mh, paint
from config import CHARS, CREW
from build_characters import tri_fan, OUT
class G: pass
for cid in CREW:
    gs = []
    for nm, tint, opt in CHARS[cid]['clothes']:
        g = G(); g.clo = mh.Clo(mh.find_clo(nm)); o = g.clo.obj
        _, g.TU = tri_fan(o.faces, o.fuv, range(len(o.faces)))
        g.UV = np.stack([o.vt[:, 0], 1 - o.vt[:, 1]], 1); g.tint, g.opt, g.asset = tint, opt, nm
        gs.append(g)
    paint.cloth_atlas(cid, gs, OUT); print(cid, flush=True)
