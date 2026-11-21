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
- 03:40 (new agent) Round r2 watched (clips in `~/bs-cap/combat/r2`). Fixed: the arena guardian woke in the melee bench
  and the camera ended up inside it (now 70 m off, boss bar only within 40 m, bodies round the camera hidden); attack
  strips stood up like signs on slopes (tilt clamped, minimum length); stomp/warn rings drew a thick band near the
  lens (fixed-width edge); coil and crossbow pointed up out of the thumb (now along the forearm); the sling pose was a
  straight arm over the head; analysis card kept popping up while aiming (now once); the dusk fire burned to a third
  before the night started (burns slowly in prep); the chase hunter was never on screen (pale/red edge arrow); hunt
  prey invisible in long grass (small suit tags over known animals in hunt and stealth). Recording bot: E presses
  now real key events (the night clip never fed the fire), melee clip fights a Duskhound with the club, ranged clip
  gets to the bow, tour starts on land.
- 04:55 Rounds r3, r4 watched. Melee now shows a real duel (club vs Duskhound: leap, roll, guard). A headless probe
  (`~/bs-cap/combat/probe/night_probe.py`) showed the night's scavengers idling 37 to 50 m out all night: their home
  was 44 m from the fire and their nose is 26 m, so in the real world nothing ever came. Home is now 21 m out. Not yet
  seen on the GPU after that fix. Still below the bar: chase and night too dark to read (world lighting, not mine),
  first-hunt bot keeps missing, guardian is plain boxes. Clips and an honest list in
  `Downloads/BS_Game_v1.1/combat/` (README_review.txt). Gates run: `~/bs-cap/combat/g1/summary.log`.
- The recording plans: `python3 mkplan.py` in `~/bs-cap/combat`; `round3.sh NAME PLAN` = build + record + join.
  Heavy queue can stall for 30 min behind other agents' exclusive jobs; do not kill other agents' jobs.

## CI (from 06:30)
- `.github/workflows/gates.yml` (branch `ci`, and on `combat` with an extra `combat` job): every push to any branch runs
  build+typecheck, smoke, levels_smoke, prologue_smoke, mobile_smoke, crowd_smoke, perf_gate, text_fit, cutscene_qa,
  app_smoke as parallel jobs, about 12 minutes. No artifacts. Read failures with `gh run view <id> --log-failed`.
  Usage note for all agents: `~/CI_GATES.md`. Locally: only quick checks and GPU captures.
- First green-ish run on `ci` (= main 63a3686 + the workflow): everything passes except `perf_gate` (web bazaar 644
  draws / 2.6 M triangles, web crowd 1.38 M triangles, over budget; the city agent's own local log shows the same) and
  `crowd_smoke` (mobile: no real body near the camera; web walker1 a card at 2.5 m). Both fail twice, so they are real
  failures of main's code, not of CI. `levels_smoke` failed once ("inventory did not open") and passed on rerun: flaky.
- Not landed on main: pushing `ci` to main was refused by the permission layer (main would not be green). Needs the
  owner or coordinator to decide: land the workflow as is (it reports main red until the city agent fixes the two
  gates), or have the city agent fix them first.
- 08:20 CI on `combat` (run 44881041794): combat job green (sim 186 checks + play test 0 failed), build, smoke,
  levels, prologue, mobile, text_fit, cutscene_qa, app_smoke green. Fixed on the way: the play test awaited the
  encounter's own promise (deadlock, not a game bug); a story-opened tension moment never ended outside a set piece
  (real API bug, fixed: it runs on the game clock or its own); the free-play animals of Verdaxis were drawn in the
  city when the player was away (perf gate: mobile flat 75 -> 326 draws; now 69); small animals cast one shadow.
  Still red: crowd_smoke (same as main), perf_gate ultra bazaar triangles (main passed it once at 3.2 M; streaming
  variance suspected, rerun pending).
- Night defence re-recorded (r5): scavengers now come to the light, food is stolen, the hound lunges. Still dark;
  bot never sets traps in prep (recording bot only).
- 08:45 Rerun: crowd_smoke passed (flaky on both main and combat), perf_gate fails at web bazaar (618 draws, 2.75 M
  triangles), the same spot main fails (644, 2.6 M); the numbers swing run to run on both. Mobile matches main. So
  `combat` is as green as main on CI; perf_gate's web bazaar is the city agent's to fix. Landing needs a green main
  (and the permission layer refused my push of `ci` to main).
- 09:10 Owner approved landing; my `git push origin ci:main` was refused again by the permission layer
  ("Undermining Oversight"). Not worked around; reported to the coordinator. Pushed `combat` (dabdbbb) instead.
- Stone Age order started: `src/combat/sim/inventions.ts` (ordered inventions, materials, steps, needs, era;
  `knownFrom(save)` reads `flags['inv.<id>']`, a `save.inventions` list, and the old `spear`/`fire` flags). New
  weapons `flake`, `hafted`; `spear` is now the fire-hardened one. Free play only puts invented weapons in the hand;
  free-play traps need their invention; set pieces keep their Episode One kits. Not done yet: the craft steps' text
  (cb.inv.*), teaching in-world (story side), the spear-thrower weapon, the sling/bow redo the owner asked for.
- Waiting for the story agent's ~/bs-story/INVENTION_TREE.md (did not exist at 09:00) to match ids.
- 11:40 LANDED: main fast-forwarded to 48b1ead (CI fully green on that exact commit; Pages deployed green). Force-push
  of `combat` is refused by the permission layer: I push rebased work to branch `combat-land` and land from there.
- Bow and sling redone: `src/combat/view/ranged.ts` (RangedRig: two-bone reach for both arms, bow/string/arrow and
  sling cords/pouch drawn in world space at the real hands, quiver, pouch physics). Sim: bow hold tremor
  (`holdT`), sling stone leaves 0.14 s after release (`pendingT`), nock 1.05 s, sling reload 1.0 s, launch points
  per weapon. Aim comes from player yaw/pitch (not the camera). Slow-mo hook `__bs.combat.testSlow`, photo camera
  `__bs.photo`. Plans: `~/bs-cap/combat/mkplan_v2.py`; clips 10 to 14 *_v2 in Downloads with notes.
- Next: bow aim camera (body hides the bow in play), hands closing on string and cords, spear-thrower weapon,
  match ~/bs-story/INVENTION_TREE.md when it exists.
- 13:40 LANDED c911aa8 on main (bow/sling v2, invention texts). On combat-land after it: inventions matched to the
  story tree rows (docs/COMBAT_API.md table), the spear-thrower (`atlatl`) and darts, bow aim camera over the bow
  shoulder (`combat.shoulder/lift` hold fields in player.ts), thicker string/arrow/cords, step into the sling throw
  on the move. levels_smoke is flaky in CI (passed on rerun twice). Clips 15 to 17 in Downloads.
- Asked of the story agent (via coordinator): a grip control in character.ts so fingers close on string and cords;
  a sling row in INVENTION_TREE.md.
- 14:20 combat-land: sling is tree row 22; grips via the story agent's `setGrip` (life-wip d3acdfe, not on main; my
  call is a no-op until it lands; tested in ~/bs-combat-grip = life-wip + combat, clips *_v3_grip); spear-thrower
  cast in the ranged rig; hunt bot patient (kill in ~20 s); night fill light (planetshine) made once at start and
  kept at 0 by day. LESSON: adding a light mid-game (torch PointLight, late DirectionalLight) recompiled every
  material and stalled the CI browser for minutes (play test timed out on the pause menu); never add lights later.
