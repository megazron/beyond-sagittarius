#!/usr/bin/env python3
"""Render every voiced line of BEYOND SAGITTARIUS to small MP3s (en / hi / ur).

Inputs : src/i18n/voice.json (key -> speaker), src/i18n/{en,hi,ur}.json
Config : tools/tts/voices.json (casting), tools/tts/pronunciations.json
Output : public/audio/vo/<lang>/<key>.mp3 (+ <key>~anon.mp3) and index.json
         {key: duration_seconds}. Mono 24 kHz MP3, loudness-normalised.

TTS model: Kokoro-82M (Apache-2.0), CPU only. Lines are cached in
tools/tts/.cache keyed by (script version, phonemes, voice config), so re-runs
only render what changed.

Run:  npm run voice -- [--lang en,hi,ur] [--only 'dlg.9.*'] [--force]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
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

SCRIPT_VERSION = 3
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
I18N = ROOT / 'src' / 'i18n'
OUT_ROOT = ROOT / 'public' / 'audio' / 'vo'
CACHE = HERE / '.cache'
SR = 24000
REPO_ID = 'hexgrad/Kokoro-82M'
FFMPEG = shutil.which('ffmpeg') or str(Path.home() / '.local' / 'bin' / 'ffmpeg')

TARGET_LUFS = -18.0
PEAK_LIMIT = 0.89          # ~ -1 dBFS
MP3_BITRATE = '48k'
LANGS = ('en', 'hi', 'ur')

# Urdu front-end:
#   espeak-ur : espeak-ng Urdu G2P on the Urdu script text  (default)
#   deva      : Urdu words transliterated to Devanagari (spelling resolved via
#               the parallel Hindi line), then Hindi G2P. See ur2deva.py.
UR_METHODS = ('espeak-ur', 'deva')
DEFAULT_UR_METHOD = 'espeak-ur'
# Pronounce Urdu name tokens from the parallel Devanagari name in hi.json.
UR_NAMES_FROM_HINDI = True

NAME_RE = re.compile(r'\{([fn]):([a-z0-9_]+)\}')
PARAM_RE = re.compile(r'\{[^}]*\}')
NAME_OPEN, NAME_CLOSE = '', ''


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


# --------------------------------------------------------------------------- G2P
class G2P:
    def __init__(self, lexicon: dict, hi_names: dict, ur_method: str):
        self._pipes = {}
        self._esp = {}
        self.lex = lexicon
        self.hi_names = hi_names
        self.ur_method = ur_method
        self.dropped = {}

    def pipe(self, code):
        if code not in self._pipes:
            from kokoro import KPipeline
            self._pipes[code] = KPipeline(lang_code=code, repo_id=REPO_ID, model=False)
        return self._pipes[code]

    def esp(self, lang):
        if lang not in self._esp:
            from misaki.espeak import EspeakG2P
            self._esp[lang] = EspeakG2P(language=lang)
        return self._esp[lang]

    def vocab(self):
        if not hasattr(self, '_vocab'):
            from huggingface_hub import hf_hub_download
            cfg = load_json(Path(hf_hub_download(REPO_ID, 'config.json')))
            self._vocab = set(cfg['vocab'].keys())
        return self._vocab

    def _plain(self, text: str, lang: str, code: str, phon_lang: str) -> str:
        if not text.strip():
            return ''
        if lang == 'en':
            ps, _ = self.pipe(code).g2p(text)
        else:
            ps, _ = self.esp(phon_lang)(text)
        return ps.strip()

    def phonemize(self, text: str, lang: str, code: str, key: str, hi_parallel: str = '') -> str:
        """text = cleaned text with name markers. Returns Kokoro phoneme string."""
        lex = self.lex.get(lang, {})
        phon_lang = 'hi'
        if lang == 'ur':
            if self.ur_method == 'deva':
                from ur2deva import urdu_line_to_devanagari
                # names: use the Hindi spelling of the same crew member
                def nm(m):
                    cid = m.group(1).split(':')[0]
                    return f'{NAME_OPEN}{m.group(1)}{NAME_CLOSE}{self.hi_names.get(cid, m.group(2))}{NAME_OPEN}{NAME_CLOSE}'
                text = re.sub(f'{NAME_OPEN}([^{NAME_CLOSE}]+){NAME_CLOSE}(.*?){NAME_OPEN}{NAME_CLOSE}', nm, text)
                parts = re.split(f'({NAME_OPEN}[^{NAME_CLOSE}]*{NAME_CLOSE})', text)
                text = ''.join(p if p.startswith(NAME_OPEN) else urdu_line_to_devanagari(p, hi_parallel)[0] for p in parts)
            else:
                phon_lang = 'ur'
        # split into segments: ('t', text) | ('p', phonemes)
        segs = []
        pos = 0
        name_re = re.compile(f'{NAME_OPEN}([^{NAME_CLOSE}]+){NAME_CLOSE}(.*?){NAME_OPEN}{NAME_CLOSE}')
        for m in name_re.finditer(text):
            segs.append(('t', text[pos:m.start()]))
            cid = m.group(1).split(':')[0]
            name = m.group(2)
            if name in lex:
                segs.append(('t', name))           # override handled below
            elif lang == 'ur' and phon_lang == 'ur' and UR_NAMES_FROM_HINDI and cid in self.hi_names:
                hn = self.hi_names[cid].split()
                hn = ' '.join(hn[:len(name.split())])
                segs.append(('p', self._plain(hn, 'hi', 'h', 'hi')))
            else:
                segs.append(('t', name))
            pos = m.end()
        segs.append(('t', text[pos:]))
        # pronunciation overrides on whole words
        if lex:
            pat = re.compile(r'(?<!\w)(' + '|'.join(re.escape(w) for w in sorted(lex, key=len, reverse=True)) + r')(?!\w)')
            new = []
            for kind, s in segs:
                if kind != 't':
                    new.append((kind, s)); continue
                pos = 0
                for m in pat.finditer(s):
                    new.append(('t', s[pos:m.start()]))
                    v = lex[m.group(1)]
                    new.append(('p', v[1:-1]) if v.startswith('/') and v.endswith('/') else ('t', v))
                    pos = m.end()
                new.append(('t', s[pos:]))
            segs = new
        # merge adjacent text segments, phonemize
        merged = []
        for kind, s in segs:
            if merged and kind == 't' and merged[-1][0] == 't':
                merged[-1] = ('t', merged[-1][1] + s)
            else:
                merged.append((kind, s))
        ps = ''
        for kind, s in merged:
            if kind == 't':
                lead = s[:1] if s[:1] in ',.!?;:' else ''
                p = self._plain(s, lang, code, phon_lang)
                if lead and not p.startswith(lead):
                    p = lead + ' ' + p
            else:
                p = s
            if not p:
                continue
            if ps and not p[0] in ',.!?;:…' and not ps.endswith(' '):
                ps += ' '
            ps += p
        ps = re.sub(r'\s+', ' ', ps).strip()
        ps = re.sub(r'\s+([,.!?;:])', r'\1', ps)
        voc = self.vocab()
        bad = [c for c in ps if c not in voc]
        if bad:
            self.dropped[f'{lang}:{key}'] = ''.join(sorted(set(bad)))
            log(f'  WARN [{lang}] {key}: {len(bad)} phoneme symbols not in Kokoro vocab dropped: {sorted(set(bad))}')
            ps = ''.join(c for c in ps if c in voc)
        return ps


def split_phonemes(ps: str, limit: int = 480):
    if len(ps) <= limit:
        return [ps]
    parts = re.split(r'(?<=[.!?…])\s+', ps)
    chunks, cur = [], ''
    for p in parts:
        while len(p) > limit:                    # very long sentence: split at commas
            cut = p.rfind(', ', 0, limit)
            cut = cut + 1 if cut > 0 else limit
            if cur:
                chunks.append(cur); cur = ''
            chunks.append(p[:cut].strip()); p = p[cut:].strip()
        if cur and len(cur) + 1 + len(p) > limit:
            chunks.append(cur); cur = p
        else:
            cur = f'{cur} {p}'.strip()
    if cur:
        chunks.append(cur)
    return chunks


# --------------------------------------------------------------------------- casting
def resolve_cfg(voices: dict, speaker: str, lang: str) -> dict:
    sp = voices['speakers'].get(speaker)
    if sp is None:
        raise SystemExit(f'voices.json has no speaker {speaker!r}')
    c = dict(voices.get('defaults', {}))
    c.update(sp.get(lang) or sp.get('en'))
    fx = c.get('fx') or ''
    if fx.startswith('@'):
        fx = voices['fx_presets'][fx[1:]]
    c['fx'] = fx
    if isinstance(c['voice'], str):
        c['voice'] = {c['voice']: 1.0}
    tot = sum(c['voice'].values())
    c['voice'] = {k: round(v / tot, 4) for k, v in sorted(c['voice'].items())}
    return c


def filter_chain(cfg: dict) -> str:
    parts = []
    if cfg.get('pitch'):
        parts.append(f"rubberband=pitch={2 ** (cfg['pitch'] / 12):.5f}:formant=preserved")
    if cfg.get('fx'):
        parts.append(cfg['fx'])
    return ','.join(parts) if parts else 'anull'


# --------------------------------------------------------------------------- worker
_W = {}


def _winit(threads: int):
    warnings.filterwarnings('ignore')
    import torch
    torch.set_num_threads(threads)
    from kokoro import KModel
    _W['model'] = KModel(repo_id=REPO_ID).eval()
    _W['packs'] = {}


def _pack(blend: dict):
    import torch
    from huggingface_hub import hf_hub_download
    key = json.dumps(blend, sort_keys=True)
    if key not in _W['packs']:
        acc = None
        for vid, w in blend.items():
            t = torch.load(hf_hub_download(REPO_ID, f'voices/{vid}.pt'), weights_only=True)
            acc = t * w if acc is None else acc + t * w
        _W['packs'][key] = acc
    return _W['packs'][key]


def _ff(args, **kw):
    r = subprocess.run([FFMPEG, '-hide_banner', '-nostdin', '-loglevel', 'error', '-y', *args],
                       capture_output=True, text=True, **kw)
    if r.returncode:
        raise RuntimeError(r.stderr[-2000:])
    return r


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


def render_job(job: dict) -> dict:
    import numpy as np
    import soundfile as sf
    import torch
    import pyloudnorm as pyln
    from kokoro import KPipeline
    t0 = time.time()
    cfg = job['cfg']
    pack = _pack(cfg['voice'])
    audio = []
    gap = np.zeros(int(0.18 * SR), dtype=np.float32)
    with torch.no_grad():
        for i, chunk in enumerate(split_phonemes(job['ps'])):
            out = KPipeline.infer(_W['model'], chunk, pack, cfg.get('speed', 1.0))
            a = out.audio.cpu().numpy().astype(np.float32)
            if i:
                audio.append(gap)
            audio.append(_trim(a, SR))
    raw = np.concatenate(audio) if audio else np.zeros(1, np.float32)
    synth_s = time.time() - t0
    raw = _trim(raw, SR)
    tail = np.zeros(int(0.9 * SR), dtype=np.float32)
    with tempfile.TemporaryDirectory() as td:
        a, b, c = Path(td, 'a.wav'), Path(td, 'b.wav'), Path(td, 'c.wav')
        sf.write(a, np.concatenate([np.zeros(int(0.05 * SR), np.float32), raw, tail]), SR, subtype='FLOAT')
        _ff(['-i', str(a), '-filter_complex', f'[0:a]{filter_chain(cfg)},aresample={SR}[o]', '-map', '[o]',
             '-ac', '1', '-c:a', 'pcm_f32le', str(b)])
        y, _ = sf.read(b, dtype='float32')
        if y.ndim > 1:
            y = y.mean(axis=1)
        y = _fade(_trim(y, SR, head_db=-48.0, pad_head=0.03, pad_tail=0.12), SR)
        # loudness normalisation (BS.1770 integrated; short clips measured whole)
        meter = pyln.Meter(SR, block_size=min(0.4, max(0.1, len(y) / SR - 0.01)))
        try:
            lufs = meter.integrated_loudness(y.astype(np.float64))
        except Exception:
            lufs = float('-inf')
        if not np.isfinite(lufs):
            rms = float(np.sqrt(np.mean(y ** 2) + 1e-12))
            lufs = 20 * np.log10(rms) - 0.7
        gain = 10 ** ((TARGET_LUFS - lufs) / 20)
        y = y * gain
        sf.write(c, y, SR, subtype='FLOAT')
        dur = len(y) / SR
        Path(job['cache_mp3']).parent.mkdir(parents=True, exist_ok=True)
        tmp_mp3 = str(job['cache_mp3']) + '.tmp.mp3'
        _ff(['-i', str(c), '-af', f'alimiter=limit={PEAK_LIMIT}:attack=2:release=40:level=false',
             '-ac', '1', '-ar', str(SR), '-c:a', 'libmp3lame', '-b:a', MP3_BITRATE, '-write_xing', '1',
             '-map_metadata', '-1', tmp_mp3])
        os.replace(tmp_mp3, job['cache_mp3'])
    meta = {'duration': round(dur, 2), 'lufs_in': round(lufs, 1), 'synth_s': round(synth_s, 2),
            'total_s': round(time.time() - t0, 2), 'audio_s_raw': round(len(raw) / SR, 2)}
    with open(job['cache_meta'], 'w') as f:
        json.dump(meta, f)
    return {**job, **meta}


# --------------------------------------------------------------------------- main
def build_jobs(lang, voice_map, voices, strings, hi_strings, g2p, ur_method, only):
    names = crew_names(strings)
    jobs = []
    code_default = 'a'
    for key, speaker in voice_map['lines'].items():
        variants = []
        if key not in strings:
            log(f'  WARN [{lang}] missing key {key}')
            continue
        variants.append((key, strings[key]))
        if NAME_RE.search(strings[key]) and f'vo.anon.{key}' in strings:
            variants.append((f'{key}~anon', strings[f'vo.anon.{key}']))
        for vkey, raw in variants:
            if only and not any(fnmatch.fnmatchcase(vkey, o) or fnmatchcase_base(vkey, o) for o in only):
                continue
            cfg = resolve_cfg(voices, speaker, lang)
            text = clean_text(substitute_names(raw, names, vkey, lang), lang, vkey)
            hi_par = ''
            if lang == 'ur' and hi_strings:
                hk = f'vo.anon.{key}' if vkey.endswith('~anon') else key
                hi_par = hi_strings.get(hk, '')
            ps = g2p.phonemize(text, lang, cfg.get('g2p', code_default), vkey, hi_par)
            h = hashlib.sha1(json.dumps({'v': SCRIPT_VERSION, 'lang': lang, 'ps': ps, 'cfg': cfg,
                                         'ur': ur_method if lang == 'ur' else None,
                                         'lufs': TARGET_LUFS, 'br': MP3_BITRATE},
                                        sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]
            jobs.append({'lang': lang, 'key': vkey, 'speaker': speaker, 'text': display_text(text),
                         'raw': raw, 'ps': ps, 'cfg': cfg, 'hash': h,
                         'cache_mp3': str(CACHE / lang / f'{h}.mp3'),
                         'cache_meta': str(CACHE / lang / f'{h}.json')})
    return jobs


def fnmatchcase_base(vkey, pat):
    return vkey.endswith('~anon') and fnmatch.fnmatchcase(vkey[:-5], pat)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--lang', default=','.join(LANGS))
    ap.add_argument('--only', action='append', default=[], help='key glob (repeatable, comma-separated ok)')
    ap.add_argument('--force', action='store_true', help='ignore cache')
    ap.add_argument('--ur-method', choices=UR_METHODS, default=DEFAULT_UR_METHOD)
    ap.add_argument('--out', default=str(OUT_ROOT), help='output root (default public/audio/vo)')
    ap.add_argument('--workers', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true', help='print cleaned text + phonemes only')
    args = ap.parse_args()
    warnings.filterwarnings('ignore')
    sys.path.insert(0, str(HERE))

    langs = [l.strip() for l in args.lang.split(',') if l.strip()]
    only = [o.strip() for s in args.only for o in s.split(',') if o.strip()]
    voice_map = load_json(I18N / 'voice.json')
    voices = load_json(HERE / 'voices.json')
    lexicon = {k: v for k, v in load_json(HERE / 'pronunciations.json').items() if not k.startswith('_')}
    hi_strings = load_json(I18N / 'hi.json')
    g2p = G2P(lexicon, crew_names(hi_strings), args.ur_method)
    out_root = Path(args.out)

    all_jobs = []
    for lang in langs:
        strings = load_json(I18N / f'{lang}.json')
        jobs = build_jobs(lang, voice_map, voices, strings, hi_strings, g2p, args.ur_method, only)
        all_jobs.extend(jobs)
        log(f'[{lang}] {len(jobs)} lines')
    if args.dry_run:
        for j in all_jobs:
            print(f"{j['lang']}\t{j['key']}\t{j['speaker']}\t{j['text']}\t{j['ps']}")
        return

    todo = [j for j in all_jobs if args.force or not (Path(j['cache_mp3']).exists() and Path(j['cache_meta']).exists())]
    log(f'{len(all_jobs)} lines total, {len(todo)} to render, {len(all_jobs) - len(todo)} cached')
    t0 = time.time()
    if todo:
        cores = os.cpu_count() or 4
        workers = args.workers or max(1, min(len(todo), cores // 4, 6))
        threads = max(1, cores // workers)
        with cf.ProcessPoolExecutor(workers, initializer=_winit, initargs=(threads,)) as ex:
            futs = {ex.submit(render_job, j): j for j in todo}
            for n, f in enumerate(cf.as_completed(futs), 1):
                j = futs[f]
                try:
                    r = f.result()
                    log(f"  [{n}/{len(todo)}] {j['lang']} {j['key']:<24} {r['duration']:5.2f}s audio, {r['total_s']:5.2f}s cpu")
                except Exception as e:
                    log(f"  FAIL {j['lang']} {j['key']}: {e}")
                    raise
    log(f'render wall time {time.time() - t0:.1f}s')

    # publish
    for lang in langs:
        d = out_root / lang
        d.mkdir(parents=True, exist_ok=True)
        idx_p = d / 'index.json'
        index = load_json(idx_p) if (only and idx_p.exists()) else {}
        lines_meta = {}
        for j in (x for x in all_jobs if x['lang'] == lang):
            meta = load_json(Path(j['cache_meta']))
            dst = d / f"{j['key']}.mp3"
            src = Path(j['cache_mp3'])
            if not dst.exists() or dst.read_bytes() != src.read_bytes():
                shutil.copyfile(src, dst)
            index[j['key']] = meta['duration']
            lines_meta[j['key']] = {'speaker': j['speaker'], 'text': j['text'], 'ps': j['ps'],
                                    'voice': j['cfg']['voice'], 'hash': j['hash'], **meta}
        if not only:   # prune files of keys that are no longer voiced
            for f in d.glob('*.mp3'):
                if f.stem not in index:
                    f.unlink()
                    log(f'  removed stale {f}')
        index = dict(sorted(index.items()))
        with open(idx_p, 'w', encoding='utf-8') as f:
            json.dump(index, f, ensure_ascii=False, indent=0, separators=(',', ':'))
            f.write('\n')
        # build manifest for QA (not shipped)
        tag = '' if out_root.resolve() == OUT_ROOT.resolve() else f'_{out_root.name}'
        man_p = CACHE / f'manifest_{lang}{tag}.json'
        man = load_json(man_p) if (only and man_p.exists()) else {}
        man.update(lines_meta)
        man['_ur_method'] = args.ur_method if lang == 'ur' else None
        CACHE.mkdir(exist_ok=True)
        with open(man_p, 'w', encoding='utf-8') as f:
            json.dump(man, f, ensure_ascii=False, indent=1)
        size = sum(f.stat().st_size for f in d.glob('*.mp3'))
        log(f'[{lang}] {len(index)} files, {size / 1024:.0f} KiB -> {d}')
    if g2p.dropped:
        log(f'dropped phoneme symbols: {g2p.dropped}')


if __name__ == '__main__':
    main()
