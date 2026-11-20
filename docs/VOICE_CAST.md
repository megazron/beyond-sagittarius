# Voice cast

Every speaking character has one voice for every line they say, in every scene, level and bark. Lines are rendered
offline by `tools/tts/generate_voice.py` with Chatterbox (MIT, Resemble AI): the English model for English, the
multilingual model for Hindi and Urdu (Urdu is read through Devanagari, `ur2deva.py`), each conditioned on the same
reference clip per character in every language, so a character keeps one voice across the three. Each take is checked
with Whisper (redone with a new seed, up to three times, if what it says drifts from the script; the character error
rate of every take is in the cache's `.json` next to it), loudness matched to -18 LUFS and encoded as Opus in Ogg at
28 kb/s. On a CUDA GPU (`--device cuda`) the text-to-token model runs in half precision, which fits a 4 GB laptop GPU
next to the desktop and renders a line in about twice its length. Casting lives in `tools/tts/voices.json`, the
reading of each line (emotion, intensity, pace, pauses) in `tools/tts/direction.json`.

Reference clips are never a recording of a real, identifiable person used without consent:

- **Synthetic**: made by `tools/tts/make_refs.py` from Kokoro-82M voicepacks (Apache-2.0), a voice no person has.
- **LibriTTS-R**: whole utterances of one corpus reader (Google LLC, CC BY 4.0, from LibriVox recordings the readers
  released), joined to about 12 s by `tools/tts/libritts_refs.py`; readers are named only by corpus speaker id in
  `tools/tts/libritts_cast.json`. Used for the Zenvora townsfolk, so the street does not sound like six people.

Mir (Drexon) looks like a real person but speaks with an original synthetic voice, nothing taken from that person.

| Character | Who | Reference | Delivery |
| --- | --- | --- | --- |
| Zenvik (scientist, the player) | nervous, overthinks | Kokoro am_michael | pace 1.03 |
| Zenvik as a woman | the same, used for every `~f` take | Kokoro af_nicole + af_sky | pace 1.03 |
| Draxum (strong) | deadpan gym bro, big | Kokoro am_fenrir | pitch -1.5, pace 0.97 |
| Lyrra (medic) | calm, dry sarcasm | Kokoro bf_emma | |
| Skyvra (explorer) | hype, playful | Kokoro af_bella | pitch +0.5, pace 1.04 |
| Bolzar (builder) | easygoing, "it will hold" | Kokoro am_puck | pace 0.98 |
| Nuvexa (social) | loud influencer | Kokoro af_heart | pace 1.03 |
| MegaZroN (narrator) | deep, theatrical, dry, rude | Kokoro bm_george + am_onyx | pitch -2.5, low shelf |
| Ship AI | synthetic, filtered | Kokoro bf_isabella | band-limited, comb echo, compressed |
| The signal | eerie, layered | Kokoro am_onyx | three pitched layers, phaser, echoes |
| Tovik (trader) | fast-talking shopkeeper | Kokoro am_eric | pace 1.08 |
| Oom-Sa (local) | slow, odd, alien | Kokoro af_kore | pitch +1.5, phaser |
| Yuvax (hermit) | old, dry, knowing | Kokoro bm_lewis | pitch -1, pace 0.92 |
| Pello (traveller) | weary complaining tourist | Kokoro bm_daniel | pace 0.97 |
| Mir / Drexon (cameo) | deadpan, flat, calm, in a suit | Kokoro am_echo | pace 0.97 |
| Ammi (the player's mother, on a call) | warm, worried, firm | LibriTTS-R 3576 | pace 0.97 |
| Chai uncle | deep, slow, amused | LibriTTS-R 2803 | pitch -1 |
| Rishta aunty | bright, quick, nosy | LibriTTS-R 2035 | pitch +0.5, pace 1.05 |
| Capple clerk | quick, bored salesman | LibriTTS-R 2086 | pace 1.04 |
| Hover-auto driver | fast haggler | LibriTTS-R 777 | pace 1.1 |
| Cricket kids | loud, cheeky | LibriTTS-R 3081 and 3536 | pitched up with the formants, into kids |
| Hungry man in the queue | low, weary | LibriTTS-R 5536 | |
| Hungry woman in the queue | brisk, dreamy about food | LibriTTS-R 1988 | |
| Pharmacist | calm, patient, tired | LibriTTS-R 6319 | |
| Tourist | light, curious, lost | LibriTTS-R 3170 | |
| Parcel locker | a cheerful machine | LibriTTS-R 6295 | band-limited, bit-crushed |

Lines several people speak (`"Ammi: Did you eat? Me: ..."`, the friends' `"Draxum: ..."` in Zenvora) are marked
`scene` in `src/i18n/voice.json`: each person's part is rendered in their own voice and the parts are joined with a
short beat between speakers.

English is voiced throughout. Hindi and Urdu have the lines rendered before the Zenvora prologue and the black hole
scenes; lines without a Hindi or Urdu take play in English under Hindi or Urdu subtitles (`src/core/voice.ts`).

Every scientist line also has a `~f` take for a woman player (rendered with Chatterbox Turbo from the same reference,
`--turbo '*~f'`), and lines that name a renamed crewmate have a name-free
`~anon` take.
