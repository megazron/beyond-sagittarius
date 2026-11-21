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
