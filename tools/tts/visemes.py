#!/usr/bin/env python3
"""Viseme tracks for the narrator's lines: which mouth shape, when, from the take's own audio.

lipsync.py reads three loudness bands, which is enough for a face seen in passing. MegaZroN is filmed speaking in
close-up, so his lines get a real track: the words are timed in the take by faster-whisper (word timestamps; QA
tooling only, nothing of it ships), each word is spelled out into mouth shapes (English by letter rules and a small
list of irregular words, Hindi, Urdu and Marathi from the Devanagari text, which is close to phonemic), and the
shapes are laid inside the word's own span, vowels longer than consonants.

Writes public/audio/vo/<lang>/visemes.json: { file: "cs:v,cs:v,..." } with cs = centiseconds from the start of the
take and v = one letter of VIS below; the last entry is the closing rest.

  ~/bin/heavy ~/bs-voice/.venv-tts2/bin/python tools/tts/visemes.py [--lang en,hi,ur] [--only 'mz.*']
"""
import argparse
import fnmatch
import json
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
FFMPEG = shutil.which('ffmpeg') or str(Path.home() / '.local' / 'bin' / 'ffmpeg')
# one letter per mouth shape (src/characters/visemes.ts holds the same list)
#  _ rest   P p b m   F f v   T th   D t d   K k g ng   C ch j sh   S s z   N n l   R r
#  A ah     E eh, the neutral vowel   I ee   O oh   U oo, w
VIS = '_PFTDKCSNRAEIOU'
VOWELS = set('AEIOU')

# English words the letter rules get wrong (the narrator's vocabulary; add to it as his lines are written)
WORDS = {
    'the': 'TE', 'a': 'E', 'of': 'AF', 'one': 'UAN', 'once': 'UANS', 'you': 'IU', 'your': 'IOR', "you're": 'IOR', 'to': 'DU', 'do': 'DU',
    'who': 'U', 'two': 'DU', 'i': 'AI', "i've": 'AIF', "i'll": 'AIN', "i'm": 'AIP', 'they': 'TEI', 'their': 'TER', 'there': 'TER',
    "they're": 'TER', 'are': 'AR', 'were': 'UER', 'was': 'UAS', 'what': 'UAD', 'where': 'UER', 'have': 'AF', "haven't": 'AFEND',
    'says': 'SES', 'said': 'SED', 'say': 'SEI', 'know': 'NO', 'knows': 'NOS', 'write': 'RAID', 'written': 'RIDEN', 'read': 'RID',
    'friends': 'FRENDS', 'friend': 'FREND', 'enjoy': 'ENCOI', 'decide': 'DISAID', 'believes': 'PINIFS', 'believe': 'PINIF',
    'number': 'NAPPER', 'nobody': 'NOPADI', "nobody's": 'NOPADIS', 'somebody': 'SAPPADI', 'screen': 'SKRIN', 'tickets': 'DIKEDS',
    'return': 'RIDERN', 'starts': 'SDARDS', 'early': 'ERNI', 'home': 'OP', 'come': 'KAP', 'some': 'SAP', 'most': 'POSD',
    'only': 'ONNI', 'ways': 'UEIS', 'way': 'UEI', 'day': 'DEI', 'forty': 'FORDI', 'six': 'SIKS', 'holiday': 'ANIDEI',
    'hole': 'ON', 'black': 'PNAK', 'ends': 'ENDS', 'how': 'AU', 'down': 'DAUN', 'more': 'POR', 'than': 'TAN', 'this': 'TIS',
    'them': 'TEP', 'like': 'NAIK', "doesn't": 'DASEND', "don't": 'DOND', 'which': 'UIC', 'try': 'DRAI', 'not': 'NAD', 'it': 'ID',
    'is': 'IS', 'as': 'AS', 'on': 'AN', 'in': 'IN', 'left': 'NEFD', 'yet': 'IED', 'sit': 'SID', 'past': 'PASD',
}

RULES = [  # longest first; (letters, shapes)
    ('tion', 'CEN'), ('sion', 'CEN'), ('ough', 'O'), ('augh', 'AF'), ('eigh', 'EI'), ('igh', 'AI'), ('tch', 'C'), ('sch', 'SK'), ('dge', 'C'),
    ('th', 'T'), ('sh', 'C'), ('ch', 'C'), ('ph', 'F'), ('wh', 'U'), ('ck', 'K'), ('ng', 'K'), ('qu', 'KU'), ('gh', ''), ('ee', 'I'),
    ('ea', 'I'), ('ie', 'I'), ('oo', 'U'), ('ou', 'AU'), ('ow', 'AU'), ('oa', 'O'), ('ai', 'EI'), ('ay', 'EI'), ('ey', 'EI'), ('ei', 'EI'),
    ('oi', 'OI'), ('oy', 'OI'), ('au', 'O'), ('aw', 'O'), ('er', 'ER'), ('ir', 'ER'), ('ur', 'ER'), ('ar', 'AR'), ('or', 'OR'),
    ('ll', 'N'), ('ss', 'S'), ('tt', 'D'), ('dd', 'D'), ('pp', 'P'), ('bb', 'P'), ('mm', 'P'), ('nn', 'N'), ('ff', 'F'), ('rr', 'R'),
]
SINGLE = dict(a='A', e='E', i='I', o='O', u='A', y='I', b='P', p='P', m='P', f='F', v='F', t='D', d='D', n='N', l='N', k='K', g='K', q='K',
              x='KS', s='S', z='S', j='C', r='R', w='U', h='', c='K')


def english(word: str) -> str:
    w = re.sub(r"[^a-z']", '', word.lower())
    if w in WORDS: return WORDS[w]
    w = w.replace("'", '')
    if not w: return ''
    out, i = '', 0
    if w.startswith('kn'): out, i = 'N', 2
    elif w.startswith('wr'): out, i = 'R', 2
    while i < len(w):
        for pat, v in RULES:
            if w.startswith(pat, i):
                out += v; i += len(pat); break
        else:
            ch = w[i]
            if ch == 'e' and i == len(w) - 1 and any(c in VOWELS for c in out):
                pass  # a silent final e
            elif ch == 'c' and i + 1 < len(w) and w[i + 1] in 'eiy': out += 'S'
            elif ch in 'aiou' and i + 2 < len(w) and w[i + 2] == 'e' and i + 3 == len(w) and w[i + 1] not in 'aeiouxw':
                out += {'a': 'EI', 'i': 'AI', 'o': 'O', 'u': 'U'}[ch]  # the e at the end makes the vowel long
            elif ch == 'y' and i == len(w) - 1 and len(w) <= 3: out += 'AI'
            else: out += SINGLE.get(ch, '')
            i += 1
    return re.sub(r'(.)\1+', r'\1', out)


DEVA_C = {}
for chars, v in (('कखगघङ', 'K'), ('चछजझ', 'C'), ('टठडढतथदध', 'D'), ('ञणनलळ', 'N'), ('पफबभम', 'P'), ('य', 'I'), ('र', 'R'), ('व', 'F'), ('शष', 'C'), ('स', 'S'), ('ह', '')):
    for ch in chars: DEVA_C[ch] = v
DEVA_V = {'अ': 'E', 'आ': 'A', 'इ': 'I', 'ई': 'I', 'उ': 'U', 'ऊ': 'U', 'ए': 'E', 'ऐ': 'AE', 'ओ': 'O', 'औ': 'AO', 'ऑ': 'O', 'ऋ': 'RI'}
DEVA_M = {'ा': 'A', 'ि': 'I', 'ी': 'I', 'ु': 'U', 'ू': 'U', 'े': 'E', 'ै': 'AE', 'ो': 'O', 'ौ': 'AO', 'ॉ': 'O', 'ृ': 'RI'}
NUKTA = {'ज': 'S', 'फ': 'F', 'ड': 'R', 'ढ': 'R'}  # ज़ फ़ ड़ ढ़


def devanagari(word: str) -> str:
    out, i, n = '', 0, len(word)
    while i < n:
        ch = word[i]
        if ch in DEVA_V: out += DEVA_V[ch]; i += 1; continue
        if ch in DEVA_C:
            v = DEVA_C[ch]; i += 1
            if i < n and word[i] == '़': v = NUKTA.get(ch, v); i += 1
            out += v
            if i < n and word[i] in DEVA_M: out += DEVA_M[word[i]]; i += 1
            elif i < n and word[i] == '्': i += 1
            elif i < n and word[i] in 'ंँः': out += 'E'
            elif i < n:
                # the inherent vowel, said inside a word and dropped at its end (and before a last consonant's matra)
                rest = word[i:]
                if not (len(rest) == 2 and rest[1] in DEVA_M and rest[0] in DEVA_C): out += 'E'
            continue
        if ch in 'ंँ': out += 'N'
        i += 1
    return re.sub(r'(.)\1+', r'\1', out)


def spell(word: str, lang: str) -> str:
    return english(word) if re.search('[a-zA-Z]', word) else devanagari(word) if re.search('[ऀ-ॿ]', word) else ''


def pcm(path: Path, sr=16000) -> np.ndarray:
    raw = subprocess.run([FFMPEG, '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', str(sr), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def speech_spans(x: np.ndarray, sr=16000):
    """Where the take has voice: [(start, end)] in seconds (10 ms frames over a floor, gaps under 120 ms bridged)."""
    hop = sr // 100
    n = len(x) // hop
    rms = np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(1))
    on = rms > max(0.012, np.percentile(rms, 95) * 0.07)
    spans, s = [], None
    for i, v in enumerate(on):
        if v and s is None: s = i
        if not v and s is not None: spans.append([s / 100, i / 100]); s = None
    if s is not None: spans.append([s / 100, n / 100])
    merged = []
    for a, b in spans:
        if merged and a - merged[-1][1] < 0.12: merged[-1][1] = b
        elif b - a >= 0.04: merged.append([a, b])
    return merged


def lay(words, spans_w):
    """Mouth shapes inside each word's span: [(time, letter)], closing with a rest."""
    out = []
    for shapes, (a, b) in zip(words, spans_w):
        if not shapes: continue
        wt = np.array([1.7 if s in VOWELS else 0.6 if s in 'PDK' else 1.0 for s in shapes])
        t = a + np.concatenate([[0], np.cumsum(wt)[:-1]]) / wt.sum() * (b - a)
        if out and out[-1][1] == '_' and a - out[-1][0] < 0.09: out.pop()  # words run together: no rest between them
        out += [(float(tt), s) for tt, s in zip(t, shapes)]
        out.append((float(b), '_'))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lang', default='en,hi,ur')
    ap.add_argument('--only', default='mz.*,*.mz.*')
    ap.add_argument('--dir', default=str(ROOT / 'public' / 'audio' / 'vo'))
    ap.add_argument('--text', default=str(ROOT / 'src' / 'i18n'))
    ap.add_argument('--model', default='small')
    a = ap.parse_args()
    from faster_whisper import WhisperModel
    model = WhisperModel(a.model, device='cpu', compute_type='int8', cpu_threads=8)
    pats = a.only.split(',')
    for lang in a.lang.split(','):
        d = Path(a.dir) / lang
        text = json.loads((Path(a.text) / f'{lang}.json').read_text())
        # Urdu is said as its Hindi line is spelled (the same spoken words for these lines); Devanagari gives the vowels
        deva = json.loads((Path(a.text) / 'hi.json').read_text()) if lang == 'ur' else text
        outp = d / 'visemes.json'
        out = json.loads(outp.read_text()) if outp.exists() else {}
        for f in sorted(d.glob('*.ogg')):
            key = f.stem.split('~')[0]
            if not any(fnmatch.fnmatch(key, p) for p in pats) or key not in text: continue
            line = deva.get(key, text[key])
            tw = [w for w in re.split(r"[^\w'ऀ-ॿ]+", line) if w]
            shapes = [spell(w, lang) for w in tw]
            x = pcm(f)
            segs, _ = model.transcribe(x, language=lang, word_timestamps=True, initial_prompt=text[key], condition_on_previous_text=False, vad_filter=False)
            ww = [(w.start, w.end) for s in segs for w in s.words]
            voiced = speech_spans(x)
            if len(ww) == len(tw):
                spans_w = [list(w) for w in ww]; how = 'words'
            else:
                # the count differs (a number read out, a word heard as two): the text's words are laid over the voiced
                # stretches of the take in proportion to their shapes
                tot = sum(b - a_ for a_, b in voiced) or 1e-6
                wts = np.array([max(1, len(s)) for s in shapes], float); cum = np.concatenate([[0], np.cumsum(wts)]) / wts.sum() * tot
                def at(u):
                    for a_, b in voiced:
                        if u <= b - a_ + 1e-9: return a_ + u
                        u -= b - a_
                    return voiced[-1][1] if voiced else 0
                spans_w = [[at(cum[i] + 1e-6), at(cum[i + 1])] for i in range(len(tw))]; how = f'spread ({len(ww)} heard, {len(tw)} written)'
            # the heard word times are loose round a pause (a word given the silence before it, or the tail of the word
            # before): each word keeps the longest voiced stretch inside its span, so no mouth moves through a pause
            for sp in spans_w:
                parts = [(max(a_, sp[0]), min(b, sp[1])) for a_, b in voiced if min(b, sp[1]) - max(a_, sp[0]) > 0.03]
                if parts: sp[0], sp[1] = max(parts, key=lambda q: q[1] - q[0])
            tr = lay(shapes, spans_w)
            out[f.stem] = ','.join(f'{round(t * 100)}:{s}' for t, s in tr)
            print(lang, f.stem, how, ' '.join(shapes), flush=True)
            print('  words', ' '.join(f'{w}@{sp[0]:.2f}-{sp[1]:.2f}' for w, sp in zip(tw, spans_w)), flush=True)  # (for timing a film's beats on the words)
        outp.write_text(json.dumps(out, separators=(',', ':'), ensure_ascii=False))
        print(lang, len(out), 'tracks', outp.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
