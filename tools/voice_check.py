#!/usr/bin/env python3
"""Fails if any spoken line lacks audio. Every key the game speaks must be in
src/i18n/voice.json, have text in en/hi/ur, and have a clip in each language
(plus a name-free take where the line names a crewmate). A Hindi or Urdu line with no take of its own passes if
English has one: the game speaks it in English under the Hindi or Urdu subtitle.

Run: python tools/voice_check.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPOKEN = re.compile(r"""(?:\bkey:\s*|ui\.say\(|\.say\(|ui\.memory\(|\.memory\(|aiAlert\(|\.caption\(|subtitle\(|vcue\(\s*[\d.]+,\s*)'([a-z0-9]+(?:\.[A-Za-z0-9_]+)+)'""")
SKIP = re.compile(r'^(cine\.(approach|montage)|wake\.chapter|chapter\.|signal\.|tut\.)')


def problems():
    out = []
    lines = json.loads((ROOT / 'src/i18n/voice.json').read_text())['lines']
    used = set()
    for f in (ROOT / 'src').rglob('*.ts'):
        used |= set(SPOKEN.findall(f.read_text()))
    for k in sorted(used):
        if k not in lines and not SKIP.match(k):
            out.append(f'spoken in code but not in voice.json: {k}')
    en_idx = json.loads((ROOT / 'public/audio/vo/en/index.json').read_text())
    for lang in ('en', 'hi', 'ur'):
        texts = json.loads((ROOT / f'src/i18n/{lang}.json').read_text())
        idx = json.loads((ROOT / f'public/audio/vo/{lang}/index.json').read_text())
        for k in lines:
            if k not in texts:
                out.append(f'{lang}: no text for {k}')
            has = k in idx and (ROOT / f'public/audio/vo/{lang}/{k}.ogg').exists()
            # Hindi and Urdu may speak a line in English under their own subtitle (src/core/voice.ts)
            if not has and (lang == 'en' or k not in en_idx):
                out.append(f'{lang}: no audio for {k}')
            if re.search(r'\{[nf]:[a-z]+\}', texts.get(k, '')) and f'{k}~anon' not in idx and f'{k}~anon' not in en_idx and k in idx:
                out.append(f'{lang}: no name-free audio for {k}')
    return out


if __name__ == '__main__':
    bad = problems()
    for b in bad[:40]:
        print(b)
    print(f'{len(bad)} problem(s)')
    sys.exit(1 if bad else 0)
