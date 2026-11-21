// The fight itself: the player's weapons, stamina, dodge and block; projectiles, traps and fires; and the creatures
// (their thinking is in ai.ts). It runs on a step and a seed and never looks at the screen.
import { clamp, dist2, FLAT, lerp, rng, TUNING, defaultAssist, solveLaunch, v3, turnTo } from './core.ts';
import type { Env, SimEvent, Noise, Scent, Fire, Tuning, Difficulty, Assist, V3 } from './core.ts';
import { WEAPONS, TRAPS, REFIRE, AMMO_CRAFT } from './weapons.ts';
import type { WeaponId, WeaponDef, TrapId, DamageKind } from './weapons.ts';
import { SPECIES } from './species.ts';
import type { SpeciesId, Enemy, AttackDef } from './species.ts';
import { think } from './ai.ts';

/** What the player is asking for this step, whatever it was pressed on. */
export interface Intent {
  /** Where to move, in the world, 0 to 1 long. */
  mx: number; mz: number;
  sprint: boolean; sneak: boolean;
  /** Pressed this step, and held. */
  attack: boolean; attackHeld: boolean; alt: boolean; altHeld: boolean; dodge: boolean;
  block: boolean; aim: boolean;
  /** The point under the reticle, and which way the camera looks along the ground. */
  ax: number; ay: number; az: number; lx: number; lz: number;
  air: boolean;
}
export const noIntent = (): Intent => ({ mx: 0, mz: 0, sprint: false, sneak: false, attack: false, attackHeld: false, alt: false, altHeld: false, dodge: false, block: false, aim: false, ax: 0, ay: 0, az: 0, lx: 0, lz: 1, air: false });

export type PlayerAct = 'idle' | 'windup' | 'active' | 'recover' | 'charge' | 'roll';
export type InjuryId = 'bite' | 'ribs' | 'sprain' | 'sting';
/** `age` is seconds untreated; a bite left alone turns (`infected`), and then it costs health until it is seen to. */
export interface Injury { id: InjuryId; left: number; age?: number; infected?: boolean }
/** How the body is doing, 0 fine to 1 at the end of it: the survival rules set these, the fight pays for them. */
export interface Condition { hunger: number; thirst: number; cold: number }
/** Seconds before an untreated bite turns bad (game time; the game's hour is 50 s, so this is most of a day). */
export const INFECT_AFTER = 1200;
/** What each injury costs until it is treated or wears off (the Medic's side of a fight). */
export const INJURY: Record<InjuryId, { melee: number; regen: number; speed: number; wears: number }> = {
  bite: { melee: 0.8, regen: 1, speed: 1, wears: 0 },
  ribs: { melee: 1, regen: 0.6, speed: 1, wears: 0 },
  sprain: { melee: 1, regen: 1, speed: 0.82, wears: 0 },
  sting: { melee: 1, regen: 0.5, speed: 1, wears: 45 },
};

export interface SimPlayer {
  x: number; y: number; z: number;
  /** Which way the body faces (unit, on the ground). */
  fx: number; fz: number;
  hp: number; stamina: number;
  weapon: WeaponId; has: Partial<Record<WeaponId, boolean>>;
  act: PlayerAct; actT: number; combo: number;
  /** 0 to 1 while a shot or a throw is drawn; which of the two. */
  charge: number; charging: 'none' | 'shot' | 'throw';
  blocking: boolean; blockT: number; iframe: boolean;
  rollX: number; rollZ: number;
  /** The fight moves the body: this velocity for this long (a roll, a knock-back). */
  forceVX: number; forceVZ: number; forceT: number;
  /** How much of normal walking speed is left (attacking, blocking, snared). */
  moveScale: number;
  snareT: number; staggerT: number; refire: number;
  cell: number; cellT: number;
  sneaking: boolean; speed: number; air: boolean;
  injuries: Injury[];
  down: boolean;
  stepT: number; regenLock: number;
  /** Blows or shots left in each made thing (see WeaponDef.dur). */
  dur: Partial<Record<WeaponId, number>>;
  /** Seconds left of making the weapon ready again (a crossbow being spanned). */
  reloadT: number;
  /** Aim at the moment of the last shot, for the picture. */
  lastHitT: number;
}

export interface Projectile { alive: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; weapon: WeaponId; dmg: number; life: number; g: number }
export interface Trap { id: number; kind: TrapId; x: number; z: number; uses: number; armed: boolean; scent: number; fire: number }
export interface Pickup { id: number; x: number; z: number; item: string; n: number; weapon: WeaponId | null }
/** Someone with you who cannot fight: the story decides what losing them means. */
export interface Ally { who: string; x: number; z: number; hp: number; down: boolean }
export interface Cloud { x: number; z: number; r: number; left: number }

const MAX_PROJ = 48;

export class CombatSim {
  env: Env;
  rand: () => number;
  tune: Tuning;
  assist: Assist;
  difficulty: Difficulty;
  t = 0;
  night = false;
  /** Unit vector the wind blows towards: smell carries along it. */
  windX = 1; windZ = 0;
  /** Which way the player's camera looks along the ground: the hunter goes where you are not looking. */
  lookX = 0; lookZ = 1;
  player: SimPlayer;
  /** The bag: in the game this is the save's own inventory. */
  inv: Record<string, number> = {};
  enemies: Enemy[] = [];
  proj: Projectile[] = [];
  traps: Trap[] = [];
  fires: Fire[] = [];
  scents: Scent[] = [];
  noises: Noise[] = [];
  pickups: Pickup[] = [];
  clouds: Cloud[] = [];
  ally: Ally | null = null;
  cond: Condition = { hunger: 0, thirst: 0, cold: 0 };
  events: SimEvent[] = [];
  /** In tests the sim walks the body itself; in the game the player controller does and tells it where it is. */
  ownsBody = true;
  /** In the game the survival rules refill stamina; here only when the sim owns it. */
  regen = true;
  /** The player cannot fall below 1 (the Scientist does not die in Episode One): they go down instead. */
  private nextId = 1;
  stats = { dealt: 0, taken: 0, hits: 0, shots: 0, shotsHit: 0, rolls: 0, dodged: 0, blocked: 0, parried: 0, kills: 0, routed: 0, weakHits: 0, trapHits: 0, foodLost: 0 };

  constructor(o: { env?: Env; seed?: number; difficulty?: Difficulty; assist?: Assist } = {}) {
    this.env = o.env ?? FLAT;
    this.rand = rng(o.seed ?? 1);
    this.difficulty = o.difficulty ?? 'normal';
    this.tune = TUNING[this.difficulty];
    this.assist = o.assist ?? defaultAssist();
    this.player = {
      x: 0, y: 0, z: 0, fx: 0, fz: 1, hp: 100, stamina: 100, weapon: 'fists', has: { fists: true },
      act: 'idle', actT: 0, combo: 0, charge: 0, charging: 'none', blocking: false, blockT: 0, iframe: false, rollX: 0, rollZ: 0,
      forceVX: 0, forceVZ: 0, forceT: 0, moveScale: 1, snareT: 0, staggerT: 0, refire: 0, cell: WEAPONS.coil.proj!.cell!, cellT: 0,
      sneaking: false, speed: 0, air: false, injuries: [], down: false, stepT: 0, regenLock: 0, lastHitT: -9, dur: {}, reloadT: 0,
    };
    for (let i = 0; i < MAX_PROJ; i++) this.proj.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, weapon: 'rock', dmg: 0, life: 0, g: 0 });
  }

  setDifficulty(d: Difficulty) { this.difficulty = d; this.tune = TUNING[d]; }
  emit(e: SimEvent) { this.events.push(e); }
  /** The events since the last call. */
  drain(): SimEvent[] { const e = this.events; this.events = []; return e; }

  // ---------------- the world of the fight ----------------
  spawn(kind: SpeciesId, x: number, z: number, o: Partial<Enemy> = {}): Enemy {
    const def = SPECIES[kind];
    const hp = Math.round(def.hp * (def.temperament === 'prey' ? 1 : this.tune.enemyHp));
    const e: Enemy = {
      id: this.nextId++, kind, def, x, y: this.env.height(x, z), z, yaw: this.rand() * 6.283, vx: 0, vz: 0, hp, maxHp: hp,
      state: def.temperament === 'machine' ? 'dormant' : 'idle', stateT: 0, alert: 0, aware: false, lkx: x, lkz: z, homeX: x, homeZ: z, pack: 0, poise: 0,
      atk: null, atkDx: 0, atkDz: 1, atkHit: false, atkGone: 0, cd: 1 + this.rand() * 1.5, weakT: 0, heldT: 0, stunT: 0, provoked: 0, warned: 0,
      angle: this.rand() * 6.283, side: this.rand() < 0.5 ? -1 : 1, phase: 0, target: -1, carrying: false, dead: false, deadT: 0, gone: false, routed: false,
      courage: 0, noiseSeen: this.t, shock: 0, shockT: 0, escapes: 0, sleeper: false, wander: this.rand() * 3, wx: x, wz: z, lostT: 0, losAt: -9, losOk: true, inert: false, speed: 0, ...o,
    };
    this.enemies.push(e);
    this.emit({ t: 'spawn', id: e.id, what: kind, x, z });
    return e;
  }
  enemy(id: number) { return this.enemies.find((e) => e.id === id) ?? null; }
  /** Still in the fight: not dead, not gone. */
  living() { return this.enemies.filter((e) => !e.dead && !e.gone); }
  /** Dangerous right now: awake, not routed. */
  hostile() { return this.enemies.filter((e) => !e.dead && !e.gone && !e.routed && e.def.temperament !== 'prey' && (e.aware || e.state === 'windup' || e.state === 'strike')); }

  addFire(x: number, z: number, fuel = 100, o: Partial<Fire> = {}): Fire {
    const f: Fire = { x, z, fuel, max: Math.max(fuel, 100), r: 0, id: this.nextId++, ...o };
    f.r = this.fireRadius(f);
    this.fires.push(f);
    return f;
  }
  fireRadius(f: Fire) { return f.torch ? 3 : f.fuel <= 0 ? 0 : 2.5 + 5.5 * Math.sqrt(clamp(f.fuel / f.max, 0, 1)); }
  /** Feed a fire from the bag: a branch is a good while of light. */
  feedFire(f: Fire): boolean {
    if ((this.inv.branch ?? 0) < 1 || f.fuel >= f.max * 0.97) return false;
    this.inv.branch--; f.fuel = Math.min(f.max, f.fuel + 28);
    this.emit({ t: 'fire', what: 'fed', x: f.x, z: f.z, n: f.fuel / f.max });
    return true;
  }
  /** Is this point in firelight, and how deep (0 at the edge)? */
  lit(x: number, z: number): number {
    let best = -1;
    for (const f of this.fires) { const r = f.r; if (r > 0) best = Math.max(best, r - dist2(x, z, f.x, f.z)); }
    return best;
  }
  addScent(x: number, z: number, food: number, r = 22): Scent { const s = { x, z, r, food, id: this.nextId++ }; this.scents.push(s); return s; }
  // stamped a hair after now, so a sound made between two steps is still new to every ear on the next one
  noise(x: number, z: number, r: number, from = -1) { this.noises.push({ x, z, r, t: this.t + 1e-6, from }); }

  canAfford(cost: Record<string, number>) { for (const k in cost) if ((this.inv[k] ?? 0) < cost[k]) return false; return true; }
  private pay(cost: Record<string, number>) { for (const k in cost) this.inv[k] = (this.inv[k] ?? 0) - cost[k]; }
  /** Crafting hook: make a weapon or a bundle of ammunition from the bag. */
  craft(id: WeaponId | 'arrow' | 'bolt'): boolean {
    const am = AMMO_CRAFT[id];
    if (am) { if (!this.canAfford(am.cost)) return false; this.pay(am.cost); this.inv[id] = (this.inv[id] ?? 0) + am.makes; this.emit({ t: 'player', what: 'crafted:' + id }); return true; }
    const w = WEAPONS[id as WeaponId];
    if (!w?.craft || this.player.has[w.id] || !this.canAfford(w.craft)) return false;
    if (w.id !== 'rock') this.pay(w.craft);
    this.player.has[w.id] = true;
    if (w.dur) this.player.dur[w.id] = w.dur;
    this.emit({ t: 'player', what: 'crafted:' + id });
    return true;
  }
  /** Set a trap at a point (the player stands still for its setTime first: the controller's job). */
  placeTrap(kind: TrapId, x: number, z: number): Trap | null {
    const d = TRAPS[kind];
    if (!this.canAfford(d.cost)) return null;
    this.pay(d.cost);
    const tr: Trap = { id: this.nextId++, kind, x, z, uses: d.uses, armed: true, scent: 0, fire: 0 };
    if (kind === 'bait') tr.scent = this.addScent(x, z, 1, 26).id;
    if (kind === 'fireline') tr.fire = this.addFire(x, z, 26, { max: 26, burnsOut: true }).id;
    this.traps.push(tr);
    this.emit({ t: 'trap', what: 'set:' + kind, id: tr.id, x, z });
    return tr;
  }
  /** Pull the cord: the nearest rattle within reach sounds where you are not. */
  pullRattle(): boolean {
    const p = this.player;
    let best: Trap | null = null, bd = 40;
    for (const tr of this.traps) if (tr.kind === 'rattle' && tr.uses > 0) { const d = dist2(p.x, p.z, tr.x, tr.z); if (d < bd) { bd = d; best = tr; } }
    if (!best) return false;
    best.uses--;
    this.noise(best.x, best.z, 20, -3);
    this.emit({ t: 'trap', what: 'rattle', id: best.id, x: best.x, z: best.z });
    return true;
  }

  equip(w: WeaponId): boolean {
    const p = this.player;
    if (!p.has[w] || p.act !== 'idle') return false;
    if (w === 'rock' && (this.inv.stone ?? 0) < 1) return false;
    p.weapon = w; p.charge = 0; p.charging = 'none';
    this.syncTorch();
    this.emit({ t: 'player', what: 'equip:' + w });
    return true;
  }
  private torchFire: Fire | null = null;
  private syncTorch() {
    const lit = !!WEAPONS[this.player.weapon].fire;
    if (lit && !this.torchFire) this.torchFire = this.addFire(this.player.x, this.player.z, 100, { torch: true });
    if (!lit && this.torchFire) { this.fires = this.fires.filter((f) => f !== this.torchFire); this.torchFire = null; }
  }
  /** Weapons in hand order, for the switch button. */
  owned(): WeaponId[] { return (Object.keys(WEAPONS) as WeaponId[]).filter((w) => this.player.has[w] && (w !== 'rock' || (this.inv.stone ?? 0) > 0)); }
  ammo(w: WeaponId = this.player.weapon): number | null {
    const pr = WEAPONS[w].proj;
    if (!pr) return null;
    if (pr.cell) return this.player.cell;
    if (pr.ammo) return this.inv[pr.ammo] ?? 0;
    return this.player.has[w] ? 1 : 0;
  }
  /** What the body can give right now: injuries, an empty stomach, a dry mouth and cold hands all take their share. */
  hurtMul() {
    let melee = 1, regen = 1, speed = 1, steady = 1;
    for (const i of this.player.injuries) { const d = INJURY[i.id]; melee *= d.melee; regen *= d.regen; speed *= d.speed; if (i.infected) { regen *= 0.7; melee *= 0.85; } if (i.id === 'bite') steady *= 0.7; }
    const c = this.cond, weak = Math.max(c.hunger, c.thirst);
    if (weak > 0.6) { const k = (weak - 0.6) / 0.4; regen *= 1 - 0.5 * k; melee *= 1 - 0.25 * k; speed *= 1 - 0.12 * k; }
    if (c.cold > 0.5) { const k = (c.cold - 0.5) / 0.5; regen *= 1 - 0.3 * k; steady *= 1 - 0.5 * k; }
    return { melee, regen, speed, steady };
  }
  /** One use of a made thing; it breaks when it has none left. */
  private wear(w: WeaponId, n = 1) {
    const p = this.player, def = WEAPONS[w];
    if (!def.dur) return;
    const left = (p.dur[w] ?? def.dur) - n;
    p.dur[w] = left;
    if (left <= 0) {
      p.has[w] = false; delete p.dur[w];
      if (p.weapon === w) { p.weapon = 'fists'; p.charge = 0; p.charging = 'none'; this.syncTorch(); }
      this.emit({ t: 'player', what: 'broke:' + w, x: p.x, z: p.z });
    }
  }
  /** The Medic's side: clear one injury, or all of them. */
  treat(id?: InjuryId) { const p = this.player; p.injuries = id ? p.injuries.filter((i) => i.id !== id) : []; this.emit({ t: 'player', what: 'treated' }); }

  // ---------------- one step ----------------
  step(dt: number, I: Intent) {
    this.t += dt;
    { const l = Math.hypot(I.lx, I.lz); if (l > 1e-3) { this.lookX = I.lx / l; this.lookZ = I.lz / l; } }
    this.stepPlayer(dt, I);
    for (const e of this.enemies) if (!e.gone) think(this, e, dt);
    this.stepProjectiles(dt);
    this.stepTraps(dt);
    for (const f of this.fires) {
      if (f.torch) { f.x = this.player.x; f.z = this.player.z; continue; }
      if (f.fuel > 0) { f.fuel = Math.max(0, f.fuel - dt * (f.burnsOut ? 1 : 0.55) * (f.slow ?? 1)); f.r = this.fireRadius(f); if (f.fuel <= 0) this.emit({ t: 'fire', what: 'out', x: f.x, z: f.z }); }
    }
    for (const c of this.clouds) c.left -= dt;
    if (this.clouds.length && this.clouds[0].left <= 0) this.clouds = this.clouds.filter((c) => c.left > 0);
    if (this.noises.length && this.t - this.noises[0].t > 3) this.noises = this.noises.filter((n) => this.t - n.t <= 3);
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      if (dist2(p.x, p.z, k.x, k.z) < 1.3 && !p.down) {
        if (k.weapon) { p.has[k.weapon] = true; if (p.weapon === 'fists' && p.act === 'idle') this.equip(k.weapon); }
        else this.inv[k.item] = (this.inv[k.item] ?? 0) + k.n;
        this.pickups.splice(i, 1);
        this.emit({ t: 'pickup', what: k.weapon ?? k.item, x: k.x, z: k.z });
      }
    }
  }

  private stepPlayer(dt: number, I: Intent) {
    const p = this.player, T = this.tune;
    if (p.down) { p.moveScale = 0; return; }
    const hm = this.hurtMul();
    for (const i of p.injuries) {
      if (INJURY[i.id].wears) i.left -= dt;
      if (i.id === 'bite' && !i.infected) { i.age = (i.age ?? 0) + dt; if (i.age >= INFECT_AFTER) { i.infected = true; this.emit({ t: 'player', what: 'infected' }); } }
      // an infected wound does not kill in a fight, but it does not stop either
      if (i.infected && p.hp > 12) p.hp -= dt * 0.25;
    }
    if (WEAPONS[p.weapon].fire) this.wear(p.weapon, dt);
    if (p.reloadT > 0) { p.reloadT -= dt; if (p.reloadT <= 0) this.emit({ t: 'player', what: 'reloaded' }); }
    if (p.injuries.some((i) => INJURY[i.id].wears && i.left <= 0)) p.injuries = p.injuries.filter((i) => !INJURY[i.id].wears || i.left > 0);
    p.refire = Math.max(0, p.refire - dt);
    p.snareT = Math.max(0, p.snareT - dt);
    p.regenLock = Math.max(0, p.regenLock - dt);
    p.air = I.air;
    const cellDef = WEAPONS.coil.proj!;
    if (p.cell < cellDef.cell!) { p.cellT += dt; if (p.cellT >= cellDef.recharge!) { p.cellT = 0; p.cell++; } }
    let inCloud = false;
    for (const c of this.clouds) if (dist2(p.x, p.z, c.x, c.z) < c.r) inCloud = true;
    if (inCloud) { p.stamina = Math.max(0, p.stamina - dt * 12); p.regenLock = 0.5; }
    if (this.regen && p.regenLock <= 0 && p.act !== 'roll' && !p.blocking) p.stamina = Math.min(100, p.stamina + dt * 15 * hm.regen);

    const w = WEAPONS[p.weapon];
    let scale = hm.speed;
    const mlen = Math.hypot(I.mx, I.mz);
    p.sneaking = I.sneak && !I.sprint;
    if (p.forceT > 0) p.forceT -= dt;

    if (p.staggerT > 0) {
      p.staggerT -= dt; scale *= 0.25; p.blocking = false;
      if (p.act !== 'roll') { p.act = 'idle'; p.charge = 0; p.charging = 'none'; }
    } else if (p.act === 'roll') {
      p.actT += dt;
      p.iframe = p.actT < 0.42;
      const k = p.actT / 0.62, sp = lerp(8.2, 2.6, k * k);
      p.forceVX = p.rollX * sp; p.forceVZ = p.rollZ * sp; p.forceT = 0.05;
      if (p.actT >= 0.62) { p.act = 'idle'; p.actT = 0; p.iframe = false; }
      scale = 0;
    } else {
      p.iframe = false;
      const rollCost = 18 * T.staminaCost;
      if (I.dodge && (p.act === 'idle' || p.act === 'charge' || (p.act === 'recover' && p.actT > 0.1)) && !I.air) {
        if (p.stamina >= rollCost * 0.6) {
          p.stamina = Math.max(0, p.stamina - rollCost); p.regenLock = 0.9;
          p.act = 'roll'; p.actT = 0; p.iframe = true; p.charge = 0; p.charging = 'none'; p.blocking = false;
          // a snare lets go if you throw yourself out of it
          p.snareT = Math.min(p.snareT, 0.15);
          if (mlen > 0.2) { p.rollX = I.mx / mlen; p.rollZ = I.mz / mlen; } else { p.rollX = -p.fx; p.rollZ = -p.fz; }
          this.stats.rolls++;
          this.emit({ t: 'player', what: 'roll', dx: p.rollX, dz: p.rollZ });
          this.noise(p.x, p.z, 5);
        } else this.emit({ t: 'player', what: 'tired' });
      }
      if (p.act !== 'roll') {
        // block: raise it and it counts from the first moment (a block raised just in time turns the attack)
        const wantBlock = I.block && p.act === 'idle' && p.stamina > 1;
        if (wantBlock && !p.blocking) { p.blockT = 0; this.emit({ t: 'player', what: 'guard' }); }
        p.blocking = wantBlock;
        if (p.blocking) { p.blockT += dt; scale *= 0.4; p.regenLock = Math.max(p.regenLock, 0.3); this.face(I.lx, I.lz, dt, 14); }
        this.stepAttack(dt, I, w, hm.melee);
        if (p.act === 'windup' || p.act === 'active') scale *= 0.3;
        else if (p.act === 'recover') scale *= 0.6;
        else if (p.act === 'charge' || p.reloadT > 0) scale *= 0.5;
        else if (I.aim) scale *= 0.6;
      }
    }
    if (p.snareT > 0) { scale *= 0.12; if (I.attack) p.snareT = Math.max(0, p.snareT - 0.25); }
    p.moveScale = scale;

    if (this.ownsBody) {
      let vx = 0, vz = 0;
      if (p.forceT > 0) { vx = p.forceVX; vz = p.forceVZ; }
      else {
        const sp = (I.sprint && p.stamina > 2 && !p.sneaking ? 7.2 : p.sneaking ? 1.9 : 4) * scale;
        if (mlen > 0.05) { vx = (I.mx / Math.max(1, mlen)) * sp; vz = (I.mz / Math.max(1, mlen)) * sp; }
        if (I.sprint && mlen > 0.05 && scale > 0.5) { p.stamina = Math.max(0, p.stamina - dt * 16); p.regenLock = Math.max(p.regenLock, 0.4); }
        if (mlen > 0.05 && p.act === 'idle' && !p.blocking && !I.aim) this.face(vx, vz, dt, 10);
      }
      const nx = p.x + vx * dt, nz = p.z + vz * dt;
      if (!this.env.blocked(nx, nz, 0.35)) { p.x = nx; p.z = nz; }
      p.y = this.env.height(p.x, p.z);
      p.speed = Math.hypot(vx, vz);
    }
    // footsteps: how loud you are is how fast you go
    if (p.speed > 0.4 && p.act !== 'roll') {
      p.stepT -= dt;
      if (p.stepT <= 0) { p.stepT = 0.4; this.noise(p.x, p.z, p.sneaking || p.speed < 2.2 ? 1.6 : p.speed > 5.5 ? 13 : 6.5); }
    }
  }

  private face(dx: number, dz: number, dt: number, rate: number) {
    const p = this.player, l = Math.hypot(dx, dz);
    if (l < 1e-4) return;
    const a = Math.atan2(p.fx, p.fz), b = Math.atan2(dx / l, dz / l), n = a + turnTo(a, b) * (1 - Math.exp(-dt * rate));
    p.fx = Math.sin(n); p.fz = Math.cos(n);
  }

  /** The nearest thing worth hitting in front of the player: melee turns to it. */
  private meleeTarget(reach: number, lx: number, lz: number): Enemy | null {
    const p = this.player;
    let best: Enemy | null = null, bs = 1e9;
    for (const e of this.enemies) {
      if (e.dead || e.gone) continue;
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz) - e.def.radius;
      if (d > reach * 1.7) continue;
      const dot = d < 0.3 ? 1 : (dx * lx + dz * lz) / Math.max(1e-3, Math.hypot(dx, dz));
      if (dot < 0.25) continue;
      const s = d - dot * 1.5;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  private stepAttack(dt: number, I: Intent, w: WeaponDef, meleeMul: number) {
    const p = this.player, T = this.tune;
    const pr = w.proj, shootMode = !!pr && (w.ranged || I.aim);
    if (p.act === 'idle') {
      p.actT = 0;
      if (p.blocking) return;
      // the alternate attack throws what is in the hand, aiming or not
      if (I.alt && pr && !w.ranged) {
        if (this.hasShot(w)) this.startCharge('throw'); else this.emit({ t: 'player', what: 'noammo' });
      } else if (shootMode && pr) {
        if (pr.charge > 0) {
          if (I.attackHeld || I.attack) { if (this.hasShot(w)) this.startCharge('shot'); else if (I.attack) this.emit({ t: 'player', what: 'noammo' }); }
        } else if ((I.attack || I.attackHeld) && p.refire <= 0 && p.reloadT <= 0) {
          if (this.hasShot(w)) { this.face(I.ax - p.x, I.az - p.z, 1, 99); this.fire(w, 1, I); p.refire = REFIRE[w.id] ?? 0.4; if (pr.reload && this.hasShot(w)) { p.reloadT = pr.reload; this.emit({ t: 'player', what: 'reload:' + w.id, dur: pr.reload }); } }
          else if (I.attack) this.emit({ t: 'player', what: 'noammo' });
        }
      } else if (I.attack && w.melee) this.startMelee(w, I);
      return;
    }
    p.actT += dt;
    if (p.act === 'charge' && pr) {
      p.charge = clamp(p.actT / Math.max(0.05, pr.charge / Math.max(0.5, this.hurtMul().steady)), 0, 1);
      // a drawn bow is held on the arms: it cannot be held for ever
      if (p.charge >= 1 && w.id === 'bow') { p.stamina = Math.max(0, p.stamina - dt * 7); p.regenLock = 0.5; if (p.stamina <= 0) { p.act = 'idle'; p.charge = 0; p.charging = 'none'; this.emit({ t: 'player', what: 'tired' }); return; } }
      this.face(I.ax - p.x, I.az - p.z, dt, 16);
      const held = p.charging === 'throw' ? I.altHeld || I.alt : I.attackHeld || I.attack;
      // hold assist: a tap draws all the way and lets go by itself
      const release = this.assist.hold ? p.charge >= 1 : !held;
      if (release) {
        if (p.charge < 0.12 && !this.assist.hold) { p.act = 'idle'; p.charge = 0; p.charging = 'none'; return; }
        this.fire(w, p.charge, I);
        p.act = 'recover'; p.actT = 0; p.charge = 0; p.charging = 'none'; p.combo = 9;
      }
      return;
    }
    const m = w.melee;
    if (p.act === 'windup' && m) {
      if (p.actT >= m.windup) { p.act = 'active'; p.actT = 0; this.resolveMelee(w, meleeMul); }
    } else if (p.act === 'active' && m) {
      if (p.actT >= m.active) { p.act = 'recover'; p.actT = 0; }
    } else if (p.act === 'recover') {
      const rec = p.combo === 9 ? 0.32 : (m?.recover ?? 0.3);
      // the next press is taken a little early, so a rhythm of presses is a rhythm of blows
      if (I.attack && m && p.combo !== 9 && p.actT > rec * 0.45 && p.stamina >= m.stamina * T.staminaCost * 0.5) { this.startMelee(w, I); return; }
      if (p.actT >= rec) { p.act = 'idle'; p.actT = 0; if (p.combo === 9) p.combo = 0; }
    }
  }

  private hasShot(w: WeaponDef) { return (this.ammo(w.id) ?? 0) > 0; }
  private startCharge(kind: 'shot' | 'throw') { const p = this.player; p.act = 'charge'; p.actT = 0; p.charge = 0; p.charging = kind; this.emit({ t: 'player', what: 'draw:' + p.weapon }); }

  private startMelee(w: WeaponDef, I: Intent) {
    const p = this.player, m = w.melee!, cost = m.stamina * this.tune.staminaCost;
    if (p.stamina < cost * 0.5) { this.emit({ t: 'player', what: 'tired' }); return; }
    p.stamina = Math.max(0, p.stamina - cost); p.regenLock = 0.7;
    const tgt = this.meleeTarget(m.reach, I.lx, I.lz);
    if (tgt) this.face(tgt.x - p.x, tgt.z - p.z, 1, 99); else this.face(I.lx, I.lz, 1, 99);
    p.combo = p.act === 'recover' ? (p.combo + 1) % 3 : 0;
    p.act = 'windup'; p.actT = 0;
    this.emit({ t: 'swing', what: w.id, n: p.combo, dur: m.windup + m.active });
  }

  private resolveMelee(w: WeaponDef, mul: number) {
    const p = this.player, m = w.melee!;
    let any = false;
    for (const e of this.enemies) {
      if (e.dead || e.gone) continue;
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz), edge = d - e.def.radius;
      if (edge > m.reach) continue;
      const ang = d < 1e-3 ? 0 : Math.acos(clamp((dx * p.fx + dz * p.fz) / d, -1, 1));
      if (ang > m.arc / 2 + (edge < 0.4 ? 0.6 : 0)) continue;
      any = true;
      // the third blow of a run lands hardest
      const dmg = m.dmg * mul * (p.combo === 2 ? 1.35 : 1);
      this.hurtEnemy(e, dmg, m.kind, p.x, p.z, m.poise, m.knock, 'melee');
    }
    this.noise(p.x, p.z, m.noise);
    if (any) this.wear(w.id);
    if (!any) this.emit({ t: 'miss', what: w.id, x: p.x + p.fx * m.reach * 0.7, y: p.y + 1.1, z: p.z + p.fz * m.reach * 0.7 });
  }

  /** Where a shot should go: the reticle's point, bent towards a target near it by as much help as the player asked for. */
  aimPoint(I: Intent, speed: number): V3 {
    const p = this.player, from = v3(p.x, p.y + 1.45, p.z);
    const aim = v3(I.ax, I.ay, I.az);
    if (!I.aim) {
      // from the hip: at whatever is in front, or straight ahead
      const tgt = this.meleeTarget(14, I.lx, I.lz);
      if (tgt) return v3(tgt.x, tgt.y + tgt.def.height * 0.55, tgt.z);
      return v3(p.x + p.fx * 18, p.y + 1.1, p.z + p.fz * 18);
    }
    const lvl = this.assist.aim;
    if (!lvl) return aim;
    const cone = (this.tune.assistCone * (lvl === 2 ? 1.8 : 1) * Math.PI) / 180;
    const ax = aim.x - from.x, ay = aim.y - from.y, az = aim.z - from.z, al = Math.hypot(ax, ay, az) || 1;
    let best: Enemy | null = null, ba = cone;
    for (const e of this.enemies) {
      if (e.dead || e.gone) continue;
      const cx = e.x - from.x, cy = e.y + e.def.height * 0.55 - from.y, cz = e.z - from.z, cl = Math.hypot(cx, cy, cz);
      if (cl > 60 || cl < 0.5) continue;
      const a = Math.acos(clamp((ax * cx + ay * cy + az * cz) / (al * cl), -1, 1));
      // a big body is easier to be near
      const eff = a - Math.atan2(e.def.radius, cl) * 0.6;
      if (eff < ba) { ba = eff; best = e; }
    }
    if (!best) return aim;
    const k = lvl === 2 ? 1 : 0.75;
    // lead it by how long the shot is in the air
    const d = Math.hypot(best.x - from.x, best.z - from.z), lead = d / Math.max(1, speed);
    const tx = best.x + best.vx * lead, tz = best.z + best.vz * lead, ty = best.y + best.def.height * 0.55;
    return v3(lerp(aim.x, tx, k), lerp(aim.y, ty, k), lerp(aim.z, tz, k));
  }

  private fire(w: WeaponDef, charge: number, I: Intent) {
    const p = this.player, pr = w.proj!;
    const slot = this.proj.find((q) => !q.alive);
    if (!slot) return;
    if (pr.cell) { p.cell--; p.cellT = 0; }
    else if (pr.ammo) this.inv[pr.ammo] = Math.max(0, (this.inv[pr.ammo] ?? 0) - 1);
    else { p.has[w.id] = false; }
    const k = lerp(pr.weak, 1, charge), speed = pr.speed * k;
    const to = this.aimPoint(I, speed);
    {
      // the hands are not a machine: the shot strays by a little, less at full draw, more when cold or hurt
      const sp = (lerp(pr.spread[0], pr.spread[1], charge) / Math.max(0.4, this.hurtMul().steady)) * (Math.PI / 180);
      const dd = Math.hypot(to.x - p.x, to.z - p.z), off = Math.tan(sp) * dd, a = this.rand() * 6.283, r = Math.sqrt(this.rand()) * off;
      to.x += Math.cos(a) * r; to.z += Math.sin(a) * r * 0.5; to.y += Math.sin(a) * r * 0.6;
    }
    if (pr.ammo || pr.cell) this.wear(w.id);
    this.face(to.x - p.x, to.z - p.z, 1, 99);
    // out of the right hand, a little ahead
    const from = v3(p.x + p.fx * 0.45 + p.fz * -0.22, p.y + 1.5, p.z + p.fz * 0.45 + p.fx * 0.22);
    const v = solveLaunch(from, to, speed, pr.gravity);
    slot.alive = true; slot.x = from.x; slot.y = from.y; slot.z = from.z; slot.vx = v.x; slot.vy = v.y; slot.vz = v.z;
    slot.weapon = w.id; slot.dmg = pr.dmg * k; slot.life = 6; slot.g = pr.gravity;
    this.stats.shots++;
    this.emit({ t: 'shot', what: w.id, x: from.x, y: from.y, z: from.z, dx: v.x, dz: v.z, n: charge });
    this.noise(p.x, p.z, w.id === 'coil' ? 16 : 3);
    // the thrown thing has left the hand: the next best thing comes up
    if (!pr.ammo && !pr.cell) { p.weapon = 'fists'; this.syncTorch(); }
    else if (w.id === 'rock' && (this.inv.stone ?? 0) < 1) p.weapon = 'fists';
  }

  private stepProjectiles(dt: number) {
    for (const q of this.proj) {
      if (!q.alive) continue;
      const pr = WEAPONS[q.weapon].proj!;
      const sp = Math.hypot(q.vx, q.vy, q.vz), n = Math.max(1, Math.ceil((sp * dt) / 0.35)), h = dt / n;
      for (let i = 0; i < n && q.alive; i++) {
        q.vy -= q.g * h;
        q.x += q.vx * h; q.y += q.vy * h; q.z += q.vz * h;
        for (const e of this.enemies) {
          if (e.dead || e.gone) continue;
          const r = e.def.radius + pr.radius;
          if (q.y < e.y - 0.1 || q.y > e.y + e.def.height + 0.2) continue;
          if (dist2(q.x, q.z, e.x, e.z) > r) continue;
          q.alive = false;
          this.stats.shotsHit++;
          this.hurtEnemy(e, q.dmg, pr.kind, q.x - q.vx, q.z - q.vz, pr.poise, pr.knock, 'shot', pr.stun ?? 0, q);
          if (pr.recover > 0 && this.rand() < pr.recover) this.drop(q, pr.ammo);
          break;
        }
        if (!q.alive) break;
        const g = this.env.height(q.x, q.z);
        if (q.y <= g + 0.02 || (q.y < g + 7 && this.env.blocked(q.x, q.z, 0.05))) {
          q.alive = false; q.y = Math.max(q.y, g + 0.02);
          this.emit({ t: 'land', what: q.weapon, x: q.x, y: q.y, z: q.z });
          this.noise(q.x, q.z, pr.noise, -3);
          if (pr.recover > 0 && this.rand() < pr.recover) this.drop(q, pr.ammo);
        }
      }
      q.life -= dt;
      if (q.life <= 0) q.alive = false;
    }
  }
  private drop(q: Projectile, ammo: string | null) {
    // a thrown spear lands on its point: that is wear too
    if (!ammo) { const left = (this.player.dur[q.weapon] ?? WEAPONS[q.weapon].dur) - 3; this.player.dur[q.weapon] = left; if (WEAPONS[q.weapon].dur && left <= 0) { delete this.player.dur[q.weapon]; this.emit({ t: 'player', what: 'broke:' + q.weapon, x: q.x, z: q.z }); return; } }
    this.pickups.push({ id: this.nextId++, x: q.x, z: q.z, item: ammo ?? q.weapon, n: 1, weapon: ammo ? null : q.weapon });
  }

  private stepTraps(dt: number) {
    void dt;
    for (const tr of this.traps) {
      if (!tr.armed || tr.uses <= 0) continue;
      const d = TRAPS[tr.kind];
      if (tr.kind === 'fireline') { const f = this.fires.find((x) => x.id === tr.fire); if (!f || f.fuel <= 0) { tr.armed = false; continue; } }
      for (const e of this.enemies) {
        if (e.dead || e.gone || e.def.temperament === 'ambush') continue;
        if (dist2(e.x, e.z, tr.x, tr.z) > d.r + e.def.radius * 0.5) continue;
        if (tr.kind === 'snare') {
          if (e.heldT > 0 || e.def.temperament === 'machine') continue;
          e.heldT = d.hold / Math.max(1, Math.sqrt(e.def.mass)); tr.uses--;
          this.interrupt(e);
          this.stats.trapHits++;
          this.emit({ t: 'trap', what: 'snared', id: e.id, x: tr.x, z: tr.z });
        } else if (tr.kind === 'stakes') {
          if (e.speed < 4.5) continue;
          tr.uses--;
          this.stats.trapHits++;
          this.emit({ t: 'trap', what: 'staked', id: e.id, x: tr.x, z: tr.z });
          this.hurtEnemy(e, d.dmg, 'pierce', tr.x, tr.z, d.poise, 0, 'trap');
          if (!e.dead) { this.interrupt(e); e.stunT = Math.max(e.stunT, d.hold + (e.kind === 'mossback' ? 1.8 : 0.4)); e.weakT = Math.max(e.weakT, e.stunT); }
        } else if (tr.kind === 'fireline') {
          if (e.def.temperament === 'machine') continue;
          if (e.shockT > this.t) continue;
          e.shockT = this.t + 0.5;
          this.hurtEnemy(e, d.dmg, 'fire', tr.x, tr.z, d.poise, 1.5, 'trap');
        } else if (tr.kind === 'rattle') {
          if (e.speed < 0.5 || e.shockT > this.t) continue;
          e.shockT = this.t + 2; tr.uses--;
          this.noise(tr.x, tr.z, 20, -3);
          this.emit({ t: 'trap', what: 'rattle', id: tr.id, x: tr.x, z: tr.z });
        }
        if (tr.uses <= 0) { tr.armed = false; break; }
      }
    }
  }

  /** Stop whatever it was winding up. */
  interrupt(e: Enemy) { if (e.state === 'windup' || e.state === 'strike') { e.state = 'recover'; e.stateT = 0; e.atk = null; e.cd = Math.max(e.cd, 1.2); } }

  /** A blow lands on a creature: armour, weak point, stagger, fear, death. */
  hurtEnemy(e: Enemy, dmg: number, kind: DamageKind, fromX: number, fromZ: number, poise: number, knock: number, how: 'melee' | 'shot' | 'trap' | 'brace', stun = 0, at?: { x: number; y: number; z: number }) {
    const def = e.def;
    const dx = fromX - e.x, dz = fromZ - e.z, d = Math.hypot(dx, dz) || 1;
    // which side the blow came from: 1 dead ahead of it, -1 from behind
    const front = (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / d;
    let weak = false, mul = 1, deflect = false;
    if (def.temperament === 'machine') {
      const open = e.weakT > 0 || e.state === 'stagger';
      if (kind === 'energy') { mul = open ? def.weak : 0.5; weak = open; }
      else if (open && front < 0.2) { mul = def.weak; weak = true; }
      else { mul = def.armor; deflect = true; }
      if (kind === 'energy' && !open) {
        // three charged hits in a few seconds overload it
        e.shock = e.shockT > this.t ? e.shock + 1 : 1; e.shockT = this.t + 4;
        if (e.shock >= 3 && e.state !== 'dormant') { e.shock = 0; this.interrupt(e); e.state = 'stagger'; e.stateT = 0; e.stunT = 2.6; e.weakT = 2.6; this.emit({ t: 'state', id: e.id, what: 'overload', x: e.x, z: e.z }); }
      }
      if (stun && e.stunT < stun * 0.5 && e.state !== 'stagger') e.stunT = Math.max(e.stunT, stun * 0.35);
    } else if (def.temperament === 'ambush') {
      if (e.weakT > 0) { mul = def.weak; weak = true; } else { mul = def.armor; deflect = kind !== 'fire'; }
      if (kind === 'fire') mul = Math.max(mul, 1) * 3;
    } else if (def.temperament === 'territorial') {
      if (e.weakT > 0) { mul = def.weak; weak = true; } else if (front > 0.45) { mul = def.armor; deflect = true; }
    } else if (def.temperament === 'stalker') {
      // from the front, awake and on its feet, a predator shrugs off most of what a weak arm can do
      if (e.weakT > 0 || front < -0.5) { mul = def.weak; weak = true; } else if (front > 0.3 && e.state !== 'recover' && e.state !== 'stagger') mul = def.armor;
    } else if (def.temperament === 'skittish') {
      if (e.state === 'call' || e.weakT > 0) { mul = def.weak; weak = true; }
    }
    const dealt = dmg * mul;
    e.hp -= dealt;
    this.stats.dealt += dealt; this.stats.hits++; if (weak) this.stats.weakHits++;
    this.player.lastHitT = this.t;
    e.alert = 1.2; e.aware = true; e.lkx = this.player.x; e.lkz = this.player.z;
    if (e.state === 'asleep' || e.state === 'dormant') { e.state = 'idle'; e.stateT = 0; e.sleeper = false; if (def.temperament === 'machine') this.emit({ t: 'state', id: e.id, what: 'wake', x: e.x, z: e.z }); }
    e.provoked = 16;
    if (knock > 0 && def.mass < 20 && e.heldT <= 0 && e.state !== 'strike') { e.vx -= (dx / d) * knock / def.mass; e.vz -= (dz / d) * knock / def.mass; }
    const killed = e.hp <= 0;
    this.emit({ t: 'hit', id: e.id, what: how + ':' + kind, x: at?.x ?? e.x, y: at?.y ?? e.y + def.height * 0.6, z: at?.z ?? e.z, n: dealt, weak, deflect, killed, dx: -dx / d, dz: -dz / d });
    if (killed) { this.kill(e); return; }
    // fire frightens what fears it
    if (kind === 'fire' && def.fireFear > 0) { this.interrupt(e); e.state = 'flee'; e.stateT = 0; e.courage = -1; return; }
    if (!deflect) {
      e.poise += poise;
      if (e.poise >= def.poise && e.state !== 'stagger' && !(e.state === 'strike' && e.atk?.id === 'charge')) {
        e.poise = 0; this.interrupt(e); e.state = 'stagger'; e.stateT = 0; e.atk = null;
        this.emit({ t: 'state', id: e.id, what: 'stagger', x: e.x, z: e.z });
      }
    }
    if (def.fleeAt > 0 && e.hp <= e.maxHp * def.fleeAt && !e.routed) this.rout(e);
    if (def.phases && e.phase < def.phases.length && e.hp <= e.maxHp * def.phases[e.phase].at) {
      this.emit({ t: 'phase', id: e.id, what: def.phases[e.phase].id, x: e.x, z: e.z, n: e.phase + 1 });
      e.phase++; e.cd = 0.6;
    }
    // the pack hears it
    if (def.temperament === 'skittish' && e.state !== 'stagger') { e.state = 'call'; e.stateT = 0; }
  }

  /** It gives up: it runs and does not come back. */
  rout(e: Enemy) {
    if (e.routed || e.dead) return;
    e.routed = true; this.interrupt(e); e.state = 'flee'; e.stateT = 0;
    this.stats.routed++;
    this.emit({ t: 'fled', id: e.id, what: e.kind, x: e.x, z: e.z });
    if (e.pack) {
      const pack = this.enemies.filter((o) => o.pack === e.pack);
      const left = pack.filter((o) => !o.dead && !o.routed).length;
      // half the pack gone: the rest lose their nerve
      if (left > 0 && left <= pack.length / 2) for (const o of pack) if (!o.dead && !o.routed) this.rout(o);
    }
  }

  private kill(e: Enemy) {
    e.dead = true; e.hp = 0; e.state = 'dead'; e.stateT = 0; e.deadT = 0; e.vx = e.vz = 0; e.atk = null;
    this.stats.kills++;
    this.emit({ t: 'death', id: e.id, what: e.kind, x: e.x, z: e.z });
    if (e.pack) {
      const pack = this.enemies.filter((o) => o.pack === e.pack), left = pack.filter((o) => !o.dead && !o.routed).length;
      if (left > 0 && left <= pack.length / 2) for (const o of pack) if (!o.dead && !o.routed) this.rout(o);
    }
  }

  /** An attack reaches the player: dodge, block, the turn of a spear, or it lands. */
  hurtPlayer(dmg: number, fromX: number, fromZ: number, knock: number, what: AttackDef['id'] | 'spore' | 'fire', e: Enemy | null): 'dodged' | 'parried' | 'blocked' | 'hit' {
    const p = this.player, T = this.tune;
    if (p.down) return 'dodged';
    if (p.iframe) { this.stats.dodged++; this.emit({ t: 'player', what: 'dodged', x: p.x, z: p.z }); return 'dodged'; }
    const dx = fromX - p.x, dz = fromZ - p.z, d = Math.hypot(dx, dz) || 1;
    const facing = (dx * p.fx + dz * p.fz) / d;
    const w = WEAPONS[p.weapon];
    if (p.blocking && facing > 0.25 && what !== 'beam' && what !== 'stomp') {
      const window = this.assist.hold ? 0.36 : 0.22;
      // set against a charge or a leap, a spear does the work itself
      const braced = p.weapon === 'spear' && e && (what === 'lunge' || what === 'charge' || what === 'nip');
      if (p.blockT <= window || braced) {
        this.stats.parried++;
        this.emit({ t: 'player', what: braced ? 'brace' : 'parry', x: p.x, z: p.z, id: e?.id });
        if (e) {
          if (braced) this.hurtEnemy(e, WEAPONS.spear.melee!.dmg * 1.5, 'pierce', p.x, p.z, 80, 4, 'brace');
          if (!e.dead && e.def.mass < 20) { this.interrupt(e); e.state = 'stagger'; e.stateT = 0; e.weakT = Math.max(e.weakT, 1.8); e.poise = 0; }
        }
        if (braced && what === 'charge') { p.stamina = Math.max(0, p.stamina - 30); p.staggerT = 0.5; p.forceVX = -(dx / d) * 5; p.forceVZ = -(dz / d) * 5; p.forceT = 0.25; }
        return 'parried';
      }
      const through = dmg * T.enemyDmg * (1 - w.block);
      p.stamina = Math.max(0, p.stamina - dmg * 1.1 * T.staminaCost); p.regenLock = 1;
      p.hp = Math.max(1, p.hp - through);
      this.stats.blocked++; this.stats.taken += through;
      p.forceVX = -(dx / d) * knock * 0.4; p.forceVZ = -(dz / d) * knock * 0.4; p.forceT = 0.18;
      this.emit({ t: 'hit', id: -1, what: 'blocked:' + what, x: p.x, y: p.y + 1.2, z: p.z, n: through, blocked: true, dx: -dx / d, dz: -dz / d });
      if (p.stamina <= 0) { p.staggerT = 0.9; p.blocking = false; this.emit({ t: 'player', what: 'guardbreak' }); }
      return 'blocked';
    }
    const dealt = dmg * T.enemyDmg;
    p.hp -= dealt;
    this.stats.taken += dealt;
    p.staggerT = Math.max(p.staggerT, dealt >= 20 ? 0.6 : 0.34);
    p.forceVX = -(dx / d) * knock; p.forceVZ = -(dz / d) * knock; p.forceT = knock > 0 ? 0.28 : 0;
    p.regenLock = 1.2;
    this.emit({ t: 'hit', id: -1, what: 'took:' + what, x: p.x, y: p.y + 1.2, z: p.z, n: dealt, dx: -dx / d, dz: -dz / d });
    // a heavy blow leaves something that stays until it is seen to
    const inj: InjuryId | null = what === 'lunge' && dmg >= 14 ? 'bite' : what === 'charge' ? 'ribs' : what === 'stomp' ? 'sprain' : what === 'lash' ? 'sting' : null;
    if (inj && !p.injuries.some((i) => i.id === inj) && (inj === 'sting' || this.rand() < 0.6)) { p.injuries.push({ id: inj, left: INJURY[inj].wears || 0 }); this.emit({ t: 'player', what: 'injury:' + inj }); }
    if (p.hp <= 0) { p.hp = 1; p.down = true; p.act = 'idle'; p.blocking = false; this.emit({ t: 'player', what: 'down', x: p.x, z: p.z }); }
    return 'hit';
  }

  hurtAlly(dmg: number, e: Enemy) {
    const a = this.ally;
    if (!a || a.down) return;
    a.hp -= dmg * this.tune.enemyDmg;
    this.emit({ t: 'ally', what: 'hurt', id: e.id, x: a.x, z: a.z, n: a.hp });
    if (a.hp <= 0) { a.down = true; this.emit({ t: 'ally', what: 'lost:' + a.who, x: a.x, z: a.z }); }
  }
}
