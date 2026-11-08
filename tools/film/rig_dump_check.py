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
D = os.path.expanduser(a.dump); HAND, POKE, LEAP = 1.0, 3.0, 6.0  # hand: cm of hand skin behind the body's surface. Cloth: every flag under 3 cm was
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
prev = {}; prev_sp = {}; report = {}
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
                    hand |= seg(P, B[f'hand{s_}'], B[f'finger3_2{s_}']) < .07
                    arm |= (seg(P, B[f'lowerarm{s_}'], B[f'hand{s_}']) < .12) | (seg(P, B[f'hand{s_}'], B[f'finger3_2{s_}']) < .12)
            tor = (np.min(np.stack([seg(P, B[a_], B[b_]) for a_, b_ in TORSO], 1), 1) < .3) & ~arm
            T = arr(kind(m['id'])[1], '<u4').astype(np.int64)
            parts_of[sk] = (np.flatnonzero(hand), np.flatnonzero(tor), T)
            for c in d['meshes']:
                if c.get('skel') == sk and kind(c['id'])[0] == 'cloth' and kind(c['id'])[1]:
                    C = arr(c['baked']).reshape(-1, 3); cn = normals(C, arr(kind(c['id'])[1], '<u4').astype(np.int64))
                    dist, j = cKDTree(C).query(P); covered[sk] = (dist < .04) & (np.einsum('ij,ij->i', P - C[j], cn[j]) < -.001)
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
            hi, ti, T = parts_of[sk]
            if len(hi) and len(ti):
                tn = normals(body, T)[ti]; dist, j = cKDTree(body[ti]).query(body[hi])
                dep = -np.einsum('ij,ij->i', body[hi] - body[ti][j], tn[j]); dep[dist > .05] = 0
                pen = float(dep.max()) * 100
                if pen > R['hand']: R['hand'] = pen; w_ = body[hi][dep.argmax()]; R['wh'] = f'{n} hand{"L" if np.linalg.norm(w_ - B["handL"]) < np.linalg.norm(w_ - B["handR"]) else "R"} {kind(parts["skin_body"][0])[2]}'; R['whpos'] = body[hi][dep.argmax()].round(3).tolist()
        if 'cloth' in parts and n % 3 == 0:
            cid, C = parts['cloth']; idx = kind(cid)[1]
            if idx:
                cn = normals(C, arr(idx, '<u4').astype(np.int64)); dist, j = cKDTree(C).query(body)
                o_ = np.einsum('ij,ij->i', body - C[j], cn[j])
                # only skin the clothes covered in the reference frame, and never at an opening
                if sk not in covered: covered[sk] = (dist < .04) & (o_ < -.001)
                rd = cKDTree(C[rim(cid, C)]).query(C[j])[0] if len(rim(cid, C)) else np.full(len(j), 9.)
                m_ = covered[sk] & (rd > .035)
                if sk in parts_of: m_[parts_of[sk][0]] = False  # hands are never under a garment: a hand beside a coat is not skin through it
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
