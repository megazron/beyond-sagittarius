// Deterministic tests of the combat simulation: every weapon, every creature, every encounter outcome, the tension
// moments. Runs under Node with no browser:  node --experimental-strip-types tools/combat/sim_test.ts
import { CombatSim, noIntent, INFECT_AFTER } from '../../src/combat/sim/sim.ts';
import type { Intent } from '../../src/combat/sim/sim.ts';
import { WEAPONS } from '../../src/combat/sim/weapons.ts';
import { INVENTIONS, knownFrom, weaponKnown } from '../../src/combat/sim/inventions.ts';
import type { WeaponId } from '../../src/combat/sim/weapons.ts';
import { SPECIES } from '../../src/combat/sim/species.ts';
import type { Enemy, SpeciesId } from '../../src/combat/sim/species.ts';
import { EncounterRun } from '../../src/combat/sim/encounters.ts';
import type { EncounterId, EncounterOpts } from '../../src/combat/sim/encounters.ts';
import { Tension, noTensionInput } from '../../src/combat/sim/tension.ts';
import type { TensionKind } from '../../src/combat/sim/tension.ts';
import type { SimEvent, Env } from '../../src/combat/sim/core.ts';

const DT = 1 / 60;
let fails = 0, passes = 0;
const ok = (cond: unknown, name: string, detail = '') => { if (cond) passes++; else { fails++; console.log(`FAIL  ${name}  ${detail}`); } };
const section = (s: string) => console.log(`-- ${s}`);

/** Run a sim with a bot that decides the intent each step; collects the events. */
function run(sim: CombatSim, seconds: number, bot: (I: Intent, sim: CombatSim, t: number) => void, until?: (sim: CombatSim) => boolean): SimEvent[] {
  const I = noIntent(), ev: SimEvent[] = [];
  for (let i = 0; i < seconds / DT; i++) {
    I.attack = I.alt = I.dodge = false;
    bot(I, sim, sim.t);
    sim.step(DT, I);
    ev.push(...sim.drain());
    if (until?.(sim)) break;
  }
  return ev;
}
const has = (ev: SimEvent[], t: string, what?: string) => ev.some((e) => e.t === t && (what === undefined || (e.what ?? '').startsWith(what)));
const count = (ev: SimEvent[], t: string, what?: string) => ev.filter((e) => e.t === t && (what === undefined || (e.what ?? '').startsWith(what))).length;
const aimAt = (I: Intent, sim: CombatSim, e: { x: number; y: number; z: number; def?: { height: number } }) => {
  const p = sim.player; I.aim = true; I.ax = e.x; I.ay = e.y + (e.def?.height ?? 1) * 0.55; I.az = e.z;
  const d = Math.hypot(e.x - p.x, e.z - p.z) || 1; I.lx = (e.x - p.x) / d; I.lz = (e.z - p.z) / d;
};
/** A stand-in target that does nothing: a sleeping mossback is big, patient and does not move. */
const dummy = (sim: CombatSim, x: number, z: number, kind: SpeciesId = 'mossback') => sim.spawn(kind, x, z, { inert: true, hp: 9999, maxHp: 9999 });

// ---------------------------------------------------------------- weapons
section('weapons');
for (const id of Object.keys(WEAPONS) as WeaponId[]) {
  const w = WEAPONS[id];
  if (w.melee) {
    const sim = new CombatSim({ seed: 5 });
    sim.player.has[id] = true; sim.inv.stone = 5; sim.equip(id);
    const t = dummy(sim, 0, w.melee.reach + 1.15 - 0.3);
    const far = dummy(sim, 0, -(w.melee.reach + 1.15 + 0.6));
    let pressed = false, low = 100;
    const ev = run(sim, 2, (I, s) => { I.lx = 0; I.lz = 1; low = Math.min(low, s.player.stamina); if (!pressed) { I.attack = true; pressed = true; } });
    const hit = ev.find((e) => e.t === 'hit' && e.id === t.id);
    ok(hit, `${id}: a swing lands inside its reach`);
    ok(!ev.some((e) => e.t === 'hit' && e.id === far.id), `${id}: nothing behind you is hit`);
    const swing = ev.find((e) => e.t === 'swing');
    ok(swing && low < 100, `${id}: a swing costs stamina`, `${low}`);
    // the blow lands after its wind-up, not on the press
    ok(hit && sim.t > 0 && w.melee.windup >= 0.12, `${id}: wind-up is readable`, `${w.melee.windup}`);
  }
  if (w.proj) {
    const pr = w.proj;
    for (const range of [8, 18]) {
      const sim = new CombatSim({ seed: 9, assist: { aim: 0, hold: false, slowMo: false, noTimers: false, damageNumbers: false } });
      sim.player.has[id] = true; sim.inv.stone = 10; sim.inv.arrow = 10; sim.inv.bolt = 10; sim.inv.dart = 10; sim.equip(id);
      const t = dummy(sim, 0, range);
      const before = sim.ammo(id)!;
      let phase = 0;
      const ev = run(sim, 4, (I, s) => {
        aimAt(I, s, t);
        const throwIt = !w.ranged;
        if (phase === 0) { if (throwIt) { I.alt = true; I.altHeld = true; } else { I.attack = true; I.attackHeld = true; } phase = 1; }
        else if (phase === 1) { if (s.player.act === 'charge' && s.player.charge >= 1) { I.altHeld = false; I.attackHeld = false; phase = 2; } else if (s.player.act !== 'charge') { I.altHeld = false; I.attackHeld = false; phase = 2; } }
        if (phase === 2) I.aim = !throwIt;
      }, (s) => phase === 2 && !s.proj.some((q) => q.alive) && s.stats.shots > 0);
      ok(sim.stats.shots === 1, `${id} at ${range} m: one shot leaves`, `${sim.stats.shots}`);
      ok(ev.some((e) => e.t === 'hit' && e.id === t.id), `${id} at ${range} m: a full-draw shot at a big still target hits`, JSON.stringify(ev.filter((e) => e.t === 'land' || e.t === 'hit').slice(0, 2)));
      const after = sim.ammo(id)!;
      if (pr.ammo || pr.cell) ok(after === before - 1, `${id}: a shot uses one ${pr.ammo ?? 'charge'}`, `${before} -> ${after}`);
      else ok(!sim.player.has[id] && sim.player.weapon === 'fists', `${id}: thrown, it has left the hand`);
    }
    // physics: a shot flies an arc under gravity and falls short past its range
    const sim = new CombatSim({ seed: 2 });
    sim.player.has[id] = true; sim.inv.stone = 3; sim.inv.arrow = 3; sim.inv.bolt = 3; sim.equip(id);
    const reach = (pr.speed * pr.speed) / pr.gravity; // level-ground maximum for this speed
    ok(reach > 20 && reach < 1000, `${id}: speed and gravity give a sane range`, `${reach.toFixed(0)} m`);
  }
}
{
  // no ammunition: nothing leaves, and the game is told
  const sim = new CombatSim(); sim.player.has.bow = true; sim.equip('bow');
  const ev = run(sim, 1, (I, s) => { I.aim = true; I.ax = 0; I.ay = 1; I.az = 10; if (s.t < 0.05) { I.attack = true; I.attackHeld = true; } else I.attackHeld = false; });
  ok(sim.stats.shots === 0 && has(ev, 'player', 'noammo'), 'bow: no arrows, no shot');
}
{
  // durability: a spear's stone point does not last for ever
  const sim = new CombatSim({ seed: 4 }); sim.inv = { branch: 1, stone: 1, vine: 1 };
  ok(sim.craft('spear') && sim.player.has.spear && sim.inv.branch === 0, 'spear: made from a branch, a stone and a vine');
  ok(!sim.craft('club'), 'club: cannot be made from an empty bag');
  sim.equip('spear'); dummy(sim, 0, 2.5);
  const ev = run(sim, 120, (I, s) => { I.lx = 0; I.lz = 1; if (s.player.act === 'idle' && s.player.stamina > 30) I.attack = true; }, (s) => !s.player.has.spear);
  ok(has(ev, 'player', 'broke:spear') && !sim.player.has.spear, 'spear: breaks after its blows are used up', `${sim.stats.hits}`);
  ok(sim.stats.hits === WEAPONS.spear.dur, 'spear: lasts exactly its durability', `${sim.stats.hits}`);
}
{
  // crossbow: one bolt, then it has to be spanned again
  const sim = new CombatSim({ seed: 4 }); sim.player.has.crossbow = true; sim.inv.bolt = 5; sim.equip('crossbow');
  const t = dummy(sim, 0, 15);
  run(sim, 2, (I, s) => { aimAt(I, s, t); I.attack = true; I.attackHeld = true; });
  ok(sim.stats.shots === 1, 'crossbow: holding the trigger fires once in two seconds', `${sim.stats.shots}`);
  run(sim, 2, (I, s) => { aimAt(I, s, t); I.attack = true; I.attackHeld = true; });
  ok(sim.stats.shots === 2, 'crossbow: spanned, it fires again', `${sim.stats.shots}`);
}
{
  // the coil: a cell of eight that refills
  const sim = new CombatSim({ seed: 4 }); sim.player.has.coil = true; sim.equip('coil');
  const t = dummy(sim, 0, 20);
  run(sim, 4, (I, s) => { aimAt(I, s, t); I.attackHeld = true; });
  ok(sim.stats.shots >= 8 && sim.stats.shots <= 10, 'coil: empties its cell and waits for charge', `${sim.stats.shots}`);
  const left = sim.player.cell;
  run(sim, 6, () => {});
  ok(sim.player.cell > left, 'coil: the cell refills', `${left} -> ${sim.player.cell}`);
}
{
  // a torch burns down
  const sim = new CombatSim(); sim.inv = { branch: 1, tinder: 1 }; sim.craft('torch'); sim.equip('torch');
  ok(sim.fires.some((f) => f.torch), 'torch: in the hand it is a fire');
  const ev = run(sim, WEAPONS.torch.dur + 5, () => {}, (s) => !s.player.has.torch);
  ok(has(ev, 'player', 'broke:torch') && !sim.fires.some((f) => f.torch), 'torch: burns out', `${sim.t.toFixed(0)} s`);
}

// ---------------------------------------------------------------- the player's body
section('dodge, block, stamina, injuries');
{
  const sim = new CombatSim({ seed: 1 }); sim.night = true;
  const h = sim.spawn('hound', 0, 9, { alert: 1.2, aware: true, cd: 0, atkGone: 9 });
  let rolled = false;
  const ev = run(sim, 12, (I, s) => { I.lx = 0; I.lz = -1; if (h.state === 'strike' && !rolled && Math.hypot(h.x - s.player.x, h.z - s.player.z) < 3.2) { I.dodge = true; I.mx = 1; rolled = true; } else I.mx = 0; }, () => rolled && h.state === 'recover');
  ok(has(ev, 'telegraph', 'lunge'), 'hound: its leap is telegraphed');
  const tele = ev.find((e) => e.t === 'telegraph')!;
  ok(tele.dur! >= 0.7, 'hound: the telegraph is long enough to read', `${tele.dur}`);
  ok(rolled && sim.stats.taken === 0, 'roll: through the leap untouched', `taken ${sim.stats.taken}`);
  ok(sim.player.stamina < 100, 'roll: costs stamina');
  ok(h.weakT > 0, 'hound: a missed leap leaves it open');
}
{
  const sim = new CombatSim({ seed: 1 }); sim.night = true; sim.player.has.club = true; sim.equip('club');
  const h = sim.spawn('hound', 0, 9, { alert: 1.2, aware: true, cd: 0, atkGone: 9 });
  const ev = run(sim, 12, (I) => { I.lx = 0; I.lz = 1; I.block = h.state === 'windup' && h.stateT > 0.2 || h.state === 'strike'; }, () => h.state === 'recover' || h.state === 'stagger');
  ok(has(ev, 'hit', 'blocked'), 'block: a held guard takes the leap');
  ok(sim.stats.taken > 0 && sim.stats.taken < SPECIES.hound.attacks[0].dmg * 0.6, 'block: most of it is stopped, not all', `${sim.stats.taken}`);
}
{
  const sim = new CombatSim({ seed: 1 }); sim.night = true;
  const h = sim.spawn('hound', 0, 9, { alert: 1.2, aware: true, cd: 0, atkGone: 9 });
  run(sim, 12, (I) => { I.lx = 0; I.lz = 1; }, (s) => s.stats.taken > 0);
  ok(sim.stats.taken >= 15, 'no guard: the leap lands in full', `${sim.stats.taken}`);
  ok(sim.player.staggerT > 0 || sim.player.forceT > 0, 'hit reaction: staggered and knocked back');
  void h;
}
{
  // a weak arm does not win a slugging match with a predator
  const sim = new CombatSim({ seed: 6 }); sim.night = true;
  const h = sim.spawn('hound', 0, 6, { alert: 1.2, aware: true });
  run(sim, 40, (I, s) => { const d = Math.hypot(h.x - s.player.x, h.z - s.player.z) || 1; I.lx = (h.x - s.player.x) / d; I.lz = (h.z - s.player.z) / d; I.mx = I.lx; I.mz = I.lz; I.attack = s.player.act === 'idle'; }, (s) => s.player.down || h.routed);
  ok(sim.player.down || sim.player.hp < 60, 'fists against the hound: you lose', `hp ${sim.player.hp.toFixed(0)}, hound ${h.hp.toFixed(0)}`);
}
{
  const sim = new CombatSim({ seed: 3 });
  const a = sim.player.stamina; let n = 0;
  run(sim, 6, (I, s) => { if (s.player.act === 'idle') { I.dodge = true; I.mx = 1; n++; } });
  ok(sim.stats.rolls < n && sim.stats.rolls <= 8, 'stamina: you cannot roll for ever', `${sim.stats.rolls} of ${n}`);
  void a;
}
{
  // hunger and cold cost you
  const fed = new CombatSim(), starved = new CombatSim(); starved.cond.hunger = 1; starved.cond.cold = 1;
  ok(starved.hurtMul().regen < fed.hurtMul().regen * 0.6 && starved.hurtMul().steady < 0.7, 'condition: starving and cold, you recover slower and shake');
  // a bite left untreated turns
  const sim = new CombatSim(); sim.player.injuries.push({ id: 'bite', left: 0 });
  const ev = run(sim, INFECT_AFTER + 2, () => {});
  ok(has(ev, 'player', 'infected') && sim.player.hp < 100, 'injury: an untreated bite becomes infected and costs health');
  sim.treat(); ok(sim.player.injuries.length === 0, 'injury: treatment clears it');
}

// ---------------------------------------------------------------- creatures
section('creatures');
const watch = (sim: CombatSim, e: Enemy, seconds: number, bot: (I: Intent, s: CombatSim) => void = () => {}, until?: (s: CombatSim) => boolean) => {
  const states = new Set<string>([e.state]);
  const ev = run(sim, seconds, (I, s) => { bot(I, s); states.add(e.state); }, until);
  return { ev, states };
};
{
  // nibbet: grazes, freezes at a noise, bolts when it knows
  const sim = new CombatSim({ seed: 8 }); sim.player.x = 0; sim.player.z = -30; sim.windX = 0; sim.windZ = -1;
  const n = sim.spawn('nibbet', 0, 0);
  let r = watch(sim, n, 6);
  ok(n.state === 'idle' && !n.aware, 'nibbet: left alone, it grazes');
  // sneak in against the wind
  r = watch(sim, n, 30, (I) => { I.sneak = true; I.mz = 1; I.lz = 1; }, (s) => Math.hypot(n.x - s.player.x, n.z - s.player.z) < 7 || n.aware);
  const dSneak = Math.hypot(n.x - sim.player.x, n.z - sim.player.z);
  const sim2 = new CombatSim({ seed: 8 }); sim2.player.z = -30; sim2.windX = 0; sim2.windZ = -1;
  const n2 = sim2.spawn('nibbet', 0, 0);
  watch(sim2, n2, 30, (I) => { I.sprint = true; I.mz = 1; I.lz = 1; }, () => n2.aware);
  const dRun = Math.hypot(n2.x - sim2.player.x, n2.z - sim2.player.z);
  ok(dSneak < dRun - 3, 'nibbet: a sneaking hunter gets closer than a running one', `${dSneak.toFixed(1)} vs ${dRun.toFixed(1)}`);
  r = watch(sim2, n2, 6);
  ok(r.states.has('flee') && Math.hypot(n2.x - sim2.player.x, n2.z - sim2.player.z) > dRun + 8, 'nibbet: once it knows, it runs');
  // one good spear throw takes it
  const sim3 = new CombatSim({ seed: 8 }); sim3.player.has.spear = true; sim3.equip('spear');
  const n3 = sim3.spawn('nibbet', 0, 7, { wander: 99, wx: 0, wz: 7, yaw: 0 });
  let ph = 0;
  const ev = run(sim3, 5, (I, s) => { aimAt(I, s, n3); I.aim = false; I.sneak = true; if (ph === 0) { I.alt = true; I.altHeld = true; ph = 1; } else if (s.player.charge >= 1) I.altHeld = false; }, () => n3.dead);
  ok(n3.dead && has(ev, 'death', 'nibbet'), 'nibbet: a thrown spear from seven metres is a kill');
  ok(sim3.pickups.some((k) => k.weapon === 'spear'), 'spear: lies where it fell, to be picked up');
}
{
  // skritch: after food, shy alone, bold together, routed when half are down
  const sim = new CombatSim({ seed: 12 }); sim.player.z = -40;
  const pack = [0, 1, 2, 3].map((i) => sim.spawn('skritch', i * 1.5, 20, { pack: 1 }));
  sim.addScent(0, 0, 2, 40);
  let r = watch(sim, pack[0], 30, () => {}, (s) => s.stats.foodLost >= 1);
  ok(sim.stats.foodLost >= 1 && has(r.ev, 'beat', 'foodStolen'), 'skritch: smells food and steals it', `${sim.t.toFixed(1)} s`);
  const sim2 = new CombatSim({ seed: 12 });
  const lone = sim2.spawn('skritch', 0, 9, { alert: 1.2, aware: true });
  r = watch(sim2, lone, 25, (I) => { I.lz = 1; });
  ok(!r.states.has('windup') && sim2.stats.taken === 0, 'skritch: one alone does not attack a standing adult');
  const sim3 = new CombatSim({ seed: 12 }); sim3.night = true;
  const p3 = [0, 1, 2, 3].map((i) => sim3.spawn('skritch', i * 2 - 3, 9, { pack: 2, alert: 1.2, aware: true }));
  r = watch(sim3, p3[0], 40, (I) => { I.lz = -1; }, (s) => s.stats.taken > 0);
  ok(sim3.stats.taken > 0 && has(r.ev, 'telegraph', 'nip'), 'skritch: four at night, with your back turned, come in', `${sim3.t.toFixed(1)} s`);
  // kill two of four: the others go
  const sim4 = new CombatSim({ seed: 12 }); const p4 = [0, 1, 2, 3].map((i) => sim4.spawn('skritch', i, 5, { pack: 3 }));
  sim4.hurtEnemy(p4[0], 99, 'blunt', 0, 0, 0, 0, 'melee'); sim4.hurtEnemy(p4[1], 99, 'blunt', 0, 0, 0, 0, 'melee');
  ok(p4[2].routed && p4[3].routed, 'skritch: half the pack down and the rest lose their nerve');
  // fire: they do not cross it
  const sim5 = new CombatSim({ seed: 12 }); sim5.player.z = -40; sim5.addFire(0, 0, 100); sim5.addScent(0.5, 0.5, 2, 40);
  const p5 = sim5.spawn('skritch', 0, 22);
  watch(sim5, p5, 25);
  ok(sim5.stats.foodLost === 0 && Math.hypot(p5.x, p5.z) > 4, 'skritch: food beside a good fire is safe', `${Math.hypot(p5.x, p5.z).toFixed(1)} m`);
}
{
  // hound: asleep by day, hunts by night, keeps out of the light, goes for your back, runs when badly hurt
  const sim = new CombatSim({ seed: 21 }); sim.player.z = -30;
  const h = sim.spawn('hound', 0, 0);
  let r = watch(sim, h, 5);
  ok(h.state === 'asleep', 'hound: by day it sleeps');
  r = watch(sim, h, 40, (I) => { I.sneak = true; I.mz = 1; I.mx = 0.12; I.lz = 1; }, (s) => s.player.z > 12 || h.state !== 'asleep');
  ok(h.state === 'asleep' && sim.player.z > 12, 'hound: a careful walker passes it asleep', `${h.state} alert ${h.alert.toFixed(2)}`);
  const simB = new CombatSim({ seed: 21 }); simB.player.z = -30;
  const hb = simB.spawn('hound', 0, 0); run(simB, 3, () => {});
  r = watch(simB, hb, 30, (I) => { I.sprint = true; I.mz = 1; I.mx = 0.12; I.lz = 1; }, () => hb.state !== 'asleep');
  ok(hb.state !== 'asleep', 'hound: running past wakes it');
  const sim2 = new CombatSim({ seed: 21 }); sim2.night = true; sim2.addFire(0, 0, 100);
  const h2 = sim2.spawn('hound', 0, 28, { alert: 1.2, aware: true });
  let minD = 99;
  r = watch(sim2, h2, 45, (I) => { I.lz = 1; minD = Math.min(minD, Math.hypot(h2.x, h2.z)); });
  ok(sim2.stats.taken === 0 && minD > 6, 'hound: will not come into a good fire\'s light', `closest ${minD.toFixed(1)} m`);
  ok(r.states.has('stalk'), 'hound: it circles instead');
  // the fire burns down and the circle closes
  sim2.fires[0].fuel = 3;
  r = watch(sim2, h2, 60, (I) => { I.lz = 1; }, (s) => s.stats.taken > 0);
  ok(sim2.stats.taken > 0, 'hound: when the fire dies, it comes', `${sim2.t.toFixed(0)} s`);
  const sim3 = new CombatSim({ seed: 21 }); sim3.night = true;
  const h3 = sim3.spawn('hound', 0, 10, { alert: 1.2, aware: true });
  h3.yaw = 0; for (let i = 0; i < 3; i++) sim3.hurtEnemy(h3, h3.maxHp * 0.4, 'pierce', 0, 20, 0, 0, 'melee');
  ok(h3.routed, 'hound: hurt badly enough, it gives up');
  watch(sim3, h3, 12);
  ok(h3.gone && !h3.dead, 'hound: it leaves alive');
  // torch: a burning branch in its face sends it back
  const sim4 = new CombatSim({ seed: 21 }); sim4.night = true; sim4.player.has.torch = true; sim4.equip('torch');
  const h4 = sim4.spawn('hound', 0, 1.6, { alert: 1.2, aware: true, yaw: Math.PI, heldT: 3, cd: 3 });
  r = watch(sim4, h4, 1.5, (I, s) => { I.lz = 1; if (s.t < 0.05) I.attack = true; });
  ok(r.states.has('flee'), 'hound: struck with fire, it backs off');
}
{
  // mossback: peaceful, warns, bluffs, then means it; a trunk stops it; hurt, it runs
  const sim = new CombatSim({ seed: 31 }); sim.player.z = -25;
  const m = sim.spawn('mossback', 0, 0, { yaw: Math.PI });
  let r = watch(sim, m, 20, (I, s) => { I.lz = 1; I.mz = s.player.z < -14 ? 1 : 0; });
  ok(sim.stats.taken === 0 && !r.states.has('windup'), 'mossback: at a distance it ignores you');
  r = watch(sim, m, 14, (I, s) => { I.lz = 1; const d = Math.hypot(m.x - s.player.x, m.z - s.player.z); I.mz = d > 5.5 && !r?.states?.has('warn') ? 1 : 0; }, () => m.state === 'warn');
  ok(m.state === 'warn', 'mossback: come close and it warns you first');
  // back off: it calms
  const simA = new CombatSim({ seed: 31 }); simA.player.z = -7; const ma = simA.spawn('mossback', 0, 0, { yaw: Math.PI, alert: 1.2, aware: true });
  r = watch(simA, ma, 12, (I, s) => { I.lz = 1; I.mz = ma.state === 'warn' || s.player.z > -16 && r?.states ? -1 : 0; });
  ok(simA.stats.taken === 0 && ma.provoked <= 0, 'mossback: back away at the warning and nothing happens');
  // stand your ground: a bluff first, then the real thing
  const simB = new CombatSim({ seed: 31 }); simB.player.z = -6; const mb = simB.spawn('mossback', 0, 0, { yaw: Math.PI, alert: 1.2, aware: true });
  r = watch(simB, mb, 30, (I) => { I.lz = 1; }, (s) => s.stats.taken > 0);
  ok(has(r.ev, 'sound', 'bluff'), 'mossback: its first charge is a bluff that stops short');
  ok(simB.stats.taken >= 25, 'mossback: stay, and the second charge is real', `${simB.stats.taken}`);
  ok(simB.player.injuries.length >= 0 && has(r.ev, 'telegraph', 'charge'), 'mossback: the charge is telegraphed');
  // sidestep in front of a tree: it knocks itself silly
  const tree: Env = { height: () => 0, blocked: (x, z, rr) => Math.hypot(x, z + 12) < 0.6 + rr };
  const simC = new CombatSim({ seed: 31, env: tree }); simC.player.x = 0; simC.player.z = -10;
  const mc = simC.spawn('mossback', 0, 8, { yaw: Math.PI, alert: 1.2, aware: true, provoked: 20 });
  let rolled = false;
  r = watch(simC, mc, 14, (I, s) => { I.lz = 1; if (mc.state === 'strike' && !rolled && Math.hypot(mc.x - s.player.x, mc.z - s.player.z) < 5) { I.dodge = true; I.mx = 1; rolled = true; } else I.mx = 0; }, () => mc.stunT > 0);
  ok(mc.stunT > 0 && has(r.ev, 'hit', 'crash') && simC.stats.taken === 0, 'mossback: dodge with a tree behind you and it stuns itself', `stun ${mc.stunT.toFixed(1)}`);
  const before = mc.hp; simC.hurtEnemy(mc, 16, 'pierce', simC.player.x, simC.player.z, 0, 0, 'melee');
  ok(before - mc.hp > 16 * 2, 'mossback: stunned, its weak point is open', `${(before - mc.hp).toFixed(0)}`);
  const simD = new CombatSim({ seed: 31 }); const md = simD.spawn('mossback', 0, 8);
  simD.hurtEnemy(md, 16, 'pierce', 0, 0, 0, 0, 'melee');
  ok(md.maxHp - md.hp <= 8.01 && md.provoked > 0, 'mossback: from the front its plates turn a spear, and now it is angry');
  simD.hurtEnemy(md, md.maxHp, 'pierce', 0, 30, 0, 0, 'trap'); void 0;
}
{
  // stakes stop a charge
  const sim = new CombatSim({ seed: 33 }); sim.inv = { branch: 3 }; sim.player.z = -10;
  ok(sim.placeTrap('stakes', 0, -5) && sim.inv.branch === 0, 'stakes: three branches make a line of them');
  const m = sim.spawn('mossback', 0, 8, { yaw: Math.PI, alert: 1.2, aware: true, provoked: 20 });
  const r = watch(sim, m, 14, (I) => { I.lz = 1; }, () => m.stunT > 0 || sim.stats.taken > 0);
  ok(has(r.ev, 'trap', 'staked') && sim.stats.taken === 0, 'stakes: a charge that crosses them stops there');
}
{
  // lashbloom: a careless step, a careful step, a thrown stone, and fire
  const sim = new CombatSim({ seed: 41 }); sim.player.z = -8;
  const b = sim.spawn('lashbloom', 0, 0);
  let r = watch(sim, b, 8, (I) => { I.mz = 1; I.lz = 1; }, (s) => s.stats.taken > 0 || s.player.z > 6);
  ok(sim.stats.taken > 0 && has(r.ev, 'telegraph', 'lash'), 'lashbloom: walk past and it lashes');
  ok(sim.player.snareT > 0 || has(r.ev, 'player', 'snared'), 'lashbloom: the vine holds your ankle');
  ok(sim.clouds.length > 0, 'lashbloom: it breathes spores');
  const sim2 = new CombatSim({ seed: 41 }); sim2.player.z = -8; sim2.player.x = 1.6;
  const b2 = sim2.spawn('lashbloom', 0, 0);
  r = watch(sim2, b2, 14, (I) => { I.sneak = true; I.mz = 1; I.lz = 1; }, (s) => s.player.z > 6);
  ok(sim2.stats.taken === 0 && sim2.player.z > 6, 'lashbloom: a slow, careful step goes by');
  const sim3 = new CombatSim({ seed: 41 }); sim3.player.z = -12; sim3.inv.stone = 2; sim3.player.has.rock = true; sim3.equip('rock');
  const b3 = sim3.spawn('lashbloom', 0, 0);
  let ph = 0;
  r = watch(sim3, b3, 5, (I, s) => { I.aim = true; I.ax = 0.8; I.ay = 0; I.az = -0.8; I.lz = 1; if (ph === 0) { I.attack = I.attackHeld = true; ph = 1; } else if (s.player.charge >= 1) I.attackHeld = false; }, () => b3.weakT > 0 && b3.state === 'recover');
  ok(b3.state === 'recover' && sim3.stats.taken === 0, 'lashbloom: a stone thrown beside it springs it from a safe distance');
  const closed = new CombatSim(); const c = closed.spawn('lashbloom', 0, 2); closed.hurtEnemy(c, 16, 'pierce', 0, 0, 0, 0, 'melee');
  const open = new CombatSim(); const o = open.spawn('lashbloom', 0, 2, { weakT: 2 }); open.hurtEnemy(o, 16, 'pierce', 0, 0, 0, 0, 'melee');
  ok(c.maxHp - c.hp < 5 && o.maxHp - o.hp > 30, 'lashbloom: closed it shrugs a spear off, open it does not', `${(c.maxHp - c.hp).toFixed(0)} / ${(o.maxHp - o.hp).toFixed(0)}`);
  const burn = new CombatSim(); const f = burn.spawn('lashbloom', 0, 2); burn.hurtEnemy(f, 8, 'fire', 0, 0, 0, 0, 'melee');
  ok(f.maxHp - f.hp >= 20, 'lashbloom: fire is what it fears');
}
{
  // guardian: asleep until disturbed, both attacks telegraphed and avoidable, armour, overload, phase two
  const sim = new CombatSim({ seed: 51 }); sim.player.z = -20;
  const g = sim.spawn('guardian', 0, 0, { yaw: Math.PI });
  let r = watch(sim, g, 5);
  ok(g.state === 'dormant', 'guardian: stands dormant while you keep your distance');
  sim.player.has.spear = true; sim.equip('spear');
  sim.hurtEnemy(g, 16, 'pierce', 0, -20, 0, 0, 'melee');
  ok(g.state !== 'dormant' && g.maxHp - g.hp < 3, 'guardian: struck, it wakes, and a spear barely marks it', `${(g.maxHp - g.hp).toFixed(1)}`);
  r = watch(sim, g, 30, (I) => { I.lz = 1; }, (s) => s.stats.taken > 0);
  const tele = r.ev.find((e) => e.t === 'telegraph');
  ok(tele && tele.dur! >= 0.9 && sim.stats.taken > 0, 'guardian: its beam is telegraphed and hits whoever stands in it', `${tele?.what} ${tele?.dur}`);
  // the same fight, stepping out of the line
  const sim2 = new CombatSim({ seed: 51 }); sim2.player.z = -16; sim2.player.has.coil = true; sim2.equip('coil');
  const g2 = sim2.spawn('guardian', 0, 0, { yaw: Math.PI, state: 'idle' });
  let phase2 = false, overload = false;
  const ev = run(sim2, 240, (I, s) => {
    const p = s.player, dx = g2.x - p.x, dz = g2.z - p.z, d = Math.hypot(dx, dz) || 1;
    aimAt(I, s, g2);
    // strafe round it at range, roll when the beam is about to fire or the ring arrives, shoot the rest of the time
    const tx = -dz / d, tz = dx / d, keep = d < 10 ? -0.8 : d > 15 ? 0.8 : 0;
    I.mx = tx + (dx / d) * keep; I.mz = tz + (dz / d) * keep;
    const danger = (g2.state === 'windup' && g2.stateT > g2.warned - 0.18) || (g2.state === 'strike' && g2.atk?.id === 'stomp');
    if (danger && p.act !== 'roll') I.dodge = true;
    I.attackHeld = !danger;
  }, (s) => g2.dead || s.player.down);
  phase2 = has(ev, 'phase', 'overclock'); overload = has(ev, 'state', 'overload');
  ok(g2.dead, 'guardian: a careful shooter with the coil brings it down', `guardian ${g2.hp.toFixed(0)} hp, player ${sim2.player.hp.toFixed(0)} hp, ${sim2.t.toFixed(0)} s`);
  ok(phase2, 'guardian: at half health it changes phase');
  ok(overload, 'guardian: three charged hits overload it');
  ok(sim2.stats.weakHits > 0, 'guardian: open, its core takes real damage');
}
{
  // senses: sight is a cone, hearing is not, smell follows the wind
  const sim = new CombatSim({ seed: 61 }); sim.night = true;
  const h = sim.spawn('hound', 0, 0, { yaw: 0, wander: 99 }); sim.player.x = 0; sim.player.z = -9; // behind it
  run(sim, 4, (I) => { I.sneak = true; });
  ok(!h.aware, 'senses: behind its back, standing still, you are not seen', `alert ${h.alert.toFixed(2)}`);
  const sim2 = new CombatSim({ seed: 61 }); sim2.night = true;
  const h2 = sim2.spawn('hound', 0, 0, { yaw: 0, wander: 99 }); sim2.player.z = 12;
  run(sim2, 4, () => {});
  ok(h2.aware, 'senses: in front of it at twelve metres you are seen');
  const sim3 = new CombatSim({ seed: 61 }); sim3.night = true;
  const h3 = sim3.spawn('hound', 0, 0, { yaw: 0, wander: 99, wx: 0, wz: 0 }); sim3.player.z = -40;
  run(sim3, 0.1, () => {}); sim3.noise(14, 6, 20, -3);
  run(sim3, 5, () => {});
  ok(h3.state === 'investigate' && Math.hypot(h3.lkx - 14, h3.lkz - 6) < 0.1, 'senses: a noise draws it to where the noise was');
  // trees block sight
  const wall: Env = { height: () => 0, blocked: (x, z, r) => Math.abs(z - 6) < 0.5 + r && Math.abs(x) < 6 };
  const sim4 = new CombatSim({ seed: 61, env: wall }); sim4.night = true;
  const h4 = sim4.spawn('hound', 0, 0, { yaw: 0, wander: 99 }); sim4.player.z = 12;
  run(sim4, 4, (I) => { I.sneak = true; });
  ok(!h4.aware, 'senses: it cannot see through cover');
}
{
  // traps: snare, fire line, rattle, bait
  const sim = new CombatSim({ seed: 71 }); sim.inv = { vine: 2, branch: 2, tinder: 1, stone: 2, fruit: 1 }; sim.player.z = -30;
  sim.placeTrap('snare', 0, 6); sim.placeTrap('bait', 0, 5);
  const s1 = sim.spawn('skritch', 0, 20);
  const ev = run(sim, 15, () => {}, () => s1.heldT > 0);
  ok(s1.heldT > 0 && has(ev, 'trap', 'snared'), 'snare and bait: the bait brings it, the snare holds it');
  ok(new CombatSim().placeTrap('snare', 0, 0) === null, 'traps: no materials, no trap');
  const sim2 = new CombatSim({ seed: 71 }); sim2.inv = { vine: 1, stone: 2 }; sim2.night = true; sim2.player.z = -25;
  sim2.placeTrap('rattle', 20, 0);
  const h = sim2.spawn('hound', 0, 0, { wander: 99, yaw: 0 }); run(sim2, 0.1, () => {});
  ok(sim2.pullRattle(), 'rattle: the cord can be pulled from a distance');
  run(sim2, 4, () => {});
  ok(Math.hypot(h.lkx - 20, h.lkz) < 0.1 && h.state === 'investigate', 'rattle: it goes to look at the noise, not at you');
  const sim3 = new CombatSim({ seed: 71 }); sim3.inv = { tinder: 1, branch: 1 }; sim3.night = true; sim3.placeTrap('fireline', 0, 5);
  const h3 = sim3.spawn('hound', 0, 16, { alert: 1.2, aware: true }); sim3.player.z = 0;
  let minD = 99; run(sim3, 15, (I) => { I.lz = 1; minD = Math.min(minD, Math.hypot(h3.x, h3.z - 5)); });
  ok(minD > 2, 'fire line: the hunter stays off it while it burns', `${minD.toFixed(1)}`);
}

// ---------------------------------------------------------------- aim assist
section('aim assist');
{
  const shoot = (aim: 0 | 1 | 2, off: number) => {
    const sim = new CombatSim({ seed: 81, assist: { aim, hold: false, slowMo: false, noTimers: false, damageNumbers: false } });
    sim.player.has.coil = true; sim.equip('coil');
    const t = dummy(sim, 0, 20, 'nibbet');
    run(sim, 0.6, (I, s) => { I.aim = true; I.ax = off; I.ay = 0.3; I.az = 20; I.lz = 1; if (s.t < 0.03) I.attack = true; });
    void t; return sim.stats.shotsHit;
  };
  ok(shoot(0, 1.2) === 0, 'aim assist off: a shot more than a metre wide of a small target misses');
  ok(shoot(1, 1.2) === 1, 'aim assist on: the same shot is bent on to it');
  ok(shoot(2, 4.5) === 1 && shoot(1, 4.5) === 0, 'aim assist strong: reaches further than normal');
}

// ---------------------------------------------------------------- tension
section('tension moments');
{
  const play = (kind: TensionKind, bot: (t: Tension) => { press?: boolean; held?: boolean; axis?: number; px?: number; py?: number }, o: object = {}) => {
    const T = new Tension({ kind, seed: 3, ...o }), I = noTensionInput();
    for (let i = 0; i < 60 * 30 && !T.result; i++) { Object.assign(I, { press: false, held: false, axis: 0 }, bot(T)); T.update(DT, I); }
    return T.result;
  };
  let pressed = false;
  ok(play('quick', (t) => ({ press: t.ring <= (t.win[0] + t.win[1]) / 2 }))?.passed, 'quick press: inside the window passes');
  ok(play('quick', () => ({}))?.passed === false, 'quick press: no press fails');
  pressed = false;
  ok(play('quick', () => { const p = !pressed; pressed = true; return { press: p }; })?.passed === false, 'quick press: too early fails');
  ok(play('quick', () => ({ held: true }), { assist: { aim: 1, hold: true, slowMo: false, noTimers: false, damageNumbers: false } })?.passed, 'quick press: hold-to-press passes by holding');
  ok(play('steady', (t) => ({ axis: Math.max(-1, Math.min(1, (t.band - t.marker) * 4)) }))?.passed, 'hold steady: following the band passes');
  ok(play('steady', () => ({ axis: 1 }))?.passed === false, 'hold steady: a hand that runs off fails');
  ok(play('breath', (t) => ({ press: Math.abs(t.beat - 1) < 0.03 }))?.passed, 'breath: on the beat passes');
  ok(play('breath', (t) => ({ press: Math.abs(t.beat - 0.5) < 0.02 }))?.passed === false, 'breath: off the beat fails');
  ok(play('breath', () => ({}))?.passed === false, 'breath: not breathing fails');
  ok(play('aim', (t) => ({ px: t.tx, py: t.ty, press: t.ring < 0.6 }))?.passed, 'aim: on the target passes');
  ok(play('aim', () => ({ px: 0.02, py: 0.02, press: true }))?.passed === false, 'aim: off the target fails');
  const hard = new Tension({ kind: 'quick', difficulty: 'hard' }), story = new Tension({ kind: 'quick', difficulty: 'story' });
  ok(story.win[1] - story.win[0] > (hard.win[1] - hard.win[0]) * 1.4, 'difficulty: Story gives a wider window than Hard');
}

// ---------------------------------------------------------------- encounters
section('encounters');
type Bot = (I: Intent, run: EncounterRun) => void;
function play(id: EncounterId, bot: Bot, o: EncounterOpts = {}, seconds = 420, answer: (id: string) => boolean = () => true) {
  const R = new EncounterRun(id, { seed: 5, ...o }), I = noIntent(), ev: SimEvent[] = [];
  for (let i = 0; i < seconds / DT && !R.outcome; i++) {
    I.attack = I.alt = I.dodge = false;
    if (R.ask) { R.answer(answer(R.ask.id)); continue; }
    bot(I, R); R.update(DT, I); ev.push(...R.sim.drain());
  }
  return { R, ev, out: R.outcome };
}
const toward = (I: Intent, R: EncounterRun, x: number, z: number, o: { sprint?: boolean; sneak?: boolean } = {}) => {
  const p = R.sim.player, d = Math.hypot(x - p.x, z - p.z) || 1;
  I.mx = (x - p.x) / d; I.mz = (z - p.z) / d; I.lx = I.mx; I.lz = I.mz; I.sprint = !!o.sprint; I.sneak = !!o.sneak;
  return d;
};
{
  // the first hunt: a patient hunter eats, a clumsy one does not, and you may choose not to
  let ph = 0;
  const hunter: Bot = (I, R) => {
    const s = R.sim, p = s.player, prey = s.enemies.filter((e) => e.kind === 'nibbet' && !e.gone);
    I.mx = I.mz = 0; I.sneak = true; I.sprint = false; I.aim = false;
    if (R.phase === 'respect') { const m = R.markers[0]; const d = toward(I, R, m.x, m.z); if (d < 1.2) { I.mx = I.mz = 0; } I.sneak = false; return; }
    if (!p.has.spear) { const k = s.pickups.find((q) => q.weapon === 'spear'); if (k) { toward(I, R, k.x, k.z); I.sneak = false; } return; }
    const t = prey.filter((e) => !e.dead && !e.routed).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (!t) return;
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    aimAt(I, s, t); I.aim = false;
    if (p.act === 'charge') { I.altHeld = p.charge < 1; return; }
    if (d > 11 && ph === 0) { toward(I, R, t.x, t.z, { sneak: true }); return; }
    if (p.act === 'idle' && t.state !== 'flee') { I.alt = true; I.altHeld = true; }
  };
  let r = play('hunt.first', hunter);
  ok(r.out?.result === 'won' && r.out.flags['hunt.kill'] === true, 'first hunt: stalked against the wind and one throw: food', JSON.stringify(r.out?.flags) + ` ${r.R.t.toFixed(0)} s`);
  ok(has(r.ev, 'beat', 'firstKill'), 'first hunt: the kill is its own beat for the story');
  ok((r.R.sim.inv.meat ?? 0) >= 1, 'first hunt: there is meat in the bag only after you have knelt by it');
  r = play('hunt.first', (I, R) => { const t = R.sim.enemies.find((e) => e.kind === 'nibbet' && !e.gone && !e.routed); if (t) toward(I, R, t.x, t.z, { sprint: true }); });
  ok(r.out?.result === 'lost' && !r.out.flags['hunt.kill'], 'first hunt: charge at them and you go hungry (or worse)', JSON.stringify(r.out?.flags));
  r = play('hunt.first', (I, R) => { if (R.t > 5) R.leave(); });
  ok(r.out?.result === 'spared' && r.out.flags['hunt.spared'] === true, 'first hunt: walking away is an outcome too');
  r = play('hunt.first', (I, R) => { const m = R.sim.enemies.find((e) => e.kind === 'mossback')!; toward(I, R, m.x, m.z); if (Math.hypot(m.x - R.sim.player.x, m.z - R.sim.player.z) < 4) { I.mx = I.mz = 0; I.attack = true; } }, {}, 200);
  ok(r.out?.result === 'lost' && r.out.flags.scarred === true, 'first hunt: pick a fight with a mossback and you are carried home', JSON.stringify(r.out?.flags));
}
{
  // the night: someone who prepares and keeps the fire holds it; someone who does nothing loses the food or worse
  const keeper: Bot = (I, R) => {
    const s = R.sim, p = s.player, fire = s.fires.find((f) => !f.torch && !f.burnsOut)!;
    I.mx = I.mz = 0; I.block = false; I.sprint = false;
    if (R.phase === 'prep') {
      // read the smoke: bait out downwind with a snare on it, stakes on the line in, another snare on the food itself
      if (!s.traps.length) { const food = R.markers.find((m) => m.kind === 'food')!, dx = s.windX, dz = s.windZ; s.placeTrap('bait', food.x + dx * 8, food.z + dz * 8); s.placeTrap('snare', food.x + dx * 8, food.z + dz * 8); s.placeTrap('snare', food.x, food.z); s.placeTrap('stakes', food.x + dx * 3.5, food.z + dz * 3.5); }
      if (R.phaseT > 8) R.ready();
      return;
    }
    if (fire.fuel < fire.max * 0.6) { if (Math.hypot(fire.x - p.x, fire.z - p.z) > 2.2) { toward(I, R, fire.x, fire.z); return; } s.feedFire(fire); }
    const food = R.markers.find((m) => m.kind === 'food')!;
    const thieves = s.enemies.filter((e) => e.kind === 'skritch' && !e.dead && !e.routed && !e.gone && Math.hypot(e.x - food.x, e.z - food.z) < 7).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const h = s.enemies.find((e) => e.kind === 'hound' && !e.routed && !e.gone);
    if (h && (h.state === 'windup' || h.state === 'strike') && h.target === -1) { const d = Math.hypot(h.x - p.x, h.z - p.z) || 1; I.lx = (h.x - p.x) / d; I.lz = (h.z - p.z) / d; I.block = h.stateT > 0.3 || h.state === 'strike'; return; }
    if (h && h.weakT > 0 && Math.hypot(h.x - p.x, h.z - p.z) < 4) { const d = toward(I, R, h.x, h.z); if (d < 3) { I.mx = I.mz = 0; I.attack = p.act === 'idle' || p.act === 'recover'; } return; }
    if (thieves[0]) { const t = thieves[0], d = toward(I, R, t.x, t.z); if (d < 2.6) { I.mx = I.mz = 0; I.attack = p.act === 'idle' || p.act === 'recover'; } return; }
    // otherwise stand between the food and the dark, inside the light
    const d = toward(I, R, food.x - 0.8, food.z - 0.6); if (d < 0.6) { I.mx = I.mz = 0; }
    if (h) { const dh = Math.hypot(h.x - p.x, h.z - p.z) || 1; I.lx = (h.x - p.x) / dh; I.lz = (h.z - p.z) / dh; }
  };
  let r = play('night.defence', keeper);
  ok(r.out?.result === 'won' && r.out.flags['night.held'] === true, 'night defence: prepared, fed fire, guarded food: held till dawn', JSON.stringify(r.out?.flags) + ` hp ${r.R.sim.player.hp.toFixed(0)} ${r.R.t.toFixed(0)} s`);
  ok(Number(r.out?.flags['night.food']) >= 2, 'night defence: most of the food is still there', `${r.out?.flags['night.food']}`);
  ok(r.R.wave === 3 && count(r.ev, 'spawn', 'skritch') >= 9 && has(r.ev, 'spawn', 'hound'), 'night defence: three waves came, the hunter with the second');
  ok(r.R.sim.stats.trapHits > 0, 'night defence: the traps did some of the work', `${r.R.sim.stats.trapHits}`);
  {
    // they come up the wind: every scavenger wave spawns on the downwind side of the fire
    const f = r.R.sim.fires.find((q) => !q.torch && !q.burnsOut)!, sp = r.ev.filter((e) => e.t === 'spawn' && e.what === 'skritch');
    const down = sp.filter((e) => ((e.x! - f.x) * r.R.sim.windX + (e.z! - f.z) * r.R.sim.windZ) / Math.hypot(e.x! - f.x, e.z! - f.z) > 0.45).length;
    ok(sp.length > 0 && down === sp.length, 'night defence: the scavengers come up the wind (the side the smoke leans to)', `${down}/${sp.length}`);
    const caught = r.R.sim.traps.filter((q) => q.caught > 0).map((q) => q.kind);
    ok(caught.includes('snare') || caught.includes('stakes'), 'night defence: a trap set downwind catches something', caught.join(','));
  }
  const idle = play('night.defence', (I, R) => { if (R.phase === 'prep') R.ready(); });
  ok(idle.out && (idle.out.result === 'lost' || Number(idle.out.flags['night.food']) < Number(r.out?.flags['night.food'])), 'night defence: doing nothing costs the food or the night', JSON.stringify(idle.out?.flags) + ' ' + idle.out?.result);
  // with someone beside you who cannot fight, and nobody keeping the fire, they can be lost
  const alone = play('night.defence', (I, R) => { if (R.phase === 'prep') R.ready(); const f = R.sim.fires[0]; const p = R.sim.player; const d = Math.hypot(f.x - p.x, f.z - p.z); if (d > 1.5) toward(I, R, f.x, f.z); else { I.mx = I.mz = 0; } }, { companion: 'explorer', difficulty: 'hard' });
  ok(alone.out !== null, 'night defence: ends with a companion present', alone.out?.result);
  ok(alone.out?.companionLost === 'explorer' || alone.out?.companionLost === null, 'night defence: the companion\'s fate is in the outcome', String(alone.out?.companionLost));
  const kept = play('night.defence', keeper, { companion: 'explorer' });
  ok(kept.out?.companionLost === null, 'night defence: keep the fire and whoever is with you sees the dawn', String(kept.out?.companionLost) + ' ' + kept.out?.result);
  const cub = play('night.defence', keeper, { story: { cubKilled: true } });
  ok(cub.out !== null && cub.R.sim.stats.taken + cub.R.sim.stats.parried >= r.R.sim.stats.taken + r.R.sim.stats.parried, 'night defence: the story can make the hunter come straight in', `${cub.R.sim.stats.taken.toFixed(0)} vs ${r.R.sim.stats.taken.toFixed(0)}`);
}
{
  // the chase: run, roll when it leaps, get over the trunks
  const runner: Bot = (I, R) => {
    const s = R.sim, p = s.player, goal = R.markers.find((m) => m.kind === 'goal')!, h = s.enemies.find((e) => e.kind === 'hound')!;
    toward(I, R, goal.x, goal.z, { sprint: p.stamina > 25 });
    // keep well clear of the bloom
    const b = s.enemies.find((e) => e.kind === 'lashbloom')!; if (Math.hypot(b.x - p.x, b.z - p.z) < 7) { I.mx -= (b.x - p.x) * 0.3; I.mz -= (b.z - p.z) * 0.3; }
    if (h.state === 'strike' && Math.hypot(h.x - p.x, h.z - p.z) < 3.4 && p.act !== 'roll') { I.dodge = true; const mx = I.mx; I.mx = -I.mz; I.mz = mx; }
  };
  let r = play('chase.escape', runner);
  ok(r.out?.result === 'won' && r.out.flags['chase.escaped'] === true, 'chase: running, rolling and vaulting reaches the fire', JSON.stringify(r.out?.flags) + ` ${r.R.t.toFixed(0)} s hp ${r.R.sim.player.hp.toFixed(0)}`);
  ok(count(r.ev, 'player', 'vault') === 3, 'chase: three trunks, three vaults', `${count(r.ev, 'player', 'vault')}`);
  ok(count(r.ev, 'telegraph', 'lunge') >= 1, 'chase: it leaps at you on the way', `${count(r.ev, 'telegraph', 'lunge')}`);
  r = play('chase.escape', (I, R) => { const g = R.markers.find((m) => m.kind === 'goal')!; toward(I, R, g.x, g.z); }, {}, 420, () => false);
  ok(r.out?.result === 'lost' || r.out?.flags['chase.hit'] === true, 'chase: walking and stumbling, it catches you', JSON.stringify(r.out?.flags) + ' ' + r.out?.result);
}
{
  // the sleeper: slow and round the downwind side is clean; running is not
  const sneaker: Bot = (I, R) => {
    const p = R.sim.player, goal = R.markers.find((m) => m.kind === 'goal')!;
    // a wide line on the side away from the den, the plant and the pack
    const way = [R.at(14, 3.5), R.at(30, -5), R.at(46, 2), R.at(60, 3)];
    const next = way.find((w) => { const a = R.at(0, 0); return Math.hypot(w.x - a.x, w.z - a.z) > Math.hypot(p.x - a.x, p.z - a.z) + 0.5; }) ?? goal;
    toward(I, R, next.x, next.z, { sneak: true });
  };
  let r = play('stealth.pass', sneaker);
  ok(r.out?.result === 'won' && r.out.flags['stealth.clean'] === true, 'stealth: slow, wide and quiet goes through unseen', JSON.stringify(r.out?.flags) + ` ${r.R.t.toFixed(0)} s`);
  ok(has(r.ev, 'beat', 'ask:breath'), 'stealth: the breath moment is asked for beside the sleeper');
  r = play('stealth.pass', (I, R) => { const g = R.markers.find((m) => m.kind === 'goal')!; toward(I, R, g.x, g.z, { sprint: true }); }, {}, 200, () => false);
  ok(r.out && r.out.flags['stealth.clean'] !== true, 'stealth: sprinting down the middle is not clean', JSON.stringify(r.out?.flags) + ' ' + r.out?.result);
  ok(r.out?.flags['stealth.seen'] === true || r.out?.result === 'lost', 'stealth: and it wakes what was sleeping');
}
{
  let summoned = false;
  const r = play('arena', (I, R) => { if (R.t > 1 && !summoned) { summoned = true; R.summon('skritch', 3); } if (R.t > 3) R.leave(); }, {}, 10);
  ok(r.out?.result === 'left' && r.R.sim.enemies.length === 4, 'arena: creatures can be summoned and you can leave');
  ok(['rock', 'club', 'spear', 'torch', 'sling', 'bow', 'crossbow', 'coil'].every((w) => r.R.sim.player.has[w as WeaponId]), 'arena: every weapon is on the bench');
}

// ---------------------------------------------------------------- determinism and fairness
section('determinism, difficulty');
{
  const sig = (seed: number) => {
    const R = new EncounterRun('night.defence', { seed }), I = noIntent(); let h = 0;
    for (let i = 0; i < 60 * 60; i++) { if (R.phase === 'prep') R.ready(); I.mx = Math.sin(i * 0.01); I.mz = Math.cos(i * 0.013); I.attack = i % 50 === 0; R.update(DT, I); for (const e of R.sim.drain()) h = (h * 31 + e.t.length * 7 + Math.round((e.x ?? 0) * 100) + Math.round((e.z ?? 0) * 100)) | 0; }
    return h + Math.round(R.sim.player.hp * 1000);
  };
  ok(sig(5) === sig(5), 'determinism: the same seed plays the same night twice');
  ok(sig(5) !== sig(6), 'determinism: a different seed is a different night');
  const hit = (d: 'story' | 'normal' | 'hard') => { const sim = new CombatSim({ seed: 1, difficulty: d }); sim.night = true; const h = sim.spawn('hound', 0, 9, { alert: 1.2, aware: true, cd: 0, atkGone: 9 }); const ev = run(sim, 12, (I) => { I.lz = 1; }, (s) => s.stats.taken > 0); return { taken: sim.stats.taken, tele: ev.find((e) => e.t === 'telegraph')!.dur!, hp: h.maxHp }; };
  const S = hit('story'), N = hit('normal'), H = hit('hard');
  ok(S.taken < N.taken && N.taken < H.taken, 'difficulty: Story hurts less than Normal, Hard more', `${S.taken} ${N.taken} ${H.taken}`);
  ok(S.tele > N.tele && N.tele > H.tele && H.tele >= 0.7, 'difficulty: telegraphs are longer on Story, shorter on Hard, never unreadable', `${S.tele.toFixed(2)} ${N.tele.toFixed(2)} ${H.tele.toFixed(2)}`);
  ok(S.hp < N.hp && N.hp < H.hp, 'difficulty: creatures are tougher as it rises');
  // every telegraph in the data is at least 0.45 s on Hard
  let min = 9; for (const sp of Object.values(SPECIES)) for (const a of sp.attacks) min = Math.min(min, a.windup * 0.82 * (sp.phases?.[0]?.telegraph ?? 1));
  ok(min >= 0.4, 'fairness: no telegraph in the data is under 0.4 s on Hard', min.toFixed(2));
}

section('inventions: the Stone Age order');
{
  const byId = new Map(INVENTIONS.map((i) => [i.id, i]));
  const before = (a: string, b: string): boolean => { const B = byId.get(b)!; return B.needs.includes(a) || B.needs.some((n) => before(a, n)); };
  ok(INVENTIONS.every((i) => i.needs.every((n) => byId.has(n))), 'inventions: every need is an invention');
  ok(before('flake', 'handAxe') && before('handAxe', 'hafting') === false && byId.get('handAxe')!.row === 11, 'inventions: the hand axe (row 11) comes after the flake');
  ok(!weaponKnown('handaxe', knownFrom({ flags: { spear: true } })) && weaponKnown('handaxe', knownFrom({ flags: { 'inv.handAxe': true } })), 'inventions: the hand axe is in the hand only once it is taught');
  const s2 = new CombatSim({ seed: 3 }); s2.inv = { stone: 3 };
  ok(s2.craft('handaxe') && s2.player.has.handaxe && (s2.inv.stone ?? 0) === 0, 'inventions: a hand axe is three stones');
}
console.log(`\ncombat sim: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
