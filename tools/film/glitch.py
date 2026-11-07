#!/usr/bin/env python3
"""Finds what 1-second samples miss, on every frame of a dump: camera snaps, objects that pop in or out
mid-shot, transforms and vertices that jump. Cuts are expected, so jumps are judged against the shot's own motion.
  python tools/film/glitch.py ~/bs-film/dump [first] [last]"""
import base64, glob, json, os, sys
import numpy as np
D = os.path.expanduser(sys.argv[1]); a = int(sys.argv[2]) if len(sys.argv) > 2 else 0; b = int(sys.argv[3]) if len(sys.argv) > 3 else 10 ** 6
files = [f for f in sorted(glob.glob(f'{D}/frames/*.json')) if a <= int(os.path.basename(f)[:-5]) <= b]
prev = None; rows = []; out = []
names = {}
def nm(i):
    if i not in names:
        try: j = json.load(open(f'{D}/fresh/{i}.json')); names[i] = f"{j['name'] or j['parent'] or i[:6]}({(j['material'].get('film') or {}).get('kind', j['material']['type'][:8])})"
        except Exception: names[i] = i[:6]
    return names[i]
for f in files:
    d = json.load(open(f)); n = int(os.path.basename(f)[:-5])
    m = np.array(d['camera']['m']).reshape(4, 4).T
    cur = {'n': n, 'beat': d['beat'], 'p': m[:3, 3], 'R': m[:3, :3], 'fov': d['camera']['fov'], 'o': {}, 'v': {}}
    for r in d['meshes']:
        if r.get('points'): continue
        cur['o'][r['id']] = np.array(r['m']).reshape(4, 4).T[:3, 3]
        if 'baked' in r: cur['v'][r['id']] = np.frombuffer(base64.b64decode(r['baked']), '<f4').reshape(-1, 3)
    if prev and n == prev['n'] + 1:
        dp = np.linalg.norm(cur['p'] - prev['p'])
        tr = np.clip((np.trace(cur['R'] @ prev['R'].T) - 1) / 2, -1, 1); da = np.degrees(np.arccos(tr))
        same = len(set(cur['o']) & set(prev['o'])) / max(1, len(set(cur['o']) | set(prev['o'])))
        gone = [nm(i) for i in prev['o'] if i not in cur['o']]; new = [nm(i) for i in cur['o'] if i not in prev['o']]
        vj = 0; who = ''
        for i, v in cur['v'].items():
            if i in prev['v'] and len(prev['v'][i]) == len(v):
                x = np.linalg.norm(v - prev['v'][i], axis=1); e = float(np.percentile(x, 99.5) - np.median(x))  # stretching: parts of one mesh moving apart
                if e > vj: vj, who = e, nm(i)
        rows.append((n, cur['beat'], dp, da, same, len(gone), len(new), vj, who))
        if 0 < len(gone) + len(new) and same > .6: out.append(f"f{n} b{cur['beat']:.2f} POP gone {gone[:4]} new {new[:4]}")
    prev = cur
R = rows; dp = np.array([r[2] for r in R]); da = np.array([r[3] for r in R]); sm = np.array([r[4] for r in R])
cut = (sm < .6) | (dp > 3) | (da > 25)
print('frames', len(R), 'hard cuts', int(cut.sum()), [round(R[i][1], 1) for i in np.nonzero(cut)[0]][:60])
for i, r in enumerate(R):
    if cut[i] or i < 3 or i >= len(R) - 3: continue
    lo, hi = max(0, i - 6), min(len(R), i + 7); seg = [j for j in range(lo, hi) if j != i and not cut[j]]
    if len(seg) < 4: continue
    if r[2] > 4 * np.median(dp[seg]) + .02: out.append(f"f{r[0]} b{r[1]:.2f} CAM SNAP {r[2]:.3f} m (around {np.median(dp[seg]):.3f})")
    if r[3] > 4 * np.median(da[seg]) + 1.0: out.append(f"f{r[0]} b{r[1]:.2f} CAM TURN {r[3]:.2f} deg (around {np.median(da[seg]):.2f})")
    vs = np.array([R[j][7] for j in seg])
    if r[7] > .08 and r[7] > 1.9 * np.median(vs): out.append(f"f{r[0]} b{r[1]:.2f} VERT SPIKE {r[7]:.3f} m (around {np.median(vs):.3f}) {r[8]}")
print(len(out), 'flags'); print('\n'.join(sorted(out, key=lambda s: int(s[1:s.index(' ')]))[:90]))
