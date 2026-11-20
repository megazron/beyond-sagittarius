# Zenvora mood board (reference only)

The owner asked for Zenvora to come as close as a browser and phone game can to the look of current AAA open-world
cities. I used public key art and trailer stills of one such game as a quality bar and for art direction only. None
of it is in the game or in this repository: the images live outside git (`~/bs-assets/moodboard/` on the build
machine), and nothing in Zenvora copies a name, logo, map, character, vehicle, piece of music or asset from it.
Zenvora's streets, shops, brands, people and story are this game's own.

Sources looked at: the official game page's poster and trailer stills (rockstargames.com/VI, November 2026).

## What I took from it

| Seen in the reference | What it means for Zenvora | Where it is |
| --- | --- | --- |
| Golden-hour light: a low warm sun, long shadows, a peach-to-violet sky | The prologue starts at 17:40 and the evening comes on as you play; the sky goes gold, pink, violet, navy | `daycycle.ts` |
| The sky lights everything: shade is blue, not black | The city's image-based light is its own sky, refreshed as the time changes | `daycycle.ts`, `city.ts` (`refreshEnv`) |
| Haze that grows with distance, warm by day, dark at night | Fog colour and distance follow the time and the weather | `daycycle.ts` |
| Dense, varied buildings; glass towers that mirror the sky; rooms behind lit windows | Facade shader: punched, ribbon and curtain-wall windows, glass that reflects at a grazing angle and shows a room head on (interior mapping), lit rooms that grow at night | `facade.ts` |
| Busy pavements and streets: people doing things, cars that obey lights | Walkers that loop blocks and cross on the green, people sitting, shopping, chatting, filming; cars on lanes that stop at reds and for anyone on a crossing | `districts.ts` |
| Street-level clutter that reads at a glance: lamps, trees, shelters, bins, signals, signs | Furniture along every pavement; original shop names in three scripts; rooftop billboards | `districts.ts` |
| Wet streets at night holding the neon | Rain, darker and glossier ground, puddles that act as mirrors | `daycycle.ts` (`wetify`) |
| Warm and cool parts of a city | A grade per quarter: the bazaar warm, downtown cool, the bay a little teal | `city.ts` (`TINT`) |

## Where Zenvora is still below that bar

See the honest list in `docs/QA_RELEASE.md` (the 1.1 section). In short: no screen-space reflections or ray tracing,
far people are cards, buildings are boxes with shaded detail rather than modelled facades, no driving, and phones get
a much simpler city.
