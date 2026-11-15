"""Pose-driven corrective shapes for the shoulders, the neck and the hips, baked here and driven in the game by a bone's
turn (src/characters/character.ts).

Linear skinning folds the armpit through itself when the arm comes down from the bind pose: skin weighted half to the
chest and half to the upper arm takes the average of two turns that are far apart, and its triangles flip. Under a
sleeveless vest or worksuit that skin is in plain view. Weight spreading moves the fold, it never removes it.

For every pose the game takes (tools/chars/cap_poses.json) the skin of each region is solved again in that pose: it
keeps its own local shape (each vertex's Laplacian, turned the way its bones turn it) between the skin that stays put
around it, and stays under every garment that covers it. The difference from what the skinning gives, taken back into
the bind pose, is a corrective. A few shapes (principal components) carry the correctives of all poses, and in the
game their mix comes from radial basis interpolation over the driving bone's turn in its parent's frame (where it
points and how it is rolled): the solved shape at each pose, nothing at the bind pose, nothing far from every pose.
The bind pose itself is solved the same way first: the push under the clothes had already folded the side of the
chest under an armhole."""
import os
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as sla
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation

SIGMA = float(os.environ.get('PIT_SIGMA', 0.4))  # radians: how far round a key its shape reaches
MERGE = 0.08  # radians: keys closer than this are one
NSHAPE = int(os.environ.get('PIT_N', 8))  # corrective shapes per side
RIDGE = float(os.environ.get('PIT_RIDGE', 1e-3))
RIM = float(os.environ.get('PIT_RIM', 0.04))  # metres: skin this near a garment's edge is not held under it in a pose
UNTANGLE = int(os.environ.get('PIT_UNTANGLE', 40))  # rounds of relaxing what is still folded after the solve
MAXMOVE = float(os.environ.get('PIT_MAXMOVE', 0.04))  # metres: no vertex moves further than this from where the skinning put it


def boundary(T):
    e = {}
    for t in T:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            k = (min(a, b), max(a, b)); e[k] = e.get(k, 0) + 1
    return [list(k) for k, c in e.items() if c == 1]


def laplacian(T, n):
    e = np.r_[T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]
    A = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), (n, n)).tocsr(); A = ((A + A.T) > 0).astype(float)
    return (sp.eye(n) - sp.diags(1 / np.maximum(A.sum(1).A1, 1)) @ A).tocsr(), A


def flips(T, ref, X, R):
    """Triangles of X facing the other way from ref's, turned by each corner's own rotation (all three corners agree)."""
    fn = lambda P: np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    nB, nP = fn(ref), fn(X); f = np.ones(len(T), bool)
    for k in range(3):
        f &= np.einsum('ij,ij->i', nP, np.einsum('tij,tj->ti', R[T[:, k]], nB)) < 0
    return f


def pose_mats(names, par, piv, qs):
    M = [None] * len(names)
    def get(i):
        if M[i] is None:
            A = np.eye(4); q = qs.get(names[i])
            if q is not None:
                A[:3, :3] = Rotation.from_quat(q).as_matrix(); A[:3, 3] = piv[i] - A[:3, :3] @ piv[i]
            M[i] = get(par[i]) @ A if par[i] >= 0 else A
        return M[i]
    return np.array([get(i) for i in range(len(names))])


def lbs(P, W, M):
    return np.einsum('vb,bij,vj->vi', W, M[:, :3, :], np.c_[P, np.ones(len(P))])


def blend_rot(W, M):
    A = np.einsum('vb,bij->vij', W, M[:, :3, :3]); U, s, Vt = np.linalg.svd(A)
    D = np.ones((len(A), 3)); D[:, 2] = np.sign(np.linalg.det(U @ Vt))
    return (U * D[:, None, :]) @ Vt


def turn(M, ix, bone, ref):
    """A bone's turn in another bone's frame (the upper arm in the chest's), as a quaternion (x, y, z, w): which way it
    points and how it is rolled (the game reads the same from its bones). Rest frames carry no rotation, so the bind
    pose is (0, 0, 0, 1)."""
    q = Rotation.from_matrix(M[ix[ref]][:3, :3].T @ M[ix[bone]][:3, :3]).as_quat()
    return q if q[3] >= 0 else -q


def ang(a, b):
    """Angle of the turn between quaternions (rows of a against rows of b)."""
    return 2 * np.arccos(np.clip(np.abs(a @ b.T), 0, 1))


def kernel(a, b):
    return np.exp(-(ang(a, b) / SIGMA) ** 2)


def correctives(V, Vb, W, T, names, par, piv, poses, garments, joints, sunk=None, log=None):
    """Corrective shapes per joint: {f'{name}{m}': delta (n, 3)}, the interpolation for the game
    ({name: {bone, ref, dirs: key turns + the bind pose, w: each key's weights for the shapes, lim, n, sigma}}), and
    the bind skin itself with each region solved the same way (the push under the clothes folded it already at bind).
    `joints`: [{name, bone, ref, region}]: the bone whose turn in ref's frame drives the shapes, the vertices it may move
    (regions do not overlap). `sunk`: skin sunk under the clothes, which keeps the shape it was sunk to."""
    n = len(V); ix = {nm: i for i, nm in enumerate(names)}
    L, Adj = laplacian(T, n)
    LV = L @ V  # the skin's own shape, before any push folded it (the push is kept by the garments' pull below)
    if sunk is not None:
        LV[sunk] = (L @ Vb)[sunk]  # skin sunk deep under the clothes keeps its sunk shape (it is never seen, never pushed)
    Ms = [pose_mats(names, par, piv, f['q']) for f in poses]
    I = np.tile(np.eye(4), (len(names), 1, 1))
    shapes, info = {}, {}
    regs = {}
    An = sp.diags(1 / np.maximum(Adj.sum(1).A1, 1)) @ Adj
    TR = {jt['name']: np.nonzero(jt['region'][T].any(1))[0] for jt in joints}
    for jt in joints:
        s = jt['name']; reg = jt['region']; fr = np.nonzero(reg)[0]
        Lr = L[fr]; Ar = Adj[fr][:, fr]
        regs[s] = (reg, fr, Lr[:, fr].tocsc(), Lr[:, ~reg], sp.diags(1 / np.maximum(Ar.sum(1).A1, 1)) @ Ar)

    def solve(s, M, base):
        reg, fr, Lin, Lout, Ar = regs[s]
        P = lbs(base, W, M); R = blend_rot(W, M)
        gp = [(lbs(o.P, o.W, M), o) for o in garments]
        gp = [(cKDTree(Pg), Pg, np.einsum('vij,vj->vi', blend_rot(o.W, M), o.N), o) for Pg, o in gp]
        # which of these vertices a garment covers at bind: they stay under it in the pose too
        # (not within RIM of the garment's own edge: at an armhole the facing covers the gap, and holding the skin under
        # the very edge in every pose folded it again)
        cover = []
        for (tree, Pg, Ng, o) in gp:
            d, jj = cKDTree(o.P).query(Vb[fr], workers=1)
            rim = np.unique(np.concatenate([np.array(l) for l in boundary(o.T)])) if RIM > 0 else np.zeros(0, int)
            far = cKDTree(o.P[rim]).query(Vb[fr], workers=1)[0] > RIM if len(rim) else np.ones(len(fr), bool)
            cover.append((d < 0.05) & (np.einsum('ij,ij->i', Vb[fr] - o.P[jj], o.N[jj]) < 0) & far)
        delta = np.einsum('vij,vj->vi', R[fr], LV[fr]) - Lout @ P[~reg]
        # under a garment: pushed back under it as a smooth field, never vertex by vertex along the cloth's own
        # nearest normal (neighbours went different ways and folded the skin again)
        c = np.full(len(fr), 1e-3); tgt = P[fr].copy(); push = np.zeros((len(fr), 3))
        for it in range(12):
            lu = sla.splu((Lin.T @ Lin + sp.diags(c)).tocsc())
            rhs = Lin.T @ delta + c[:, None] * tgt
            X = np.stack([lu.solve(rhs[:, k]) for k in range(3)], 1)
            need = np.zeros((len(fr), 3)); bad = np.zeros(len(fr), bool)
            for (tree, Pg, Ng, o), cv in zip(gp, cover):
                d, jj = tree.query(X, workers=1); sd = np.einsum('ij,ij->i', X - Pg[jj], Ng[jj])
                m = cv & (d < 0.05) & (sd > -0.003)
                need[m] -= Ng[jj[m]] * (sd[m] + 0.006)[:, None]; bad |= m
            if not bad.any(): break
            for _ in range(6): need = need * 0.5 + (Ar @ need) * 0.5
            need[bad] *= 1.5
            # never more than a few millimetres a round and 3 cm in all: where the nearest cloth turns its back (a fold, a
            # flap) the pull never settles, and unbounded it threw single vertices out into long spikes
            need *= np.minimum(1, 0.006 / np.maximum(np.linalg.norm(need, axis=1), 1e-9))[:, None]
            push += need; push *= np.minimum(1, 0.03 / np.maximum(np.linalg.norm(push, axis=1), 1e-9))[:, None]
            tgt = P[fr] + (X - P[fr]) + need; c = np.maximum(c, np.where(np.linalg.norm(push, axis=1) > 1e-5, 0.05, 1e-3))
        # and the corrective as a whole stays a correction: nothing moves more than 4 cm from where the skinning put it
        dX = X - P[fr]; X = P[fr] + dX * np.minimum(1, 0.04 / np.maximum(np.linalg.norm(dX, axis=1), 1e-9))[:, None]
        # and what is still folded is untangled: the skin of each turned-over triangle is relaxed towards its
        # neighbours (the region's edge stays put) until it faces out again. Keeping its own local shape, compressed
        # skin (the armpit with the arm down) buckles; relaxed, it stretches flat the way skin does
        if UNTANGLE:
            Xa = P.copy(); Xa[fr] = X; tr = TR[s]
            for _ in range(UNTANGLE):
                f = flips(T[tr], V, Xa, R)
                if not f.any(): break
                mv = np.zeros(n, bool); mv[T[tr][f].ravel()] = True; mv = ((An @ mv.astype(float)) > 0) | mv; mv &= reg
                Xa[mv] = Xa[mv] * 0.5 + (An @ Xa)[mv] * 0.5
            X = Xa[fr]
            dX = X - P[fr]; X = P[fr] + dX * np.minimum(1, MAXMOVE / np.maximum(np.linalg.norm(dX, axis=1), 1e-9))[:, None]
        return P, R, X

    cov0 = np.zeros(n, bool)
    for o in garments:
        d, jj = cKDTree(o.P).query(Vb, workers=1); cov0 |= (d < 0.05) & (np.einsum('ij,ij->i', Vb - o.P[jj], o.N[jj]) < 0)
    # the bind pose first: each region solved under the clothes, so the shapes start from skin that is not folded
    Vb = Vb.copy()
    for s in regs:
        b0 = int((flips(T, V, Vb, np.tile(np.eye(3), (n, 1, 1))) & regs[s][0][T].all(1)).sum())
        _, _, X = solve(s, I, Vb); Vb[regs[s][1]] = X
        if log: log(f'    {s} at bind: {b0} folded triangles -> {int((flips(T, V, Vb, np.tile(np.eye(3), (n, 1, 1))) & regs[s][0][T].all(1)).sum())}')
    for jt in joints:
        s = jt['name']; reg, fr = regs[s][0], regs[s][1]
        dirs = np.array([turn(M, ix, jt['bone'], jt['ref']) for M in Ms])
        u0 = np.array([0., 0., 0., 1.])
        # every pose the game takes is a key (poses with the arm the same way are one key, their shapes averaged)
        groups = []
        for i in range(len(Ms)):
            for g in groups:
                if ang(dirs[i], dirs[g[0]]) < MERGE: g.append(i); break
            else: groups.append([i])
        groups = [g for g in groups if ang(dirs[g[0]], u0) > MERGE]
        if not groups or not len(fr):
            if log: log(f'    {s}: nothing to correct ({len(fr)} vertices, {len(groups)} poses away from the bind pose)')
            continue
        Ds, kd = [], []
        for g in groups:
            acc = np.zeros((len(fr), 3))
            for pi in g:
                P, R, X = solve(s, Ms[pi], Vb)
                if log and os.environ.get('PIT_DEBUG') == '3':
                    Xa = P.copy(); Xa[fr] = X; vt = reg[T].all(1) & ~cov0[T].all(1)
                    log(f'      solve {s} {poses[pi]["pose"]}: {int((flips(T, V, P, R) & vt).sum())} -> {int((flips(T, V, Xa, R) & vt).sum())}')
                acc += np.einsum('vji,vj->vi', R[fr], X - P[fr])  # back into the bind pose: R^T (X - P)
            Ds.append((acc / len(g)).ravel()); u = (dirs[g] * np.sign(dirs[g] @ dirs[g[0]])[:, None]).mean(0); kd.append(u / np.linalg.norm(u))
        # a few shapes carry them all (principal components), and the arm's direction picks their mix: radial basis
        # interpolation over the keys, nothing at the bind pose, nothing far from every key
        Dm = np.array(Ds); U_, S_, Vt = np.linalg.svd(Dm, full_matrices=False)
        e = np.cumsum(S_ ** 2) / max((S_ ** 2).sum(), 1e-12); k = int(min(NSHAPE, np.searchsorted(e, float(os.environ.get('PIT_E', 0.9999))) + 1))
        C = Dm @ Vt[:k].T  # each key's mix of the k shapes
        for m in range(k):
            D = np.zeros((n, 3)); D[fr] = Vt[m].reshape(-1, 3); shapes[f'{s}{m}'] = D
        K = np.array(kd + [u0]); Cz = np.vstack([C, np.zeros((1, k))])
        Wt = np.linalg.solve(kernel(K, K) + RIDGE * np.eye(len(K)), Cz)
        lim = np.abs(C).max(0) * 1.15
        info[s] = dict(bone=jt['bone'], ref=jt['ref'], dirs=[[round(float(x), 5) for x in v] for v in K], w=[[round(float(x), 6) for x in r] for r in Wt], lim=[round(float(x), 5) for x in lim], n=k, sigma=SIGMA)
        if log: log(f'    {s}: {len(groups)} keys, {k} shapes ({e[k - 1] * 100:.1f}% of the variation), moves (99th percentile, largest) {np.percentile(np.linalg.norm(Dm.reshape(len(Dm), -1, 3), axis=2), 99) * 100:.1f}, {np.linalg.norm(Dm.reshape(len(Dm), -1, 3), axis=2).max() * 100:.1f} cm')
    if log:
        # every pose the game takes, as the game mixes the shapes: folded triangles round the shoulders before and after
        regT = np.any([r[0] for r in regs.values()], 0)[T].all(1); b = a = 0
        cov = np.zeros(n, bool)
        for o in garments:
            d, jj = cKDTree(o.P).query(Vb, workers=1); cov |= (d < 0.05) & (np.einsum('ij,ij->i', Vb - o.P[jj], o.N[jj]) < 0)
        regT &= ~cov[T].all(1)  # skin in sight at bind: what a fold there shows
        for M, f in zip(Ms, poses):
            P = lbs(Vb, W, M); R = blend_rot(W, M); Vc = Vb.copy()
            for s, k in info.items():
                K = np.array(k['dirs']); u = turn(M, ix, k['bone'], k['ref'])
                cc = np.clip(kernel(u[None], K)[0] @ np.array(k['w']), -np.array(k['lim']), np.array(k['lim']))
                for j in range(k['n']): Vc += cc[j] * shapes[f'{s}{j}']
            b1 = int((flips(T, V, P, R) & regT).sum()); a1 = int((flips(T, V, lbs(Vc, W, M), R) & regT).sum()); b += b1; a += a1
            if os.environ.get('PIT_DEBUG') == '2': log(f'      {f["pose"]} {b1} -> {a1}')
        log(f'    {", ".join(info)} over all {len(Ms)} poses: {b} folded triangles -> {a}')
    return shapes, info, Vb


def posed_skin(Vb, W, T, names, par, piv, poses, shapes=None, info=None, builds=()):
    """The skin in each pose as the game draws it (the correctives mixed as character.ts mixes them), and again with
    each of `builds` (the creator's slim and heavy body shapes, at full) on top: positions and vertex normals,
    (k, n, 3) each."""
    ix = {nm: i for i, nm in enumerate(names)}; Ps, Ns = [], []
    for f, B in [(f, None) for f in poses] + [(f, B) for B in builds for f in poses]:
        M = pose_mats(names, par, piv, f['q']); Vc = Vb.copy() if B is None else Vb + B
        for s, k in (info or {}).items():
            K = np.array(k['dirs']); u = turn(M, ix, k['bone'], k['ref'])
            cc = np.clip(kernel(u[None], K)[0] @ np.array(k['w']), -np.array(k['lim']), np.array(k['lim']))
            for j in range(k['n']): Vc += cc[j] * shapes[f'{s}{j}']
        P = lbs(Vc, W, M); fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]]); N = np.zeros_like(P)
        for c in range(3): np.add.at(N, T[:, c], fn)
        Ps.append(P.astype(np.float32)); Ns.append((N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)).astype(np.float32))
    return np.array(Ps), np.array(Ns)
