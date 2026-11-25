#!/usr/bin/env python3
"""Fails if a known story spoiler appears as plain text in the repo's files or in the built game.

The phrases themselves are not in the repo: tools/spoiler_hashes.json holds only salted SHA-256 hashes of each phrase
in a normal form (lower case, words of letters and digits only, one space between), and the length of each in words. Phrases are at least four words long,
so the hashes cannot simply be guessed back from the repo's own words. Each phrase is kept as two hashes: its first
four words (to find a candidate with one hash per word of text) and the whole phrase (to confirm it).

  python3 tools/spoiler_check.py [DIR ...]      check the tracked files, and every file under each DIR (e.g. dist)
  python3 tools/spoiler_check.py --hash LIST    rewrite spoiler_hashes.json from a private list (one phrase a line)

Exit 1 on any hit: the file and the line are printed, never the phrase.
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HASHES = ROOT / 'tools/spoiler_hashes.json'
SALT = 'beyond-sagittarius/spoilers/v1|'
WORD = re.compile(r'[^\W_]+', re.UNICODE)
MAX_BYTES = 12 * 1024 * 1024


def words(text: str) -> list[str]:
    return WORD.findall(text.lower())


def digest(ws: list[str]) -> str:
    return hashlib.sha256((SALT + ' '.join(ws)).encode('utf-8')).hexdigest()


def make(list_path: str):
    out = []
    for line in Path(list_path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        ws = words(line)
        if len(ws) < 4:
            sys.exit(f'phrase too short (needs four words or more): line {line[:3]}...')
        # the first four words find a candidate in one hash per word of text; the whole phrase confirms it
        out.append([len(ws), digest(ws[:4]), digest(ws)])
    out = sorted({tuple(x) for x in out})
    HASHES.write_text(json.dumps({'salt': SALT, 'phrases': [list(x) for x in out]}, indent=1) + '\n')
    print('spoiler_check: wrote', len(out), 'phrases')


def scan(path: Path, label: str, lead: dict[str, list[tuple[int, str]]], hits: list[str]):
    try:
        if path.stat().st_size > MAX_BYTES:
            return
        data = path.read_bytes()
    except OSError:
        return
    if b'\0' in data[:8192]:
        return  # binary (images, audio, models)
    text = data.decode('utf-8', errors='ignore')
    toks = [(m.group(0).lower(), m.start()) for m in WORD.finditer(text)]
    ws = [w for w, _ in toks]
    for i in range(len(ws) - 3):
        c = lead.get(digest(ws[i:i + 4]))
        if not c:
            continue
        for n, full in c:
            if digest(ws[i:i + n]) == full:
                hits.append(f'{label}:{text.count(chr(10), 0, toks[i][1]) + 1}')


def main():
    if len(sys.argv) > 2 and sys.argv[1] == '--hash':
        make(sys.argv[2])
        return
    spec = json.loads(HASHES.read_text())
    if spec['salt'] != SALT:
        sys.exit('spoiler_hashes.json was made with another salt')
    table: dict[str, list[tuple[int, str]]] = {}
    for n, h4, full in spec['phrases']:
        table.setdefault(h4, []).append((n, full))
    hits: list[str] = []
    files = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, check=True).stdout.decode().split('\0')
    n = 0
    for f in files:
        if f and f != 'tools/spoiler_hashes.json':
            scan(ROOT / f, f, table, hits); n += 1
    for d in sys.argv[1:]:
        base = Path(d)
        for p in sorted(base.rglob('*')):
            if p.is_file():
                scan(p, str(p), table, hits); n += 1
    for h in hits:
        print('SPOILER in plain text:', h)
    print(f'spoiler_check: {n} files, {len(spec["phrases"])} phrases,', 'ok' if not hits else f'{len(hits)} hits')
    sys.exit(1 if hits else 0)


if __name__ == '__main__':
    main()
