# Levels

Real status of every level. Update it in the same commit as the level.
Done means objectives, world content, NPCs, cutscene, dubbing, codex and smoke test.

## Prologue and Chapter One: The First 24 Hours

| # | Level | Status |
| --- | --- | --- |
| P | Opening: Vault, deck scene, the event | done |
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
| 11+ | Stone Age and first chemistry (knapping, cordage, pottery, charcoal, lime, glass, salt, soap) | in progress |
| | Fire and Tools, Agriculture, Bronze, Iron, Classical, Industrial, Space, Civilisation | planned, data entries only |
| 99 | The reveal, and the ending choice: stay or go home | planned |

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

- `tools/levels_smoke.py` plays Chapter One end to end through `window.__bs`. Add each new level to it.
- Spoken lines go in `src/i18n/voice.json`; `npm run voice` renders them, cached per line.
- Rescuing the other four crew is not built yet: they only exist on the deck, in the flashback, in the crew panel and on the radio.
- `src/characters/` is being moved from primitives to skinned meshes; keep the `createCharacter` API.
