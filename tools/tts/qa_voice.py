#!/usr/bin/env python3
"""Spot-check the rendered voices with ASR: transcribes a sample of lines per
language with faster-whisper (QA only, nothing from it ships) and reports the
character error rate against the script, plus duration sanity for every file.

Run: .venv-tts/bin/python tools/tts/qa_voice.py [--sample 30] [--dir public/audio/vo]
"""
import argparse
import json
import random
import re
import unicodedata
from pathlib import Path

from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parent.parent.parent


def norm(s: str) -> str:
    s = unicodedata.normalize('NFKC', s).lower()
    s = re.sub(r'\{[nf]:[a-z]+\}', '', s)
    return ''.join(c for c in s if unicodedata.category(c)[0] in 'LM' or c.isdigit())


def cer(a: str, b: str) -> float:
    if not a:
        return 1.0
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1] / len(a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sample', type=int, default=30)
    ap.add_argument('--dir', default=str(ROOT / 'public' / 'audio' / 'vo'))
    args = ap.parse_args()
    model = WhisperModel('small', device='cpu', compute_type='int8', cpu_threads=16)
    rnd = random.Random(7)
    report = {}
    for lang in ('en', 'hi', 'ur'):
        d = Path(args.dir) / lang
        idx = json.loads((d / 'index.json').read_text())
        texts = json.loads((ROOT / 'src' / 'i18n' / f'{lang}.json').read_text())
        rate = [(k, v, len(texts.get(k.replace('~anon', ''), ''))) for k, v in idx.items()]
        odd = [k for k, v, n in rate if n and not (0.02 < v / n < 0.2)]
        keys = [k for k in idx if '~' not in k and len(norm(texts.get(k, ''))) > 18]
        rnd.shuffle(keys)
        scores = []
        for k in keys[:args.sample]:
            segs, _ = model.transcribe(str(d / f'{k}.mp3'), language=lang, beam_size=2)
            hyp = ' '.join(s.text for s in segs)
            scores.append((round(cer(norm(texts[k]), norm(hyp)), 3), k, hyp))
        scores.sort()
        mean = sum(s[0] for s in scores) / max(1, len(scores))
        report[lang] = {'lines': len(idx), 'seconds': round(sum(idx.values()), 1), 'odd_rate': odd,
                        'mean_cer': round(mean, 3), 'median_cer': scores[len(scores) // 2][0] if scores else None, 'worst': scores[-3:]}
        print(lang, json.dumps({k: v for k, v in report[lang].items() if k != 'worst'}, ensure_ascii=False), flush=True)
    (Path(__file__).parent / 'qa_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
