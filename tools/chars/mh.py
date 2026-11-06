"""MakeHuman data access: base mesh, targets, macro body shape, mhclo fitting, rig and weights.

Only the CC0 data files are read; none of MakeHuman's AGPL code is used or copied.
Paths come from MH_ROOT (see tools/fetch_character_assets.py).
"""
import json, os, re
import numpy as np

ROOT = os.environ.get('MH_ROOT', os.path.expanduser('~/bs-mh'))
DATA = f'{ROOT}/mhrepo/makehuman/data'
SYS = f'{ROOT}/sys'
EX = f'{ROOT}/ex'


class Obj:
    """Polygonal OBJ with separate position and UV indices."""
    def __init__(self, path):
        v, vt, faces, fuv, fgrp = [], [], [], [], []
        grp, groups = 0, ['default']
        with open(path, errors='ignore') as f:
            for line in f:
                if line.startswith('v '):
                    v.append(line.split()[1:4])
                elif line.startswith('vt '):
                    vt.append(line.split()[1:3])
                elif line.startswith('f '):
                    a, b = [], []
                    for tok in line.split()[1:]:
                        p = tok.split('/')
                        a.append(int(p[0]) - 1)
                        b.append(int(p[1]) - 1 if len(p) > 1 and p[1] else -1)
                    faces.append(a); fuv.append(b); fgrp.append(grp)
                elif line.startswith('g ') or line.startswith('o '):
                    n = line.split()[1] if len(line.split()) > 1 else 'default'
                    if n not in groups:
                        groups.append(n)
                    grp = groups.index(n)
        self.v = np.array(v, np.float64)
        self.vt = np.array(vt, np.float64) if vt else np.zeros((0, 2))
        self.faces, self.fuv = faces, fuv
        self.fgrp = np.array(fgrp)
        self.groups = groups

    def group_faces(self, pred):
        ok = np.array([pred(g) for g in self.groups])
        return np.nonzero(ok[self.fgrp])[0]


_tcache = {}
def load_target(rel_or_path, n=19158):
    """Sparse target -> (idx, delta)."""
    p = rel_or_path if os.path.isabs(rel_or_path) else f'{DATA}/targets/{rel_or_path}'
    if p in _tcache:
        return _tcache[p]
    idx, d = [], []
    with open(p) as f:
        for line in f:
            if line[:1] in '#\n' or not line.strip():
                continue
            s = line.split()
            idx.append(int(s[0])); d.append((float(s[1]), float(s[2]), float(s[3])))
    r = (np.array(idx, np.int64), np.array(d, np.float64).reshape(-1, 3))
    _tcache[p] = r
    return r


def _blend3(x):
    """Slider 0..1 -> weights of the (min, average, max) targets."""
    return {'min': max(0.0, 1 - 2 * x), 'average': 1 - abs(2 * x - 1), 'max': max(0.0, 2 * x - 1)}


def macro_targets(gender=0.0, age=0.5, muscle=0.5, weight=0.5, height=0.5, proportions=0.5,
                  cup=0.5, firmness=0.5, race=(1, 0, 0)):
    """List of (target, weight) like the macro sliders. gender 0 female, 1 male; age 0.5 = 25 years."""
    out = []
    G = {'female': 1 - gender, 'male': gender}
    A = {'young': 1.0}
    M = _blend3(muscle)
    W = _blend3(weight)
    for g, gw in G.items():
        if gw <= 0:
            continue
        for rname, rw in zip(('caucasian', 'african', 'asian'), race):
            if rw > 0:
                out.append((f'macrodetails/{rname}-{g}-young.target', gw * rw))
        for m, mw in M.items():
            if mw <= 0:
                continue
            for w, ww in W.items():
                if ww <= 0:
                    continue
                k = gw * mw * ww
                out.append((f'macrodetails/universal-{g}-young-{m}muscle-{w}weight.target', k))
                base = f'{g}-young-{m}muscle-{w}weight'
                if height != 0.5:
                    h, hw = ('maxheight', 2 * height - 1) if height > 0.5 else ('minheight', 1 - 2 * height)
                    out.append((f'macrodetails/height/{base}-{h}.target', k * hw))
                if proportions != 0.5:
                    pr, pw = ('idealproportions', 2 * proportions - 1) if proportions > 0.5 else ('uncommonproportions', 1 - 2 * proportions)
                    out.append((f'macrodetails/proportions/{base}-{pr}.target', k * pw))
                if g == 'female' or True:
                    C, F = _blend3(cup), _blend3(firmness)
                    for c, cw in C.items():
                        for fi, fw in F.items():
                            if cw * fw <= 0 or (c == 'average' and fi == 'average'):
                                continue
                            pth = f'breast/{base}-{c}cup-{fi}firmness.target'
                            if os.path.exists(f'{DATA}/targets/{pth}'):
                                out.append((pth, k * cw * fw))
    return out


def apply_targets(v, lst):
    v = v.copy()
    for t, w in lst:
        i, d = load_target(t)
        v[i] += d * w
    return v


class Clo:
    """A .mhclo asset: its own OBJ fitted to the body by triangles + offsets."""
    def __init__(self, path):
        self.path = path
        self.dir = os.path.dirname(path)
        self.meta = {'license': '', 'author': ''}
        self.scale = {}
        self.obj_file = None
        self.material = None
        self.delete = []
        self.zdepth = 50
        ref = []
        mode = None
        with open(path, errors='ignore') as f:
            for line in f:
                s = line.strip()
                if s.startswith('#'):
                    m = re.match(r'#\s*(author|license)\s+(.*)', s, re.I)
                    if m:
                        self.meta[m.group(1).lower()] = m.group(2).strip()
                    continue
                if not s:
                    continue
                t = s.split()
                k = t[0]
                if k in ('author', 'license'):
                    self.meta[k] = ' '.join(t[1:])
                elif k == 'obj_file':
                    self.obj_file = t[1]
                elif k == 'material':
                    self.material = ' '.join(t[1:])
                elif k in ('x_scale', 'y_scale', 'z_scale'):
                    self.scale[k[0]] = (int(t[1]), int(t[2]), float(t[3]))
                elif k == 'z_depth':
                    self.zdepth = int(t[1])
                elif k == 'verts':
                    mode = 'verts'
                elif k == 'delete_verts':
                    mode = 'delete'
                elif k == 'weights' or k == 'vertexgroups' or k == 'material' or k == 'name':
                    if k != 'name':
                        mode = None
                elif mode == 'verts':
                    if len(t) == 9:
                        ref.append(([int(t[0]), int(t[1]), int(t[2])], [float(t[3]), float(t[4]), float(t[5])], [float(t[6]), float(t[7]), float(t[8])]))
                    elif len(t) == 1 or len(t) == 3:
                        ref.append(([int(t[0]), int(t[0]), int(t[0])], [1.0, 0.0, 0.0], [0.0, 0.0, 0.0]))
                elif mode == 'delete':
                    i = 0
                    while i < len(t):
                        if i + 2 < len(t) and t[i + 1] == '-':
                            self.delete.extend(range(int(t[i]), int(t[i + 2]) + 1)); i += 3
                        else:
                            self.delete.append(int(t[i])); i += 1
        self.ri = np.array([r[0] for r in ref], np.int64)
        self.rw = np.array([r[1] for r in ref], np.float64)
        self.ro = np.array([r[2] for r in ref], np.float64)
        self.obj = Obj(f'{self.dir}/{self.obj_file}')
        assert len(self.ri) == len(self.obj.v), (path, len(self.ri), len(self.obj.v))

    def fit(self, body):
        """Body-space vertices of the asset for a morphed body (decimetres)."""
        sc = np.ones(3)
        for ax, k in enumerate('xyz'):
            if k in self.scale:
                a, b, ref = self.scale[k]
                sc[ax] = abs(body[a, ax] - body[b, ax]) / ref
        return np.einsum('nk,nkc->nc', self.rw, body[self.ri]) + self.ro * sc

    def transfer(self, field):
        """Barycentric pull of a per-body-vertex field (weights, morph deltas)."""
        return np.einsum('nk,nk...->n...', self.rw, field[self.ri])


def find_clo(name):
    for base in (EX, SYS):
        for root, _dirs, files in os.walk(base):
            for f in files:
                if f.endswith('.mhclo') and (f[:-6] == name or os.path.basename(root) == name):
                    return f'{root}/{f}'
    raise FileNotFoundError(name)


def mhmat(path):
    """.mhmat -> dict of key -> value with texture paths resolved."""
    out = {}
    with open(path, errors='ignore') as f:
        for line in f:
            t = line.split(None, 1)
            if len(t) == 2 and not t[0].startswith('#'):
                out[t[0]] = t[1].strip()
    d = os.path.dirname(path)
    for k, v in list(out.items()):
        if k.endswith('Texture') or k.endswith('Map'):
            p = f'{d}/{v}'
            if not os.path.exists(p):
                p = f'{d}/{os.path.basename(v)}'
            out[k] = p
    return out


# ---- reduced game rig ----
FINGERS = [f'finger{i}-{j}' for i in range(1, 6) for j in (1, 2, 3)]


def rig_map(skel):
    """MH bone name -> reduced bone. Everything inside the skull folds to head/jaw."""
    parents = {b: d['parent'] for b, d in skel['bones'].items()}

    def anc(b):
        while b:
            yield b
            b = parents[b]
    m = {}
    for b in parents:
        a = set(anc(b))
        side = '.L' if b.endswith('.L') else '.R' if b.endswith('.R') else ''
        s = side[1:] if side else ''
        if 'jaw' in a:
            m[b] = 'jaw'
        elif b.startswith('eye.'):
            m[b] = f'eye{s}'
        elif 'head' in a:
            m[b] = 'head'
        elif b in ('neck01', 'neck02'):
            m[b] = 'neck'
        elif b == 'neck03':
            m[b] = 'head' if False else 'neck'
        elif b in ('root', 'spine05') or b.startswith('pelvis'):
            m[b] = 'hips'
        elif b in ('spine04', 'spine03'):
            m[b] = 'spine'
        elif b == 'spine02' or b.startswith('breast'):
            m[b] = 'spine1'
        elif b == 'spine01':
            m[b] = 'chest'
        elif b.startswith('clavicle') or b.startswith('shoulder01'):
            m[b] = f'clavicle{s}'
        elif b.startswith('upperarm'):
            m[b] = f'upperarm{s}'
        elif b.startswith('lowerarm01'):
            m[b] = f'lowerarm{s}'
        elif b.startswith('lowerarm02'):
            m[b] = f'forearmtw{s}'
        elif b.startswith('wrist') or b.startswith('metacarpal'):
            m[b] = f'hand{s}'
        elif b.startswith('finger'):
            m[b] = b.split('.')[0].replace('-', '_') + s
        elif b.startswith('upperleg'):
            m[b] = f'upperleg{s}'
        elif b.startswith('lowerleg'):
            m[b] = f'lowerleg{s}'
        elif b.startswith('foot'):
            m[b] = f'foot{s}'
        elif b.startswith('toe'):
            m[b] = f'toe{s}'
        else:
            raise KeyError(b)
    return m


# bone: (parent, MH joints whose mean is the pivot)
def rig_def():
    d = {'hips': (None, ['spine05____head']),
         'spine': ('hips', ['spine04____head']),
         'spine1': ('spine', ['spine02____head']),
         'chest': ('spine1', ['spine01____head']),
         'neck': ('chest', ['neck01____head']),
         'head': ('neck', ['head____head']),
         'jaw': ('head', ['jaw____head'])}
    for s, S in (('L', '.L'), ('R', '.R')):
        d[f'eye{s}'] = ('head', [f'eye{S}____head'])
        d[f'clavicle{s}'] = ('chest', [f'clavicle{S}____head'])
        d[f'upperarm{s}'] = (f'clavicle{s}', [f'upperarm01{S}____head'])
        d[f'lowerarm{s}'] = (f'upperarm{s}', [f'lowerarm01{S}____head'])
        d[f'forearmtw{s}'] = (f'lowerarm{s}', [f'lowerarm02{S}____head'])
        d[f'hand{s}'] = (f'forearmtw{s}', [f'wrist{S}____head'])
        for f in FINGERS:
            n, j = f[6], int(f[8])
            par = f'hand{s}' if j == 1 else f'finger{n}_{j - 1}{s}'
            d[f'finger{n}_{j}{s}'] = (par, [f'{f}{S}____head'])
        d[f'upperleg{s}'] = ('hips', [f'upperleg01{S}____head'])
        d[f'lowerleg{s}'] = (f'upperleg{s}', [f'lowerleg01{S}____head'])
        d[f'foot{s}'] = (f'lowerleg{s}', [f'foot{S}____head'])
        d[f'toe{s}'] = (f'foot{s}', [f'toe{k}-1{S}____head' for k in (2, 3, 4)])
    return d


class Rig:
    def __init__(self):
        self.skel = json.load(open(f'{DATA}/rigs/default.mhskel'))
        wf = json.load(open(f'{DATA}/rigs/default_weights.mhw'))['weights']
        self.defs = rig_def()
        self.names = list(self.defs)
        self.index = {n: i for i, n in enumerate(self.names)}
        m = rig_map(self.skel)
        self.W = np.zeros((19158, len(self.names)), np.float32)
        for b, lst in wf.items():
            if b not in m:
                raise KeyError(b)
            j = self.index[m[b]]
            for vi, w in lst:
                self.W[vi, j] += w
        s = self.W.sum(1, keepdims=True)
        self.W = np.where(s > 0, self.W / np.maximum(s, 1e-9), 0)
        self.W[s[:, 0] <= 0, self.index['hips']] = 1
        self.joints = self.skel['joints']

    def joint(self, v, name):
        return v[self.joints[name]].mean(0)

    def pivots(self, v):
        P = np.zeros((len(self.names), 3))
        for i, n in enumerate(self.names):
            P[i] = np.mean([self.joint(v, j) for j in self.defs[n][1]], axis=0)
        return P

    def parents(self):
        return [self.index[self.defs[n][0]] if self.defs[n][0] else -1 for n in self.names]
