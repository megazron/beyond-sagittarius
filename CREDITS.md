# Credits & licences

BEYOND SAGITTARIUS is an original game design by its owner. Crew, creatures,
hair, clothes, the Vault, shaders and synthesised sound effects are generated
in code at runtime. The photo textures, scanned models, the HDRI and the voice
model below are third-party and credited here. Every in-game company or
product name is a made-up parody.

## Libraries

| Library | Use | Licence |
| --- | --- | --- |
| [three.js](https://threejs.org) (r187) incl. `examples/jsm` post-processing (EffectComposer, UnrealBloomPass, GTAOPass, FXAAPass, OutputPass, ShaderPass), loaders (HDRLoader, GLTFLoader, meshopt decoder), SunLight and `BufferGeometryUtils` | Rendering | MIT |
| [Electron](https://www.electronjs.org) (includes Chromium; its notices ship as `LICENSES.chromium.html` in the download) | Desktop build runtime | MIT |
| [electron-builder](https://www.electron.build) | Desktop packaging (dev only) | MIT |
| [Vite](https://vitejs.dev) | Build tool (dev only) | MIT |
| [TypeScript](https://www.typescriptlang.org) | Language (dev only) | Apache-2.0 |

## Graphics assets (all CC0 1.0, public domain)

From [Poly Haven](https://polyhaven.com) ([licence](https://polyhaven.com/license)). Everything is re-downloaded
and rebuilt by `tools/fetch_assets.py`.

### Textures

Re-encoded to WebP at 512 / 1k / 2k into `public/textures/`.

| Used for | Asset | Source | Licence |
| --- | --- | --- | --- |
| Ground | Forrest Ground 01 | https://polyhaven.com/a/forrest_ground_01 | CC0 |
| Dirt | Forest Ground 04 | https://polyhaven.com/a/forest_ground_04 | CC0 |
| Lake shore mud | Mud Forest | https://polyhaven.com/a/mud_forest | CC0 |
| Rock, cliffs | Rock Face 03 | https://polyhaven.com/a/rock_face_03 | CC0 |
| Alien grove bark (fallback) | Bark Brown 02 | https://polyhaven.com/a/bark_brown_02 | CC0 |
| Escape pod metal | Blue Metal Plate | https://polyhaven.com/a/blue_metal_plate | CC0 |
| Image-based lighting (`public/hdri/sky_1k.hdr`) | Misty Pines HDRI | https://polyhaven.com/a/misty_pines | CC0 |

### Scanned models and foliage

Models are split into single rocks or plants, decimated to three LODs with
[gltfpack](https://github.com/zeux/meshoptimizer) (MIT, build-time only) and packed, quantised and
meshopt-compressed, into `public/models/world/`, with WebP textures in `public/textures/m/`. Tree crowns
use cards composed from the real twig and leaf sheets, in `public/textures/foliage/`.

| Used for | Asset | Authors | Source | Licence |
| --- | --- | --- | --- | --- |
| Scanned rock | Boulder 01 | Rico Cilliers | https://polyhaven.com/a/boulder_01 | CC0 |
| Scanned rock | Namaqualand Boulder 03 | Jenelle van Heerden, Dario Barresi | https://polyhaven.com/a/namaqualand_boulder_03 | CC0 |
| Scanned rock | Namaqualand Boulder 04 | Jenelle van Heerden | https://polyhaven.com/a/namaqualand_boulder_04 | CC0 |
| Scanned rock | Rock Moss Set 01 | Kless Gyzen | https://polyhaven.com/a/rock_moss_set_01 | CC0 |
| Scanned rock | Rock Moss Set 02 | Kless Gyzen | https://polyhaven.com/a/rock_moss_set_02 | CC0 |
| Scanned outcrop | Rock Face 01 | Dario Barresi | https://polyhaven.com/a/rock_face_01 | CC0 |
| Scanned outcrop | Rock Face 02 | Dario Barresi, Rico Cilliers | https://polyhaven.com/a/rock_face_02 | CC0 |
| Scanned outcrop | Mountainside | Dario Barresi, Rico Cilliers | https://polyhaven.com/a/mountainside | CC0 |
| Scanned outcrop | Namaqualand Cliff 01 | Jenelle van Heerden, Rico Cilliers | https://polyhaven.com/a/namaqualand_cliff_01 | CC0 |
| Scanned stump | Tree Stump 01 | Rob Tuytel | https://polyhaven.com/a/tree_stump_01 | CC0 |
| Scanned stump | Tree Stump 02 | Rob Tuytel | https://polyhaven.com/a/tree_stump_02 | CC0 |
| Scanned log | Dead Tree Trunk | Rob Tuytel | https://polyhaven.com/a/dead_tree_trunk | CC0 |
| Scanned log | Dead Tree Trunk 02 | Jenelle van Heerden, Rico Cilliers | https://polyhaven.com/a/dead_tree_trunk_02 | CC0 |
| Scanned roots | Pine Roots | Rob Tuytel | https://polyhaven.com/a/pine_roots | CC0 |
| Scanned roots | Root Cluster 01 | Jenelle van Heerden, Rico Cilliers | https://polyhaven.com/a/root_cluster_01 | CC0 |
| Scanned branch | Dry Branches Medium 01 | Rico Cilliers | https://polyhaven.com/a/dry_branches_medium_01 | CC0 |
| Scanned plant | Fern 02 | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/fern_02 | CC0 |
| Scanned shrub | Shrub 02 | Rico Cilliers | https://polyhaven.com/a/shrub_02 | CC0 |
| Scanned plant | Nettle Plant | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/nettle_plant | CC0 |
| Scanned plant | Weed Plant 02 | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/weed_plant_02 | CC0 |
| Fir boughs (twig sheet) and tree bark | Fir Tree 01 | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/fir_tree_01 | CC0 |
| Pine boughs (twig sheet) | Pine Tree 01 | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/pine_tree_01 | CC0 |
| Broad-leaf crowns (leaf sheet) | Island Tree 01 | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/island_tree_01 | CC0 |

### Made for this game

The water normal map (FFT wave spectrum) and the hydraulic erosion of the mountains
(`public/models/world/erosion_*.bin`, from `tools/bake_erosion.ts`) are generated, not sourced.
Clouds, the sky, the giant planet and the moon are shaders. The Windows build can add 4K versions of the same
assets (`tools/fetch_assets.py --desktop`, not in this repository).

## Voices

All dubbing in `public/audio/vo/` is synthetic speech rendered locally by `tools/tts/generate_voice.py`.

| Component | Use | Licence |
| --- | --- | --- |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (hexgrad), model weights and voicepacks | Text to speech, English and Hindi voices (also used for Urdu) | Apache-2.0 |
| [kokoro](https://github.com/hexgrad/kokoro) Python package | Inference | Apache-2.0 |
| [misaki](https://github.com/hexgrad/misaki) | Grapheme-to-phoneme | Apache-2.0 |
| [espeak-ng](https://github.com/espeak-ng/espeak-ng) via `espeakng-loader` | Hindi and Urdu phonemes, build-time tool only; not distributed with the game and its GPL-3.0 does not cover the generated audio | GPL-3.0 (tool) |
| [FFmpeg](https://ffmpeg.org) | Pitch, room and filter effects, MP3 encoding, build-time only | LGPL/GPL (tool) |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) with Whisper small | Build-time quality check of the audio only; nothing from it ships | MIT |

## Fonts

Loaded at runtime from **Google Fonts** (`fonts.googleapis.com`), all under the
[SIL Open Font License 1.1](https://openfontlicense.org):

- **Orbitron** (Matt McInerney): display/HUD Latin text
- **Exo 2** (Natanael Gama): body Latin text
- **Noto Sans Devanagari** (Google): Hindi
- **Noto Nastaliq Urdu** (Google): Urdu (titles, subtitles, story text)
- **Noto Naskh Arabic** (Google): Urdu fallback and small HUD labels

When the game runs offline the fonts fall back to system fonts. To self-host,
download the same families from Google Fonts into `public/fonts/` and replace
the `<link>` in `index.html` with `@font-face` rules.

## Logo

The wordmark and emblem in `public/brand/` were drawn for this project by
`tools/brand/make_logo.py`. No font is used: the letters are original outlines.

## Algorithms

- 2D simplex noise after Stefan Gustavson's public-domain reference implementation.
- `hash12/13/33` GLSL hashes after David Hoskins' "Hash without Sine" (MIT).
- Black hole light bending uses the well-known photon-orbit approximation
  `a = -1.5 h² r̂ / r⁴` (Schwarzschild, units of r_s), written from scratch.

## Translations

English, Hindi and Urdu text was written for this project (see `src/i18n/`).
