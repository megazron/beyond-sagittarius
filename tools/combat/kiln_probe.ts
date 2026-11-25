// Scratch probe (not a test): Episode Two's firing night (story.firing) for a few kinds of player: how often the big one
// goes for the pit, how often it gets there, how hot the pit is at dawn. node --experimental-strip-types tools/combat/kiln_probe.ts
import { noIntent } from '../../src/combat/sim/sim.ts';
import type { Intent } from '../../src/combat/sim/sim.ts';
import { EncounterRun } from '../../src/combat/sim/encounters.ts';
import type { Difficulty } from '../../src/combat/sim/core.ts';
const DT = 1 / 60;
type Bot = (I: Intent, R: EncounterRun) => void;
const toward = (I: Intent, R: EncounterRun, x: number, z: number) => { const p = R.sim.player, d = Math.hypot(x - p.x, z - p.z) || 1; I.mx = (x - p.x) / d; I.mz = (z - p.z) / d; I.lx = I.mx; I.lz = I.mz; return d; };
const camp = (R: EncounterRun) => R.sim.fires.find((f) => !f.torch && !f.burnsOut && !f.kiln)!;
const swing = (I: Intent, R: EncounterRun, r = 2.6) => {
  const s = R.sim, p = s.player;
  const t = s.enemies.filter((e) => !e.dead && !e.routed && !e.gone).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
  if (t && Math.hypot(t.x - p.x, t.z - p.z) < r) { const d = Math.hypot(t.x - p.x, t.z - p.z) || 1; I.lx = (t.x - p.x) / d; I.lz = (t.z - p.z) / d; I.attack = p.act === 'idle' || p.act === 'recover'; return true; }
  return false;
};
const keep = (I: Intent, R: EncounterRun, f: ReturnType<typeof camp>) => { const p = R.sim.player; if (f.fuel < f.max * 0.6) { if (Math.hypot(f.x - p.x, f.z - p.z) > 1.8) { toward(I, R, f.x, f.z); return true; } R.sim.feedFire(f); } return false; };
const bots: Record<string, Bot> = {
  // stays between the fire and the pit, feeds both, fights what comes
  pit: (I, R) => { if (R.phase === 'prep') R.ready(); I.mx = I.mz = 0; if (keep(I, R, R.pit!)) return; if (keep(I, R, camp(R))) return; swing(I, R, 3); },
  // out on the trail, 7 m into the wind, fighting; back only for the camp fire
  trail: (I, R) => { if (R.phase === 'prep') R.ready(); I.mx = I.mz = 0; const f = camp(R), s = R.sim; if (keep(I, R, f)) return; if (!swing(I, R, 3)) { const d = toward(I, R, f.x + s.windX * 7, f.z + s.windZ * 7); if (d < 1) I.mx = I.mz = 0; } },
};
const out: string[] = [];
for (const diff of ['story', 'normal', 'hard'] as Difficulty[]) for (const [name, bot] of Object.entries(bots)) for (const her of [false, true]) {
  const res: string[] = [];
  for (const seed of [11, 5, 23]) {
    const inv: Record<string, number> = { branch: 8, vine: 2, stone: 4, fruit: 1 };
    const R = new EncounterRun('night.defence', { seed, difficulty: diff, inv, has: { fists: true, hafted: true }, story: { firing: true, kept: name === 'pit', left: name === 'trail', oomsa: her, oomsaRuns: her && seed === 5 } });
    const I = noIntent();
    for (let i = 0; i < 520 / DT && !R.outcome; i++) { I.attack = I.alt = I.dodge = false; if (R.ask) { R.answer(true); continue; } bot(I, R); R.update(DT, I); R.sim.drain(); }
    const o = R.outcome, F = o?.flags ?? {};
    res.push(`${o?.result ?? 'none'}@${R.t.toFixed(0)}s hp${R.sim.player.hp.toFixed(0)} raid${F['kiln.raided'] ?? 0} got${F['kiln.scattered'] ?? 0} pit${F['kiln.fuel'] ?? '-'}${F['kiln.cold'] ? ' COLD' : ''}${F['kiln.oomsaRan'] ? ' ran' : ''}`);
  }
  out.push(`${diff.padEnd(6)} ${name.padEnd(5)} ${her ? 'oomsa' : '     '} ${res.join(' | ')}`);
}
console.log(out.join('\n'));
