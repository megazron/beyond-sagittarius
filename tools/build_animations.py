#!/usr/bin/env python3
"""CMU mocap (AMC) -> retargeted clips on the crew rig -> public/models/crew/anim.glb + anim.json.

Every rig bone has an identity rest rotation, so a clip is shared by all bodies; only the hips
translation is rescaled at runtime by leg length. Gestures the database lacks (facepalm, selfie,
injured sit, lie) are made here by layering offline IK on a mocap idle.
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'chars'))
import mh, amc, ual
from glb import Glb, F32, I16

M = os.path.expanduser(f'{mh.ROOT}/mocap')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'models', 'crew')
FPS = 30

SRC = {'hips': 'root', 'spine': 'lowerback', 'spine1': 'upperback', 'chest': 'thorax', 'neck': 'lowerneck', 'head': 'head'}
for s, a in (('L', 'l'), ('R', 'r')):
    SRC.update({f'clavicle{s}': f'{a}clavicle', f'upperarm{s}': f'{a}humerus', f'lowerarm{s}': f'{a}radius', f'hand{s}': f'{a}hand',
                f'upperleg{s}': f'{a}femur', f'lowerleg{s}': f'{a}tibia', f'foot{s}': f'{a}foot', f'toe{s}': f'{a}toes'})

# name: take, start, end (s; None = auto), mode, hand shape.
# 'ual:' takes are Quaternius' hand-keyed game loops (CC0): clean foot contacts, seamless, with fingers.
# Plain numbers are CMU captures, used where the free pack has no such action.
CLIPS = {
    'stand':      ('ual:Idle_Loop', None, None, 'uloop', None),
    'idle_talk':  ('ual:Idle_Talking_Loop', None, None, 'uloop', None),
    'walk':       ('ual:Walk_Loop', None, None, 'ucycle', None),
    'walk_formal': ('ual:Walk_Formal_Loop', None, None, 'ucycle', None),
    'run':        ('ual:Jog_Fwd_Loop', None, None, 'ucycle', None),
    'sprint':     ('ual:Sprint_Loop', None, None, 'ucycle', None),
    'jump':       ('ual:Jump_Loop', None, None, 'uair', None),
    'crouch':     ('ual:Crouch_Idle_Loop', None, None, 'uloop', None),
    'swim':       ('ual:Swim_Fwd_Loop', None, None, 'uair', None),
    'swim_idle':  ('ual:Swim_Idle_Loop', None, None, 'uair', None),
    'limp':       ('139_19', None, None, 'cycle', 'relaxed'),
    'sit':        ('82_05', 1.5, 15.0, 'loop', 'relaxed'),
    'wave':       ('141_16', 0.3, 1.7, 'pingpong', 'open'),
    'point':      ('139_25', 2.3, 3.2, 'pingpong', 'point'),
    'cheer':      ('79_69', 1.0, 4.0, 'loop', 'open'),
    'shout':      ('18_10', 1.0, 5.6, 'loop', 'fist'),
    'argue':      ('ual:Idle_Talking_Loop', None, None, 'uloop', None),
    'present':    ('ual:Idle_Talking_Loop', None, None, 'uloop', None),
    'write':      ('79_31', 1.3, 3.9, 'loop', 'relaxed'),
}


# How much of the performance survives: standing people should barely move.
CALM = {'wave': 0.9, 'argue': 0.6, 'shout': 0.6, 'present': 0.7, 'cheer': 0.75, 'write': 0.8, 'sit': 0.5}


def norm(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def frame2(d, h):
    d = norm(d); h = norm(h - d * (h @ d))
    return np.stack([d, h, np.cross(d, h)], 1)


def align(dt, ds, ht=None, hs=None):
    """Rotation taking the target's rest direction (and hinge) to the source's."""
    if ht is None:
        a, b = norm(dt), norm(ds)
        v = np.cross(a, b); c = a @ b
        K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        return np.eye(3) + K + K @ K / (1 + c)
    return frame2(ds, hs) @ frame2(dt, ht).T


def mat2quat(R):
    """(F,3,3) -> (F,4) xyzw, sign continuous."""
    from scipy.spatial.transform import Rotation
    q = Rotation.from_matrix(R).as_quat()
    for i in range(1, len(q)):
        if q[i] @ q[i - 1] < 0:
            q[i] = -q[i]
    return q


def quat2mat(q):
    from scipy.spatial.transform import Rotation
    return Rotation.from_quat(q).as_matrix()


class Ref:
    """Neutral reference skeleton shared by all clips."""
    def __init__(self):
        self.rig = mh.Rig()
        base = mh.Obj(f'{mh.DATA}/3dobjs/base.obj')
        v = mh.apply_targets(base.v, mh.macro_targets(gender=0.5))
        y0 = v[self.rig.W.sum(1) > 0, 1].min()
        P = self.rig.pivots(v) * 0.1
        bf = base.group_faces(lambda g: g == 'body')
        used = np.unique(np.concatenate([base.faces[i] for i in bf]))
        P[:, 1] -= v[used, 1].min() * 0.1
        self.P = P
        self.names = self.rig.names
        self.ix = self.rig.index
        self.par = self.rig.parents()
        self.leg = np.linalg.norm(P[self.ix['upperlegL']] - P[self.ix['lowerlegL']]) + np.linalg.norm(P[self.ix['lowerlegL']] - P[self.ix['footL']])

    def p(self, n):
        return self.P[self.ix[n]]


def corrections(ref, asf, takes_sign):
    """Per-bone C: target rest -> source rest."""
    B = asf.bones
    C = {}
    p = ref.p
    # the trunk: mocap rest leans differently from the MakeHuman rest, so match bone directions
    C['spine'] = align(p('spine1') - p('spine'), B['lowerback']['dir'])
    C['spine1'] = align(p('chest') - p('spine1'), B['upperback']['dir'])
    C['chest'] = align(p('neck') - p('chest'), B['thorax']['dir'])
    C['neck'] = align(p('head') - p('neck'), B['lowerneck']['dir'] + B['upperneck']['dir'])
    # eyes level in the source rest
    C['head'] = align(np.array([0, 1.0, 0.0]), B['head']['dir'])
    for s, a in (('L', 'l'), ('R', 'r')):
        u = p(f'lowerarm{s}') - p(f'upperarm{s}')
        f = p(f'hand{s}') - p(f'lowerarm{s}')
        ht = np.cross(u, f)
        hs = B[f'{a}radius']['C'][:, 0] * takes_sign[f'{a}radius']
        C[f'upperarm{s}'] = align(u, B[f'{a}humerus']['dir'], ht, hs)
        C[f'lowerarm{s}'] = align(f, B[f'{a}radius']['dir'], ht, hs)
        C[f'clavicle{s}'] = align(p(f'upperarm{s}') - p(f'clavicle{s}'), B[f'{a}clavicle']['dir'])
        d = p(f'finger3_1{s}') - p(f'hand{s}')
        ac = p(f'finger2_1{s}') - p(f'finger5_1{s}')
        C[f'hand{s}'] = align(d, B[f'{a}hand']['dir'], ac, B[f'{a}thumb']['dir'])
        th = p(f'lowerleg{s}') - p(f'upperleg{s}')
        sh = p(f'foot{s}') - p(f'lowerleg{s}')
        X = np.array([1.0, 0, 0])
        hk = B[f'{a}tibia']['C'][:, 0] * takes_sign[f'{a}tibia']
        C[f'upperleg{s}'] = align(th, B[f'{a}femur']['dir'], X, hk)
        C[f'lowerleg{s}'] = align(sh, B[f'{a}tibia']['dir'], X, hk)
        ft = p(f'toe{s}') - p(f'foot{s}')
        C[f'foot{s}'] = align(ft, B[f'{a}foot']['dir'], X, X)
        C[f'toe{s}'] = C[f'foot{s}']
    return C


UMAP = {'hips': 'DEF-hips', 'spine': 'DEF-spine.001', 'spine1': 'DEF-spine.002', 'chest': 'DEF-spine.003', 'neck': 'DEF-neck', 'head': 'DEF-head'}
for _s in 'LR':
    UMAP.update({f'clavicle{_s}': f'DEF-shoulder.{_s}', f'upperarm{_s}': f'DEF-upper_arm.{_s}', f'lowerarm{_s}': f'DEF-forearm.{_s}', f'hand{_s}': f'DEF-hand.{_s}',
                 f'upperleg{_s}': f'DEF-thigh.{_s}', f'lowerleg{_s}': f'DEF-shin.{_s}', f'foot{_s}': f'DEF-foot.{_s}', f'toe{_s}': f'DEF-toe.{_s}'})
    for _n, _f in ((1, 'thumb'), (2, 'f_index'), (3, 'f_middle'), (4, 'f_ring'), (5, 'f_pinky')):
        for _j in (1, 2, 3):
            UMAP[f'finger{_n}_{_j}{_s}'] = f'DEF-{_f}.0{_j}.{_s}'


class UalSource:
    """Rest frames of the Quaternius rig against ours: each bone is matched by direction plus a real
    second axis (elbow and knee hinge read from how the joint actually bends, palm plane from the knuckles),
    so no limb twists and no wrist breaks."""
    def __init__(self, ref):
        self.u = ual.Ual()
        R, P, _ = self.u.sample('A_TPose')
        self.R0 = {b: R[b][0] for b in R}
        self.P0 = {b: P[b][0] for b in P}
        P0 = self.P0
        self.leg = np.linalg.norm(P0['DEF-thigh.L'] - P0['DEF-shin.L']) + np.linalg.norm(P0['DEF-shin.L'] - P0['DEF-foot.L'])
        self.k = ref.leg / self.leg
        p = ref.p
        C = {}
        d = lambda a, b: P0[b] - P0[a]
        C['spine'] = align(p('spine1') - p('spine'), d('DEF-spine.001', 'DEF-spine.002'))
        C['spine1'] = align(p('chest') - p('spine1'), d('DEF-spine.002', 'DEF-spine.003'))
        C['chest'] = align(p('neck') - p('chest'), d('DEF-spine.003', 'DEF-neck'))
        C['neck'] = align(p('head') - p('neck'), d('DEF-neck', 'DEF-head'))
        C['head'] = np.eye(3)
        for s, sg in (('L', 1), ('R', -1)):
            ua, fa, ha = f'DEF-upper_arm.{s}', f'DEF-forearm.{s}', f'DEF-hand.{s}'
            hs = self.hinge(ua, fa, ha, ('Sitting_Talking_Loop', 'Idle_Talking_Loop', 'Jog_Fwd_Loop'))
            u_t = p(f'lowerarm{s}') - p(f'upperarm{s}'); f_t = p(f'hand{s}') - p(f'lowerarm{s}')
            ht = np.cross(u_t, f_t)
            C[f'upperarm{s}'] = align(u_t, d(ua, fa), ht, hs)
            C[f'lowerarm{s}'] = align(f_t, d(fa, ha), ht, hs)
            C[f'clavicle{s}'] = align(p(f'upperarm{s}') - p(f'clavicle{s}'), d(f'DEF-shoulder.{s}', ua))
            dt_ = p(f'finger3_1{s}') - p(f'hand{s}'); at = p(f'finger2_1{s}') - p(f'finger5_1{s}')
            ds = d(ha, f'DEF-f_middle.01.{s}'); as_ = P0[f'DEF-f_index.01.{s}'] - P0[f'DEF-f_pinky.01.{s}']
            C[f'hand{s}'] = align(dt_, ds, at, as_)
            nt, ns = sg * np.cross(dt_, at), sg * np.cross(ds, as_)
            for n, f in ((2, 'f_index'), (3, 'f_middle'), (4, 'f_ring'), (5, 'f_pinky'), (1, 'thumb')):
                for j in (1, 2, 3):
                    a_, b_ = f'DEF-{f}.0{j}.{s}', f'DEF-{f}.0{min(j + 1, 3)}.{s}'
                    fs = d(a_, b_) if j < 3 else d(f'DEF-{f}.02.{s}', a_)
                    ft = (p(f'finger{n}_{j + 1}{s}') - p(f'finger{n}_{j}{s}')) if j < 3 else (p(f'finger{n}_3{s}') - p(f'finger{n}_2{s}'))
                    C[f'finger{n}_{j}{s}'] = align(ft, fs, nt, ns)
            th, sh, ft_ = f'DEF-thigh.{s}', f'DEF-shin.{s}', f'DEF-foot.{s}'
            hk = self.hinge(th, sh, ft_, ('Walk_Loop', 'Jog_Fwd_Loop'))
            X = np.array([1.0, 0, 0])
            C[f'upperleg{s}'] = align(p(f'lowerleg{s}') - p(f'upperleg{s}'), d(th, sh), X, hk)
            C[f'lowerleg{s}'] = align(p(f'foot{s}') - p(f'lowerleg{s}'), d(sh, ft_), X, hk)
            C[f'foot{s}'] = align(p(f'toe{s}') - p(f'foot{s}'), d(ft_, f'DEF-toe.{s}'), X, X)
            C[f'toe{s}'] = C[f'foot{s}']
        self.C = C

    def hinge(self, a, b, c, clips):
        """Hinge axis in the rest pose, measured from the bending itself."""
        P0 = self.P0
        u0, f0 = norm(P0[b] - P0[a]), norm(P0[c] - P0[b])
        acc = np.zeros(3)
        for n in clips:
            R, _, _ = self.u.sample(n)
            Da = np.einsum('fij,jk->fik', R[a], self.R0[a].T)
            Db = np.einsum('fij,jk->fik', R[b], self.R0[b].T)
            rel = np.einsum('fji,fjk->fik', Da, Db)
            acc += np.cross(u0, np.einsum('fij,j->fi', rel, f0)).sum(0)
        return norm(acc)

    def retarget(self, ref, clip):
        R, P, _ = self.u.sample(clip)
        W = {}
        for n, b in UMAP.items():
            W[n] = np.einsum('fij,jk,kl->fil', R[b], self.R0[b].T, self.C.get(n, np.eye(3)))
        return W, P['DEF-hips'] * self.k


_US = None
def make_ual(ref, take, mode):
    global _US
    _US = _US or UalSource(ref)
    clip = take[4:]
    W, pos = _US.retarget(ref, clip)
    W = level_gaze(W, 0.6)
    pos = pos.copy()
    pos[:, 0] -= pos[:, 0].mean(); pos[:, 2] -= pos[:, 2].mean()
    Q = world_to_local(ref, W)
    T = {k: v[:-1].copy() for k, v in Q.items()}
    p = pos[:-1].copy()
    F = len(p)
    speed = 0.0
    if mode == 'ucycle':
        # foot paths on our skeleton: the left foot furthest forward is frame 0, so gaits share a phase
        zl = np.zeros(F); fz = {b: np.zeros(F) for b in ('footL', 'footR')}; fy = {b: np.zeros(F) for b in fz}
        for i in range(F):
            _, Pw = fk(ref, T, p, i)
            for b in fz:
                fz[b][i] = Pw[b][2] - Pw['hips'][2]; fy[b][i] = Pw[b][1]
        sh = int(np.argmax(fz['footL']))
        sp = []
        for b in fz:
            low = fy[b] < np.percentile(fy[b], 35)
            v = -(np.roll(fz[b], -1) - np.roll(fz[b], 1)) / 2 * FPS
            sp.append(np.percentile(v[low], 70))
        speed = {'Jog_Fwd_Loop': 2.8, 'Sprint_Loop': 5.0}.get(clip, float(np.mean(sp)))  # flight phases fool the foot measure
        T = {k: np.roll(v, -sh, 0) for k, v in T.items()}
        p = np.roll(p, -sh, 0)
    if mode == 'uair':
        p[:, 1] = ref.p('hips')[1]
    if clip == 'Jog_Fwd_Loop':
        p[:, 1] = p[:, 1].mean() + (p[:, 1] - p[:, 1].mean()) * 0.5  # the pack's jog bounces like a cartoon
    if mode == 'uloop':
        T, p = smooth_clip(T, p, 2.5, 1.0, True)  # circular, so the seam itself is smoothed away
    # closed loop: last key equals the first
    T = {k: np.concatenate([v, v[:1] * np.sign(np.sum(v[:1] * v[-1:]) or 1)]) for k, v in T.items()}
    p = np.concatenate([p, p[:1]])
    return T, p, dict(loop=True, speed=speed, kind='cycle' if mode == 'ucycle' else 'loop', take=take)


def retarget(ref, take):
    sub = take.split('_')[0]
    asf = amc.Asf(f'{M}/{sub}.asf')
    G, root, _ = amc.load_amc(f'{M}/{take}.amc', asf, fps=FPS)
    # flexion sign from the data itself (the joint spends its life on one side of zero)
    sign = {}
    raw = {}
    for line_b in ('lradius', 'rradius', 'ltibia', 'rtibia'):
        vals = []
        with open(f'{M}/{take}.amc', errors='ignore') as f:
            for line in f:
                if line.startswith(line_b + ' '):
                    vals.append(float(line.split()[1]))
        sign[line_b] = 1.0 if np.median(vals) >= 0 else -1.0
    C = corrections(ref, asf, sign)
    F = len(root)
    W = {}
    for n in ref.names:
        b = SRC.get(n)
        if b is None:
            continue
        Cb = C.get(n, np.eye(3))
        W[n] = G[b] @ Cb
    # scale: source hip height from its legs
    B = asf.bones
    src_leg = (B['lfemur']['length'] + B['ltibia']['length']) * asf.scale
    k = ref.leg / src_leg
    pos = root * k
    Pj = amc.fk_positions(asf, G, root)
    joints = {b: Pj[b] * k for b in Pj}
    return W, pos, joints


def level_gaze(W, keep=0.1):
    """Actors often look at their feet on the mocap stage: bring the mean gaze back to level."""
    f = W['head'][:, :, 2].mean(0)
    pitch = np.arctan2(-f[1], np.hypot(f[0], f[2]))
    right = norm(np.cross(np.array([0, 1.0, 0]), f))
    from scipy.spatial.transform import Rotation
    R = Rotation.from_rotvec(right * (pitch * (1 - keep))).as_matrix()
    W['head'] = np.einsum('ij,fjk->fik', R.T if False else R, W['head'])
    # check direction: the correction must reduce pitch, else flip it
    f2 = W['head'][:, :, 2].mean(0)
    if abs(f2[1]) > abs(f[1]):
        W['head'] = np.einsum('ij,fjk->fik', R.T @ R.T, W['head'])
    return W


def world_to_local(ref, W):
    """World rotations -> local quaternions per animated bone, with forearm twist split."""
    F = len(next(iter(W.values())))
    L = {}
    ix, par, names = ref.ix, ref.par, ref.names
    world = {}
    for i, n in enumerate(names):
        pn = names[par[i]] if par[i] >= 0 else None
        Wp = world[pn] if pn else np.tile(np.eye(3), (F, 1, 1))
        if n.startswith('forearmtw'):
            s = n[-1]
            R = np.einsum('fji,fjk->fik', Wp, W[f'hand{s}'])  # lower^-1 * hand
            q = mat2quat(R)
            ax = norm(ref.p(f'hand{s}') - ref.p(f'lowerarm{s}'))
            tw = np.concatenate([ax * (q[:, :3] @ ax)[:, None], q[:, 3:]], 1)
            tw = tw / np.maximum(np.linalg.norm(tw, axis=1, keepdims=True), 1e-9)
            ang = 2 * np.arctan2(np.linalg.norm(tw[:, :3], axis=1), tw[:, 3])
            ang = (ang + np.pi) % (2 * np.pi) - np.pi
            half = np.concatenate([norm(tw[:, :3] + 1e-12) * np.sin(ang / 4)[:, None], np.cos(ang / 4)[:, None]], 1)
            Rl = quat2mat(half)
            world[n] = Wp @ Rl
            L[n] = Rl
        elif n in W:
            Rl = np.einsum('fji,fjk->fik', Wp, W[n])
            world[n] = W[n]
            L[n] = Rl
        else:
            world[n] = Wp
    return {n: mat2quat(r) for n, r in L.items()}


def slerp(a, b, t):
    from scipy.spatial.transform import Rotation, Slerp
    out = np.zeros_like(a)
    d = np.sum(a * b, 1, keepdims=True)
    b = np.where(d < 0, -b, b)
    o = a * (1 - t) + b * t
    return o / np.linalg.norm(o, axis=1, keepdims=True)


def heading_rot(angle):
    return amc.ry(angle)


def smooth_clip(T, p, sigma, calm=1.0, loop=True):
    """Low-pass the capture (marker noise reads as shake) and pull idles towards their mean pose."""
    from scipy.ndimage import gaussian_filter1d
    mode = 'wrap' if loop else 'nearest'
    out = {}
    for b, q in T.items():
        q = q.copy()
        for i in range(1, len(q)):
            if q[i] @ q[i - 1] < 0:
                q[i] = -q[i]
        f = gaussian_filter1d(q, sigma, axis=0, mode=mode)
        if calm < 1:
            m = f.mean(0, keepdims=True)
            f = m + (f - m) * calm
        out[b] = f / np.linalg.norm(f, axis=1, keepdims=True)
    p2 = gaussian_filter1d(p, sigma, axis=0, mode=mode)
    if calm < 1:
        m = p2.mean(0, keepdims=True)
        p2 = m + (p2 - m) * calm
    return out, p2


def apply_heading(W, pos, ang):
    Y = heading_rot(ang)
    W = {n: Y @ w for n, w in W.items()}
    return W, pos @ Y.T


def floor_of(joints, a, b):
    return min(joints[j][a:b, 1].min() for j in ('ltoes', 'rtoes', 'lfoot', 'rfoot', 'ltibia', 'rtibia', 'root', 'lhand', 'rhand'))


def make_cycle(ref, take):
    W, pos, joints = retarget(ref, take)
    F = len(pos)
    # steadiest fast stretch of the take: mocap volumes are small and people turn at the ends
    from scipy.ndimage import uniform_filter1d
    v = np.gradient(pos[:, [0, 2]], axis=0) * FPS
    vs = uniform_filter1d(v, 15, axis=0, mode='nearest')
    sp = np.linalg.norm(vs, axis=1)
    fast = sp > 0.75 * np.percentile(sp, 90)
    runs, st = [], None
    for i, f in enumerate(np.append(fast, False)):
        if f and st is None:
            st = i
        elif not f and st is not None:
            runs.append((i - st, st, i)); st = None
    _, r0, r1 = max(runs)
    d = vs[r0:r1].mean(0)
    ang = np.arctan2(d[0], d[1])  # direction of travel -> +Z
    W, pos = apply_heading(W, pos, -ang)
    W = level_gaze(W)
    Y = heading_rot(-ang)
    J = {b: p @ Y.T for b, p in joints.items()}
    rel = (J['lfoot'] - J['root'])[:, 2]
    # gait period by autocorrelation of the foot's swing, then heel strikes inside that stretch
    x = rel[r0:r1] - rel[r0:r1].mean()
    ac = np.correlate(x, x, 'full')[len(x) - 1:]
    lo = int(0.4 * FPS)
    hi = min(len(ac) - 1, int(1.9 * FPS))
    per_est = lo + int(np.argmax(ac[lo:hi]))
    pk = []
    i = r0 + int(np.argmax(rel[r0:r0 + per_est + 1]))
    while i < r1 and i < F:
        pk.append(i)
        w0, w1 = i + int(per_est * .8), min(F - 1, i + int(per_est * 1.2))
        if w1 <= w0:
            break
        i = w0 + int(np.argmax(rel[w0:w1 + 1]))
    if len(pk) < 2:
        pk = [r0, min(F - 1, r0 + per_est)]
    mid = (r0 + r1) / 2
    best = min(range(len(pk) - 1), key=lambda i: abs((pk[i] + pk[i + 1]) / 2 - mid))
    a, b = pk[best], pk[best + 1]
    n = b - a
    # ground speed as the stance foot sees it: what foot sync actually needs
    both = []
    for fj in ('lfoot', 'rfoot'):
        h = J[fj][a:b + 1, 1]
        low = h < np.percentile(h, 40)
        vz = -np.gradient(J[fj][a:b + 1, 2] - J['root'][a:b + 1, 2]) * FPS
        both.append(np.median(vz[low]))
    speed = float(np.mean(both))
    Q = world_to_local(ref, W)
    k = min(a, n // 4, 8)
    T = {}
    for bone, q in Q.items():
        o = q[a:b + 1].copy()
        for i in range(k):
            w = (i + 1) / (k + 1)
            j = n - k + i + 1
            o[j:j + 1] = slerp(q[a + j:a + j + 1], q[a + j - n:a + j - n + 1], w)
        o[n] = o[0] if o[n] @ o[0] >= 0 else -o[0]
        T[bone] = o
    p = pos[a:b + 1].copy()
    t = np.linspace(0, 1, n + 1)[:, None]
    p = p - (p[0] + (p[-1] - p[0]) * t)  # remove travel and any drift
    p[:, 0] -= p[:, 0].mean(); p[:, 2] -= p[:, 2].mean()
    fl = floor_of(J, a, b + 1)
    p[:, 1] = pos[a:b + 1, 1] - fl
    p[:, 1] = p[:, 1] + (p[0, 1] - p[-1, 1]) * t[:, 0]
    return T, p, dict(loop=True, speed=float(speed), kind='cycle', take=take)


def make_window(ref, take, t0, t1, mode):
    W, pos, joints = retarget(ref, take)
    F = len(pos)
    a = int((t0 or 0) * FPS); b = min(F - 1, int(t1 * FPS)) if t1 else F - 1
    if mode == 'air':
        # the game flies the body: keep the legs' tuck around the apex, not the rise itself
        top = int(np.argmax(pos[:, 1]))
        a, b = max(0, top - 7), min(F - 1, top + 7)
    # face +Z by the mean hips forward of the window
    z = W['hips'][a:b + 1, :, 2].mean(0)
    ang = np.arctan2(z[0], z[2])
    W, pos = apply_heading(W, pos, -ang)
    Wn = {k: v for k, v in W.items()}
    head_win = {'head': Wn['head'][a:b + 1]}
    fixed = level_gaze(dict(head_win))['head']
    Rfix = fixed[0] @ head_win['head'][0].T
    W['head'] = np.einsum('ij,fjk->fik', Rfix, W['head'])
    Y = heading_rot(-ang)
    J = {k: p @ Y.T for k, p in joints.items()}
    fl = floor_of(J, a, b + 1)
    Q = world_to_local(ref, W)
    p = pos[a:b + 1].copy()
    p[:, 1] -= fl
    p[:, 0] -= p[:, 0].mean(); p[:, 2] -= p[:, 2].mean()
    T = {k: v[a:b + 1].copy() for k, v in Q.items()}
    n = b - a
    if mode == 'air':
        p[:, 1] = ref.p('hips')[1]
        p[:, [0, 2]] = 0
    if mode in ('pingpong', 'air'):
        # forward and back, stretched: a held gesture that keeps breathing
        idx = np.concatenate([np.arange(n + 1), np.arange(n - 1, -1, -1)])
        T = {k: v[idx] for k, v in T.items()}
        p = p[idx]
    elif mode == 'loop':
        k = min(n // 3, 20)
        for bone in T:
            o = T[bone]
            for i in range(k):
                w = (i + 1) / (k + 1)
                o[n - k + i + 1:n - k + i + 2] = slerp(o[n - k + i + 1:n - k + i + 2], o[i:i + 1] if False else o[0:1], w * w)
        for i in range(k):
            w = ((i + 1) / (k + 1)) ** 2
            p[n - k + i + 1] = p[n - k + i + 1] * (1 - w) + p[0] * w
        # horizontal wander would slide the feet: keep it small and closed
        tt = np.linspace(0, 1, len(p))[:, None]
        p[:, [0, 2]] -= (p[-1, [0, 2]] - p[0, [0, 2]]) * tt
    return T, p, dict(loop=mode != 'once', speed=0.0, kind=mode, take=take)


# ---------- hands ----------
def hand_tracks(ref, shape):
    """Constant finger rotations for a hand shape: curl per joint about each finger's hinge."""
    from scipy.spatial.transform import Rotation
    S = {'relaxed': ((12, 28, 18), (18, 32, 22), (22, 36, 24), (26, 38, 26), (10, 12, 10)),
         'open': ((2, 6, 4), (2, 6, 4), (3, 6, 4), (4, 8, 4), (0, 4, 4)),
         'fist': ((62, 92, 62), (64, 95, 64), (66, 95, 64), (68, 95, 62), (22, 30, 34)),
         'point': ((2, 6, 4), (58, 92, 62), (62, 95, 62), (64, 95, 60), (22, 30, 30))}
    order = {2: 0, 3: 1, 4: 2, 5: 3, 1: 4}
    out = {}
    for s, sg in (('L', 1), ('R', -1)):
        d = norm(ref.p(f'finger3_1{s}') - ref.p(f'hand{s}'))
        a = ref.p(f'finger2_1{s}') - ref.p(f'finger5_1{s}')
        n = norm(sg * np.cross(d, a))
        for f in range(1, 6):
            fd = norm(ref.p(f'finger{f}_2{s}') - ref.p(f'finger{f}_1{s}'))
            h = norm(np.cross(fd, n))
            for j in (1, 2, 3):
                ang = np.radians(S[shape][order[f]][j - 1])
                out[f'finger{f}_{j}{s}'] = Rotation.from_rotvec(h * ang).as_quat()
    return out


# ---------- offline IK for gestures ----------
def fk(ref, T, hips, i):
    """World rotation and position of every bone at frame i."""
    Rw, Pw = {}, {}
    for k, n in enumerate(ref.names):
        par = ref.par[k]
        R = quat2mat(T[n][i]) if n in T else np.eye(3)
        if par < 0:
            Rw[n] = R; Pw[n] = hips[i].copy()
        else:
            pn = ref.names[par]
            Rw[n] = Rw[pn] @ R
            Pw[n] = Pw[pn] + Rw[pn] @ (ref.P[k] - ref.P[par])
    return Rw, Pw


def two_bone(ref, T, hips, i, s, target, pole):
    """Set upperarm/lowerarm so the wrist reaches target; elbow towards pole."""
    Rw, Pw = fk(ref, T, hips, i)
    a, b, c = Pw[f'upperarm{s}'], Pw[f'lowerarm{s}'], Pw[f'hand{s}']
    l1 = np.linalg.norm(ref.p(f'lowerarm{s}') - ref.p(f'upperarm{s}'))
    l2 = np.linalg.norm(ref.p(f'hand{s}') - ref.p(f'lowerarm{s}'))
    t = target - a
    d = min(np.linalg.norm(t), (l1 + l2) * 0.995)
    tn = norm(t)
    cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    pl = norm(pole - tn * (pole @ tn))
    elbow = a + tn * (l1 * cosA) + pl * (l1 * np.sqrt(max(0, 1 - cosA ** 2)))
    wrist = a + tn * d
    # desired world rotations from rest
    u0 = norm(ref.p(f'lowerarm{s}') - ref.p(f'upperarm{s}'))
    f0 = norm(ref.p(f'hand{s}') - ref.p(f'lowerarm{s}'))
    h0 = np.cross(u0, f0)
    u1 = norm(elbow - a); f1 = norm(wrist - elbow)
    h1 = np.cross(u1, f1)
    Ru = frame2(u1, h1) @ frame2(u0, h0).T
    Rl = frame2(f1, h1) @ frame2(f0, h0).T
    parent = Rw[f'clavicle{s}']
    from scipy.spatial.transform import Rotation
    T[f'upperarm{s}'][i] = Rotation.from_matrix(parent.T @ Ru).as_quat()
    T[f'lowerarm{s}'][i] = Rotation.from_matrix(Ru.T @ Rl).as_quat()
    return Rl


def set_world_hand(ref, T, hips, i, s, Rhand):
    from scipy.spatial.transform import Rotation
    Rw, _ = fk(ref, T, hips, i)
    T[f'forearmtw{s}'][i] = [0, 0, 0, 1]
    Rw, _ = fk(ref, T, hips, i)
    T[f'hand{s}'][i] = Rotation.from_matrix(Rw[f'forearmtw{s}'].T @ Rhand).as_quat()


def rot_about(T, bone, i, axis, ang):
    from scipy.spatial.transform import Rotation
    q = Rotation.from_quat(T[bone][i]) * Rotation.from_rotvec(np.array(axis) * ang)
    T[bone][i] = q.as_quat()


def gesture(ref, base, name):
    """Layer an arm gesture on a copy of a mocap idle."""
    T0, hips0, meta = base
    T = {k: v.copy() for k, v in T0.items()}
    hips = hips0.copy()
    F = len(hips)
    for i in range(F):
        w = 2 * np.pi * i / F
        if name == 'facepalm':
            rot_about(T, 'neck', i, (1, 0, 0), 0.22); rot_about(T, 'head', i, (1, 0, 0), 0.3 + 0.03 * np.sin(w))
            rot_about(T, 'head', i, (0, 1, 0), 0.09 * np.sin(2 * w))
            rot_about(T, 'chest', i, (1, 0, 0), 0.1)
            Rw, Pw = fk(ref, T, hips, i)
            head = Pw['head']; R = Rw['head']
            tgt = head + R @ np.array([-0.02, 0.09, 0.17])
            two_bone(ref, T, hips, i, 'R', tgt, np.array([-0.6, -0.8, 0.15]))
            Rw, _ = fk(ref, T, hips, i)
            # palm over the brow: fingers up across the forehead
            d0 = norm(ref.p('finger3_1R') - ref.p('handR')); a0 = ref.p('finger2_1R') - ref.p('finger5_1R')
            Rh = frame2(R @ np.array([0.55, 0.8, -0.1]), R @ np.array([0, 0.2, -1])) @ frame2(d0, a0).T
            set_world_hand(ref, T, hips, i, 'R', Rh)
        elif name == 'selfie':
            rot_about(T, 'head', i, (0, 0, 1), -0.16 + 0.02 * np.sin(w)); rot_about(T, 'head', i, (0, 1, 0), -0.3)
            rot_about(T, 'chest', i, (0, 0, 1), 0.05)
            Rw, Pw = fk(ref, T, hips, i)
            head = Pw['head']
            tgt = head + np.array([-0.3, 0.14 + 0.012 * np.sin(2 * w), 0.5])
            two_bone(ref, T, hips, i, 'R', tgt, np.array([-0.8, -0.6, 0.0]))
            d0 = norm(ref.p('finger3_1R') - ref.p('handR')); a0 = ref.p('finger2_1R') - ref.p('finger5_1R')
            Rh = frame2(np.array([0.1, 0.95, 0.15]), np.array([0.6, 0, -1])) @ frame2(d0, a0).T
            set_world_hand(ref, T, hips, i, 'R', Rh)
            Rw, Pw = fk(ref, T, hips, i)
            hip = Pw['upperlegL'] + np.array([0.075, 0.09, 0.0])
            two_bone(ref, T, hips, i, 'L', hip, np.array([0.9, 0.05, -0.4]))
        elif name == 'lie':
            for b in T:
                if b != 'hips':
                    T[b][i] = [0, 0, 0, 1]
            T['hips'][i] = [0, 0, 0, 1]
            br = 0.012 * np.sin(w)
            rot_about(T, 'chest', i, (1, 0, 0), -0.02 + br); rot_about(T, 'head', i, (0, 1, 0), 0.22); rot_about(T, 'neck', i, (1, 0, 0), -0.05)
            for s, sg in (('L', 1), ('R', -1)):
                rot_about(T, f'upperarm{s}', i, (0, 0, 1), sg * -0.35)
                rot_about(T, f'upperleg{s}', i, (0, 0, 1), sg * -0.13)
            hips[i] = ref.p('hips')
    return T, hips, dict(meta, kind='gesture')


def injured(ref, sit):
    """Sat on the ground, right leg out straight, left hand holding the thigh."""
    T0, hips0, meta = sit
    T = {k: v.copy() for k, v in T0.items()}
    hips = hips0.copy()
    from scipy.spatial.transform import Rotation
    F = len(hips)
    for i in range(F):
        Rw, Pw = fk(ref, T, hips, i)
        # straight right leg: thigh along the floor, from the hip outwards
        H = Rw['hips']
        wantd = norm(np.array([-0.16, -0.03, 1]))
        u0 = norm(ref.p('lowerlegR') - ref.p('upperlegR'))
        v = np.cross(u0, wantd); c = u0 @ wantd
        K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        Rt = np.eye(3) + K + K @ K / (1 + c)
        T['upperlegR'][i] = Rotation.from_matrix(H.T @ Rt).as_quat()
        s0 = norm(ref.p('footR') - ref.p('lowerlegR'))
        v = np.cross(Rt @ s0, wantd); c = (Rt @ s0) @ wantd
        K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        T['lowerlegR'][i] = Rotation.from_matrix(np.eye(3) + K + K @ K / (1 + c)).as_quat()
        T['footR'][i] = (Rotation.from_rotvec([-0.9, 0.1, 0.0])).as_quat()
        w = 2 * np.pi * i / F
        Rw, Pw = fk(ref, T, hips, i)
        knee = Pw['lowerlegR'] * 0.72 + Pw['upperlegR'] * 0.28 + np.array([0.0, 0.1, 0.0])
        two_bone(ref, T, hips, i, 'L', knee + 0.006 * np.sin(w), np.array([0.7, -0.2, -0.6]))
        two_bone(ref, T, hips, i, 'R', Pw['upperlegR'] + np.array([-0.16, 0.01, -0.3]), np.array([-1, 0.3, -0.5]))
        rot_about(T, 'neck', i, (1, 0, 0), 0.2)
    return T, hips, dict(meta, kind='gesture')


def main():
    ref = Ref()
    made = {}
    for name, (take, t0, t1, mode, hand) in CLIPS.items():
        if take.startswith('ual:'):
            T, p, meta = make_ual(ref, take, mode)
        elif mode == 'cycle':
            T, p, meta = make_cycle(ref, take)
        else:
            T, p, meta = make_window(ref, take, t0, t1, mode)
        meta['hand'] = hand
        if not take.startswith('ual:'):
            idle = name.startswith('idle')
            sig = 7.0 if idle else 1.2 if mode == 'cycle' else 3.0
            T, p = smooth_clip(T, p, sig, CALM.get(name, 0.2 if idle else 1.0), mode != 'once')
        if mode not in ('air', 'uair'):
            # the source hips sit higher over the femurs than ours: settle on the target's own feet
            low = 9.0
            for i in range(0, len(p), 3):
                _, Pw = fk(ref, T, p, i)
                for b in ('footL', 'footR', 'toeL', 'toeR'):
                    low = min(low, Pw[b][1] - ref.p(b)[1])
            p = p.copy()
            p[:, 1] -= low
        made[name] = (T, p, meta)
        print(f"{name:12s} {take:24s} {len(p) / FPS:5.2f}s speed {meta['speed']:.2f}", flush=True)
    # gestures keep the idle's fingers unless they set their own
    base = dict(made['stand']) if False else made['stand']
    base = ({k: v for k, v in base[0].items() if not k.startswith('finger')}, base[1], base[2])
    made['facepalm'] = gesture(ref, base, 'facepalm'); made['facepalm'][2]['hand'] = 'open'
    made['selfie'] = gesture(ref, base, 'selfie'); made['selfie'][2]['hand'] = 'fist'
    made['lie'] = gesture(ref, base, 'lie'); made['lie'][2]['hand'] = 'relaxed'
    made['injured'] = injured(ref, made['sit']); made['injured'][2]['hand'] = 'relaxed'
    g = Glb()
    nodes = {}
    for i, n in enumerate(ref.names):
        nodes[n] = g.node(name=n)
    for i, n in enumerate(ref.names):
        ch = [nodes[ref.names[j]] for j in range(len(ref.par)) if ref.par[j] == i]
        if ch:
            g.j['nodes'][nodes[n]]['children'] = ch
    g.j['scenes'][0]['nodes'] = [nodes['hips']]
    meta = {}
    shapes = {s: hand_tracks(ref, s) for s in ('relaxed', 'open', 'fist', 'point')}
    for name, (T, p, m) in made.items():
        F = len(p)
        times = np.arange(F) / FPS
        ch = [(nodes['hips'], 'translation', times, p.astype(np.float32))]
        for b, q in T.items():
            q = q / np.linalg.norm(q, axis=1, keepdims=True)
            ch.append((nodes[b], 'rotation', times, q))
        t2 = np.array([0.0, times[-1]])
        for b, q in (shapes[m['hand']] if m['hand'] else {}).items():
            ch.append((nodes[b], 'rotation', t2, np.stack([q, q])))
        add_anim(g, name, ch)
        meta[name] = {k: m[k] for k in ('loop', 'speed', 'kind', 'take', 'hand')}
        meta[name]['dur'] = float(times[-1])
    size = g.write(f'{OUT}/anim.glb')
    json.dump({'refLeg': float(ref.leg), 'refHip': float(ref.p('hips')[1]), 'clips': meta}, open(f'{OUT}/anim.json', 'w'), indent=0)
    print('anim.glb', size // 1024, 'KB', len(made), 'clips')


def add_anim(g, name, chans):
    """Rotations stored as normalised int16: half the bytes, far below visible error."""
    g.j.setdefault('animations', [])
    sam, ch, tc = [], [], {}
    for node, path, t, val in chans:
        key = len(t)
        if key not in tc:
            tc[key] = g.accessor(np.asarray(t, np.float32), F32, 1, minmax=True)
        if path == 'rotation':
            acc = g.accessor(np.round(np.clip(val, -1, 1) * 32767).astype(np.int16), I16, 4, normalized=True)
        else:
            acc = g.accessor(val, F32)
        sam.append({'input': tc[key], 'interpolation': 'LINEAR', 'output': acc})
        ch.append({'sampler': len(sam) - 1, 'target': {'node': node, 'path': path}})
    g.j['animations'].append({'name': name, 'samplers': sam, 'channels': ch})


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    main()
