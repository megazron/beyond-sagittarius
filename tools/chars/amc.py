"""CMU mocap: ASF skeleton + AMC motion -> per-bone world rotation matrices and root path (metres)."""
import re
import numpy as np


def rx(a):
    c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def ry(a):
    c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def rz(a):
    c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
def euler(x, y, z):
    return rz(z) @ ry(y) @ rx(x)


class Asf:
    def __init__(self, path):
        txt = open(path, errors='ignore').read()
        self.scale = 1 / 0.45 * 0.0254
        self.bones = {'root': dict(dir=np.zeros(3), length=0.0, axis=np.zeros(3), dof=['rx', 'ry', 'rz'])}
        for blk in re.findall(r'begin(.*?)end', txt[txt.index(':bonedata'):txt.index(':hierarchy')], re.S):
            b = {'dof': []}
            for line in blk.strip().splitlines():
                t = line.split()
                if not t:
                    continue
                if t[0] == 'name':
                    name = t[1]
                elif t[0] == 'direction':
                    b['dir'] = np.array(t[1:4], float)
                elif t[0] == 'length':
                    b['length'] = float(t[1])
                elif t[0] == 'axis':
                    b['axis'] = np.radians(np.array(t[1:4], float))
                elif t[0] == 'dof':
                    b['dof'] = t[1:]
            self.bones[name] = b
        h = txt[txt.index(':hierarchy'):]
        h = h[h.index('begin') + 5:h.rindex('end')]
        self.parent = {'root': None}
        self.order = ['root']
        for line in h.strip().splitlines():
            t = line.split()
            for c in t[1:]:
                self.parent[c] = t[0]
        pend = [b for b in self.parent if b != 'root']
        while pend:
            for b in list(pend):
                if self.parent[b] in self.order:
                    self.order.append(b); pend.remove(b)
        for n, b in self.bones.items():
            b['C'] = euler(*b['axis'])

    def rest_positions(self):
        P = {'root': np.zeros(3)}
        for b in self.order[1:]:
            d = self.bones[b]
            P[b] = P[self.parent[b]] + d['dir'] * d['length'] * self.scale
        return P


def load_amc(path, asf, fps_src=120, fps=30):
    """Returns dict bone -> (F,3,3) world rotations, root (F,3) metres, fps."""
    frames = []
    cur = None
    with open(path, errors='ignore') as f:
        for line in f:
            if line[:1] in '#:':
                continue
            t = line.split()
            if not t:
                continue
            if len(t) == 1 and t[0].isdigit():
                cur = {}
                frames.append(cur)
            elif cur is not None:
                cur[t[0]] = np.array(t[1:], float)
    step = max(1, int(round(fps_src / fps)))
    frames = frames[::step]
    F = len(frames)
    G = {b: np.zeros((F, 3, 3)) for b in asf.order}
    root = np.zeros((F, 3))
    for i, fr in enumerate(frames):
        for b in asf.order:
            d = asf.bones[b]
            C = d['C']
            if b == 'root':
                v = fr['root']
                root[i] = v[:3] * asf.scale
                G[b][i] = C @ euler(*np.radians(v[3:6])) @ C.T
            else:
                rot = np.zeros(3)
                vals = fr.get(b)
                if vals is not None:
                    for k, dof in enumerate(d['dof']):
                        rot['xyz'.index(dof[1])] = np.radians(vals[k])
                G[b][i] = G[asf.parent[b]][i] @ C @ euler(*rot) @ C.T
    return G, root, fps


def fk_positions(asf, G, root):
    """World joint positions for preview and contact detection."""
    F = len(root)
    P = {'root': root.copy()}
    for b in asf.order[1:]:
        d = asf.bones[b]
        P[b] = P[asf.parent[b]] + np.einsum('fij,j->fi', G[b], d['dir'] * d['length'] * asf.scale)
    return P  # P[b] is the END of bone b
