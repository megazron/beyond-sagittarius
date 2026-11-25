// Scratch probe (not a test): how the story's night ends for a few kinds of player, per difficulty and seed.
import { noIntent } from '../../src/combat/sim/sim.ts';
import type { Intent } from '../../src/combat/sim/sim.ts';
import { EncounterRun } from '../../src/combat/sim/encounters.ts';
import type { Difficulty } from '../../src/combat/sim/core.ts';
const DT = 1 / 60;
type Bot = (I: Intent, R: EncounterRun) => void;
const toward = (I: Intent, R: EncounterRun, x: number, z: number) => { const p = R.sim.player, d = Math.hypot(x - p.x, z - p.z) || 1; I.mx = (x - p.x) / d; I.mz = (z - p.z) / d; I.lx = I.mx; I.lz = I.mz; return d; };
const fireOf = (R: EncounterRun) => R.sim.fires.find((f) => !f.torch && !f.burnsOut)!;
const feed = (R: EncounterRun) => { const s = R.sim as any; return s.feedFireAny ? s.feedFireAny(fireOf(R)) : s.feedFire(fireOf(R)); };
const swing = (I: Intent, R: EncounterRun, r = 2.6) => {
  const s = R.sim, p = s.player;
  const t = s.enemies.filter((e) => !e.dead && !e.routed && !e.gone && e.kind !== 'darter').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
  if (t && Math.hypot(t.x - p.x, t.z - p.z) < r) { const d = Math.hypot(t.x - p.x, t.z - p.z) || 1; I.lx = (t.x - p.x) / d; I.lz = (t.z - p.z) / d; I.attack = p.act === 'idle' || p.act === 'recover'; return true; }
  return false;
};
const bots: Record<string, Bot> = {
  idle: (I, R) => { if (R.phase === 'prep') R.ready(); },
  swinger: (I, R) => { if (R.phase === 'prep') R.ready(); I.mx = I.mz = 0; swing(I, R); },
  feeder: (I, R) => { if (R.phase === 'prep') R.ready(); I.mx = I.mz = 0; const f = fireOf(R); if (f.fuel < f.max * 0.6) feed(R); },
  keeper: (I, R) => { if (R.phase === 'prep') R.ready(); I.mx = I.mz = 0; const f = fireOf(R), p = R.sim.player;
    if (f.fuel < f.max * 0.6) { if (Math.hypot(f.x - p.x, f.z - p.z) > 2.2) { toward(I, R, f.x, f.z); return; } feed(R); }
    swing(I, R, 3); },
  stakes: (I, R) => { const s = R.sim, p = s.player, f = fireOf(R);
    if (R.phase === 'prep') { if (!s.traps.length) { const food = R.markers.find((m) => m.kind === 'food')!; for (let i = 0; i < 3; i++) s.placeTrap('stakes', food.x + s.windX * (3 + i), food.z + s.windZ * (3 + i) + i); } R.ready(); return; }
    I.mx = I.mz = 0; if (f.fuel < f.max * 0.6) { if (Math.hypot(f.x - p.x, f.z - p.z) > 2.2) { toward(I, R, f.x, f.z); return; } feed(R); } swing(I, R, 3); },
};
const out: string[] = [];
for (const diff of ['story', 'normal', 'hard'] as Difficulty[]) for (const [name, bot] of Object.entries(bots)) {
  const res: string[] = [];
  for (const seed of [11, 5, 23, 41]) {
    const inv: Record<string, number> = { branch: 8, vine: 2, stone: 4, fruit: 1 };
    const R = new EncounterRun('night.defence', { seed, difficulty: diff, inv, has: { fists: true, spear: true } });
    const I = noIntent(); let minF = 999;
    for (let i = 0; i < 480 / DT && !R.outcome; i++) { I.attack = I.alt = I.dodge = false; if (R.ask) { R.answer(true); continue; } bot(I, R); R.update(DT, I); R.sim.drain(); if (R.phase.startsWith('wave') || R.phase === 'lull') minF = Math.min(minF, fireOf(R).fuel); }
    const o = R.outcome; res.push(`${o?.result ?? 'none'}@${R.t.toFixed(0)}s hp${R.sim.player.hp.toFixed(0)} f${minF.toFixed(0)} b${R.sim.inv.branch ?? 0} food${o?.flags['night.food'] ?? '-'}`);
  }
  out.push(`${diff.padEnd(6)} ${name.padEnd(8)} ${res.join(' | ')}`);
}
console.log(out.join('\n'));
