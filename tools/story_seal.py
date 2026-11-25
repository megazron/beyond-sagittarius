#!/usr/bin/env python3
"""Seals and unseals the Episode One choice data, so it is not readable plain text in the repo or in the game.

The data (who you play in each scene, what you decide, what it sets, who is lost on which path) lives sealed in
src/game/branch/episode1.sealed: zlib-compressed JSON, XORed with a key stream, base64 in lines of 76. This is
obfuscation against spoilers on a plain look (git grep, a look at the files), not secrecy. The game decodes it at run
time with src/game/branch/sealed.ts (same format; nothing in the game reads the data yet, so the build does not
carry it); tools/story_check.py reads it through unseal() below.

  python3 tools/story_seal.py open  OUT.json    write the plain data to OUT.json (keep it outside the repo)
  python3 tools/story_seal.py seal  IN.json     seal IN.json into src/game/branch/episode1.sealed
  python3 tools/story_seal.py check             the sealed file decodes, and the TypeScript decoder agrees
  --file src/game/branch/episode2.sealed        (after the command) work on another sealed file
"""
import base64
import hashlib
import json
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEALED = ROOT / 'src/game/branch/episode1.sealed'
MAGIC = 'BSSEAL1'
# the key stream: sha256 of this seed and a block counter, block after block (the same in sealed.ts)
SEED = b'beyond-sagittarius/episode-one'


def _stream(n: int) -> bytes:
    out = bytearray()
    i = 0
    while len(out) < n:
        out += hashlib.sha256(SEED + i.to_bytes(4, 'big')).digest()
        i += 1
    return bytes(out[:n])


def seal(data: object) -> str:
    raw = zlib.compress(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8'), 9)
    x = bytes(a ^ b for a, b in zip(raw, _stream(len(raw))))
    b = base64.b64encode(x).decode('ascii')
    return MAGIC + '\n' + '\n'.join(b[i:i + 76] for i in range(0, len(b), 76)) + '\n'


def unseal(text: str) -> object:
    lines = text.split()
    if not lines or lines[0] != MAGIC:
        raise ValueError('not a sealed file')
    x = base64.b64decode(''.join(lines[1:]))
    raw = bytes(a ^ b for a, b in zip(x, _stream(len(x))))
    return json.loads(zlib.decompress(raw).decode('utf-8'))


def load() -> object:
    return unseal(SEALED.read_text())


def main():
    global SEALED
    if '--file' in sys.argv:
        i = sys.argv.index('--file')
        SEALED = (ROOT / sys.argv[i + 1]).resolve()
        del sys.argv[i:i + 2]
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    cmd = sys.argv[1]
    if cmd == 'open':
        Path(sys.argv[2]).write_text(json.dumps(load(), ensure_ascii=False, indent=1) + '\n')
    elif cmd == 'seal':
        data = json.loads(Path(sys.argv[2]).read_text())
        SEALED.write_text(seal(data))
        if load() != data:
            sys.exit('sealed data does not read back the same')
        print('sealed', SEALED.relative_to(ROOT))
    elif cmd == 'check':
        import subprocess
        data = load()
        js = subprocess.run(['node', '--experimental-strip-types', str(ROOT / 'tools/story_seal_check.ts'), str(SEALED)],
                            capture_output=True, text=True, cwd=ROOT)
        if js.returncode != 0:
            sys.exit('sealed.ts failed: ' + js.stderr[-800:])
        if json.loads(js.stdout) != data:
            sys.exit('sealed.ts reads the sealed data differently from story_seal.py')
        print('story_seal: ok (both decoders agree)')
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == '__main__':
    main()
