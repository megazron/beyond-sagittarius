#!/usr/bin/env python3
"""Synthesise the reference clips Chatterbox conditions on.

Every clip comes from a Kokoro-82M voicepack (a synthetic voice, Apache-2.0), so
no real person's voice is cloned. Skips clips that already exist.

Run: .venv-tts/bin/python tools/tts/make_refs.py [--force]
"""
import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from huggingface_hub import hf_hub_download
from kokoro import KModel, KPipeline

HERE = Path(__file__).resolve().parent
REPO = 'hexgrad/Kokoro-82M'
SR = 24000


def pack(blend):
    acc = None
    for vid, w in blend.items():
        t = torch.load(hf_hub_download(REPO, f'voices/{vid}.pt'), weights_only=True)
        acc = t * w if acc is None else acc + t * w
    return acc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    cfg = json.loads((HERE / 'refs.json').read_text(encoding='utf-8'))
    out = HERE / 'refs'
    out.mkdir(exist_ok=True)
    model = KModel(repo_id=REPO).eval()
    pipes = {}
    for name, c in cfg['refs'].items():
        dst = out / f'{name}.wav'
        if dst.exists() and not args.force:
            continue
        code = c['g2p']
        if code not in pipes:
            pipes[code] = KPipeline(lang_code=code, repo_id=REPO, model=model)
        blend = c['voice'] if isinstance(c['voice'], dict) else {c['voice']: 1.0}
        tot = sum(blend.values())
        p = pack({k: v / tot for k, v in blend.items()})
        text = cfg['text'][c.get('text', code)]
        parts = [r.audio.cpu().numpy() for r in pipes[code](text, voice=p, speed=c.get('speed', 1.0))]
        y = np.concatenate(parts).astype(np.float32)
        sf.write(dst, y, SR, subtype='PCM_16')
        print(name, round(len(y) / SR, 1), 's', flush=True)


if __name__ == '__main__':
    main()
