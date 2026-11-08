#!/usr/bin/env python3
"""The clipping check on what a scene really plays: every frame of a dump, every character in it.
Hand skin behind the body's own surface (torso and thighs), body skin out through cloth, one-frame vertex leaps. Per shot, or per frame range.

  python tools/film/rig_dump_check.py <dump-dir> [first last] [--timing tools/film/entry_timing.json]
Exit 1 if anything is over the limits: a shot whose characters fail does not render."""
import argparse, base64, glob, json, os, sys
import numpy as np
from scipy.spatial import cKDTree
ap = argparse.ArgumentParser(); ap.add_argument('dump'); ap.add_argument('first', nargs='?', type=int, default=0); ap.add_argument('last', nargs='?', type=int, default=10 ** 6)
ap.add_argument('--timing', default=''); a = ap.parse_args()
D = os.path.expanduser(a.dump); HAND, POKE, LEAP = 2.0, 3.0, 6.0  # hand: cm behind the surface you see (after 1.5 cm for soft cloth); every flag up to 1.7
# was looked at in close-up (a hand resting on a coat or a bag) and none showed; the medic's buried hand before the fixes read 3.3. Cloth: every flag under 3 cm was
# looked at in close-up (builder's arm at his shirt side, a tumbling explorer) and none showed; the strong's side at 7.6 did
info = {}
def kind(i):
    if i not in info:
        j = json.load(open(f'{D}/fresh/{i}.json')); info[i] = (j['name'], j['geo'].get('idx'), (j['material'].get('film') or {}).get('marks', ''))
    return info[i]
rims = {}
def rim(cid, C):
    """Open edges of a garment (cuffs, collars, hems), welded by position so uv seams don't count."""
    if cid not in rims:
        idx = arr(kind(cid)[1], '<u4').astype(np.int64).reshape(-1, 3)
        key = np.round(C / .002).astype(np.int64); _, weld = np.unique(key, axis=0, return_inverse=True); weld = weld.ravel()
        T = weld[idx]; e = np.sort(np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]), 1)
        u, c = np.unique(e, axis=0, return_counts=True); ring = np.unique(u[c == 1])
        first = np.zeros(weld.max() + 1, np.int64); first[weld] = np.arange(len(weld))
        rims[cid] = first[ring]
    return rims[cid]
covered = {}
def arr(s, t='<f4'): return np.frombuffer(base64.b64decode(s), t)
TORSO = [('hips', 'spine1'), ('spine1', 'chest'), ('chest', 'neck')]
def seg(p, a_, b_):
    ab = b_ - a_; t = np.clip(((p - a_) @ ab) / (ab @ ab + 1e-9), 0, 1); return np.linalg.norm(p - (a_ + np.outer(t, ab)), axis=1) if p.ndim == 2 else np.linalg.norm(p - (a_ + t * ab))
def normals(P, idx):
    T = idx.reshape(-1, 3); fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]]); n = np.zeros_like(P)
    for k in range(3): np.add.at(n, T[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
shots = json.load(open(a.timing))['shots'] if a.timing else [{'id': 'all', 't0': a.first / 24, 't1': (a.last + 1) / 24}]
prev = {}; prev_sp = {}; report = {}; first_cov = {}; ctor = {}; cov_j = {}; ref_mesh = {}
files = sorted(glob.glob(f'{D}/frames/*.json'))
files = [f for f in files if a.first <= int(os.path.basename(f)[:-5]) <= a.last]
# each body's reference frame: where its hands are furthest from the torso, so hand skin and torso skin are told apart cleanly
ref = {}
for f in files:
    d = json.load(open(f))
    for sk, B in d['bones'].items():
        B = {k: np.array(v) for k, v in B.items()}
        if not all(k in B for k in ('hips', 'spine1', 'chest', 'neck', 'handL', 'handR')): continue
        gap = min(seg(B[h], B[a_], B[b_]) for h in ('handL', 'handR') for a_, b_ in TORSO)
        if gap > ref.get(sk, (-1,))[0]: ref[sk] = (gap, f)
parts_of = {}
def split(sk, d):
    """In the reference frame: which body vertices are hand, which are torso and thighs."""
    for m in d['meshes']:
        if m.get('skel') == sk and kind(m['id'])[0] == 'skin_body':
            P = arr(m['baked']).reshape(-1, 3); B = {k: np.array(v) for k, v in d['bones'][sk].items()}
            hand = np.zeros(len(P), bool); arm = np.zeros(len(P), bool)
            for s_ in 'LR':
                if f'finger3_2{s_}' in B:
                    hand |= seg(P, B[f'hand{s_}'], B[f'finger3_2{s_}']) < .09  # the thumb tip sits 8-9 cm off the hand's line
                    arm |= (seg(P, B[f'lowerarm{s_}'], B[f'hand{s_}']) < .12) | (seg(P, B[f'hand{s_}'], B[f'finger3_2{s_}']) < .12)
            tor = (np.min(np.stack([seg(P, B[a_], B[b_]) for a_, b_ in TORSO], 1), 1) < .3) & ~arm
            T = arr(kind(m['id'])[1], '<u4').astype(np.int64)
            wrist = np.zeros(len(P), bool)
            for s_ in 'LR':
                if f'hand{s_}' in B: wrist |= np.linalg.norm(P - B[f'hand{s_}'], axis=1) < .10
            parts_of[sk] = (np.flatnonzero(hand), np.flatnonzero(tor), T, np.flatnonzero(hand | wrist))
            for c in d['meshes']:
                if c.get('skel') == sk and kind(c['id'])[0] == 'cloth' and kind(c['id'])[1]:
                    C = arr(c['baked']).reshape(-1, 3); cn = normals(C, arr(kind(c['id'])[1], '<u4').astype(np.int64))
                    dist, j = cKDTree(C).query(P); covered[sk] = (dist < .04) & (np.einsum('ij,ij->i', P - C[j], cn[j]) < -.001); cov_j[sk] = j
                    ref_mesh[sk] = (m['id'], c['id'], P, C)
                    # the clothes over the torso count as its surface too (a sleeve is arm, not torso)
                    carm = np.zeros(len(C), bool)
                    for s_ in 'LR':
                        if f'finger3_2{s_}' in B: carm |= (seg(C, B[f'lowerarm{s_}'], B[f'hand{s_}']) < .14) | (seg(C, B[f'hand{s_}'], B[f'finger3_2{s_}']) < .14)
                    # and only above the hips: a coat skirt is an open sheet, a hand under its hem is not inside anything
                    ax = B['neck'] - B['hips']; up = ((C - B['hips']) @ ax) / (ax @ ax) > .05
                    ctor[sk] = np.flatnonzero((np.min(np.stack([seg(C, B[a_], B[b_]) for a_, b_ in TORSO], 1), 1) < .35) & ~carm & up)
for sk, (_, f) in ref.items(): split(sk, json.load(open(f)))
for f in files:
    n = int(os.path.basename(f)[:-5])
    if n < a.first or n > a.last: continue
    shot = next((s['id'] for s in shots if s['t0'] * 24 <= n < s['t1'] * 24), 'end')
    d = json.load(open(f)); R = report.setdefault(shot, dict(hand=0., poke=0., leap=0., frames=0, worst=''))
    R['frames'] += 1
    by = {}
    for m in d['meshes']:
        if 'baked' in m and 'skel' in m:
            nm = kind(m['id'])[0]; by.setdefault(m['skel'], {})[nm] = (m['id'], arr(m['baked']).reshape(-1, 3))
    for sk, parts in by.items():
        B = {k: np.array(v) for k, v in d['bones'].get(sk, {}).items()}
        if 'skin_body' not in parts or not all(k in B for k in ('hips', 'spine1', 'chest', 'neck')): continue
        body = parts['skin_body'][1]
        if sk in parts_of:  # hand skin behind the torso's surface, from the meshes themselves
            hi, ti, T = parts_of[sk][:3]
            SP, SN, SA = body[ti], normals(body, T)[ti], np.zeros(len(ti))
            if sk in ctor and 'cloth' in parts and kind(parts['cloth'][0])[1] and ref_mesh.get(sk, (0, 0))[1] == parts['cloth'][0]:
                C_ = parts['cloth'][1]; ci = ctor[sk]
                SP = np.concatenate([SP, C_[ci]]); SN = np.concatenate([SN, normals(C_, arr(kind(parts['cloth'][0])[1], '<u4').astype(np.int64))[ci]])
                SA = np.concatenate([SA, np.full(len(ci), .015)])  # cloth is soft: a resting hand presses 1.5 cm into a coat
            if len(hi) and len(SP):
                dist, j = cKDTree(SP).query(body[hi])
                dep = -np.einsum('ij,ij->i', body[hi] - SP[j], SN[j]) - SA[j]; dep[dist > .05] = 0
                pen = float(dep.max()) * 100
                if pen > R['hand']: R['hand'] = pen; w_ = body[hi][dep.argmax()]; R['wh'] = f'{n} hand{"L" if np.linalg.norm(w_ - B["handL"]) < np.linalg.norm(w_ - B["handR"]) else "R"} {kind(parts["skin_body"][0])[2]}'; R['whpos'] = body[hi][dep.argmax()].round(3).tolist()
        if 'cloth' in parts and n % 3 == 0:
            cid, C = parts['cloth']; idx = kind(cid)[1]
            if idx:
                cn = normals(C, arr(idx, '<u4').astype(np.int64))
                # only skin the clothes cover, at rest (the first frame seen) or in the reference frame, never at an opening.
                # Each covered vertex is held to the garment vertex that covered it then: a sleeved wrist resting on a
                # coat's side touches that coat, it does not come through it
                ids = (parts['skin_body'][0], cid)
                if sk not in first_cov:
                    first_cov[sk] = ids
                    dist, j = cKDTree(C).query(body); o0 = np.einsum('ij,ij->i', body - C[j], cn[j]); cov0 = (dist < .04) & (o0 < -.001)
                    rm = ref_mesh.get(sk)
                    if rm and rm[:2] == ids:
                        # each skin vertex keeps the garment vertex that stays closest to it at rest and in the reference
                        # frame: the sleeve over a wrist, never the coat side the wrist hung against
                        dd, kk = cKDTree(C).query(body, k=8)
                        worst = np.maximum(dd, np.linalg.norm(rm[2][:, None, :] - rm[3][kk], axis=2))
                        pick = kk[np.arange(len(kk)), worst.argmin(1)]
                        cov_j[sk] = np.where(cov0, pick, np.where(covered[sk], cov_j[sk], pick)); covered[sk] = covered[sk] | cov0
                    else: covered[sk], cov_j[sk] = cov0, j
                if first_cov[sk] == ids:  # not on a level-of-detail switch (far away, a few pixels): other vertices
                    j = cov_j[sk]; o_ = np.einsum('ij,ij->i', body - C[j], cn[j])
                    rd = cKDTree(C[rim(cid, C)]).query(C[j])[0] if len(rim(cid, C)) else np.full(len(j), 9.)
                    # a skin vertex and its garment vertex that have come 10 cm apart are no longer one place: skip them
                    m_ = covered[sk] & (rd > .035) & (np.linalg.norm(body - C[j], axis=1) < .10)
                    if sk in parts_of: m_[parts_of[sk][3]] = False  # hands and wrists: a loose cuff and a hand resting on a bag or coat is contact
                    if m_.any() and o_[m_].max() * 100 > R['poke']: R['poke'] = float(o_[m_].max() * 100); R['wp'] = f'frame {n} {kind(parts["skin_body"][0])[2]}'; R['wpos'] = body[m_][o_[m_].argmax()].round(3).tolist(); R['wcl'] = (C[j[m_][o_[m_].argmax()]]).round(3).tolist()
        for nm, (mid, P) in parts.items():
            q = prev.get(mid)
            if q is not None and q[0] == n - 1 and len(q[1]) == len(P):
                sp = np.linalg.norm(P - q[1], axis=1); p99 = np.percentile(sp, 99) * 100
                # a pop starts from nothing: a vertex already moving fast (a flailing hand) is motion, not a glitch
                ps = prev_sp.get(mid); prev_sp[mid] = sp
                mx = float((sp * (sp > 2.5 * np.maximum(ps, .01))).max() * 100) if ps is not None and len(ps) == len(sp) else 0.
                if mx > LEAP and mx > 3 * p99 and mx > R['leap']: R['leap'] = float(mx); R['wl'] = f'frame {n} {nm}'
            prev[mid] = (n, P)
bad = 0
for s, R in report.items():
    ok = R['hand'] <= HAND and R['poke'] <= POKE and R['leap'] == 0
    bad += not ok
    if os.environ.get('WHERE') and 'wpos' in R: print('   poke at', R['wpos'], 'cloth', R['wcl'])
    if os.environ.get('WHERE') and 'whpos' in R: print('   hand at', R['whpos'])
    print(f"{s:5} frames {R['frames']:4}  hand {R['hand']:5.1f} cm {R.get('wh', ''):22}  through cloth {R['poke']:5.1f} cm {R.get('wp', ''):12}  leap {R['leap']:5.1f} cm {R.get('wl', ''):24} {'ok' if ok else 'FAIL'}")
sys.exit(1 if bad else 0)
