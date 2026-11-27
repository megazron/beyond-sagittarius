#!/usr/bin/env python3
"""The cheat menu's checkpoints (src/cheat/cheat.ts): made by an automated playthrough, sealed like the story data.

A checkpoint is the save the game itself would write at that point of a real playthrough (game.ts snapshot(), the
save Continue takes up): levels_smoke.py plays levels 1 to 21 through the real interaction code with ?cheatrec=1, and
main.ts's recorder keeps one at the start of each level, at each change of objective, and just before each scene,
decision, fight, away stage and Vault or memory film, and the last one of each level ("results"). The file is sealed
(tools/story_seal.py's format) because the saves carry the story's flags and the decisions log.

  python3 tools/cheat_snapshots.py make [--quality web]   build must exist (dist/): play it and seal the result
  python3 tools/cheat_snapshots.py seal IN.json           seal a recorded file (levels_smoke.py --snapshots IN.json)
  python3 tools/cheat_snapshots.py open OUT.json          the plain data (keep it outside the repo)
  python3 tools/cheat_snapshots.py check                  it decodes, every level 1 to 21 has a start, ids are unique
  python3 tools/cheat_snapshots.py list                   the checkpoint ids, a line per level

The player's name and look are taken out (a jump plays the default Zenvik); the sha it was made from is kept.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import story_seal  # noqa: E402

SEALED = ROOT / 'src/cheat/snapshots.sealed'
LEVELS = range(1, 22)


def clean(rec: dict) -> dict:
    for s in rec['saves']:
        s.pop('player', None)
        s['names'] = {}
        s['savedAt'] = 0
    sha = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    return {'v': 1, 'made': sha, 'saves': rec['saves'], 'points': rec['points']}


def problems(d: dict) -> list[str]:
    out = []
    ids = [p['id'] for p in d['points']]
    if len(ids) != len(set(ids)):
        out.append('checkpoint ids are not unique')
    for n in LEVELS:
        if f'L{n}.start' not in ids:
            out.append(f'level {n} has no start')
    for p in d['points']:
        if not 0 <= p['save'] < len(d['saves']):
            out.append(f"{p['id']}: no save {p['save']}")
        elif d['saves'][p['save']]['level'] != p['level'] and p['kind'] != 'results':
            out.append(f"{p['id']}: its save is at level {d['saves'][p['save']]['level']}")
    return out


def load() -> dict:
    return story_seal.unseal(SEALED.read_text())


def main():
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == 'make':
        q = a[a.index('--quality') + 1] if '--quality' in a else 'web'
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / 'rec.json'
            r = subprocess.run([sys.executable, str(ROOT / 'tools/levels_smoke.py'), '--quality', q, '--shots', td, '--snapshots', str(out)], cwd=ROOT)
            if not out.exists():
                sys.exit(f'cheat_snapshots: the playthrough wrote no checkpoints (exit {r.returncode})')
            rec = json.loads(out.read_text())
        d = clean(rec)
    elif a[0] == 'seal':
        d = clean(json.loads(Path(a[1]).read_text()))
    elif a[0] == 'open':
        Path(a[1]).write_text(json.dumps(load(), indent=1, ensure_ascii=False))
        return
    elif a[0] in ('check', 'list'):
        d = load()
        if a[0] == 'list':
            for n in LEVELS:
                print(f'L{n}:', ' '.join(p['id'].split('.', 1)[1] for p in d['points'] if p['level'] == n))
        bad = problems(d)
        print(f"cheat_snapshots: {len(d['points'])} checkpoints, {len(d['saves'])} saves, made from {d.get('made')}")
        if bad:
            sys.exit('cheat_snapshots: ' + '; '.join(bad))
        return
    else:
        sys.exit(__doc__)
    bad = problems(d)
    SEALED.write_text(story_seal.seal(d))
    print(f"cheat_snapshots: sealed {len(d['points'])} checkpoints ({len(d['saves'])} saves, {SEALED.stat().st_size // 1024} KB) into {SEALED.relative_to(ROOT)}")
    if bad:
        sys.exit('cheat_snapshots: ' + '; '.join(bad))


if __name__ == '__main__':
    main()
