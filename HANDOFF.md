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

## 2026-11-21 15:15 takeover by the next perf agent (branch perf14 from origin/main 6c76c55)
- Chrome on 9444 is now the ttr-creative-chrome profile (another agent relaunched it). My cold-cache Chrome: port 9446,
  profile %TEMP%\bs-perf-cold, --disable-gpu-shader-disk-cache: ~/bs-assets/gpu/coldchrome.sh restarts it (kills only
  that instance by PID). A cold first load is what a new player gets.
- FINDING: the title load on a cold shader cache is ~100 s on the A500 (Web): 149 programs, ~73 s of ANGLE/D3D11 shader
  compile, the main thread blocked in getUniforms during warmAll's sync warm renders (frames of 10-21 s). Warm cache: 30 s.
  Earlier "load 4-5 s" numbers were on a warm cache. Tools: ~/bs-assets/gpu/shader_time.py URL OUT [PORT] (per-program
  link timing), tools/hitch_tour.py --profile SEG,SEG --stop-after SEG --port N (CPU profile per segment).
- Arrival in Zenvora (main, warm 9444): 9.9 s JS build under the narrator end, then 6.9 s compile/upload, then a 4.8 s
  freeze in play (mode away) at t+5 s: 92f319e does not remove all of it.
- Planet free play on Web: 31 fps walk, 1252 draws, 6.3 M tris (main, 15:20).
- perf14: tried Renderer.compileFor (compileAsync) for every scene before warmAll's draws: reverted at 18:20 (three's
  compile takes every material, drawn or not: 185 programs instead of 149; on SwiftShader the GPU process was still
  compiling after ready, the title's buttons froze and the combat play test timed out on #btn-new/#nm-ok). compileFor
  stays for Renderer.precompile (the city).
- 16:30 perf14 WIP (not yet measured on the GPU; Blender jobs held the heavy slots): precompile warms through the real
  post chain (shadow/AO variants) instead of a tiny plain render; hair geometry cached per style+head (4.6 s of the
  city build was forty heads of hair); forest LODs that start beyond the shadow range cast no shadow; far forest LODs
  (1, 2) culled by 32 bearing sectors round the camera (?cull=0 turns it off); townsfolk: 12 seeded looks on desktops
  (8 on phones), none in the white coat (custom.ts townLook), impostor atlas in bands (impostor.ts/citydense.ts).
- 16:45 FINDING: Chrome on 9444 (ttr-creative-chrome) and the story agent's 9334 render on the INTEL iGPU (ANGLE Intel
  D3D11), not the A500: the game's powerPreference 'high-performance' is not honoured by Chrome on this laptop without
  --force-high-performance-gpu. My 9446 instance has that flag: ANGLE NVIDIA RTX A500 (check with
  ~/bs-assets/gpu/gpuname.py PORT). All my plans now use port 9446. The owner's own Chrome may well be on the iGPU too
  (Windows Settings > System > Display > Graphics > Chrome > High performance fixes it); the desktop build already
  forces the dGPU (electron/main.js).
- Planet census on the A500 (Web, wake spot): items.group (stones, sticks, fruit, story items) was 217-516 draws a frame
  plus 179-263 in the shadow pass; the creature 84+84+56. Now: items past 55 m (Web; 32 phones, 75 Ultra) not drawn,
  shadows only within 28 m, creature body merged: forest spot 1206 -> 594 draws, wake 1233 -> 876.
- 17:20 A/B Zenvora Web, nine spots, quiet machine, same build: A500 44-51 fps, Intel iGPU 42-60 fps, both at the
  pixel-ratio floor 0.6. The A500 is not faster than this laptop's Intel Arc iGPU for this game. GPU experiments at the
  gate (plan_exp14_city.json: fixed pr 0.6 vs 1.0, shadows off, each post pass off): no change beyond noise, so the
  frame is CPU-bound: update 4-14 ms + draw 13-34 ms (~35 us a draw call through ANGLE). Draw calls and per-frame JS are
  the lever, not resolution or post. The dynamic-resolution controller drops to 0.6 for nothing when CPU-bound.
- 18:00 CPU profiles with source maps (npx vite build --sourcemap; ~/bs-assets/gpu/tools/mapprof.cjs PROFILE dist/assets
  [ROOTFN]; gpu_tour plans with "profile": N save OUT/shot.cpuprofile). Planet forest spot (Web, A500): render 85% of the
  frame, setProgram (per-draw uniform upload) about a third of it, the lake mirror 14% (now trimmed: stones, plants,
  items and bodies left out of it, half as often when far), updateMatrixWorld 12%. City gate: render 79%, setProgram
  40%, character animate 7%. NEXT for a steady 60 on Web: fewer draws. The forest's ~40 fields x 3 LODs x parts are
  one InstancedMesh each; three's BatchedMesh (multi-draw, per-instance culling) would put each material's geometries
  in one draw (bark: 15 meshes -> 1). Check windify/leaf shader chunks against BatchedMesh's batching texture first.
- 19:55 LANDED perf14 on main as 694bbae (CI 44941146776 all green). Clips + README (with caveats) in
  Downloads/BS_Game_v1.1/city_v1.4_GPU (recorded under another agent's Blender load: 21-23 fps in the overlay).
  OPEN: (1) quiet-machine A500 hitch tour of the landed build (Web and Ultra) and the Mobile proxy (plan_p_mobile_a500)
  never ran: Blender jobs held the heavy slots; (2) a striped glass wall cuts through the flat's bedroom/bathroom (on
  main before today too; not found yet: merged statics hide which building; try hiding scene children >= 45);
  (3) forest BatchedMesh; (4) arrival stalls in play 1-3 s; (5) hair styles repeat every 6 looks; (6) KTX2 pipeline
  (encoder at ~/tools/ktx/KTX-Software-4.4.2-Linux-x86_64, LD_LIBRARY_PATH=.../lib).

## 2026-11-21 19:50 takeover by perf agent 15 (branch perf15 from perf14 582d54b)
- Measurements: ~/bs-assets/gpu/p15 (plans, census.js = draws/ms per named object + distinct materials/programs per
  pass, progcount.js = program look-ups per material, rayflat.js = ray probe, cmp.py = side-by-side reports,
  ab_load.sh = cold title load with Chrome restarted). run.sh takes sub-paths (p15/x). New builds go to dist-new and are
  served on :4182 (vite preview --outDir dist-new); main's on :4180.
- core/ibatch.ts InstancedBatch: a BatchedMesh whose sub-draws are per geometry and INSTANCED (WEBGL_multi_draw's
  instanced calls, armed right before three issues the multi-draw); the instance index comes from a two-level list in
  the indirect texture. One draw per material per pass. Used by: the forest (Forest.batch: every field's parts that
  share a material), the planet ground (Terrain.batch, with per-chunk LOD: the LODs sat at the origin, so every chunk
  took the level for the camera's distance to the origin), the city's statics (batchStatic after mergeStatic). `?batch=0`
  is the old path. Trees are one geometry per species/LOD now (bark drawn by the leaf material where aBark = 1).
- Load: Renderer.prewarm compiles each warm scene's visible materials in the background first (polls isReady).
- The flat's striped wall was a cityfuture tower (x = FRONT + 15 + rnd*8, up to 15 m wide) reaching 2.5 m into the
  bedroom and bathroom: towers now stand behind the 12 m block.
- Findings: the city is CPU-bound in both render (setProgram per draw, 110 to 230 distinct materials a frame at the
  gate) and update (city.update 5 ms, player 3 ms, character animate, drawPeds); a 240-draw planet frame still costs
  ~28 ms on the A500. Draw calls fell 15 to 50 percent; frame rate moved less than that.
- 23:05 LANDED perf15 on main as 34fddfc (CI 44957147335 all green). A500, quiet machine, Web, this build vs main
  694bbae: Zenvora draw calls 258/277/409/462/256/186/269/200/195 -> 214/209/375/350/187/182/184/149/164 (flat, bazaar,
  crowd, gate, square, downtown, market, waterfront, park); fps 42/35/27/24/29/32/33/32/40 -> 35/36/27/26/48/41/39/47/42
  (single runs, swing about 5 fps run to run). Planet Web draws 631/580/612/520/469/688 -> 570/390/346/289/270/332;
  fps moved little (26-35 -> 29-44). Cold title load (Chrome restarted, no shader cache) 127.6 s -> 86.1 s, main-thread
  long tasks 122 s -> 68 s, title p95 frame 1345 ms -> 50 ms. Still a 19.7 s freeze on the title's first frame (its own
  26 programs, before warmAll) and 5-10 s ones while the GPU process links.
- OPEN: the gate and crowd spots have 190-230 distinct materials a frame (signs, lights, holograms kept apart because
  they animate); bodies are ~14 draws each (Ultra bazaar 83 skinned draws, 11.6 fps); city.update ~5 ms and player
  ~3 ms a frame; program look-ups (getProgram) ~25 a frame from materials shared by batched and plain meshes and by
  bodies with different morph counts.

## combat (continued)
- 14:20 combat-land: sling is tree row 22; grips via the story agent's `setGrip` (life-wip d3acdfe, not on main; my
  call is a no-op until it lands; tested in ~/bs-combat-grip = life-wip + combat, clips *_v3_grip); spear-thrower
  cast in the ranged rig; hunt bot patient (kill in ~20 s); night fill light (planetshine) made once at start and
  kept at 0 by day. LESSON: adding a light mid-game (torch PointLight, late DirectionalLight) recompiled every
  material and stalled the CI browser for minutes (play test timed out on the pause menu); never add lights later.

## combat: STATE AT HANDOVER (2026-11-22 ~02:00), read this first
Main is at f2ed5e3 (landed by fast-forward after a fully green CI run on that exact commit). Nothing of mine is
unlanded except this handoff commit and any recording in progress.

### How to land (rules that bit me)
- Work in ~/bs-combat (branch `combat`). Rebase on origin/main; HANDOFF.md is shared with the perf agent (merge both).
- Force-push is refused by the permission layer: push rebased work to a NEW branch name (`combat-land2`, `-land3`...)
  with `git push origin HEAD:refs/heads/<name>`; CI runs on every push (.github/workflows/gates.yml, ~12 min, a
  `combat` job = sim_test + play_test). Check `gh run view <id> --json conclusion,headSha` on the exact sha, check
  `git merge-base --is-ancestor origin/main <sha>`, then ONE separate command `git push origin <sha>:main`
  (chaining the check and the push in one command got refused). levels_smoke and crowd_smoke are flaky in CI:
  `gh run rerun <id> --failed`.
- Never add a THREE light after start (it recompiles every material: phone hitch, and the CI browser stalled for
  minutes). The night fill light (`shine` in combat.ts) is made in the constructor and kept at 0 by day.
- Commits as megazron, no AI attribution, first person, no em dashes. Heavy jobs only via ~/bin/heavy; locally only
  quick checks (tsc, sim_test) and GPU captures.

### Where things are
- Sim (Node-testable): src/combat/sim/ (weapons.ts, species.ts, ai.ts, sim.ts, encounters.ts, tension.ts,
  inventions.ts). Tests: `node --experimental-strip-types tools/combat/sim_test.ts` (208 checks).
- View: src/combat/view/ (creatures.ts, fx.ts, body.ts poses, ranged.ts = bow/sling/spear-thrower rig with two-bone
  arm reach, world-space gear at the real hands, pouch physics, setGrip calls; hud.ts, tensionUi.ts).
- Controller: src/combat/combat.ts. Story API: docs/COMBAT_API.md (startEncounter, tension, inventions table).
- Inventions = story tree rows (~/bs-story/INVENTION_TREE.md): src/combat/sim/inventions.ts; craft text cb.inv.*
  in src/combat/strings.ts (en/hi/ur). Episode One: stones, flake, club, fire, torch, fire-hardened spear, stakes,
  fire line, bait. Later: cordage, hafted spear, spear-thrower (atlatl + darts), traps (snare, rattle), sling (row 22),
  bow (row 19). Crossbow and coil only in the dev arena.
- Notes and sources: MECHANICS_NOTES.md (sections 1 to 10).

### How to record (GPU, with sound)
- Windows Chrome on port 9336 (profile %TEMP%\bs-combat-gpu), preview server `npx vite preview --port 4651` in this
  tree (serves dist; rebuild first). Scripts in ~/bs-cap/combat: `mkplan.py` (set-piece clips), `mkplan_v2.py`
  (bow/sling/spear-thrower references with a side photo camera and slow motion, gameplay clips; `python3 mkplan_v2.py
  bowref slingref ...`), `round3.sh NAME PLAN` = heavy build + capture + join, `cap.sh` capture only, `capg.sh`
  captures from port 4652 (used for the life-wip grip test worktree ~/bs-combat-grip). Bot: tools/combat/demo_bot.js
  (modes melee, ranged, guardian, hunt, night, chase, stealth, tour, bowref, slingref, atlatlref, bowplay,
  atlatlplay); it plays through the game's own keys. Hooks: `__bs.combat.testSlow`, `__bs.photo(from, to)`,
  `__bs.combat.testHideDraws(on)`. A state-dump probe plan: ~/bs-cap/combat/plan_dbg.json (evals printed in the log).
- Clips go to /mnt/c/Users/Gausms/Downloads/BS_Game_v1.1/combat/ (small re-encodes) with README_review.txt; last
  delivered: 04/05/06 v2, 10 to 17 (bow, sling, spear-thrower, v2/v3/v4), *_v3_grip. A chase/night v3 recording
  (~/bs-cap/combat/v7) was queued at handover; check v7.log, review, re-encode and copy if it finished.

### Open items (below the bar)
1. Chase readability: still dark among trees (now hour 19.9 and planetshine 0.8; not yet reviewed in v7).
2. Night defence: the recording bot sets bait and a snare but stalls before the stakes (it stops walking; see the
   probe dumps in ~/bs-cap/combat/dbg.log); traps are near the food and hard to see at night. Fix the bot's walking
   in prep, show the traps catching on screen.
3. Spear-thrower full-draw pose reads as a wide "T" (ranged.ts atlatl branch: bring the off arm in, lower the draw).
4. Fingers: ranged.ts calls `setGrip` (story agent's API on life-wip d3acdfe); a no-op until life-wip lands on main;
   then record bow/sling again and check the grips (tested OK in ~/bs-combat-grip, clips *_v3_grip).
5. Bow gameplay: camera now over the bow shoulder (combat.ts cb.shoulder -0.95 for the bow); fine-tune with a player.
6. Hunt: works (bot kills in ~20 s); prey readability in long grass relies on the suit tags.
7. Guardian prototype is plain boxes; melee vs Skritch is mostly chasing by design.
8. Nothing is "ready": the owner signs off; send clips with an honest list.
- 00:00 LANDED a787854 on main (CI 44963286821 all green): items keep their own copy of the scan materials;
  unifyLooks (merge.ts) moves plain singleton looks onto shared per-vertex materials before batchStatic; crowd bodies
  past 6 m skip lashes and cornea; flat portals hide batched pieces from the camera pass only (userData.batchHide);
  batchStatic splits a material on more than 256 pieces into several batches (without that the mobile crowd went
  99 -> 128 draws, over its budget).
- Measured after (A500, Web, n3 = dist-new2 ~67b6638): Zenvora draws flat 199, bazaar 207, crowd 344, gate 365,
  square 183, downtown 178, market 145, waterfront 123, park 158; fps 23-40 in that run (n2 run: 26-48). Run-to-run
  spread is 5-15 fps: compare builds back to back in one session before believing a few fps.
- Mobile proxy (4x slowdown) 10-19 fps; profile: render 65 % (setProgram most of it), tick 25 % (away.update/city
  1.1 s of 5.9 s, player 0.5 s, character animate 0.4 s).
- Planet forest spot, new build (p15/exp_planet): 53 fps at 242 draws standing still; pixel ratio 0.6 or post passes
  off did not raise it (40-52, noise), so still main-thread bound. Walking (clips) 26-38 fps: update 6-11 ms, draw 15-24.
- Clips (34fddfc, ?perf=1: Web city 01-05, Web planet 11-13, Ultra city u03-u04) and README_review.txt in
  Downloads/BS_Game_v1.1/city_v1.5_GPU. The Ultra planet clip was not recorded (queue stopped).
- Not started: KTX2 (encoder works: ETC1S ~ the webp's size, UASTC 8x; normal maps need a decision), far-tree
  impostors (the batches made far trees cheap in draw calls already), title first-frame freeze (26 programs).

## 2026-11-22 00:10 takeover by perf agent 16 (branch perf16 from perf15 d621084 = main a787854 + handoff)
- Measurements in ~/bs-assets/gpu/p16 (mdetail.js = one frame's main-pass draws per material with object paths and
  positions; ab.sh TAG PLAN.. = base (main a787854, ~/bs-perf-base worktree, dist-base on :4183) vs new (dist-new on
  :4182), exclusive heavy, one run per call; join.py = screencast frames to mp4). Profiles with source maps: build
  `--sourcemap --outDir dist-prof`, serve :4185, plan with "profile", then tools/mapprof.cjs.
- core/cycle.ts: one shared clock (CLOCK, set by the city's update via tickCycles) drives things animated in the
  shader: ad screens step through a painted atlas (cycleMaterial, aCycle per vertex), holograms turn and flicker
  (holoMaterial, aHolo), steam is one billboard mesh, the koi, searchlights, message tower and sky lanes (citymega) move
  in their vertex shaders. Nothing of these changes on the CPU any more, so they merge and batch. Cables are one line
  set, bunting one instanced mesh. Gate: 153 -> 106 distinct materials, non-body main-pass draws ~208 -> ~127.
- Bodies: every skinned part shares one skeleton (cloning gave each its own: one bone texture upload per part); the full
  builds' head and body skin are joined too (assets.ts joinSkin, now for every build, sameSkeleton check); lashes in one
  pass (forceSinglePass); passers-by within 0.7 m of the camera are hidden (the hair at the lens); crowd bodies past
  8 m skip keepArmsOut (it walked the whole body's matrices).
- Title: the first frame waits for prewarm(cine) + prewarmPost (post chain programs) to link in the background.
- city.ts: walls in an 8 m grid for collide/clearance (they scanned every box twice a frame).
- Coordinator notes: the Mobile crowd perf_gate (budget 120) needs real headroom (CI saw 122 on perf16 42f25f2);
  life-wip added setRibbon in src/world/grass.ts and src/world/stream.ts: keep those when they land; the combat CI's
  "full fight adds 381 draw calls" is being looked at by the combat agent (my batching is not known to be involved).

### 2026-11-22 ~01:50 (next combat agent)
- LANDED 6160b3d on main (CI 44969621815 green on that sha). Local on top (not pushed yet): 81d6475, 7fd2d65.
- Night: scavenger waves now come UP THE WIND (sim.windX/Z set in the night setup: from the fire across the food and
  out into the dark, +-0.3 rad); the camp fire puffs wood smoke that leans with the wind (fx 'smoke'), so a player can
  read where to set traps. Snare is a spring pole (fx.snare: bent sapling, snaps up on a catch with a damped
  overshoot, cord to the caught leg while held). Trap has `caught`/`sprungT`. sim_test: 210 checks (arrivals downwind,
  a downwind trap catches).
- Recording bot night prep rewritten: reads the wind, sets stakes (3.5 m downwind of the food), bait and a snare
  (8 m), each faced downwind by walking the last 1.7 m along the wind; stuck walker sidesteps, then sets where it
  stands; says ready out at the bait (by the fire the E key feeds the fire instead: that is why "ready" never fired
  before); guards the food from its upwind side looking out over the traps. `window.__cbDbg` shows its prep state.
- Chase: the hunter was never on screen in v3 (the camera looks ahead, it is behind). Now the view glances back
  (player.ts `combat.back`, view only, the legs keep their heading) while the hound winds up or starts a lunge within
  16 m; B holds a look back.
- Spear-thrower full draw: side-on, hand by the ear with the elbow down, off hand bent in front of the chest
  (MECHANICS_NOTES section 11, sources).
- Guardian redesigned (creatures.ts guardian()): monolith on four IK legs, three lenses converge before the beam,
  rears before the stomp, back fins open on the core after a beam. Not yet seen on the GPU.
- Recording plan ~/bs-cap/combat/mkplan_v8.py (chase v4, atlatl ref v3, guardian v2, night v4) -> plan_v8.json.
- Delivered 06_chase_v3 with notes; night v3 not sent (no stakes, no catch visible).
- 02:40 v8 reviewed (~/bs-cap/combat/v8): chase v4 still never showed the hunter: it never got close (inside 14 m it
  followed at 62% of its run, slower than a sprinting player, so it never leapt and the glance never fired). Fixed in
  ai.ts (flat out while you run) + an opening look over the shoulder (run.t 0.6..2.6). Atlatl v3: side-on draw reads
  right, dart went through the head: hand moved out from the ear. Guardian v2 read as a plant stand: heavier stone
  legs. Night v4: MY smoke filled the screen (huge unlit point sprites near the camera): now thin wisps, point size
  capped, particles fade within 2.8 m of the camera (all puffs). The world's camp has its own white plume already.
- New content: hand axe (row 11, `handaxe`, craft 3 stones), figure-four deadfall (row 14, free play only; grazers
  walk to fruit within their nose). sim_test 221.
- QUESTION for the story agent: the night set piece offers snare and rattle (row 14 needs cordage, row 10), Episode
  One has no cordage. I read them as vine traps for now (the kit gives vines). Say if Episode One should drop them.
- 49a6f23 was CI-green but NOT landed (the smoke). Next land: d620dff or later on combat-land3 once green, after the
  v9 recording (~/bs-cap/combat/mkplan_v9.py) looks right.

- 03:25 LANDED de87e3a on main (CI 44977716877 green after one flaky-rerun). Earlier: 03:10 rebased on main 3a740a3 (perf landed; HANDOFF merged both sides). Head de87e3a pushed as combat-land4, CI
  44977716877 running: land it when green (`git push origin de87e3a...:main` in its own command). d620dff was green
  on combat-land3 but main moved, so it can no longer fast-forward.
- v9 reviewed and delivered (Downloads/.../combat: 06_chase_v5, 16_spear_thrower_reference_side_v4, 03_guardian_v3,
  05_night_defence_v5, README notes). Chase now shows the hunter. Night: smoke fixed; traps set; a catch on screen
  NOT confirmed; an unidentified bright cyan ring on the ground (not the snare: check fx telegraph rings / pickup
  marks); the night starts as soon as the bot says ready (give it a pause so the traps are seen). Guardian: legs
  fold when asleep since de87e3a (not yet seen on the GPU). Atlatl: asked the owner whether the side view still
  reads as a "T".
- Next: a night take where a catch is framed (bot looks at the snare when a skritch nears it), identify the ring,
  guardian silhouette at fight distance, bow camera by play, bow/sling grips once life-wip's setGrip is on main,
  the deadfall in free play (food), Episode One 1.9 hooks are ready on the API side.

### 2026-11-22 ~04:00 (combat agent, next session)
- DECIDED (night traps vs cordage): Episode One keeps the snare and the rattle as VINE traps, not cordage. A green vine
  is its own cord (the spear's head is already lashed with one: story.ts `spear: { branch, flint, vine }`; the world
  scatters vines round the camp and pod 2). New invention `vineTraps` (row null, episodeOne, materials vine + branch,
  traps snare + rattle, text cb.inv.vineTraps.1-3); known once `flags.spear` is set or `inv.vineTraps`. Row 14
  (`traps`) now gives only the figure-four deadfall; spun cordage (row 10) stays Age 1 level 11. Labels: "Vine snare",
  "Vine rattle". NOTE FOR THE STORY AGENT: nothing to add to Episode One; if a scene teaches traps, set
  `flags['inv.vineTraps']`. Say in this file if you want it otherwise.
- The bright cyan ring on the night ground was the WORLD's pickup marker (props.ts/resources.ts: stones, branches and
  resources within 9 m get a pulsing HDR cyan ring that blooms hard on a dark ground). New `world.items.ringK`
  (1 normal, 0 hidden); combat sets it to 0 while a night set piece runs, back to 1 when it ends.
- Night: after "ready" (or the 70 s prep) a 10 s `hush` phase (objective "Quiet now. Watch the dark where the smoke
  goes.") before wave 1, so the traps can be looked at. Snared animals now fight the cord in the view (hind leg pulled
  out, body twisting, jaws open; the hound twists too); the cord runs to the hind leg. Bot: stands at the guard spot in
  the hush looking over the traps; in the waves it turns to watch a snare/stakes a scavenger is within 6 m of, or one
  that sprang in the last 3.5 s.
- Chase hour 19.9 -> 18.5: this sky's sun sets at 18:00 (sky.ts: e = sin((h - 6) / 24 * 2pi)); at 19.9 the sun was
  0.52 below the horizon (full night, no afterglow). At 18.5 the horizon is still dusk orange and the fog takes it, so
  trees are silhouettes against it. Bot rolls sideways out of the lunge line when the hound is under 6.5 m into its
  strike (once a lunge).
- Guardian: pale weathered stone, glowing seams on all six edges, a crest of three bronze spines, heavier legs, core
  glows through the closed fins whenever it is awake.
- Spear-thrower: the cast's hand path arcs up over the shoulder (0.16 s), a pale swept smear of the thrower for 0.18 s.
  Reference camera in mkplan_v10.py: behind and above the throwing shoulder first, then side-on.
- Windows interop from my shell gave "Invalid argument" for .exe; `/init /mnt/c/...exe` works. ~/bs-cap/combat/cap2.sh
  is cap.sh with that prefix.
