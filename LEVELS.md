# Levels

Real status of every level. Update it in the same commit as the level.
Done means objectives, world content, NPCs, cutscene, dubbing, codex and smoke test.

## Prologue and Chapter One: The First 24 Hours

| # | Level | Status |
| --- | --- | --- |
| P | Opening: Vault, deck scene, the event, title sequence | done |
| 1 | Find Water | done, plus tutorial |
| 2 | Find Food | done |
| 3 | Collect Stones and Branches | done |
| 4 | Make Fire | done |
| 5 | Build a Shelter | done, fight flashback follows |
| 6 | Craft a Spear | done |
| 7 | Survive the First Night | done |
| 8 | Find the Signal | done |
| 9 | Reunite with the Explorer | done |
| 10 | Light the Beacon | done, final Vault scene follows |

## The Scatter: where the six landed (PROPOSED, awaiting owner review)

Nothing below is built yet. The opening shows the six separate and only the player's landing. Everyone else's fate is
revealed in their own film at the moment they unlock, then the player controls them on their own ground.

The system: one green world (the player's), a ringed giant in its sky (the second "world" of `wake.line2`), the giant's
methane moon, a loose band of rubble, and a hot cloud-wrapped planet closer to the star. All names are working titles.

| Unlock | Who | Where | Lineage trait that keeps them alive | Real science it leans on | Own tasks |
| --- | --- | --- | --- | --- | --- |
| Start | Zenvik, Ulari | The green world, surface | Under-ice lungs and cold-water diving reflex; the player's own lineage can change this | Mammalian dive reflex | Research, analysis, the science tree |
| Level 9 | Skyvra, Tarnkin | The Long Ice: an ice boulder in the giant's ring, pod 2 wedged in it | Antifreeze blood and torpor; the tail is a balance organ in near-zero gravity. The pod cracks ring ice into air | Antifreeze glycoproteins in polar fish; ground squirrels that supercool below 0 C | Tracking, navigating boulder to boulder, scouting |
| End of Stone Age (14) | Bolzar, Ortek | The Scree: a rubble asteroid, airless | Mineral dermal plates that seal; oxygen banked in muscle for hours outside | Scaly-foot snail iron armour; seal myoglobin | Welding shelter from hull, tools, machines |
| After soap (19) | Lyrra, Vael | Open space, adrift in a tumbling hull section, no ground at all | Lichen symbiont in her violet skin: she dries down into dormancy and wakes when the wreck turns into sunlight, so her radio only works in bursts | Tardigrade and lichen survival in open vacuum (ESA exposure tests); retinal based purple photosynthesis | Self surgery, growing lichen for air, triage over radio |
| Agriculture (21 or next) | Draxum, Korrath | Hadrik: the giant's methane moon, nitrogen air, lakes of liquid methane | Titan foundry lineage: burns hydrogen and acetylene instead of oxygen, ember seams hold body heat | Proposed Titan biochemistry (McKay 2005) | Heavy carry, breaking ice bedrock, defences |
| Bronze Age | Nuvexa, Sirelle | Sulva: the cloud deck of the hot planet, drifting at the one height with sane pressure | Venus cloud lineage: acid-proof skin, and breathable air is a lifting gas in thick carbon dioxide, so her pod simply floats | Air is buoyant in a CO2 atmosphere (Venus aerostat studies) | Morale, negotiation with whatever lives in the clouds, signal relays |

**One decision for the owner: Skyvra.** She is physically present in Levels 9 and 10 and at the camp through Chapter Two.

- Option B, recommended and used in the table: she is on the ring. Level 8 finds her signal, Level 9 is her survival film and the first character switch: the splint quick-time becomes something the player does as her. The fire and accusation choices stay, over radio. After the beacon she appears at camp as a flickering projection, so Chapter Two conversations keep working. Meets "everyone somewhere different" literally.
- Option A: she stays on the green world, in a far region. Cheapest, least re-recording, but two of the six share a world.

**What has to change** (either option unless noted):

- Title sequence: Act III's five landings, cards and jokes go (`film.loc.*`, the card lines). Six streaks split into the dark, and only the player's fall and landing remain. Music and beat map stay.
- `beacon.strong/medic/builder/social`: distances are removed. They report alive and "origin unresolved".
- Rewritten and re-voiced: `rad.*`, `rad.ch2.*`, `br.rad.strong.truth`, `br.rad.builder.smoke`, `br.fire.ask`, `dlg.8.found`, `dlg.10.2`, `dlg.10.3`. Option B adds `dlg.9.*` (11) and the camp and rescue scenes.
- New voiced lines: five unlock films, about eight lines each.
- Saves: decision ids, trust and the record keep their names. `crewFollow` and `crewCamp` are migrated on load. A save past Level 9 unlocks Skyvra without replaying her film.

**Landings have consequence** (owner rule, for the player's landing in the opening and for each reveal film):

- Entry takes time: atmosphere, ring or asteroid approach, heat and shake, then a real crash with debris, dust and a crater.
- Nobody stands up and walks. Lying still, coming round, struggling up, then limping.
- The lineage trait is part of why they live through the impact, not only the place: Zenvik's dive reflex shuts the body down through the hit, Bolzar's plates take it, and so on.
- The wake-up follows: the player moves like someone hurt and recovers through the early tutorial (limp and slow turn at first, full speed by the end of Level 2 or so).

**Black hole entry, longer** (owner rule): approach, gravity taking hold, ship and crew straining, then the fall through. The current cut reaches the break in 6 seconds. This needs a longer Act I in `beatmap.json` and a regenerated score from `tools/make_theme.py`.

**Main dramatic beats** (PROPOSED). The running jokes are the weapon: each one comes back as the sad beat. Every beat is a choice or the bill for one.

| Chapter | Beat | Choice and consequence |
| --- | --- | --- |
| Prologue, deck | Suspicion: Draxum spots a course change under Zenvik's login minutes before the event. The banter turns sharp in front of everyone | Own up to the odd log, joke it off, or stay quiet. Sets the trust the whole crew starts with |
| Prologue, the fall | The promise: "I won't let go." Fingers a few centimetres apart. "You still owe me snacks!" | Fixed beat. It is the debt every later Skyvra scene collects on |
| Ch 1, Level 8 | The dying radio: the first voice found is Nuvexa's, one percent, mid joke, then asking someone to tell her mum she ate. It cuts out | Stay on her channel or follow the stronger signal. Decides who you reach first, and she remembers |
| Ch 1, Level 9 | Skyvra's film: she heard every call you made to someone else while she was freezing | Early or late arrival, the splint. Her first words change |
| Ch 1, Level 10 | Left behind: the beacon can only hold one weak channel. Lyrra's sun window closes in minutes, Bolzar's air counter is running | Pick one. The other gets silence for a whole age. This is the player's own fault and the game says so |
| Ch 1, Level 10 | The accusation: "Did you bring us here on purpose?" | Already built, stays |
| Ch 2, Level 14 | A reunion that goes wrong: Bolzar has been alone and sealed in. He is quieter, stops joking, and won't open the hatch if you left him | Low trust: he refuses to share the hull, and you lose his tools until you repair it |
| Ch 2, Level 19 | The secret: Lyrra wakes with sealed orders in her file. The crew were chosen for their lineages. "SUBJECTS: SIX" was never about strangers | Tell the crew now, or sit on it. Found out later, it costs her and you |
| Ch 3, Agriculture | Betrayal suspicion: the login was used from inside the six. Draxum wants a name | Accuse someone. Wrong accusation is permanent, and they stop answering |
| Ch 4, Bronze | The real loss: Bolzar holds a failing seal so the others get out. His last line on the radio is "It'll hold." | If you left him at Level 10 or never repaired it, he dies. If you did, he lives, and someone else pays. The loss direction above applies, no gore |
| Ch 4 on | The empty chair: his snack share, his crooked weld, his channel left open. Others joke, then stop | The crew's lines change for good, and the Ledger keeps his name |
| Level 99 | Stay or go home, with whoever is left | Endings already wired read all of the above |

## Chapter Two and later

| Levels | Age | Status |
| --- | --- | --- |
| 11 to 14 | Stone Age: knapping, cordage, fire, pottery | playable, dubbing to render |
| 15 to 19 | Fire and Tools: charcoal, lime, salt, glass, soap | playable, dubbing to render |
| 20 to 21 | Agriculture, first part: fermentation, acids and bases | playable, dubbing to render |
| | Farming, irrigation, Bronze, Iron, Classical, Industrial, Space, Civilisation | planned, data entries only (`src/game/tech/data.ts`) |
| 99 | The reveal, and the ending choice: stay or go home | planned |

## Choices

Branching story system. All of it is data in `src/game/branch/`: write a level against the types in `types.ts`, register it in `registry.ts`.

- **Data**: `Decision` (timed if `seconds` is set), `Qte`, `Hidden` (with `Payoff`s that land at a level), `Cond`, `Effect`, `Comment`, `Ending`, `Chapter` with its path tree.
- **Beats**: a `Beat` takes `if`, `choice`, `qte`, `swap`, `requires`, `fallback`, `effects`. A dead speaker's line is skipped, or replaced by `fallback`; `LINE_RULES` does the same for `ui.say`. Skip jumps to the next open choice, never past it.
- **Save**: `save.branch` holds trust (`from>to`), the record (honesty, mercy, nerve, humour), the decisions log, the dead, pending payoffs and any panel left open. Written the moment a panel opens and the moment it is answered; a panel left open comes back on load.
- **UI**: decisions use the conversation panel (`game/dialogue.ts`) with a countdown ring; keys 1 to 9, arrows and Enter, tap, pad. Quick-time prompt in `ui/choice.ts`. Choice timers off in Settings, System. Ledger tab in the menu, also shown after each chapter. Chapters on the title; a replay has its own save slot and cannot touch the main story.

| Branch | Where | Kind | Consequence | Status |
| --- | --- | --- | --- | --- |
| Reaching Skyvra early or late | level 9 | measured, never shown | her first lines, trust, MegaZroN | done |
| The splint | level 9 | quick-time | her line, trust, nerve | done |
| The fire at camp | level 9 | decision, no timer | trust, nerve, Bolzar's radio line | done |
| The accusation | level 10 | 10 second choice, silence if it runs out | her answer, Lyrra's and Draxum's radio reactions, trust, the record, `c1.skyvraDoubts` | done |
| Hand her the whole log | level 10 | fourth option, needs her trust at 3 | `c1.logShared` | done |
| Sharing food with Pello | any, before the beacon | hidden | scrap and his line at level 10 | done |
| Tovik's miscount | before level 9 | hidden | a vine at level 9, or his price goes up | done |
| Ledger read back | after levels 7 and 10 | Vault lines from the record | hints and comments | done |
| Chapter Two branches, trust changing later scenes | | | | planned |
| Any crew death | | supported by data, nobody dies yet | | planned |
| Endings: stay or go home (four stubs in `endings.ts`) | level 99 | | | planned |

## Combat and boss direction (planned, not built)

Original designs only: no characters, techniques, names or lines from any series. Violence stays teen-safe, no gore.

- Combat: dodge, parry, combos, and abilities that come from the tech tree, so science can turn a fight (chemistry, physics, terrain).
- Boss fights in phases, with reversals, mid-fight dialogue, a rival with a real ideology, betrayals, sacrifices and real "they might die" tension.
- Presentation: cinematic cameras, slow motion, impact frames, shake, and music that rises with each phase.
- Pacing: a quiet friend moment before each disaster, a cliffhanger at the end of each chapter, mysteries that pay off at Level 99.
- A rival and a major boss for each age:

| Age | Rival | Boss | Status |
| --- | --- | --- | --- |
| Stone Age | to design | to design | planned |
| Fire and Tools to Civilisation | to design | to design | planned |
| Level 99 | the thing that said "welcome back" | to design | planned |

## Loss and grief direction (planned, not built)

Original story only. Teen-safe, handled with care. Self-harm and suicide are never story content.

- Earn it first: warmth, running jokes and small promises, so a joke that returns after a death hurts.
- Losses tied to the player's choices: someone who trusted you dies because you were late; a saved friend no longer remembers you; you give up what you want most to protect the others and nobody ever knows; a goodbye over a failing radio; the funny friend goes quiet.
- Let silence work: no voice lines for a moment, a muted piano, an empty seat at the campfire that stays empty, a dead friend's old messages still in the group chat.
- Grief changes the crew's dialogue and gameplay afterwards.

## Handover notes

- Branch not yet on main: `wip-branch` (choices system). It needs a rebase onto the new HUD and skinned characters, then its tests.
- Chatterbox dubbing is rendering into `public/audio/vo/en` from the main tree, resumable through `tools/tts/.cache`. Never commit `public/audio/vo` until a language finishes, or the index is partial. Then run `tools/tts/lipsync.py`.
- `tools/levels_smoke.py` plays Chapters One and Two end to end through `window.__bs`. Add each new level to it.
- A new discovery is one entry in `src/game/tech/data.ts` plus text keys (`tech.`, `codex.`, `mg.`, `teach.`, `after.`). Keep it qualitative: no quantities, no recipes.
- Spoken lines go in `src/i18n/voice.json`; `npm run voice` renders them, cached per line.
- Rescuing the other four crew is not built yet: they only exist on the deck, in the flashback, in the crew panel and on the radio.
- `src/characters/` is being moved from primitives to skinned meshes; keep the `createCharacter` API.
