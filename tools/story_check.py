#!/usr/bin/env python3
"""Checks Episode One's story data (src/game/branch/episode1.sealed, through tools/story_seal.py) for logic holes.

  - every flag a scene reads, or a condition tests, is set by an earlier scene
  - nobody plays a scene on a path where they are already dead
  - every death needs at least two things the player could see coming (MECHANICS_NOTES rule 7)
  - every decision has its fallback among its options (silence is an answer)
  - plays the episode many times with random choices and prints how often each ending state comes up

Exit 1 on any problem. Usage: python3 tools/story_check.py [--runs N]
"""
import argparse
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from story_seal import load  # noqa: E402

DATA = load()
SCENES = DATA['scenes']


def flags_in(c, out):
    if not c:
        return out
    if 'flag' in c:
        out.add(c['flag'])
    for k in ('all', 'any'):
        for x in c.get(k, []):
            flags_in(x, out)
    if 'not' in c:
        flags_in(c['not'], out)
    return out


def test(c, s):
    if not c:
        return True
    if 'flag' in c:
        return c['flag'] in s['flags']
    if 'all' in c:
        return all(test(x, s) for x in c['all'])
    if 'any' in c:
        return any(test(x, s) for x in c['any'])
    if 'not' in c:
        return not test(c['not'], s)
    if 'dead' in c:
        return c['dead'] in s['dead']
    if 'alive' in c:
        return c['alive'] not in s['dead']
    raise ValueError(c)


def apply(effects, s):
    for e in effects:
        if 'flag' in e:
            s['flags'].add(e['flag'])
        elif 'trust' in e:
            k = (e['trust'], e.get('to', 'scientist'))
            s['trust'][k] = s['trust'].get(k, 0) + e['by']


def static_checks():
    problems = []
    seen_ids = set()
    set_so_far = set()
    for sc in SCENES:
        reads = set(sc.get('reads', []))
        flags_in(sc.get('requires'), reads)
        for d in sc.get('decisions', []):
            flags_in(d.get('if'), reads)
            ids = [o['id'] for o in d['options']]
            if d.get('fallback') not in ids:
                problems.append(f"{sc['id']} {d['id']}: fallback {d.get('fallback')!r} is not an option")
            if d['id'] in seen_ids:
                problems.append(f"{d['id']}: id used twice")
            seen_ids.add(d['id'])
        for q in sc.get('qtes', []):
            flags_in(q.get('if'), reads)
            if q['id'] in seen_ids:
                problems.append(f"{q['id']}: id used twice")
            seen_ids.add(q['id'])
        # flags set inside this scene may be read by its own later moments and deaths
        own = set()
        for d in sc.get('decisions', []):
            for o in d['options']:
                own |= {e['flag'] for e in o['effects'] if 'flag' in e}
        for q in sc.get('qtes', []):
            own |= {e['flag'] for e in q['pass'] + q['fail'] if 'flag' in e}
        for missing in sorted(reads - set_so_far - own):
            problems.append(f"{sc['id']}: reads {missing!r}, which no earlier scene sets")
        for dth in sc.get('deaths', []):
            for missing in sorted(flags_in(dth['if'], set()) - set_so_far - own):
                problems.append(f"{sc['id']}: death of {dth['kill']} tests {missing!r}, which nothing sets")
            if len(dth.get('seen', [])) < 2:
                problems.append(f"{sc['id']}: death of {dth['kill']} has fewer than two things the player could see coming")
        set_so_far |= own
    return problems


def play(rng):
    s = {'flags': set(), 'trust': {}, 'dead': set()}
    problems = []
    for sc in SCENES:
        if sc.get('requires') and not test(sc['requires'], s):
            continue
        players = [sc['as']] + sc.get('also', []) if sc.get('as') else []
        for p in players:
            if p in s['dead']:
                problems.append(f"{sc['id']}: played as {p}, who is dead on this path")
        for d in sc.get('decisions', []):
            if d.get('if') and not test(d['if'], s):
                continue
            if d.get('as') and d['as'] in s['dead']:
                problems.append(f"{d['id']}: decided by {d['as']}, who is dead")
            o = rng.choice(d['options'])
            apply(o['effects'], s)
        for q in sc.get('qtes', []):
            if q.get('if') and not test(q['if'], s):
                continue
            apply(q['pass'] if rng.random() < 0.6 else q['fail'], s)
        for dth in sc.get('deaths', []):
            if dth['kill'] not in s['dead'] and test(dth['if'], s):
                s['dead'].add(dth['kill'])
    return s, problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--runs', type=int, default=20000)
    a = ap.parse_args()
    problems = static_checks()
    rng = random.Random(7)
    states = {}
    for _ in range(a.runs):
        s, p = play(rng)
        problems += [x for x in p if x not in problems]
        alive = 6 - len(s['dead'])
        key = {6: 'Six lights', 5: 'Five', 4: 'Four', 3: 'Three'}.get(alive, f'{alive}?')
        states[key] = states.get(key, 0) + 1
    n_dec = sum(len(sc.get('decisions', [])) for sc in SCENES)
    n_qte = sum(len(sc.get('qtes', [])) for sc in SCENES)
    n_lines = sum(sc.get('lines', 0) for sc in SCENES)
    print(f"scenes {len(SCENES)}, decisions {n_dec}, tension moments {n_qte}, deaths {sum(len(sc.get('deaths', [])) for sc in SCENES)}, lines planned {n_lines}")
    print('ending states over', a.runs, 'random plays:', ', '.join(f"{k} {100 * v / a.runs:.1f}%" for k, v in sorted(states.items(), key=lambda kv: -kv[1])))
    for sc in SCENES:
        for d in sc.get('deaths', []):
            if d.get('pending'):
                print(f"note: {sc['id']} death of {d['kill']} is provisional: {d['pending']}")
    for p in problems:
        print('PROBLEM:', p)
    print('story_check:', 'ok' if not problems else f'{len(problems)} problems')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
