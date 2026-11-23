"""Fitting a knit top: see knit_fit."""
import numpy as np
from scipy.spatial import cKDTree, ConvexHull


def _loops(T):
    from collections import defaultdict
    e = defaultdict(int)
    for t in T:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])): e[(min(a, b), max(a, b))] += 1
    adj = defaultdict(list)
    for (a, b), n in e.items():
        if n == 1: adj[a].append(b); adj[b].append(a)
    seen, loops = set(), []
    for s in adj:
        if s in seen: continue
        loop, st = [], [s]
        while st:
            v = st.pop()
            if v in seen: continue
            seen.add(v); loop.append(v); st += adj[v]
        loops.append(np.array(loop))
    return loops

def _ray_poly(c, u, poly):
    # distance from c along u (2D) to the polygon's edge (largest hit)
    best = 0.0
    a = poly; b = np.roll(poly, -1, 0); e = b - a
    den = u[0] * e[:, 1] - u[1] * e[:, 0]
    ok = np.abs(den) > 1e-12
    w = a - c
    t = np.where(ok, (w[:, 0] * e[:, 1] - w[:, 1] * e[:, 0]) / np.where(ok, den, 1), -1)
    s = np.where(ok, (w[:, 0] * u[1] - w[:, 1] * u[0]) / np.where(ok, den, 1), -1)
    hit = ok & (t > 0) & (s >= 0) & (s <= 1)
    return float(t[hit].max()) if hit.any() else 0.0

def knit_fit(P0, T, W, V, Nb, idx, ease=0.012, ease_bust=0.018, slope=0.45, verbose=True):
    """A knit is a tube stretched round the torso: it bridges every hollow (between and under the breasts, the spine)
    and stands a little off the fullest points. Per 1 cm slice the torso's cross-section is replaced by its convex
    hull, the knit put `ease` outside it (more over the bust), below the bust the front falls straight to the hem
    (no faster than `slope`), and the hem is levelled (a straight knitted rib, not following the source's ragged
    fit)."""
    P = P0.copy(); n = len(P)
    # the source has its seams split (a vertex per UV island): copies are moved as one, or the seam opens
    _, grp = np.unique(np.round(P0 * 1e5).astype(np.int64), axis=0, return_inverse=True); grp = grp.ravel()
    cnt = np.bincount(grp).astype(float)
    def weld(Q):
        S = np.zeros((cnt.size, 3)); np.add.at(S, grp, Q); return (S / cnt[:, None])[grp]
    nb = [[] for _ in range(n)]
    for t in T:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])): nb[a].append(b); nb[b].append(a)
    nb = [np.unique(x) if x else np.array([], int) for x in nb]
    loops = _loops(T)
    rimv = np.concatenate(loops) if loops else np.array([], int)
    rd = cKDTree(P[rimv]).query(P)[0] if len(rimv) else np.full(n, 9.)
    tw = sum(W[:, i] for i in idx if i >= 0)
    k = np.clip(tw / 0.5, 0, 1) * np.clip((rd - 0.015) / 0.04, 0, 1)
    tor = k > 0.05
    y0, y1 = P[tor, 1].min(), P[tor, 1].max()
    # the bust: the front's fullest band
    front = np.clip((P[:, 2] - np.median(P[tor, 2])) / 0.06, 0, 1)
    cx = np.median(P[tor, 0])
    moved = 0
    for yc in np.arange(y0, y1 + 0.01, 0.01):
        g = tor & (np.abs(P[:, 1] - yc) <= 0.005)
        if g.sum() < 4: continue
        gk = g & (k > 0.5)
        if gk.sum() < 4: continue
        xr = np.abs(P0[gk, 0] - cx).max()
        zl, zh = P0[g, 2].min() - 0.03, P0[g, 2].max() + 0.01
        bm = (np.abs(V[:, 1] - yc) < 0.012) & (np.abs(V[:, 0] - cx) < xr) & (V[:, 2] > zl) & (V[:, 2] < zh)
        if bm.sum() < 8: continue
        Q = V[bm][:, [0, 2]]
        try: h = ConvexHull(Q)
        except Exception: continue
        poly = Q[h.vertices]; c = poly.mean(0)
        for i in np.nonzero(g)[0]:
            p = P[i, [0, 2]]; u = p - c; r = np.linalg.norm(u)
            if r < 1e-6: continue
            u /= r; R = _ray_poly(c, u, poly)
            want = R + ease + (ease_bust - ease) * front[i]
            if want > r:
                dd = (want - r) * k[i]; P[i, 0] += u[0] * dd; P[i, 2] += u[1] * dd; moved += 1
    # below the fullest point the front falls straight (per 2 cm column)
    fr = tor & (front > 0.3)
    cols = np.floor(P[:, 0] / 0.02).astype(int)
    for ci in np.unique(cols[fr]):
        m = fr & (cols == ci)
        if m.sum() < 3: continue
        top = np.argmax(np.where(m, P[:, 2], -9)); za, ya = P[top, 2], P[top, 1]
        lo = np.nonzero(m & (P[:, 1] < ya))[0]
        want = za - (ya - P[lo, 1]) * slope
        P[lo, 2] += (want - P[lo, 2]).clip(0) * k[lo]
    # smooth what moved (Taubin), never closer than ease to the body
    body = cKDTree(V)
    sel = np.nonzero(k > 0)[0]
    for _ in range(10):
        for lam in (0.5, -0.53):
            L = np.zeros_like(P)
            for i in sel:
                if len(nb[i]): L[i] = P[nb[i]].mean(0) - P[i]
            P += (lam * k)[:, None] * L
        dd, j = body.query(P)
        sd = np.einsum('ij,ij->i', P - V[j], Nb[j]); m = (k > 0) & (dd < 0.08) & (sd < ease)
        P[m] += Nb[j[m]] * (ease - sd[m])[:, None]
        P = weld(P)
    # the hem: the lowest loop round the torso, levelled to its median height, the rows above it eased in over 6 cm
    hl = [l for l in loops if np.abs(P[l, 0].mean() - cx) < 0.06 and len(l) > 20]
    if hl:
        hem = min(hl, key=lambda l: P[l, 1].mean())
        yh = float(np.median(P[hem, 1]))
        ang = lambda Q: np.arctan2(Q[:, 0] - cx, Q[:, 2] - P[hem, 2].mean())
        ah = ang(P[hem]); o = np.argsort(ah); ah, hy = ah[o], P[hem[o], 1]
        near = np.nonzero(P[:, 1] < yh + 0.12)[0]
        a = ang(P[near]); hyv = np.interp(a, ah, hy, period=2 * np.pi)
        f = np.clip(1 - (P[near, 1] - hyv) / 0.06, 0, 1)
        P[near, 1] += (yh - hyv) * f
        P = weld(P)
        if verbose: print(f'hem: {len(hem)} verts, levelled to {yh:.3f} (was {hy.min():.3f}..{hy.max():.3f})')
    if verbose:
        mv = np.linalg.norm(P - P0, axis=1); print(f'knit: {moved} pushed out, {int((mv > 0.002).sum())} moved, most {mv.max() * 100:.1f} cm')
    return P
