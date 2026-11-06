#!/usr/bin/env python3
"""Fill missing lines with the fast Kokoro voices so no spoken line is ever silent.

Renders with tools/tts/kokoro/generate_voice.py into a temp folder, then copies
only the keys public/audio/vo lacks and updates each index.json. Takes from the
main voice render are never replaced. Run lipsync.py afterwards.

Run: .venv-tts/bin/python tools/tts/fill_gaps.py [--out-tmp DIR]
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
VO = ROOT / 'public' / 'audio' / 'vo'


def main():
    lines = json.loads((ROOT / 'src/i18n/voice.json').read_text())['lines']
    tmp = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(tempfile.mkdtemp())
    for lang in ('en', 'hi', 'ur'):
        idx = json.loads((VO / lang / 'index.json').read_text())
        missing = [k for k in lines if k not in idx]
        if not missing:
            print(lang, 'complete')
            continue
        print(lang, 'rendering', len(missing), flush=True)
        args = [sys.executable, str(ROOT / 'tools/tts/kokoro/generate_voice.py'), '--lang', lang, '--out', str(tmp)]
        for k in missing:
            args += ['--only', k]
        subprocess.run(args, check=True)
        new = json.loads((tmp / lang / 'index.json').read_text())
        for k, dur in new.items():
            if k not in idx:
                shutil.copy(tmp / lang / f'{k}.mp3', VO / lang / f'{k}.mp3')
                idx[k] = dur
        (VO / lang / 'index.json').write_text(json.dumps(idx, ensure_ascii=False, indent=0))
        print(lang, 'now', len(idx), flush=True)


if __name__ == '__main__':
    main()
