"""Picks each phrase's take: N renders, reject any that lost words, keep the one that moves most.

  LD_LIBRARY_PATH=/usr/lib/wsl/lib ~/bs-voice/.venv-tts2/bin/python tools/film/takes.py tools/film/entry.json ~/bs-film/vo/entry [--n 3]

Resumable. Writes <out>/<shot>.<line>.<phrase>.wav and takes.json (seconds, word score, pitch range)."""
import argparse, json, os, re, time
import numpy as np, soundfile as sf, librosa, torch
from chatterbox.tts import ChatterboxTTS
from faster_whisper import WhisperModel
ap = argparse.ArgumentParser(); ap.add_argument('scene'); ap.add_argument('out'); ap.add_argument('--n', type=int, default=3); ap.add_argument('--refs', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tts', 'refs'))
a = ap.parse_args(); out = os.path.expanduser(a.out); os.makedirs(out, exist_ok=True)
d = json.load(open(a.scene)); log = f'{out}/takes.json'; done = json.load(open(log)) if os.path.exists(log) else {}
m = ChatterboxTTS.from_pretrained(device='cuda' if torch.cuda.is_available() else 'cpu')
W = WhisperModel('small', device='cpu', compute_type='int8')
norm = lambda s: re.sub(r"[^a-z' ]", '', s.lower()).split()


def score(w, sr, text):
    y = librosa.resample(w, orig_sr=sr, target_sr=16000)
    h = norm(' '.join(s.text for s in W.transcribe(y, language='en')[0])); t = norm(text)
    ok = sum(1 for x in t if x in h) / max(1, len(t))
    f0 = librosa.pyin(librosa.resample(w, orig_sr=sr, target_sr=22050), fmin=60, fmax=500, sr=22050)[0]; g = f0[~np.isnan(f0)]
    rng = float(np.ptp(12 * np.log2(g / np.median(g)))) if len(g) > 5 else 0
    return ok, rng


def trim(w, sr):
    """Tails of breath are fine, seconds of nothing aren't: the edit owns the pauses."""
    e = np.abs(w) > .012 * max(1e-6, np.abs(w).max() * 3); i = np.nonzero(e)[0]
    return w[max(0, i[0] - int(.03 * sr)):i[-1] + int(.12 * sr)] if len(i) else w


for s in d['shots']:
    for li, l in enumerate(s['lines']):
        for pi, (ph, gap) in enumerate(l['phrases']):
            key = f"{s['id']}.{li}.{pi}"
            if key in done: continue
            best = None; t0 = time.time()
            for k in range(a.n):
                w = m.generate(ph, audio_prompt_path=f"{a.refs}/{l['who']}_en.wav", exaggeration=l.get('ex', .8), cfg_weight=.3, temperature=.8 + .05 * k).squeeze().cpu().numpy()
                w = trim(w, m.sr); ok, rng = score(w, m.sr, ph); r = ok * 100 + min(rng, 14)
                if best is None or r > best[0]: best = (r, w, ok, rng)
                if ok == 1 and rng > 7: break
            sf.write(f'{out}/{key}.wav', best[1], m.sr)
            done[key] = dict(sec=round(len(best[1]) / m.sr, 3), words=round(best[2], 2), pitch=round(best[3], 1), text=ph)
            json.dump(done, open(log, 'w'), indent=0); print(key, done[key], round(time.time() - t0), 's', flush=True)
print('TAKESDONE', flush=True)
