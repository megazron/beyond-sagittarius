"""Minimal glTF 2.0 binary writer: skinned meshes, morph targets, animation, KHR_mesh_quantization."""
import json, struct
import numpy as np

F32, U8, I8, I16, U16, U32 = 5126, 5121, 5120, 5122, 5123, 5125
_NP = {F32: np.float32, U8: np.uint8, I8: np.int8, I16: np.int16, U16: np.uint16, U32: np.uint32}
_TYPES = {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4', 16: 'MAT4'}


class Glb:
    def __init__(self, generator='beyond-sagittarius tools/chars'):
        self.j = {'asset': {'version': '2.0', 'generator': generator}, 'scene': 0, 'scenes': [{'nodes': []}],
                  'nodes': [], 'buffers': [{'byteLength': 0}], 'bufferViews': [], 'accessors': []}
        self.bin = bytearray()
        self.quant = False

    def _view(self, data, target=None, stride=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            v['target'] = target
        if stride:
            v['byteStride'] = stride
        self.bin.extend(data)
        self.j['bufferViews'].append(v)
        return len(self.j['bufferViews']) - 1

    def accessor(self, a, comp=F32, ncomp=None, normalized=False, target=None, minmax=False, sparse_count=None):
        a = np.ascontiguousarray(a, dtype=_NP[comp])
        n = a.shape[0]
        if ncomp is None:
            ncomp = 1 if a.ndim == 1 else a.shape[1]
        raw = a.tobytes()
        stride = None
        if target == 34962 and (ncomp * a.itemsize) % 4:
            # vertex attributes need 4-byte aligned strides
            pad = (-(ncomp * a.itemsize)) % 4
            row = a.reshape(n, -1).view(np.uint8).reshape(n, -1)
            raw = np.concatenate([row, np.zeros((n, pad), np.uint8)], 1).tobytes()
            stride = ncomp * a.itemsize + pad
            self.quant = True
        acc = {'bufferView': self._view(raw, target, stride), 'componentType': comp, 'count': n, 'type': _TYPES[ncomp]}
        if normalized:
            acc['normalized'] = True
        if minmax:
            acc['min'] = [float(x) for x in a.reshape(n, -1).min(0)]
            acc['max'] = [float(x) for x in a.reshape(n, -1).max(0)]
        self.j['accessors'].append(acc)
        return len(self.j['accessors']) - 1

    def sparse_vec3(self, count, idx, values):
        """Accessor that is zero except at idx (ascending): cheap morph targets."""
        idx = np.asarray(idx)
        iv = self._view(np.ascontiguousarray(idx, np.uint16 if count < 65536 else np.uint32).tobytes())
        vv = self._view(np.ascontiguousarray(values, np.float32).tobytes())
        v = np.asarray(values, np.float32)
        acc = {'componentType': F32, 'count': count, 'type': 'VEC3',
               'min': [float(min(0, x)) for x in v.min(0)], 'max': [float(max(0, x)) for x in v.max(0)],
               'sparse': {'count': int(len(idx)),
                          'indices': {'bufferView': iv, 'componentType': U16 if count < 65536 else U32},
                          'values': {'bufferView': vv}}}
        self.j['accessors'].append(acc)
        return len(self.j['accessors']) - 1

    def node(self, **k):
        self.j['nodes'].append({a: b for a, b in k.items() if b is not None})
        return len(self.j['nodes']) - 1

    def mesh(self, name, prim, morph_names=None, weights=None):
        self.j.setdefault('meshes', [])
        m = {'name': name, 'primitives': [prim]}
        ex = {}
        if morph_names:
            ex['targetNames'] = morph_names
            m['weights'] = [0.0] * len(morph_names)
        if ex:
            m['extras'] = ex
        self.j['meshes'].append(m)
        return len(self.j['meshes']) - 1

    def material(self, name, **k):
        self.j.setdefault('materials', [])
        self.j['materials'].append({'name': name, **k})
        return len(self.j['materials']) - 1

    def skin(self, joints, ibm, skeleton=None):
        self.j.setdefault('skins', [])
        s = {'joints': joints, 'inverseBindMatrices': self.accessor(ibm.reshape(-1, 16), F32, 16)}
        if skeleton is not None:
            s['skeleton'] = skeleton
        self.j['skins'].append(s)
        return len(self.j['skins']) - 1

    def animation(self, name, channels):
        """channels: list of (node, path, times, values)."""
        self.j.setdefault('animations', [])
        sam, ch = [], []
        tcache = {}
        for node, path, t, val in channels:
            key = (len(t), float(t[0]), float(t[-1]))
            if key not in tcache:
                tcache[key] = self.accessor(np.asarray(t, np.float32), F32, 1, minmax=True)
            sam.append({'input': tcache[key], 'interpolation': 'LINEAR', 'output': self.accessor(val, F32)})
            ch.append({'sampler': len(sam) - 1, 'target': {'node': node, 'path': path}})
        self.j['animations'].append({'name': name, 'samplers': sam, 'channels': ch})

    def write(self, path):
        if self.quant:
            self.j['extensionsUsed'] = ['KHR_mesh_quantization']
            self.j['extensionsRequired'] = ['KHR_mesh_quantization']
        while len(self.bin) % 4:
            self.bin.append(0)
        self.j['buffers'][0]['byteLength'] = len(self.bin)
        js = json.dumps(self.j, separators=(',', ':')).encode()
        js += b' ' * (-len(js) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942)); f.write(self.bin)
        return total


def pack_skin(W, maxinf=4):
    """Dense (n, bones) weights -> top-4 joints and u8 weights summing to 255."""
    n = W.shape[0]
    idx = np.argsort(-W, axis=1)[:, :maxinf]
    w = np.take_along_axis(W, idx, 1)
    w = np.maximum(w, 0)
    w /= np.maximum(w.sum(1, keepdims=True), 1e-9)
    q = np.round(w * 255).astype(np.int32)
    q[:, 0] += 255 - q.sum(1)
    q = np.clip(q, 0, 255)
    return idx.astype(np.uint8), q.astype(np.uint8)
