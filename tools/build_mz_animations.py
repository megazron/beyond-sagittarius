#!/usr/bin/env python3
"""MegaZroN's own acting clips for his films -> public/models/crew/anim_mz.glb + anim_mz.json.

CMU take 13_02 (a man walks two steps to a high stool, turns, sits, shifts, stands up again), kept with its real path
over the floor so nothing slides: every clip is in one frame whose origin is where he stands as `mz_sit_down` starts,
facing +Z. The film puts his root there and the stool where the capture's stool was (seat, seatYaw in the json).
  mz_sit_down   steps to the stool, turns, sits            (once)
  mz_sit_idle   seated, small shifts, there and back       (loop)
  mz_sit_talk   seated; arms, hands and head of the standing talk loop on the seated body (loop)
  mz_stand_up   up off the stool and a step away           (once)
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
    Ti, pi = cut(*IDLE)
    n = len(pi) - 1
    idx = np.concatenate([np.arange(n + 1), np.arange(n - 1, 0, -1)])
    Ti = {k: v[idx] for k, v in Ti.items()}; pi = pi[idx]
    Ti, pi = B.smooth_clip(Ti, pi, 3.0, 0.85, True)
    made['mz_sit_idle'] = (Ti, pi)
    made['mz_stand_up'] = cut(*UP)
    # the seated talk: the standing talk loop's arms, hands, neck and head on the seated body (every bone's rest turn is
    # the identity, so a bone's turn can be taken from one clip and its parent's from another)
    Tt, pt, _ = B.make_ual(ref, 'ual:Idle_Talking_Loop', 'uloop')
    Ft = len(pt)
    ii = np.arange(Ft) % len(pi)
    Tk = {k: v[ii].copy() for k, v in Ti.items()}
    for k in Tt:
        if k.startswith(('clavicle', 'upperarm', 'lowerarm', 'hand', 'forearm')) and k in Tk:
            Tk[k] = Tt[k].copy()
    for k in ('neck', 'head', 'chest'):
        # half of the talk's own nods and turns, about the seated pose
        if k in Tt and k in Tk:
            m = Tt[k].mean(0); m /= np.linalg.norm(m)
            d = Tt[k] - m
            q = Tk[k] + d * 0.6
            Tk[k] = q / np.linalg.norm(q, axis=1, keepdims=True)
    made['mz_sit_talk'] = (Tk, pi[ii].copy())
    # where the stool is: under the seated hips, and which way he faces on it
    seat = pi.mean(0)
    Rw, _ = B.fk(ref, Ti, pi, 0)
    fz = Rw['hips'][:, 2]
    end = made['mz_stand_up'][1][-1]
    Rw2, _ = B.fk(ref, made['mz_stand_up'][0], made['mz_stand_up'][1], len(made['mz_stand_up'][1]) - 1)
    ez = Rw2['hips'][:, 2]
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
        meta[name] = {'dur': float(times[-1]), 'loop': name in ('mz_sit_idle', 'mz_sit_talk')}
        print(f'{name:14s} {times[-1]:5.2f}s hips y {pc[:, 1].min():.2f}..{pc[:, 1].max():.2f} end xz {pc[-1, 0]:+.2f} {pc[-1, 2]:+.2f}')
    out = os.environ.get('ANIM_OUT') or os.path.join(os.path.dirname(__file__), '..', 'public', 'models', 'crew')
    size = g.write(f'{out}/anim_mz.glb')
    info = {'refLeg': float(ref.leg), 'refHip': float(ref.p('hips')[1]), 'clips': meta,
            'seat': [float(seat[0]), float(seat[1]), float(seat[2])], 'seatYaw': float(np.arctan2(fz[0], fz[2])),
            'upEnd': [float(end[0]), float(end[2])], 'upYaw': float(np.arctan2(ez[0], ez[2])), 'take': TAKE}
    json.dump(info, open(f'{out}/anim_mz.json', 'w'), indent=0)
    print('anim_mz.glb', size // 1024, 'KB', info)


if __name__ == '__main__':
    main()
