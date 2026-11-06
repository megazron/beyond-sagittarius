# Title sequence: "The Scatter"

The black hole montage. It sits between the deck scene and the wake-up, runs 49.5 seconds,
and can be skipped. All of it is original: no shots, characters, logos, lyrics or music from
any show. The only thing taken from anime openings is the shape: a held breath, a drop,
cuts on the beat, a title on the hit.

Music: 160 BPM, D minor, one beat is 0.375 s, one bar is 1.5 s. `src/cinematic/beatmap.json` is
the single source of timing: `tools/make_theme.py` composes to it and `src/cinematic/montage.ts`
cuts to it.

Rules for every shot:

- One idea per shot. If it can't be read in the time it has, cut it.
- Everything on screen is a pure function of music time, so stalls drop frames, never sync.
- Each shot has a planned move, a lens, a focus point and its own light. No static filler.
- Slow in Act I, fast in Act II, comic timing in Act III, stillness after the title.
- Cheap-looking shots get cut, not polished.

## Act I: The Horizon (bars 1 to 8, 0 to 12 s, slow motion)

Music: pad, heartbeat sub, a sparse piano motif. Toms and a rolling arp enter at bar 5.
The last beat of bar 8 is silence.

| # | Beats | Shot | Camera and lens | Light | Sound |
| --- | --- | --- | --- | --- | --- |
| 1 | 0-8 | The liner, tiny, crossing the bright arc of the disk | Very long lens, slow drift, ship on the left third | Disk backlight only, ship is a silhouette | Rumble, piano note |
| 2 | 8-16 | Hull: plates peel off the spine, the ring shears, the ship stretches towards the hole | Close, slow orbit against the tear, speed ramp to slower | Hard orange from the disk, red hull lights | Metal groan, plate pops on the beat |
| 3 | 16-20 | Deck: the window cracks across and blows out, the six lift off the floor | Low wide from the back wall, slow tilt | Red alarm strobing on the beat, disk through the window | Glass, air rush |
| 4 | 20-24 | Draxum, one hand on a rib, the other arm out: "Hold on to me!" | Mid, pushing in, shallow focus | Red key, disk rim | Voice over air |
| 5 | 24-28 | Outside: the six in a ring, hand reaching for hand, the black hole behind them | Top-down wide, the ring turns slowly, zoom out | Disk rim on every figure | Everything drops out but the pad |
| 6 | 28-31 | Two hands, fingers a few centimetres apart, sliding away. "You still owe me snacks!" | Macro, focus racks hand to hand, 10% speed | Cool key, hot disk behind | Heartbeat, voice |
| 7 | 31-32 | Black. | | | One beat of silence |

## Act II: The Scatter (bars 9 to 16, 12 to 24 s, the drop)

Music: full band. Kick, snare, bass, stacked saws, lead melody. Cuts every two beats, then every
beat. Impact frames on the snare hits.

| # | Beats | Shot | Camera and lens | Light | Sound |
| --- | --- | --- | --- | --- | --- |
| 8 | 32-36 | Six streaks of colour burst out of one point | Wide, whip zoom backwards, radial blur | Flash on the drop | Drop hit, boom |
| 9 | 36-38 | Draxum, ember orange trail, spinning, furious | Tracking alongside, roll | Orange rim | Whoosh left to right |
| 10 | 38-40 | Lyrra, violet trail, eyes shut, arms folded in free fall | Tracking from below | Violet rim | Whoosh right to left |
| 11 | 40-42 | Skyvra, coral trail, reaching back the way she came | Rear chase | Coral rim | Whoosh |
| 12 | 42-44 | Bolzar, green trail, clutching a torn hull plate | Front, he comes at the lens | Green rim | Whoosh |
| 13 | 44-46 | Nuvexa, gold trail, phone still in hand | Side, roll the other way | Gold rim | Whoosh |
| 14 | 46-48 | The player, their own glow as a trail, last one out | Head-on close, pulling away | Own colour | Whoosh and a rising tone |
| 15 | 48-52 | All six trails braiding through bent space | Inside the braid, wide lens, speed lines | Palette goes to the other universe | Snare fill |
| 16 | 52-56 | Four one-beat faces then two half-beats, each in a flat two-tone impact frame | Locked close-ups | Two-tone grade | Hit per face |
| 17 | 56-64 | A planet swings up, moon and ring behind, six sparks fall on to the night side | Slow orbit, long lens, the only quiet shot in the act | Terminator light | Band drops to bass and kick |

## Act III: The Landing (bars 17 to 28, 24 to 42 s)

Each friend gets two bars: the comet comes in, it hits on the downbeat, the dust clears, a name
card slams in, then one beat of character. Dusk to dawn across the six, because they fall
through the whole night. Locations match what the beacon reports in Level 10.

| # | Beats | Who | Where | Shot | Card joke (also spoken) |
| --- | --- | --- | --- | --- | --- |
| 18 | 64-72 | Draxum | North-east forest, 1.9 km | Dusk forest, comet over the canopy, then him shoulder to a huge tree that doesn't move | "The tree started it." |
| 19 | 72-80 | Lyrra | Western lake, 3.4 km | Comet hits the lake, spray falls back, she wades out with perfect posture | "Vitals stable. Mood: no." |
| 20 | 80-88 | Bolzar | Southern hills, 5.2 km | Sits on the hull plate he rode in on, one hand up, the thumbs-up of a man who has lost | "Landing: crooked. It'll hold." |
| 21 | 88-96 | Skyvra | Fallen pod, the eastern hills | Pod in a scorched furrow, she sits against it holding her leg. Something huge passes behind the ridge | "Worst part? Nobody paid me back." |
| 22 | 96-104 | Nuvexa | Beyond the mountains, 7.8 km | Comet over bare peaks at first light, she gets up and takes a selfie | "One percent. Posting anyway." |
| 23 | 104-112 | The player | The clearing, 0 km | From the clearing: one light in the sky, getting bigger | "Hypothesis: ow." comes after the hit |

## Act IV: The Title (bars 29 to 33, 42 to 49.5 s)

| # | Beats | Shot | Camera and lens | Light | Sound |
| --- | --- | --- | --- | --- | --- |
| 24 | 112-120 | The player falling, wind and fire, every cut shorter and closer, ending in white | Close, shaking harder each beat | Own colour, then dawn | Snare roll rising, everything climbing |
| 25 | 120 | THE HIT. White, then the title | | Flash | Full chord, cymbal |
| 26 | 120-132 | The clearing at dawn: a smoking furrow, the ringed world in the sky, BEYOND SAGITTARIUS held over it, the player face down at the end of it | Very slow push from low | Dawn, smoke | Chord rings out. "Hypothesis: ow." on the last beat, muffled |

Black. The wake-up starts.

## What this replaces

Sound for each row is in `make_sfx()` in `tools/make_theme.py`, placed from the beat map.

The old pods-ejecting shot and the white-out go. The alarm, the approach and the "Pods!" line stay
before the sequence and hand over to shot 1.
