# Combat and action: handoff

I am the agent that owns `src/combat` (fights, creatures, weapons, traps, set pieces, the fight HUD and its sound hooks).
Worktree `~/bs-combat`, branch `combat`, based on origin/main. The story agent works in `~/bs-life` (branch `life-wip`)
and owns scenes, dialogue, choices, cutscenes and voices; I do not edit its files.

Read first: `MECHANICS_NOTES.md` (why the rules are what they are), then `src/combat/index.ts` (the API).

## Layout
- `src/combat/sim/`: the simulation. No DOM, no three.js. `core.ts` (types, difficulty), `weapons.ts`, `species.ts`,
  `ai.ts`, `sim.ts`, `encounters.ts`, `tension.ts`. Runs under Node.
- `src/combat/view/`: `creatures.ts` (bodies), `fx.ts` (particles, projectiles, telegraph marks, traps, fires),
  `body.ts` (the player's poses and what is in the hand), `hud.ts` + `combat.css`, `tensionUi.ts`.
- `src/combat/combat.ts`: the controller. `src/combat/strings.ts`: en/hi/ur text (`cb.*`).
- Edits outside `src/combat`: `game/player.ts` (`combat` hold on the body, aim camera), `game/input.ts` (mouse buttons
  as keys, pad accessors, `padMask`), `game/game.ts` (five small hooks), `main.ts` (construct, `scaleTime`, pause entry,
  `?combat=`, `__bs.combat`), `ui/ui.ts` (`openModal` public, pause row), `core/save.ts` (`Settings.combat`),
  `i18n/index.ts` (`addStrings`), `tsconfig.json` (`allowImportingTsExtensions`).

## Tests
- `node --experimental-strip-types tools/combat/sim_test.ts` (186 checks, no browser, about 2 s).
- `~/.venvs/bs-test/bin/python tools/combat/play_test.py --out DIR` after `npm run build` (through `~/bin/heavy`).

## API for the story
`game.combat.startEncounter(id, { companion, story, seed })` resolves with `Outcome { result, flags, companionLost,
injuries, seconds, stats }`. Ids: `hunt.first`, `night.defence`, `chase.escape`, `stealth.pass`, `arena`.
`game.combat.tension({ kind: 'quick' | 'steady' | 'breath' | 'aim', seconds?, count?, strain? })` resolves with
`{ passed, score, misses }`. Details in `docs/COMBAT_API.md`.

## State
See the end of this file for the running log.

### Log
- 03:00 Sim + tests (186 checks) committed. Game side builds and runs: arena, hunt checked in headless Chromium and on
  the GPU Chrome (port 9336, profile %TEMP%\bs-combat-gpu, preview server `npx vite preview --port 4651` in this tree).
- Capture: `~/bs-cap/combat/mkplan.py` writes plans, `cap.sh NAME plan_X.json` records and joins, `sheet.sh` makes a
  contact sheet, `round.sh NAME` = build + all clips + play test. Gates: `~/bs-cap/combat/gates.sh OUTDIR`.
- Not landed yet. Next: look at every clip, fix what feels wrong, gates, fast-forward main, Pages, clips to
  `Downloads/BS_Game_v1.1/combat/`.
