#!/usr/bin/env python3
"""Re-encode the dubbing in public/audio/vo/<lang>/ from MP3 to Opus in Ogg (28 kb/s mono), which is how
generate_voice.py now writes it: about half the size for the same speech. Durations in index.json are re-read.

Run: python3 tools/tts/to_opus.py
"""
import json
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
FFMPEG = shutil.which('ffmpeg') or str(Path.home() / '.local' / 'bin' / 'ffmpeg')


def conv(f: Path):
    dst = f.with_suffix('.ogg')
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(f), '-ac', '1', '-c:a', 'libopus', '-b:a', '28k',
                    '-application', 'audio', '-map_metadata', '-1', str(dst)], check=True)
    f.unlink()


def main():
    for d in sorted((ROOT / 'public' / 'audio' / 'vo').iterdir()):
        if not d.is_dir():
            continue
        files = sorted(d.glob('*.mp3'))
        before = sum(f.stat().st_size for f in files)
        with ThreadPoolExecutor(6) as ex:
            list(ex.map(conv, files))
        after = sum(f.stat().st_size for f in d.glob('*.ogg'))
        print(d.name, len(files), f'{before // 1024} KiB -> {after // 1024} KiB')


if __name__ == '__main__':
    main()
