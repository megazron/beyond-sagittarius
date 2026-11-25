"""Quaternius Universal Animation Library (CC0): read the glTF, sample clips, give world bone rotations."""
import base64, json, os, struct
import numpy as np
from scipy.spatial.transform import Rotation, Slerp

ROOT = os.path.expanduser(os.environ.get('MH_ROOT', '~/bs-mh'))
PATH = f'{ROOT}/ual/gltf-universal-animation-library/glTF/AnimationLibrary_Godot_Standard.gltf'
# the second pack (CC0 too): pick up from the ground, plant, carry, eat and drink, an overhand throw, chopping
PATH2 = f'{ROOT}/ual2/x/Universal Animation Library 2 [Standard]/Unreal-Godot/UAL2_Standard.glb'
UE_NAMES = {'Head': 'DEF-head', 'neck_01': 'DEF-neck', 'spine_03': 'DEF-spine.003', 'spine_02': 'DEF-spine.002', 'spine_01': 'DEF-spine.001', 'pelvis': 'DEF-hips'}
for _s, _S in (('l', 'L'), ('r', 'R')):
    UE_NAMES.update({f'clavicle_{_s}': f'DEF-shoulder.{_S}', f'upperarm_{_s}': f'DEF-upper_arm.{_S}', f'lowerarm_{_s}': f'DEF-forearm.{_S}', f'hand_{_s}': f'DEF-hand.{_S}',
                     f'thigh_{_s}': f'DEF-thigh.{_S}', f'calf_{_s}': f'DEF-shin.{_S}', f'foot_{_s}': f'DEF-foot.{_S}', f'ball_{_s}': f'DEF-toe.{_S}'})
    for _f, _g in (('index', 'f_index'), ('middle', 'f_middle'), ('ring', 'f_ring'), ('pinky', 'f_pinky'), ('thumb', 'thumb')):
        for _j in (1, 2, 3):
            UE_NAMES[f'{_f}_0{_j}_{_s}'] = f'DEF-{_g}.0{_j}.{_S}'
_CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8, 5122: np.int16}
_NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


class Ual:
    def __init__(self, path=PATH):
        if path.endswith('.glb'):
            # binary glTF: a JSON chunk, then the BIN chunk
            b = open(path, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]
            self.g = json.loads(b[20:20 + n]); m = struct.unpack('<I', b[20 + n:24 + n])[0]
            self.bin = b[28 + n:28 + n + m]
        else:
            self.g = json.load(open(path))
            self.bin = open(os.path.join(os.path.dirname(path), self.g['buffers'][0]['uri']), 'rb').read()
        g = self.g
        self.names = [n.get('name', str(i)) for i, n in enumerate(g['nodes'])]
        # the second pack names its bones the Unreal way: renamed to the first pack's, so one retarget reads both
        self.names = [UE_NAMES.get(n, n) for n in self.names]
        self.parent = [-1] * len(g['nodes'])
        for i, n in enumerate(g['nodes']):
            for c in n.get('children', []):
                self.parent[c] = i
        # topological order
        self.order, seen = [], set()
        def visit(i):
            if i in seen:
                return
            if self.parent[i] >= 0:
                visit(self.parent[i])
            seen.add(i); self.order.append(i)
        for i in range(len(g['nodes'])):
            visit(i)
        self.anims = {a['name']: a for a in g['animations']}

    def acc(self, i):
        a = self.g['accessors'][i]
        v = self.g['bufferViews'][a['bufferView']]
        off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        n = _NC[a['type']]
        return np.frombuffer(self.bin, _CT[a['componentType']], a['count'] * n, off).reshape(a['count'], n).astype(np.float64)

    def rest(self):
        T = [np.array(n.get('translation', [0, 0, 0]), float) for n in self.g['nodes']]
        R = [Rotation.from_quat(n.get('rotation', [0, 0, 0, 1])) for n in self.g['nodes']]
        return T, R

    def sample(self, name, fps=30, t0=0.0, t1=None):
        """World rotation (F,3,3) and position (F,3) of every named node."""
        a = self.anims[name]
        T0, R0 = self.rest()
        tracks = {}
        end = 0
        for ch in a['channels']:
            s = a['samplers'][ch['sampler']]
            t = self.acc(s['input'])[:, 0]
            v = self.acc(s['output'])
            tracks[(ch['target']['node'], ch['target']['path'])] = (t, v)
            end = max(end, t[-1])
        end = t1 if t1 else end
        ts = np.arange(t0, end + 1e-6, 1 / fps)
        F = len(ts)
        out_R, out_P = {}, {}
        for i in self.order:
            if (i, 'rotation') in tracks:
                t, v = tracks[(i, 'rotation')]
                if len(t) > 1:
                    q = Slerp(t, Rotation.from_quat(v))(np.clip(ts, t[0], t[-1]))
                else:
                    q = Rotation.from_quat(np.repeat(v, F, 0))
            else:
                q = Rotation.from_quat(np.tile(R0[i].as_quat(), (F, 1)))
            if (i, 'translation') in tracks:
                t, v = tracks[(i, 'translation')]
                p = np.stack([np.interp(ts, t, v[:, k]) for k in range(3)], 1)
            else:
                p = np.tile(T0[i], (F, 1))
            par = self.parent[i]
            if par < 0:
                out_R[i], out_P[i] = q.as_matrix(), p
            else:
                out_R[i] = np.einsum('fij,fjk->fik', out_R[par], q.as_matrix())
                out_P[i] = out_P[par] + np.einsum('fij,fj->fi', out_R[par], p)
        return {self.names[i]: out_R[i] for i in self.order}, {self.names[i]: out_P[i] for i in self.order}, ts
