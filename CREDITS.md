# Credits & licences

BEYOND SAGITTARIUS is an original game design by its owner. Every 3D model,
texture, shader, sound and animation in this repository is generated
procedurally in code at runtime. No third-party models, textures or audio files
are downloaded or bundled.

## Libraries

| Library | Use | Licence |
| --- | --- | --- |
| [three.js](https://threejs.org) (r187) incl. `examples/jsm` post-processing (EffectComposer, UnrealBloomPass, GTAOPass, OutputPass, ShaderPass) and `BufferGeometryUtils` | Rendering | MIT |
| [Vite](https://vitejs.dev) | Build tool (dev only) | MIT |
| [TypeScript](https://www.typescriptlang.org) | Language (dev only) | Apache-2.0 |

## Fonts

Loaded at runtime from **Google Fonts** (`fonts.googleapis.com`), all under the
[SIL Open Font License 1.1](https://openfontlicense.org):

- **Orbitron** (Matt McInerney) — display/HUD Latin text
- **Exo 2** (Natanael Gama) — body Latin text
- **Noto Sans Devanagari** (Google) — Hindi
- **Noto Nastaliq Urdu** (Google) — Urdu (titles, subtitles, story text)
- **Noto Naskh Arabic** (Google) — Urdu fallback and small HUD labels

When the game runs offline the fonts fall back to system fonts. To self-host,
download the same families from Google Fonts into `public/fonts/` and replace
the `<link>` in `index.html` with `@font-face` rules.

## Algorithms

- 2D simplex noise after Stefan Gustavson's public-domain reference implementation.
- `hash12/13/33` GLSL hashes after David Hoskins' "Hash without Sine" (MIT).
- Black hole light bending uses the well-known photon-orbit approximation
  `a = -1.5 h² r̂ / r⁴` (Schwarzschild, units of r_s), written from scratch.

## Translations

English, Hindi and Urdu text was written for this project (see `src/i18n/`).
