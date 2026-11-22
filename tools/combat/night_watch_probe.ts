// Where can a player watch a snare from without keeping the scavengers off it? Plays wave 1 of the night defence
// (no browser) with bait + snare 5.5 m downwind of the food and the player standing at a given spot, and prints when
// the snare catches, and how long the warning cue (rustle, voice, twig) has before the snap. node --experimental-strip-types tools/combat/night_watch_probe.ts
import { noIntent } from '../../src/combat/sim/sim.ts';
import { EncounterRun } from '../../src/combat/sim/encounters.ts';
const DT = 1 / 30;
const spots: Record<string, (fx: number, fz: number, wx: number, wz: number) => [number, number]> = {
  fire: (fx, fz, wx, wz) => [fx - wx * 1.5, fz - wz * 1.5],
  beside46: (fx, fz, wx, wz) => [fx + wx * 6.7 - wz * 4.6, fz + wz * 6.7 + wx * 4.6],
  beside7: (fx, fz, wx, wz) => [fx + wx * 4 - wz * 7, fz + wz * 4 + wx * 7],
  food: (fx, fz, wx, wz) => [fx + wz * 1.2, fz - wx * 1.2],
};
for (const seed of [5, 11, 23]) for (const [name, at] of Object.entries(spots)) {
  const R = new EncounterRun('night.defence', { seed }), I = noIntent();
  let catchT = -1, cueT = -1, nearest = 99, set = false;
  for (let i = 0; i < 200 / DT && !R.outcome; i++) {
    const s = R.sim, p = s.player, food = R.markers.find((m) => m.kind === 'food')!;
    I.mx = I.mz = 0;
    if (R.ask) { R.answer(true); continue; }
    if (R.phase === 'prep' && !set) { set = true; s.placeTrap('bait', food.x + s.windX * 5.5, food.z + s.windZ * 5.5); s.placeTrap('snare', food.x + s.windX * 5.5, food.z + s.windZ * 5.5); R.ready(); }
    const [gx, gz] = at(food.x, food.z, s.windX, s.windZ), d = Math.hypot(gx - p.x, gz - p.z);
    if (d > 0.4) { I.mx = (gx - p.x) / d; I.mz = (gz - p.z) / d; }
    // looking out downwind
    I.lx = s.windX; I.lz = s.windZ;
    R.update(DT, I); s.drain();
    const sn = s.traps.find((q) => q.kind === 'snare')!;
    if (R.wave === 1) for (const e of s.enemies) if (!e.dead && !e.gone) nearest = Math.min(nearest, Math.hypot(e.x - sn.x, e.z - sn.z));
    // the game's trap cue (combat.ts trapBeat): an animal within 3.4 m of the armed snare, walking towards it
    if (cueT < 0 && sn.armed && sn.sprungT < 0 && s.enemies.some((e) => !e.dead && !e.gone && e.heldT <= 0 && Math.hypot(e.x - sn.x, e.z - sn.z) < 3.4 && e.speed > 0.3 && Math.sin(e.yaw) * (sn.x - e.x) + Math.cos(e.yaw) * (sn.z - e.z) > 0)) cueT = s.t;
    if (sn.sprungT >= 0 && catchT < 0) catchT = sn.sprungT;
    if (R.wave >= 2) break;
  }
  console.log(`seed ${seed} ${name.padEnd(9)} catch ${catchT < 0 ? 'none' : catchT.toFixed(1) + ' s'} wave1 nearest to snare ${nearest.toFixed(1)} m, cue ${cueT < 0 ? 'none' : ((catchT - cueT).toFixed(2) + ' s before the snap')}`);
}
