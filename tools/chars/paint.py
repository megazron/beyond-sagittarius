"""Texture work: photo skin recoloured per species, marks painted through a uv->3D position map,
cloth atlases, irises. Everything is resumable: outputs are simply overwritten."""
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import gaussian_filter, binary_dilation, distance_transform_edt
from scipy.spatial import cKDTree
import mh

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
        L = a @ np.array([0.3, 0.59, 0.11], np.float32)
        if p.tint is not None:
            if p.opt.get('flat'):
                # logos and emblems out: keep only fine weave and folds
                L = L - gaussian_filter(L, 12) + 0.6
            # reference brightness from texels the garment really uses, not the empty background
            uvs = np.clip(np.mod(p.UV[np.unique(p.TU)], 1.0), 0, 0.999)
            ref = float(L[(uvs[:, 1] * h).astype(int), (uvs[:, 0] * w).astype(int)].mean())
            Ln = np.clip(1 + (L - ref) / max(ref, 0.12) * 0.6, 0.45, 1.35)
            Ln = 1 + (Ln - 1) * p.opt.get('contrast', 1.0)
            c = np.array(p.tint, np.float32) / 255
            a = np.clip(Ln[..., None] * c, 0, 1)
        A.paste(Image.fromarray((a * 255).astype(np.uint8)), (int(r[0] * size), int(r[1] * size)))
        nt = mat.get('normalmapTexture')
        if nt and os.path.exists(nt):
            Nn.paste(Image.open(nt).convert('RGB').resize((w, h), Image.LANCZOS), (int(r[0] * size), int(r[1] * size)))
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


SKIN_SRC = {'m': 'young_caucasian_male', 'f': 'young_caucasian_female'}


def mark_map(cid, cfg, base, rig, out):
    """Per-character paint: R glow, G dark marks, B overlay (scar, tape, smudge)."""
    maps = position_maps(base, rig)
    key = cfg['look']['marks']
    em, dark, over = marks(key, maps, cid)
    b = np.zeros_like(em)
    for m, _c in over:
        b = np.maximum(b, m.astype(np.float32))
    rgb = (np.clip(np.stack([em, dark, b], -1), 0, 1) * 255).astype(np.uint8)
    save_webp(Image.fromarray(rgb), f'{out}/tex/{cid}_marks.webp', 85)


def shared_maps(base, rig, out):
    """Species-neutral skin (R brightness ratio, G flush) and shared eye and lash maps.
    Colours are applied in the shader, so any skin the player picks keeps the photo detail."""
    maps = position_maps(base, rig)
    for g, src in SKIN_SRC.items():
        if os.path.exists(f'{out}/tex/skin_{g}.webp'):
            continue
        d = f'{mh.SYS}/skins/{src}'
        tex = [f for f in os.listdir(d) if f.endswith('diffuse.png')][0]
        a = srgb2lin(np.asarray(Image.open(f'{d}/{tex}').convert('RGB'), np.float32) / 255)
        S = a.shape[0]
        lum = a @ np.array([0.3, 0.6, 0.1], np.float32)
        mask = np.asarray(Image.fromarray(maps['M']).resize((S, S)))
        r = lum / np.median(lum[mask])
        red = (a[..., 0] - a[..., 2]) / np.maximum(lum, 1e-3)
        flush = np.clip((red - np.median(red[mask])) * 1.6, 0, 1)
        rgb = np.stack([np.clip(r / 2, 0, 1), flush, np.zeros_like(r)], -1)
        I = Image.fromarray((rgb * 255).astype(np.uint8))
        save_webp(I, f'{out}/tex/skin_{g}.webp', 88)
        save_webp(I.resize((1024, 1024), Image.LANCZOS), f'{out}/tex/skin_{g}.m.webp', 82)
        Lh = lum / np.maximum(gaussian_filter(lum, 10), 1e-3) - 1
        N = Image.fromarray(detail_normal(gaussian_filter(Lh, .6) * 3.2, 1.0))
        save_webp(N, f'{out}/tex/skin_{g}_n.webp', 74)
        save_webp(N.resize((1024, 1024), Image.LANCZOS), f'{out}/tex/skin_{g}_n.m.webp', 70)
    # eyes: R sclera/fibre brightness, G iris mask, B pupil
    src = np.asarray(Image.open(f'{mh.SYS}/eyes/materials/brown_eye.png').convert('RGB'), np.float32) / 255
    L = src @ np.array([0.3, 0.59, 0.11], np.float32)
    H = L.shape[0]
    yy, xx = np.mgrid[0:H, 0:H] / H
    iris = np.zeros((H, H), np.float32); pupil = np.zeros((H, H), np.float32)
    for cx, cy in ((.705, .297), (.29, .71)):
        d = np.hypot(xx - cx, yy - cy)
        iris = np.maximum(iris, np.clip((.122 - d) / .012, 0, 1))
        pupil = np.maximum(pupil, np.clip((.04 - d) / .01, 0, 1))
    fib = L / max(float(np.median(L[iris > .9])), .02) * .5
    R = L * (1 - iris) + np.clip(fib, 0, 1) * iris
    I = Image.fromarray((np.clip(np.stack([R, iris, pupil], -1), 0, 1) * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS)
    save_webp(I, f'{out}/tex/eye.webp', 90)
    # lashes left, brows right, in alpha
    A = Image.new('L', (1024, 512), 0)
    for f, x in ((f'{mh.SYS}/eyelashes/eyelashes01/eyelashes01.png', 0), (f'{mh.SYS}/eyebrows/eyebrow001/eyebrow001.png', 512)):
        A.paste(Image.open(f).convert('RGBA').split()[3], (x, 0))
    Image.merge('RGB', (A, A, A)).save(f'{out}/tex/lash.webp', 'WEBP', quality=86, method=6)
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
