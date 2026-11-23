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
python3 tools/text_fit.py --before            # every string in every UI slot, en/hi/ur, 360 px phone to 4K: fails on overflow
python3 tools/crowd_smoke.py                  # Zenvora: walk up to townsfolk (2.5 to 28 m) on Mobile and Web: each is a body or a card, never nothing
python3 tools/perf_gate.py                    # Zenvora: draw calls, triangles and bodies per preset per spot against budgets
python3 tools/city_tour.py --out DIR [--clips] # pictures (and short MP4s) of Zenvora, the minimap, the GPS line and the full map
npm run smoke:desktop                         # boots the Electron app under Xvfb, drives it over CDP
```

A new game opens on MegaZroN in the Vault, then the title card and the playable Zenvora prologue, the six boarding
and the liner lifting off over the city (the city stage's `outro`, letterboxed, with its Skip), a card for orbit, and
then the deck, the title sequence and the wake-up. Continue skips all of it; Chapters has "The opening" to watch it
again (in the replay slot, so the story stays as it was); the System setting and `?prologue=0` leave the city out.

Text fit: every place the game writes words is a slot in `src/ui/fit.ts` (subtitles, banners, buttons, objectives,
the dialogue box, title cards, menus). When a slot's text or the screen changes it wraps, then shrinks to the slot's
smallest size, then cuts to its line count with an ellipsis that opens in full on a tap. Words painted into textures
(Zenvora's shop signs, neon, posters) go through `src/core/canvastext.ts`, which draws a text smaller about its anchor
when it would run off its sign. `tools/text_fit.py` puts every string into every slot it can take at nine screen sizes
in three languages; `--before` also measures with fitting off.

Real play on the real GPU, with its sound: `tools/gpu_capture.py` drives a Windows-side Chrome over the DevTools
protocol (start it with `--remote-debugging-port=9334 --autoplay-policy=no-user-gesture-required`), records the page
with the DevTools screencast (HUD and subtitles included) and the game's own master bus with a MediaRecorder
(`__bs.audioTap()`), both stamped on one clock; `python3 tools/gpu_capture.py --join DIR` makes MP4s with sound. A
plan file lists the steps (wait, eval, keys held, recordings); run the script with the Windows Python, since WSL cannot
reach Chrome's port.

`levels_smoke.py` plays through the real interaction code by teleporting to each
objective and pressing E via `window.__bs`, and advances game time with
`__bs.step()`. The scripts take `--out` or `--shots DIR` for screenshots and fall
back to any installed Playwright Chromium if the pinned build is missing.

## Fights

`src/combat/sim/` is the fight itself with no browser in it (weapons, creatures and their senses, traps, fire, the set
pieces, the tension moments); `src/combat/view/` draws it; `src/combat/combat.ts` joins it to the game. The rules and
where they come from are in `docs/dev/MECHANICS_NOTES.md`, the calls the story makes in `docs/COMBAT_API.md`.

```bash
node --experimental-strip-types tools/combat/sim_test.ts   # every weapon, creature, trap and outcome on a fixed seed, about 2 s
python3 tools/combat/play_test.py --out DIR                # the same in the built game: set pieces, keys, touch buttons, draw calls
python3 tools/combat/make_sounds.py                        # the fight's sounds, synthesised (public/audio/sfx/cb_*)
```

`?combat=<id>` starts a set piece as soon as play begins (`arena`, `hunt.first`, `night.defence`, `chase.escape`,
`stealth.pass`); Pause, Action lists them. `tools/combat/demo_bot.js` plays them through the real controls for
recordings with `tools/gpu_capture.py`.

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

[docs/dev/LEVELS.md](docs/dev/LEVELS.md) holds the level design notes.

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
takes the garment's weights (`follow`) and the opening gets a facing down to it. In the game every garment is drawn
6 mm nearer the camera than the skin (`CLOTH_LIFT`) and a few millimetres more per layer (`CLOTH_PULL`, by the atlas
tile's layer in the body's JSON), so where skin or an inner garment comes close to the layer over it, the outer one
still wins. The light
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

Draw calls: on a phone three.js's own work per draw call (state, uniforms, matrices) is most of a frame, so the game
keeps them few. A body's rigid props (glasses, horns, belts, bags, the phone, the inside of the mouth and the teeth) are
merged at load into one to three skinned meshes on its own skeleton (`src/characters/rigid.ts`: every vertex held by
the bone its piece hung from; colour, roughness, metalness and glow per vertex). The light build (`.lod1`) draws its head
and body skin as one mesh. Static scenery is merged by `src/core/merge.ts` (`mergeChildren`): Zenvora runs its own
animations a few times first (`watchChanges`) and merges whatever did not move, hide or change colour, per material
and per stretch of street (12 m, 39 m on phones); plain materials that differ only in colour, roughness, metalness or
glow become one, with those per vertex. Signs, shop windows and awnings share stacked canvases (`stack` in city.ts),
the neon blades one atlas. From inside the flat only what its door and window show is drawn (`flatPortals`). On phones
(the Mobile preset) townsfolk past 36 m, small props past 24 m, planet items past 32 m and corneas and lashes past a
few metres are not drawn, terrain chunks are 200 m (the same lattice), and the frame is sharpened before the upscale.

Zenvora's people: the painted crowd (camera-facing cards, `citydense.ts`) fills the far street; near the camera
(14 m) a pool of real bodies (8 on phones, 14 elsewhere) takes over the nearest cards and walks them, so nobody
vanishes as you walk up (the cards used to be hidden within 9 m). Walkers step aside for you, people standing look at
you and wave the first time you come close, and hover cars in both lanes wait if you are in the road. Two side
streets open off the bazaar, each with shops and flats and a square at its end (a light fountain, a statue).

Zenvora beyond the bazaar (`src/game/away/districts.ts`): a street grid round the old town, about 640 by 430 m.
Downtown towers and Midtown to the east, the Market Quarter and the Waterfront on the bay to the west, Northside flats
and Ring Park to the north; the old town opens to it through its two squares and its north gate. Roads have two lanes
each way (left-hand traffic), kerbs, zebras, stop lines and signals at every junction of three or more roads. The
ground is one function (`districtHeight`) for the player and the meshes: 0 on a road, the pavement 14 cm up, a 35 cm
ramp at each kerb. Buildings are boxes drawn by `facade.ts` (punched, ribbon and curtain-wall windows, glass that
mirrors the sky at a grazing angle and shows a room behind it head on, lit rooms that grow with the night, shopfronts
and fascias on the street floor); every zone (160 m) is one draw per wall finish and never pops, its furniture, trees
and markings are shown within 260 m (170 m on phones). Walkers loop the blocks and cross on the green; others sit,
shop, chat and film; near the camera a pool of real bodies (14, 6 on phones) takes the nearest of them, the rest are
cards. Cars follow lanes, turn at junctions, stop at red lights and for anyone on a crossing (the player too).
Original names only on signs and billboards.

Time and weather (`src/game/away/daycycle.ts`): the prologue starts at 17:51, as the sun touches the horizon and the neon is already on, and an hour passes every seven minutes:
the sun, the sky (gold, pink, violet, night with stars), the sky's image-based light (refreshed every few game
minutes), the haze, lit windows and lamps all follow it. `?tod=HH.H` fixes the hour, `?weather=rain` brings rain:
streaks round the camera, an overcast sky, and wet ground (`wetify`: darker, glossier, puddles that mirror the sky).
The exposure and the bloom follow the hour (strong light and a low exposure by day so lit signs do not white out, an
open exposure at night when they are the light). The streets stay damp, with puddles, even when it is not raining.
The final grade is tinted by quarter (the bazaar warm, downtown cool, the bay teal). `?probe=1` turns on an
experimental reflection probe that follows the camera (`probe.ts`); it is off by default because its first rounds
white the picture out on a real GPU.

Frame budget in Zenvora. `?perf=1` shows frames a second, update and draw milliseconds, draw calls, triangles and
bodies drawn (`src/core/perfhud.ts`; the same numbers are `__bs.perf`). The city builds itself for one of three tiers
(phones, Web, Ultra and up) and what each may spend is fixed in code:

- Real bodies: at most 2, 5 or 12 at once besides the player (`BODY_CAP`); the six of the story and whoever is nearest
  get them. Everyone else is an impostor card: eight townsfolk are drawn once at load into an atlas, six walk frames and
  one standing from four sides (`impostor.ts`), and a card shows the frame and side that fit, tinted by the hour.
  Whoever stands between the camera and you, or within arm's reach of the lens, is not drawn until they move on.
- The old town is one group, not drawn, animated or walked for matrices when the camera is out in the districts; deep
  inside it the districts' streets, cars and people are not drawn or simulated (their buildings still show over the
  roofs). `skipStatic` makes the scene refresh the matrices of only what can move.
- Props: per stretch of street the light builds of every model are baked into one mesh on a shared texture atlas (one
  draw for a stretch's lamps, shutters, crates and fruit); only within a few metres do the scans take over (never on
  phones). The districts' bins, hydrants and service boxes go through the same atlas.
- Canvases: every shop's shelves, sign, poster and banner is packed on to shared atlases before the static merge
  (`atlasCanvases` in `core/merge.ts`), so they merge into a few meshes per stretch.
- Shadows: Ultra every frame, Web every other, phones a static shadow redrawn when the camera has gone 9 m; no body
  casts a shadow on phones (contact shadows). Phones draw the city straight to the screen with no post chain.
- Cars, walkers and furniture counts, zone sizes and wall finishes are per tier (`districts.ts`).

`tools/perf_gate.py` holds this: under software GL it cannot time frames, so at nine spots on each preset it fails if a
frame's draw calls, triangles or bodies drawn go over the preset's budget.

GPU review: `tools/gpu_tour.py` drives the owner's Windows Chrome (started with `--remote-debugging-port=9333`) over
the DevTools protocol from the Windows Python, takes stills, frame rate, draw calls, triangles, a census of what the
draws are (`census`) and a CPU profile (`profile`) at set spots, and records clips with the DevTools screencast;
`python3 tools/gpu_tour.py --join DIR` makes the MP4s. `tools/lod_city.py` writes the props' light builds.

Maps: a stage gives a `MapLayer` (`src/ui/minimap.ts`: its extent, a top-down paint, a router). The minimap (top right,
turning with the camera; tap it for the full map) shows the objective (on the rim when off the disc), people to talk
to, a waypoint and the route; the full map (M, the Map tab) pans, zooms (wheel, pinch, buttons) and sets a waypoint on
a tap. The same route is laid on the ground as chevrons (`src/world/gps.ts`). The planet's layer is its contour chart.

Frame time: `tools/frame_time.py --soft` plays the Zenvora street, the Vault, free play and the camp scene and reports
frame time, draw calls and triangles sent to WebGL per frame; `--dist`/`--public` point it at an older build, so
commits can be compared. Phones: `--quality mobile --size 844x390 --throttle 4 --nodraw` is Chrome's mid-range phone
model with draw calls counted but not executed (the main thread a phone spends); `--census --deep 5` lists one frame's
draw calls by what they draw, `--profile PREFIX` the top self times. `tools/crowd_cpu.py` times the bodies' own CPU work on a street of sixty (`dev/crowd.html`),
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
