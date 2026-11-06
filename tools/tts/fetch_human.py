#!/usr/bin/env python3
"""Cut the human sound effects in public/audio/sfx/human/ from CC0 Freesound recordings.

SOURCES lists each recording with the takes cut from it, as seconds (start, end).
Each licence was read from the sound's own Freesound page. The audio is Freesound's
public high-quality preview. Skips files that exist. Writes index.json (name -> files).

Run: python3 tools/tts/fetch_human.py <directory for the downloads>
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / 'public' / 'audio' / 'sfx' / 'human'
FFMPEG = shutil.which('ffmpeg') or str(Path.home() / '.local' / 'bin' / 'ffmpeg')
# Freesound id, author, {sound: [(start, end), ...]}
SOURCES = [
    (434550, 'TheCurlyOne', {'gasp': [(0, 0.47)]}),
    (489917, 'falcospizaetus', {'gasp': [(0.6, 0.98), (3.06, 3.5)]}),
    (803168, 'salemaudio', {'grunt': [(0, 0.5), (1.6, 1.95)], 'land': [(4.2, 4.58), (7.3, 7.7), (8.6, 9.05)]}),
    (667697, 'EvilOldScratch', {'grunt': [(0, 0.75)]}),
    (327838, 'milnersouza', {'yelp': [(1.35, 1.92), (3.72, 4.3), (5.7, 6.46)]}),
    (745726, 'JD_Brick_Productions', {'scream': [(1.5, 2.38), (2.88, 3.7), (4.32, 5.95)]}),
    (698876, 'filippys', {'scream': [(0.38, 2.9)]}),
    (547906, 'abrmy', {'breath': [(0, 3.4)]}),
    (808406, 'crackedlilith', {'breath': [(1.42, 3.04)]}),
    (683654, 'B.Harkins', {'laugh': [(0, 1.98), (3.05, 3.85)]}),
    (678668, 'mglennsound', {'laugh': [(0, 1.05)]}),
    (867051, 'IENBA', {'crowd': [(0.5, 6.5)]}),
    (763993, 'ShangusBurger', {'crowd': [(0.95, 2.7)]}),
]


def main():
    raw = Path(sys.argv[1])
    cand = {int(c['id']): c for c in json.loads((raw / 'candidates.json').read_text())}
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    for sid, author, cuts in SOURCES:
        c = cand[sid]
        assert c['author'] == author and c['licence'] == ['creativecommons.org/publicdomain/zero/1.0'], c
        src = raw / f"{c['cat']}_{sid}.mp3"
        for name, spans in cuts.items():
            for a, b in spans:
                n = len(index.setdefault(name, [])) + 1
                f = f'{name}_{n}.mp3'
                index[name].append(f)
                if (OUT / f).exists():
                    continue
                fade = max(0.02, min(0.08, (b - a) / 6))
                subprocess.run([FFMPEG, '-hide_banner', '-nostdin', '-v', 'error', '-y', '-ss', str(a), '-to', str(b), '-i', str(src),
                                '-af', f'afade=t=in:d=0.01,afade=t=out:st={b - a - fade}:d={fade},loudnorm=I=-20:TP=-2:LRA=11',
                                '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1', str(OUT / f)], check=True)
    (OUT / 'index.json').write_text(json.dumps(index, indent=0) + '\n')
    print({k: len(v) for k, v in index.items()}, sum(f.stat().st_size for f in OUT.glob('*.mp3')) // 1024, 'KiB')


if __name__ == '__main__':
    main()
