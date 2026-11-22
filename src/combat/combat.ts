// The fight in the game: reads the player's hands, steps the simulation, moves the body and the camera, and turns
// what happened into picture, sound and feel. Two ways in: free play on Verdaxis (its animals are simply there), and
// an encounter (a set piece with an outcome, started by the story or from the Action menu).
import * as THREE from 'three';
import './strings';
import { t } from '../i18n';
import { audio } from '../core/audio';
import type { SaveData } from '../core/save';
import type { World } from '../world/world';
import type { Player } from '../game/player';
import type { Input } from '../game/input';
import type { UI } from '../ui/ui';
import { CombatSim, noIntent } from './sim/sim';
import type { Injury, InjuryId, Intent } from './sim/sim';
import type { Difficulty, SimEvent, Env } from './sim/core';
import { WEAPONS, TRAPS, AMMO_CRAFT } from './sim/weapons';
import { knownFrom, weaponKnown, trapKnown, INVENTIONS } from './sim/inventions';
const EPISODE_WEAPONS = new Set(INVENTIONS.filter((i) => i.episodeOne && i.weapon).map((i) => i.weapon!));
import type { WeaponId, TrapId } from './sim/weapons';
import type { Enemy, SpeciesId } from './sim/species';
import { EncounterRun, ENCOUNTERS } from './sim/encounters';
import type { EncounterId, EncounterOpts, Outcome } from './sim/encounters';
import type { TensionSpec, TensionResult } from './sim/tension';
import { createCreature, NIGHT } from './view/creatures';
import type { CreatureView } from './view/creatures';
import { CombatFx } from './view/fx';
import { FightBody } from './view/body';
import { CombatHud } from './view/hud';
import { TensionUi } from './view/tensionUi';

export interface CombatSettings { difficulty: Difficulty; aim: 0 | 1 | 2; hold: boolean; slowMo: boolean; numbers: boolean; shake: boolean }
export const defaultCombatSettings = (): CombatSettings => ({ difficulty: 'normal', aim: 1, hold: false, slowMo: false, numbers: false, shake: true });
/** What a save remembers of the fight: what was made, how worn it is, what hurts, what has been learned. */
export interface CombatSave { has: Partial<Record<WeaponId, boolean>>; dur: Partial<Record<WeaponId, number>>; weapon: WeaponId; injuries: Injury[]; studied: string[]; hints: string[]; warmth: number }
type SaveX = SaveData & { combat?: CombatSave };

export interface StartOpts extends Pick<EncounterOpts, 'companion' | 'story' | 'seed'> {
  /** A trial from the menu: a standard kit, and nothing it does is kept. The story leaves this off. */
  trial?: boolean;
  difficulty?: Difficulty;
}

interface Deps {
  world: World; player: Player; input: Input; ui: UI;
  save: () => SaveData;
  settings: () => CombatSettings;
  saveSettings: () => void;
  /** The game is in a state where the fight may read the controls. */
  free: () => boolean;
  persist: () => void;
  /** The player is on Verdaxis (not away on another world, where its animals do not live). */
  home: () => boolean;
}

const KEYS = { attack: ['Mouse0'], aim: ['Mouse2'], alt: ['KeyG'], block: ['KeyQ'], dodge: ['KeyV'], sneak: ['KeyX'], weapon: ['KeyR'], kit: ['KeyT'] };
// pad, while a fight has the buttons: RT attack, LT aim, B roll, LB guard, RB throw, Y next weapon, d-pad up kit, R3 creep, L3 run
const PAD = { attack: 7, aim: 6, dodge: 1, block: 4, alt: 5, weapon: 3, kit: 12, sneak: 11, sprint: 10 };
const PAD_TAKEN = new Set(Object.values(PAD));
const GLYPH: Record<string, [string, string, string]> = { // keyboard and mouse, pad, touch
  attack: ['left mouse', 'RT', '●'], aim: ['right mouse', 'LT', '◎'], dodge: ['V', 'B', '↻'], block: ['Q', 'LB', '▲'], sneak: ['X', 'R3', '~'], kit: ['T', 'D-pad ↑', '≡'], weapon: ['R', 'Y', '⇄'],
};
const v = new THREE.Vector3(), v2 = new THREE.Vector3();

export class Combat {
  private d: Deps;
  /** The animals of free play. */
  private ambient: CombatSim | null = null;
  encounter: EncounterRun | null = null;
  private sim: CombatSim | null = null;
  private views = new Map<number, { v: CreatureView; kind: SpeciesId; tele: number; teleDur: number }>();
  private pool: Partial<Record<SpeciesId, CreatureView[]>> = {};
  private fx: CombatFx;
  private body = new FightBody();
  private hud = new CombatHud();
  private tensionUi: TensionUi;
  private I: Intent = noIntent();
  private sneakOn = false; private padSprint = false;
  /** Real seconds of hit-stop left, and the slow-motion factor asked for this frame. */
  private stopT = 0; private slow = 1; private shake = 0;
  private aimK = 0;
  private enc: { resolve: (o: Outcome) => void; opts: StartOpts; snap: string; pos: [number, number, number]; yaw: number; hour: number; day: number; endT: number; card: boolean } | null = null;
  private engagedT = 0;
  private study = { id: 0, t: 0 }; private faT = 0;
  private toastT: Record<string, number> = {};
  private quietT = 0; private leaveT = 0;
  private kitOpen = false; private setting: { kind: TrapId; t: number } | null = null;
  private clock = 0;
  private sites: Partial<Record<EncounterId, { x: number; z: number; yaw: number }>> = {};
  private ambientSeeded = '';
  private env: Env;

  constructor(deps: Deps) {
    this.d = deps;
    const W = deps.world;
    this.env = { height: (x, z) => W.terrain.height(x, z), blocked: (x, z, r) => W.terrain.height(x, z) < -0.7 || W.forest.blocks(x, z, r) };
    this.fx = new CombatFx((x, z) => W.terrain.height(x, z), W.q.name !== 'mobile');
    W.scene.add(this.fx.group);
    // the planetshine for night set pieces: made once at the start and left in the scene at zero, because adding or
    // removing a light later recompiles every material (a hitch on a phone; it stalled the test browser for minutes)
    this.shine = new THREE.DirectionalLight(0x9fb4e0, 0); this.shine.position.set(-40, 80, 30); W.scene.add(this.shine, this.shine.target);
    this.tensionUi = new TensionUi(deps.input);
    audio.preloadSfx('cb_');
    this.hud.onTouch = () => deps.input.setDevice('touch');
    window.addEventListener('keydown', (e) => { if (this.hud.pickerOpen && /^Digit[1-9]$/.test(e.code)) this.hud.pickIndex(+e.code.slice(5) - 1); });
  }

  // ---------------- state the rest of the game can ask about ----------------
  get cs(): CombatSave { const s = this.d.save() as SaveX; return (s.combat ??= { has: {}, dur: {}, weapon: 'fists', injuries: [], studied: [], hints: [], warmth: 100 }); }
  /** Something near means harm, or the player has a weapon up: the fight has the controls. */
  get engaged() { return !!this.encounter || this.engagedT > 0; }
  get threat() { return !!this.sim && this.sim.hostile().some((e) => Math.hypot(e.x - this.d.player.pos.x, e.z - this.d.player.pos.z) < 32); }
  /** How fast stamina comes back right now (injuries, hunger, thirst, cold, a raised guard). */
  regenMul() { const s = this.sim; if (!s) return 1; const p = s.player; return p.regenLock > 0 || p.blocking || p.act === 'roll' ? 0 : s.hurtMul().regen; }
  /** The Medic's side: everything seen to. */
  treat(id?: InjuryId) { this.sim?.treat(id); this.cs.injuries = this.sim ? this.sim.player.injuries : []; }
  get tensionOpen() { return this.tensionUi.open; }

  /** A save has started or been loaded: the animals of Verdaxis take their places. */
  attach(save: SaveData) {
    this.endEncounterNow();
    this.dropViews();
    const key = `${save.savedAt}|${save.replay ?? 0}`;
    void key;
    const sim = new CombatSim({ env: this.env, seed: 2189, difficulty: this.d.settings().difficulty });
    sim.regen = false; sim.ownsBody = false; sim.inv = save.inventory;
    this.ambient = sim; this.sim = sim;
    this.applySettings();
    this.loadPlayer(sim);
    this.seedAmbient(sim);
    this.engagedT = 0;
  }
  private loadPlayer(sim: CombatSim) {
    const c = this.cs, p = sim.player, s = this.d.save();
    p.has = { fists: true, ...c.has }; p.dur = { ...c.dur }; p.injuries = c.injuries.map((i) => ({ ...i }));
    if (s.flags.spear) p.has.spear = true;
    p.has.rock = true;
    // only what has been invented can be in the hand (the proving ground is the one exception)
    const known = this.known();
    for (const w of Object.keys(p.has) as WeaponId[]) if (!weaponKnown(w, known)) delete p.has[w];
    p.weapon = 'fists';
  }
  /** What the people of the crash know how to make (src/combat/sim/inventions.ts). */
  known() { return knownFrom(this.d.save() as unknown as { flags?: Record<string, unknown>; inventions?: string[] }); }
  private storePlayer() {
    if (!this.sim || this.enc?.opts.trial) return;
    const c = this.cs, p = this.sim.player;
    c.has = { ...p.has }; delete c.has.fists; delete c.has.rock; c.dur = { ...p.dur }; c.injuries = p.injuries.map((i) => ({ ...i })); c.weapon = p.weapon;
  }
  applySettings() {
    const S = this.d.settings();
    for (const sim of [this.ambient, this.encounter?.sim]) if (sim) { sim.setDifficulty(S.difficulty); sim.assist = { aim: S.aim, hold: S.hold, slowMo: S.slowMo, noTimers: false, damageNumbers: S.numbers }; }
    this.fx.showNumbers = S.numbers;
  }

  /** Where the animals of free play live: open ground away from the camp and from where the story happens. */
  private seedAmbient(sim: CombatSim) {
    const W = this.d.world, L = W.layout, rnd = sim.rand;
    const ok = (x: number, z: number, clear: number) => {
      if (W.terrain.height(x, z) < 0.6 || Math.abs(x) > 560 || Math.abs(z) > 560) return false;
      for (const q of [L.camp, L.pod, L.pod2, L.beacon, L.ridge, L.shelter]) if (Math.hypot(q.x - x, q.z - z) < clear) return false;
      if (Math.hypot(x, z - 2) < clear + 20) return false;
      return !W.forest.blocks(x, z, 1.2);
    };
    const find = (rMin: number, rMax: number, clear: number): [number, number] | null => {
      for (let i = 0; i < 60; i++) { const a = rnd() * 6.283, r = rMin + rnd() * (rMax - rMin), x = L.camp.x + Math.cos(a) * r, z = L.camp.z + Math.sin(a) * r; if (ok(x, z, clear)) return [x, z]; }
      return null;
    };
    const herd = find(90, 170, 70);
    if (herd) for (let i = 0; i < 2; i++) sim.spawn('mossback', herd[0] + i * 7, herd[1] + i * 4, { pack: 90 });
    const warren = find(60, 140, 50);
    if (warren) for (let i = 0; i < 3; i++) sim.spawn('nibbet', warren[0] + i * 3, warren[1] - i * 2);
    const den = find(110, 190, 80);
    if (den) for (let i = 0; i < 3; i++) sim.spawn('skritch', den[0] + i * 1.5, den[1] + i, { pack: 91 });
    for (let i = 0; i < 3; i++) { const b = find(70, 200, 55); if (b) sim.spawn('lashbloom', b[0], b[1]); }
    sim.drain();
  }

  // ---------------- encounters: the API the story calls ----------------
  /**
   * Starts a set piece and resolves with how it ended. The story reads `outcome.flags` (and `companionLost`, which it
   * tells off screen) and sets its own flags from them. Rejects nothing: a player who quits gets `result: 'left'`.
   */
  startEncounter(id: EncounterId, opts: StartOpts = {}): Promise<Outcome> {
    return new Promise((resolve) => {
      const D = this.d, s = D.save(), P = D.player;
      this.endEncounterNow();
      this.storePlayer();
      const trial = !!opts.trial;
      const snap = JSON.stringify({ stats: s.stats, inventory: s.inventory, combat: (s as SaveX).combat });
      this.enc = { resolve, opts, snap, pos: [P.pos.x, P.pos.y, P.pos.z], yaw: P.yaw, hour: s.timeOfDay, day: s.day, endT: 0, card: false };
      const site = this.site(id);
      const S = D.settings();
      const run = new EncounterRun(id, {
        site, env: this.env, seed: opts.seed ?? 11, difficulty: opts.difficulty ?? S.difficulty,
        assist: { aim: S.aim, hold: S.hold, slowMo: S.slowMo, noTimers: false, damageNumbers: S.numbers },
        companion: opts.companion, story: opts.story, inv: s.inventory, has: trial ? { fists: true } : { ...this.cs.has, fists: true, ...(s.flags.spear ? { spear: true } : {}) }, kit: trial || id === 'arena',
      });
      run.sim.regen = false; run.sim.ownsBody = false;
      if (!trial) { run.sim.player.dur = { ...this.cs.dur }; run.sim.player.injuries = this.cs.injuries.map((i) => ({ ...i })); }
      if (trial) { s.stats.health = 100; s.stats.stamina = 100; }
      this.dropViews();
      this.encounter = run; this.sim = run.sim;
      document.body.classList.add('cb-encounter');
      D.ui.fade('black', 1, 0.01);
      const p = run.sim.player;
      P.spawn(p.x, p.z, Math.atan2(-Math.sin(site.yaw), -Math.cos(site.yaw)));
      P.pitch = -0.12; P.snapCamera();
      s.timeOfDay = run.hour;
      const camp = D.world.camp, L = D.world.layout;
      if (id === 'night.defence' || id === 'chase.escape') { camp.setFire(1); if (id === 'night.defence') camp.setShelter(true); }
      void L;
      requestAnimationFrame(() => requestAnimationFrame(() => D.ui.fade('black', 0, 0.7)));
      D.ui.banner(t('cb.menu'), t(`cb.enc.${id}`));
      this.sneakOn = false; this.hud.touch.sneak = false;
      this.hint(id === 'stealth.pass' ? 'sneak' : id === 'night.defence' ? 'trap' : id === 'hunt.first' ? 'sneak' : 'dodge');
    });
  }
  private goalV = new THREE.Vector3();
  /** Where the set piece wants the player to go, for the compass and the line on the ground. */
  goalPoint(): THREE.Vector3 | null {
    const run = this.encounter, m = run?.markers.find((q) => q.kind === 'goal' || q.kind === 'prey');
    if (!m || run!.id === 'hunt.first' && run!.phase === 'stalk') return null;
    return this.goalV.set(m.x, this.env.height(m.x, m.z), m.z);
  }
  /** A tension moment on its own, for the story's scenes: quick press, hold steady, breath, aim. */
  tension(spec: TensionSpec): Promise<TensionResult> {
    const S = this.d.settings();
    return new Promise((res) => {
      this.tensionUi.run({ difficulty: S.difficulty, assist: { aim: S.aim, hold: S.hold, slowMo: S.slowMo, noTimers: false, damageNumbers: false }, ...spec }, res);
      // inside a set piece the fight's frame drives the moment; called on its own (the story's choices) nothing else
      // would, so it keeps its own clock until it closes
      let last = performance.now();
      const loop = (now: number) => {
        if (!this.tensionUi.open) return;
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
        if (now - this.tensionFed > 150) this.tensionUi.update(dt);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  }
  /** When the encounter frame last advanced the open tension moment (performance.now()). */
  private tensionFed = -1e9;
  private aimW = new THREE.Vector3();
  private shine: THREE.DirectionalLight | null = null;
  /** The story (or the menu) calls the encounter off. */
  leaveEncounter() { this.encounter?.leave(); }

  /** A place for a set piece: the camp for the night, and for the rest the clearest strip of ground near it. */
  private site(id: EncounterId): { x: number; z: number; yaw: number } {
    const hit = this.sites[id];
    if (hit) return hit;
    const W = this.d.world, L = W.layout, camp = L.camp;
    let best = { x: camp.x, z: camp.z - 2.5, yaw: 0 }, bs = 1e9;
    const len = id === 'chase.escape' ? 125 : id === 'hunt.first' ? 55 : id === 'stealth.pass' ? 76 : 34;
    const score = (x: number, z: number, yaw: number) => {
      let bad = 0; const sx = Math.sin(yaw), cz = Math.cos(yaw);
      for (let u = 0; u <= len; u += 3) for (const w of [-5, 0, 5]) {
        const px = x + sx * u + cz * w, pz = z + cz * u - sx * w, h = W.terrain.height(px, pz);
        if (h < 0.4) bad += 6; else if (W.forest.blocks(px, pz, 0.8)) bad += w === 0 ? 2 : 0.6;
        bad += Math.abs(W.terrain.height(px + 2, pz) - h) * 0.6;
      }
      return bad;
    };
    if (id === 'night.defence') best = { x: camp.x, z: camp.z - 2.5, yaw: 0 };
    else if (id === 'chase.escape') {
      // the run ends at the camp fire: find the cleanest line into it
      for (let i = 0; i < 24; i++) { const yaw = (i / 24) * 6.283, x = camp.x - Math.sin(yaw) * 125, z = camp.z - Math.cos(yaw) * 125, sc = score(x, z, yaw); if (sc < bs) { bs = sc; best = { x, z, yaw }; } }
    } else {
      const seed = id.length * 7.1;
      for (let i = 0; i < 90; i++) {
        const a = seed + i * 2.399, r = 70 + (i % 9) * 22, x = camp.x + Math.cos(a) * r, z = camp.z + Math.sin(a) * r, yaw = a * 3.1;
        if (Math.abs(x) > 520 || Math.abs(z) > 520) continue;
        const sc = score(x, z, yaw) + (id === 'stealth.pass' ? 0 : 0);
        if (sc < bs) { bs = sc; best = { x, z, yaw }; }
      }
    }
    this.sites[id] = best;
    return best;
  }

  private endEncounterNow() {
    if (!this.encounter) return;
    const e = this.enc; this.enc = null;
    this.finishRestore(e);
    e?.resolve(this.encounter.outcome ?? { id: this.encounter.id, result: 'left', flags: {}, companionLost: null, injuries: [], seconds: this.encounter.t, stats: this.encounter.sim.stats });
    this.encounter = null;
  }
  private finishRestore(e: Combat['enc']) {
    const D = this.d, s = D.save(), run = this.encounter;
    if (!e || !run) return;
    this.body.release(D.player.model);
    document.body.classList.remove('cb-encounter');
    D.player.combat = null; D.input.padMask = null;
    this.dropViews(); this.fx.clear();
    if (e.opts.trial) {
      const b = JSON.parse(e.snap) as { stats: SaveData['stats']; inventory: Record<string, number>; combat?: CombatSave };
      Object.assign(s.stats, b.stats);
      for (const k of Object.keys(s.inventory)) delete s.inventory[k];
      Object.assign(s.inventory, b.inventory);
      (s as SaveX).combat = b.combat;
    } else {
      // the story's fight is real: what broke stays broken, what hurts still hurts
      this.sim = run.sim; this.storePlayer();
      if (run.sim.player.down) s.stats.health = Math.max(s.stats.health, 30);
    }
    s.timeOfDay = e.hour; s.day = e.day;
    D.player.spawn(e.pos[0], e.pos[2], e.yaw);
    const camp = D.world.camp;
    camp.setFire(s.flags.fire ? 2 : s.flags.pitBuilt ? 1 : 0); camp.setShelter(!!s.flags.shelter);
    this.sim = this.ambient;
    if (this.ambient) { this.ambient.inv = s.inventory; this.loadPlayer(this.ambient); }
    D.ui.setInventory(s.inventory, s.flags.spear ? ['spear'] : []);
    this.hud.show(false); this.hud.showTouch(false); this.hud.objective(null); this.hud.boss(null); this.hud.awareness(null); this.hud.arrows([]); this.hud.tags([]); this.hud.analysis(null); this.hud.vignette(false);
    this.engagedT = 0; this.kitOpen = false; this.hud.picker(null);
  }

  // ---------------- the Action menu ----------------
  openMenu(onBack: () => void = () => {}, onStart: () => void = () => {}) {
    const D = this.d, S = D.settings(), ui = D.ui;
    const seg = (name: string, opts: [string, string][], cur: string) => `<div class="seg" data-cb="${name}">${opts.map(([val, l]) => `<button data-v="${val}" class="${val === cur ? 'active' : ''}">${l}</button>`).join('')}</div>`;
    const onOff = (name: string, on: boolean) => seg(name, [['1', t('settings.on')], ['0', t('settings.off')]], on ? '1' : '0');
    const row = (label: string, body: string) => `<div class="row"><label>${t(label)}</label>${body}</div>`;
    ui.openModal(`<h2>${t('cb.menu')}</h2><div class="menu-page cb-menu">
      <div class="note">${t('cb.menu.note')}</div>
      <div class="menu cb-list">${ENCOUNTERS.map((id) => `<button class="btn" data-enc="${id}"><span>${t(`cb.enc.${id}`)}<small>${t(`cb.enc.${id}.d`)}</small></span></button>`).join('')}</div>
      <div class="cb-rows">
        ${row('cb.set.diff', seg('difficulty', [['story', t('cb.set.story')], ['normal', t('cb.set.normal')], ['hard', t('cb.set.hard')]], S.difficulty))}
        ${row('cb.set.aim', seg('aim', [['0', t('cb.set.aim0')], ['1', t('cb.set.aim1')], ['2', t('cb.set.aim2')]], String(S.aim)))}
        ${row('cb.set.hold', onOff('hold', S.hold))}${row('cb.set.slow', onOff('slowMo', S.slowMo))}${row('cb.set.num', onOff('numbers', S.numbers))}${row('cb.set.shake', onOff('shake', S.shake))}
      </div>
      <div class="menu-foot"><button class="btn" id="m-close">${t('menu.back')}</button></div></div>`);
    const card = document.getElementById('modal-card')!;
    card.querySelectorAll<HTMLElement>('[data-cb]').forEach((g) => g.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const name = g.dataset.cb!, val = b.dataset.v!;
      if (name === 'difficulty') S.difficulty = val as Difficulty; else if (name === 'aim') S.aim = +val as 0 | 1 | 2; else (S as unknown as Record<string, boolean>)[name] = val === '1';
      g.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      D.saveSettings(); this.applySettings();
    })));
    card.querySelectorAll<HTMLButtonElement>('[data-enc]').forEach((b) => b.addEventListener('click', () => { ui.closeModal(); onStart(); this.trial(b.dataset.enc as EncounterId); }));
    document.getElementById('m-close')!.addEventListener('click', () => { ui.closeModal(); onBack(); });
  }
  /** Play a set piece on its own. Nothing it does is kept. */
  trial(id: EncounterId, opts: StartOpts = {}) { void this.startEncounter(id, { trial: true, ...opts }).then((o) => this.endCard(o)); }
  private endCard(o: Outcome) {
    if (o.result === 'left' && o.id === 'arena') return;
    const D = this.d, facts = Object.keys(o.flags).filter((k) => o.flags[k] === true).map((k) => `cb.end.flag.${k}`).filter((k) => t(k) !== k).map((k) => `<p class="facts">${t(k)}</p>`).join('');
    D.input.enabled = false; D.input.releasePointer();
    D.ui.openModal(`<div class="center-msg cb-end"><h2>${t(`cb.enc.${o.id}`)}</h2><p>${t(`cb.end.${o.result}`)}</p>${facts}
      <div class="actions"><button class="btn primary" id="cb-again">${t('cb.end.again')}</button><button class="btn" id="cb-back">${t('cb.end.back')}</button></div></div>`);
    const close = () => { D.ui.closeModal(); D.input.enabled = true; };
    document.getElementById('cb-again')!.addEventListener('click', () => { close(); this.trial(o.id); });
    document.getElementById('cb-back')!.addEventListener('click', close);
  }

  // ---------------- time ----------------
  /** Called with real frame time before the game steps: hit-stop and slow motion happen here. */
  scaleTime(dt: number): number {
    if (this.stopT > 0) { this.stopT -= dt; return dt * 0.04 * this.testSlow; }
    return dt * this.slow * this.testSlow;
  }
  private hitStop(sec: number) { if (this.d.settings().shake) this.stopT = Math.max(this.stopT, sec); }
  private kickCam(k: number) { if (this.d.settings().shake) this.shake = Math.max(this.shake, k); }

  // ---------------- one frame ----------------
  // A press is taken once however many times the game steps before the next drawn frame (a slow frame steps twice,
  // the tests step many times): held now and not before, or a tap the input caught between frames and not yet used.
  private wasDown = new Map<string, boolean>(); private usedHit = new Set<string>(); private edges = new Set<string>();
  private pollKeys() {
    const I = this.d.input; this.edges.clear();
    for (const list of Object.values(KEYS)) for (const c of list) {
      const down = I.down(c), hit = I.hit(c);
      if (!hit) this.usedHit.delete(c);
      if ((down && !this.wasDown.get(c)) || (hit && !down && !this.usedHit.has(c))) this.edges.add(c);
      if (hit) this.usedHit.add(c);
      this.wasDown.set(c, down);
    }
    for (const c of this.tapUp) I.hold(c, false);
    this.tapUp.length = 0;
  }
  private tapUp: string[] = [];
  private key(list: string[], edge = false) { const I = this.d.input; return list.some((c) => (edge ? this.edges.has(c) : I.down(c))); }

  private readIntent(dt: number): Intent {
    const D = this.d, I = this.I, inp = D.input, P = D.player, T = this.hud.touch, eng = this.engaged;
    this.pollKeys();
    const free = D.free() && !this.tensionUi.open && inp.enabled;
    const pad = (i: number, edge = false) => free && eng && (edge ? inp.padBtnHit(i) : inp.padBtn(i));
    const k = (list: string[], edge = false) => free && this.key(list, edge);
    // movement, as the player controller reads it
    let mx = 0, mz = 0;
    if (free) {
      if (inp.held('forward')) mz += 1; if (inp.held('back')) mz -= 1; if (inp.held('left')) mx -= 1; if (inp.held('right')) mx += 1;
      mx += inp.touchMove.x + inp.padMove.x; mz -= inp.touchMove.y + inp.padMove.y;
    }
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = -fz, rz = fx;
    I.mx = fx * mz + rx * mx; I.mz = fz * mz + rz * mx;
    const ml = Math.hypot(I.mx, I.mz); if (ml > 1) { I.mx /= ml; I.mz /= ml; }
    I.lx = fx; I.lz = fz;
    if (k(KEYS.sneak, true) || pad(PAD.sneak, true)) this.sneakOn = !this.sneakOn;
    if (pad(PAD.sprint, true)) this.padSprint = !this.padSprint;
    if (ml < 0.1) this.padSprint = false;
    I.sneak = this.sneakOn || T.sneak;
    I.sprint = free && (inp.device === 'pad' && eng ? this.padSprint : inp.held('sprint')) && !I.sneak;
    const sim = this.sim!, w = WEAPONS[sim.player.weapon];
    const canAim = !!w.proj;
    I.aim = canAim && (k(KEYS.aim) || pad(PAD.aim) || T.aim || (!!w.ranged && inp.device === 'touch' && (T.attackHeld || sim.player.act === 'charge')));
    // a click only counts as a blow while the mouse is the game's (the click that takes the pointer is not a punch)
    const locked = document.pointerLockElement !== null || inp.device !== 'kbm' || this.testKeys;
    I.attack = (locked && k(KEYS.attack, true)) || pad(PAD.attack, true) || T.attackHit;
    I.attackHeld = (locked && k(KEYS.attack)) || pad(PAD.attack) || T.attackHeld;
    I.alt = k(KEYS.alt, true) || pad(PAD.alt, true) || T.altHit;
    I.altHeld = k(KEYS.alt) || pad(PAD.alt) || T.altHeld;
    I.block = k(KEYS.block) || pad(PAD.block) || T.blockHeld;
    I.dodge = k(KEYS.dodge, true) || pad(PAD.dodge, true) || T.dodgeHit;
    I.air = !P.onGround;
    if (!eng) { I.attack = I.attackHeld = I.alt = I.altHeld = I.block = false; if (!I.sneak) I.dodge = false; }
    if (this.setting || this.kitOpen) { I.attack = I.attackHeld = I.alt = I.block = I.dodge = false; }
    // the point under the reticle: march the camera's line to the ground, a trunk or a body
    this.aimK += ((I.aim ? 1 : 0) - this.aimK) * (1 - Math.exp(-dt * 12));
    const cam = P.camera; cam.getWorldDirection(v);
    let hit = 60;
    for (let d = 2.5; d < 60; d += d < 20 ? 0.5 : 1) {
      const x = cam.position.x + v.x * d, y = cam.position.y + v.y * d, z = cam.position.z + v.z * d;
      if (y <= this.env.height(x, z) + 0.05 || this.d.world.forest.blocks(x, z, 0.1)) { hit = d; break; }
      let on = false;
      for (const e of sim.enemies) if (!e.dead && !e.gone && y > e.y && y < e.y + e.def.height && Math.hypot(e.x - x, e.z - z) < e.def.radius) { on = true; break; }
      if (on) { hit = d; break; }
    }
    I.ax = cam.position.x + v.x * hit; I.ay = cam.position.y + v.y * hit; I.az = cam.position.z + v.z * hit;
    // next weapon, the field kit
    if (free && (k(KEYS.weapon, true) || pad(PAD.weapon, true) || T.weaponHit)) this.nextWeapon();
    if (free && (k(KEYS.kit, true) || pad(PAD.kit, true) || T.trapHit)) this.toggleKit();
    return I;
  }

  private nextWeapon() {
    const sim = this.sim!, own = sim.owned(), i = own.indexOf(sim.player.weapon);
    const next = own[(i + 1) % own.length];
    if (next && sim.equip(next)) { audio.sample('leather', 0.4); this.engagedT = Math.max(this.engagedT, next === 'fists' ? 0 : 6); if (next !== 'fists' && WEAPONS[next].proj) this.hint('aim'); else if (next !== 'fists') this.hint('attack'); }
  }

  /** The field kit: traps to set, things to make, wounds to see to. */
  private toggleKit() {
    if (this.kitOpen) { this.kitOpen = false; this.hud.picker(null); return; }
    const sim = this.sim!, p = sim.player, cost = (c: Record<string, number>) => Object.keys(c).map((k) => `${c[k]} ${t(`item.${k}`) === `item.${k}` ? k : t(`item.${k}`)}`).join(', ');
    const items: { id: string; label: string; sub: string; ok: boolean }[] = [];
    if (this.encounter?.id === 'arena') for (const k of ['skritch', 'hound', 'mossback', 'lashbloom', 'nibbet'] as SpeciesId[]) items.push({ id: `summon:${k}`, label: t(`cb.c.${k}`), sub: t('cb.summon'), ok: true });
    else {
      const known = this.known();
      for (const k of Object.keys(TRAPS) as TrapId[]) if (this.encounter || trapKnown(k, known)) items.push({ id: `trap:${k}`, label: t(`cb.t.${k}`), sub: cost(TRAPS[k].cost), ok: sim.canAfford(TRAPS[k].cost) });
      // only what has been invented can be made (a set piece's own kit stays inside Episode One)
      for (const w of ['club', 'spear', 'torch', 'hafted', 'atlatl', 'sling', 'bow'] as WeaponId[]) if (!p.has[w] && (this.encounter ? EPISODE_WEAPONS.has(w) : weaponKnown(w, known)) && sim.canAfford(WEAPONS[w].craft!)) items.push({ id: `make:${w}`, label: `${t('cb.make')}: ${t(`cb.w.${w}`)}`, sub: cost(WEAPONS[w].craft!), ok: true });
      if (p.has.atlatl && sim.canAfford(AMMO_CRAFT.dart.cost)) items.push({ id: 'make:dart', label: `${t('cb.make')}: ${t('cb.item.dart')}`, sub: cost(AMMO_CRAFT.dart.cost), ok: true });
      if (p.has.bow && sim.canAfford(AMMO_CRAFT.arrow.cost)) items.push({ id: 'make:arrow', label: `${t('cb.make')}: ${t('cb.item.arrow')}`, sub: cost(AMMO_CRAFT.arrow.cost), ok: true });
      if (sim.traps.some((q) => q.kind === 'rattle' && q.uses > 0)) items.push({ id: 'pull', label: t('cb.p.pull'), sub: t('cb.t.rattle'), ok: true });
      if (p.injuries.some((i) => i.id === 'bite')) items.push({ id: 'treat:bite', label: t('cb.p.treat'), sub: t('prompt.drink') === 'prompt.drink' ? '' : t('prompt.drink'), ok: this.d.player.inWater });
      if (p.injuries.some((i) => i.id === 'sprain')) items.push({ id: 'treat:sprain', label: t('cb.p.treat'), sub: cost({ branch: 1, vine: 1 }), ok: sim.canAfford({ branch: 1, vine: 1 }) });
    }
    this.kitOpen = true;
    this.d.input.releasePointer();
    this.hud.picker(items.slice(0, 9), (id) => {
      this.kitOpen = false; this.hud.picker(null);
      const [what, arg] = id.split(':');
      if (what === 'summon') this.encounter?.summon(arg as SpeciesId, arg === 'skritch' ? 4 : arg === 'nibbet' ? 3 : 1);
      else if (what === 'trap') { this.setting = { kind: arg as TrapId, t: 0 }; this.d.player.act('fix', null, TRAPS[arg as TrapId].setTime); audio.sample('wood', 0.5, { delay: 0.3 }); }
      else if (what === 'make') { if (sim.craft(arg as WeaponId)) { audio.sample('wood', 0.5); if (arg !== 'arrow' && arg !== 'dart') sim.equip(arg as WeaponId); this.d.player.act('fix', null, 1.2); } }
      else if (what === 'pull') sim.pullRattle();
      else if (what === 'treat') {
        if (arg === 'sprain') { sim.inv.branch--; sim.inv.vine--; }
        sim.treat(arg as InjuryId); this.d.player.act('use', null, 1.6); this.d.ui.toast(t('cb.treated')); audio.sample(arg === 'bite' ? 'splash' : 'leather', 0.4);
      }
      this.d.ui.setInventory(sim.inv, this.d.save().flags.spear ? ['spear'] : []);
    });
  }

  private hint(id: keyof typeof GLYPH | 'trap' | 'study') {
    const c = this.cs, key = id === 'trap' ? 'kit' : id;
    if (c.hints.includes(id)) return;
    c.hints.push(id);
    const dev = this.d.input.device === 'pad' ? 1 : this.d.input.device === 'touch' ? 2 : 0;
    this.d.ui.toast(t(`cb.hint.${id}`, { k: GLYPH[key]?.[dev] ?? '' }));
  }
  private toastOnce(key: string, text: string, gap = 4) { if ((this.toastT[key] ?? -99) + gap > this.clock) return; this.toastT[key] = this.clock; this.d.ui.toast(text); }

  /** Free play: before the player controller runs. */
  before(dt: number, time: number) {
    // on another world the animals of Verdaxis are neither stepped nor drawn
    if (!this.d.home()) { if (this.views.size) this.dropViews(); this.fx.group.visible = false; this.hud.show(false); this.engagedT = 0; this.d.player.combat = null; return; }
    this.fx.group.visible = true;
    // a moment the story opened on its own runs on the game's clock while the game runs (its own clock otherwise)
    if (this.tensionUi.open && !this.encounter) { this.tensionFed = performance.now(); this.tensionUi.update(dt); return; }
    const sim = this.sim;
    if (!sim || this.encounter) return;
    const s = this.d.save();
    // the first hours belong to the tutorial: the animals keep to themselves until the player can look after themselves
    this.stepSim(dt, time, s.level < 2 || !!this.d.save().replay);
  }
  after(dt: number, time: number) { if (this.sim && !this.encounter && this.d.home()) this.present(dt, time); }

  /** An encounter runs the whole frame itself: the survival rules and the story wait. */
  frame(dt: number, time: number) {
    const D = this.d, run = this.encounter!, s = D.save(), st = s.stats, P = D.player, e = this.enc!;
    if (this.tensionUi.open) { this.tensionFed = performance.now(); this.tensionUi.update(dt / Math.max(0.05, this.slow)); P.update(dt * 0.15, D.input, false, st.stamina, 1); this.present(dt * 0.15, time); return; }
    if (run.ask && !run.outcome) {
      const ask = run.ask;
      this.tensionUi.run(ask, (r) => { run.answer(r.passed); });
      return;
    }
    if (run.outcome) {
      // the last moment hangs, then the world comes back
      e.endT += dt;
      this.slow = 0.5;
      P.update(dt, D.input, false, st.stamina, 1);
      this.present(dt, time);
      if (e.endT > 1.4 && !e.card) { e.card = true; D.ui.fade('black', 1, 0.35); window.setTimeout(() => { this.slow = 1; this.endEncounterNow(); D.ui.fade('black', 0, 0.6); D.persist(); }, 420); }
      return;
    }
    // the hour the encounter is in: the night runs from dusk to first light
    s.timeOfDay = run.id === 'night.defence' ? (run.phase === 'prep' ? 20.6 + Math.min(1, run.phaseT / 70) * 0.9 : 21.5 + Math.min(1, (run.wave - 1 + Math.min(1, run.phaseT / 80)) / 3) * 7.6) % 24 : run.hour;
    this.stepSim(dt, time, false);
    // stamina in a fight: running spends it, standing gives it back, and the body's state decides how fast
    const p = run.sim.player;
    if (P.sprinting) st.stamina = Math.max(0, st.stamina - dt * 16);
    else st.stamina = Math.min(100, st.stamina + dt * (P.speedNow > 0.5 ? 8 : 14) * this.regenMul());
    P.model.setLimp(p.injuries.some((i) => i.id === 'sprain'));
    P.update(dt, D.input, !p.down && !this.setting, st.stamina, 1);
    this.present(dt, time);
    // E: feed the fire, kneel, say you are ready
    this.encounterPrompt(run);
    D.ui.setStats(st);
  }

  private encounterPrompt(run: EncounterRun) {
    const D = this.d, sim = run.sim, p = sim.player, ui = D.ui;
    let label: string | null = null, at: THREE.Vector3 | null = null, act: (() => void) | null = null;
    const fire = sim.fires.find((f) => !f.torch && !f.burnsOut);
    if (fire && Math.hypot(fire.x - p.x, fire.z - p.z) < 3 && fire.fuel < fire.max * 0.95 && run.id === 'night.defence') {
      const ok = (sim.inv.branch ?? 0) > 0;
      label = ok ? t('cb.p.feed') : t('cb.need', { list: t('item.branch') }); at = v2.set(fire.x, p.y + 0.8, fire.z);
      act = () => { if (sim.feedFire(fire)) { D.player.act('give', new THREE.Vector3(fire.x, p.y + 0.4, fire.z), 0.9, null); audio.sample('wood', 0.6, { delay: 0.3 }); this.fx.puff('ember', fire.x, p.y + 0.6, fire.z, 0, 0, 4); } };
    } else if (run.phase === 'prep') { label = t('cb.p.ready'); act = () => run.ready(); }
    if (run.id === 'arena' || run.id === 'hunt.first') {
      // a held E walks away from it
      if (D.input.down('KeyE') && !label) { this.leaveT += 1 / 60; if (this.leaveT > 1.2) { this.leaveT = 0; run.leave(); } } else this.leaveT = 0;
    }
    ui.setPrompt(label, at);
    if (act && D.free() && D.input.act('interact')) act();
  }

  private stepSim(dt: number, time: number, passive: boolean) {
    const D = this.d, sim = this.sim!, P = D.player, s = D.save(), st = s.stats, p = sim.player, run = this.encounter;
    this.clock += dt;
    void time;
    // the body and its state, as the game has them
    p.x = P.pos.x; p.y = P.pos.y; p.z = P.pos.z; p.speed = P.speedNow;
    p.fx = -Math.sin(P.facing); p.fz = -Math.cos(P.facing);
    if (p.down && st.health > 1 && !run) { p.down = false; }
    p.hp = st.health; p.stamina = st.stamina;
    const c = this.cs;
    if (!run) sim.night = s.timeOfDay >= 19.5 || s.timeOfDay < 5.5;
    // cold: the night away from a fire takes the warmth out of the hands
    const nearFire = sim.lit(p.x, p.z) > 0 || (!!s.flags.fire && Math.hypot(D.world.layout.camp.x - p.x, D.world.layout.camp.z - p.z) < 9);
    c.warmth = THREE.MathUtils.clamp(c.warmth + dt * (nearFire ? 2.5 : sim.night ? -0.22 : 0.6), 0, 100);
    sim.cond.hunger = 1 - st.hunger / 100; sim.cond.thirst = 1 - st.thirst / 100; sim.cond.cold = run && this.enc?.opts.trial ? 0 : 1 - c.warmth / 100;
    if (run && this.enc?.opts.trial && !run.story.poisoned) sim.cond.hunger = sim.cond.thirst = 0;
    const I = this.readIntent(dt);
    // setting a trap: stand still for its time, then it is in the ground a step ahead
    if (this.setting) {
      const k = this.setting, d = TRAPS[k.kind];
      k.t += dt; I.mx = I.mz = 0;
      if (k.t >= d.setTime) { const tr = sim.placeTrap(k.kind, p.x + p.fx * 1.3, p.z + p.fz * 1.3); this.setting = null; if (tr) D.ui.setInventory(sim.inv, s.flags.spear ? ['spear'] : []); }
    }
    if (passive) { for (const e of sim.enemies) { e.alert = 0; e.aware = false; } I.attack = I.alt = I.block = I.dodge = false; }
    const hp0 = p.hp;
    if (run) run.update(dt, I); else sim.step(dt, I);
    // what the fight did to the body goes back to the game
    st.stamina = p.stamina;
    if (p.hp !== hp0) st.health = Math.max(run ? 1 : 0, p.hp);
    if (p.down && !run) st.health = 0; // free play: the game's own death takes it from here
    const armed = p.weapon !== 'fists';
    const threat = sim.hostile().some((e) => Math.hypot(e.x - p.x, e.z - p.z) < 30);
    if (run || threat || p.act !== 'idle' || I.aim) this.engagedT = Math.max(this.engagedT, armed ? 8 : 3);
    else if (armed) this.engagedT = Math.max(this.engagedT, 0.5);
    else this.engagedT = Math.max(0, this.engagedT - dt);
    const eng = this.engaged;
    D.input.padMask = eng ? PAD_TAKEN : null;
    // the body: what the fight asks of the player controller
    const rolling = p.act === 'roll', forced = p.forceT > 0;
    const face = rolling ? Math.atan2(-p.rollX, -p.rollZ) : I.aim || p.act !== 'idle' || p.blocking ? (I.aim && p.act !== 'windup' && p.act !== 'active' ? P.yaw : Math.atan2(-p.fx, -p.fz)) : null;
    if (eng || I.sneak || forced || p.moveScale < 1) {
      const cb = (P.combat ??= { scale: 1, force: null, face: null, aim: 0, crouch: 0, sprint: null, sneak: false, jump: true });
      cb.scale = p.down ? 0 : p.moveScale; cb.force = forced ? { x: p.forceVX, z: p.forceVZ } : null; cb.face = face;
      cb.aim = I.aim ? 1 : 0; cb.sneak = p.sneaking;
      // a side-on archer hides the bow from behind the right shoulder: over the bow shoulder, looking down the arrow
      cb.shoulder = p.weapon === 'bow' ? -0.95 : 0.85; cb.lift = p.weapon === 'bow' ? 0.22 : 0.12; cb.jump = p.act === 'idle' && !p.blocking;
      cb.sprint = D.input.device === 'pad' && eng ? this.padSprint : null;
    } else P.combat = null;
    // where the player looks (not the camera: a story or a recording may hold the camera elsewhere)
    { const cp = Math.cos(P.pitch); this.aimW.set(-Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp); }
    this.body.update(P.model, p, dt, this.clock, eng && (threat || !!run || I.aim), I.aim, armed ? p.weapon : null, this.aimW, sim.ammo() ?? 0);
    if (P.combat) { P.combat.crouch = this.body.crouch; if (P.combat.face !== null) P.combat.face += this.body.ranged.faceOffset; }
    P.pose = p.down ? 'lie' : P.pose === 'lie' ? 'idle' : P.pose;
    this.slow = 1;
    if (D.settings().slowMo && (p.act === 'charge' || sim.enemies.some((e) => e.state === 'strike' && e.target === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 5))) this.slow = 0.55;
    this.handle(sim.drain(), sim);
    this.hud.endFrame();
  }

  // ---------------- what happened, made felt ----------------
  private vol(x?: number, z?: number, far = 45) { if (x === undefined || z === undefined) return 1; const P = this.d.player.pos; return Math.max(0, 1 - Math.hypot(x - P.x, z - P.z) / far); }
  /** One of the fight's own sounds (public/audio/sfx/cb_*, made by tools/combat/make_sounds.py), placed in the world. */
  private sfx(name: string, vol = 0.8, x?: number, z?: number, rate = 1, delay = 0) {
    const at = x !== undefined && z !== undefined ? { x, y: this.env.height(x, z) + 0.8, z } : undefined;
    audio.sample(`cb_${name}`, vol, { at, near: 4, far: 90, rate, delay });
  }
  private voice(what: string, x?: number, z?: number) {
    const V: Record<string, [string, number, number]> = {
      growl: ['growl', 0.9, 1], lunge: ['snarl', 1, 1], howl: ['howl', 0.8, 1], nip: ['chitter', 0.6, 1.2], shriek: ['shriek', 0.8, 1], snort: ['snort', 0.9, 1],
      charge: ['bellow', 1, 1], bluff: ['snort', 0.9, 0.8], spore: ['hiss', 0.8, 1], beam: ['beam', 0.9, 1], stomp: ['stomp', 1, 1], stir: ['growl', 0.35, 0.8],
    };
    const k = what.split(':')[0];
    if (what === 'wake:guardian' || k === 'wakeMachine') { this.sfx('hum', 0.9, x, z); return; }
    if (k === 'wake') { this.sfx('growl', 0.6, x, z, 1.1); return; }
    const q = V[k];
    if (q) this.sfx(q[0], q[1], x, z, q[2]);
    if (k === 'charge') audio.sample('rumble', 0.4 * this.vol(x, z));
    if (k === 'spore') this.sfx('whip', 0.8, x, z);
  }

  private handle(ev: SimEvent[], sim: CombatSim) {
    const D = this.d, P = D.player, ui = D.ui, run = this.encounter;
    for (const e of ev) {
      const view = e.id !== undefined && e.id > 0 ? this.views.get(e.id) : undefined;
      switch (e.t) {
        case 'swing': this.sfx('swing', 0.5); break;
        case 'miss': break;
        case 'shot': {
          this.body.shot();
          if (e.what === 'bow' || e.what === 'crossbow') this.sfx('twang', 0.7, undefined, undefined, e.what === 'crossbow' ? 0.8 : 1);
          else if (e.what === 'coil') { this.sfx('zap', 0.6); this.kickCam(0.03); this.fx.puff('arc', e.x!, e.y!, e.z!, 0, 0, 0.5); }
          else this.sfx('swing', 0.6, undefined, undefined, 1.3);
          break;
        }
        case 'land': this.fx.puff('dust', e.x!, e.y! + 0.05, e.z!, 0, 0, 0.6); audio.sample(e.what === 'rock' || e.what === 'sling' ? 'stone' : 'wood', 0.5 * this.vol(e.x, e.z), { at: { x: e.x!, y: e.y!, z: e.z! } }); break;
        case 'hit': {
          if (e.id === -1) {
            // the player is hit
            ui.damage();
            if (e.blocked) { this.sfx('crack', 0.7); this.kickCam(0.06); this.fx.puff('chip', e.x!, e.y!, e.z!, e.dx, e.dz, 0.6); }
            else { this.sfx('hit', 0.9); audio.human((e.n ?? 0) >= 14 ? 'yelp' : 'grunt'); this.kickCam(0.1 + Math.min(0.12, (e.n ?? 0) * 0.005)); this.hitStop(0.06); D.input.rumble(180, 0.8); this.fx.puff('dust', e.x!, e.y! - 0.9, e.z!, e.dx, e.dz, 0.6); }
            break;
          }
          if (e.what === 'crash') { this.sfx('crack', 1, e.x, e.z, 0.6); this.sfx('thud', 1, e.x, e.z); this.fx.puff('leaf', e.x!, e.y! + 1.5, e.z!, 0, 0, 3); this.fx.puff('dust', e.x!, e.y!, e.z!, 0, 0, 2); this.kickCam(0.08 * this.vol(e.x, e.z, 25)); break; }
          view?.v.flinch(e.dx ?? 0, e.dz ?? 0);
          const energy = e.what?.endsWith('energy'), fire = e.what?.endsWith('fire');
          this.fx.puff(e.deflect ? 'spark' : energy ? 'arc' : fire ? 'ember' : 'chip', e.x!, e.y!, e.z!, e.dx, e.dz, e.weak ? 1.6 : 1);
          if (e.weak) this.fx.puff('flash', e.x!, e.y!, e.z!);
          this.fx.number(e.n ?? 0, e.x!, e.y! + 0.3, e.z!, !!e.weak);
          const k = this.vol(e.x, e.z);
          if (e.deflect) this.sfx('clang', 0.7, e.x, e.z); else this.sfx('hit', 0.9, e.x, e.z, e.what?.includes('blunt') ? 0.85 : 1.15);
          if (e.weak) audio.tone(880, 0.1, 'triangle', 0.1 * k, 0, 300);
          if (!e.what?.startsWith('trap')) { this.hitStop(Math.min(0.11, 0.04 + (e.n ?? 0) * 0.0022)); D.input.rumble(70, 0.4); }
          break;
        }
        case 'telegraph': {
          const ring = e.what === 'stomp' || e.what === 'lash' || e.what === 'warn';
          this.fx.telegraph(e.id!, ring, e.dur!, e.x!, e.z!, e.dx ?? 0, e.dz ?? 1, e.len ?? 3, e.r ?? 1, e.what === 'warn');
          if (view) { view.tele = 0; view.teleDur = e.dur!; }
          if (e.what === 'lunge') this.voice('growl', e.x, e.z); else if (e.what === 'beam') this.sfx('beamcharge', 0.8, e.x, e.z, 1.25 / Math.max(0.5, e.dur!));
          else if (e.what === 'lash') this.sfx('hiss', 0.5, e.x, e.z, 1.6);
          else if (e.what === 'stomp') this.sfx('hum', 0.7, e.x, e.z, 1.6);
          else if (e.what === 'nip') this.sfx('chitter', 0.7, e.x, e.z);
          if (e.what === 'lunge' || e.what === 'charge') this.hint('dodge');
          break;
        }
        case 'state': {
          if (e.what === 'alerted') { if (view?.kind === 'nibbet') this.sfx('squeak', 0.7, e.x, e.z); else if (view?.kind === 'skritch') this.sfx('chitter', 0.6, e.x, e.z); else audio.tone(520, 0.12, 'triangle', 0.05 * this.vol(e.x, e.z), 0, 240); }
          else if (e.what === 'stagger' || e.what === 'overload') { this.fx.endTelegraph(e.id!); this.fx.puff(e.what === 'overload' ? 'arc' : 'dust', e.x!, this.env.height(e.x!, e.z!) + 1, e.z!, 0, 0, 2); if (e.what === 'overload') this.sfx('zap', 0.9, e.x, e.z, 0.5); }
          else if (e.what === 'wake') { this.voice('wake:guardian', e.x, e.z); this.kickCam(0.04); }
          else if (e.what === 'recover' || e.what === 'flee') this.fx.endTelegraph(e.id!);
          break;
        }
        case 'sound': this.voice(e.what ?? '', e.x, e.z); break;
        case 'death': {
          this.fx.endTelegraph(e.id!);
          this.sfx('thud', e.what === 'nibbet' || e.what === 'skritch' ? 0.4 : 0.9, e.x, e.z, e.what === 'nibbet' || e.what === 'skritch' ? 1.5 : 1);
          if (e.what === 'guardian') { this.sfx('hum', 1, e.x, e.z, 0.5); this.kickCam(0.06); }
          break;
        }
        case 'fled': audio.tone(300, 0.3, 'sine', 0.05 * this.vol(e.x, e.z), 0, -120); break;
        case 'phase': ui.banner(t('cb.c.guardian'), ''); audio.tone(80, 1.5, 'sawtooth', 0.2, 0, 60); this.kickCam(0.08); break;
        case 'trap': {
          if (e.what?.startsWith('set:')) { audio.sample('wood', 0.5); this.fx.puff('dust', e.x!, this.env.height(e.x!, e.z!) + 0.1, e.z!, 0, 0, 0.5); }
          else if (e.what === 'snared') { this.sfx('whip', 0.8, e.x, e.z); this.sfx('crack', 0.5, e.x, e.z, 1.5); this.fx.puff('leaf', e.x!, this.env.height(e.x!, e.z!) + 0.3, e.z!); }
          else if (e.what === 'staked') { this.sfx('crack', 1, e.x, e.z, 0.8); this.fx.puff('chip', e.x!, this.env.height(e.x!, e.z!) + 0.5, e.z!, 0, 0, 2); }
          else if (e.what === 'rattle') { this.sfx('rattle', 1, e.x, e.z); this.sfx('rattle', 0.8, e.x, e.z, 1.1, 0.45); }
          break;
        }
        case 'fire': if (e.what === 'out') this.toastOnce('fireout', t('cb.fire', { n: 0 })); break;
        case 'pickup': audio.pickup(); break;
        case 'ally': if (e.what === 'hurt') audio.human('yelp', 0.5 * this.vol(e.x, e.z)); break;
        case 'player': {
          const w = e.what ?? '';
          if (w === 'roll') { this.sfx('swing', 0.4, undefined, undefined, 0.7); audio.sample('cloth', 0.5); this.fx.puff('dust', P.pos.x, P.pos.y + 0.1, P.pos.z, 0, 0, 0.7); }
          else if (w === 'tired') { this.toastOnce('tired', t('cb.tired')); audio.human('breath', 0.5); }
          else if (w === 'noammo') { this.toastOnce('noammo', t('cb.noammo')); audio.sample('ui_error', 0.4); }
          else if (w.startsWith('broke:')) { ui.toast(t('cb.broke', { item: t(`cb.w.${w.slice(6)}`) })); this.sfx('crack', 1, undefined, undefined, 0.7); }
          else if (w.startsWith('injury:')) ui.toast(t(`cb.inj.${w.slice(7)}`));
          else if (w === 'infected') ui.toast(t('cb.infected'));
          else if (w === 'parry' || w === 'brace') { this.sfx('crack', 1, undefined, undefined, 1.2); this.sfx('hit', 0.8); this.hitStop(0.1); this.kickCam(0.07); this.fx.puff('flash', P.pos.x + sim.player.fx * 0.8, P.pos.y + 1.2, P.pos.z + sim.player.fz * 0.8); }
          else if (w === 'guardbreak') { this.sfx('crack', 0.9, undefined, undefined, 0.6); this.kickCam(0.1); }
          else if (w === 'snared') { audio.sample('cloth', 0.7, { rate: 0.7 }); this.toastOnce('snared', t('cb.hint.dodge', { k: GLYPH.dodge[this.d.input.device === 'pad' ? 1 : this.d.input.device === 'touch' ? 2 : 0] })); }
          else if (w === 'down') { audio.human('scream', 0.6); this.kickCam(0.16); }
          else if (w === 'vault') { this.sfx('swing', 0.5, undefined, undefined, 0.8); P.vel.y = 4.6; P.onGround = false; }
          else if (w === 'stumble') { audio.human('grunt'); this.kickCam(0.1); }
          else if (w.startsWith('draw:')) { if (w.endsWith('bow')) audio.sample('leather', 0.35, { rate: 0.8 }); else if (w.endsWith('sling')) this.sfx('whirr', 0.6); }
          else if (w.startsWith('reload:')) audio.sample('metal', 0.4, { rate: 0.7, delay: 0.5 });
          else if (w === 'dodged') audio.tone(1200, 0.06, 'sine', 0.04);
          else if (w === 'guard') audio.sample('leather', 0.25);
          break;
        }
        case 'beat': {
          const w = e.what ?? '';
          if (w === 'foodStolen') this.toastOnce('food', t('cb.food', { n: e.n ?? 0 }), 1);
          else if (w === 'firstKill') {
            // no fanfare: the world goes quiet and waits for you to walk over
            this.quietT = 4; audio.duck(true); window.setTimeout(() => audio.duck(false), 5000);
            ui.toast(t('cb.kill.quiet'));
          } else if (w === 'dawn') { ui.toast(t('cb.dawn')); audio.chime(); }
          else if (w.startsWith('phase:wave')) ui.banner(t('cb.wave', { n: w.slice(10) }), '');
          break;
        }
        default: break;
      }
    }
    void run;
  }

  // ---------------- the picture ----------------
  private dropViews() {
    for (const [, q] of this.views) { q.v.root.removeFromParent(); (this.pool[q.kind] ??= []).push(q.v); }
    this.views.clear();
  }
  private viewFor(e: Enemy) {
    let q = this.views.get(e.id);
    if (!q) {
      const vw = this.pool[e.kind]?.pop() ?? createCreature(e.kind);
      this.d.world.scene.add(vw.root);
      q = { v: vw, kind: e.kind, tele: 0, teleDur: 0 };
      this.views.set(e.id, q);
    }
    return q;
  }

  private present(dt: number, time: number) {
    // a night set piece: the giant planet overhead throws a cold planetshine, enough to see shapes move at the
    // edge of the firelight (Earth's full moon is about 0.1 to 0.3 lux; a ringed giant filling a wide part of the
    // sky would give several times that)
    const nightRun = !!this.encounter && this.sim!.night;
    // the light stays in the scene once made (switching lights on and off recompiles every material)
    if (this.shine) { const want = nightRun ? 0.55 : 0; this.shine.intensity += (want - this.shine.intensity) * (1 - Math.exp(-dt * 1.5)); if (this.shine.intensity > 0.01) { const P0 = this.d.player.pos; this.shine.position.set(P0.x - 40, P0.y + 80, P0.z + 30); this.shine.target.position.copy(P0); } }
    const D = this.d, sim = this.sim!, P = D.player, p = sim.player, run = this.encounter, cam = P.camera;
    // creatures: a body for each within sight, none for those far off or gone
    NIGHT.on = sim.night;
    for (const e of sim.enemies) {
      const d = Math.hypot(e.x - P.pos.x, e.z - P.pos.z), q = this.views.get(e.id);
      if (e.gone || d > 130) { if (q) { q.v.root.removeFromParent(); (this.pool[q.kind] ??= []).push(q.v); this.views.delete(e.id); } continue; }
      const vw = q ?? this.viewFor(e);
      if (e.state === 'windup') vw.tele += dt; else vw.tele = 0;
      vw.v.update(e, this.clock, dt, vw.teleDur > 0 ? Math.min(1, vw.tele / vw.teleDur) : 0);
      // never draw a body the camera is standing inside (a big creature pressed against the lens hides the fight)
      vw.v.root.visible = !(Math.hypot(e.x - cam.position.x, e.z - cam.position.z) < e.def.radius + 0.35 && cam.position.y < e.y + e.def.height + 0.2);
      if (e.state === 'windup' && e.atk?.id === 'beam') this.fx.moveTelegraph(e.id, e.x, e.z, Math.sin(e.yaw), Math.cos(e.yaw), e.atk.reach, 0.85);
    }
    if (sim.enemies.length > 24) sim.enemies = sim.enemies.filter((e) => !e.gone);
    // a roll turns the whole body over its own middle
    const root = P.model.root;
    if (this.body.rollAngle > 0 && p.act === 'roll') {
      const a = this.body.rollAngle, h = 0.62;
      root.rotation.order = 'YXZ'; root.rotation.x = a;
      const f = P.forward(v);
      root.position.x -= f.x * h * Math.sin(a); root.position.z -= f.z * h * Math.sin(a);
      root.position.y += h * (1 - Math.cos(a));
    } else if (root.rotation.order !== 'XYZ') { root.rotation.x = 0; root.rotation.order = 'XYZ'; }
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake; cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 0.7);
    }
    this.body.late(P.model, dt, this.clock);
    this.fx.sync(sim, dt, this.clock, cam);
    void time;
    // HUD
    const eng = this.engaged, w = WEAPONS[p.weapon], I = this.I;
    this.hud.show(eng);
    this.hud.showTouch(eng && D.input.device === 'touch' && D.free(), { aim: !!w.proj && !w.ranged, alt: !!w.proj && !w.ranged && p.weapon !== 'rock', trap: !!run || p.weapon !== 'fists', block: true });
    if (!eng) { this.hud.injuries(p.injuries.map((i) => ({ id: i.id, bad: !!i.infected }))); return; }
    const hotE = I.aim && sim.enemies.some((e) => !e.dead && !e.gone && Math.hypot(e.x - I.ax, e.z - I.az) < e.def.radius + 0.4);
    this.hud.reticle(I.aim || (!!w.ranged && p.act === 'charge'), p.act === 'charge' ? p.charge : 0, hotE);
    const am = sim.ammo();
    this.hud.weapon(t(`cb.w.${p.weapon}`), w.proj && (w.proj.ammo || w.proj.cell) ? String(am ?? 0) : null, w.dur ? (p.dur[p.weapon] ?? w.dur) / w.dur : null);
    this.hud.injuries(p.injuries.map((i) => ({ id: i.id, bad: !!i.infected })));
    if (run) {
      const N = run.objN;
      this.hud.objective(t(run.objective), run.id === 'night.defence' && run.phase !== 'prep' ? `${t('cb.wave', { n: Math.max(1, N.wave ?? 1) })} · ${t('cb.fire', { n: N.fuel ?? 0 })} · ${t('cb.food', { n: N.food ?? 0 })}` : run.phase === 'prep' ? `${Math.max(0, Math.ceil(70 - run.phaseT))}` : null);
    } else this.hud.objective(null);
    // the eye: how near the most suspicious thing is to knowing
    let top = 0, seen = false;
    for (const e of sim.enemies) { if (e.dead || e.gone || e.def.temperament === 'ambush' || e.def.temperament === 'machine') continue; const d = Math.hypot(e.x - p.x, e.z - p.z); if (d > 40) continue; if (e.aware && e.def.temperament !== 'prey' && e.def.temperament !== 'territorial') seen = true; top = Math.max(top, e.alert); }
    this.hud.awareness(p.sneaking || run?.id === 'stealth.pass' || run?.id === 'hunt.first' ? top : null, seen);
    this.hud.vignette(p.sneaking);
    // arrows for attacks from where you are not looking
    const arrows: { a: number; hot: boolean }[] = [];
    cam.getWorldDirection(v);
    const yawC = Math.atan2(v.x, v.z);
    for (const e of sim.enemies) {
      if (e.dead || e.gone || !(e.state === 'windup' || e.state === 'strike') || e.target !== -1) continue;
      const a = Math.atan2(e.x - p.x, e.z - p.z), rel = Math.atan2(Math.sin(a - yawC), Math.cos(a - yawC));
      if (Math.abs(rel) > 0.75 && arrows.length < 4) arrows.push({ a: -rel, hot: true });
    }
    // in the run, the hunter behind you is always on the edge of the screen: pale while it is far, red once it is close
    if (run?.id === 'chase.escape') for (const e of sim.enemies) {
      if (e.kind !== 'hound' || e.dead || e.gone || e.routed || arrows.length >= 4) continue;
      const dd = Math.hypot(e.x - p.x, e.z - p.z); if (dd > 40) continue;
      const a = Math.atan2(e.x - p.x, e.z - p.z), rel = Math.atan2(Math.sin(a - yawC), Math.cos(a - yawC));
      if (Math.abs(rel) > 0.6 && !arrows.length) arrows.push({ a: -rel, hot: dd < 9 });
    }
    this.hud.arrows(arrows);
    // the suit tags what it has already learned, small, over the animal: in the hunt and the sneak, prey in long grass
    // would otherwise be invisible to anyone but the bot
    const tags: { x: number; y: number; warm: boolean }[] = [];
    if (run && (run.id === 'hunt.first' || run.id === 'stealth.pass')) {
      for (const e of sim.enemies) {
        if (tags.length >= 6 || e.dead || e.gone || !this.cs.studied.includes(e.kind) || Math.hypot(e.x - p.x, e.z - p.z) > 45) continue;
        v2.set(e.x, e.y + e.def.height + 0.35, e.z).project(cam);
        if (v2.z > 1 || Math.abs(v2.x) > 1 || Math.abs(v2.y) > 1) continue;
        tags.push({ x: ((v2.x + 1) / 2) * window.innerWidth, y: ((1 - v2.y) / 2) * window.innerHeight, warm: !e.aware });
      }
    }
    this.hud.tags(tags);
    const boss = sim.enemies.find((e) => e.def.boss && !e.gone && e.state !== 'dormant' && Math.hypot(e.x - p.x, e.z - p.z) < 40);
    this.hud.boss(boss && !boss.dead ? t(`cb.c.${boss.kind}`) : null, boss ? boss.hp / boss.maxHp : 0, !!boss && boss.phase > 0);
    // Field Analysis: keep a creature in the middle of the view for a few seconds and you learn what it is
    let look: Enemy | null = null, best = 0.12;
    for (const e of sim.enemies) {
      if (e.dead || e.gone) continue;
      v2.set(e.x - cam.position.x, e.y + e.def.height * 0.5 - cam.position.y, e.z - cam.position.z); const dl = v2.length(); if (dl > 34) continue;
      const off = Math.acos(Math.min(1, v2.dot(v) / dl)); if (off < best) { best = off; look = e; }
    }
    const c = this.cs;
    if (look && !c.studied.includes(look.kind)) {
      if (this.study.id !== look.id) { this.study.id = look.id; this.study.t = 0; }
      this.study.t += dt;
      this.hud.study(this.study.t / 2.6);
      if (this.study.t >= 2.6) { c.studied.push(look.kind); this.hud.analysis(`${t('cb.fa.title')} · ${t(`cb.c.${look.kind}`)}`, t(`cb.fa.${look.kind}`)); this.faT = 6; audio.tone(880, 0.1, 'sine', 0.08); audio.tone(1320, 0.16, 'sine', 0.06, 0.09); }
    } else { this.study.t = Math.max(0, this.study.t - dt * 2); this.hud.study(0); }
    if (this.faT > 0) { this.faT -= dt; if (this.faT <= 0) this.hud.analysis(null); }
    if (sim.enemies.some((e) => !e.dead && !e.gone && Math.hypot(e.x - p.x, e.z - p.z) < 26 && !c.studied.includes(e.kind))) this.hint('study');
  }

  // ---------------- test hooks ----------------
  /** Tests press the fight's keys by code (a headless browser has no pointer lock). */
  testKeys = false;
  /** Tests: hide everything the fight draws (bodies, effects, the bow and sling) to count what it adds. */
  testHideDraws(on: boolean) {
    for (const [, q] of this.views) q.v.root.visible = !on;
    this.fx.group.visible = !on; this.body.ranged.group.visible = !on;
    this.hud.root.style.display = on ? 'none' : '';
  }
  /** Recordings: the whole game in slow motion (1 is normal). */
  testSlow = 1;
  testHold(code: string, on: boolean) { this.testKeys = true; this.d.input.hold(code, on); }
  testTap(code: string) { this.testKeys = true; this.d.input.hold(code, true); this.tapUp.push(code); }
  /** Turn the view as a mouse would (pixels). */
  testLook(dx: number, dy: number) { this.d.input.lookDX += dx; this.d.input.lookDY += dy; }
  get cam() { const P = this.d.player; return { yaw: P.yaw, pitch: P.pitch, x: P.pos.x, y: P.pos.y, z: P.pos.z }; }
  debug() {
    const sim = this.sim, run = this.encounter;
    return {
      engaged: this.engaged, encounter: run?.id ?? null, phase: run?.phase ?? null, outcome: run?.outcome ?? null, ask: run?.ask?.id ?? null, tension: this.tensionUi.open,
      player: sim ? { weapon: sim.player.weapon, act: sim.player.act, hp: sim.player.hp, stamina: sim.player.stamina, down: sim.player.down, injuries: sim.player.injuries.map((i) => i.id), has: Object.keys(sim.player.has), x: sim.player.x, z: sim.player.z } : null,
      enemies: sim ? sim.enemies.filter((e) => !e.gone).map((e) => ({ id: e.id, kind: e.kind, state: e.state, hp: e.hp, x: e.x, z: e.z, aware: e.aware, dead: e.dead })) : [],
      views: this.views.size, stats: sim?.stats ?? null, markers: run?.markers ?? [],
    };
  }
  get run() { return this.encounter; }
  get activeSim() { return this.sim; }
}
