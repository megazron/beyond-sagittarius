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
