# Voice tools

Everything here runs at build time on the developer's machine. Nothing ships except the audio.

| File | What it does |
| --- | --- |
| `generate_voice.py` | Renders every line to `public/audio/vo/<lang>/` (`npm run voice`). Resumable. |
| `voices.json` | Casting: reference clip, pace, pitch and effects per speaker. |
| `direction.json` | Delivery per line: emotion, intensity, pace, pauses, tags, effects. |
| `pronunciations.json` | Respellings per language. For Urdu these fix transliteration mistakes. |
| `make_refs.py`, `refs.json`, `refs/` | Synthetic reference clips from Kokoro voicepacks. |
| `ur2deva.py` | Urdu script to Devanagari, so a Hindi model can read the Urdu words. |
| `voice_overrides.py` | Indexes recorded takes (`npm run voice:overrides`, also runs before `npm run build`). |
| `fetch_human.py` | Cuts `public/audio/sfx/human/` from CC0 recordings. |
| `bench_voice.py`, `qa_voice.py` | Model comparison and ASR spot checks. |
| `../voice_script.py` | Exports the script as CSV for actors. |

## Rendering

```sh
python3 -m venv .venv-tts2
.venv-tts2/bin/pip install chatterbox-tts faster-whisper pyloudnorm soundfile librosa 'setuptools<81'
npm run voice                                # every line, skipping what is cached
npm run voice -- --lang hi --only 'dlg.9.*'  # a subset
```

`setuptools<81` matters: Chatterbox's watermarker imports `pkg_resources`, which newer
setuptools removed. Do not work around that by turning the watermark off.

Text is read from `src/i18n/` at run time, so changing a line re-renders only that line.
A killed run loses at most the line in progress. Each take is transcribed and retaken with
a new seed if it drifts from the script.

Line variants: `<key>~anon` is used when a crewmate named in the line was renamed, and
`<key>~f` for a female player. `~f` text comes from `vo.f.<key>`, then `g.f.<key>`, then the
normal line. Scientist lines use the `scientist_f` voice for `~f`.

## Never clone a real person

Chatterbox copies the voice of its reference clip. Only use clips from `make_refs.py`, which
are synthetic. Never put a recording of a real person in `refs/`.

## Recording real actors

1. `python3 tools/voice_script.py --out voice_script.csv` gives line id, character, emotion,
   language and text. Use `--lang hi` for one language. The file opens in Excel with Hindi
   and Urdu intact.
2. Save each take as `public/audio/voice/override/<language>/<line id>.ogg`, for example
   `public/audio/voice/override/hi/op.2.ogg` or `.../en/dlg.10.3~anon.ogg`.
3. Run `npm run voice:overrides` and commit the takes with `override/index.json`.

That is all: the game prefers a recorded take over the generated line and times scenes from
its real length. The index must be committed because the Pages build has no ffmpeg.

Safari may not decode `.ogg`, so also add a `.mp3` or `.m4a` of the same name if you want
Safari covered. When several formats exist the game tries mp3, then m4a, then ogg, and falls
back to the generated line if none decodes. Get written consent from every actor.
