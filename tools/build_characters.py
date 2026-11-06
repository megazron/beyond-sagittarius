#!/usr/bin/env python3
"""Offline character builder: MakeHuman CC0 base mesh -> skinned, clothed, morphing GLBs.

  ~/.venvs/ehd/bin/python tools/build_characters.py [--only id,id] [--force]

Reads the assets fetched by tools/fetch_character_assets.py and writes public/models/crew/.
"""
import argparse, json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'chars'))
import mh
from glb import Glb, pack_skin, F32, U8, I8, U16, U32
from simplify import simplify
from config import CHARS, MORPHS, CREW
from scipy.spatial import cKDTree
from multiprocessing import Pool
import paint

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'models', 'crew')
LODS = {'': dict(body=2200, head=4000, cloth=6000, cost=4e-4), '.lod1': dict(body=1100, head=1800, cloth=2600, cost=4e-3)}
if os.environ.get('NO_DECIM'):
    del LODS['.lod1']


def tri_fan(faces, fuv, sel):
    T, TU = [], []
    for i in sel:
        f, u = faces[i], fuv[i]
        for k in range(1, len(f) - 1):
            T.append((f[0], f[k], f[k + 1])); TU.append((u[0], u[k], u[k + 1]))
    return np.array(T, np.int64), np.array(TU, np.int64)


def vnormals(P, T):
    n = np.zeros_like(P)
    fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    for k in range(3):
        np.add.at(n, T[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


class Part:
    """Triangle soup with shared position indices and per-corner UVs."""
    def __init__(self, P, T, TU, UV, W, name, morph=None, extra=None):
        self.P, self.T, self.TU, self.UV, self.W, self.name = P, T, TU, UV, W, name
        self.morph = dict(morph) if morph else {}
        self.N = vnormals(P, T)
        self.extra = extra or {}

    def decimated(self, target, locked=None, importance=None, maxcost=4e-4):
        if len(self.T) <= target or os.environ.get('NO_DECIM'):
            return self
        T2, tu = simplify(self.P, self.T, self.TU, target, locked, importance, maxcost=maxcost)
        o = Part.__new__(Part)
        o.P, o.T, o.TU, o.UV, o.W, o.name, o.morph, o.N, o.extra = self.P, T2, tu, self.UV, self.W, self.name, self.morph, self.N, self.extra
        return o

    def corners(self):
        """Unique (position, uv) pairs -> render vertices and indices."""
        key = self.T.astype(np.int64) * (len(self.UV) + 1) + self.TU
        uniq, inv = np.unique(key.ravel(), return_inverse=True)
        pv = uniq // (len(self.UV) + 1)
        uv = uniq % (len(self.UV) + 1)
        return pv, uv, inv.astype(np.uint32)


def write_prim(g, part, skin, mat):
    pv, uv, idx = part.corners()
    P = part.P[pv]
    # decimation can leave a sliver wound against its smooth normals, which shades black on two-sided cloth
    tri = idx.reshape(-1, 3).astype(np.int64)
    fn = np.cross(P[tri[:, 1]] - P[tri[:, 0]], P[tri[:, 2]] - P[tri[:, 0]])
    vn = part.N[pv][tri].sum(1)
    bad = np.einsum('ij,ij->i', fn, vn) < 0
    tri[bad] = tri[bad][:, [0, 2, 1]]
    idx = tri.ravel().astype(np.uint32)
    attrs = {'POSITION': g.accessor(P, F32, target=34962, minmax=True)}
    N = part.N[pv]
    attrs['NORMAL'] = g.accessor(np.clip(np.round(N * 127), -127, 127).astype(np.int8), I8, 3, normalized=True, target=34962)
    UV = np.clip(part.UV[uv], 0, 1)
    attrs['TEXCOORD_0'] = g.accessor(np.round(UV * 65535).astype(np.uint16), U16, 2, normalized=True, target=34962)
    J, Wq = pack_skin(part.W[pv])
    attrs['JOINTS_0'] = g.accessor(J, U8, 4, target=34962)
    attrs['WEIGHTS_0'] = g.accessor(Wq, U8, 4, normalized=True, target=34962)
    g.quant = True
    for k, a in part.extra.items():
        attrs[k] = g.accessor(a[pv].astype(np.float32), F32, target=34962)
    prim = {'attributes': attrs, 'indices': g.accessor(idx, U16 if len(pv) < 65536 else U32, 1, target=34963), 'material': mat}
    names = []
    if part.morph:
        tg = []
        for name, D in part.morph.items():
            d = D[pv]
            nz = np.nonzero(np.abs(d).max(1) > 1e-5)[0]
            if not len(nz):
                nz = np.array([0])
            tg.append({'POSITION': g.sparse_vec3(len(pv), nz, d[nz])})
            names.append(name)
        prim['targets'] = tg
    return g.mesh(part.name, prim, names or None), len(idx) // 3


class Ctx:
    pass


def setup():
    c = Ctx()
    c.base = mh.Obj(f'{mh.DATA}/3dobjs/base.obj')
    c.rig = mh.Rig()
    return c


def asset_part(c, name_or_path, Vdm, scale, off, morphs, name, Wfix=None, inflate=0.0):
    if morphs:
        morphs = {k: v for k, v in morphs.items() if not k.startswith('ear')}
    clo = mh.Clo(name_or_path if name_or_path.endswith('.mhclo') else mh.find_clo(name_or_path))
    P = clo.fit(Vdm) * scale + off
    o = clo.obj
    T, TU = tri_fan(o.faces, o.fuv, range(len(o.faces)))
    W = clo.transfer(c.rig.W)
    W = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
    UV = np.stack([o.vt[:, 0], 1 - o.vt[:, 1]], 1)
    md = {k: clo.transfer(d) for k, d in morphs.items()} if morphs else None
    if inflate:
        P = P + vnormals(P, T) * inflate
    p = Part(P, T, TU, UV, W, name, md)
    p.clo = clo
    return p


def skirt_weights(c, p, pivots):
    """Long garments must not split with the legs: below the crotch, hang from both thighs and the hips."""
    ix = c.rig.index
    crotch = pivots[ix['upperlegL']][1] - 0.04
    knee = pivots[ix['lowerlegL']][1]
    y, x = p.P[:, 1], p.P[:, 0]
    k = np.clip((crotch - y) / max(crotch - knee, 1e-3), 0, 1)
    k = k * k * (3 - 2 * k)
    a = np.clip((x + 0.11) / 0.22, 0, 1)
    a = a * a * (3 - 2 * a)
    Wn = np.zeros_like(p.W)
    Wn[:, ix['upperlegL']] = a * 0.62
    Wn[:, ix['upperlegR']] = (1 - a) * 0.62
    Wn[:, ix['hips']] = 0.38
    p.W = p.W * (1 - k[:, None]) + Wn * k[:, None]
    # a skirt stands clear of the legs it hides: striding thighs must not come through
    r = np.stack([x, np.zeros_like(x), p.P[:, 2] - pivots[ix['hips']][2]], 1)
    p.P = p.P + r / np.maximum(np.linalg.norm(r, axis=1, keepdims=True), 1e-6) * (k * 0.045)[:, None]
    sway = np.clip((crotch + 0.12 - y) / max(crotch + 0.12, 1e-3), 0, 1).astype(np.float32)
    p.extra['_SWAY'] = sway
    return p


def ear_morphs(Vdm, scale):
    """Species ears as morph targets: pulled from the real ear vertices."""
    out = {k: np.zeros_like(Vdm) for k in ('ear_fin', 'ear_long', 'ear_tuft')}
    for side, sx in (('l', 1.0), ('r', -1.0)):
        idx, _ = mh.load_target(f'ears/{side}-ear-scale-incr.target')
        ip, dp = mh.load_target(f'ears/{side}-ear-shape-pointed.target')
        P = Vdm[idx]
        y0, y1 = P[:, 1].min(), P[:, 1].max()
        t = np.clip((P[:, 1] - y0) / (y1 - y0), 0, 1)
        back = np.clip((P[:, 2].max() - P[:, 2]) / (np.ptp(P[:, 2]) + 1e-6), 0, 1)
        out_ = np.clip((np.abs(P[:, 0]) - np.abs(P[:, 0]).min()) / (np.ptp(np.abs(P[:, 0])) + 1e-6), 0, 1)
        for k, (ax, ay, az, pw) in {'ear_long': (0.35, 0.5, -0.6, 2.2), 'ear_tuft': (0.05, 0.62, -0.15, 2.0), 'ear_fin': (0.42, 0.14, -0.62, 1.4)}.items():
            w = (t ** pw) * (0.35 + 0.65 * out_)
            d = np.stack([sx * ax * w, ay * w, az * w], 1)
            if k == 'ear_fin':
                d[:, 1] += np.sin(back * 9.0) * 0.1 * w
            out[k][idx] += d
            out[k][ip] += dp
    return {k: v * scale for k, v in out.items()}


def resolve_layers(inner_P, outer, margin):
    """Push anything poking through an outer garment back under it."""
    tree = cKDTree(outer.P)
    d, j = tree.query(inner_P, workers=1)
    n = outer.N[j]
    s = np.einsum('ij,ij->i', inner_P - outer.P[j], n)
    m = (d < 0.05) & (s > -margin)
    out = inner_P.copy()
    out[m] -= n[m] * (s[m] + margin)[:, None]
    return out


def covered(P, N, garments, reach=0.035):
    """Vertices hidden under a garment: one lies just outside them, facing the same way."""
    hid = np.zeros(len(P), bool)
    for o in garments:
        d, j = cKDTree(o.P).query(P, workers=1)
        s = np.einsum('ij,ij->i', o.P[j] - P, o.N[j])
        hid |= (d < reach) & (s > -0.004)
    return hid


def erode(hid, T, rings=2):
    """Keep a margin of real surface inside every hidden region, so openings show no hole."""
    h = hid.copy()
    for _ in range(rings):
        vis = ~h
        m = vis[T].any(1)
        h[T[m].ravel()] = False
    return h


def build(c, cid, force=False):
    cfg = CHARS[cid]
    base, rig = c.base, c.rig
    t0 = time.time()
    tl = mh.macro_targets(**cfg['macro']) + cfg.get('extra', [])
    Vdm = mh.apply_targets(base.v, tl)
    bodyf = base.group_faces(lambda g: g == 'body')
    used = np.unique(np.concatenate([base.faces[i] for i in bodyf]))
    y0, y1 = Vdm[used, 1].min(), Vdm[used, 1].max()
    scale = cfg['height'] / (y1 - y0)
    off = np.array([0.0, -y0 * scale, 0.0])
    V = Vdm * scale + off
    piv = rig.pivots(Vdm) * scale + off
    morphs = {}
    for name, lst in MORPHS.items():
        D = np.zeros_like(Vdm)
        for t, w in lst:
            i, d = mh.load_target(t)
            D[i] += d * w * scale
        morphs[name] = D
    morphs.update(ear_morphs(Vdm, scale))
    # build sliders for the character creator
    vb = {}
    for k in ('build_slim', 'build_heavy'):
        if k in cfg:
            Vk = mh.apply_targets(base.v, mh.macro_targets(**cfg[k]) + cfg.get('extra', []))
            vb[k] = Vk * scale + off - V
            vb[k + '_dm'] = Vk
    # --- assets ---
    garments, deleted = [], set()
    for nm, tint, opt in cfg['clothes']:
        p = asset_part(c, nm, Vdm, scale, off, None, 'cloth', inflate=opt.get('inflate', 0))
        for k in ('build_slim', 'build_heavy'):
            if k in vb:
                p.morph[k] = p.clo.fit(vb[k + '_dm']) * scale + off - p.P
        p.extra['_ACCENT'] = np.full(len(p.P), 1.0 if opt.get('accent') else 0.0, np.float32)
        deleted.update(p.clo.delete)
        if opt.get('skirt'):
            skirt_weights(c, p, piv)
        p.tint, p.opt, p.asset = tint, opt, nm
        garments.append(p)
    # layers: inner garments never show through outer ones, and hidden cloth is not shipped
    for i in range(len(garments)):
        outer = garments[i + 1:]
        if not outer:
            continue
        g = garments[i]
        for o in outer:
            g.P = resolve_layers(g.P, o, 0.012)
        hid = erode(covered(g.P, g.N, outer, 0.025), g.T, 6)
        vis = ~hid[g.T].all(1)
        g.T, g.TU = g.T[vis], g.TU[vis]
    # --- body ---
    keep = []
    dl = np.zeros(len(V), bool)
    dl[list(deleted)] = True
    Tall = tri_fan(base.faces, base.fuv, bodyf)[0]
    dl |= erode(covered(V, vnormals(V, Tall), garments, 0.04), Tall, 3)
    hw0 = rig.W[:, [rig.index[n] for n in ('head', 'jaw', 'eyeL', 'eyeR')]].sum(1)
    dl[hw0 > 0.3] = False
    for i in bodyf:
        if not dl[base.faces[i]].all():
            keep.append(i)
    T, TU = tri_fan(base.faces, base.fuv, keep)
    UV = np.stack([base.vt[:, 0], 1 - base.vt[:, 1]], 1)
    # head / body split on weights
    hw = rig.W[:, [rig.index[n] for n in ('head', 'jaw', 'eyeL', 'eyeR')]].sum(1)
    hm = hw[T].mean(1) > 0.5
    Vb = V
    for o in garments:
        Vb = resolve_layers(Vb, o, 0.011)
    bm = {k: vb[k] for k in vb if not k.endswith('_dm')}
    head = Part(V, T[hm], TU[hm], UV, rig.W, 'skin_head', {**morphs, **bm})
    body = Part(Vb, T[~hm], TU[~hm], UV, rig.W, 'skin_body', bm)
    # keep shared normals across the neck seam
    Nall = vnormals(V, T)
    head.N = Nall; body.N = Nall
    # the neck seam must not move
    seam = np.zeros(len(V), bool)
    seam[np.intersect1d(T[hm].ravel(), T[~hm].ravel())] = True
    # importance: face features and fingers keep their detail
    imp = np.ones(len(V))
    for b, k in (('jaw', 14), ('eyeL', 14), ('eyeR', 14), ('finger3_2L', 3), ('finger3_2R', 3)):
        imp += rig.W[:, rig.index[b]] * k
    mdelta = sum(np.abs(d).max(1) for d in morphs.values())
    imp += np.clip(mdelta * 400, 0, 12)
    # --- extras: eyes, teeth, tongue, lashes, brows ---
    eyes = asset_part(c, f'{mh.SYS}/eyes/high-poly/high-poly.mhclo', Vdm, scale, off, None, 'eyes')
    cm = (eyes.UV[eyes.TU].mean(1) > 0.86).all(1)
    cornea = Part(eyes.P, eyes.T[cm], eyes.TU[cm], eyes.UV, eyes.W, 'cornea')
    eyes = Part(eyes.P, eyes.T[~cm], eyes.TU[~cm], eyes.UV, eyes.W, 'eyes')
    mouth_t = asset_part(c, f'{mh.SYS}/teeth/teeth_base/teeth_base.mhclo', Vdm, scale, off, morphs, 'teeth')
    tongue = asset_part(c, f'{mh.SYS}/tongue/tongue01/tongue01.mhclo', Vdm, scale, off, morphs, 'tongue')
    lash = asset_part(c, f'{mh.SYS}/eyelashes/eyelashes01/eyelashes01.mhclo', Vdm, scale, off, morphs, 'lash')
    brow = asset_part(c, f'{mh.SYS}/eyebrows/eyebrow001/eyebrow001.mhclo', Vdm, scale, off, morphs, 'brow')
    # --- textures ---
    os.makedirs(f'{OUT}/tex', exist_ok=True)
    atlas = paint.tile_layout(len(garments))
    if 'atlas' not in cfg:
        paint.cloth_atlas(cid, garments, OUT)
        paint.mark_map(cid, cfg, base, rig, OUT)
    # --- LODs ---
    info = {}
    for suffix, L in LODS.items():
        if suffix not in cfg.get('lods', ('', '.lod1')):
            continue
        g = Glb()
        # skeleton
        par = rig.parents()
        nodes = []
        for i, n in enumerate(rig.names):
            pp = piv[par[i]] if par[i] >= 0 else np.zeros(3)
            nodes.append(g.node(name=n, translation=[float(x) for x in piv[i] - pp]))
        for i, n in enumerate(rig.names):
            ch = [nodes[j] for j in range(len(par)) if par[j] == i]
            if ch:
                g.j['nodes'][nodes[i]]['children'] = ch
        ibm = np.tile(np.eye(4), (len(piv), 1, 1))
        ibm[:, 3, :3] = -piv  # column-major: translation in last column -> row 3 in memory
        sk = g.skin(nodes, ibm.astype(np.float32), nodes[0])
        M = {k: g.material(k) for k in ('skin', 'eyes', 'cornea', 'mouth', 'lash', 'cloth')}
        total = 0
        rootc = [nodes[0]]

        def emit(part, mat):
            nonlocal total
            mi, tris = write_prim(g, part, sk, M[mat])
            n = g.node(name=part.name, mesh=mi, skin=sk)
            rootc.append(n)
            total += tris

        locked = seam.copy()
        emit(head.decimated(L['head'], locked, imp, L['cost']), 'skin')
        bb = body.decimated(L['body'], locked, imp, L['cost'])
        emit(bb, 'skin')
        emit(eyes.decimated(500 if suffix == '' else 200), 'eyes')
        emit(cornea.decimated(200 if suffix == '' else 80), 'cornea')
        mp = merge([mouth_t.decimated(420 if suffix == '' else 160), tongue.decimated(80 if suffix == '' else 40)], 'mouth', morphs=list(morphs))
        emit(mp, 'mouth')
        lb = merge([lash, brow], 'lash', uvmap=[(0, 0, 0.5, 1), (0.5, 0, 0.5, 1)], morphs=list(morphs))
        emit(lb, 'lash')
        budget = L['cloth']
        tot = sum(len(p.T) for p in garments)
        cl = []
        for p, rect in zip(garments, atlas):
            cl.append(p.decimated(max(300, int(budget * len(p.T) / tot)), None, None, L['cost']))
        emit(merge(cl, 'cloth', uvmap=atlas, morphs=[k for k in ('build_slim', 'build_heavy') if k in vb]), 'cloth')
        root = g.node(name='crew', children=rootc)
        g.j['scenes'][0]['nodes'] = [root]
        size = g.write(f'{OUT}/{cid}{suffix}.glb')
        info[suffix or 'web'] = dict(tris=total, kb=size // 1024)
    meta = dict(height=cfg['height'], skin=cfg['skin_src'], atlas=cfg.get('atlas', cid), pivots={n: [round(float(x), 4) for x in piv[i]] for i, n in enumerate(rig.names)})
    for k in vb:
        if not k.endswith('_dm'):
            meta[k + '_pivots'] = [[round(float(x), 4) for x in r] for r in (rig.pivots(vb[k + '_dm']) * scale + off)]
    meta['fit'] = fit_data(V, rig, piv, garments)
    meta.update(paint.head_profile(V, T[hm], piv[rig.index['head']]))
    json.dump(meta, open(f'{OUT}/{cid}.json', 'w'), separators=(',', ':'))
    print(cid, info, f'{time.time() - t0:.1f}s', flush=True)


def fit_data(V, rig, piv, garments):
    """Ring sizes for props that hug the body: belts, scarves."""
    ix = rig.index
    armb = [ix[n] for n in rig.names if any(k in n for k in ('arm', 'hand', 'finger', 'clavicle'))]
    allP = np.concatenate([g.P[g.W[:, armb].sum(1) < 0.2] for g in garments])
    def ring(y, h=0.03, P=allP, zlim=None):
        m = np.abs(P[:, 1] - y) < h
        q = P[m]
        return [round(float(x), 4) for x in (np.abs(q[:, 0]).max(), (q[:, 2].max() - q[:, 2].min()) / 2, y, (q[:, 2].max() + q[:, 2].min()) / 2)] if len(q) else [0.16, 0.12, y, 0]
    waist = (piv[ix['hips']][1] + piv[ix['spine']][1]) / 2
    return {'waist': ring(waist), 'neck': ring(piv[ix['neck']][1] + 0.02, 0.02, V[rig.W[:, ix['neck']] > 0.4]), 'chest': ring(piv[ix['chest']][1])}


def merge(parts, name, uvmap=None, morphs=None):
    """Concatenate parts (after decimation) with optional uv rect remap."""
    Ps, Ts, TUs, UVs, Ws, Ns = [], [], [], [], [], []
    ms = {k: [] for k in (morphs or [])}
    ex = {}
    vo = uo = 0
    for i, p in enumerate(parts):
        Ps.append(p.P); Ws.append(p.W); Ns.append(p.N)
        uv = p.UV.copy()
        if uvmap is not None:
            x, y, w, h = uvmap[i]
            uv = np.mod(uv, 1.0000001) * [w, h] + [x, y]
        UVs.append(uv)
        Ts.append(p.T + vo); TUs.append(p.TU + uo)
        for k in ms:
            ms[k].append(p.morph[k] if k in p.morph else np.zeros_like(p.P))
        vo += len(p.P); uo += len(p.UV)
    keys = {k for p in parts for k in p.extra}
    o = Part.__new__(Part)
    o.P = np.concatenate(Ps); o.T = np.concatenate(Ts); o.TU = np.concatenate(TUs); o.UV = np.concatenate(UVs)
    o.W = np.concatenate(Ws); o.N = np.concatenate(Ns); o.name = name
    o.morph = {k: np.concatenate(v) for k, v in ms.items()}
    o.extra = {k: np.concatenate([p.extra.get(k, np.zeros(len(p.P), np.float32)) for p in parts]) for k in keys}
    return o


_ctx = None
def job(cid):
    global _ctx
    if _ctx is None:
        _ctx = setup()
    try:
        build(_ctx, cid)
    except Exception:
        import traceback
        print('FAILED', cid, traceback.format_exc(), flush=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    os.makedirs(f'{OUT}/tex', exist_ok=True)
    ctx0 = setup()
    paint.shared_maps(ctx0.base, ctx0.rig, OUT)
    ids = a.only.split(',') if a.only else list(CHARS)
    ids = [i for i in ids if a.force or a.only or not os.path.exists(f'{OUT}/{i}.json')]
    with Pool(min(2, len(ids) or 1)) as pool:
        pool.map(job, ids, 1)
