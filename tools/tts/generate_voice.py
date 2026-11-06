#!/usr/bin/env python3
"""Render every voiced line of BEYOND SAGITTARIUS to small MP3s (en / hi / ur).

Inputs : src/i18n/voice.json (key -> speaker), src/i18n/{en,hi,ur}.json, read at run time
Config : tools/tts/voices.json (casting), direction.json (delivery per line),
         pronunciations.json, refs/ (synthetic reference clips, see make_refs.py)
Output : public/audio/vo/<lang>/<key>.mp3 (+ <key>~anon.mp3) and index.json
         {key: duration_seconds}. Mono 24 kHz MP3, loudness-normalised.

Chatterbox on CPU is slow, so this is built to be interrupted: every take is cached
in tools/tts/.cache by a hash of its inputs, and each finished line is published
straight away. Re-running skips what exists. Every take is transcribed with
Whisper and retaken with a new seed if it drifts from the script.

Run:  npm run voice -- [--lang en,hi,ur] [--only 'dlg.9.*'] [--force] [--limit 20]
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import warnings
from pathlib import Path

SCRIPT_VERSION = 4
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
I18N = ROOT / 'src' / 'i18n'
OUT_ROOT = ROOT / 'public' / 'audio' / 'vo'
CACHE = HERE / '.cache' / 'v4'
SR = 24000
FFMPEG = shutil.which('ffmpeg') or str(Path.home() / '.local' / 'bin' / 'ffmpeg')

TARGET_LUFS = -18.0
PEAK_LIMIT = 0.89          # ~ -1 dBFS
MP3_BITRATE = '48k'
LANGS = ('en', 'hi', 'ur')
MAX_TAKES = 3

NAME_RE = re.compile(r'\{([fn]):([a-z0-9_]+)\}')
PARAM_RE = re.compile(r'\{[^}]*\}')
NAME_OPEN, NAME_CLOSE = '\ue000', '\ue001'


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- text
def load_json(p: Path):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def crew_names(strings: dict) -> dict:
    out = {}
    for k, v in strings.items():
        m = re.fullmatch(r'crew\.([a-z0-9_]+)\.name', k)
        if m and isinstance(v, str):
            out[m.group(1)] = v
    return out


def substitute_names(text: str, names: dict, key: str, lang: str) -> str:
    """Replace {f:id}/{n:id} with the default names, wrapped in markers so the
    G2P stage can treat names specially."""
    def rep(m):
        kind, cid = m.group(1), m.group(2)
        if cid not in names:
            log(f'  WARN [{lang}] {key}: unknown crew id in {m.group(0)}')
            return cid
        full = names[cid].strip()
        val = full.split()[0] if kind == 'f' and full.split() else full
        return f'{NAME_OPEN}{cid}:{kind}{NAME_CLOSE}{val}{NAME_OPEN}{NAME_CLOSE}'
    return NAME_RE.sub(rep, text)


def _sentence_case(s: str) -> str:
    low = s.lower()
    out, cap = [], True
    for ch in low:
        if cap and ch.isalpha():
            out.append(ch.upper()); cap = False
        else:
            out.append(ch)
        if ch in '.!?':
            cap = True
    return ''.join(out)


def clean_text(text: str, lang: str, key: str) -> str:
    t = text
    if PARAM_RE.search(t.replace(NAME_OPEN, '').replace(NAME_CLOSE, '')):
        log(f'  WARN [{lang}] {key}: unexpected placeholder in voiced line: {t!r}')
        t = PARAM_RE.sub('', t)
    t = t.replace(' ', ' ').replace('‌', '').replace('‍', '')
    # quotes: strip double quotes, normalise apostrophes
    for q in '“”„«»"':
        t = t.replace(q, '')
    t = t.replace('‘', "'").replace('’', "'")
    if lang != 'en':
        t = t.replace("'", '')
    t = t.replace('...', '…')
    # leading ellipsis / dash
    t = re.sub(r'^[\s…\-–—]+', '', t)
    # script punctuation -> ASCII
    t = (t.replace('।', '.').replace('॥', '.').replace('۔', '.').replace('،', ',')
          .replace('؟', '?').replace('؛', ';').replace('٪', '%'))
    t = t.replace('–', '—')
    if lang == 'en':
        t = re.sub(r'\s*—\s*', ' — ', t)       # Kokoro knows the em dash
        t = re.sub(r'\s*…\s*', '… ', t)
    else:                                       # espeak: commas give the pause
        t = re.sub(r'\s*—\s*', ', ', t)
        t = re.sub(r'\s*…\s*', ', ', t)
    # SHOUTED ALERTS -> sentence case so English G2P doesn't spell them out
    if lang == 'en':
        letters = [c for c in t if c.isalpha()]
        if len(letters) >= 4 and not any(c.islower() for c in letters):
            t = _sentence_case(t)
    t = re.sub(r'([,.;:!?])\1+', r'\1', t)
    t = re.sub(r',\s*([.!?])', r'\1', t)
    t = re.sub(r'\s+([,.;:!?%])', r'\1', t)
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'^[,.;:\s]+', '', t)
    if t and t[-1] not in '.!?…':
        t += '.'
    return t


def display_text(t: str) -> str:
    """Cleaned text without name markers (used for QA references)."""
    return re.sub(f'{NAME_OPEN}[^{NAME_CLOSE}]*{NAME_CLOSE}', '', t).replace(NAME_OPEN, '').replace(NAME_CLOSE, '')


# --------------------------------------------------------------------------- audio
def _trim(x, sr, head_db=-42.0, pad_head=0.04, pad_tail=0.08):
    import numpy as np
    if len(x) == 0:
        return x
    hop = int(sr * 0.01)
    n = len(x) // hop
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    thr = rms.max() * 10 ** (head_db / 20)
    idx = np.where(rms > thr)[0]
    if len(idx) == 0:
        return x[:0]
    a = max(0, idx[0] * hop - int(pad_head * sr))
    b = min(len(x), (idx[-1] + 1) * hop + int(pad_tail * sr))
    return x[a:b]


def _fade(x, sr, fin=0.008, fout=0.06):
    import numpy as np
    x = x.copy()
    ni, no = min(len(x), int(fin * sr)), min(len(x), int(fout * sr))
    if ni:
        x[:ni] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, ni))
    if no:
        x[-no:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, no))
    return x


def _ff(args):
    r = subprocess.run([FFMPEG, '-hide_banner', '-nostdin', '-loglevel', 'error', '-y', *args],
                       capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-2000:])


# --------------------------------------------------------------------------- jobs
def respell(text: str, lex: dict) -> str:
    if not lex:
        return text
    pat = re.compile(r'(?<!\w)(' + '|'.join(re.escape(w) for w in sorted(lex, key=len, reverse=True)) + r')(?!\w)')
    return pat.sub(lambda m: lex[m.group(1)], text)


def spoken_text(raw, key, lang, strings, hi_strings, lexicon):
    """The text the model reads. Urdu goes through Devanagari (Chatterbox has no Urdu)."""
    names = crew_names(strings)
    text = display_text(clean_text(substitute_names(raw, names, key, lang), lang, key))
    if lang == 'ur':
        from ur2deva import urdu_line_to_devanagari
        hi_names = crew_names(hi_strings)
        for cid, n in names.items():          # names keep their Hindi spelling
            text = text.replace(n, hi_names.get(cid, n))
        base = key.split('~')[0]
        tries = [f'vo.anon.{base}'] if key.endswith('~anon') else [f'vo.f.{base}', f'g.f.{base}'] if key.endswith('~f') else []
        hi_line = next((hi_strings[k] for k in [*tries, base] if k in hi_strings), '')
        hi_raw = NAME_RE.sub(lambda m: hi_names.get(m.group(2), ''), hi_line)
        text = urdu_line_to_devanagari(text, hi_raw)[0]
    return respell(text, lexicon.get(lang, {}))


def build_jobs(lang, voice_map, voices, direction, strings, hi_strings, lexicon, only):
    jobs = []
    for key, speaker in voice_map['lines'].items():
        if key not in strings:
            log(f'  WARN [{lang}] missing key {key}')
            continue
        variants = [(key, strings[key])]
        if NAME_RE.search(strings[key]) and f'vo.anon.{key}' in strings:
            variants.append((f'{key}~anon', strings[f'vo.anon.{key}']))
        # Female-player takes: every scientist line, plus any line with its own feminine text.
        fem = strings.get(f'vo.f.{key}') or strings.get(f'g.f.{key}')
        if speaker == 'scientist' or fem:
            variants.append((f'{key}~f', fem or strings[key]))
        d = direction['lines'].get(key)
        if d is None:  # new line nobody has directed yet: a plain read beats stopping the render
            d = {'emotion': 'dry', 'intensity': 0.5, 'pace': 1.0, 'pre': 0, 'post': 0.2, 'tags': [], 'fx': ''}
        for vkey, raw in variants:
            if only and not any(fnmatch.fnmatchcase(vkey, o) or fnmatch.fnmatchcase(vkey.split('~')[0], o) for o in only):
                continue
            who = 'scientist_f' if vkey.endswith('~f') and speaker == 'scientist' else speaker
            cast = voices['speakers'][who]
            c = {**voices['defaults'], **cast.get('all', {}), **cast.get(lang, {})}
            text = spoken_text(raw, vkey, lang, strings, hi_strings, lexicon)
            ex, cfg, temp = direction['emotions'][d['emotion']]
            job = {'lang': lang, 'key': vkey, 'speaker': who, 'text': text, 'dir': d, 'cast': c,
                   'exaggeration': round(min(1.2, ex * (0.6 + 0.8 * d['intensity'])), 3), 'cfg': cfg, 'temperature': temp,
                   'ref': f"{c['ref']}_{'en' if lang == 'en' else 'hi'}"}
            job['fx'] = [x for x in (direction['fx'].get(d['fx']), c.get('fx')) if x]
            h = hashlib.sha1(json.dumps({'v': SCRIPT_VERSION, **{k: v for k, v in job.items() if k != 'key'}},
                                        sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]
            job.update(hash=h, mp3=str(CACHE / lang / f'{h}.mp3'), meta=str(CACHE / lang / f'{h}.json'))
            jobs.append(job)
    return jobs


# --------------------------------------------------------------------------- render
class Engine:
    def __init__(self, threads):
        import torch
        torch.set_num_threads(threads)
        self.torch, self._m, self._asr = torch, {}, None

    def model(self, name):
        if name not in self._m:
            self._m.clear()                  # one model in RAM at a time
            if name == 'en':
                from chatterbox.tts import ChatterboxTTS
                self._m[name] = ChatterboxTTS.from_pretrained('cpu')
            else:
                from chatterbox.mtl_tts import ChatterboxMultilingualTTS
                self._m[name] = ChatterboxMultilingualTTS.from_pretrained(self.torch.device('cpu'))
        return self._m[name]

    def synth(self, job, seed):
        self.torch.manual_seed(seed)
        ref = str(HERE / 'refs' / f"{job['ref']}.wav")
        kw = dict(audio_prompt_path=ref, exaggeration=job['exaggeration'], cfg_weight=job['cfg'], temperature=job['temperature'])
        if job['lang'] == 'en':
            m = self.model('en')
            w = m.generate(job['text'], **kw)
        else:
            m = self.model('hi')
            w = m.generate(job['text'], language_id='hi', **kw)
        return w.squeeze().cpu().numpy(), m.sr

    def cer(self, y, sr, job):
        import librosa
        from faster_whisper import WhisperModel
        from qa_voice import cer, norm
        if self._asr is None:
            self._asr = WhisperModel('small', device='cpu', compute_type='int8', cpu_threads=4)
        lang = 'hi' if job['lang'] != 'en' else 'en'
        segs, _ = self._asr.transcribe(librosa.resample(y, orig_sr=sr, target_sr=16000), language=lang, beam_size=2)
        return cer(norm(job['text']), norm(' '.join(s.text for s in segs)))


def finish(y, sr, job):
    """Trim, stretch to the directed pace, add fx and pauses, normalise, encode."""
    import librosa
    import numpy as np
    import pyloudnorm as pyln
    import soundfile as sf
    y = librosa.resample(np.asarray(y, dtype=np.float32), orig_sr=sr, target_sr=SR) if sr != SR else y
    y = _trim(y, SR)
    d, c = job['dir'], job['cast']
    chain = []
    pace = d['pace'] * c.get('pace', 1.0)
    if abs(pace - 1) > 0.01:
        chain.append(f'rubberband=tempo={pace:.3f}')
    if c.get('pitch'):
        chain.append(f"rubberband=pitch={2 ** (c['pitch'] / 12):.5f}:formant=preserved")
    chain += job['fx']
    with tempfile.TemporaryDirectory() as td:
        a, b, o = Path(td, 'a.wav'), Path(td, 'b.wav'), Path(td, 'c.wav')
        sf.write(a, np.concatenate([y, np.zeros(int(0.6 * SR), np.float32)]), SR, subtype='FLOAT')
        _ff(['-i', str(a), '-filter_complex', f"[0:a]{','.join(chain) or 'anull'},aresample={SR}[o]", '-map', '[o]',
             '-ac', '1', '-c:a', 'pcm_f32le', str(b)])
        y, _ = sf.read(b, dtype='float32')
        y = _fade(_trim(y, SR, head_db=-48.0, pad_head=0.02, pad_tail=0.06), SR)
        meter = pyln.Meter(SR, block_size=min(0.4, max(0.1, len(y) / SR - 0.01)))
        try:
            lufs = meter.integrated_loudness(y.astype(np.float64))
        except Exception:
            lufs = float('-inf')
        if not np.isfinite(lufs):
            lufs = 20 * np.log10(float(np.sqrt(np.mean(y ** 2) + 1e-12))) - 0.7
        y = y * 10 ** ((TARGET_LUFS - lufs) / 20)
        y = np.concatenate([np.zeros(int(d['pre'] * SR), np.float32), y, np.zeros(int(d['post'] * SR), np.float32)])
        sf.write(o, y, SR, subtype='FLOAT')
        Path(job['mp3']).parent.mkdir(parents=True, exist_ok=True)
        tmp = job['mp3'] + '.tmp.mp3'
        _ff(['-i', str(o), '-af', f'alimiter=limit={PEAK_LIMIT}:attack=2:release=40:level=false', '-ac', '1', '-ar', str(SR),
             '-c:a', 'libmp3lame', '-b:a', MP3_BITRATE, '-write_xing', '1', '-map_metadata', '-1', tmp])
        os.replace(tmp, job['mp3'])
    return round(len(y) / SR, 2)


def render(engine, job, max_cer):
    """Best of up to MAX_TAKES seeds: stop at the first take close enough to the script."""
    t0, best = time.time(), None
    seed0 = int(job['hash'][:6], 16)
    for n in range(MAX_TAKES):
        y, sr = engine.synth(job, seed0 + n)
        c = engine.cer(y, sr, job)
        if best is None or c < best[0]:
            best = (c, y, sr, n + 1)
        if c <= max_cer:
            break
    c, y, sr, take = best
    dur = finish(y, sr, job)
    meta = {'duration': dur, 'cer': round(c, 3), 'take': take, 'secs': round(time.time() - t0, 1)}
    Path(job['meta']).write_text(json.dumps(meta))
    return meta


def publish(lang, jobs, out_root, prune):
    d = out_root / lang
    d.mkdir(parents=True, exist_ok=True)
    idx_p = d / 'index.json'
    index = load_json(idx_p) if idx_p.exists() else {}
    for j in jobs:
        if Path(j['meta']).exists():
            shutil.copyfile(j['mp3'], d / f"{j['key']}.mp3")
            index[j['key']] = load_json(Path(j['meta']))['duration']
    if prune:
        keep = {j['key'] for j in jobs}
        index = {k: v for k, v in index.items() if k in keep}
        for f in d.glob('*.mp3'):
            if f.stem not in keep:
                f.unlink()
                log(f'  removed stale {f}')
    tmp = idx_p.with_suffix('.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(index.items())), f, ensure_ascii=False, indent=0, separators=(',', ':'))
        f.write('\n')
    os.replace(tmp, idx_p)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--lang', default=','.join(LANGS))
    ap.add_argument('--only', action='append', default=[], help='key glob (repeatable, comma-separated ok)')
    ap.add_argument('--force', action='store_true', help='ignore cache')
    ap.add_argument('--out', default=str(OUT_ROOT))
    ap.add_argument('--threads', type=int, default=16)
    ap.add_argument('--max-cer', type=float, default=0.15, help='retake above this (Hindi and Urdu get +0.15: Whisper is weaker there)')
    ap.add_argument('--limit', type=int, default=0, help='stop after N new lines')
    ap.add_argument('--dry-run', action='store_true', help='print the text each line will read')
    args = ap.parse_args()
    warnings.filterwarnings('ignore')
    sys.path.insert(0, str(HERE))
    langs = [l.strip() for l in args.lang.split(',') if l.strip()]
    only = [o.strip() for s in args.only for o in s.split(',') if o.strip()]
    voice_map = load_json(I18N / 'voice.json')
    voices = load_json(HERE / 'voices.json')
    direction = load_json(HERE / 'direction.json')
    lexicon = {k: v for k, v in load_json(HERE / 'pronunciations.json').items() if not k.startswith('_')}
    hi_strings = load_json(I18N / 'hi.json')
    out_root = Path(args.out)

    per_lang = {l: build_jobs(l, voice_map, voices, direction, load_json(I18N / f'{l}.json'), hi_strings, lexicon, only) for l in langs}
    if args.dry_run:
        for l in langs:
            for j in per_lang[l]:
                print(f"{l}\t{j['key']}\t{j['speaker']}\t{j['exaggeration']}\t{j['text']}")
        return
    engine, done = None, 0
    for l in langs:
        jobs = per_lang[l]
        todo = [j for j in jobs if args.force or not Path(j['meta']).exists()]
        log(f'[{l}] {len(jobs)} lines, {len(todo)} to render')
        for n, j in enumerate(todo, 1):
            engine = engine or Engine(args.threads)
            m = render(engine, j, args.max_cer + (0 if l == 'en' else 0.15))
            log(f"  [{n}/{len(todo)}] {l} {j['key']:<20} {m['duration']:5.2f}s cer {m['cer']:.2f} take {m['take']} in {m['secs']:.0f}s")
            publish(l, [j], out_root, False)
            done += 1
            if args.limit and done >= args.limit:
                return
        publish(l, jobs, out_root, not only)
    from voice_overrides import main as overrides
    sys.argv = sys.argv[:1]
    overrides()


if __name__ == '__main__':
    main()
