"""Texture work: photo skin recoloured per species, marks painted through a uv->3D position map,
cloth atlases, irises. Everything is resumable: outputs are simply overwritten."""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter, binary_dilation, distance_transform_edt
from scipy.spatial import cKDTree
import mh
import suit
from config import CHARS

RES = 1024  # position map resolution


def save_webp(im, path, q=82):
    im.save(path, 'WEBP', quality=q, method=6)


def hexrgb(c):
    return np.array([(c >> 16) & 255, (c >> 8) & 255, c & 255], np.float32) / 255


def srgb2lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def lin2srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def tile_layout(n):
    """Garment tiles in the upper 15/16 of the atlas; the bottom strip is the accessory swatch."""
    H = 15 / 16
    if n == 1:
        return [(0, 0, 1, H)]
    if n == 2:
        return [(0, 0, 0.5, H), (0.5, 0, 0.5, H)]
    return [(0, 0, 0.5, H / 2), (0.5, 0, 0.5, H / 2), (0, H / 2, 0.5, H / 2), (0.5, H / 2, 0.5, H / 2)][:n]


def detail_normal(L, strength=2.0):
    gy, gx = np.gradient(L)
    n = np.stack([-gx * strength, -gy * strength, np.ones_like(L)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


# The suit's source texture keeps each piece on its own uv island, so each can be its own cloth.
SUIT = dict(satin=(10, 20, 11, 21), shirt=(8, 9, 34, 35), bib=(9,), pocket=(23,), buttons=(0, 1, 2, 3, 4, 5, 24, 25, 26), stitch=(27, 36))


def uv_islands(p):
    """Island id of every triangle of a garment, from uv connectivity."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    r = np.concatenate([p.TU[:, 0], p.TU[:, 1]]); c = np.concatenate([p.TU[:, 1], p.TU[:, 2]])
    n = len(p.UV)
    _, lab = connected_components(coo_matrix((np.ones(len(r)), (r, c)), shape=(n, n)), directed=False)
    return lab[p.TU[:, 0]]


def suit_cloth(p, L, w, h):
    """Three-piece from one mesh: wool, satin lapels, a pale shirt, and a waistcoat painted on the bib."""
    uvp = np.mod(p.UV, 1.0) * [w, h]

    def mask(ids):
        m = Image.new('L', (w, h), 0)
        dr = ImageDraw.Draw(m)
        for t in p.TU[np.isin(p.island, ids)]:
            dr.polygon([tuple(uvp[t[0]]), tuple(uvp[t[1]]), tuple(uvp[t[2]])], fill=255)
        return binary_dilation(np.asarray(m) > 0, iterations=2)

    wool = np.array(p.tint, np.float32) / 255
    rs = np.random.default_rng(9)
    fleck = gaussian_filter(rs.normal(0, 1, L.shape), 0.8).astype(np.float32)
    drape = gaussian_filter(L, 2.0)
    Ln = np.clip(drape / max(float(np.median(drape)), .02), .78, 1.2)
    a = (Ln * (1 + fleck * .11))[..., None] * wool
    sat = mask(SUIT['satin'])
    a[sat] = wool * 1.16 * (1 + fleck[sat, None] * .02)
    shirt = mask(SUIT['shirt'])
    blue = np.array((0xa6, 0xc6, 0xea), np.float32) / 255
    a[shirt] = blue * np.clip(L[shirt] / max(float(np.median(L[shirt])), .02), .86, 1.06)[:, None]
    a[mask(SUIT['pocket'])] = wool * .92
    a[mask(SUIT['buttons'])] = np.array((0x26, 0x19, 0x12), np.float32) / 255
    a[mask(SUIT['stitch'])] = wool * .6
    # waistcoat: positions over the bib decide where the V opens
    o = p.clo.obj
    bib = np.zeros((h, w), bool)
    X = np.zeros((h, w), np.float32); Y = np.zeros((h, w), np.float32)
    for tp, tu in zip(p.T[np.isin(p.island, SUIT['bib'])], p.TU[np.isin(p.island, SUIT['bib'])]):
        q = uvp[tu]
        x0, y0 = np.floor(q.min(0)).astype(int) - 1
        x1, y1 = np.ceil(q.max(0)).astype(int) + 2
        xs, ys = np.meshgrid(np.arange(max(x0, 0), min(x1, w)) + .5, np.arange(max(y0, 0), min(y1, h)) + .5)
        d = (q[1, 1] - q[2, 1]) * (q[0, 0] - q[2, 0]) + (q[2, 0] - q[1, 0]) * (q[0, 1] - q[2, 1])
        if abs(d) < 1e-9:
            continue
        l0 = ((q[1, 1] - q[2, 1]) * (xs - q[2, 0]) + (q[2, 0] - q[1, 0]) * (ys - q[2, 1])) / d
        l1 = ((q[2, 1] - q[0, 1]) * (xs - q[2, 0]) + (q[0, 0] - q[2, 0]) * (ys - q[2, 1])) / d
        l2 = 1 - l0 - l1
        ins = (l0 > -.03) & (l1 > -.03) & (l2 > -.03)
        if ins.any():
            yy, xx = np.nonzero(ins)
            yy = yy + max(y0, 0); xx = xx + max(x0, 0)
            ww = np.stack([l0[ins], l1[ins], l2[ins]], 1)
            X[yy, xx] = ww @ o.v[tp, 0]; Y[yy, xx] = ww @ o.v[tp, 1]; bib[yy, xx] = True
    # the cut mesh gives a ragged field: smooth it so the V is one clean line
    wgt = np.maximum(gaussian_filter(bib.astype(np.float32), 7), 1e-3)
    X = gaussian_filter(X * bib, 7) / wgt; Y = gaussian_filter(Y * bib, 7) / wgt
    V0, V1, HW = 5.5, 6.6, .32                                          # point of the V, top, half width at top
    edge = np.clip((Y - V0) / (V1 - V0), 0, 1) * HW
    gap = np.abs(X) - edge
    vest = bib & (gap > 0)
    a[vest] = wool * .86 * (1 + fleck[vest, None] * .1)
    a[bib & (gap > 0) & (gap < .035)] = wool * .52                      # the waistcoat's edge
    a[bib & (Y > V0) & (gap < 0) & (np.abs(X) < .012)] = blue * .72     # shirt placket
    a[bib & (Y < V0) & (np.abs(X) < .012)] = wool * .5                  # waistcoat front
    for by in (5.2, 4.72, 4.25):
        a[bib & (np.hypot(X - .035, Y - by) < .05)] = np.array((0x26, 0x19, 0x12), np.float32) / 255
    return np.clip(a, 0, 1)


def cloth_atlas(cid, garments, out, size=2048):
    rects = tile_layout(len(garments))
    A = Image.new('RGB', (size, size), (200, 200, 200))
    Nn = Image.new('RGB', (size, size), (128, 128, 255))
    for p, r in zip(garments, rects):
        w, h = int(r[2] * size), int(r[3] * size)
        mat = mh.mhmat(f'{p.clo.dir}/{p.clo.material}') if p.clo.material else {}
        tex = mat.get('diffuseTexture')
        im = Image.open(tex).convert('RGB').resize((w, h), Image.LANCZOS) if tex and os.path.exists(tex) else Image.new('RGB', (w, h), (200, 200, 200))
        a = np.asarray(im, np.float32) / 255
        # grow the painted islands over the empty background: mips must never pull black into a seam
        mk = Image.new('L', (w, h), 0)
        dr = ImageDraw.Draw(mk)
        uvp = np.mod(p.UV, 1.0) * [w, h]
        for t in p.TU:
            dr.polygon([tuple(uvp[t[0]]), tuple(uvp[t[1]]), tuple(uvp[t[2]])], fill=255)
        M = binary_dilation(np.asarray(mk) > 0, iterations=1)
        idx = distance_transform_edt(~M, return_distances=False, return_indices=True)
        a = a[idx[0], idx[1]]
        L = a @ np.array([0.3, 0.59, 0.11], np.float32)
        if p.tint is not None:
            if p.opt.get('flat'):
                # third-party logos and emblems must not survive: plain woven cloth instead
                rs = np.random.default_rng(5)
                L = 0.6 + gaussian_filter(rs.normal(0, 0.05, L.shape), 1.0).astype(np.float32)
            # reference brightness from texels the garment really uses, not the empty background
            uvs = np.clip(np.mod(p.UV[np.unique(p.TU)], 1.0), 0, 0.999)
            ref = float(L[(uvs[:, 1] * h).astype(int), (uvs[:, 0] * w).astype(int)].mean())
            Ln = np.clip(1 + (L - ref) / max(ref, 0.12) * 0.6, 0.45, 1.35)
            Ln = 1 + (Ln - 1) * p.opt.get('contrast', 1.0)
            c = np.array(p.tint, np.float32) / 255
            a = np.clip(Ln[..., None] * c, 0, 1)
        if p.opt.get('islands'):
            a = suit_cloth(p, L, w, h)
        A.paste(Image.fromarray((a * 255).astype(np.uint8)), (int(r[0] * size), int(r[1] * size)))
        nt = mat.get('normalmapTexture')
        if nt and os.path.exists(nt) and not p.opt.get('flat'):
            na = np.asarray(Image.open(nt).convert('RGB').resize((w, h), Image.LANCZOS))[idx[0], idx[1]]
            Nn.paste(Image.fromarray(na), (int(r[0] * size), int(r[1] * size)))
        else:
            Lh = L - gaussian_filter(L, 3)
            Nn.paste(Image.fromarray(detail_normal(Lh * 6, 1.5)), (int(r[0] * size), int(r[1] * size)))
    A.save(f'{out}/tex/{cid}_cloth.png.tmp.webp', 'WEBP', quality=84, method=6)
    os.replace(f'{out}/tex/{cid}_cloth.png.tmp.webp', f'{out}/tex/{cid}_cloth.webp')
    save_webp(Nn, f'{out}/tex/{cid}_cloth_n.webp', 78)
    A.resize((1024, 1024), Image.LANCZOS).save(f'{out}/tex/{cid}_cloth.m.webp', 'WEBP', quality=78, method=6)
    Nn.resize((1024, 1024), Image.LANCZOS).save(f'{out}/tex/{cid}_cloth_n.m.webp', 'WEBP', quality=72, method=6)
    return rects


_maps = {}
def position_maps(base, rig):
    """Rasterise the base body into uv space: 3D position and body-region weights per texel."""
    if 'P' in _maps:
        return _maps
    cache = f'{mh.ROOT}/posmap_{RES}.npz'
    if os.path.exists(cache):
        z = np.load(cache)
        _maps.update({k: z[k] for k in z.files})
        return _maps
    faces = base.group_faces(lambda g: g == 'body')
    regions = {'head': ['head', 'jaw', 'eyeL', 'eyeR'], 'neck': ['neck'],
               'arm': [n for n in rig.names if any(k in n for k in ('arm', 'hand', 'finger', 'forearm'))],
               'leg': [n for n in rig.names if any(k in n for k in ('leg', 'foot', 'toe'))]}
    RW = np.stack([rig.W[:, [rig.index[n] for n in v]].sum(1) for v in regions.values()], 1)
    P = np.zeros((RES, RES, 3), np.float32)
    R = np.zeros((RES, RES, len(regions)), np.float32)
    M = np.zeros((RES, RES), bool)
    vt = base.vt
    for fi in faces:
        f, u = base.faces[fi], base.fuv[fi]
        for k in range(1, len(f) - 1):
            a, b, c = (0, k, k + 1)
            uv = np.stack([vt[u[a]], vt[u[b]], vt[u[c]]]) * [RES, RES]
            uv[:, 1] = RES - uv[:, 1]
            x0, y0 = np.floor(uv.min(0)).astype(int) - 1
            x1, y1 = np.ceil(uv.max(0)).astype(int) + 1
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, RES - 1), min(y1, RES - 1)
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            d = (uv[1, 1] - uv[2, 1]) * (uv[0, 0] - uv[2, 0]) + (uv[2, 0] - uv[1, 0]) * (uv[0, 1] - uv[2, 1])
            if abs(d) < 1e-9:
                continue
            l0 = ((uv[1, 1] - uv[2, 1]) * (xs - uv[2, 0]) + (uv[2, 0] - uv[1, 0]) * (ys - uv[2, 1])) / d
            l1 = ((uv[2, 1] - uv[0, 1]) * (xs - uv[2, 0]) + (uv[0, 0] - uv[2, 0]) * (ys - uv[2, 1])) / d
            l2 = 1 - l0 - l1
            ins = (l0 > -0.02) & (l1 > -0.02) & (l2 > -0.02)
            if not ins.any():
                continue
            yy, xx = np.nonzero(ins)
            yy += y0; xx += x0
            w = np.stack([l0[ins], l1[ins], l2[ins]], 1)
            vi = [f[a], f[b], f[c]]
            P[yy, xx] = w @ base.v[vi]
            R[yy, xx] = w @ RW[vi]
            M[yy, xx] = True
    # bleed past island edges so filtering never samples black
    idx = distance_transform_edt(~M, return_distances=False, return_indices=True)
    P = P[idx[0], idx[1]]
    R = R[idx[0], idx[1]]
    np.savez_compressed(cache, P=P, R=R, M=M)
    _maps.update(P=P, R=R, M=M)
    return _maps


def worley(P, rng, spacing, jitter_scale=0.0):
    lo, hi = P.reshape(-1, 3).min(0), P.reshape(-1, 3).max(0)
    n = int(np.prod((hi - lo) / spacing)) + 8
    pts = rng.uniform(lo, hi, (n, 3))
    d, _ = cKDTree(pts).query(P.reshape(-1, 3), k=2, workers=-1)
    return (d[:, 1] - d[:, 0]).reshape(P.shape[:2]), d[:, 0].reshape(P.shape[:2])


def noise3(P, rng, scale, oct=3):
    """Cheap band-limited value noise: random sines through 3D."""
    out = np.zeros(P.shape[:2], np.float32)
    for o in range(oct):
        for _ in range(5):
            k = rng.normal(0, 1, 3)
            k = k / np.linalg.norm(k) * (2 ** o) / scale
            out += np.sin(P @ k.astype(np.float32) + rng.uniform(0, 6.28)) / (2 ** o)
    return out / (5 ** 0.5 * 1.6)


def face_uv(P):
    """Face plane coordinates: fx -1..1 across the cheeks, fy -1..1 chin to hairline. Base mesh decimetres."""
    return P[..., 0] / 0.74, (P[..., 1] - 7.86) / 0.98


def marks(look, maps, cid):
    """Returns (emissive mask 0..1, darken mask 0..1 and its colour, skin overlay list)."""
    P, R = maps['P'], maps['R']
    head, neck, arm, leg = [R[..., i] for i in range(4)]
    rng = np.random.default_rng(abs(hash(cid)) % (2 ** 31) if False else sum(map(ord, cid)) * 7 + 1)
    front = P[..., 2] > 0.3
    fx, fy = face_uv(P)
    em = np.zeros(P.shape[:2], np.float32)
    dark = np.zeros(P.shape[:2], np.float32)
    over = []  # (mask, rgb)

    def spot(x, y, r, on=em, soft=0.35):
        d = np.hypot(fx - x, (fy - y)) / r
        m = np.clip(1.3 - d, 0, 1) ** 2 * (head > 0.5) * front
        np.maximum(on, m.astype(np.float32), out=on)

    def dots(count, size, region):
        pts = np.nonzero((region > 0.5).ravel())[0]
        pick = rng.choice(pts, count)
        c = P.reshape(-1, 3)[pick]
        d, _ = cKDTree(c).query(P.reshape(-1, 3), workers=-1)
        d = d.reshape(P.shape[:2])
        r = size * (0.7 + 0.6 * noise3(P, rng, 1.0, 1) ** 2)
        return np.clip(1.2 - d / r, 0, 1) ** 1.5 * (region > 0.5)

    k = look
    if k == 'dots':     # scientist: bioluminescent freckles
        for x, y, r in ((-.72, -.1, .07), (-.64, -.24, .05), (-.76, -.3, .045), (-.58, -.09, .04), (.72, -.1, .07), (.64, -.24, .05), (.76, -.3, .045), (.58, -.09, .04), (-.16, .56, .045), (.13, .62, .04)):
            spot(x, y, r)
        np.maximum(em, dots(60, 0.05, arm + neck * 0.6), out=em)
    elif k == 'cracks':  # strong: ember seams
        f, _ = worley(P, rng, 0.55)
        line = np.clip(1 - f / 0.035, 0, 1) ** 1.5
        wob = noise3(P, rng, 1.6, 3)
        region = np.clip(wob * 1.4 + 0.45, 0, 1) * (1 - head * 0.75)
        em = (line * region).astype(np.float32)
        for s in (-1, 1):
            for (x0, y0, x1, y1) in ((.82, -.05, .67, -.3), (.67, -.3, .74, -.42), (.74, -.42, .5, -.72)):
                t = np.clip(((fx - s * x0) * (s * x1 - s * x0) + (fy - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2), 0, 1)
                d = np.hypot(fx - s * x0 - t * (s * x1 - s * x0), fy - y0 - t * (y1 - y0))
                np.maximum(em, (np.clip(1 - d / 0.022, 0, 1) * (head > 0.5) * front).astype(np.float32), out=em)
        t = np.clip((fy - .05) / .45, 0, 1)
        d = np.hypot(fx - (.5 - .16 * t), fy - (.05 + .45 * t))
        over.append(((np.clip(1 - d / .025, 0, 1) * (head > .5) * front), hexrgb(0xe8c49a)))
    elif k == 'veins':   # medic: thin rivers of light, brow sigil
        wob = noise3(P, rng, 1.8, 3)
        v = np.abs(np.sin(P[..., 0] * 5.0 + P[..., 2] * 3.0 + wob * 3.2))
        em = (np.clip(1 - v / 0.05, 0, 1) * np.clip(arm + neck, 0, 1)).astype(np.float32)
        d = np.abs(fx) / .055 + np.abs(fy - .56) / .12
        np.maximum(em, (np.clip((1.05 - d) * 8, 0, 1) * (head > .5) * front).astype(np.float32), out=em)
    elif k == 'stripes':  # explorer: dark tiger stripes, field tape on the nose
        wob = noise3(P, rng, 1.4, 2)
        band = np.sin(P[..., 1] * 5.2 + wob * 1.9)
        thick = 0.86 + 0.1 * noise3(P, rng, 2.0, 1)
        dark = (np.clip((band - thick) * 9, 0, 1) * np.clip(arm + leg + neck * .6, 0, 1) * .7).astype(np.float32)
        for s in (-1, 1):
            for y, l in ((.1, .2), (-.1, .24), (-.3, .18)):
                t = np.clip((1.0 - s * fx) / l, 0, 1)
                wdt = (1 - t) * .05
                m = (np.abs(fy - y + t * .02) < wdt) & (s * fx > 1 - l) & front & (head > .5)
                dark = np.maximum(dark, gaussian_filter(m.astype(np.float32), 1.0))
        tape = (np.abs(fx) < .17) & (np.abs(fy + .13) < .045) & front & (head > .5)
        over.append((gaussian_filter(tape.astype(np.float32), .7), hexrgb(0xf3e7cf)))
    elif k == 'plates':  # builder: stone plates, grease smudge
        f, _ = worley(P, rng, 0.8)
        line = np.clip(1 - f / 0.05, 0, 1)
        region = np.clip(arm * 1.2 + neck * .3, 0, 1) * np.clip(noise3(P, rng, 2.2, 2) + .8, 0, 1)
        dark = (line * region * .8).astype(np.float32)
        d = np.hypot((fx + .52) / .2, (fy + .42) / .1)
        over.append((np.clip(1 - d, 0, 1) ** .7 * .5 * (head > .5) * front, hexrgb(0x1e1e1e)))
        brow = np.clip(1 - np.abs(fy - .22 - .2 * np.abs(fx)) / .05, 0, 1) * (np.abs(fx) < .75)
        em = np.zeros_like(em)
        dark = np.maximum(dark, (brow * .55 * (head > .5) * front).astype(np.float32))
    elif k == 'stars':   # megazron or social
        if cid == 'megazron':
            np.maximum(em, dots(420, 0.022, np.ones_like(arm)), out=em)
        else:
            np.maximum(em, dots(40, 0.035, arm + neck), out=em)
            for x, y, r in ((.62, -.22, .13), (.78, -.08, .07), (-.68, -.24, .08)):
                a = np.arctan2(fy - y, fx - x)
                d = np.hypot(fx - x, fy - y)
                rr = r * (0.36 + 0.64 * np.abs(np.cos(a * 2)) ** 3)
                np.maximum(em, (np.clip((rr - d) / .01, 0, 1) * (head > .5) * front).astype(np.float32), out=em)
    return em, dark, over


# Each crew member's pores, creases and age come from their own CC0 scan-based skin.
SKIN_SRC = {'m': 'young_caucasian_male', 'f': 'young_caucasian_female', 'sci': 'young_asian_male', 'str': 'middleage_african_male', 'med': 'middleage_asian_female',
            'exp': 'young_caucasian_female2', 'bld': 'old_caucasian_male', 'soc': 'young_african_female'}


def fur_map(cid, base, rig, out, size=2048):
    """Strand map for the fur shells: R strand height, G tone. Strands follow the fall of the face."""
    P = position_maps(base, rig)['P']
    k = size // P.shape[0]
    P2 = np.repeat(np.repeat(P, k, 0), k, 1)
    be, sc = suit.beard(P2), suit.scalp(P2)
    gy, gx = np.gradient(gaussian_filter(P2[..., 1], 3))
    sp = np.hypot(*np.gradient(gaussian_filter(P2[..., 2], 3))) + np.hypot(gx, gy) + 1e-4  # dm per texel, roughly
    rs = np.random.default_rng(31)
    R = Image.new('L', (size, size), 0); G = Image.new('L', (size, size), 128)
    dr, dg = ImageDraw.Draw(R), ImageDraw.Draw(G)
    seeds = []
    for m, n, ln, curl in ((be, 170000, .13, .75), (sc, 150000, .06, .55)):
        ys, xs = np.nonzero(m > .03)
        pick = rs.integers(0, len(ys), n)
        keep = rs.random(n) < m[ys[pick], xs[pick]] ** 1.5
        y, x = ys[pick][keep], xs[pick][keep]
        seeds.append((x, y, m[y, x], np.full(len(x), ln), np.full(len(x), curl)))
    x, y, mv, ln, curl = [np.concatenate(c) for c in zip(*seeds)]
    v = (.3 + .7 * rs.random(len(x))) * (.12 + .88 * mv ** 1.3)
    order = np.argsort(v)
    ang = np.arctan2(-gy[y, x], -gx[y, x]) + rs.normal(0, 1, len(x)) * curl
    Lp = np.clip(ln * (.6 + .8 * rs.random(len(x))) / sp[y, x], 3, 22)
    tone = rs.integers(70, 200, len(x))
    for i in order:
        c, s_ = np.cos(ang[i]), np.sin(ang[i])
        x0, y0, l = float(x[i]), float(y[i]), float(Lp[i])
        hv = int(v[i] * 255)
        dr.line([x0, y0, x0 + c * l * .55, y0 + s_ * l * .55], fill=hv, width=2)
        dr.line([x0 + c * l * .55, y0 + s_ * l * .55, x0 + c * l, y0 + s_ * l], fill=int(hv * .7), width=1)
        dg.line([x0, y0, x0 + c * l, y0 + s_ * l], fill=int(tone[i]), width=2)
    I = Image.merge('RGB', (R, G, Image.new('L', (size, size), 0)))
    save_webp(I, f'{out}/tex/{cid}_fur.webp', 86)
    save_webp(I.resize((size // 2, size // 2), Image.LANCZOS), f'{out}/tex/{cid}_fur.m.webp', 82)


def mark_map(cid, cfg, base, rig, out):
    """Per-character paint: R glow, G dark marks, B overlay (scar, tape, smudge)."""
    maps = position_maps(base, rig)
    key = cfg['look']['marks']
    if key == 'suit':
        # roots under the fur: the skin itself is dark where the hair grows, with a soft fade at the edges
        P = maps['P']
        rs = np.random.default_rng(3)
        speck = np.clip(.72 + gaussian_filter(rs.normal(0, 1, P.shape[:2]), .7) * 1.1, 0, 1)
        be_, sc_ = suit.beard(P), suit.scalp(P)
        # a stubble shadow that runs a little past the fur, as a real beard edge does, so the fur never ends on bare skin
        halo = gaussian_filter(np.maximum(be_, sc_).astype(np.float32), 5) ** .8 * speck * .45
        dark = np.maximum.reduce([be_ ** 1.1 * speck * .95, sc_ ** 1.1 * speck * .95, halo, suit.brows(P) * .3]).astype(np.float32)
        em, over = np.zeros_like(dark), []
    else:
        em, dark, over = marks(key, maps, cid)
    b = np.zeros_like(em)
    for m, _c in over:
        b = np.maximum(b, m.astype(np.float32))
    rgb = (np.clip(np.stack([em, dark, b], -1), 0, 1) * 255).astype(np.uint8)
    save_webp(Image.fromarray(rgb), f'{out}/tex/{cid}_marks.webp', 85)


def detail_tiles(out):
    """Tiling micro detail: skin pores and cloth weave (RG normal), B broad noise for wear."""
    N = 512
    rs = np.random.default_rng(11)

    def tile(h):
        gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)); gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0))
        return gx, gy

    def wrapnoise(sig):
        return gaussian_filter(rs.normal(0, 1, (N, N)), sig, mode='wrap')
    # pores: pits at random spots over fine wrinkling
    pts = np.zeros((N, N)); pts[rs.integers(0, N, 5200), rs.integers(0, N, 5200)] = 1
    pores = gaussian_filter(pts, 1.1, mode='wrap'); pores /= pores.max()
    wr = wrapnoise(1.6); wr /= np.abs(wr).max()
    h = -pores * 1.0 + wr * 0.5
    gx, gy = tile(h)
    wear = wrapnoise(28); wear = (wear - wear.min()) / np.ptp(wear)
    k = 1.6
    Image.fromarray((np.clip(np.stack([gx * k * .5 + .5, gy * k * .5 + .5, wear], -1), 0, 1) * 255).astype(np.uint8)).save(f'{out}/tex/detail_skin.webp', 'WEBP', quality=88, method=6)
    # plain weave: warp and weft ribs alternating
    y, x = np.mgrid[0:N, 0:N] / N * 2 * np.pi * 64
    h = np.sin(x) * (np.sin(y / 2) > 0) + np.sin(y) * (np.sin(y / 2) <= 0)
    h = h + wrapnoise(1.2) / np.abs(wrapnoise(1.2)).max() * .8
    gx, gy = tile(gaussian_filter(h, .6, mode='wrap'))
    fibre = wrapnoise(14); fibre = (fibre - fibre.min()) / np.ptp(fibre)
    Image.fromarray((np.clip(np.stack([gx * .22 + .5, gy * .22 + .5, fibre], -1), 0, 1) * 255).astype(np.uint8)).save(f'{out}/tex/detail_cloth.webp', 'WEBP', quality=86, method=6)


def shared_maps(base, rig, out):
    """Species-neutral skin (R brightness ratio, G flush) and shared eye and lash maps.
    Colours are applied in the shader, so any skin the player picks keeps the photo detail."""
    maps = position_maps(base, rig)
    detail_tiles(out)
    for g, src in SKIN_SRC.items():
        if os.path.exists(f'{out}/tex/skin_{g}.webp'):
            continue
        d = f'{mh.SYS}/skins/{src}'
        tex = sorted(f for f in os.listdir(d) if f.endswith('.png'))[0]
        a = srgb2lin(np.asarray(Image.open(f'{d}/{tex}').convert('RGB'), np.float32) / 255)
        S = a.shape[0]
        lum = a @ np.array([0.3, 0.6, 0.1], np.float32)
        mask = np.asarray(Image.fromarray(maps['M']).resize((S, S)))
        r = lum / np.median(lum[mask])
        red = (a[..., 0] - a[..., 2]) / np.maximum(lum, 1e-3)
        flush = np.clip((red - np.median(red[mask])) * 1.6, 0, 1)
        if os.environ.get('APPEAL') == '1':
            # appealing, not photoreal: pores and blotches softened, and a gentle flush on the cheeks, nose and ears
            r_ = lum / np.median(lum[mask]); lum = np.median(lum[mask]) * (gaussian_filter(r_, 3.0) * .82 + r_ * .18)
            P = np.asarray(maps['P'], np.float32); P = np.stack([np.asarray(Image.fromarray(P[..., i]).resize((S, S), Image.BILINEAR)) for i in range(3)], -1)
            x, y, z = np.abs(P[..., 0]), P[..., 1], P[..., 2]
            g2 = lambda cx, cy, sx, sy, zmin: np.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2)) * (z > zmin)
            blush = np.maximum.reduce([g2(.42, 7.0, .17, .16, .3) * .55, g2(0, 6.97, .09, .09, .7) * .4, g2(.76, 7.12, .08, .2, -1) * .45])
            flush = np.clip(flush * .6 + blush, 0, 1)
            r = lum / np.median(lum[mask])
        rgb = np.stack([np.clip(r / 2, 0, 1), flush, np.zeros_like(r)], -1)
        I = Image.fromarray((rgb * 255).astype(np.uint8))
        save_webp(I, f'{out}/tex/skin_{g}.webp', 88)
        save_webp(I.resize((1024, 1024), Image.LANCZOS), f'{out}/tex/skin_{g}.m.webp', 82)
        Lh = lum / np.maximum(gaussian_filter(lum, 10), 1e-3) - 1
        N = Image.fromarray(detail_normal(gaussian_filter(Lh, .6) * 3.2, 1.0)) if os.environ.get('APPEAL') != '1' else Image.fromarray(detail_normal(gaussian_filter(Lh, 1.8) * 1.0, 1.0))
        save_webp(N, f'{out}/tex/skin_{g}_n.webp', 74)
        save_webp(N.resize((1024, 1024), Image.LANCZOS), f'{out}/tex/skin_{g}_n.m.webp', 70)
    # eyes: R sclera/fibre brightness, G iris mask, B pupil
    src = np.asarray(Image.open(f'{mh.SYS}/eyes/materials/brown_eye.png').convert('RGB'), np.float32) / 255
    L = src @ np.array([0.3, 0.59, 0.11], np.float32)
    H = L.shape[0]
    yy, xx = np.mgrid[0:H, 0:H] / H
    iris = np.zeros((H, H), np.float32); pupil = np.zeros((H, H), np.float32)
    # de-creep: a larger iris leaves less white round it (white all round the iris reads as a stare)
    ri, rp = (.146, .047) if os.environ.get('APPEAL') == '1' else (.122, .04)
    for cx, cy in ((.705, .297), (.29, .71)):
        d = np.hypot(xx - cx, yy - cy)
        iris = np.maximum(iris, np.clip((ri - d) / .012, 0, 1))
        pupil = np.maximum(pupil, np.clip((rp - d) / .01, 0, 1))
    Li = L
    if ri != .122:  # the source iris, scaled out to the larger one (its fibres, not the white, fill the new ring)
        from scipy.ndimage import map_coordinates
        sy, sx = yy.copy(), xx.copy()
        for cx, cy in ((.705, .297), (.29, .71)):
            m = np.hypot(xx - cx, yy - cy) < ri + .015
            sx[m] = cx + (xx[m] - cx) * .122 / ri; sy[m] = cy + (yy[m] - cy) * .122 / ri
        Li = map_coordinates(L, [sy * H, sx * H], order=1, mode='nearest').astype(np.float32)
    fib = Li / max(float(np.median(Li[iris > .9])), .02) * .5
    R = L * (1 - iris) + np.clip(fib, 0, 1) * iris
    I = Image.fromarray((np.clip(np.stack([R, iris, pupil], -1), 0, 1) * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS)
    save_webp(I, f'{out}/tex/eye.webp', 90)
    # lashes left, brows right, in alpha
    for b in sorted(set(c.get('brow', 'eyebrow001') for c in CHARS.values())):
        A = Image.new('L', (1024, 512), 0)
        for f, x in ((f'{mh.SYS}/eyelashes/eyelashes01/eyelashes01.png', 0), (f'{mh.SYS}/eyebrows/{b}/{b}.png', 512)):
            A.paste(Image.open(f).convert('RGBA').split()[3].resize((512, 512), Image.LANCZOS), (x, 0))
        Image.merge('RGB', (A, A, A)).save(f"{out}/tex/{'lash' if b == 'eyebrow001' else 'lash_' + b}.webp", 'WEBP', quality=86, method=6)
    Image.open(f'{mh.SYS}/teeth/teeth_base/teeth.png').convert('RGB').resize((512, 512), Image.LANCZOS).save(f'{out}/tex/teeth.webp', 'WEBP', quality=80, method=6)


def head_profile(V, T, head_pivot):
    """Radius of the skull around its centre by direction, for fitting hair. Head-bone space."""
    u = np.unique(T)
    Pv = V[u]
    # skull centre: above the ears, slightly behind the brow
    top = Pv[:, 1].max()
    c = np.array([0.0, top - 0.105 * (top - head_pivot[1]) / 0.13, Pv[:, 2].min() + 0.5 * (Pv[:, 2].max() - Pv[:, 2].min()) - 0.012])
    d = Pv - c
    r = np.linalg.norm(d, axis=1)
    az = np.arctan2(d[:, 0], d[:, 2])
    el = np.arcsin(np.clip(d[:, 1] / np.maximum(r, 1e-6), -1, 1))
    NA, NE = 24, 12
    grid = np.zeros((NE, NA))
    ia = ((az + np.pi) / (2 * np.pi) * NA).astype(int) % NA
    ie = np.clip(((el + np.pi / 2) / np.pi * NE).astype(int), 0, NE - 1)
    np.maximum.at(grid, (ie, ia), r)
    for i in range(NE):
        row = grid[i]
        if (row > 0).any():
            idx = np.nonzero(row)[0]
            grid[i] = np.interp(np.arange(NA), idx, row[idx], period=NA)
    grid = gaussian_filter(grid, (0.6, 0.8), mode=('nearest', 'wrap'))
    return {'skull': {'c': [round(float(x - y), 4) for x, y in zip(c, head_pivot)], 'r': [[round(float(x), 4) for x in row] for row in grid]}}
