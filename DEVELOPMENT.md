# Development

Vite, TypeScript and three.js. Rendering is WebGL2.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173, Ultra preset by default
npm run build      # production build into dist/
npm run preview    # serve dist/ at http://localhost:4173
```

## Tests

Headless Chromium through Playwright. Software GL is fine.

```bash
npm run build
python3 tools/smoke.py --quality web          # boot, cinematic, wake-up, world shots
python3 tools/levels_smoke.py --quality web   # tutorial, scenes, levels end to end
python3 tools/mobile_smoke.py                 # iPhone 13 portrait, Pixel 7 landscape, real touch events
npm run smoke:desktop                         # boots the Electron app under Xvfb, drives it over CDP
```

`levels_smoke.py` plays through the real interaction code by teleporting to each
objective and pressing E via `window.__bs`, and advances game time with
`__bs.step()`. The scripts take `--out` or `--shots DIR` for screenshots and fall
back to any installed Playwright Chromium if the pinned build is missing.

## Quality presets

Presets are defined in `src/core/quality.ts`: Mobile (picked automatically on
phones), Web (default when hosted), Ultra (default on localhost) and Cinematic
(desktop builds only). Override with `?quality=web` or `?quality=ultra` in the
URL, or in Settings. `tools/gpu_test.py` measures frame rates on a real GPU.

## Windows build

```bash
npm ci && npm run build
cd electron && npm ci
npm start                 # run against dist/
npm run dist:win          # installer and zip in electron/release/ (works from Linux too)
```

Pushing a `desktop-v*` tag builds on `windows-latest` and attaches the files to a
Release (`.github/workflows/desktop.yml`). Saves stay in
`%APPDATA%\Beyond Sagittarius`. F11 toggles fullscreen.

## Deploy

`vite.config.ts` uses `base: './'`, so the build works from any sub-path.
`.github/workflows/pages.yml` builds and deploys to GitHub Pages on every push to
`main`.

## Voices

See [tools/tts/README.md](tools/tts/README.md).

## Logo

```bash
pip install shapely
python3 tools/brand/make_logo.py      # public/brand/*.svg
python3 tools/brand/render_brand.py   # PNGs, electron/build/icon.png, docs/social-preview.png
```

## Layout

```
src/
  main.ts       state machine: title, cinematic, wake-up, play
  core/         renderer, post-processing, quality presets, save, audio, voice
  characters/   the crew: bodies, faces, hair, outfits, motion
  narrator/     MegaZroN's Vault
  cinematic/    space dome, Earth, ship, deck, timeline, cutscene engine and scenes
  world/        terrain, sky, forest, foliage, grass, water, props, creatures
  game/         input, player, tutorial, survival, objectives, story, NPCs, tech
  ui/           HUD, menus, subtitles, modals, touch controls, creator
  i18n/         en.json, hi.json, ur.json, voice.json
```

[LEVELS.md](LEVELS.md) holds the level design notes.

## Moved from the README

```bash
python3 -m venv .venv-tts && .venv-tts/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv-tts/bin/pip install kokoro soundfile faster-whisper
npm run voice                      # every line in src/i18n/voice.json
.venv-tts/bin/python tools/tts/qa_voice.py   # ASR spot check
```

`levels_smoke.py` starts a new game through the name screen with custom
names, then completes every level through the real interaction code
(teleporting to each objective and pressing E via `window.__bs`, advancing
game time with `__bs.step()`), fights the level-7 predator, checks the save
survives a reload and renders the HUD in Hindi and Urdu. Both scripts take
`--out/--shots DIR` for the screenshots and fall back to any installed
Playwright Chromium build if the pinned one is missing.

## Deploy to GitHub Pages

`vite.config.ts` uses `base: './'`, so the build works from any sub-path.
`.github/workflows/pages.yml` builds and deploys on every push to `main`.
After creating the GitHub repository: *Settings → Pages → Source: GitHub
Actions*, then push.

## Characters and animation

Bodies are real rigged meshes, built offline and shipped in `public/models/crew/`:

```
~/.venvs/ehd/bin/python tools/fetch_character_assets.py   # MakeHuman CC0 data and packs, CMU takes (resumable)
~/.venvs/ehd/bin/python tools/build_animations.py         # Quaternius loops + CMU takes -> retarget -> anim.glb, anim.json
~/.venvs/ehd/bin/python tools/build_characters.py         # bodies, clothes, morphs, LODs, textures
~/.venvs/ehd/bin/python tools/chars/credits.py            # asset table, fails on a disallowed licence
```

`build_characters.py` applies MakeHuman macro targets per crew member (tall lean, huge, slim, athletic,
short wide, curvy), fits clothes to the body through their `.mhclo` triangles, inherits skin weights,
hides what sits under each layer, reduces the mesh with a quadric collapse that keeps UV seams, and writes
GLBs with `KHR_mesh_quantization`, sparse face morphs and a 57-bone rig whose rest rotations are all identity,
so one set of clips fits every body. Skin is a neutral photo map coloured in the shader, which is how
the character creator's colours, marks and ears work on the same mesh. Creator bodies add slim and heavy
morphs. At runtime `src/characters/character.ts` plays clips through `THREE.AnimationMixer` with crossfades,
phase-locked walk/run/sprint blending, per-character walk and idle styles, leg IK onto the terrain, clamped head look,
blinks, speech and expression morphs. Frame rate on real GPUs for this version has not been measured.

## Project layout

```
src/
  main.ts               state machine: title → cinematic → wake-up → play
  core/                 renderer + post-processing, quality presets, noise,
                        save/settings, audio buses, voice playback, textures
  characters/           the crew: skinned bodies loaded from GLB, mocap playback, foot planting, anime hair, props
  narrator/             MegaZroN's Vault
  cinematic/            space dome (stars, nebula, black hole), Earth, ship,
                        observation deck, timeline, cutscene engine and scenes
  world/                terrain, sky, forest, foliage, grass, water, props, the
                        Walker, story.ts (camp, ridge, layout), predator.ts
  game/                 input, player controller, tutorial, survival + objectives,
                        story.ts (levels 4-10, predator AI, crewmate)
  ui/                   HUD, menus, subtitles, modals, touch controls, portraits
  i18n/                 en.json, hi.json, ur.json
```

## Roadmap (full design)

1. ~~**The First 24 Hours**~~: done (levels 1–10).
2. **Finding the friends**: the beacon gave bearings to the other four;
   each rescued crew member unlocks their skill tree and changes how the group
   survives.
3. **Nine ages of civilisation**, drawing on human history: Stone → Fire &
   Tools → Agriculture → Bronze → Iron → Classical → Industrial → Space →
   Civilisation.
4. **The mystery system**: ruins, signals and artefacts that don't add up.
5. **Level 99**: *"SUBJECTS: SIX. ORIGIN: EARTH. … YOU WERE NOT THE FIRST TO
   ARRIVE … HUMANITY HAS BEEN HERE BEFORE … WELCOME BACK."*
6. **Co-op multiplayer** for the six crew roles.
7. More languages; customisable genders (names are done); WebGPU renderer.

The beacon's `ORIGIN: EARTH` is the first thread of Level 99: none of the six has ever stood on Earth, and something recognised them anyway.

## Credits

See [CREDITS.md](CREDITS.md). Photo textures and the HDRI are CC0 from Poly Haven; voices are Kokoro-82M (Apache-2.0).
