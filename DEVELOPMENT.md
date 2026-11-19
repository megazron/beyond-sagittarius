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

Headless Chromium through Playwright, pinned to 1.63 (1.64's Chromium hangs on the tutorial's mouse-look drag). Make
the test venv once with `tools/test_env.sh` (`~/.venvs/bs-test`); every test re-runs itself under it
(`tools/pw_pin.py`), so `python3 tools/...` works from any Python. Software GL is fine.

```bash
npm run build
python3 tools/smoke.py --quality web          # boot, cinematic, wake-up, world shots
python3 tools/levels_smoke.py --quality web   # tutorial, scenes, levels end to end
python3 tools/mobile_smoke.py                 # iPhone 13 portrait, Pixel 7 landscape, real touch events
python3 tools/prologue_smoke.py --quality web # a new game's opening: MegaZroN, Zenvora, the take-off, the films
npm run smoke:desktop                         # boots the Electron app under Xvfb, drives it over CDP
```

A new game opens on MegaZroN in the Vault, then the title card and the playable Zenvora prologue, the six boarding
and the liner lifting off over the city (the city stage's `outro`, letterboxed, with its Skip), a card for orbit, and
then the deck, the title sequence and the wake-up. Continue skips all of it; Chapters has "The opening" to watch it
again (in the replay slot, so the story stays as it was); the System setting and `?prologue=0` leave the city out.

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

## Android build (Google Play)

Capacitor 8 wraps the built game in `android/` (package `com.megazron.beyondsagittarius`, target and
compile SDK 36, min SDK 29). Everything ships inside the app; it has no permissions, not even internet.
Hardware back and app pause/resume reach the game through `src/core/android.ts`.

```bash
store/release.sh 1.0.1      # bump, build, sync, sign, check: AAB in ~/beyond-sagittarius-release/
npx cap sync android        # after any `npm run build`, to refresh android/app/src/main/assets/public
python3 tools/android/check_aab.py <aab>          # target SDK, permissions, 16 KB pages, download size
python3 tools/android/app_smoke.py                # the bundled files in an emulated phone with a fake Capacitor bridge
python3 tools/android/make_icons.py               # launcher icons, splash, store icon and feature graphic
python3 tools/android/privacy_page.py             # PRIVACY.md -> public/privacy.html
```

Needs `~/tools/android-sdk` (cmdline-tools, platform 36, build-tools 36) and JDK 21. The upload key lives in
`~/beyond-sagittarius-keys/`, never in git. The Play Store steps are in `store/PLAYSTORE_GUIDE.md`.

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
blinks, speech and expression morphs.

Skin and cloth: skin a garment covers in every pose the game takes (`tools/chars/cap_poses.json` and each body's own
poses) and that stays at least 6 cm from all of the garment's openings can only be seen by coming out through the
cloth, so it is deleted (`posed_cover` in `build_characters.py`). The rest of the hidden skin is sunk in towards its
bones (`LINER=0` keeps it at full depth, which came out through the cloth more often in play), skin near an opening
takes the garment's weights (`follow`) and the opening gets a facing down to it. In the game every garment is drawn a
few millimetres nearer the camera per layer (`CLOTH_PULL`, by the atlas tile's layer in the body's JSON), so where
skin or an inner garment comes within a few millimetres of the layer over it, the outer one still wins. The light
`.lod1` builds (every body, the creator ones too) decimate the joints as well. `CULL_CACHE=~/.cache/bs-cull` keeps the
slow sight-line tests between builds; `CREW_OUT=DIR` builds somewhere other than `public/models/crew`.

Skin and cloth in play: `tools/play_capture.py --serve --soft` plays every body through idle, walk, run, turn, sit,
talk, argue, point and cheer from the game's follow camera and counts skin out through cloth (yellow), an inner
garment out through an outer one (cyan; an inner layer seen in front of an outer garment's own facing at an opening
counts too) and skin seen from behind (magenta). It writes frame sheets, a JSON report, `--big` full-size worst views
and `--clips` short MP4s. Run it from a checkout nobody edits while it runs: Vite reloads the page on any change.

What a body costs per frame is set in `CHAR_BUDGET` (`src/characters/character.ts`): past `lodFar` metres the light
build is drawn, past `shadowFar` the body casts no shadow, a body no camera has drawn for a few frames is posed at a
quarter rate (far ones at a half or a third), and the pose-driven corrective shapes (morph targets, mixed on the GPU;
the CPU only works out their weights) are mixed only within `correctiveNear`, every other pose in its outer half. A
crowd body (`setCrowd`: Zenvora's townsfolk, walkers and groups) never mixes them, and takes the light build and drops
its shadow sooner. Test pages switch `throttle` off.

Frame time: `tools/frame_time.py --soft` plays the Zenvora street, the Vault, free play and the camp scene and reports
frame time, draw calls and triangles sent to WebGL per frame; `--dist`/`--public` point it at an older build, so
commits can be compared. `tools/crowd_cpu.py` times the bodies' own CPU work on a street of sixty (`dev/crowd.html`),
`--tree` in an older checkout.

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
