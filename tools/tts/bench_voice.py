#!/usr/bin/env python3
"""Compare TTS candidates on the same emotional lines. Resumable: existing takes are skipped.

  render : .venv-tts2/bin/python tools/tts/bench_voice.py render cb_en cb_mtl cb_hi
  score  : .venv-tts2/bin/python tools/tts/bench_voice.py score

Takes go to tools/tts/.cache/bench/<system>/<lang>/<key>.wav with a .json holding
synth seconds. Scores: Whisper-small CER against the script, duration, and pitch
variation (F0 std in semitones, pYIN). None of these measures naturalness.
"""
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
BENCH = HERE / '.cache' / 'bench'
sys.path.insert(0, str(HERE))
# (key, what it tests, exaggeration, cfg)
LINES = [
    ('op.16', 'sarcasm', 0.45, 0.5),
    ('wake.line4', 'fear', 0.85, 0.3),
    ('dlg.9.5', 'pain into laughter', 0.8, 0.35),
    ('mz.intro.1', 'calm narration', 0.5, 0.45),
    ('op.2', 'deadpan', 0.35, 0.5),
    ('cine.line7', 'panic', 0.95, 0.3),
]
FFMPEG = shutil.which('ffmpeg') or str(Path.home() / '.local' / 'bin' / 'ffmpeg')


def load(lang):
    return json.loads((ROOT / 'src' / 'i18n' / f'{lang}.json').read_text(encoding='utf-8'))


def speakers():
    return json.loads((ROOT / 'src' / 'i18n' / 'voice.json').read_text(encoding='utf-8'))['lines']


def text_for(key, lang):
    s = load(lang)
    names = {m.group(1): v for k, v in s.items() if (m := re.fullmatch(r'crew\.(\w+)\.name', k))}
    t = re.sub(r'\{[fn]:(\w+)\}', lambda m: names[m.group(1)], s[key])
    t = t.replace('“', '').replace('”', '').replace('"', '').replace('۔', '.').replace('؟', '?').replace('،', ',').replace('।', '.')
    if lang == 'ur':
        from ur2deva import urdu_line_to_devanagari
        hi = load('hi')
        hn = {m.group(1): v for k, v in hi.items() if (m := re.fullmatch(r'crew\.(\w+)\.name', k))}
        t = urdu_line_to_devanagari(t, re.sub(r'\{[fn]:(\w+)\}', lambda m: hn[m.group(1)], hi[key]))[0]
    return t


def write(system, lang, key, wav, sr, secs):
    import soundfile as sf
    d = BENCH / system / lang
    d.mkdir(parents=True, exist_ok=True)
    sf.write(d / f'{key}.wav', np.asarray(wav, dtype=np.float32).squeeze(), sr)
    n = np.asarray(wav).squeeze().shape[-1] / sr
    (d / f'{key}.json').write_text(json.dumps({'synth_s': round(secs, 2), 'audio_s': round(n, 2), 'rtf': round(secs / max(n, .01), 2)}))
    print(system, lang, key, f'{n:.1f}s audio in {secs:.0f}s rtf {secs / max(n, .01):.1f}', flush=True)


def done(system, lang, key):
    return (BENCH / system / lang / f'{key}.json').exists()


def render_cb(system):
    import torch
    torch.set_num_threads(16)
    sp = speakers()
    if system == 'cb_en':
        from chatterbox.tts import ChatterboxTTS
        m, langs = ChatterboxTTS.from_pretrained('cpu'), ['en']
    elif system == 'cb_turbo':
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        m, langs = ChatterboxTurboTTS.from_pretrained('cpu'), ['en']
    else:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        m, langs = ChatterboxMultilingualTTS.from_pretrained(torch.device('cpu')), ['en', 'hi', 'ur']
    for lang in langs:
        for key, _, ex, cfg in LINES:
            if done(system, lang, key):
                continue
            ref = HERE / 'refs' / f"{sp[key]}_{'en' if lang == 'en' else 'hi'}.wav"
            t0 = time.time()
            kw = dict(audio_prompt_path=str(ref), exaggeration=ex, cfg_weight=cfg)
            if system == 'cb_turbo':     # takes no exaggeration or cfg; tags carry the delivery
                tag = {'dlg.9.5': ' [laugh]', 'wake.line4': ' [gasp]', 'op.16': ' [sigh]'}.get(key, '')
                w = m.generate(text_for(key, lang) + tag, audio_prompt_path=str(ref))
            elif system == 'cb_en':
                w = m.generate(text_for(key, lang), **kw)
            else:
                w = m.generate(text_for(key, lang), language_id='en' if lang == 'en' else 'hi', **kw)
            write(system, lang, key, w.cpu().numpy(), m.sr, time.time() - t0)


def render_dia():
    """English only (model card). Non-verbals in parentheses, as the card documents."""
    import torch
    from transformers import AutoProcessor, DiaForConditionalGeneration
    torch.set_num_threads(16)
    repo = 'nari-labs/Dia-1.6B-0626'
    proc = AutoProcessor.from_pretrained(repo)
    m = DiaForConditionalGeneration.from_pretrained(repo).eval()
    tags = {'dlg.9.5': ' (laughs)', 'wake.line4': ' (gasps)'}
    for key, *_ in LINES:
        if done('dia', 'en', key):
            continue
        t0 = time.time()
        inp = proc(text=[f"[S1] {text_for(key, 'en')}{tags.get(key, '')}"], padding=True, return_tensors='pt')
        with torch.no_grad():
            out = m.generate(**inp, max_new_tokens=1024, guidance_scale=3.0, temperature=1.8, top_p=0.9, top_k=45)
        wav = proc.batch_decode(out)[0]
        write('dia', 'en', key, np.asarray(wav).squeeze(), 44100, time.time() - t0)


def render_bark():
    """Bark's own preset speakers; [laughs]/[sighs]/[gasps] are its documented cues."""
    import torch
    from transformers import AutoProcessor, BarkModel
    torch.set_num_threads(16)
    repo = 'suno/bark-small'
    proc = AutoProcessor.from_pretrained(repo)
    m = BarkModel.from_pretrained(repo).eval()
    tags = {'dlg.9.5': ' [laughs]', 'wake.line4': ' [gasps]'}
    for lang in ('en', 'hi', 'ur'):
        preset = 'v2/en_speaker_6' if lang == 'en' else 'v2/hi_speaker_2'
        for key, *_ in LINES:
            if done('bark', lang, key):
                continue
            t0 = time.time()
            inp = proc(text_for(key, lang) + tags.get(key, ''), voice_preset=preset)
            with torch.no_grad():
                w = m.generate(**inp, do_sample=True).cpu().numpy().squeeze()
            write('bark', lang, key, w, m.generation_config.sample_rate, time.time() - t0)


def f0_std(y, sr):
    import librosa
    f0, voiced, _ = librosa.pyin(y, fmin=60, fmax=500, sr=sr)
    f = f0[voiced & ~np.isnan(f0)]
    return float(np.std(12 * np.log2(f / np.median(f)))) if len(f) > 5 else 0.0


def score():
    import librosa
    from faster_whisper import WhisperModel
    from qa_voice import cer, norm
    model = WhisperModel('small', device='cpu', compute_type='int8', cpu_threads=8)
    report = {}
    for sysdir in sorted(p for p in BENCH.iterdir() if p.is_dir()):
        for ld in sorted(p for p in sysdir.iterdir() if p.is_dir()):
            lang, rows = ld.name, []
            ref = load(lang)
            for key, what, _, _ in LINES:
                f = next((ld / f'{key}.{e}' for e in ('wav', 'mp3') if (ld / f'{key}.{e}').exists()), None)
                if not f:
                    continue
                y, sr = librosa.load(f, sr=16000, mono=True)
                segs, _ = model.transcribe(y, language=lang, beam_size=2)
                hyp = ' '.join(s.text for s in segs)
                meta = ld / f'{key}.json'
                rows.append({'key': key, 'what': what, 'cer': round(cer(norm(ref[key]), norm(hyp)), 3),
                             'dur': round(len(y) / sr, 2), 'f0_st': round(f0_std(y, sr), 2),
                             'rtf': json.loads(meta.read_text())['rtf'] if meta.exists() else None, 'hyp': hyp})
            if rows:
                rt = [r['rtf'] for r in rows if r['rtf'] is not None]
                report[f'{sysdir.name}/{lang}'] = {'n': len(rows), 'cer': round(float(np.mean([r['cer'] for r in rows])), 3),
                                                   'f0_st': round(float(np.mean([r['f0_st'] for r in rows])), 2),
                                                   'rtf': round(float(np.mean(rt)), 2) if rt else None, 'rows': rows}
                r = report[f'{sysdir.name}/{lang}']
                print(f"{sysdir.name:14}{lang:4} n={r['n']} CER {r['cer']:.3f}  F0sd {r['f0_st']:.2f}st  RTF {r['rtf']}", flush=True)
    (HERE / 'bench_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')


def baseline():
    """Kokoro's shipped takes as the reference point."""
    for lang in ('en', 'hi', 'ur'):
        d = BENCH / 'kokoro' / lang
        d.mkdir(parents=True, exist_ok=True)
        for key, *_ in LINES:
            shutil.copyfile(ROOT / 'public' / 'audio' / 'vo' / lang / f'{key}.mp3', d / f'{key}.mp3')


if __name__ == '__main__':
    if sys.argv[1] == 'score':
        baseline()
        score()
    else:
        for s in sys.argv[2:]:
            {'dia': render_dia, 'bark': render_bark}.get(s, lambda s=s: render_cb(s))()
