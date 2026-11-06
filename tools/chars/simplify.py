"""Quadric half-edge collapse: surviving vertices are a subset of the input, so weights,
UVs and morph deltas carry over untouched."""
import heapq
import numpy as np


def simplify(P, F, FU, target, locked=None, importance=None, boundary_w=1e5, seam_w=30.0, maxcost=1e-4):
    """P (n,3) positions, F (m,3) triangles, FU (m,3) per-corner uv ids.
    Returns (kept triangles, their uv ids). A collapse is only legal if every uv island around
    the removed vertex maps onto a uv of the survivor through a shared triangle, so seams
    shrink along themselves and never tear."""
    n = len(P)
    F = np.asarray(F, np.int64).copy()
    FU = np.asarray(FU, np.int64).copy()
    locked = np.zeros(n, bool) if locked is None else locked.copy()
    imp = np.ones(n) if importance is None else importance
    # quadrics
    Q = np.zeros((n, 4, 4))
    a, b, c = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    nrm = np.cross(b - a, c - a)
    ar = np.linalg.norm(nrm, axis=1, keepdims=True)
    nn = nrm / np.maximum(ar, 1e-12)
    d = -np.einsum('ij,ij->i', nn, a)
    pl = np.concatenate([nn, d[:, None]], 1)
    K = pl[:, :, None] * pl[:, None, :] * (ar[:, :, None] * 0.5 + 1e-8)
    for k in range(3):
        np.add.at(Q, F[:, k], K)
    Q *= imp[:, None, None]
    # boundary edges get a perpendicular plane so outlines survive
    ed = {}
    for fi, (i, j, k) in enumerate(F):
        for u, v in ((i, j), (j, k), (k, i)):
            key = (u, v) if u < v else (v, u)
            ed.setdefault(key, []).append(fi)

    def corner_uv(fi, x):
        return FU[fi][F[fi] == x][0]
    for (u, v), fs in ed.items():
        seam = len(fs) == 2 and (corner_uv(fs[0], u) != corner_uv(fs[1], u) or corner_uv(fs[0], v) != corner_uv(fs[1], v))
        if len(fs) == 1 or seam:
            e = P[v] - P[u]
            pn = np.cross(e, nn[fs[0]])
            l = np.linalg.norm(pn)
            if l < 1e-12:
                continue
            pn /= l
            p4 = np.append(pn, -pn @ P[u])
            q = np.outer(p4, p4) * (boundary_w if len(fs) == 1 else seam_w) * (e @ e)
            Q[u] += q; Q[v] += q
    vf = [set() for _ in range(n)]
    for fi, f in enumerate(F):
        for x in f:
            vf[x].add(fi)
    alive = np.ones(len(F), bool)
    remap = np.arange(n)
    ver = np.zeros(n, np.int64)
    heap = []

    def cost(u, v):
        # collapse u into v
        q = Q[u] + Q[v]
        p = np.append(P[v], 1.0)
        return float(p @ q @ p)

    def push(u, v):
        if not locked[u]:
            heapq.heappush(heap, (cost(u, v), u, v, ver[u], ver[v]))
        if not locked[v]:
            heapq.heappush(heap, (cost(v, u), v, u, ver[v], ver[u]))

    for (u, v) in ed:
        push(u, v)
    count = len(F)
    while heap and count > target:
        c0, u, v, vu, vv = heapq.heappop(heap)
        if c0 > maxcost:
            break
        if vu != ver[u] or vv != ver[v] or remap[u] != u or remap[v] != v:
            continue
        shared = vf[u] & vf[v]
        if not shared:
            continue
        # uv islands of u must each land on a uv of v
        umap = {}
        for fi in shared:
            f, fu = F[fi], FU[fi]
            umap[int(fu[f == u][0])] = int(fu[f == v][0])
        if any(int(FU[fi][F[fi] == u][0]) not in umap for fi in vf[u]):
            continue
        # link condition and fold-over test
        nu = set()
        for fi in vf[u]:
            nu.update(F[fi])
        nv = set()
        for fi in vf[v]:
            nv.update(F[fi])
        common = (nu & nv) - {u, v}
        if len(common) > len(shared):
            continue
        bad = False
        for fi in vf[u] - shared:
            f = F[fi]
            i = int(np.nonzero(f == u)[0][0])
            p0, p1, p2 = P[f[i]], P[f[(i + 1) % 3]], P[f[(i + 2) % 3]]
            n0 = np.cross(p1 - p0, p2 - p0)
            n1 = np.cross(p1 - P[v], p2 - P[v])
            l1 = np.linalg.norm(n1)
            if l1 < 1e-12 or n0 @ n1 < 0.25 * np.linalg.norm(n0) * l1:
                bad = True
                break
        if bad:
            continue
        for fi in shared:
            alive[fi] = False
            count -= 1
            for x in F[fi]:
                vf[x].discard(fi)
        for fi in list(vf[u]):
            m = F[fi] == u
            FU[fi][m] = umap[int(FU[fi][m][0])]
            F[fi][m] = v
            vf[v].add(fi)
        vf[u] = set()
        remap[u] = v
        Q[v] += Q[u]
        ver[v] += 1
        nb = set()
        for fi in vf[v]:
            nb.update(F[fi])
        nb.discard(v)
        for w in nb:
            ver[w] += 1
        for w in nb:
            push(v, w)
    return F[alive], FU[alive]
