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
for n, d in (('--dump', None), ('--out', None), ('--plate', ''), ('--tex', '~/bs-film/tex'), ('--perf', ''), ('--facedir', '~/bs-film/face')):
    ap.add_argument(n, default=d)
for n, d in (('--first', 0), ('--last', 0), ('--samples', 48), ('--w', 1280), ('--step', 1), ('--exposure', 0)):
    ap.add_argument(n, type=float if n == '--exposure' else int, default=d)
ap.add_argument('--cpu', action='store_true')
a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
DUMP, OUT, TEXD = (os.path.expanduser(x) for x in (a.dump, a.out, a.tex))
os.makedirs(OUT, exist_ok=True); CACHE = f'{OUT}/.pc2'; os.makedirs(CACHE, exist_ok=True)
PUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'models', 'crew', 'tex')
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # three's y-up to Blender's z-up

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; cy = sc.cycles
if not a.cpu:
    pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = 'OPTIX'; pr.get_devices()
    for d in pr.devices: d.use = d.type != 'CPU'
    cy.device = 'GPU'
cy.samples = a.samples; cy.use_denoising = True; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.03
cy.max_bounces = 5; cy.transparent_max_bounces = 12; cy.caustics_reflective = False; cy.caustics_refractive = False
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
    if kind == 'skin':
        key = f"{f['marks']}_{f['sex']}_{f['skin']:06x}"
        t = tex(f'{TEXD}/{key}.png'); L.new(t.outputs[0], I['Base Color']); L.new(t.outputs[0], I['Subsurface Radius'])
        I['Subsurface Weight'].default_value = .55; I['Subsurface Scale'].default_value = .012; I['Roughness'].default_value = .46; I['Specular IOR Level'].default_value = .45
        normal(f"{PUB}/skin_{f['sex']}_n.webp", .6)
        if f.get('glowK', 0) > 0:
            g = tex(f'{TEXD}/{key}_glow.png', True); L.new(g.outputs[0], I['Emission Strength']); I['Emission Color'].default_value = hexc(f['glow'])
    elif kind == 'cloth':
        L.new(tex(f"{PUB}/{f['atlas']}_cloth.webp").outputs[0], I['Base Color']); normal(f"{PUB}/{f['atlas']}_cloth_n.webp", .9)
        I['Roughness'].default_value = .78; I['Sheen Weight'].default_value = .5
    elif kind == 'hair':
        at = N.new('ShaderNodeAttribute'); at.attribute_name = 'aT'
        ramp = N.new('ShaderNodeValToRGB'); e = ramp.color_ramp.elements; e[0].color = hexc(f['root']); e[1].color = hexc(f['tip']); e.new(.3).color = hexc(f['mid'])
        L.new(at.outputs['Fac'], ramp.inputs[0]); L.new(ramp.outputs[0], I['Base Color']); I['Roughness'].default_value = .36; I['Coat Weight'].default_value = .25
    elif kind == 'eye':
        I['Base Color'].default_value = hexc(f['iris']); I['Roughness'].default_value = .08; I['Coat Weight'].default_value = 1
        t = tex(f'{PUB}/eye.webp', True); sp = N.new('ShaderNodeSeparateColor'); L.new(t.outputs[0], sp.inputs[0])
        mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.inputs['A'].default_value = (.82, .82, .84, 1); mx.inputs['B'].default_value = hexc(f['iris'])
        L.new(sp.outputs[1], mx.inputs['Factor']); dk = N.new('ShaderNodeMix'); dk.data_type = 'RGBA'; dk.inputs['B'].default_value = (.002, .002, .002, 1)
        L.new(mx.outputs['Result'], dk.inputs['A']); L.new(sp.outputs[2], dk.inputs['Factor']); L.new(dk.outputs['Result'], I['Base Color'])
    elif kind in ('lash', 'fur'):
        file = f"{f.get('map', 'lash')}.webp" if kind == 'lash' else f"{f['key']}_fur.webp"
        t = tex(f'{PUB}/{file}', True); sp = N.new('ShaderNodeSeparateColor'); L.new(t.outputs[0], sp.inputs[0])
        I['Base Color'].default_value = hexc(f.get('brow', f.get('root', 0))); I['Roughness'].default_value = .5
        if kind == 'fur':
            at = N.new('ShaderNodeAttribute'); at.attribute_name = 'aLayer'; gt = N.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'
            mu = N.new('ShaderNodeMath'); mu.operation = 'MULTIPLY_ADD'; mu.inputs[1].default_value = .9; mu.inputs[2].default_value = .06
            L.new(at.outputs['Fac'], mu.inputs[0]); L.new(sp.outputs[0], gt.inputs[0]); L.new(mu.outputs[0], gt.inputs[1]); L.new(gt.outputs[0], I['Alpha'])
        else:
            L.new(sp.outputs[0], I['Alpha'])
    elif d.get('uColor') is not None or d['type'] == 'ShaderMaterial':
        I['Base Color'].default_value = (0, 0, 0, 1); I['Emission Color'].default_value = hexc(d.get('uColor', 0xffffff)); I['Emission Strength'].default_value = 8
    else:
        I['Base Color'].default_value = hexc(d.get('color', 0xffffff)); I['Roughness'].default_value = d.get('roughness', .5); I['Metallic'].default_value = d.get('metalness', 0)
        if d.get('emissive'): I['Emission Color'].default_value = hexc(d['emissive']); I['Emission Strength'].default_value = d.get('emissiveIntensity', 1) * 3
        if d.get('transparent'): I['Alpha'].default_value = d.get('opacity', 1)
    return m


def mesh_of(info):
    g = info['geo']; P = b64f(g['pos']).reshape(-1, 3)
    idx = b64f(g['idx'], '<u4') if g.get('idx') else np.arange(len(P), dtype=np.uint32)
    me = bpy.data.meshes.new(info.get('name') or 'm')
    me.from_pydata(P.tolist(), [], idx.reshape(-1, 3).tolist())
    if g.get('uv'):
        uv = b64f(g['uv']).reshape(-1, 2).copy(); uv[:, 1] = 1 - uv[:, 1]
        l = me.uv_layers.new(name='UVMap'); l.data.foreach_set('uv', uv[idx].ravel())
    for k in ('aT', 'aLayer'):
        if g.get(k):
            at = me.attributes.new(k, 'FLOAT', 'POINT'); at.data.foreach_set('value', b64f(g[k]))
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
ID_OF = {'scientist': 'custom_m_scientist'}
def who_of(info):
    f = info['material'].get('film') or {}
    if f.get('kind') != 'skin' or info.get('name') != 'skin_head': return None
    return f.get('marks')


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
objs = {}
for k, fs in ids.items():
    info = json.load(open(f'{DUMP}/fresh/{k}.json')); mat = info['material']
    if info['geo']['n'] < 3 or (mat['type'] == 'ShaderMaterial' and mat.get('uColor') is None): continue
    if info['instanced']: pass
    me = mesh_of(info); me.materials.append(material(mat))
    o = bpy.data.objects.new(info.get('name') or k[:8], me); sc.collection.objects.link(o); objs[k] = o
    recs = {f: next(r for r in data[f]['meshes'] if r['id'] == k) for f in fs}
    baked = any('baked' in r for r in recs.values())
    if baked:
        n = info['geo']['n']; path = f'{CACHE}/{k}.pc2'
        with open(path, 'wb') as w:
            w.write(b'POINTCACHE2\0' + struct.pack('<iiffi', 1, n, float(frames[0]), 1.0, len(frames)))
            last = None
            for f in frames:
                r = recs.get(f)
                if r and 'baked' in r:
                    q = b64f(r['baked']).reshape(-1, 3)
                    wid = who_of(info)
                    fd = face_of(ID_OF.get(wid, wid)) if wid and PERF.get(wid) else None
                    if fd and len(fd[2]) == len(q):
                        q = FACE.apply(q.copy(), fd[2], fd[1], fd[0], FACE.track(fd[0], PERF[wid], f / 24, seed=len(wid)))
                    last = np.stack([q[:, 0], -q[:, 2], q[:, 1]], 1).astype('<f4')
                if last is None:
                    q = b64f(next(iter(x for x in recs.values() if 'baked' in x))['baked']).reshape(-1, 3); last = np.stack([q[:, 0], -q[:, 2], q[:, 1]], 1).astype('<f4')
                w.write(last.tobytes())
        if info.get('name') in ('skin_head', 'cloth'):
            pass
        mc = o.modifiers.new('film', 'MESH_CACHE'); mc.cache_format = 'PC2'; mc.filepath = path; mc.frame_start = frames[0]; mc.deform_mode = 'OVERWRITE'
        o.cycles.use_deform_motion = True
        if info.get('name') in ('skin_head', 'skin_body', 'cloth'):
            sb = o.modifiers.new('sub', 'SUBSURF'); sb.levels = 0; sb.render_levels = 1  # the game head is thin for a close-up
    else:
        for f, r in recs.items():
            o.matrix_world = C @ Matrix(np.array(r['m']).reshape(4, 4).T.tolist())
            o.keyframe_insert('location', frame=f); o.rotation_mode = 'QUATERNION'; o.keyframe_insert('rotation_quaternion', frame=f); o.keyframe_insert('scale', frame=f)
    for f in frames:
        o.hide_render = f not in recs; o.keyframe_insert('hide_render', frame=f)
    if 'inst' in next(iter(recs.values())): print('instanced kept single:', o.name, flush=True)

# camera and lens
cd = bpy.data.cameras.new('c'); cd.sensor_fit = 'VERTICAL'; cd.sensor_height = 24; cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam
cd.dof.use_dof = True; cam.rotation_mode = 'QUATERNION'
for f, d in data.items():
    c = d['camera']; cam.matrix_world = C @ Matrix(np.array(c['m']).reshape(4, 4).T.tolist())
    cam.keyframe_insert('location', frame=f); cam.keyframe_insert('rotation_quaternion', frame=f)
    cd.lens = 12 / math.tan(math.radians(c['fov']) / 2); cd.keyframe_insert('lens', frame=f)
    cd.dof.focus_distance = max(c['focus'], .3) if c['focus'] else 40; cd.dof.keyframe_insert('focus_distance', frame=f)
    cd.dof.aperture_fstop = max(.8, min(16, .012 / max(c['aperture'], 1e-4) * 1.4)) if c['aperture'] else 22; cd.dof.keyframe_insert('aperture_fstop', frame=f)

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
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; nt = w.node_tree
bg = nt.nodes['Background']; bg.inputs[1].default_value = 1
if a.plate:
    e = nt.nodes.new('ShaderNodeTexEnvironment'); e.interpolation = 'Cubic'; e.image = image(os.path.expanduser(a.plate)); mp = nt.nodes.new('ShaderNodeMapping'); tc = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector']); nt.links.new(mp.outputs[0], e.inputs['Vector']); nt.links.new(e.outputs[0], bg.inputs[0])
    for f, d in data.items():
        h = d.get('hole')
        if h:
            # the plate centres the hole on +y in Blender's world after this rotation
            v = C @ Vector(h['p']); mp.inputs['Rotation'].default_value = (0, -math.asin(max(-1, min(1, v.z / (v.length or 1)))) * -1, math.atan2(v.x, v.y) * -1 + math.pi / 2 * 0)
            mp.inputs['Rotation'].keyframe_insert('default_value', frame=f)
else:
    bg.inputs[0].default_value = (.002, .002, .003, 1)

for f in range(frames[0], frames[-1] + 1, a.step):
    p = f'{OUT}/{f:05d}.png'
    if os.path.exists(p) or f not in data: continue
    sc.frame_set(f); sc.render.filepath = p; bpy.ops.render.render(write_still=True); print('rendered', f, flush=True)
