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

## Handover notes

- `tools/levels_smoke.py` plays Chapter One end to end through `window.__bs`. Add each new level to it.
- Spoken lines go in `src/i18n/voice.json`; `npm run voice` renders them, cached per line.
- Rescuing the other four crew is not built yet: they only exist on the deck, in the flashback, in the crew panel and on the radio.
- `src/characters/` is being moved from primitives to skinned meshes; keep the `createCharacter` API.
