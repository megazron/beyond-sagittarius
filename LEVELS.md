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
