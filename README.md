<p align="center">
  <a href="https://megazron.github.io/beyond-sagittarius/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo.svg">
      <source media="(prefers-color-scheme: light)" srcset="public/brand/logo-ink.svg">
      <img src="public/brand/logo.svg" alt="Beyond Sagittarius" width="560">
    </picture>
  </a>
</p>

<p align="center">
  Humanity conquered the stars. Now you must learn how to survive without civilisation.
</p>

<p align="center">
  <a href="https://megazron.github.io/beyond-sagittarius/"><img src="https://img.shields.io/badge/Play_now-ffb35c?style=for-the-badge" alt="Play now" height="36"></a>
  &nbsp;
  <a href="https://github.com/megazron/beyond-sagittarius/releases/latest"><img src="https://img.shields.io/badge/Download_for_Windows-16324a?style=for-the-badge" alt="Download for Windows" height="36"></a>
</p>

<p align="center">
  <img src="docs/gameplay.gif" alt="Gameplay: walking through the forest, then wading into the lake at dusk" width="800">
</p>

Year 2189. A suspiciously free tourist route to the galactic centre ends at
Sagittarius A*. You wake up alone on a planet nobody has charted, with a dying
wrist device and something very large walking between the trees. The jokes
come first. The fear catches up.

## What makes it different

**It opens in a browser tab.** No install and no account. It also runs on
phones with touch controls, and there is a Windows build for a bigger screen.

**The narrator keeps score.** MegaZroN hosts the game from the Vault of the Last
Ledger. He reads your choices back to you, including the fruit you should not
have eaten, and he is rude about them.

**English, Hindi and Urdu are all first class.** Text and voices exist in each,
Urdu reads right to left, and voice and subtitle languages can be set separately.
The voices are synthetic.

**Your crew is yours.** Build your Scientist in the character creator and rename
all six friends. Their names follow you through every line and objective.

## Available now

An opening cinematic and Chapter One, *The First 24 Hours*: ten levels of finding
water and food, making fire, building a shelter, surviving a night with a
predator, and following a signal to the first friend you can reach. A few locals
on the planet would also like to sell you a rock.

## Screenshots

| | |
| --- | --- |
| ![The forest by day](docs/screenshots/readme/forest.jpg) | ![The lake at dusk](docs/screenshots/readme/lake-dusk.jpg) |
| ![The liner approaching Sagittarius A*](docs/screenshots/readme/sagittarius-a.jpg) | ![The crew on the observation deck](docs/screenshots/readme/deck.jpg) |

### Chapter Two: Rocks to Reason

The way home is a ship, the ship needs chips, the chips need glass and metal,
and the metal needs fire, so you start with rocks. One discovery per level:
gather the real ingredients near camp, the lake and the ridge, work the process
as a small minigame at camp, and get a true short explanation in the codex.

| # | Level | Discovery |
| --- | --- | --- |
| 11 | Make an Edge | Flint knapping |
| 12 | Twist a Cord | Cordage |
| 13 | Fire on Demand | Bow-drill fire |
| 14 | Fire Some Clay | Pottery |
| 15 | Make Charcoal | Charcoal |
| 16 | Burn a Rock | Lime |
| 17 | Boil Out Salt | Salt |
| 18 | Melt Sand | Glass |
| 19 | Make Soap | Soap |
| 20 | Let It Ferment | Fermentation |
| 21 | Sour and Bitter | Acids and bases |

The codex (K, the pause menu or the touch button) shows all nine ages, from
Stone to Civilisation. Everything past Chapter Two is listed honestly as
planned and locked. People at camp and around the map talk through a dialogue
panel with choices, trades, small quests and taught tricks that make a process
easier, and they react to your deaths and discoveries.

**Do not try this at home.** The science is simplified for a game and is not
instructions.

## Controls

| Input | Action |
| --- | --- |
| W A S D, arrow keys | Move |
| Mouse | Look (click the world to lock the cursor) |
| Shift | Sprint |
| Space | Jump |
| E or F | Interact |
| I or Tab | Inventory |
| J or O | Objectives |
| C | Crew |
| Esc | Pause |
| Enter or Esc | Skip a cutscene |
| Touch | Joystick on the left, drag to look, pinch to zoom, buttons for the rest |

## System requirements

| | |
| --- | --- |
| Browser | A current desktop browser with WebGL2 |
| Windows | Windows 10 or 11, x64 |
| Phones | A current phone browser (only tested in emulation so far) |
| Graphics | Integrated graphics run the Web preset. A laptop GPU or better is suggested for Ultra. |

The Windows build is unsigned, so SmartScreen will warn you. Choose **More info**,
then **Run anyway**.

Measured on the live site with `tools/gpu_test.py`, Chrome headless at 1600x900
on an Intel Core Ultra 7 155H laptop. The NVIDIA rows are from commit 64a9fb9,
the Intel row from the older 6366f85. Frames per second:

| GPU | Preset | Title | Narrator | Cinematic | Play |
| --- | --- | --- | --- | --- | --- |
| Intel integrated | Web | 52 | 48 | 56 | 34 |
| NVIDIA RTX A500 Laptop | Web | 60 | 60 | 60 | 51 |
| NVIDIA RTX A500 Laptop | Ultra | 60 | 60 | 60 | 40 |

This was a short standing scene, and the graphics have changed since. Real play
with a mouse and keyboard and real audio have not been tested by a person.

## Roadmap

- Chapter Two, in progress: crafting your way out of the Stone Age
- Finding the rest of the crew, each with their own skills
- Nine ages of civilisation, from stone to the ship home
- Ruins and signals that do not add up
- Co-op for the six crew roles
- More languages

## Legal

[Terms](TERMS.md) · [Privacy](PRIVACY.md) · [Licence](LICENSE) · [Credits](CREDITS.md)

The science in the game is simplified for a game and isn't instructions.

Developer setup is in [DEVELOPMENT.md](DEVELOPMENT.md).
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
