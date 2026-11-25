// The set pieces: each is a small script over the same simulation, and each ends in an outcome the story can read.
// Places are given relative to a site (a point and a heading), so the same hunt fits any clearing.
import { CombatSim } from './sim.ts';
import type { Intent, InjuryId } from './sim.ts';
import type { Assist, Difficulty, Env, Fire } from './core.ts';
import { dist2 } from './core.ts';
import { fishWater } from './ai.ts';
import type { Enemy, SpeciesId } from './species.ts';
import type { TensionSpec } from './tension.ts';
import type { WeaponId } from './weapons.ts';

export type EncounterId = 'hunt.first' | 'night.defence' | 'chase.escape' | 'stealth.pass' | 'fish.spear' | 'arena';
export const ENCOUNTERS: EncounterId[] = ['hunt.first', 'night.defence', 'chase.escape', 'stealth.pass', 'fish.spear', 'arena'];

export interface EncounterOpts {
  /** Where it happens: a point, and the heading of "forward" (radians, 0 = +z). */
  site?: { x: number; z: number; yaw: number };
  env?: Env; seed?: number; difficulty?: Difficulty; assist?: Assist;
  /** Someone the story has put beside you (a crew id). They cannot fight. Losing them is an outcome, not a scene. */
  companion?: string | null;
  /** What the story already knows that changes the fight: `poisoned`, `cubKilled`, `fireHigh`, `hurt`. */
  story?: Record<string, boolean>;
  /** The real bag and what is already in the hand (the game passes the save's own); a trial gets a kit. */
  inv?: Record<string, number>;
  has?: Partial<Record<WeaponId, boolean>>;
  /** Give the standard kit for this encounter even when a bag is passed (trials from the menu). */
  kit?: boolean;
}

export interface Outcome {
  id: EncounterId;
  result: 'won' | 'lost' | 'spared' | 'left';
  /** Facts for the story's flags, e.g. `hunt.kill`, `night.held`, `scarred`, `stealth.clean`. */
  flags: Record<string, boolean | number>;
  /** A companion who did not see the end of it. The story tells that off screen. */
  companionLost: string | null;
  injuries: InjuryId[];
  seconds: number;
  stats: CombatSim['stats'];
}

export interface Marker { x: number; z: number; kind: 'goal' | 'fire' | 'food' | 'log' | 'den' | 'prey'; r: number }

/**
 * The night at the fire by difficulty: the wood stacked beside it, how fast it burns once the night presses, and how
 * many scavengers each wave brings. Measured with tools/combat/night_probe.ts (a player who only keeps the fire fed
 * holds it on every level; one who never feeds it loses it on every level, Story about 40 s later).
 */
export const NIGHT: Record<Difficulty, { pile: number; burn: number; waves: [number, number, number] }> = {
  story: { pile: 7, burn: 0.65, waves: [3, 4, 2] },
  normal: { pile: 6, burn: 1, waves: [4, 5, 3] },
  hard: { pile: 4, burn: 1.1, waves: [5, 6, 4] },
};

export class EncounterRun {
  id: EncounterId;
  sim: CombatSim;
  t = 0;
  phase = 'start';
  phaseT = 0;
  wave = 0;
  outcome: Outcome | null = null;
  /** Text key for the HUD's objective line, and numbers to put in it. */
  objective = '';
  objN: Record<string, number> = {};
  markers: Marker[] = [];
  /** A tension moment the fight is waiting on: the game shows it, a test answers it. Time stands still meanwhile. */
  ask: (TensionSpec & { id: string }) | null = null;
  private onAnswer: ((passed: boolean) => void) | null = null;
  flags: Record<string, boolean | number> = {};
  /** The firing night's pit fire (story.firing), or null. */
  pit: Fire | null = null;
  story: Record<string, boolean>;
  private site: { x: number; z: number; yaw: number };
  private mem: Record<string, number> = {};
  private hound: Enemy | null = null;
  /** Hour of the day the encounter wants (the game sets the sky to it). */
  hour = 12;

  constructor(id: EncounterId, o: EncounterOpts = {}) {
    this.id = id;
    this.site = o.site ?? { x: 0, z: 0, yaw: 0 };
    this.story = o.story ?? {};
    this.sim = new CombatSim({ env: o.env, seed: o.seed ?? 11, difficulty: o.difficulty, assist: o.assist });
    const s = this.sim, kit = o.kit || !o.inv;
    if (o.inv) s.inv = o.inv;
    if (o.has) Object.assign(s.player.has, o.has);
    const give = (items: Record<string, number>) => { if (kit) for (const k in items) s.inv[k] = Math.max(s.inv[k] ?? 0, items[k]); };
    const arm = (...ws: WeaponId[]) => { if (kit) for (const w of ws) { if (!s.player.has[w]) s.player.has[w] = true; } };
    const P = this.at(0, 0);
    s.player.x = P.x; s.player.z = P.z; s.player.y = s.env.height(P.x, P.z);
    s.player.fx = Math.sin(this.site.yaw); s.player.fz = Math.cos(this.site.yaw);
    if (this.story.poisoned) s.cond.hunger = 0.9;
    if (this.story.hurt) s.player.injuries.push({ id: 'sprain', left: 0 });
    if (o.companion) { const a = this.at(-1.2, -2.2); s.ally = { who: o.companion, x: a.x, z: a.z, hp: 60, down: false }; }
    this.setup(id, give, arm);
    const first = (['hafted', 'spear', 'club', 'torch', 'rock'] as WeaponId[]).find((w) => s.player.has[w] && (w !== 'rock' || (s.inv.stone ?? 0) > 0));
    if (first && s.player.weapon === 'fists') s.equip(first);
    s.drain();
  }

  /** Site coordinates: u metres forward, v metres to the right. */
  at(u: number, v: number) {
    const c = Math.cos(this.site.yaw), s = Math.sin(this.site.yaw);
    return { x: this.site.x + s * u + c * v, z: this.site.z + c * u - s * v };
  }
  /** The other way: how far forward and how far right of the site a point is. */
  uv(x: number, z: number) {
    const c = Math.cos(this.site.yaw), s = Math.sin(this.site.yaw), dx = x - this.site.x, dz = z - this.site.z;
    return { u: s * dx + c * dz, v: c * dx - s * dz };
  }
  private put(kind: SpeciesId, u: number, v: number, o: Partial<Enemy> = {}) { const p = this.at(u, v); return this.sim.spawn(kind, p.x, p.z, o); }
  private mark(kind: Marker['kind'], u: number, v: number, r = 2) { const p = this.at(u, v); const m = { x: p.x, z: p.z, kind, r }; this.markers.push(m); return m; }
  private go(phase: string) { this.phase = phase; this.phaseT = 0; this.sim.emit({ t: 'beat', what: 'phase:' + phase }); }
  private tension(spec: TensionSpec & { id: string }, then: (passed: boolean) => void) { this.ask = spec; this.onAnswer = then; this.sim.emit({ t: 'beat', what: 'ask:' + spec.id }); }
  /** The tension moment is over. */
  answer(passed: boolean) { const f = this.onAnswer; this.ask = null; this.onAnswer = null; this.sim.emit({ t: 'beat', what: passed ? 'passed' : 'failed' }); f?.(passed); }

  private setup(id: EncounterId, give: (i: Record<string, number>) => void, arm: (...w: WeaponId[]) => void) {
    const s = this.sim;
    if (id === 'hunt.first') {
      // a still afternoon, a meadow, three small grazers, and two very large ones you should leave alone
      this.hour = 14; s.night = false;
      // Episode One teaches the throwing stick (at a stump, after the lean-to) before the first hunt: a trial carries it
      arm('spear', 'throwstick'); give({ stone: 4 });
      const wind = this.at(-1, 0.4), o = this.at(0, 0); const wl = Math.hypot(wind.x - o.x, wind.z - o.z);
      s.windX = (wind.x - o.x) / wl; s.windZ = (wind.z - o.z) / wl; // the wind is in your face: they cannot smell you coming
      this.put('nibbet', 40, -3); this.put('nibbet', 44, 4); this.put('nibbet', 47, -8);
      this.put('mossback', 30, 19, { pack: 7 }); this.put('mossback', 36, 25, { pack: 7 });
      this.mark('prey', 43, -2, 8);
      this.objective = 'cb.obj.hunt'; this.go('stalk');
    } else if (id === 'night.defence') {
      this.hour = 21.5; s.night = true;
      arm('spear', 'club'); give({ branch: 9, vine: 3, tinder: 2, stone: 6, fruit: 1 });
      // the day's wood stacked beside the fire, for the fire alone (the bag's branches go on traps or on the fire):
      // enough, fed when it is low, to see the night through; fewer on Hard (a fire left alone still goes out)
      const f = this.at(2.5, 0); s.addFire(f.x, f.z, this.story.fireHigh ? 100 : 72, { pile: NIGHT[s.difficulty].pile }); this.markers.push({ x: f.x, z: f.z, kind: 'fire', r: 2 });
      const food = this.at(0.5, 2.2); s.addScent(food.x, food.z, this.story.store ? 9 : 4, this.story.store ? 140 : 60); this.markers.push({ x: food.x, z: food.z, kind: 'food', r: this.story.store ? 1.4 : 1 });
      // Episode Three's storm (story.store): the fire is his house's hearth, the food is the winter store in the floor;
      // fewer and hungrier skritch, and the big one does not come in (it watches); Oom-Sa beside him with trust
      if (this.story.store && this.story.oomsa) { const a = this.at(-1.2, 1.8); s.ally = { who: 'local', x: a.x, z: a.z, hp: 60, down: false }; }
      if (this.story.firing) {
        // Episode Two's firing night: the pit beside the fire with the pots buried in its embers. It has to stay hot till
        // dawn (above about 600 C the clay turns to ceramic); a burning branch out of it is a weapon (the torch); the
        // big one goes for it. Kept: the pit built up and its wood beside it; left: he took the pit's wood to the trail;
        // froze: it was kicked half apart before the fight began. Oom-Sa, if she keeps it, sits by it and feeds it.
        const k = this.at(3.0, 1.25);
        this.pit = s.addFire(k.x, k.z, this.story.froze ? 30 : this.story.kept ? 100 : 82, { pile: this.story.left ? 1 : this.story.oomsa ? 5 : 3, kiln: true });
        this.markers.push({ x: k.x, z: k.z, kind: 'fire', r: 1.4 });
        s.player.has.torch = true;
        if (this.story.oomsa) { const a = this.at(3.6, 2.3); s.ally = { who: 'local', x: a.x, z: a.z, hp: 60, down: false }; }
      }
      // a steady night breeze from the fire across the food and out into the dark: the smoke leans the way the smell goes
      const wa = Math.atan2(food.z - f.z, food.x - f.x) + (s.rand() - 0.5) * 0.6; s.windX = Math.cos(wa); s.windZ = Math.sin(wa);
      this.objective = 'cb.obj.prep'; this.go('prep');
    } else if (id === 'chase.escape') {
      // the last of the dusk (this sky's sun sets at 18:00; by 19:30 the glow is gone): the trees stand black against
      // a lit horizon, the ground is read by the sky and the moon, and the hunter's eyes already shine
      this.hour = 18.7; s.night = true;
      give({ stone: 3, fruit: 1 }); arm('rock');
      const f = this.at(125, 0); s.addFire(f.x, f.z, 100); this.markers.push({ x: f.x, z: f.z, kind: 'goal', r: 7 });
      for (const u of [32, 66, 98]) this.mark('log', u, 0, 3.2);
      this.put('lashbloom', 50, 3.5);
      this.hound = this.put('hound', -24, 3, { alert: 1.2, aware: true });
      this.objective = 'cb.obj.chase'; this.go('run');
    } else if (id === 'stealth.pass') {
      this.hour = 13; s.night = false;
      give({ stone: 4 }); arm('rock');
      // the wind blows across the path: one side of the den is safe to pass, the other is not
      const w = this.at(0, 1), o = this.at(0, 0); s.windX = w.x - o.x; s.windZ = w.z - o.z;
      this.hound = this.put('hound', 36, 4, { state: 'asleep', sleeper: true });
      this.mark('den', 36, 4, 6);
      this.put('lashbloom', 22, -3.2);
      for (const [u, v] of [[52, -9], [54, -11], [50, -12]]) this.put('skritch', u, v, { pack: 3 });
      this.mark('goal', 72, 0, 3);
      this.objective = 'cb.obj.stealth'; this.go('sneak');
    } else if (id === 'fish.spear') {
      // a still morning at the shallows: darters holding near the bottom within a spear's reach of the bank. The site
      // stands on the bank facing the water (the game finds one; on dry ground there are no fish and nothing to do)
      this.hour = 9; s.night = false;
      arm('spear');
      for (let i = 0, n = 0; i < 600 && n < 5; i++) {
        const q = this.at(1.4 + s.rand() * 6.5, (s.rand() - 0.5) * 10);
        if (!fishWater(s, q.x, q.z) || s.enemies.some((e) => Math.hypot(e.x - q.x, e.z - q.z) < 1.3)) continue;
        s.spawn('darter', q.x, q.z, { yaw: this.site.yaw + Math.PI * 0.5 + (s.rand() - 0.5) * 0.7, wander: 1 + s.rand() * 4 }); n++;
      }
      this.objective = 'cb.obj.fish'; this.go('fish');
    } else {
      // the proving ground: everything in the hand, nothing at stake
      this.hour = 11; s.night = false;
      for (const w of ['rock', 'flake', 'handaxe', 'club', 'throwstick', 'spear', 'hafted', 'atlatl', 'torch', 'sling', 'bow', 'crossbow', 'coil'] as WeaponId[]) { s.player.has[w] = true; }
      for (const [k, n] of Object.entries({ stone: 30, arrow: 30, dart: 12, bolt: 20, branch: 20, vine: 10, tinder: 6, fruit: 6 })) s.inv[k] = Math.max(s.inv[k] ?? 0, n);
      // the machine stands well off, so the bench fights near the start never wake it by accident
      this.put('guardian', 70, 0, { yaw: this.site.yaw + Math.PI });
      this.objective = 'cb.obj.arena'; this.go('free');
    }
  }

  /** The arena's bench: put a creature in front of the player. */
  /** The dev arena's summon: n of a kind ahead of the player, at `at` metres (or the kind's own distance). */
  summon(kind: SpeciesId, n = 1, at?: number) {
    const p = this.sim.player, pack = kind === 'skritch' ? 20 + this.wave++ : 0;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(p.fx, p.fz) + (i - (n - 1) / 2) * 0.35, d = at ?? (kind === 'mossback' ? 20 : kind === 'lashbloom' ? 8 : 15);
      this.sim.spawn(kind, p.x + Math.sin(a) * d, p.z + Math.cos(a) * d, { pack, alert: kind === 'hound' ? 1.2 : 0, aware: kind === 'hound' });
    }
  }

  private finish(result: Outcome['result']) {
    if (this.outcome) return;
    const s = this.sim;
    if (s.player.down) this.flags.scarred = true;
    this.outcome = {
      id: this.id, result, flags: { ...this.flags }, companionLost: s.ally?.down ? s.ally.who : null,
      injuries: s.player.injuries.map((i) => i.id), seconds: this.t, stats: { ...s.stats },
    };
    s.emit({ t: 'beat', what: 'end:' + result });
  }
  /** The player walks away from it (the menu, or the story calling it off). */
  leave() { if (this.id === 'hunt.first' && !this.flags['hunt.kill']) { this.flags['hunt.spared'] = true; this.finish('spared'); } else this.finish('left'); }

  update(dt: number, I: Intent) {
    if (this.outcome || this.ask) return;
    this.t += dt; this.phaseT += dt;
    const s = this.sim, p = s.player;
    s.step(dt, I);
    if (p.down && this.id !== 'arena') { this.mem.downT = (this.mem.downT ?? 0) + dt; if (this.mem.downT > 2.2) this.finish('lost'); return; }
    if (this.id === 'arena' && p.down) { this.mem.downT = (this.mem.downT ?? 0) + dt; if (this.mem.downT > 2.5) { p.down = false; p.hp = 100; p.stamina = 100; p.injuries = []; this.mem.downT = 0; s.emit({ t: 'beat', what: 'revive' }); } return; }
    switch (this.id) {
      case 'hunt.first': this.hunt(dt); break;
      case 'night.defence': this.night(dt); break;
      case 'chase.escape': this.chase(); break;
      case 'stealth.pass': this.stealth(); break;
      case 'fish.spear': this.fishing(); break;
      default: break;
    }
  }

  // ---- the first hunt ----
  private hunt(dt: number) {
    const s = this.sim, prey = s.enemies.filter((e) => e.kind === 'nibbet');
    if (this.phase === 'stalk') {
      const dead = prey.find((e) => e.dead);
      if (dead) {
        this.flags['hunt.kill'] = true;
        this.flags['hunt.clean'] = prey.every((e) => e.escapes === 0 || e.dead) && s.stats.shots + s.stats.hits <= 2;
        this.mem.kx = dead.x; this.mem.kz = dead.z;
        this.markers = [{ x: dead.x, z: dead.z, kind: 'prey', r: 1.6 }];
        // the others are gone; nothing else happens until you have walked over and done what you came to do
        for (const e of prey) if (!e.dead) s.rout(e);
        this.objective = 'cb.obj.hunt2'; this.go('respect');
        s.emit({ t: 'beat', what: 'firstKill', x: dead.x, z: dead.z });
      } else if (prey.every((e) => e.routed || e.gone)) { this.flags['hunt.failed'] = true; this.finish('lost'); }
    } else if (this.phase === 'respect') {
      if (dist2(s.player.x, s.player.z, this.mem.kx, this.mem.kz) < 1.8 && s.player.speed < 0.5) {
        this.mem.kneel = (this.mem.kneel ?? 0) + dt;
        if (this.mem.kneel > 2.4) { s.inv.meat = (s.inv.meat ?? 0) + 2; this.finish('won'); }
      }
    }
  }

  // ---- spear fishing ----
  /**
   * Two fish and it is breakfast. A throw or thrust that goes over a fish ('fish:high' from the sim: it went where the
   * fish was seen) changes the line to the lesson: lower, the water bends the light. `fish.lesson`: the player missed
   * high and then hit (learned by doing). `fish.caught`: how many.
   */
  private fishing() {
    const s = this.sim, caught = s.enemies.filter((e) => e.kind === 'darter' && e.dead).length;
    if (s.fishLog.includes('high')) this.mem.high = 1;
    this.flags['fish.caught'] = caught;
    if (caught > 0 && this.mem.high) this.flags['fish.lesson'] = true;
    if (caught >= 2) { s.inv.fish = (s.inv.fish ?? 0) + caught; this.finish('won'); return; }
    const want = caught === 1 ? 'cb.obj.fish2' : this.mem.high ? 'cb.obj.fishLow' : 'cb.obj.fish';
    if (this.objective !== want) this.objective = want;
  }

  // ---- the night at the fire ----
  private night(dt: number) {
    const s = this.sim, fire = s.fires.find((f) => !f.torch && !f.burnsOut)!, straight = !!this.story.cubKilled, N = NIGHT[s.difficulty];
    // they come out of the dark to the edge of the light, where the food can be smelt (a home far out had them
    // wander beyond their noses all night in the real world's terrain, and nothing ever came)
    const fromDark = (kind: SpeciesId, n: number, pack: number, spread = 1.2) => {
      // up the wind: the food's smell drifts downwind and that is the side they come from (the smoke shows it)
      const a0 = Math.atan2(s.windZ, s.windX) + (s.rand() - 0.5) * 0.5;
      for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * 0.22 * spread, r = 30 + s.rand() * 6; s.spawn(kind, fire.x + Math.cos(a) * r, fire.z + Math.sin(a) * r, { pack, homeX: fire.x + Math.cos(a) * 21, homeZ: fire.z + Math.sin(a) * 21 }); }
    };
    const food = s.scents.reduce((n, sc) => n + Math.max(0, sc.food), 0);
    this.objN = { food, fuel: Math.round((fire.fuel / fire.max) * 100), wave: this.wave, pile: fire.pile ?? 0, wood: s.inv.branch ?? 0 };
    if (this.pit) this.kiln(dt, N.burn);
    const packLeft = (pack: number) => s.enemies.filter((e) => e.pack === pack && !e.dead && !e.routed && !e.gone).length;
    if (this.phase === 'prep') {
      // time to think: what you set now is what the night meets
      // a dusk fire is built up and left to settle; it is the night that eats wood
      fire.slow = 0.3;
      if (this.phaseT > 70 || this.mem.ready) { this.objective = 'cb.obj.hush'; this.go('hush'); }
    } else if (this.phase === 'hush') {
      // the work is done and the camp goes quiet: a few seconds to stand and look at what is set before anything comes
      fire.slow = 0.6;
      if (this.phaseT > 10) {
        fire.slow = N.burn; this.wave = 1;
        if (this.pit) {
          // it comes first this time, and alone at first: it knows the fire now, and it knows him
          fromDark('skritch', Math.max(1, N.waves[0] - 2), 1);
          const a = Math.atan2(s.windZ, s.windX) + 0.9; this.hound = s.spawn('hound', fire.x + Math.cos(a) * 30, fire.z + Math.sin(a) * 30, { alert: 1.2, aware: true });
          this.objective = 'cb.obj.kiln';
        } else if (this.story.store) { fromDark('skritch', N.waves[0] + 1, 1, 0.8); this.objective = 'cb.obj.store'; }
        else { fromDark('skritch', N.waves[0], 1); this.objective = 'cb.obj.night'; }
        this.go('wave1');
      }
    } else if (this.phase === 'wave1') {
      if (packLeft(1) === 0 || this.phaseT > 75) { for (const e of s.enemies) if (e.pack === 1) s.rout(e); this.go('lull'); }
    } else if (this.phase === 'lull') {
      if (this.phaseT > 12) {
        this.wave = 2; fromDark('skritch', N.waves[1] - (this.pit ? 1 : 0), 2, 1.7);
        if (this.story.store) { /* the big one only watches from the treeline in this storm */ }
        else if (!this.hound || this.hound.dead || this.hound.gone) { const a = s.rand() * 6.283; this.hound = s.spawn('hound', fire.x + Math.cos(a) * 34, fire.z + Math.sin(a) * 34, { alert: 1.2, aware: true }); }
        else if (this.hound.routed) { this.hound.routed = false; this.hound.aware = true; this.hound.alert = 1.2; }
        if (straight && this.hound) this.hound.cd = 0;
        this.go('wave2');
      }
    } else if (this.phase === 'wave2') {
      if ((packLeft(2) === 0 && this.phaseT > 30) || this.phaseT > 80 || this.hound?.routed) { this.wave = 3; if (!this.hound?.routed) fromDark('skritch', N.waves[2], 3); this.go('wave3'); }
    } else if (this.phase === 'wave3') {
      // the last hour before dawn: the fire burns down faster and the hunter stops waiting
      if (fire.fuel > 0) fire.fuel = Math.max(0, fire.fuel - dt * 0.35 * N.burn);
      if (this.hound && !this.hound.routed && !this.hound.dead) this.hound.atkGone += dt * (straight ? 1.2 : 0.5);
      const clear = s.enemies.every((e) => e.dead || e.routed || e.gone || e.def.temperament === 'ambush');
      if (this.phaseT > 85 || clear) {
        s.night = false;
        for (const e of s.enemies) s.rout(e);
        this.flags['night.held'] = true; this.flags['night.food'] = food; this.flags['night.houndDriven'] = !!this.hound?.routed && this.phaseT <= 85;
        this.flags['night.fireKept'] = fire.fuel > 0;
        if (this.story.store) this.flags['store.food'] = food;
        if (this.pit) { this.flags['kiln.fuel'] = Math.round((this.pit.fuel / this.pit.max) * 100); this.flags['kiln.cold'] = (this.mem.coldT ?? 0) > 45; }
        s.emit({ t: 'beat', what: 'dawn' });
        this.finish('won');
      }
    }
  }
  /** The firing night's pit: it burns hotter than the camp fire, Oom-Sa feeds it if she is there, and the big one
   *  tries it whenever he is away from it. Flags: kiln.raided, kiln.scattered (times it got there), kiln.cold. */
  private kiln(dt: number, burn: number) {
    const s = this.sim, pit = this.pit!, p = s.player, h = this.hound;
    if (this.phase !== 'prep') pit.slow = this.phase === 'hush' ? 0.8 : burn * 1.15;
    if (this.phase !== 'prep' && this.phase !== 'hush' && pit.fuel < pit.max * 0.25) this.mem.coldT = (this.mem.coldT ?? 0) + dt;
    this.objN.kiln = Math.round((pit.fuel / pit.max) * 100); this.objN.kilnPile = pit.pile ?? 0;
    const a = s.ally;
    if (a && !a.down) {
      // she feeds it a branch at a time from its own stack, low and steady (a potter's fire is kept, not built up)
      this.mem.feedT = (this.mem.feedT ?? 6) - dt;
      if (this.mem.feedT <= 0 && (pit.pile ?? 0) > 0 && pit.fuel < pit.max * 0.8) { pit.pile!--; pit.fuel = Math.min(pit.max, pit.fuel + 28); pit.r = s.fireRadius(pit); this.mem.feedT = 13; s.emit({ t: 'fire', what: 'fed', x: pit.x, z: pit.z, n: pit.fuel / pit.max }); }
      // trusted only a little, she runs when the big one comes into the light
      if (this.story.oomsaRuns && h && !h.dead && !h.routed && dist2(h.x, h.z, a.x, a.z) < 15) { s.ally = null; this.flags['kiln.oomsaRan'] = true; s.emit({ t: 'ally', what: 'ran', x: a.x, z: a.z }); }
    }
    if (!h || h.dead || h.gone || h.routed) { if (h) h.raid = null; return; }
    if (h.state === 'stagger' || h.stunT > 0 || h.state === 'flee') { if (h.raid) { h.raid = null; this.flags['kiln.saved'] = ((this.flags['kiln.saved'] as number) || 0) + 1; } return; }
    this.mem.raidCd = (this.mem.raidCd ?? 22) - dt;
    const away = dist2(p.x, p.z, pit.x, pit.z) > 4.5;
    if (!h.raid && away && this.mem.raidCd <= 0 && pit.fuel > 0 && h.state !== 'windup' && h.state !== 'strike') {
      h.raid = { x: pit.x, z: pit.z }; this.mem.raidCd = 26;
      this.flags['kiln.raided'] = ((this.flags['kiln.raided'] as number) || 0) + 1;
      s.emit({ t: 'sound', what: 'growl', x: h.x, z: h.z });
    }
    if (h.raid && dist2(h.x, h.z, pit.x, pit.z) < 1.7) {
      // it drags the burning wood out of the pit with its forefeet and jaws, and goes: the pots lie half bare
      pit.fuel = Math.max(0, pit.fuel - 45); pit.r = s.fireRadius(pit);
      h.raid = null; h.state = 'flee'; h.stateT = 0;
      this.flags['kiln.scattered'] = ((this.flags['kiln.scattered'] as number) || 0) + 1;
      s.emit({ t: 'fire', what: 'scattered', x: pit.x, z: pit.z });
      s.hurtEnemy(h, 3, 'fire', pit.x, pit.z, 0, 0, 'trap');
    }
  }
  /** The player says they are ready before the prep time is up. */
  ready() { this.mem.ready = 1; }

  // ---- the run to the fire ----
  private chase() {
    const s = this.sim, p = s.player, goal = this.markers.find((m) => m.kind === 'goal')!;
    for (const m of this.markers) {
      if (m.kind !== 'log' || m.r < 0) continue;
      // a fallen trunk across the way: over it clean, or lose a second you do not have
      const a = this.uv(p.x, p.z), b = this.uv(m.x, m.z);
      if (Math.abs(a.u - b.u) < 1.1 && Math.abs(a.v - b.v) < 9) {
        m.r = -1;
        this.tension({ kind: 'quick', id: 'vault', seconds: 1.15, difficulty: s.difficulty, assist: s.assist, strain: this.story.poisoned ? 1.3 : 1 }, (ok) => {
          if (ok) { this.mem.vaults = (this.mem.vaults ?? 0) + 1; s.emit({ t: 'player', what: 'vault' }); }
          else { p.staggerT = 1.0; s.emit({ t: 'player', what: 'stumble' }); }
        });
        return;
      }
    }
    if (s.stats.taken > 0) this.flags['chase.hit'] = true;
    if (dist2(p.x, p.z, goal.x, goal.z) < goal.r) {
      this.flags['chase.escaped'] = true; this.flags['chase.clean'] = !this.flags['chase.hit'];
      if (this.hound) s.rout(this.hound);
      this.finish('won');
    }
  }

  // ---- past the sleeper ----
  private stealth() {
    const s = this.sim, p = s.player, h = this.hound!, goal = this.markers.find((m) => m.kind === 'goal')!;
    const d = dist2(p.x, p.z, h.x, h.z);
    if (h.state === 'asleep' && d < 7 && !this.mem.stirred) {
      // it turns in its sleep as you come level with it
      this.mem.stirred = 1;
      this.tension({ kind: 'breath', id: 'breath', count: 5, difficulty: s.difficulty, assist: s.assist }, (ok) => {
        if (ok) this.flags['stealth.breath'] = true; else { h.alert = Math.min(1.5, h.alert + 0.75); s.emit({ t: 'sound', what: 'stir', x: h.x, z: h.z }); }
      });
      return;
    }
    if (h.state !== 'asleep' || s.enemies.some((e) => e.kind === 'skritch' && e.aware)) this.flags['stealth.seen'] = true;
    if (dist2(p.x, p.z, goal.x, goal.z) < goal.r) {
      this.flags['stealth.clean'] = !this.flags['stealth.seen'] && s.stats.taken === 0;
      this.flags['stealth.through'] = true;
      this.finish('won');
    }
  }
}
