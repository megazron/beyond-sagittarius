#!/usr/bin/env python3
"""Reference clips from LibriTTS-R (CC BY 4.0, Google LLC; LibriVox readers) for the Zenvora townsfolk.

LibriTTS-R is a licensed speech corpus made for training speech synthesis. Readers are named here only by their
corpus speaker id. Each clip is about 12 s of one reader, joined from whole utterances of one chapter, loudness
matched. `--survey` prints every reader's median pitch and speaking rate, to cast from.

Run: .venv-tts2/bin/python tools/tts/libritts_refs.py --root <LibriTTS_R dir> [--survey]
"""
import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
SR = 24000
# name -> (speaker id, gender); casting notes are in docs/VOICE_CAST.md
CAST = json.loads((HERE / 'libritts_cast.json').read_text()) if (HERE / 'libritts_cast.json').exists() else {}


def utts(root: Path, spk: str):
    out = []
    for w in sorted((root / 'dev-clean' / spk).rglob('*.wav')):
        txt = w.with_suffix('.normalized.txt')
        out.append((w, txt.read_text().strip() if txt.exists() else ''))
    return out


def survey(root: Path):
    import librosa
    genders = {}
    for line in (root / 'speakers.tsv').read_text().splitlines()[1:]:
        p = line.split('\t')
        genders[p[0]] = p[1]
    for d in sorted((root / 'dev-clean').iterdir(), key=lambda p: int(p.name)):
        u = utts(root, d.name)[:6]
        f0s, rate = [], []
        for w, t in u:
            y, sr = librosa.load(w, sr=16000)
            f0, vflag, _ = librosa.pyin(y, fmin=60, fmax=400, sr=sr)
            f0s += list(f0[vflag])
            rate.append(len(t.split()) / (len(y) / sr))
        print(d.name, genders.get(d.name), f'f0 {np.median(f0s):.0f} Hz', f'{np.mean(rate):.2f} words/s', flush=True)


def build(root: Path, name: str, spk: str, seconds=12.0):
    import librosa
    import pyloudnorm as pyln
    parts, tot = [], 0.0
    by_ch = {}
    for w, _ in utts(root, spk):
        by_ch.setdefault(w.parent.name, []).append(w)
    ch = max(by_ch.values(), key=len)
    for w in ch:
        y, _ = librosa.load(w, sr=SR)
        if len(y) / SR < 1.5 or (tot > 0 and tot + len(y) / SR > 15):
            continue
        parts += [y, np.zeros(int(0.25 * SR), np.float32)]
        tot += len(y) / SR
        if tot >= seconds:
            break
    y = np.concatenate(parts).astype(np.float32)[:int(15 * SR)]  # Chatterbox listens to the first seconds only
    m = pyln.Meter(SR)
    y = y * 10 ** ((-20 - m.integrated_loudness(y.astype(np.float64))) / 20)
    sf.write(HERE / 'refs' / f'{name}_en.wav', np.clip(y, -1, 1), SR, subtype='PCM_16')
    print(name, spk, f'{len(y) / SR:.1f}s')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True)
    ap.add_argument('--survey', action='store_true')
    a = ap.parse_args()
    root = Path(a.root)
    if a.survey:
        survey(root)
        return
    for name, c in CAST.items():
        if not name.startswith('_'):
            build(root, name, c['speaker'])


if __name__ == '__main__':
    main()
