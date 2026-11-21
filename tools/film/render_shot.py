"""Rebuilds dumped frames in Cycles and renders them.

  LD_LIBRARY_PATH=/usr/lib/wsl/lib blender -b -noaudio -P tools/film/render_shot.py -- \
      --dump ~/bs-film/dump --first 192 --last 240 --out ~/bs-film/render/s03 [--samples 48] [--w 1280]

Frames already rendered are skipped, so a crash loses one frame."""
import argparse, base64, glob, json, math, os, struct, sys
import numpy as np
import bpy
from mathutils import Matrix, Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import face as FACE

ap = argparse.ArgumentParser()
for n, d in (('--dump', None), ('--out', None), ('--plate', ''), ('--tex', '~/bs-film/tex'), ('--perf', ''), ('--facedir', '~/bs-film/face'), ('--hole', ''), ('--closeup', ''), ('--focus-id', ''), ('--key', '')):
    ap.add_argument(n, default=d)
for n, d in (('--first', 0), ('--last', 0), ('--samples', 48), ('--w', 1280), ('--step', 1), ('--exposure', 0)):
    ap.add_argument(n, type=float if n == '--exposure' else int, default=d)
ap.add_argument('--cpu', action='store_true'); ap.add_argument('--fstop', type=float, default=0)
a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
DUMP, OUT, TEXD = (os.path.expanduser(x) for x in (a.dump, a.out, a.tex))
os.makedirs(OUT, exist_ok=True); CACHE = f'{OUT}/.pc2'; os.makedirs(CACHE, exist_ok=True)
PUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'models', 'crew', 'tex')
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # three's y-up to Blender's z-up

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; cy = sc.cycles
if not a.cpu:
    pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = os.environ.get('CYCLES_DEVICE', 'CUDA'); pr.get_devices()
    for d in pr.devices: d.use = d.type != 'CPU'
    cy.device = 'GPU'
cy.samples = a.samples; cy.use_denoising = True; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.03
cy.use_camera_cull = True; cy.camera_cull_margin = .25; cy.max_bounces = 4; cy.use_auto_tile = False; cy.debug_use_spatial_splits = False; cy.transparent_max_bounces = 12; cy.caustics_reflective = False; cy.caustics_refractive = False
sc.render.resolution_x, sc.render.resolution_y = a.w, a.w * 9 // 16
sc.render.fps = 24; sc.render.use_motion_blur = True; sc.render.motion_blur_shutter = 0.5
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'; sc.view_settings.exposure = a.exposure
sc.render.image_settings.file_format = 'PNG'; sc.render.use_persistent_data = True


def hexc(h):
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    return tuple((x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4) for x in c) + (1,)


def b64f(s, t='<f4'): return np.frombuffer(base64.b64decode(s), t)


def image(path, data=False):
    im = bpy.data.images.load(path, check_existing=True)
    if data: im.colorspace_settings.name = 'Non-Color'
    return im


def material(d):
    f = d.get('film') or {}
    m = bpy.data.materials.new(d.get('name') or f.get('kind', 'mat')); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; N, L = nt.nodes, nt.links
    I = b.inputs
    def tex(path, data=False):
        t = N.new('ShaderNodeTexImage'); t.image = image(path, data); return t
    def normal(path, k):
        t = tex(path, True); nm = N.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = k; L.new(t.outputs[0], nm.inputs['Color']); L.new(nm.outputs[0], I['Normal'])
    kind = f.get('kind')
    if kind == 'pbr':
        # a CC0 set from tools/fetch_assets.py, tiled and tinted
        tc = N.new('ShaderNodeTexCoord'); mp = N.new('ShaderNodeMapping'); r = f.get('repeat', 4); mp.inputs['Scale'].default_value = (r, r, r); L.new(tc.outputs['UV'], mp.inputs['Vector'])
        d_ = tex(f"{PUB}/../../../textures/{f['set']}/diff_1k.webp"); L.new(mp.outputs[0], d_.inputs['Vector'])
        mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1; L.new(d_.outputs[0], mx.inputs['A']); mx.inputs['B'].default_value = hexc(f.get('tint', 0xffffff)); L.new(mx.outputs['Result'], I['Base Color'])
        n_ = tex(f"{PUB}/../../../textures/{f['set']}/nor_1k.webp", True); L.new(mp.outputs[0], n_.inputs['Vector']); nm = N.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 1.2; L.new(n_.outputs[0], nm.inputs['Color']); L.new(nm.outputs[0], I['Normal'])
        I['Metallic'].default_value = d.get('metalness', .6); I['Roughness'].default_value = max(.25, d.get('roughness', .45))
    elif kind == 'skin':
        key = f"{f['marks']}_{f['sex']}_{f['skin']:06x}"
        t = tex(f'{TEXD}/{key}.png'); L.new(t.outputs[0], I['Base Color']); I['Subsurface Radius'].default_value = (1.0, .36, .2)  # flesh scatters red furthest
        I['Subsurface Weight'].default_value = .6; I['Subsurface Scale'].default_value = .009; I['Roughness'].default_value = .42; I['Specular IOR Level'].default_value = .5
        I['Coat Weight'].default_value = .08; I['Coat Roughness'].default_value = .45
        normal(f"{PUB}/skin_{f['sex']}_n.webp", .6)
        if f.get('glowK', 0) > 0:
            g = tex(f'{TEXD}/{key}_glow.png', True); L.new(g.outputs[0], I['Emission Strength']); I['Emission Color'].default_value = hexc(f['glow'])
    elif kind == 'cloth':
        L.new(tex(f"{PUB}/{f['atlas']}_cloth.webp").outputs[0], I['Base Color']); normal(f"{PUB}/{f['atlas']}_cloth_n.webp", .9)
        I['Roughness'].default_value = .78; I['Sheen Weight'].default_value = .5
        if f.get('velvet'):  # deep pile: a bright cool sheen at grazing angles, matte face-on
            I['Roughness'].default_value = .9; I['Sheen Weight'].default_value = 1.0; I['Sheen Roughness'].default_value = .32; I['Sheen Tint'].default_value = (.62, .68, 1.0, 1)
    elif kind == 'hair':
        at = N.new('ShaderNodeAttribute'); at.attribute_name = 'aT'
        ramp = N.new('ShaderNodeValToRGB'); e = ramp.color_ramp.elements; e[0].color = hexc(f['root']); e[1].color = hexc(f['tip']); e.new(.3).color = hexc(f['mid'])
        L.new(at.outputs['Fac'], ramp.inputs[0]); L.new(ramp.outputs[0], I['Base Color']); I['Roughness'].default_value = .3; I['Coat Weight'].default_value = .35; I['Coat Roughness'].default_value = .2; I['Sheen Weight'].default_value = .5; I['Sheen Roughness'].default_value = .35
    elif kind == 'eye':
        # as the game's eye (assets.ts eyeMaterial): a pale iris reads as a blank, dead eye, so each is deepened and
        # saturated towards its own hue, and the white is a warm, slightly darker white
        ir = hexc(f['iris'])[:3]; lum = .3 * ir[0] + .6 * ir[1] + .1 * ir[2]
        deep = tuple(max(0.0, lum + (c - lum) * 1.7) * (.5 / max(lum, .25)) * .75 for c in ir) + (1,)
        I['Base Color'].default_value = deep; I['Roughness'].default_value = .08; I['Coat Weight'].default_value = 1
        t = tex(f'{PUB}/eye.webp', True); sp = N.new('ShaderNodeSeparateColor'); L.new(t.outputs[0], sp.inputs[0])
        mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.inputs['A'].default_value = (.62, .58, .55, 1); mx.inputs['B'].default_value = deep
        L.new(sp.outputs[1], mx.inputs['Factor']); dk = N.new('ShaderNodeMix'); dk.data_type = 'RGBA'; dk.inputs['B'].default_value = (.002, .002, .002, 1)
        L.new(mx.outputs['Result'], dk.inputs['A']); L.new(sp.outputs[2], dk.inputs['Factor']); L.new(dk.outputs['Result'], I['Base Color'])
    elif kind in ('lash', 'fur'):
        file = f"{f.get('map', 'lash')}.webp" if kind == 'lash' else f"{f['key']}_fur.webp"
        t = tex(f'{PUB}/{file}', True); sp = N.new('ShaderNodeSeparateColor'); L.new(t.outputs[0], sp.inputs[0])
        I['Base Color'].default_value = hexc(f.get('brow', f.get('root', 0))); I['Roughness'].default_value = .5
        if kind == 'fur':
            at = N.new('ShaderNodeAttribute'); at.attribute_name = 'aLayer'; gt = N.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'
            mu = N.new('ShaderNodeMath'); mu.operation = 'MULTIPLY_ADD'; mu.inputs[1].default_value = .9; mu.inputs[2].default_value = .06
            L.new(at.outputs['Fac'], mu.inputs[0]); L.new(sp.outputs[0], gt.inputs[0]); L.new(gt.outputs[0], I['Alpha'])
            # fewer strands where the hair thins (aDens, as in the game): the edge frays instead of ending on a triangle
            dn = N.new('ShaderNodeAttribute'); dn.attribute_name = 'aDens'; ss = N.new('ShaderNodeMapRange'); ss.interpolation_type = 'SMOOTHSTEP'
            ss.inputs['From Min'].default_value = .05; ss.inputs['From Max'].default_value = .6; ss.inputs['To Min'].default_value = .95; ss.inputs['To Max'].default_value = 0
            L.new(dn.outputs['Fac'], ss.inputs['Value']); ad = N.new('ShaderNodeMath'); ad.operation = 'ADD'
            L.new(mu.outputs[0], ad.inputs[0]); L.new(ss.outputs['Result'], ad.inputs[1]); L.new(ad.outputs[0], gt.inputs[1])
        else:
            L.new(sp.outputs[0], I['Alpha'])
    elif d.get('uColor') is not None or d['type'] == 'ShaderMaterial':
        I['Base Color'].default_value = (0, 0, 0, 1); I['Emission Color'].default_value = hexc(d.get('uColor', 0xffffff)); I['Emission Strength'].default_value = 8
    else:
        I['Base Color'].default_value = hexc(d.get('color', 0xffffff)); I['Roughness'].default_value = d.get('roughness', .5); I['Metallic'].default_value = d.get('metalness', 0)
        if d.get('emissive'): I['Emission Color'].default_value = hexc(d['emissive']); I['Emission Strength'].default_value = d.get('emissiveIntensity', 1) * 3
        if d.get('transparent'): I['Alpha'].default_value = d.get('opacity', 1)
    return m


def weld_map(P):
    """Vertices at the same rest position (uv seams, the game's split normals) as one: (map old -> new, first old of
    each new). Done once on the rest mesh, so the topology is the same in every frame and every motion step (a WELD
    modifier merged by distance per frame, and a merge that changed between steps smeared the cloth across a frame)."""
    key = np.round(P / 2e-5).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return inv.ravel(), first


def vcol_material(info):
    """A merged kit (the mouth, teeth, props, the stock): colour, roughness/metalness and glow are per vertex. Without
    this every piece rendered white, the dark inside of the mouth too, and it read as a grin."""
    m = bpy.data.materials.new('kit_vcol'); m.use_nodes = True; nt = m.node_tree; N, L = nt.nodes, nt.links; I = nt.nodes['Principled BSDF'].inputs
    c = N.new('ShaderNodeAttribute'); c.attribute_name = 'vcolor'; L.new(c.outputs['Vector'], I['Base Color'])
    if info['geo'].get('aPbr'):
        p = N.new('ShaderNodeAttribute'); p.attribute_name = 'vaPbr'; sp = N.new('ShaderNodeSeparateXYZ'); L.new(p.outputs['Vector'], sp.inputs[0])
        L.new(sp.outputs['X'], I['Roughness']); L.new(sp.outputs['Y'], I['Metallic'])
    if info['geo'].get('aGlow'):
        gl = N.new('ShaderNodeAttribute'); gl.attribute_name = 'vaGlow'; L.new(gl.outputs['Vector'], I['Emission Color']); I['Emission Strength'].default_value = 3
    return m


def mesh_of(info, weld=False):
    g = info['geo']; P = b64f(g['pos']).reshape(-1, 3)
    idx = b64f(g['idx'], '<u4') if g.get('idx') else np.arange(len(P), dtype=np.uint32)
    me = bpy.data.meshes.new(info.get('name') or 'm')
    tri = idx.reshape(-1, 3); keep = np.arange(len(tri)); rep = None
    if weld:
        wm, rep = weld_map(P); t2 = wm[tri]
        keep = np.where((t2[:, 0] != t2[:, 1]) & (t2[:, 1] != t2[:, 2]) & (t2[:, 0] != t2[:, 2]))[0]
        me.from_pydata(P[rep].tolist(), [], t2[keep].tolist())
    else:
        me.from_pydata(P.tolist(), [], tri.tolist())
    me['rep'] = [] if rep is None else rep.tolist()
    if g.get('uv'):
        uv = b64f(g['uv']).reshape(-1, 2).copy(); uv[:, 1] = 1 - uv[:, 1]
        l = me.uv_layers.new(name='UVMap'); l.data.foreach_set('uv', uv[tri[keep].ravel()].ravel())
    for k in ('color', 'aPbr', 'aGlow'):
        if g.get(k):
            v = b64f(g[k]).reshape(-1, 3); v = v[rep] if rep is not None else v
            at = me.attributes.new('v' + k, 'FLOAT_VECTOR', 'POINT'); at.data.foreach_set('vector', v.ravel())
    for k in ('aT', 'aLayer', 'aDens'):
        if g.get(k):
            v = b64f(g[k]); v = v[rep] if rep is not None else v
            at = me.attributes.new(k, 'FLOAT', 'POINT'); at.data.foreach_set('value', v)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons)); me.update()
    return me


PERF = json.load(open(os.path.expanduser(a.perf))) if a.perf else {}   # {crew id: [cues]}, times in seconds
FD = {}
def face_of(key):
    if key not in FD:
        p = f'{os.path.expanduser(a.facedir)}/{key}.npz'
        z = np.load(p) if os.path.exists(p) else None
        FD[key] = (list(z['names']), z['delta'].astype(np.float32), z['bind']) if z is not None else None
    return FD[key]
ID_OF = {}
def who_of(info):
    f = info['material'].get('film') or {}
    if f.get('kind') != 'skin' or info.get('name') != 'skin_head': return None
    return f.get('marks')


def hair_material(f):
    """Strands: Cycles' hair BSDF (Chiang), coloured root to tip by the game's own ramp, each strand a little different."""
    m = bpy.data.materials.new('strands'); m.use_nodes = True; nt = m.node_tree; N, L = nt.nodes, nt.links
    for x in list(N):
        if x.type != 'OUTPUT_MATERIAL': N.remove(x)
    h = N.new('ShaderNodeBsdfHairPrincipled'); h.model = 'CHIANG'; h.parametrization = 'COLOR'
    at = N.new('ShaderNodeAttribute'); at.attribute_name = 'aT'
    ramp = N.new('ShaderNodeValToRGB'); e = ramp.color_ramp.elements; e[0].color = hexc(f['root']); e[1].color = hexc(f['tip']); e.new(.3).color = hexc(f['mid'])
    L.new(at.outputs['Fac'], ramp.inputs[0])
    rn = N.new('ShaderNodeAttribute'); rn.attribute_name = 'rnd'
    mul = N.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
    jit = N.new('ShaderNodeMapRange'); jit.inputs['To Min'].default_value = .72; jit.inputs['To Max'].default_value = 1.12
    L.new(rn.outputs['Fac'], jit.inputs['Value']); L.new(ramp.outputs[0], mul.inputs['A']); L.new(jit.outputs['Result'], mul.inputs['B'])
    L.new(mul.outputs['Result'], h.inputs['Color'])
    h.inputs['Roughness'].default_value = .4; h.inputs['Radial Roughness'].default_value = .45; h.inputs['Coat'].default_value = .08
    L.new(h.outputs[0], N['Material Output'].inputs['Surface'])
    return m


def strands(src, info, n=int(os.environ.get('STRANDS', 45000)), seed=7):
    """Hair as strands over the game's hair mesh (its clumps): roots spread over the surface, each strand walking up
    the clump's root-to-tip gradient (the mesh's aT) and kept on the surface, a little above it for volume. The clump
    mesh stays under them, darker, as the shadowed depth between strands. Parented to the mesh: it moves with it."""
    from mathutils.bvhtree import BVHTree
    g = info['geo']; P = b64f(g['pos']).reshape(-1, 3).astype(np.float64); T = b64f(g['aT']).astype(np.float64)
    tri = (b64f(g['idx'], '<u4') if g.get('idx') else np.arange(len(P), dtype=np.uint32)).reshape(-1, 3).astype(np.int64)
    A, B, Cc = P[tri[:, 0]], P[tri[:, 1]], P[tri[:, 2]]; e1, e2 = B - A, Cc - A; nr = np.cross(e1, e2); ar = np.linalg.norm(nr, axis=1)
    ok = ar > 1e-12; nn = np.zeros_like(nr); nn[ok] = nr[ok] / ar[ok, None]
    # the gradient of aT in each triangle's plane: G.e1 = dT1, G.e2 = dT2, G.n = 0
    M = np.stack([e1, e2, nn], 1); M[~ok] = np.eye(3); rhs = np.stack([T[tri[:, 1]] - T[tri[:, 0]], T[tri[:, 2]] - T[tri[:, 0]], np.zeros(len(tri))], 1)
    G = np.linalg.solve(M, rhs[..., None])[..., 0]; gl = np.linalg.norm(G, axis=1); good = ok & (gl > 1e-3)
    G[good] /= gl[good, None]; G[~good] = 0
    bvh = BVHTree.FromPolygons([tuple(x) for x in P.tolist()], tri.tolist(), all_triangles=True)
    rng = np.random.default_rng(seed); w = ar * good; w /= w.sum()
    ti = rng.choice(len(tri), n, p=w); u, v = rng.random(n), rng.random(n); fl = u + v > 1; u[fl], v[fl] = 1 - u[fl], 1 - v[fl]
    roots = A[ti] + e1[ti] * u[:, None] + e2[ti] * v[:, None]
    lift = rng.random(n) ** 1.6 * .0035; step = .0035; curves = []; tees = []
    for i in range(n):
        p = roots[i]; t = ti[i]; pts = []; ts = []
        for _ in range(60):
            q = p + nn[t] * lift[i]; pts.append(q); ts.append(T[tri[t]].mean())
            if not good[t] or ts[-1] > .985: break
            loc, nrm, j, _d = bvh.find_nearest(tuple(p + G[t] * step))
            if j is None: break
            p = np.array(loc); t = j
        if len(pts) >= 3:
            # a few strands run on past the clump's tip and stray: the edge of real hair is never a clean point
            if rng.random() < .025:
                d = pts[-1] - pts[-2]; d = d / max(np.linalg.norm(d), 1e-9); d = d + rng.normal(0, .12, 3)
                for k in range(1, 3): pts.append(pts[-1] + d * step); ts.append(ts[-1])
            # at most 14 points a strand (the curve is smooth between them): the strand count, not the points, is the look
            pa = np.array(pts); ta = np.array(ts)
            if len(pa) > 14:
                sel = np.unique(np.round(np.linspace(0, len(pa) - 1, 14)).astype(int)); pa, ta = pa[sel], ta[sel]
            curves.append(pa); tees.append(ta)
    cv = bpy.data.hair_curves.new('strands'); cv.add_curves([len(c) for c in curves])
    allp = np.concatenate(curves).astype(np.float32); cv.position_data.foreach_set('vector', allp.ravel())
    rad = np.concatenate([np.linspace(1, .25, len(c)) for c in curves]).astype(np.float32) * 9e-5
    ra = cv.attributes.get('radius') or cv.attributes.new('radius', 'FLOAT', 'POINT'); ra.data.foreach_set('value', rad)
    tt = cv.attributes.new('aT', 'FLOAT', 'POINT'); tt.data.foreach_set('value', np.concatenate(tees).astype(np.float32))
    rr = cv.attributes.new('rnd', 'FLOAT', 'CURVE'); rr.data.foreach_set('value', rng.random(len(curves)).astype(np.float32))
    cv.materials.append(hair_material(info['material']['film']))
    o = bpy.data.objects.new('strands', cv); sc.collection.objects.link(o); o.parent = src
    print('strands:', len(curves), 'curves,', len(allp), 'points', flush=True)
    return o


frames = list(range(a.first, a.last + 1))
data = {}
for f in frames:
    p = f'{DUMP}/frames/{f:05d}.json'
    if os.path.exists(p): data[f] = json.load(open(p))
ids = {}
for f, d in data.items():
    for r in d['meshes']:
        if not r.get('points'): ids.setdefault(r['id'], []).append(f)
print(len(data), 'frames,', len(ids), 'objects', flush=True)
FOCUS_C = None
if a.focus_id:
    for f in sorted(data):
        r = next((x for x in data[f]['meshes'] if x['id'] == a.focus_id and 'baked' in x), None)
        if r: FOCUS_C = b64f(r['baked']).reshape(-1, 3).mean(0); break
objs = {}
for k, fs in ids.items():
    info = json.load(open(f'{DUMP}/fresh/{k}.json')); mat = info['material']
    if info['geo']['n'] < 3 or (mat['type'] == 'ShaderMaterial' and mat.get('uColor') is None): continue
    if info['instanced']: pass
    WELD = info.get('name') == 'cloth' and not os.environ.get('NO_CLOTH_SUB')
    me = mesh_of(info, weld=WELD); me.materials.append(vcol_material(info) if info['geo'].get('color') else material(mat)); REP = np.array(me['rep'], np.int64) if WELD else None
    o = bpy.data.objects.new(info.get('name') or k[:8], me); sc.collection.objects.link(o); objs[k] = o
    o.cycles.use_camera_cull = True
    recs = {f: next(r for r in data[f]['meshes'] if r['id'] == k) for f in fs}
    baked = any('baked' in r for r in recs.values())
    if baked:
        n = len(me.vertices); path = f'{CACHE}/{k}.pc2'
        # vertices the game appended to a mesh (split normals, filled holes) have no morph data, so the dump reads
        # them as NaN: each takes its twin's position (same rest point). A NaN corner tore the collar into jags and,
        # with motion blur, smeared a whole garment across one frame
        P0 = b64f(info['geo']['pos']).reshape(-1, 3); wm0, first0 = weld_map(P0); twin = first0[wm0]
        def unnan(q):
            bad = ~np.isfinite(q).all(1)
            if bad.any():
                q = q.copy(); q[bad] = q[twin[bad]]; still = ~np.isfinite(q).all(1)
                if still.any(): q[still] = np.nanmean(q[~still], 0)
            return q
        with open(path, 'wb') as w:
            w.write(b'POINTCACHE2\0' + struct.pack('<iiffi', 1, n, float(frames[0]), 1.0, len(frames)))
            last = None
            for f in frames:
                r = recs.get(f)
                if r and 'baked' in r:
                    q = unnan(b64f(r['baked']).reshape(-1, 3))
                    wid = who_of(info)
                    fd = face_of(ID_OF.get(wid, wid)) if wid and PERF.get(wid) else None
                    if fd and len(fd[2]) == len(q):
                        pf = PERF[wid]
                        if pf.get('open'):
                            g = min(f + 1, len(pf['open']) - 1); lip = (pf['open'][g], pf['round'][g], pf['wide'][g]); env = lambda _t: pf['open'][g]
                        else:
                            lip = env = None  # a silent shot: no mouth track
                        q = FACE.apply(q.copy(), fd[2], fd[1], fd[0], FACE.track(fd[0], pf['cues'], f / 24, seed=len(wid), env=env, lip=lip, blinks=pf.get('blinks')))
                    if REP is not None: q = q[REP]
                    last = np.stack([q[:, 0], -q[:, 2], q[:, 1]], 1).astype('<f4')
                if last is None:
                    q = unnan(b64f(next(iter(x for x in recs.values() if 'baked' in x))['baked']).reshape(-1, 3))
                    if REP is not None: q = q[REP]
                    last = np.stack([q[:, 0], -q[:, 2], q[:, 1]], 1).astype('<f4')
                w.write(last.tobytes())
        if info.get('name') in ('skin_head', 'cloth'):
            pass
        mc = o.modifiers.new('film', 'MESH_CACHE'); mc.cache_format = 'PC2'; mc.filepath = path; mc.frame_start = frames[0]; mc.deform_mode = 'OVERWRITE'
        o.cycles.use_deform_motion = True
        if info.get('name') == 'skin_head' and not os.environ.get('NO_HEAD_SUB'):
            # the game head is thin for a close-up: one smooth level
            sb = o.modifiers.new('sub', 'SUBSURF'); sb.levels = 0; sb.render_levels = 1
            # but its open edge at the neck must stay on the body's line: a smoothed boundary pulls in between the
            # points and left a dotted row of gaps under the jaw. Creased boundary edges subdivide straight.
            if not os.environ.get('NO_NECK_CREASE'):
                cnt = {}
                for p in me.polygons:
                    for ek in p.edge_keys: cnt[ek] = cnt.get(ek, 0) + 1
                ca = me.attributes.get('crease_edge') or me.attributes.new('crease_edge', 'FLOAT', 'EDGE')
                # only the neck: eye and mouth openings keep their smooth rims
                ys = [v.co.y for v in me.vertices]; ycut = min(ys) + 0.3 * (max(ys) - min(ys))
                nb = 0
                for e in me.edges:
                    if cnt.get(tuple(sorted(e.vertices)), 0) == 1 and max(me.vertices[i].co.y for i in e.vertices) < ycut: ca.data[e.index].value = 1.0; nb += 1
                print('neck crease: boundary edges', nb, flush=True)
        elif info.get('name') == 'cloth' and not os.environ.get('NO_CLOTH_SUB'):
            # game cloth is low poly and reads as facets under practicals: one smooth level (the seams are welded in mesh_of)
            sb = o.modifiers.new('sub', 'SUBSURF'); sb.levels = 0; sb.render_levels = 1; sb.uv_smooth = 'PRESERVE_BOUNDARIES'
    else:
        for f, r in recs.items():
            o.matrix_world = C @ Matrix(np.array(r['m']).reshape(4, 4).T.tolist())
            o.keyframe_insert('location', frame=f); o.rotation_mode = 'QUATERNION'; o.keyframe_insert('rotation_quaternion', frame=f); o.keyframe_insert('scale', frame=f)
        fk = (mat.get('film') or {}).get('kind')
        if fk == 'hair' and FOCUS_C is not None and info['geo'].get('aT') and not os.environ.get('NO_STRANDS'):
            r0 = next(iter(recs.values())); M0 = np.array(r0['m']).reshape(4, 4).T; P0 = b64f(info['geo']['pos']).reshape(-1, 3)
            if np.linalg.norm((P0 @ M0[:3, :3].T + M0[:3, 3]).mean(0) - FOCUS_C) < .35:
                # the close-up's own hair: strands over the clumps, the clump mesh darker and matte under them
                strands(o, info)
                bs_ = me.materials[0].node_tree.nodes['Principled BSDF'].inputs
                bs_['Coat Weight'].default_value = 0; bs_['Roughness'].default_value = .6; bs_['Sheen Weight'].default_value = .2
                rm = me.materials[0].node_tree.nodes.get('Color Ramp')
                if rm:
                    for el in rm.color_ramp.elements: el.color = tuple(c * .45 for c in el.color[:3]) + (1,)
    for f in frames:
        o.hide_render = f not in recs; o.keyframe_insert('hide_render', frame=f)
    if 'inst' in next(iter(recs.values())): print('instanced kept single:', o.name, flush=True)

# camera and lens
cd = bpy.data.cameras.new('c'); cd.sensor_fit = 'VERTICAL'; cd.sensor_height = 24; cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam
cd.dof.use_dof = True; cam.rotation_mode = 'QUATERNION'; FOC = {}
for f, d in data.items():
    c = d['camera']; cam.matrix_world = C @ Matrix(np.array(c['m']).reshape(4, 4).T.tolist())
    cam.keyframe_insert('location', frame=f); cam.keyframe_insert('rotation_quaternion', frame=f)
    cd.lens = 12 / math.tan(math.radians(c['fov']) / 2); cd.keyframe_insert('lens', frame=f)
    cd.dof.focus_distance = max(c['focus'], .3) if c['focus'] else 40; cd.dof.keyframe_insert('focus_distance', frame=f)
    cd.dof.aperture_fstop = max(.8, min(16, .012 / max(c['aperture'], 1e-4) * 1.4)) if c['aperture'] else 22; cd.dof.keyframe_insert('aperture_fstop', frame=f)
    if a.focus_id:  # a close-up: focus on the face (the mean of the eye-height band of that head), a real lens's depth of field
        r = next((x for x in d['meshes'] if x['id'] == a.focus_id and 'baked' in x), None)
        if r:
            q = b64f(r['baked']).reshape(-1, 3); band = q[q[:, 1] > np.percentile(q[:, 1], 55)]; band = band[band[:, 1] < np.percentile(q[:, 1], 80)]
            cpos = np.array(c['m'][12:15]); cd.dof.focus_distance = float(np.linalg.norm(band.mean(0) - cpos)) - .06; cd.dof.keyframe_insert('focus_distance', frame=f)
        if a.fstop: cd.dof.aperture_fstop = a.fstop; cd.dof.keyframe_insert('aperture_fstop', frame=f)
    FOC[f] = cd.dof.focus_distance
    if a.closeup:  # QA: the same view direction, pulled in to 0.55 m from a point (three.js coords), sharp
        q = [float(x) for x in a.closeup.split(',')]; P = C @ Vector(q[:3]); fw = cam.matrix_world.to_quaternion() @ Vector((0, 0, -1))
        if len(q) == 6:  # an explicit view direction, three.js coords
            fw = (C @ Vector(q[3:])).normalized(); cam.rotation_quaternion = fw.to_track_quat('-Z', 'Y'); cam.keyframe_insert('rotation_quaternion', frame=f)
        cam.location = P - fw * .55; cam.keyframe_insert('location', frame=f); cd.lens = 12 / math.tan(math.radians(20)); cd.keyframe_insert('lens', frame=f)
        cd.dof.aperture_fstop = 22; cd.dof.keyframe_insert('aperture_fstop', frame=f)

# light: the game's own rig, in real watts, plus the black hole itself as the world
for i in range(8):
    ld = bpy.data.lights.new(f'l{i}', 'POINT'); ld.shadow_soft_size = .6; lo = bpy.data.objects.new(f'l{i}', ld); sc.collection.objects.link(lo)
    for f, d in data.items():
        L = [x for x in d['lights'] if x['type'] == 'PointLight' and x['i'] > 0]
        L.sort(key=lambda x: -x['i'])
        if i < len(L):
            x = L[i]; lo.location = C @ Vector(x['p']); ld.color = hexc(x['color'])[:3]; ld.energy = x['i'] * 34
        else:
            ld.energy = 0
        lo.keyframe_insert('location', frame=f); ld.keyframe_insert('energy', frame=f); ld.keyframe_insert('color', frame=f)
if a.key:  # a soft portrait key 'side,up,watts' in camera space (side +1 = camera right), plus a dim cool rim behind the subject
    sd, up, wt, *kc = (float(x) for x in a.key.split(','))
    kd = bpy.data.lights.new('key', 'AREA'); kd.shape = 'DISK'; kd.size = .6; kd.energy = wt; kd.color = tuple(kc) if len(kc) == 3 else (1, 1, 1); ko = bpy.data.objects.new('key', kd); sc.collection.objects.link(ko)
    rd = bpy.data.lights.new('rim', 'AREA'); rd.size = .4; rd.energy = wt * .5; rd.color = (.75, .85, 1); ro = bpy.data.objects.new('rim', rd); sc.collection.objects.link(ro)
    for f, d in data.items():
        M = C @ Matrix(np.array(d['camera']['m']).reshape(4, 4).T.tolist()); fw = M.to_quaternion() @ Vector((0, 0, -1)); rt = M.to_quaternion() @ Vector((1, 0, 0)); upv = M.to_quaternion() @ Vector((0, 1, 0))
        dist = FOC.get(f, 1.5) if a.focus_id else 1.5
        tgt = M.translation + fw * dist
        ko.location = M.translation + rt * sd + upv * up + fw * (dist * .25); ko.rotation_mode = 'QUATERNION'; ko.rotation_quaternion = (tgt - ko.location).to_track_quat('-Z', 'Y')
        ro.location = tgt + fw * .9 - rt * sd * .6 + upv * .5; ro.rotation_mode = 'QUATERNION'; ro.rotation_quaternion = (tgt - ro.location).to_track_quat('-Z', 'Y')
        for o in (ko, ro): o.keyframe_insert('location', frame=f); o.keyframe_insert('rotation_quaternion', frame=f)
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; nt = w.node_tree
# the rotation is keyed, so Cycles rebuilds this map every frame: at 8K that was most of a frame's time
w.cycles.sampling_method = 'MANUAL'; w.cycles.sample_map_resolution = 512
bg = nt.nodes['Background']; bg.inputs[1].default_value = 1
if a.plate:
    e = nt.nodes.new('ShaderNodeTexEnvironment'); e.interpolation = 'Cubic'; e.image = image(os.path.expanduser(a.plate)); mp = nt.nodes.new('ShaderNodeMapping'); tc = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector']); nt.links.new(mp.outputs[0], e.inputs['Vector']); nt.links.new(e.outputs[0], bg.inputs[0])
    # the plate's centre is the hole, and Blender's equirect centre is +X: rotate the hole's direction onto it
    mp.vector_type = 'TEXTURE'
    fixed = [float(x) for x in a.hole.split(',')] if a.hole else None
    for f, d in data.items():
        hp = fixed or (d.get('hole') or {}).get('p')
        if hp:
            v = (C @ Vector(hp)).normalized()
            mp.inputs['Rotation'].default_value = (0, -math.asin(v.z), math.atan2(v.y, v.x))
            mp.inputs['Rotation'].keyframe_insert('default_value', frame=f)
else:
    bg.inputs[0].default_value = (.002, .002, .003, 1)

for f in range(frames[0], frames[-1] + 1, a.step):
    p = f'{OUT}/{f:05d}.png'
    if os.path.exists(p) or f not in data: continue
    sc.frame_set(f); sc.render.filepath = p; bpy.ops.render.render(write_still=True); print('rendered', f, flush=True)
