# Fights: how the story calls them

Everything is on one object, `game.combat` (made in `main.ts`, class `Combat` in `src/combat/combat.ts`; types are
exported from `src/combat/index.ts`). The story never needs to import anything else from `src/combat`.

## A set piece

```ts
const out = await game.combat.startEncounter('night.defence', {
  companion: 'explorer',            // optional: someone beside the player who cannot fight
  story: { cubKilled: true },       // optional: what the story knows that changes the fight
});
// out.result: 'won' | 'lost' | 'spared' | 'left'
// out.flags: facts to copy into the story's own flags
// out.companionLost: a crew id or null. The fight never shows it; the story tells it.
```

The call fades to the place, runs the fight with the player's own bag, weapons, injuries and health, and resolves when
it is over (about 1.5 s after the last moment, through black, back where the player stood). The player cannot die in
an encounter: at zero they go down, the result is `lost` and `flags.scarred` is set. Call it only while `game.mode` is
`'play'`. `game.combat.leaveEncounter()` calls it off (`result: 'left'`, or `'spared'` in the hunt).

| id | What it is | `story` it reads | Flags it can set |
| --- | --- | --- | --- |
| `hunt.first` | A meadow, three Nibbets, two Mossbacks to leave alone. Ends when the player has knelt by the kill | `poisoned`, `hurt` | `hunt.kill`, `hunt.clean`, `hunt.failed`, `hunt.spared`, `scarred` |
| `night.defence` | The camp fire, a food store, time to set traps, three waves, dawn | `cubKilled` (the hunter does not wait), `fireHigh` (a full fire), `poisoned`, `hurt` | `night.held`, `night.food` (0 to 4), `night.fireKept`, `night.houndDriven`, `scarred` |
| `chase.escape` | 125 m to the fire with the hunter behind, three trunks to vault (quick press) | `poisoned` (shorter windows), `hurt` | `chase.escaped`, `chase.clean`, `chase.hit`, `scarred` |
| `stealth.pass` | Past the sleeping hunter by day; a breath moment beside it | `hurt` | `stealth.through`, `stealth.clean`, `stealth.seen`, `stealth.breath`, `scarred` |
| `arena` | The proving ground: every weapon, a kit that brings creatures out, a dormant guardian | none | none |

`out.injuries` lists what the player carries out of it (`bite`, `ribs`, `sprain`, `sting`); they stay on the save
until treated. `out.stats` has the counts (damage dealt and taken, rolls, parries, trap hits, food lost).

## A tension moment on its own

```ts
const r = await game.combat.tension({ kind: 'steady', seconds: 5, strain: 1.3 });
// r.passed, r.score (0 to 1), r.misses
```

Kinds: `quick` (press as the ring closes into the band; `count` for several in a row), `steady` (keep the marker in the
moving band for `seconds`), `breath` (press on your own heartbeat, `count` beats), `aim` (put the mark on a moving
target and press before the ring closes). `strain` above 1 narrows the windows (an injury, poison). Difficulty and the
player's accessibility switches (hold instead of timing, aim help) are applied for you. Time in the game should stand
still while one is open: `game.combat.tensionOpen` says so.

## Other things the story may want

- `game.combat.treat(id?)`: the Medic sees to one injury or all of them.
- `game.combat.engaged`, `game.combat.threat`: a fight has the controls; something hostile is near.
- The set pieces can be tried on their own from Pause, Action (a trial changes nothing in the save), or with
  `?combat=<id>` in the address.

## What the fight does not do

It does not speak, show cutscenes, write story flags or decide what a loss means. It plays sounds and shows its own
HUD. A death of a companion is only ever a field in the outcome.

## Inventions: what may be in the hand

`src/combat/sim/inventions.ts` lists what the people of the crash can make, matched to the rows of the story's
invention tree (Age 1 table). When the story teaches one, set `save.flags['inv.<id>'] = true` (or push the id to
`save.inventions`). Free play only puts known weapons in the hand and only offers known traps; the set pieces carry
their own Episode One kit; the dev arena ignores it all.

| id | tree row | gives |
| --- | --- | --- |
| `throwStone` | (always) | thrown stone |
| `goodStone` | 2 | (picking flint) |
| `flake` | 3 | stone flake |
| `woodBone` | 4 | club |
| `fireDrill` | 5 | fire (and with it `torch`, `fireline`) |
| `fireSpear` | 9 | fire-hardened spear (and `stakes`) |
| `cordage` | 10 | (cord) |
| `handAxe` | 11 | hand axe (a heavy short chop, three stones) |
| `hafting` | 12 | stone-tipped spear |
| `atlatl` | 13 | spear-thrower and darts |
| `traps` | 14 | snare, rattle line, figure-four deadfall (free play; small animals come to its bait) |
| `sling` | 22 | sling |
| `bow` | 19 | bow and arrows |

Known without teaching: `throwStone`, `woodBone`, `bait`. The older flags still count: `flags.spear` gives
`fireSpear` and `flake`; `flags.fire` gives `fireDrill`, `torch`, `fireline`.
