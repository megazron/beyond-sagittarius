#!/usr/bin/env python3
"""MegaZroN's own acting clips for his films -> public/models/crew/anim_mz.glb + anim_mz.json.

CMU take 13_02 (a man walks two steps to a high stool, turns, sits, shifts, stands up again), kept with its real path
over the floor so nothing slides: every clip is in one frame whose origin is where he stands as `mz_sit_down` starts,
facing +Z. The film puts his root there and the stool where the capture's stool was (seat, seatYaw in the json).
  mz_sit_down   steps to the stool, turns, sits            (once)
  mz_sit_idle   seated, small shifts, there and back       (loop)
  mz_sit_talk   seated; arms, hands and head of the standing talk loop on the seated loop, same length and clock (loop)
  mz_stand_up   up off the stool and a step away           (once)
  mz_walk_in    a captured walk (CMU 07_01), in its own frame: it ends at the origin facing +Z as one foot passes
                the other, where mz_sit_down starts; walkFrom (json) is where it comes from                 (once)
Run through ~/bin/heavy (numpy + the MakeHuman reference rig).
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__)); sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'chars'))
import build_animations as B
from glb import Glb

TAKE, T0, T1 = '13_02', 0.4, 19.4
SIT = (0.4, 5.1)          # standing, two steps, the turn, down
IDLE = (5.1, 10.6)        # seated
UP = (16.9, 19.3)         # up and away
FPS = B.FPS


WALK = '07_01'


def qmul(a, b):
    x1, y1, z1, w1 = np.moveaxis(a, -1, 0); x2, y2, z2, w2 = np.moveaxis(b, -1, 0)
    return np.stack([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                     w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2], -1)


def carry_rest(T, bones, keep=0.15):
    """Each bone's local turns (x, y, z, w) keep their motion about the clip's mean, while the mean itself goes to the
    rig's rest turn (identity) but for `keep` of it: q' = slerp(1, m, keep) * m^-1 * q."""
    out = dict(T)
    for k in bones:
        if k not in T: continue
        q = T[k].copy(); q[(q[:, 3]) < 0] *= -1
        m = q.mean(0); m /= np.linalg.norm(m)
        tgt = B.slerp(np.array([[0, 0, 0, 1.0]]), m[None], keep)[0]
        minv = m * np.array([-1, -1, -1, 1.0])
        r = qmul(np.broadcast_to(qmul(tgt, minv), q.shape), q)
        out[k] = r / np.linalg.norm(r, axis=1, keepdims=True)
    return out


def walk_in(ref):
    """A captured walk with its real path over the floor, in mz_sit_down's own frame: it ends at the origin facing +Z as
    one foot passes the other (the nearest pose to standing), so the film holds his root still and crosses from the
    last step into mz_sit_down's first frame."""
    W, pos, joints = B.retarget(ref, WALK)
    n = len(pos); a = int(0.15 * FPS)
    # the passing moment: the feet nearest each other along the walk, in the last 45% of the take
    d = joints['lfoot'] - joints['rfoot']
    gap = np.hypot(d[:, 0], d[:, 2]) + np.abs(d[:, 1]) * 2
    lo = int(n * 0.55); b = lo + int(np.argmin(gap[lo:n - 2]))
    z = W['hips'][b - 6:b + 1, :, 2].mean(0)
    ang = np.arctan2(z[0], z[2])
    W, pos = B.apply_heading(W, pos, -ang)
    Y = B.heading_rot(-ang)
    J = {k: p @ Y.T for k, p in joints.items()}
    fl = B.floor_of(J, a, b + 1)
    Q = B.world_to_local(ref, W)
    p = pos[a:b + 1].copy(); p[:, 1] -= fl
    T = {k: v[a:b + 1].copy() for k, v in Q.items()}
    T, p = B.smooth_clip(T, p, 2.2, 1.0, False)
    p[:, 0] -= p[-1, 0]; p[:, 2] -= p[-1, 2]
    low = 9.0
    for i in range(0, len(p), 3):
        _, Pw = B.fk(ref, T, p, i)
        for bn in ('footL', 'footR', 'toeL', 'toeR'):
            low = min(low, Pw[bn][1] - ref.p(bn)[1])
    p[:, 1] -= low
    # the captured walker carried his neck bent back and his chin dropped (CMU 07_01 on this rig): on MegaZroN's high
    # collar the head sank into the coat at every step (owner: "His neck when he walks is going inside his body";
    # probe: head 7.8 cm lower over the shoulders and 27 degrees further down than his standing rest). The neck and
    # the head keep their step-by-step motion about their mean, but the mean is his rest carriage
    T = carry_rest(T, ('neck', 'head'), keep=0.0)
    print(f'walk {WALK}: frames {a}..{b} of {n}, {len(p) / FPS:.2f}s, {np.hypot(p[0, 0], p[0, 2]):.2f} m to the origin from ({p[0, 0]:+.2f}, {p[0, 2]:+.2f}), feet {gap[b]:.3f} apart at the end')
    return T, p


def main():
    ref = B.Ref()
    W, pos, joints = B.retarget(ref, TAKE)
    a, b = int(T0 * FPS), int(T1 * FPS)
    f = lambda t: int(round((t - T0) * FPS))
    # face +Z as the window starts
    z = W['hips'][a:a + 8, :, 2].mean(0)
    ang = np.arctan2(z[0], z[2])
    W, pos = B.apply_heading(W, pos, -ang)
    Y = B.heading_rot(-ang)
    J = {k: p @ Y.T for k, p in joints.items()}
    fl = B.floor_of(J, a, b + 1)
    Q = B.world_to_local(ref, W)
    p = pos[a:b + 1].copy(); p[:, 1] -= fl
    p[:, 0] -= p[0, 0]; p[:, 2] -= p[0, 2]
    T = {k: v[a:b + 1].copy() for k, v in Q.items()}
    T, p = B.smooth_clip(T, p, 2.2, 1.0, False)
    # settle on our own feet (the source hips ride higher over the femurs)
    low = 9.0
    for i in range(0, f(SIT[0] + 1.2), 3):
        _, Pw = B.fk(ref, T, p, i)
        for bn in ('footL', 'footR', 'toeL', 'toeR'):
            low = min(low, Pw[bn][1] - ref.p(bn)[1])
    p[:, 1] -= low
    cut = lambda t0, t1: ({k: v[f(t0):f(t1) + 1].copy() for k, v in T.items()}, p[f(t0):f(t1) + 1].copy())
    made = {}
    made['mz_sit_down'] = cut(*SIT)
    # the captured actor looked down for the stool through the turn and the sit: his head hung and his hair fell over
    # his face. The neck and head keep most of how he held them standing; a little of the look down stays
    Ts, _ps = made['mz_sit_down']; ns = len(_ps)
    for k in ('neck', 'head'):
        if k not in Ts: continue
        q0 = Ts[k][:6].mean(0); q0 /= np.linalg.norm(q0)
        tt = np.arange(ns) / FPS
        w = 0.72 * np.clip((tt - 0.5) / 0.8, 0, 1) ** 2 * (3 - 2 * np.clip((tt - 0.5) / 0.8, 0, 1))
        q = Ts[k].copy(); q[(q * q0).sum(1) < 0] *= -1
        q = q * (1 - w[:, None]) + q0 * w[:, None]
        Ts[k] = q / np.linalg.norm(q, axis=1, keepdims=True)
    Ti, pi = cut(*IDLE)
    n = len(pi) - 1
    idx = np.concatenate([np.arange(n + 1), np.arange(n - 1, 0, -1)])
    Ti = {k: v[idx] for k, v in Ti.items()}; pi = pi[idx]
    Ti, pi = B.smooth_clip(Ti, pi, 3.0, 0.85, True)
    # the seated actor nodded his head 30 degrees down and back up twice in the loop (head pitch +20 -> +52 -> +12 over
    # 1.5 s): with the look to the lens catching it late, his head sank 22 degrees on the reel's key line and came up 16
    # past level (GPU takes r5, r6). The neck and head keep only a slow third of their own drift about their mean; what
    # he does with his head on the words is authored in each film, over the clip
    tt = np.arange(len(pi))
    for k in ('neck', 'head'):
        if k not in Ti: continue
        q = Ti[k].copy(); m = q.mean(0); m /= np.linalg.norm(m); q[(q * m).sum(1) < 0] *= -1
        sig = 0.8 * FPS
        d = np.minimum(np.abs(tt[:, None] - tt[None, :]), len(tt) - np.abs(tt[:, None] - tt[None, :]))  # (a loop: wrap round)
        g = np.exp(-0.5 * (d / sig) ** 2); g /= g.sum(1, keepdims=True)
        q = m + 0.35 * (g @ q - m)
        Ti[k] = q / np.linalg.norm(q, axis=1, keepdims=True)
    made['mz_sit_idle'] = (Ti, pi)
    made['mz_stand_up'] = cut(*UP)
    # the seated talk: the standing talk loop's arms, hands, neck and head on the seated body (every bone's rest turn is
    # the identity, so a bone's turn can be taken from one clip and its parent's from another)
    Tt, pt, _ = B.make_ual(ref, 'ual:Idle_Talking_Loop', 'uloop')
    Ft = len(pt)
    # as long as the seated loop and on the same clock, so the body under the talking arms is the seated loop itself and
    # the film can cross between the two at any moment; the talk loop runs four times in it (it was cut to the talk
    # loop's own 2.9 s, where the seated body under it jumped back to its start: a pop every 2.9 s)
    N = len(pi)
    ph = (np.arange(N) * (4.0 * Ft / N)) % Ft
    i0 = np.floor(ph).astype(int) % Ft; i1 = (i0 + 1) % Ft; fr = (ph - np.floor(ph))[:, None]
    def at(q):
        a, b = q[i0], q[i1].copy()
        flip = (a * b).sum(1) < 0; b[flip] = -b[flip]
        o = a * (1 - fr) + b * fr
        return o / np.linalg.norm(o, axis=1, keepdims=True)
    Tk = {k: v.copy() for k, v in Ti.items()}
    for k in Tt:
        if k.startswith(('clavicle', 'upperarm', 'lowerarm', 'hand', 'forearm')) and k in Tk:
            Tk[k] = at(Tt[k])
    for k in ('neck', 'head', 'chest'):
        # a share of the talk's own nods and turns, about the seated pose
        if k in Tt and k in Tk:
            m = Tt[k].mean(0); m /= np.linalg.norm(m)
            d = at(Tt[k]) - m
            q = Tk[k] + d * (0.5 if k == 'chest' else 0.3)  # (0.6 on the head cocked it to one side for the whole speech)
            Tk[k] = q / np.linalg.norm(q, axis=1, keepdims=True)
    made['mz_sit_talk'] = (Tk, pi.copy())
    # where the stool is: under the seated hips, and which way he faces on it
    seat = pi.mean(0)
    Rw, _ = B.fk(ref, Ti, pi, 0)
    fz = Rw['hips'][:, 2]
    end = made['mz_stand_up'][1][-1]
    Rw2, _ = B.fk(ref, made['mz_stand_up'][0], made['mz_stand_up'][1], len(made['mz_stand_up'][1]) - 1)
    ez = Rw2['hips'][:, 2]
    walk = walk_in(ref)
    made['mz_walk_in'] = walk
    g = Glb(); nodes = {}
    for i, nm in enumerate(ref.names):
        nodes[nm] = g.node(name=nm)
    for i, nm in enumerate(ref.names):
        ch = [nodes[ref.names[j]] for j in range(len(ref.par)) if ref.par[j] == i]
        if ch:
            g.j['nodes'][nodes[nm]]['children'] = ch
    g.j['scenes'][0]['nodes'] = [nodes['hips']]
    meta = {}
    for name, (Tc, pc) in made.items():
        times = np.arange(len(pc)) / FPS
        ch = [(nodes['hips'], 'translation', times, pc.astype(np.float32))]
        for bn, q in Tc.items():
            if bn.startswith('finger'):
                continue
            q = q.copy()
            for i in range(1, len(q)):
                if q[i] @ q[i - 1] < 0:
                    q[i] = -q[i]
            ch.append((nodes[bn], 'rotation', times, q / np.linalg.norm(q, axis=1, keepdims=True)))
        B.add_anim(g, name, ch)
        meta[name] = {'dur': float(times[-1]), 'loop': name in ('mz_sit_idle', 'mz_sit_talk'), }
        print(f'{name:14s} {times[-1]:5.2f}s hips y {pc[:, 1].min():.2f}..{pc[:, 1].max():.2f} end xz {pc[-1, 0]:+.2f} {pc[-1, 2]:+.2f}')
    out = os.environ.get('ANIM_OUT') or os.path.join(os.path.dirname(__file__), '..', 'public', 'models', 'crew')
    size = g.write(f'{out}/anim_mz.glb')
    info = {'refLeg': float(ref.leg), 'refHip': float(ref.p('hips')[1]), 'clips': meta,
            'seat': [float(seat[0]), float(seat[1]), float(seat[2])], 'seatYaw': float(np.arctan2(fz[0], fz[2])),
            'upEnd': [float(end[0]), float(end[2])], 'upYaw': float(np.arctan2(ez[0], ez[2])), 'take': TAKE,
            'walkFrom': [float(walk[1][0, 0]), float(walk[1][0, 2])], 'walkTake': WALK}
    json.dump(info, open(f'{out}/anim_mz.json', 'w'), indent=0)
    print('anim_mz.glb', size // 1024, 'KB', info)


if __name__ == '__main__':
    main()
