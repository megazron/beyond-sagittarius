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
- 05:00 State: main = bfdde7b (landed, CI 44979957452 green after one flaky rerun). Unlanded on `combat`: 23a58d9..34460d7
  (night hush, vine traps, rings off, snared struggle, chase dusk, guardian, atlatl arc, throwing stick, bot fixes),
  pushed as combat-land8 (CI running). combat-land7 (64038f0) failed only perf_gate "mobile bazaar 836430 triangles
  (budget 720000)" (city, not touched by these commits; known to swing): if land8 fails the same way, rerun once.
  Land with `git push origin <sha>:main` in its own command once green on that exact sha.
- Throwing stick (`throwstick`, invention `throwStick`, row null, Episode One, after woodBone + flake): thrown it spins
  end over end (fx), proj radius 0.32 (wide sweep), the stick itself flies (ammo null), swung a light club. Not yet
  in a clip; not yet taught by the story (set `flags['inv.throwStick']`).
- v11 recordings (~/bs-cap/combat/v11, plan mkplan_v11.py, capture cap2.sh) delivered: 05_night_defence_v7,
  06_chase_v7, 16_spear_thrower_reference_v6, 03_guardian_v5 (README notes). v10n night was useless: the bot passed a
  marker's missing `.y` as look height, pitch went NaN, the camera froze all night (fixed; testLook ignores NaN).
- NEXT: (1) night: a snare catch still NOT seen on screen. The bot now logs catches in window.__cbTrapLog: add an
  eval step after the night rec that prints it, then check whether the snare at the bait ever springs in the real
  world (scavengers in v7 stood near the food, 4-5 m from the guard spot, not at the bait 8 m out); maybe put the
  snare on the line in (between bait and food) or close to the food. (2) chase: very orange at 18.5; try 18.7 if the
  owner wants cooler; bot still bitten once and walks into the lashbloom. (3) guardian: body dark from the front at
  fight distance; asleep knees still rise a little. (4) setGrip still not on main (checked 04:30): bow/sling grips wait.
  (5) record the throwing stick (arena, a `throwref` bot mode does not exist yet).

### 2026-11-22 ~06:00 (combat agent, session after v11)
- Guardian: the stone takes the light of its own seams (a cold fresnel rim, `uRim`) and a warm glow from the core
  (`uCoreGlow`) through an onBeforeCompile that chains `nearFade`; stone legs about twice as thick (shin in stone,
  broad foot pad); asleep knees lower (pole 1.3 - rest * 1.3).
- Night animals: `NIGHT_RIM` (creatures.ts) on the small-animal hide/belly materials, driven from the planetshine in
  combat.ts present(): a cold edge so a shape beyond the firelight reads as an animal. The hound comes from
  world/predator (not mine) and keeps its eyes and ridge only.
- Camera (game/player.ts orbit): when a slope, log or the camp's stones pull the camera in to under 1.05 m of the head
  it now rises over the head instead (the "camera inside the head while feeding the fire" in night v7).
- Chase hour 18.7 (owner asked for a cooler sky to judge). Recording bot: `throwplay` mode (throwing stick vs Nibbets,
  fetches the stick), chase goes 7 m round the spore plant. Plan ~/bs-cap/combat/mkplan_v12.py (night prints
  __cbTrapLog into the capture log after the take).
- NOTE FOR THE STORY AGENT (throwing stick): `throwstick`, invention `throwStick` (row null, Episode One, needs woodBone
  + flake, made from 1 branch). Thrown side-arm it spins and sweeps a wide path: it is what brings down small fast
  animals (Nibbets) where a spear point misses; swung it is a light club. If Episode One has a beat where Zenvik
  needs food before the first hunt or after a missed spear throw, it fits there (Schoeningen, beside the spears,
  about 300,000 years ago). To teach it set `flags['inv.throwStick']`. Clip: 18_throwing_stick (when recorded).
- 07:40 FINDINGS. (1) A headless probe (~/bs-cap/combat/probe/bait_probe.py) proved the night sim works in the real
  world: bait + snare set exactly downwind, the wave-1 Skritch run to the bait and the snare catches about 4 s after
  they spawn. v7's missing catch was the bot: it set the snare 4 m off the bait (now it sets the snare where the bait
  really lies) and watched from beside the food into black. (2) Chrome 9336 renders on the INTEL iGPU and under other
  agents' load recorded at 2 fps. My own Chrome is now port 9338 (profile %TEMP%\bs-combat-a500,
  --force-high-performance-gpu, NVIDIA A500); plans v12+ use it. Record with HEAVY_EXCLUSIVE=1 cap2.sh (8 fps under
  load vs 23 fps alone). A killed capture leaves the game running in its tab: close it (~/bs-cap/combat/tabs.py PORT).
- Night: planetshine 0.85 on the defence (0.55 was black on the A500), smoke dimmed at night (fx.smokeK), bot bait
  5.5 m out at the edge of the firelight, watches from 4.4 m beyond the snare looking back at the camp.
- Hide wrap (row 15, `hideWrap`, free play): sim only (p.wrap), not drawn on the body yet (needs forearm attachments
  on the character rig).
- Delivered 06_chase_v8_hour18_7 (taken 0 damage, went round the spore plant) and 16_spear_thrower_reference_v7.
  v13 (night v9, guardian v7, throwing stick v2) recording at 07:40.
- 09:00 LANDED df69603 on main (CI 44999113475 all green on that sha). Unlanded on `combat` after it: handoff commits
  and the throwing-stick side camera framing in demo_bot.js (pushed as combat-land13; land when green).
- Delivered (Downloads/.../combat, README notes appended): 06_chase_v8_hour18_7, 16_spear_thrower_reference_v7,
  05_night_defence_v9 (snare catch on screen at 0:40, logged; small and partly behind the player), 03_guardian_v7,
  18_throwing_stick (first look).
- NEXT: (1) night: make the catch land as a moment. Idea: a short view glance toward a trap that springs within ~15 m
  (like the chase's `combat.back`, but toward a bearing), and keep the bot at its watch spot until wave 1 is caught
  (it walked back to the fire). (2) guardian asleep legs read as planks; front is a plain cone: give the body a face
  plane/brow and fold the legs under the fins. (3) throwing stick: re-take with the moved side camera, Nibbets
  summoned nearer so it hits. (4) setGrip still not on main (checked 09:00): bow/sling grips and bow camera wait.
  (5) hide wrap is sim-only: draw it once the rig has forearm attachments. (6) Owner to choose chase hour 18.5 or 18.7.

### 2026-11-22 ~10:00 (combat agent, next session)
- setGrip still not on main (checked 10:00: only on origin/life-wip 3178fcf); bow/sling grips wait.
- Night trap beat (combat.ts trapBeat, player.ts `combat.turn`): an animal within 3.4 m of a set snare/stakes/deadfall,
  walking towards it, within 16 m of the player: its own sound (chitter/squeak/growl) and a twig crack at the trap,
  then the VIEW turns to the trap (head, not body; 0.28 rad to one side so the body does not stand in front of it).
  Held 2.6 s past the snap, 2.8 s if nothing springs; cancelled by an attack on the player within 6 m, swinging,
  aiming, blocking, or the player turning the view 0.35 rad; 6 s cooldown. Not in the chase.
- Recording bot night: watch spot 4.6 m beside the snare (1.2 m downwind), looking out into the dark; stays through
  wave 1 (only a fire under 20% calls it back); no bot-side turning to traps (the game's beat does it).
- Camera: forest.ts `inFoliage(x, y, z)` (camera-only cones for fir/pine/sapling crowns, shrub cylinders); player.ts
  pulls the camera in when the line to it enters foliage (the black frames in guardian v7 were fir boughs).
- Guardian: stone courses (5 lofts turned against each other), dark-stone shoulders with sloping slabs and a bronze
  edge, a carved face (brow, cheek stones in a V, jaw stone, dark socket, one big lens with three small that converge
  before the beam), legs in stone drums with bronze-bound knees and broad stone feet; asleep folded (front feet forward,
  hind feet under the flank, knees on the ground at y ~0.15; checked numerically), body settled 9 cm into the ground.
- Throwing stick: spin on sim time (wall time strobed in slow motion); side camera above the throw (it spins flat).
  `summon(kind, n, at?)` in encounters.ts; bot throws at a settled Nibbet summoned at 8 m.
- Hide wrap drawn: body.ts HideWrap, hide sleeves + cord lashings parented to lowerarm/upperarm bones (no torso piece).
- Chrome 9338 is reached only from Windows (tabs.py from WSL says refused; use powershell Invoke-WebRequest). Launch:
  /init powershell.exe Start-Process chrome with --remote-debugging-port=9338 --user-data-dir=%TEMP%\bs-combat-a500
  --force-high-performance-gpu (see coldchrome.sh for the full flag list).
- Plan ~/bs-cap/combat/mkplan_v14.py (night trap beat, guardian v8, throwing stick v3, hide wrap first look).
- 10:30 v14/v15/v16 reviewed. v14 night: the bot's prep "stuck" check counted turning on the spot, so it set every
  trap by the fire; nothing came in wave 1 (fixed: stuck only counts while W is held). v15 night: snare at the bait
  (5.3 m downwind), caught in wave 1, the beat turned the view and held on the struggling Skritch: works, small and
  dark. A full black frame in v14 at 115 s while the view swept ~180 deg (turn now clamped to 1.9 rad; not seen in
  v15). tools/combat/night_watch_probe.ts: in the flat sim wave 1 is caught ~4 s in from any watch spot.
- Wrap: hand is not a direct child of lowerarm (forearmtw bones between); sleeve axis now measured in the bone's frame.
  On the scientist's loose coat only the lashings show on the forearms. Shoulder caps fine.
- Delivered (Downloads/.../combat, README notes): 05_night_defence_v11_trapbeat, 03_guardian_v9,
  18_throwing_stick_v4, 19_hide_wrap_v3_first_look.
- Landing: rebased on main e368b61 (perf's crowd camera merged with my view turn in player.ts updateCamera: both
  terms in pitchV). Pushed 8f0222e as combat-land14; land it when CI is green on that sha (its own command).
  combat-land13 (9fa22b8) went green on rerun but main had moved; it is inside land14.
- 11:10 LANDED 8f0222e on main (CI 45009577101 green after one rerun: the first run timed out once in the play
  test on the pause menu difficulty click and perf_gate mobile bazaar 781k; both passed on rerun). Unlanded: this
  handoff commit only.
- NEXT: guardian legs darker in sun / face less boxy; wrap hide over loose sleeves (or a forearm fit from kit.ts);
  bigger/brighter snared animal (night rim on it while held?); bow/sling grips when setGrip lands (still only
  life-wip at 10:00); then the next invention-tree content.
### 2026-11-22 ~11:30 (combat agent, session after land14)
- eb7f6ba (local): guardian face is a lathe-turned carved hollow (mound + near-black hollow, roughened lip, rounded
  brow/cheek/chin stones, eye a glint idle, bright in the wind-up); the square socket and the straight face seams are
  gone. Legs: own material `legStone` (cold basalt, vertex-colour weathering: joint grime, rain streaks, lichen) with
  NO core glow (the core's warm emissive on every stone was what turned the legs tan in sun and orange after a beam);
  core glow on the body cut to about a third.
- Hide wrap: HideWrap.measure() reads the skinned vertices that follow lowerarm/forearmtw (getVertexPosition, in the
  bone frame, 8 sections) and lays the forearm hide 5% over the sleeve; coat-coloured puffs beyond each end where
  there is cloth (the sleeve bunched by the wrap); crossed lashing (two opposite helices) between end bands.
- Trap cue, listened to by analysis (night v11 audio): the chitter peaked ~-38 dB (2-5 kHz band), the twig crack
  ~-49 dB, under the WORLD's giant-creature footfalls (game.ts onCreatureStep, a 42 Hz tone at about -17 dB every
  1.35 s, not mine). New sounds cb_twig/cb_rustle/cb_struggle (make_sounds.py takes names: `... make_sounds.py twig`);
  cue = rustle + voice + twig at full level out to 9 m (sfx() has a `near` arg); a held animal struggles out loud and
  kicks dirt every 0.55-0.9 s; held animals get their own light (`uHeldLit` per creature in rimmed()); the view draws
  in (player.ts `combat.zoom`, -15 deg FOV) once the trap has sprung.
- Nibbets sit up on their haunches to look (alert, and vigilance bouts while feeding) and have a pale tail flag.
  Throwing-stick side camera square to the throw's middle, 8.5 m out. Hunt trial kit gets the throwing stick (the
  story teaches it before the hunt: lean.ts, `inv.throwStick`).
- combat-land15 (381873f, handoff only) failed levels_smoke (flaky), rerun requested.
- Recording: ~/bs-cap/combat/mkplan_v17.py -> plan_v17_guardian_wrap_throwstick.json, plan_v17_night.json.
- ~13:10 STATE. LANDED b5761bd on main (CI 45024647750 all green on that sha). Earlier note, kept: land when CI is green on that
  exact sha (`git push origin <sha>:main` in its own command; levels_smoke "inventory did not open" is flaky:
  `gh run rerun <id> --failed`). combat-land15 failed levels_smoke twice (handoff-only commit; it is inside land16).
- Delivered (Downloads/.../combat, README notes): 05_night_defence_v12_catch_heard, 03_guardian_v11_carved_face,
  19_hide_wrap_v5_over_sleeve, 18_throwing_stick_v6.
- Seen on the GPU: night v12: the beat turns and draws in on the caught Skritch at ~0:28, struggle heard and dirt
  kicked up; the Skritch ran straight in so the pre-snap cue did not play in that take (cue still unheard in a clip);
  the held light was too strong (ghost-like) -> cut to 0.2 and mostly fresnel (18f6034, NOT yet recorded). Guardian
  v11: face carved from body stone around a hollow (reads a bit like a mouth/porthole), legs dark; phase two still
  turns the body orange (rimU `over`). Wrap v5: over the sleeve from the side; from the front the wrist end was a
  dark ring -> capped at 0.085 m, wrist narrower, edge rolled in (d5845d5, NOT yet recorded). Stick v6: thrower whole,
  Nibbets sitting up visible, stick in flight; the side camera holds while the bot walks off.
- NOTE: perf's ff74a53 merges the player's skin/clothes/eyes into one skinned mesh on stages; HideWrap.measure()
  still works on skinned meshes, but its cloth colour comes from the merged material (check the puff colour).
- NEXT: build, then `HEAVY_EXCLUSIVE=1 ~/bs-cap/combat/cap2.sh v17c plan_v17c_night_wrap.json` (night v13 + wrap v6)
  and review; a night take where the pre-snap cue plays (bot or probe); guardian phase-two colour; setGrip still only
  on origin/life-wip (checked 13:00); content proposal (row 21 / spear fishing) below.
- PROPOSAL for the next content (tree row 21 area, Episode One compatible): spear fishing with the fire-hardened
  spear in the stream/lake shallows: fish seen where they are not (refraction: aim below the fish, Zenvik's physics,
  one line). Needs a water query on the fight Env (core.ts Env has only height/blocked), a `fish` species and view,
  and a story hook (the story agent's 1.1 stream). Not started; ask the story agent where it fits.

## 2026-11-22 04:10 takeover by perf agent 17 (branch perf17 from main bfdde7b; landing branch perf17-land2)
- Measurements in ~/bs-assets/gpu/p17: inter.sh TAG PLAN.. (base on :4183 = ~/bs-perf-base at main, built to
  ~/bs-perf/dist-base; new on :4182 dist-new; one exclusive heavy call per run, then p15/cmp.py), plan_mcensus.json
  (Mobile per-object census), clips.sh (clips of dist-new2 on :4184 to Downloads/BS_Game_v1.1/city_v1.7_GPU).
- core/ibatch.ts: InstancedBatch has RUNS now (several instance lists of one geometry, each with its own cull sphere,
  hidden/mainHidden/shadow switches; run id = geometry id for the first run, addRun for more; add every geometry
  first). BatchPool + RunHandle: pieces gathered per material (and attribute set) into one batch each; a RunHandle
  stands in for an InstancedMesh (visible, castShadow). autoBounds: a pooled batch with no shown run is not drawn at
  all and is frustum-culled by its shown runs (a batch whose runs all draw nothing still cost a draw in every pass).
- city.ts props: with BATCH.on, the scans (Ultra near), the "always" models and the stretches' light-build bakes go
  through BatchPools: one draw per prop kind's material for the whole zone (old town and districts each), each stretch
  a run. The flat's portals reach the runs through invisible stand-ins (group `propRuns`, userData.batchHide).
- Lens: crowd bodies of the full build (Web, Ultra) fade with hashed alpha (alphaHash set at build time, so no
  recompile in play) from 1.3 m to gone at 0.4 m, and when the city asks (setLensFade: on the line from the camera to
  you), eased over ~0.2 s; see-through materials fade by opacity, cut-out hair cards by raising alphaTest; the merged
  kit just goes below 0.6. Phones keep the hard hide. `fig.faded` feeds drawnAs.
- Camera: stage.crowdNear() (city: bodies within 3.2 m of you, (n-1)/3) eases the follow camera up 0.3 m and its pitch
  down to at least -0.38 over a thick crowd. ?crowdcam=0 turns it off.
- Numbers (A500, shared machine, single interleaved pairs, so a few fps is noise):
  Ultra bazaar census: 752 -> 463 draws (prop draws 264 main + 223 shadow -> 101 + 76); fps 16.0/10.5 -> 14.2/20.7
  (two shots, both noisy): Ultra is NOT mainly draw-bound at the bazaar any more (2.9-3 M triangles, SSR, AO).
  Web city (w1): flat 31.0 -> 36.9, bazaar 27.7 -> 32.2, crowd 23.9 -> 27.1, gate 27.2 -> 31.3, square 27.8 -> 39.2,
  downtown 30.6 -> 37.4, market 30.3 -> 42.9, waterfront 31.1 -> 48.1, park 34.8 -> 53.7 (Web draw counts barely move:
  Web never drew the scans; the gains are larger than the draw change explains, part is load).
  Mobile proxy (4x): mixed, 8-21 fps both builds, draws vary 40+ run to run with the crowd. CI perf_gate mobile bazaar
  on perf17-land was 836k triangles (budget 720k; main's last green run 519k); locally (SwiftShader) base 621k, new
  297k: the gate's mobile numbers swing with where the crowd is. Watch it.
- NOT DONE (in order of the owner's list): bodies to 1-3 draws (skin and cloth are two very different shaders: a
  shared atlas means one merged shader; ~7 draws a body still); the gate to 60 on Web (31 fps here; render is
  setProgram-bound, 100+ distinct materials); planet to 60; Mobile to 30 (10-20 now); quiet-machine re-measure and the
  cold title load (p15/ab_load.sh) never ran: the heavy queue was busy with other agents' captures most of the time.

## 2026-11-22 09:00 takeover by perf agent 18 (branch perf17 continued; landing branches perf17-land4..)
- Landing: perf17-land2 and -land3 failed. land3 (crowd camera off) failed only `smoke` ("wait for mode play" after the
  wake-up skip); the same timeout hit combat-land6 (not perf code), so it is not only mine; the smoke now prints
  state and page errors when it happens (tools/smoke.py). perf_gate's phone bazaar is bimodal: 297k or exactly 836430
  triangles; 836430 also hit combat-land7 (no perf17 code), so it is a state of main's city, not the props batching.
  perf_gate now prints the worst frame's triangles by object when a spot is over budget (find it in the log).
- Bug fixed: the crowd camera's pitch clamp applied with no crowd at all (every follow view capped at -0.18 pitch, the
  planet too). Now it eases in with the crowd only.
- three 0.187 finding: skinMaterial's subsurface-wrap replace (lights_physical_pars_fragment, "BRDF_Lambert(
  material.diffuseColor)") matches nothing any more: skin has drawn with plain lighting since the three upgrade.
- 10:15 LANDED e368b61 on main (perf17 props batching, lens fade, crowd camera behind ?crowdcam=1, the pitch fix and
  the two diagnostics; CI 45007925771 all green on that exact commit, first try).
- Machine: the heavy queue is shared with the combat agent's exclusive GPU captures; local SwiftShader runs of the gates
  took 20+ min and timed out. Use CI for SwiftShader numbers.
- 12:00 LANDED 0c68d8c on main (bodies merged, program sort, GPU pass timer; CI 45016975922 green after one rerun of
  combat's known SwiftShader click timeout, the same `#p-action` timeout that hit main df69603 and life-wip).
- Bodies (owner goal 2), src/characters/bodymerge.ts: skin (body+head), clothes and eyes of a body are ONE skinned mesh
  with one material (aPart per vertex: 0 skin, 1 cloth, 2 eye; the fragment shader runs that part's code, copied from
  skinMaterial/eyeMaterial/the cloth patch; cloth's polygon offset became a 2 mm pull to the camera; DoubleSide). The
  merged geometry is cached per source set (bodies of one look share it). Crowd bodies always; the crew and the player on
  the away stages through `fig.mergeParts()` (city FRIENDS, Mir, away.ts player); films keep the separate meshes.
  `?bodymerge=0` turns it off. GPU census (p18/bodies1): a merged crowd body draws 1 body + 1-2 kit (+ hair; + lashes and
  cornea within 5-7 m); the crew/player drew 6-7 each (skin, eyes, cloth, kit 1-2, cornea, lash): these dominated the
  crowd and gate spots, hence mergeParts. Look A/B shots (p18/look1_A_look vs look1_B_look: Strong at 1.3 m and 3 m, a
  crowd street): no visible difference found. The kit (rigid.ts) is per-body geometry, so it stays separate (folding it
  in would copy the morph data per body).
- Program sort (core/renderer.ts): opaque draws sorted by shader program, then material (three sorts by material id
  only). `?psort=0` is three's order. Costs some front-to-back order (overdraw); watch phones.
- `?gputime=1` (core/gputime.ts): GPU ms per post pass in window.__gpuTime (scene includes shadows); plans
  p18/plan_ugpu.json / plan_wgpu.json print it per spot.
- Tools: p18/ab.sh (same build, ?bodymerge=0 vs on), p18/ab2.sh (A = ?bodymerge=0&psort=0 = main's behaviour, B = new;
  Q=... appends to both URLs), plan_bodies.json (skinned draws per body), plan_look.json (photo-camera close-ups).
- A/B on the A500 (Web, 1280x720, same build dist-new, exclusive heavy, single runs, swing ~5 fps; p18/pf1_A, pf1_B,
  pf2_A): A = ?bodymerge=0&psort=0 (main before today), B = new. fps A/B/A2: bazaar 30.5/54.5/45.2, gate 35.5/47.7/40.2,
  market 37.9/60.3/52.7, square 34.1/57.8/42.6 (crowd: A runs had a first-spot load hitch, not comparable). Skinned draws
  B vs A2: bazaar 21/28, gate 14/26, market 4/6, square 11/19. The gate is still under 60 on Web (47.7).
- Ultra GPU profile (owner goal 6; p18/ug1, ?gputime=1, A500, 1280x720, pr 0.94): GPU ms per pass at bazaar / crowd /
  gate / square: scene incl. shadows 22.5 / 9.9 / 12.7 / 5.9; AO 0.8-1.5; SSR 0.2-0.7; bloom 0.5-3.2; the rest < 0.7.
  The same frames took 12.6 / 22.6 / 13.7 / 20.2 fps with the CPU's draw 61.8 / 25.6 / 65.8 / 68.5 ms and update
  11-18 ms. So Ultra is CPU-bound, not SSR/AO-bound: cheaper SSR/AO buys under 2 ms. Ultra's CPU per draw is ~140-250 us
  (Web ~50). NEXT: a CPU profile of Ultra at the bazaar and gate (build --sourcemap, plan with "profile", tools/mapprof.cjs)
  to find what costs per draw there (suspects: the 3072 shadow map's caster pass, the scans' many materials, per-draw
  uniform uploads with the extra Ultra lights).
- Clips: Downloads/BS_Game_v1.1/city_v1.8_GPU (Web, ?perf=1, no sound, README with notes). Seen in them: the overlay
  reads 21-23 fps while the screencast records (48-60 without); in 03_bazaar the camera sits low looking up into the
  crowd and a passer-by mid-fade fills ~40% of the screen as a dark dithered shape (the lens fade from 1.3 m is too
  late when the camera is low; the crowd camera is still off by default).
- NOT DONE (owner's order): (2) bodies: hair and the kit are still their own draws (a merged crowd body is body + 1-2
  kit + hair, + lashes/cornea within 5-7 m); no GPU skinning/instancing for crowds yet. (3) gate to 60 on Web: ~48.
  (4) planet to 60: not measured this session. (5) Mobile proxy to 30: not measured this session. (6) Ultra 30+: it
  is CPU-bound (see the GPU profile above); profile the CPU next. (7) quiet-machine re-measure and the cold title load:
  not run (the heavy queue was held by TTS and character builds for most of the afternoon; my runs waited 30-70 min
  each). Clips of Ultra and the planet: not recorded (p18/plan_clips18_city_ultra.json, planet_web.json are ready;
  p18/clips.sh NAME records one).
- Preview: I ran dist-new on :4182 (stopped at the end). Main's dist on :4180 is someone's long-running server, left alone.

## 2026-11-22 14:20 takeover by perf agent 19 (branch perf17 continued, rebased on main 983d105; landing branches perf18-land1..)
- Ultra CPU profile (p18/up1, plan_uprof.json, dist-base = main with --sourcemap, tools/mapprof.cjs): in the bazaar
  three's renderTransmissionPass was 31% of the render (1.7 of 5.6 s sampled): the wall clock scan's glass
  (KHR_materials_transmission, only Ultra draws the scans close) made three draw the whole opaque scene a second time
  into its transmission buffer every frame it was in view. The sun's shadow pass (WebGLShadowMap.render) was 19-21%:
  Ultra redrew the city's shadow every frame, Web every other. Lights are NOT the cost (5 point lights on Ultra);
  WebGLBindingStates.setup is VAO binding, normal per-draw cost.
- Fixed (97d58b2): city glass with transmission becomes plain see-through glass at load (city.ts model()); the city's sun
  shadow every other frame on Ultra too (Ultra's preset already says shadowInterval 2).
- WARNING about older numbers: the handoff's Ultra "12.6 / 13.7 fps, 61.8 ms submission" came from the ?gputime=1 run.
  Without the timer the same base build measured 23.1 / 58.9 (bazaar / gate) in one run and 20.2 / 23.3 in the next:
  the timer's queries inflate CPU time, and this machine swings 2x between runs. Compare only pairs run back to back.
- A/B p18/s1 (ab3.sh: base :4182 vs new :4183, one exclusive heavy call each, A500 1280x720, back to back):
  Ultra crowd 29.3 -> 38.6, bazaar 20.2 -> 32.6 (draw 40.8 -> 19.5 ms, 509 -> 319 draws), gate 23.3 -> 33.9,
  market 30.7 -> 35.4, square 30.4 -> 31.8. Worst frames are still 100-230 ms on Ultra (hitches: not yet found).
- Lens (4c59702): a passer-by fades from 2.2 m to gone at 1.1 m (was 1.3 -> 0.4: half-faded bodies filled ~40% of a low
  camera's view as a dark dithered shape). The crowd camera is on by default (?crowdcam=0 off); CI perf_gate passed with
  it on (perf18-land1). mobile_smoke failed twice there on a pixel7 screenshot timeout (SwiftShader, the job ran ~50%
  slower than main's; mobile_smoke never enters the city and both changes are city or Web/Ultra only).
- 15:55 LANDED 97d58b2 on main (lens fade, crowd camera on, Ultra shadow + glass; CI 45038887812 all green on that
  exact commit; perf18-land1's mobile_smoke screenshot timeout did not recur).
- Web A/B p18/s1 (same session): crowd 53.2 -> 46.8, bazaar 59.0 -> 56.9, gate 55.1 -> 52.2, market 60.0 -> 57.1,
  square 59.8 -> 55.4. The crowd camera draws ~30 more at crowd spots (234 -> 269, bazaar 174 -> 204); market and square
  drew the same and still dropped 3-4 fps, so part is noise. Watch the crowd camera's cost.
- Web gate is CPU-bound: GPU 6.5 ms a frame (p18/wg3, ?gputime=1), CPU update 5.8 + submission 15.6 ms (p18/wg2 profile).
  Dynamic resolution still drops the pixel ratio to 0.76 there, for nothing. Biggest draw group: 30 unbatched
  MeshBasicMaterial draws (1.8 ms) that the bazaar does not have; p18/plan_draws.json (probe_draws.js) names them.
- 16:45 the PC rebooted. A "WIP: saved after restart" commit had swept in dist-new/ (3794 build files): I dropped it
  (never pushed; no source in it) and excluded dist-*/ in the worktree's git info/exclude. Do not commit dist folders.
- 22:21 WSL restarted again. ~/bin/heavy now runs ONE heavy job machine-wide. GPU runs: p18/gpurun.sh OUT PLAN URL inside
  heavy (starts Chrome via coldchrome.sh, runs the plan, closes the tabs with ~/bs-cap/combat/tabs.py). Previews: base
  dist-base on :4182, new dist-new3 on :4183 (vite preview, started by hand; they die with WSL).
- Quiet machine right after the restart (p18/dr1, plan_draws.json): Web gate 60.4 fps, bazaar 60.5 (vsync cap). The
  earlier 48-55 at the gate was mostly contention. The gate's draws beyond the bazaar's: the 4 delivery bots (7 meshes
  each, all casting shadows), the liner's hull pieces, ~6 more transparent glows. 4c38fa4: a bot is 2 draws (body, wheels
  and flag in vertex colours, + face, the face casts no shadow), the liner hull + spokes 1 mesh: ~25 fewer main draws
  and ~20 fewer shadow draws at the gate. Pushed as perf18-land3.
- 23:05 LANDED 4c38fa4 on main (spaceport merges; CI 45077961066 green on that exact commit, first try).
- QUIET-MACHINE numbers (after the restart, one heavy job machine-wide, A500, 1280x720, single runs, back to back;
  base = dist-base = main before my work 983d105, new = dist-new3 = 4c38fa4). Everything Web/Ultra is at the vsync cap
  (60), so these show headroom only through draw_ms/update_ms:
  Web city (p18/s2_A_web, base): crowd 60.2, bazaar 60.0, gate 60.1, market 60.1, square 59.9; draw 4-5.5 ms, update 2-4.
  Ultra city base -> new (p18/s2_A_ultra, s2_B_ultra): crowd 48.4 -> 59.8, bazaar 34.9 -> 60.3, gate 50.4 -> 60.2,
  market 59.9 -> 60.2, square 60.2 -> 60.2; bazaar draw 20.0 -> 9.2 ms, 482 -> 312 draws; worst frame 50 -> 20 ms.
  Planet Web (p18/pl1_web, new): wake 60.3, wake_back 60.2, lake 60.2, forest 60.1, camp 60.1, ridge 60.2.
  Mobile proxy (p18/mb1, new, 4x CPU throttle, 844x390): flat 19.3, bazaar 20.5, crowd 17.5, gate 19.6, square 14.7,
  downtown 20.7, market 16.8, waterfront 22.1, park 18.6. Update 13-28 ms and draw 22-39 ms for only 38-124 draws:
  NOT at 30. Next: a CPU profile of Mobile (plan_mob.json + "profile": 6 at the square and crowd) and cut the update
  (characters' animate, city update) and per-draw cost there.
- Under contention the same builds read 20-35 (Ultra) and 47-55 (Web): the owner's "laggy" on a busy laptop is CPU.
- Clips: Downloads/BS_Game_v1.1/city_v1.9_GPU (Web, ?perf=1, no sound, README with notes; p18/clips19_web). Seen: overlay
  ~43 fps while recording; bazaar ~8 s a passer-by at ~2.5 m is solid and covers ~1/4 of the screen, beside him a
  half-faded body reads as a see-through ghost (no big dark dithered shape any more); gate crowd: low camera, bodies
  fill the frame. Ultra and planet clips not recorded.
- NOT DONE (owner's order): (1) Ultra: city at the vsync cap on a quiet machine; instanced crowds with GPU skinning,
  kit+hair into the body draw and static shadow caching NOT done (not needed for 30+ any more; would help a busy
  machine). (2) Web gate: 60 quiet, ~52 busy. (3) lens: mid-fade ghost still visible briefly; maybe fade faster (rate
  12 -> 20) or start at 2.6 m. (4) planet 60 on Web (quiet); Mobile proxy 15-22, needs a CPU profile and work.
  (5) cold title load (p15/ab_load.sh) not run.
- Previews :4182 and :4183 stopped at the end. dist-base, dist-new, dist-new3 are local build folders (excluded).
