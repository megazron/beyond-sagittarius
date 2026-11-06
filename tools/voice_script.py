#!/usr/bin/env python3
"""Export the voiced script as CSV for actors: line id, character, emotion, language, text.

Save a recorded take as public/audio/voice/override/<language>/<line id>.ogg and it
replaces the generated line (see tools/tts/README.md).

Run: python3 tools/voice_script.py [--lang en,hi,ur] [--out voice_script.csv]
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
I18N = ROOT / 'src' / 'i18n'
DIRECTION = ROOT / 'tools' / 'tts' / 'direction.json'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lang', default='en,hi,ur')
    ap.add_argument('--out', default='-')
    args = ap.parse_args()
    voice = json.loads((I18N / 'voice.json').read_text(encoding='utf-8'))
    direction = json.loads(DIRECTION.read_text(encoding='utf-8')).get('lines', {}) if DIRECTION.exists() else {}
    out = sys.stdout if args.out == '-' else open(args.out, 'w', newline='', encoding='utf-8-sig')
    w = csv.writer(out)
    w.writerow(['line_id', 'character', 'emotion', 'language', 'text'])
    for lang in args.lang.split(','):
        strings = json.loads((I18N / f'{lang}.json').read_text(encoding='utf-8'))
        names = {m.group(1): v for k, v in strings.items() if (m := re.fullmatch(r'crew\.(\w+)\.name', k))}
        fill = lambda s: re.sub(r'\{[fn]:(\w+)\}', lambda m: names.get(m.group(1), m.group(1)), s)
        for key, speaker in voice['lines'].items():
            if key not in strings:
                continue
            emotion = direction.get(key, {}).get('emotion', '')
            w.writerow([key, speaker, emotion, lang, fill(strings[key])])
            if f'vo.anon.{key}' in strings and re.search(r'\{[fn]:', strings[key]):
                w.writerow([f'{key}~anon', speaker, emotion, lang, strings[f'vo.anon.{key}']])
            fem = strings.get(f'vo.f.{key}') or strings.get(f'g.f.{key}')
            if speaker == 'scientist' or fem:
                w.writerow([f'{key}~f', 'scientist_f' if speaker == 'scientist' else speaker, emotion, lang, fill(fem or strings[key])])


if __name__ == '__main__':
    main()
