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
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / 'public' / 'audio' / 'sfx' / 'human'
FFMPEG = shutil.which('ffmpeg') or str(Path.home() / '.local' / 'bin' / 'ffmpeg')
# Freesound id, author, preview URL, {sound: [(start, end), ...]}
SOURCES = [
    (434550, 'TheCurlyOne', 'https://cdn.freesound.org/previews/434/434550_8482864-hq.mp3', {'gasp': [(0, 0.47)]}),
    (489917, 'falcospizaetus', 'https://cdn.freesound.org/previews/489/489917_10570192-hq.mp3', {'gasp': [(0.6, 0.98), (3.06, 3.5)]}),
    (803168, 'salemaudio', 'https://cdn.freesound.org/previews/803/803168_17274093-hq.mp3', {'grunt': [(0, 0.5), (1.6, 1.95)], 'land': [(4.2, 4.58), (7.3, 7.7), (8.6, 9.05)]}),
    (667697, 'EvilOldScratch', 'https://cdn.freesound.org/previews/667/667697_14597423-hq.mp3', {'grunt': [(0, 0.75)]}),
    (327838, 'milnersouza', 'https://cdn.freesound.org/previews/327/327838_2314212-hq.mp3', {'yelp': [(1.35, 1.92), (3.72, 4.3), (5.7, 6.46)]}),
    (745726, 'JD_Brick_Productions', 'https://cdn.freesound.org/previews/745/745726_6832358-hq.mp3', {'scream': [(1.5, 2.38), (2.88, 3.7), (4.32, 5.95)]}),
    (698876, 'filippys', 'https://cdn.freesound.org/previews/698/698876_14267594-hq.mp3', {'scream': [(0.38, 2.9)]}),
    (547906, 'abrmy', 'https://cdn.freesound.org/previews/547/547906_4920550-hq.mp3', {'breath': [(0, 3.4)]}),
    (808406, 'crackedlilith', 'https://cdn.freesound.org/previews/808/808406_17284634-hq.mp3', {'breath': [(1.42, 3.04)]}),
    (683654, 'B.Harkins', 'https://cdn.freesound.org/previews/683/683654_14665352-hq.mp3', {'laugh': [(0, 1.98), (3.05, 3.85)]}),
    (678668, 'mglennsound', 'https://cdn.freesound.org/previews/678/678668_14787385-hq.mp3', {'laugh': [(0, 1.05)]}),
    (867051, 'IENBA', 'https://cdn.freesound.org/previews/867/867051_9616576-hq.mp3', {'crowd': [(0.5, 6.5)]}),
    (763993, 'ShangusBurger', 'https://cdn.freesound.org/previews/763/763993_11744683-hq.mp3', {'crowd': [(0.95, 2.7)]}),
]


def main():
    raw = Path(sys.argv[1])
    raw.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    for sid, author, url, cuts in SOURCES:
        src = raw / f'{sid}.mp3'
        if not src.exists():
            urllib.request.urlretrieve(url, src)
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
