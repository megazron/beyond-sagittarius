#!/usr/bin/env python3
"""Light builds of Zenvora's props. The Poly Haven scans are 10k to 176k triangles each (a street lamp is 30k), and the
street draws hundreds of them: on a laptop GPU the props alone were 9.6 M triangles a frame, plus 5 M in the shadow map.

For each public/models/city/<name>.glb this writes <name>.lod1.glb (about an eighth of the triangles, for props further
off than a few metres, and for every shadow), and caps the near build at NEAR_CAP triangles. gltfpack's simplifier keeps
UV seams and borders; both keep meshopt compression and quantisation.
  python3 tools/lod_city.py [--dir public/models/city] [--force]"""
import argparse, json, pathlib, shutil, struct, subprocess, tempfile

NEAR_CAP = 14000   # the near build: still a scan up close, a quarter of a potted plant's 176k
FAR_TRIS = 1600    # the far build: a silhouette with its texture

def tris(p: pathlib.Path) -> int:
    d = p.read_bytes(); n = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + n])
    return sum(j['accessors'][q['indices']]['count'] // 3 for m in j['meshes'] for q in m['primitives'] if 'indices' in q)

def pack(src: pathlib.Path, dst: pathlib.Path, ratio: float):
    subprocess.run(['npx', '--yes', 'gltfpack', '-i', str(src), '-o', str(dst), '-c', '-kn', '-vp', '14', '-vt', '12', '-si', f'{ratio:.4f}'],
                   check=True, capture_output=True, cwd=pathlib.Path.home())

ap = argparse.ArgumentParser(); ap.add_argument('--dir', default=str(pathlib.Path(__file__).resolve().parent.parent / 'public/models/city'))
ap.add_argument('--force', action='store_true'); a = ap.parse_args()
d = pathlib.Path(a.dir)
for src in sorted(d.glob('*.glb')):
    if src.name.endswith('.lod1.glb'): continue
    lod1 = src.with_name(src.stem + '.lod1.glb')
    if lod1.exists() and not a.force: continue
    n = tris(src)
    with tempfile.TemporaryDirectory() as t:
        if n > NEAR_CAP:
            tmp = pathlib.Path(t) / 'near.glb'; pack(src, tmp, NEAR_CAP / n); shutil.copy(tmp, src)
        n0 = tris(src)
        pack(src, lod1, min(1.0, max(0.02, FAR_TRIS / max(n0, 1))))
    print(f'{src.stem}: {n} -> {n0} near, {tris(lod1)} far', flush=True)
