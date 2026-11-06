#!/usr/bin/env python3
"""Index recorded takes in public/audio/voice/override/<lang>/<key>.{ogg,mp3,m4a}.

Writes public/audio/voice/override/index.json:
    {"en": {"op.1": {"d": 2.41, "f": ["ogg", "m4a"]}}}
d = duration in seconds (the game times scenes from it), f = formats on disk.
Needs ffmpeg, so CI (which has none) keeps the committed index: run this, or
npm run build, locally and commit the result along with the takes.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DIR = ROOT / 'public' / 'audio' / 'voice' / 'override'
EXTS = ('ogg', 'mp3', 'm4a')


def duration(ffmpeg: str, f: Path) -> float:
    """Decode the file and read the final timestamp (exact, even without a header duration)."""
    r = subprocess.run([ffmpeg, '-hide_banner', '-nostdin', '-i', str(f), '-f', 'null', '-'],
                       capture_output=True, text=True)
    stamps = re.findall(r'time=(\d+):(\d+):(\d+\.\d+)', r.stderr)
    if r.returncode or not stamps:
        raise SystemExit(f'voice_overrides: cannot read {f}')
    h, m, s = stamps[-1]
    return round(int(h) * 3600 + int(m) * 60 + float(s), 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', type=Path, default=DIR)
    root = ap.parse_args().dir
    ffmpeg = shutil.which('ffmpeg') or str(Path.home() / '.local' / 'bin' / 'ffmpeg')
    if not Path(ffmpeg).exists():
        print('voice_overrides: no ffmpeg, keeping the committed index', file=sys.stderr)
        return
    index = {}
    for d in sorted(p for p in root.iterdir() if p.is_dir()) if root.exists() else []:
        takes = {}
        for f in sorted(d.iterdir()):
            ext = f.suffix[1:].lower()
            if ext not in EXTS:
                continue
            t = takes.setdefault(f.stem, {'d': duration(ffmpeg, f), 'f': []})
            t['f'].append(ext)
        if takes:
            index[d.name] = takes
    root.mkdir(parents=True, exist_ok=True)
    (root / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=0, sort_keys=True) + '\n', encoding='utf-8')
    print(f'voice_overrides: {sum(len(v) for v in index.values())} takes', file=sys.stderr)


if __name__ == '__main__':
    main()
