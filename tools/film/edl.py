#!/usr/bin/env python3
"""Cuts the picture to the dialogue: shot lengths come from the voice takes, never the other way round.
A line reacts first (its `react` gap), each phrase is followed by its written pause, and a shot ends only
after its last word plus a hold. Fails loudly if any phrase would outlast its shot.

  python tools/film/edl.py tools/film/entry.json ~/bs-film/vo/entry out_timing.json"""
import json, os, sys
scene, vo, out = sys.argv[1], os.path.expanduser(sys.argv[2]), sys.argv[3]
d = json.load(open(scene)); T = json.load(open(f'{vo}/takes.json'))
t = 0.0; shots = []; lines = []; HOLD = .55; bad = 0
for s in d['shots']:
    cur = t; ln = []
    for li, l in enumerate(s['lines']):
        cur += l.get('react', 0)
        for pi, (ph, gap) in enumerate(l['phrases']):
            k = T[f"{s['id']}.{li}.{pi}"]
            ln.append(dict(key=f"{s['id']}.{li}.{pi}", who=l['who'], t0=round(cur, 3), t1=round(cur + k['sec'], 3), text=ph, emotion=l.get('emotion', 'calm'), k=l.get('k', 1)))
            cur += k['sec'] + gap
    end = max(t + s['min'], cur + (HOLD if s['lines'] else 0))
    shots.append(dict(id=s['id'], act=s['act'], t0=round(t, 3), t1=round(end, 3), action=s['action']))
    if ln and ln[-1]['t1'] > end: bad += 1
    lines += ln; t = end
json.dump(dict(length=round(t, 2), shots=shots, lines=lines), open(out, 'w'), indent=0)
print(f'length {t:.1f} s, {len(shots)} shots, {len(lines)} phrases, lines past their shot: {bad}')
gaps = [b['t0'] - a['t1'] for a, b in zip(lines, lines[1:]) if a['key'][:2] == b['key'][:2]]
print('phrase gaps inside a shot: min %.2f max %.2f' % (min(gaps), max(gaps)) if gaps else 'no gaps')
sys.exit(1 if bad else 0)
