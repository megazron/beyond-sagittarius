#!/usr/bin/env python3
"""Does the speech fit the action? Reports, per scene: lines that outlast their shot or the next cue,
paragraph reads (long lines with no real pause inside), and how long the gaps between lines are.

  python tools/line_timing.py [--lang en]

Durations come from the voice index, pauses from the audio itself (silence over 0.22 s inside a clip)."""
import argparse, json, pathlib, re, subprocess
ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser(); ap.add_argument('--lang', default='en'); ap.add_argument('--json', default='')
a = ap.parse_args()
VO = ROOT / 'public/audio/vo' / a.lang
idx = {k: v for k, v in json.load(open(VO / 'index.json')).items() if isinstance(v, (int, float))}
CACHE = ROOT / 'tools/.line_pauses.json'
pauses = json.load(open(CACHE)) if CACHE.exists() else {}


def inner_pauses(key):
    if key in pauses: return pauses[key]
    f = next(iter(VO.glob(f'{key}.*')), None)
    if not f: return None
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(f), '-af', 'silencedetect=noise=-32dB:d=0.22', '-f', 'null', '-'], capture_output=True, text=True).stderr
    st = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', r)]; en = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', r)]
    dur = idx.get(key, 0); n = sum(1 for s, e in zip(st, en) if s > .12 and e < dur - .12)
    pauses[key] = n
    return n


def scenes():
    """Beat lists: which keys, in which function, with their `after` gap."""
    for file in ('src/cinematic/scenes.ts', 'src/game/story.ts'):
        name = None
        for line in (ROOT / file).read_text().splitlines():
            m = re.match(r'\s*(?:export function |private |async )?(\w+)\([^)]*\)[^;]*\{\s*$', line)
            if m and m.group(1) not in ('if', 'for', 'while', 'switch'): name = m.group(1)
            m = re.search(r"\{ key: '([\w.~]+)', who: '(\w+)'", line)
            if m:
                g = re.search(r'after: ([\d.]+)', line)
                yield name or file, m.group(1), m.group(2), float(g.group(1)) if g else .28, 'beat'


def cine():
    """Timed cues. The clock holds at a voiced cue until the last line ends, so a long line doesn't overrun
    the next cue: the picture freezes instead. Both are reported: seconds frozen, and seconds past the shot."""
    src = (ROOT / 'src/cinematic/cinematic.ts').read_text()
    cues = sorted((float(t), k) for t, k in re.findall(r"vcue\(([\d.]+), '([\w.]+)'", src))
    shots = [(float(s), float(e)) for s, e in re.findall(r'start: ([\d.]+), end: ([\d.]+)', src)]
    out = []
    for i, (t, k) in enumerate(cues):
        d = idx.get(k)
        if d is None: out.append(('cine', k, None, 0, 0)); continue
        nxt = cues[i + 1][0] if i + 1 < len(cues) else 1e9
        frozen = max(0, t + d + .15 - nxt)
        sh = next(((s, e) for s, e in shots if s <= t < e), None)
        past = max(0, min(t + d, nxt) - sh[1]) if sh else 0
        out.append(('cine', k, d, round(frozen, 2), round(past, 2)))
    return out


rows = list(scenes()); longs = []; byscene = {}
for sc, k, who, after, _ in rows:
    d = idx.get(k)
    s = byscene.setdefault(sc, dict(lines=0, seconds=0.0, long=0, nopause=0, noaudio=0))
    s['lines'] += 1
    if d is None: s['noaudio'] += 1; continue
    s['seconds'] += d
    p = inner_pauses(k)
    if d > 4.5: s['long'] += 1
    if d > 3 and not p: s['nopause'] += 1; longs.append((d, k, who))
CACHE.write_text(json.dumps(pauses))
print(f"{'scene':26}{'lines':>6}{'sec':>7}{'>4.5s':>7}{'3s+ no pause':>14}{'no audio':>10}")
for sc, s in sorted(byscene.items(), key=lambda x: -x[1]['seconds']):
    print(f"{sc[:25]:26}{s['lines']:>6}{s['seconds']:>7.1f}{s['long']:>7}{s['nopause']:>14}{s['noaudio']:>10}")
T = {k: sum(s[k] for s in byscene.values()) for k in ('lines', 'long', 'nopause', 'noaudio')}
print('total', T)
print('\ntimed opening (cine):')
R = cine()
for r in R:
    if r[3] or r[4]: print(f'  {r[1]:14} {r[2]:.1f} s  picture frozen {r[3]} s  past its shot {r[4]} s')
print('lines that freeze the picture:', sum(1 for r in R if r[3]), 'for', round(sum(r[3] for r in R), 1), 's; lines past their shot:', sum(1 for r in R if r[4]))
print('\nworst paragraph reads:'); [print(f'  {d:.1f} s {k} ({w})') for d, k, w in sorted(longs, reverse=True)[:10]]
