# Mechanics notes: what the fighting and surviving are built on

I wrote this before building the picture and the controls, so the rules come from somewhere. Each line is a principle,
where it comes from, and what it does in this game. "Seen" means I read it on the page; "second hand" means a search
summary or a secondary write-up only, so the number may be off. The numbers in the game live in
`src/combat/sim/` (`core.ts`, `weapons.ts`, `species.ts`), and `tools/combat/sim_test.ts` holds them.

## 1. An attack has to be readable before it lands

- A Dark Souls 3 attack is five parts: opening pose, signal, attack, end pose, return. Signal plus attack is at least
  about 340 ms, the end pose at least 170 ms, and the return is the window to hit back. People need about 240 ms to see,
  decide and move. (Seen: gamedeveloper.com, "Anatomy of an enemy attack in Dark Souls 3".)
  Here: every attack is wind-up, strike, recover. No wind-up is under 0.4 s on Hard (a test fails if one is), the
  Duskhound's leap is 0.95 s, the Mossback's charge 1.15 s. Every recover is longer than the roll, and most open a weak
  point, so the answer to "when do I hit it" is always "after it missed".
- Telegraph on more than one channel: pose, light, sound. (Seen: gamedeveloper.com, "Enemy attacks and telegraphing".)
  Here: a crouch or a pawing pose, the eyes or the spine ridge flaring, a sound for each attack, and a mark on the
  ground that fills as the wind-up runs out.
- With a close camera, threats behind you need an arrow, and only a couple of enemies should attack at once. (God of
  War 2018 GDC talk; I only read a summary, so second hand.)
  Here: arrows at the screen edge for anything winding up off screen, and attack tokens: one creature may be mid-attack
  on Story, two on Normal, three on Hard. The rest circle.

## 2. Weight: hit-stop and shake, used sparingly

- Smash Bros freezes both sides for a few frames on a hit, more for a bigger hit (Melee: damage/3 + 3 frames).
  (Seen: ssbwiki.com/Hitlag.) Vlambeer's talk is a list of small things: a little shake against the direction of
  fire, a pause on impact. (Seen: gamedeveloper.com write-up; it gives no numbers.)
  Here: 40 to 110 ms of hit-stop scaled by damage, only on hits that land, never on a miss; shake only when the player
  is hit or something heavy lands. Both can be turned off.

## 3. The dodge is the weak player's best tool, so it must be honest

- Dark Souls rolls: about 11 invincible frames, then recovery that grows with load; DS3's medium roll is invincible
  for about 433 ms from its first frame, which is longer than the shortest attack signal, so rolling on reaction
  works. (Seen: fextralife equip load table; gamedeveloper.com DS3 article.)
  Here: the roll is 0.62 s, invincible for the first 0.42 s from the first frame, and it costs 18 stamina. It also
  slips a Lashbloom's vine.
- Forgiveness is hidden help: buffered inputs, coyote time. (Seen: Maddy Thorson, "Celeste and forgiveness".)
  Here: an attack pressed during the last half of the recover is taken, and a block raised up to 0.22 s before a hit
  counts as a perfect one (0.36 s with hold-to-press).

## 4. Stamina gates aggression

- In Dark Souls holding a shield up cuts stamina recovery by about 80%, so turtling starves the attack. (Seen:
  darksouls.wikidot.com/stamina.) In Breath of the Wild an empty wheel forces a slow walk. (Second hand.)
  Here: swings, rolls, blocks and a drawn bow all spend the one bar the survival game already had; it does not refill
  while you block; a guard that runs out breaks and you stagger. Hunger, thirst, cold and wounds slow how fast it
  comes back, so the day's survival decides the night's fight.

## 5. Creatures that can be read, and outwitted

- Thief: view cones, discrete awareness states, alertness that rises with a delay and drains slowly. The Last of Us:
  one to two seconds in view before you are detected, a last known position that is searched. (Both seen:
  gamedeveloper.com.) Here: sight is a cone with a day and a night range, hearing carries by how fast you move, smell
  goes down the wind; alert rises while it senses you and falls when it does not; a creature that loses you goes to
  where it last sensed you and looks.
- Halo: "if it isn't totally obvious, it's too subtle"; players did not notice clever behaviour unless it was shown.
  (Seen: Bungie's GDC 2002 talk.) Here: every state has its own pose and sound, and looking at a creature for a few
  seconds (Field Analysis) writes what you learned on the screen.
- Rain World: creatures live for themselves and are "smart enough to be outwitted". (Seen: gamedeveloper.com.)
  DOOM 2016: attack tokens. (Seen.) Here: Skritch want the food, not you; the Duskhound sleeps by day; the Mossback
  only wants you gone.

## 6. Difficulty and access

- Celeste's Assist Mode: speed down to 50%, more dashes, invincibility, no shame attached. (Seen: celeste.ink.)
  Resident Evil 4 adapts quietly. (Seen: Wikipedia, dynamic difficulty.) Apex: aim assist is "a critical
  accessibility feature". (Seen: pcgamesn.)
  Here: Story, Normal, Hard change damage taken, creature health, telegraph length, tokens and tension windows, never
  the rules. Separately: aim assist off/normal/strong, hold-to-press, slow-motion assist, no timers.
- Touch targets: at least 1 cm, 48 dp on Android. (Seen: nngroup.com; Google's accessibility help.)
  Here: every combat button on touch is at least 56 px, the fire button 84 px.

## 7. Aim assist

- Halo splits it in two: friction near a target, and shots that bend a little. (Seen: halopedia.)
  Here: shots bend towards a creature inside a cone round the reticle (10 degrees on Normal), three quarters of the
  way at normal assist and all the way at strong; on touch and pad the reticle also slows over a target. The shot
  still strays by the weapon's own spread, so help does not make a sling a rifle.

## 8. Survival that serves the player

- Valheim's makers thought simulation for its own sake was redundant: food is a buff. The Long Dark makes cold
  urgent and hunger a slow tax. (Valheim seen on Wikipedia; Long Dark second hand.) Green Hell makes you look at the
  wound and dress it. (Second hand.)
  Here: hunger and thirst below 40% cost stamina recovery and strength, cold shakes the aim, and none of them kills in
  a fight. A bite is an injury that stays, turns bad after a day untreated and then costs health until it is treated.
- Durability gives variety when what breaks is easy to remake. (Breath of the Wild, second hand.)
  Here: a stone spear point lasts 45 blows, a club 70, a torch four minutes. Each is one or two things you can pick
  up, so a break is a trip, not a loss.

## 9. The real world

- Self bows throw an arrow at 36 to 44 m/s; replica atlatls 20 to 30 m/s and are accurate to about 20 m. (Seen:
  Wikipedia, Atlatl.) Javelin athletes throwing replica Stone Age spears hit 58% at 5 m and 25% at 10 m. (Seen:
  sciencenews.org.) A sling needs 31 m/s to reach 100 m. (Seen: slinging.org, calculated.)
  Here: bow 40 m/s, sling 30, thrown spear 21, thrown stone 17, all under 9.81 m/s2. A thrown spear strays up to five
  degrees: you get close first, or you miss.
- Tigers come from behind and rarely press an attack once seen. (Seen: Wikipedia, Tiger attack.)
  Here: the Duskhound works round to your back, slows and waits while you look at it, and leaps when you look away.
- Wolves test, give up often, and chase what runs. (Seen: Wikipedia, Wolf.) Here: it chases a runner flat out, and
  at 30% health it leaves.
- Bison and moose warn first (pawing, head down, a bluff charge); get behind a tree. (Seen: nps.gov Yellowstone
  safety; adfg.alaska.gov.) Here: the Mossback snorts and stamps, then bluffs once, then charges for real; a trunk
  behind you stops it and stuns it.
- Fire keeps animals off, but not reliably. (Second hand: Nimmo et al. 2021.) Here: the light is safe only while
  the fire is fed; as it burns down its circle shrinks, and the hunter stands at the edge of it.
- Dirty wounds infect in 24 to 72 hours. (Seen: seattlechildrens.org.) Here: 24 game hours.

## What I could not source

Hades dash frames, Monster Hunter roll frames, God of War hit-stop frames, touch aiming in mobile shooters, Vlambeer's
actual shake values. Where I had no number I tuned by the tests and by playing, and say so.

## 9. The bow and the sling, done the way people do them (owner note: "the animation is not good")

- Shot sequence in archery coaching material: stance side-on with feet across the shooting line, nock the arrow
  under the nock locator, set the grip, raise the bow arm to shoulder height, draw with the back to a fixed anchor on
  the face (string at the nose tip and mouth corner, or under the jaw), aim, release by relaxing the fingers while
  the back keeps pulling, follow through: the draw hand goes back beside the neck and the bow arm stays up until the
  arrow lands. (Seen: Mississippi State Extension P3249/P1564 archery guides; University of Arizona extension
  "Archery First Shot Fundamentals" checklist; NASP "11 Steps to Archery Success"; Human Kinetics "Establish perfect
  archery form".) Here: side-on stance, two-bone arm reach to a nock point that slides from the brace height to an
  anchor under the jaw, string and limbs bend with the draw, a short steady hold then a growing tremor (and a wider
  spread in the simulation), a release that snaps the string straight and sends the hand back past the ear while
  the bow arm stays up and the bow tips forward, and a nock from the quiver at the hip before the next shot.
- Slinging (hobbyist sources, so timings vary): the retention loop goes on the middle finger and the release cord is
  pinched between thumb and index finger; a loaded sling is dropped and set going with one or more turns; the throw
  is an overhand "baseball" motion with the hips turning as the pouch passes overhead, the speed comes at the end,
  and the release cord is let go so the stone leaves on the tangent toward the target; underhand throws go further
  and land less true. (Seen: slinging.org technique pages; Mother Earth News "hand sling"; Art of Manliness
  paracord sling.) Here: stone into the pouch, overhead whirl while the button is held, a step with the off foot and
  an overhand throw on release (the stone leaves about 0.14 s after the press is let go, when the pouch comes over),
  follow-through across the body, and the empty pouch swings on its cords and settles.

## 10. What came first: the Stone Age order (owner note: "all the inventions from scratch of stone age")

- Wooden spears: Schoeningen, Germany, long dated to about 300 to 400 thousand years ago (some newer work dates
  them younger); points hardened and shaped, no stone tip. Hafted stone points: Kathu Pan, about 500 thousand years
  ago (proposed). Bow and stone-tipped arrows: Sibudu Cave, South Africa, about 64 thousand years ago (Lombard and
  Phillipson, Antiquity 2010) and a bone point about 61.7 thousand (Backwell et al., Antiquity 2018). The sling
  leaves almost nothing behind (cord and leather rot); I found no early date I trust, so it sits late with the bow.
  (Seen: Cambridge Antiquity abstracts; The Past; History News Network.)
- Here: `src/combat/sim/inventions.ts` holds the order. Episode One: thrown stones, fire, club, torch, a struck
  flake, the fire-hardened spear, traps. Then hafted points, the spear-thrower, the sling and the bow. Metal, the
  crossbow and the ship's salvage are ages later and live only in the dev arena.
- The hand axe (Acheulean, the story tree's row 11, about 1.76 million years ago in Kenya) is a tool first: a flint
  teardrop with an edge all round, held without a handle. As a weapon here it is a short, heavy chop: a little less
  damage than the club, a shorter reach, faster, and it barely wears (stone). It needs the flake (row 3).

## 11. The spear-thrower cast (owner note: the full draw read as a wide "T")

- Throwing guides agree on the outline and differ in the details: a right-hander points the left foot at the target
  with the right foot back about a shoulder's width (Make: "The Atlatl"); the dart is raised to eye level and the arm
  drawn back with a straight wrist while the dart stays aimed at the target, then a step forward slides the arm ahead
  and near full extension the wrist snaps so the thrower ends pointing at the target (University of Regina, "How to
  throw"); the throw is a step, a turn of the body that brings shoulder and arm in, the wrist snap, and a follow-through
  (World Atlatl Association, "How to throw"); most of the dart's speed comes from the lever turning at the wrist, not
  the hand pushing (Baugh 2003, as cited there). 3 Rivers Archery notes there is no one right technique.
- Here: side-on while drawn (the turn is in the hips and chest, so the drawn hand is behind the body, not out to the
  side), the thrower hand at head height beside the ear with the elbow bent and down, the dart level over the
  shoulder, the off hand bent in front of the chest pointing the way (not flung out straight). On the cast the body
  squares, the off hand pulls in, the arm drives forward and the thrower flips over the hand, then follows through
  down across the body.

## 12. Traps that read at night (owner note: the traps must be seen catching)

- Animals find food by smell carried downwind and come up the scent trail into the wind (the same reason hunters
  stalk from downwind; the hunt already uses it). Here the night's breeze blows from the fire across the food and out
  into the dark; the camp smoke leans that way, and the scavengers come from that side. A player who reads the smoke
  knows where to set the traps.
- The snare is a spring-pole snare: a bent sapling held by a trigger over a noose; a foot in the loop trips it and the
  pole whips up and holds the leg. It is drawn that way and snaps up on a catch, with the cord to the leg.
- The figure-four deadfall (the story tree's row 14 names it): a flat stone propped on three notched sticks, the bait
  on the trigger stick. For small game; a big animal knocks it over. Here: small creatures that come to its bait are
  crushed or stunned, a heavy one only springs it. Grazers now walk to fruit left within their nose.
