import * as THREE from 'three';
import { audio } from '../core/audio';
import { t } from '../i18n';
import type { SaveData } from '../core/save';
import type { World } from '../world/world';
import type { UI } from '../ui/ui';
import type { Player } from './player';
import type { Character } from '../characters/character';
import type { Action } from './story';
import type { Npcs } from './npcs';
import type { TechNode } from './tech/data';
import { LAKE } from '../world/terrain';
import { cover, type Beat, type Shot, type Who } from '../cinematic/cutscene';
import type { TensionResult, TensionSpec } from '../combat/sim/tension';
import { test, type Cond } from './branch';
import { ep2Loaded, ep2Ready } from './branch/episode2';
import { isDiscovered, recordDiscovery } from './tech/tech';

/** What Episode Two needs from the combat controller (src/combat/combat.ts). */
interface CombatLike {
  ensureAsked(go: () => void): void;
  startEncounter(id: 'night.defence', o: { story?: Record<string, boolean>; hour?: number }): Promise<{ result: string; flags: Record<string, unknown>; stats: { taken: number } }>;
}

const OOM = 'local' as Who;
const CHOSE = (d: string, o: string): Cond => ({ chose: [d, o] });
const TRUSTS = (n: number): Cond => ({ trust: 'oomsa', gte: n });
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });

/**
 * Episode Two, "Voices in the Wind" (levels 11 to 14; script and choices: the private story folder). The rest of the
 * Stone Age into the first pot, in the real order of INVENTION_TREE.md: cord from inner bark (row 10) and a snare with
 * it (14); the stranger at the snare; resin and charcoal glue for a hafted point (12); the bow drill after rain puts
 * the fire out (5), flint and pyrite from her people (6); an old rock shelter with flakes like his and ochre hands, and
 * a cairn for no one (18); tempered clay pots and a pit firing (Age 2), the predator's return on the firing night, and
 * the pot that rings at dawn. The making itself is the craft panel (its fails are real ways to fail, each with a line);
 * the scenes round it are here. All progress is flags on the save (`e2.*`), so a reload goes on from the last beat.
 */
export class Episode2 {
  /** Set by the game: extra people a scene can cut to (Oom-Sa). */
  actors: Record<string, Character> = {};
  private group = new THREE.Group();
  private snare: THREE.Group | null = null;
  private shelterSite: { at: THREE.Vector3; facing: number; wall: THREE.Vector3; cairn: THREE.Vector3 } | null = null;
  private pots: THREE.Mesh[] = [];
  private wait = 6;
  private busy = false;
  private hurtLines = 0;

  constructor(
    private world: World,
    private player: Player,
    private ui: UI,
    private npcs: Npcs,
    private getSave: () => SaveData,
    private playScene: (beats: Beat[], then?: () => void) => void,
    private after: (sec: number, fn: () => void) => void,
    private tension: (spec: TensionSpec) => Promise<TensionResult> | null,
    private combat: () => CombatLike | null,
    /** The game is in plain play, nothing over it (no panel, film, fight). */
    private free: () => boolean,
    /** Record a discovery and show its card, then `then` (the game's own path for the craft panel). */
    private discover: (id: string, then: () => void) => void,
  ) {
    this.group.name = 'ep2';
    world.scene.add(this.group);
    void ep2Ready;
  }

  private get s() { return this.getSave(); }
  private get z() { return this.player.model; }
  private get L() { return this.world.layout; }
  private f(k: string) { return !!this.s.flags[k]; }
  private set(k: string, v = true) { this.s.flags[k] = v; }
  private inv(k: string) { return this.s.inventory[k] ?? 0; }
  private trust() { return this.s.branch?.trust?.['oomsa>scientist'] ?? 0; }
  private h(x: number, z: number) { return this.world.terrain.height(x, z); }
  private oom() { return this.npcs.figure('local'); }

  /** Levels 11 to 14 are this episode's. */
  owns(n: number) { return n >= 11 && n <= 14; }

  /** The story beats a level needs besides its discovery (the craft panel's). */
  done(n: number): boolean {
    const d = (id: string) => isDiscovered(this.s, id);
    switch (n) {
      case 11: return d('cordage') && this.f('e2.voiceDone');
      case 12: return d('haft') && this.f('e2.met');
      case 13: return d('fire') && this.f('e2.cairnDone');
      case 14: return this.f('e2.done');
    }
    return false;
  }

  /** May the craft panel for this level open yet? (each one comes after its scene) */
  craftOpen(n: number) {
    switch (n) {
      case 11: return this.f('e2.l11.intro');
      case 12: return this.f('e2.met');
      case 13: return this.f('e2.l13.intro');
      case 14: return this.f('e2.l14.intro') && !this.f('e2.potsMade');
    }
    return true;
  }

  /** Objective line while a story beat (not a material) is what's next; null leaves it to the chapter. */
  progress(n: number): string | null {
    const d = (id: string) => isDiscovered(this.s, id);
    if (n === 11 && d('cordage') && !this.f('e2.snareSet')) return t('e2.obj.snare');
    if (n === 11 && this.f('e2.snareSet') && !this.f('e2.voiceDone')) return t('e2.obj.dusk');
    if (n === 12 && !this.f('e2.met')) return t('e2.obj.check');
    if (n === 13 && d('fire') && !this.f('e2.cairnDone')) return t('e2.obj.shelter');
    if (n === 14 && this.f('e2.potsMade')) return t('e2.obj.fire');
    return null;
  }

  marker(n: number): THREE.Vector3 | null {
    const d = (id: string) => isDiscovered(this.s, id);
    if (n === 11 && d('cordage') && !this.f('e2.snareSet')) return this.L.camp;
    if (n === 12 && !this.f('e2.met')) return this.snareAt();
    if (n === 13 && d('fire') && !this.f('e2.cairnDone')) return this.shelter().at;
    if (n === 14 && this.f('e2.potsMade')) return this.L.camp;
    return null;
  }

  actions(): Action[] {
    const s = this.s, out: Action[] = [];
    if (s.level === 11 && isDiscovered(s, 'cordage') && !this.f('e2.snareSet')) {
      out.push({ id: 'e2-snare', pos: this.L.camp, radius: 3, label: t('e2.act.snare'), run: () => this.snareScene() });
    }
    return out;
  }

  /** The legacy Skyvra-at-camp projection stays out of this episode's scenes (six worlds; DECISIONS E2-2). */
  hidesExplorer() { return this.owns(this.s.level); }

  // ------------------------------------------------------------------ the world, each frame
  update(dt: number) {
    const s = this.s;
    if (!this.owns(s.level)) return;
    this.restore();
    if (this.world.explorer.root.visible) this.world.explorer.root.visible = false;
    this.wait -= dt;
    if (this.wait > 0 || this.busy || !ep2Loaded() || !this.free()) return;
    const p = this.player.pos;
    if (s.level === 11 && !this.f('e2.l11.intro')) { this.intro11(); return; }
    if (s.level === 11 && this.f('e2.snareSet') && !this.f('e2.voiceDone')) { this.voiceScene(); return; }
    if (s.level === 12 && !this.f('e2.met') && this.f('e2.snareSet')) {
      const a = this.snareAt(); if (Math.hypot(p.x - a.x, p.z - a.z) < 3.2) { this.strangerScene(); return; }
    }
    if (s.level === 12 && this.f('e2.met') && !this.f('e2.l12.glue')) { this.glueLines(); return; }
    if (s.level === 13 && !this.f('e2.l13.intro')) { this.intro13(); return; }
    if (s.level === 13 && isDiscovered(s, 'fire') && !this.f('e2.pyriteDone') && test(s, TRUSTS(2)) && !this.f('e2.oomsa.away')) { this.pyriteScene(); return; }
    if (s.level === 13 && isDiscovered(s, 'fire') && !this.f('e2.cairnDone')) {
      const a = this.shelter().at; if (Math.hypot(p.x - a.x, p.z - a.z) < 4) { this.shelterScene(); return; }
    }
    if (s.level === 14 && !this.f('e2.l14.intro')) { this.intro14(); return; }
    if (s.level === 14 && this.f('e2.potsMade') && !this.f('e2.nightDone')) { this.night(); return; }
    if (s.level === 14 && this.f('e2.nightDone') && !this.f('e2.done')) { this.dawn(); return; }
  }

  /** Props that belong to what has happened (after a reload too). */
  private restored = -1;
  private restore() {
    const key = (this.f('e2.snareSet') ? 1 : 0) + (this.f('e2.cairnDone') ? 2 : 0) + (this.f('e2.potsMade') && !this.f('e2.done') ? 4 : 0) + (this.s.level >= 13 ? 8 : 0);
    if (key === this.restored) return;
    this.restored = key;
    if (this.f('e2.snareSet') && !this.snare) this.buildSnare();
    if (this.s.level >= 13) this.buildShelter();
    if (this.f('e2.cairnDone')) this.buildCairn(true);
    if (this.f('e2.potsMade') && !this.f('e2.done') && !this.pots.length) this.buildPots();
  }

  // ------------------------------------------------------------------ helpers: where he is, how he kneels
  /** Face `target` from `at` (Player.facing points away from where he looks). */
  private settle(at: THREE.Vector3, target: THREE.Vector3, kneel: boolean, sit = false) {
    const p = this.player, d = at.clone().sub(target).setY(0);
    const facing = Math.atan2(d.x, d.z);
    const g = at.clone(); g.y = this.h(g.x, g.z);
    p.pos.copy(g); p.vel.set(0, 0, 0); p.facing = facing;
    p.model.root.position.copy(g); p.model.root.rotation.y = facing + Math.PI; p.model.root.updateMatrixWorld(true);
    this.z.setKneel(kneel, sit);
    return g;
  }
  /** Kneeling to work beside the fire, side-on to it (facing along the ring, the fire at his shoulder): a camera in
   * front of him then never looks across the fire (the cutscene falls back to another shot when the camp blocks it). */
  private settleWork(dist: number) {
    const c = this.L.camp, at = this.byFire(dist), d = at.clone().sub(c).setY(0).normalize(), tan = v3(-d.z, 0, d.x);
    return this.settle(at, at.clone().addScaledVector(tan, 2), true, true);
  }
  private fwd() { const r = this.z.root.rotation.y; return v3(Math.sin(r), 0, Math.cos(r)); }
  private right(f: THREE.Vector3) { return v3(f.z, 0, -f.x); }
  private head() { return new THREE.Vector3().setFromMatrixPosition(this.z.head.matrixWorld); }
  /** A spot `dist` from the camp fire, on the side towards `towards`. */
  private byFire(dist: number, towards?: THREE.Vector3) {
    const c = this.L.camp, d = (towards ?? this.player.pos).clone().sub(c).setY(0);
    if (d.lengthSq() < 0.01) d.set(0, 0, 1);
    const at = c.clone().addScaledVector(d.normalize(), dist); at.y = this.h(at.x, at.z);
    return at;
  }
  /** Low and close on what his hands do at `at`, from his right and in front, his face at the top of frame. */
  private handShot(at: THREE.Vector3, dist = 0.9, side = 1): Shot {
    const f = this.fwd(), r = this.right(f).multiplyScalar(side), hd = this.head();
    // the side away from the fire
    if (r.dot(at.clone().sub(this.L.camp)) < 0) r.negate();
    return { from: at.clone().addScaledVector(f, dist * 0.9).addScaledVector(r, dist * 0.7).add(v3(0, 0.35 + dist * 0.2, 0)), to: at.clone().lerp(hd, 0.35), push: 0.02, aperture: 0.004 };
  }
  private wide(at: THREE.Vector3, dist = 6, side = 0.6, up = 1.2): Shot {
    const f = this.fwd(), r = this.right(f);
    return { from: at.clone().addScaledVector(f, dist).addScaledVector(r, dist * side).add(v3(0, up, 0)), to: at.clone().add(v3(0, 0.7, 0)), push: 0.04 };
  }
  private say(key: string, who: Who = 'scientist', sec = 4) { this.ui.say(key, who === 'megazron' ? 'mz.name' : `crew.${who}.name`, sec); }
  private mesh(g: THREE.BufferGeometry, m: THREE.Material, at: THREE.Vector3, parent: THREE.Object3D = this.group) {
    const o = new THREE.Mesh(g, m); o.position.copy(at); o.castShadow = true; parent.add(o); return o;
  }
  /** Run `fn(k)` every frame for `sec` seconds (k = seconds in). */
  private anim(sec: number, fn: (k: number) => void) {
    const t0 = performance.now();
    const step = () => { const k = (performance.now() - t0) / 1000; fn(Math.min(k, sec)); if (k < sec) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  private scene(beats: Beat[], then?: () => void) {
    this.busy = true;
    this.playScene(beats, () => { this.busy = false; this.wait = 1.2; then?.(); });
  }
  /** A fade to black, a jump in the world's time (and day), back in. */
  private passTime(hour: number, nextDay: boolean, card: string | null, then: () => void) {
    this.busy = true;
    this.ui.fade('black', 1, 0.9);
    this.after(1.0, () => {
      if (nextDay) this.s.day = (this.s.day ?? 1) + 1;
      this.s.timeOfDay = hour;
      if (card) this.ui.banner(t(card, { n: this.s.day }), '');
      this.after(0.6, () => { this.ui.fade('black', 0, 1.4); this.busy = false; then(); });
    });
  }
  private clearHands() { const z = this.z; z.setHold(null); z.setProp(null); z.setLookTarget(null); z.setFace(null); z.setLimbs(null); z.setKneel(false); }

  // ------------------------------------------------------------------ 2.1 the vine snaps (level 11)
  private intro11() {
    const s = this.s;
    // the flake from Episode One is a discovery of its own (the old chapter's first level made it at camp)
    recordDiscovery(s, 'knapping');
    this.set('ch2Intro');
    this.set('e2.l11.intro');
    this.busy = true;
    this.passTime(7.4, true, 'e2.day', () => {
      this.ui.banner(t('e2.title'), t('e2.sub'));
      const z = this.z, at = this.settleWork(1.6);
      const f = this.fwd(), r = this.right(f);
      // the dried vine from the first night, held in both hands in front of him; it parts in the middle
      const mid = at.clone().addScaledVector(f, 0.36).add(v3(0, 0.52, 0));
      const vm = std(0x5c6a2a, { roughness: 0.7 });
      const g = new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6); g.rotateZ(Math.PI / 2);
      const a = this.mesh(g, vm, mid.clone().addScaledVector(r, -0.1)), b = this.mesh(g, vm, mid.clone().addScaledVector(r, 0.1));
      a.rotation.y = b.rotation.y = z.root.rotation.y;
      let apart = 0;
      const grip = () => {
        const pa = mid.clone().addScaledVector(r, -0.2 - apart), pb = mid.clone().addScaledVector(r, 0.2 + apart);
        a.position.copy(mid).addScaledVector(r, -0.1 - apart * 0.6); b.position.copy(mid).addScaledVector(r, 0.1 + apart * 0.6);
        z.setHold({ L: { at: pa, fingers: f.clone(), palm: r.clone(), radius: 0.008, grasp: true }, R: { at: pb, fingers: f.clone(), palm: r.clone().negate(), radius: 0.008, grasp: true } });
      };
      grip();
      this.scene([
        { hold: 3.2, shot: () => this.wide(at, 6.5, 0.5, 1.0), run: () => { z.setLookTarget(mid); z.setLimbs({ bend: 0.3 }); } },
        { key: 'e2.vn.1', who: 'scientist', shot: () => this.handShot(mid, 0.75), run: () => {
          this.after(0.5, () => { audio.sample('wood', 0.5, { rate: 1.7 }); this.anim(0.4, (k) => { apart = k * 0.15; grip(); }); });
        }, after: 0.4 },
        { key: 'e2.vn.2', who: 'scientist', shot: () => cover.close(z, 0.4, 0.95), run: () => z.setFace({ frown: 0.3, squint: 0.2 }) },
        { hold: 6.5, shot: () => cover.mid(z, -0.6, 2.2), run: () => { z.setFace(null); z.setLookTarget(mid.clone().add(v3(0, -0.2, 0))); this.ui.memory('e2.vn.lyrra', 8); } },
      ], () => { a.removeFromParent(); b.removeFromParent(); this.clearHands(); this.ui.toast(t('level.11.hint')); });
    });
  }

  // ------------------------------------------------------------------ the craft panel's scenes
  /** Before a panel opens: the work in his hands. Returns false when the panel should open at once. */
  beforeCraft(n: TechNode, open: () => void): boolean {
    if (!this.owns(this.s.level)) return false;
    if (n.id === 'cordage') { this.workScene('bark', open); return true; }
    if (n.id === 'haft') { this.workScene('resin', open); return true; }
    if (n.id === 'fire') { this.workScene('bow', open); return true; }
    if (n.id === 'pottery') { this.workScene('clay', open); return true; }
    return false;
  }

  /** A failed try in the panel: the real reason, out loud (the panel stays open for the next try). */
  craftFailed(id: string, step: number): boolean {
    if (!this.owns(this.s.level)) return false;
    const n = this.hurtLines++;
    const line: Record<string, string> = {
      cordage: 'e2.cd.fail',
      haft: step === 0 ? 'e2.hf.burn' : 'e2.hf.crack',
      fire: n % 2 ? 'e2.bd.jump' : 'e2.bd.slip',
      pottery: 'e2.cl.crack',
    };
    if (!line[id]) return false;
    this.set(`e2.failed.${id}`);
    this.say(line[id], 'scientist', 4.5);
    return true;
  }

  /** The panel finished well: his line with the thing made, then the card. True if the card waits for the story. */
  crafted(n: TechNode, card: () => void): boolean {
    if (!this.owns(this.s.level)) return false;
    const z = this.z;
    if (n.id === 'cordage') {
      const at = this.settleWork(1.6), f = this.fwd(), r = this.right(f);
      const mid = at.clone().addScaledVector(f, 0.34).add(v3(0, 0.58, 0));
      const cord = this.cordBetween(mid.clone().addScaledVector(r, -0.22), mid.clone().addScaledVector(r, 0.22));
      z.setHold({ L: { at: mid.clone().addScaledVector(r, -0.25), fingers: f.clone(), palm: r.clone(), radius: 0.01, grasp: true }, R: { at: mid.clone().addScaledVector(r, 0.25), fingers: f.clone(), palm: r.clone().negate(), radius: 0.01, grasp: true } });
      this.scene([
        { key: 'e2.cd.fix', who: 'scientist', if: { not: { flag: 'e2.failed.cordage' } }, shot: () => this.handShot(mid, 0.8) },
        { key: 'e2.cd.ok', who: 'scientist', shot: () => cover.mid(z, 0.5, 1.8), run: () => { z.setLookTarget(mid); this.after(0.3, () => audio.sample('wood', 0.2, { rate: 2 })); } },
      ], () => { cord.removeFromParent(); this.clearHands(); this.set('inv.cordage'); this.ui.toast(t('e2.learn.cordage')); card(); });
      return true;
    }
    if (n.id === 'haft') {
      const at = this.settleWork(2.3), f = this.fwd(), r = this.right(f);
      z.setKneel(false);
      const log = this.mesh(new THREE.CylinderGeometry(0.16, 0.18, 1.2, 9).rotateZ(Math.PI / 2), std(0x4d3a2a), at.clone().addScaledVector(f, 1.2).add(v3(0, 0.16, 0)));
      log.rotation.y = z.root.rotation.y + Math.PI / 2;
      const grip = at.clone().addScaledVector(f, 0.35).addScaledVector(r, 0.18).add(v3(0, 1.0, 0));
      this.scene([
        { hold: 1.6, shot: () => this.wide(at, 3.2, 0.7, 0.6), run: () => {
          z.setProp('throwstick'); z.setLookTarget(log.position);
          z.setHold({ R: { at: grip, fingers: f.clone().add(v3(0, -0.3, 0)).normalize(), palm: r.clone().negate(), radius: 0.016, grasp: true } });
          this.after(0.9, () => { z.setHold({ R: { at: grip.clone().addScaledVector(f, 0.35).add(v3(0, -0.45, 0)), fingers: f.clone().add(v3(0, -0.8, 0)).normalize(), palm: r.clone().negate(), radius: 0.016, grasp: true } }); audio.sample('cb_crack', 0.35); });
        } },
        { key: 'e2.hf.ok', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0), run: () => z.setFace({ smile: 0.25 }) },
      ], () => { log.removeFromParent(); this.clearHands(); this.set('inv.haft'); this.ui.toast(t('e2.learn.haft')); card(); });
      return true;
    }
    if (n.id === 'fire') {
      this.set('e1.fireOut', false); this.world.camp.setFire(2);
      const at = this.settleWork(1.6);
      this.scene([
        { hold: 2.2, shot: () => this.wide(at, 3.2, 0.9, 0.4), run: () => { z.setLookTarget(this.L.camp.clone().add(v3(0, 0.2, 0))); audio.sample('amb_fire', 0.4, { dur: 3 }); } },
        { key: 'e2.bd.ok', who: 'scientist', shot: () => cover.close(z, -0.35, 0.95), run: () => z.setFace({ smile: 0.35 }) },
      ], () => { this.clearHands(); this.set('inv.bowDrill'); this.ui.toast(t('e2.learn.bowDrill')); void at; card(); });
      return true;
    }
    if (n.id === 'pottery') {
      // the pots are made; the card waits for the morning they come out of the fire
      this.set('e2.potsMade');
      this.buildPots();
      const c = this.L.camp, d = v3(1, 0, 0.4).normalize(), at = this.settle(c.clone().addScaledVector(d, 1.85), c.clone().addScaledVector(d, 1.15), true, true);
      const row = this.pots[1].position.clone();
      this.scene([
        { key: 'e2.cl.ok', who: 'scientist', shot: () => ({ from: row.clone().addScaledVector(this.fwd(), -0.9).add(v3(0, 0.18, 0)).addScaledVector(this.right(this.fwd()), 0.25), to: row.clone().lerp(this.head(), 0.25), push: 0.02, aperture: 0.004 }), run: () => z.setLookTarget(row) },
      ], () => { this.clearHands(); void at; });
      return true;
    }
    return false;
  }

  /** The work before the panel: bark into strands, resin on a warm stone, the bow drill set up, clay into coils. */
  private workScene(kind: 'bark' | 'resin' | 'bow' | 'clay', open: () => void) {
    const z = this.z, at = this.settleWork(1.6), f = this.fwd(), r = this.right(f);
    const work = at.clone().addScaledVector(f, 0.42); work.y = this.h(work.x, work.z);
    const made: THREE.Object3D[] = [];
    const keep = <T extends THREE.Object3D>(o: T) => { made.push(o); return o; };
    const beats: Beat[] = [];
    if (kind === 'bark') {
      // a pale strip of inner bark across his left palm; the right thumb splits it thin along the grain
      const strip = keep(this.mesh(new THREE.BoxGeometry(0.34, 0.004, 0.03), std(0xc9b48a), work.clone().add(v3(0, 0.5, 0))));
      strip.rotation.y = z.root.rotation.y + Math.PI / 2;
      const a = work.clone().add(v3(0, 0.5, 0)).addScaledVector(r, -0.15), b = work.clone().add(v3(0, 0.5, 0)).addScaledVector(r, 0.12);
      z.setHold({ L: { at: a, fingers: r.clone(), palm: UP.clone(), radius: 0.004, grasp: true }, R: { at: b, fingers: r.clone().negate(), palm: UP.clone().negate(), radius: 0.004, grasp: true } });
      beats.push({ key: 'e2.bk.1', who: 'scientist', shot: () => this.handShot(work.clone().add(v3(0, 0.5, 0)), 0.7), run: () => {
        z.setLookTarget(strip.position);
        this.anim(2.5, (k) => { const w = Math.sin(k * 3) * 0.06; z.setHold({ L: { at: a, fingers: r.clone(), palm: UP.clone(), radius: 0.004, grasp: true }, R: { at: b.clone().addScaledVector(r, w), fingers: r.clone().negate(), palm: UP.clone().negate(), radius: 0.004, grasp: true } }); });
      } });
    } else if (kind === 'resin') {
      // a flat stone at the fire's edge, amber resin softening on it; he stirs in crushed charcoal with a twig
      const stone = keep(this.mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.04, 9), std(0x6d6a66), work.clone().add(v3(0, 0.02, 0))));
      const resin = keep(this.mesh(new THREE.SphereGeometry(0.045, 10, 7), std(0xd88a1c, { roughness: 0.15, emissive: 0x4a2000 }), stone.position.clone().add(v3(0, 0.03, 0))));
      resin.scale.set(1, 0.5, 1);
      const twig = keep(this.mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.24, 5), std(0x5a4334), resin.position.clone().add(v3(0, 0.12, 0))));
      beats.push({ hold: 3.2, shot: () => this.handShot(resin.position, 0.65), run: () => {
        z.setLookTarget(resin.position);
        this.anim(3.2, (k) => {
          const tip = resin.position.clone().add(v3(Math.cos(k * 4) * 0.025, 0.01, Math.sin(k * 4) * 0.025));
          const top = tip.clone().add(v3(0, 0.22, 0)).addScaledVector(f, -0.05);
          twig.position.copy(tip.clone().lerp(top, 0.5)); twig.quaternion.setFromUnitVectors(UP, top.clone().sub(tip).normalize());
          z.setHold({ R: { at: top, fingers: tip.clone().sub(top).normalize(), palm: r.clone().negate(), radius: 0.004, grasp: true } });
          resin.material instanceof THREE.MeshStandardMaterial && resin.material.color.setHex(k > 1.6 ? 0x2a2420 : 0xd88a1c);
          resin.scale.set(1 + k * 0.08, 0.5 - k * 0.05, 1 + k * 0.08);
        });
      } });
    } else if (kind === 'bow') {
      // the hearth board under his left knee, the spindle upright in its notch, the socket stone in his left hand on
      // top, the bow in his right, its cord looped once round the spindle; long strokes, the spindle turns
      const board = keep(this.mesh(new THREE.BoxGeometry(0.34, 0.02, 0.07), std(0x9a7a52), work.clone().add(v3(0, 0.01, 0))));
      board.rotation.y = z.root.rotation.y + Math.PI / 2;
      const notch = work.clone().add(v3(0, 0.02, 0));
      const sg = new THREE.CylinderGeometry(0.009, 0.01, 0.3, 8); sg.translate(0, 0.15, 0);
      const spindle = keep(this.mesh(sg, std(0xb08a5c), notch));
      const top = notch.clone().add(v3(0, 0.3, 0));
      const sock = keep(this.mesh(new THREE.SphereGeometry(0.035, 9, 7), std(0x7b766e), top.clone().add(v3(0, 0.02, 0)))); sock.scale.set(1, 0.6, 1);
      const bowG = new THREE.TorusGeometry(0.3, 0.008, 5, 18, Math.PI * 0.55);
      const bow = keep(this.mesh(bowG, std(0x6a4c30), notch.clone().add(v3(0, 0.15, 0))));
      const cordM = keep(this.mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.5, 4).rotateZ(Math.PI / 2), std(0xc8b48a), notch.clone().add(v3(0, 0.14, 0))));
      beats.push({ hold: 3.8, shot: () => this.handShot(notch.clone().add(v3(0, 0.12, 0)), 0.85, -1), run: () => {
        z.setLookTarget(notch);
        this.anim(3.8, (k) => {
          const w = Math.sin(k * 5.5) * 0.18, hand = notch.clone().add(v3(0, 0.14, 0)).addScaledVector(r, 0.2 + w).addScaledVector(f, -0.02);
          bow.position.copy(hand.clone().addScaledVector(r, -0.15)); bow.rotation.set(0, z.root.rotation.y, Math.PI * 0.72);
          cordM.position.copy(hand.clone().addScaledVector(r, -0.22)); cordM.rotation.y = z.root.rotation.y;
          spindle.rotation.y = k * 20;
          z.setHold({ L: { at: top.clone().add(v3(0, 0.05, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03, grasp: true }, R: { at: hand, fingers: r.clone().negate(), palm: f.clone().negate(), radius: 0.008, grasp: true } });
          if (Math.random() < 0.05) audio.sample('wood', 0.12, { rate: 1.6 });
        });
      } });
      beats.push({ key: 'e2.bd.2', who: 'scientist', shot: () => cover.mid(z, 0.6, 2.0) });
    } else {
      // a lump of tempered clay on a flat stone; coils laid ring on ring, the wall rising between his hands
      const pts = [v3(0.0, 0), v3(0.075, 0), v3(0.09, 0.04), v3(0.095, 0.1), v3(0.085, 0.16), v3(0.07, 0.2), v3(0.075, 0.22)].map((p) => new THREE.Vector2(p.x, p.y));
      const pot = keep(this.mesh(new THREE.LatheGeometry(pts, 18), std(0x8e5a3e, { side: THREE.DoubleSide, roughness: 0.7 }), work.clone().add(v3(0, 0.01, 0))));
      pot.scale.set(1, 0.1, 1);
      beats.push({ hold: 4, shot: () => this.handShot(pot.position.clone().add(v3(0, 0.1, 0)), 0.7), run: () => {
        z.setLookTarget(pot.position);
        this.anim(4, (k) => {
          const hgt = Math.min(1, 0.1 + k / 3.6); pot.scale.set(1, hgt, 1);
          const y = 0.03 + 0.2 * hgt, c = pot.position.clone().add(v3(0, y, 0));
          z.setHold({ L: { at: c.clone().addScaledVector(r, -0.1), fingers: f.clone(), palm: r.clone(), radius: 0.01 }, R: { at: c.clone().addScaledVector(r, 0.1).addScaledVector(f, Math.sin(k * 6) * 0.02), fingers: f.clone(), palm: r.clone().negate(), radius: 0.01 } });
        });
      } });
    }
    this.scene(beats, () => { for (const o of made) o.removeFromParent(); this.clearHands(); open(); });
  }

  /** A two-ply cord between two points (a twisted pair of thin strands). */
  private cordBetween(a: THREE.Vector3, b: THREE.Vector3) {
    const g = new THREE.Group(), d = b.clone().sub(a), len = d.length(), m = std(0xc8b48a, { roughness: 0.9 });
    for (const ph of [0, Math.PI]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 40; i++) { const u = i / 40, w = u * len * 55 + ph; pts.push(v3(u * len, Math.cos(w) * 0.0022, Math.sin(w) * 0.0022)); }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.0022, 4), m));
    }
    g.position.copy(a); g.quaternion.setFromUnitVectors(v3(1, 0, 0), d.normalize());
    this.group.add(g);
    return g;
  }

  // ------------------------------------------------------------------ the snare (level 11) and the voice (2.2)
  /** Where the snare is set: on the game trail by camp, or down by the stream (the choice). Deterministic. */
  snareAt() {
    const c = this.L.camp, far = this.f('e2.snare.far');
    const toLake = v3(LAKE.x - c.x, 0, LAKE.z - c.z).normalize(), side = this.right(toLake);
    const at = far ? c.clone().addScaledVector(toLake, 30).addScaledVector(side, 8) : c.clone().addScaledVector(side, -10).addScaledVector(toLake, 3);
    at.y = this.h(at.x, at.z);
    return at;
  }
  private buildSnare() {
    const at = this.snareAt(), g = new THREE.Group();
    // a springy sapling bent over the trail, a cord noose hanging from its tip at head height of something small
    const pts = [v3(0, 0, 0), v3(0.1, 0.7, 0), v3(0.45, 1.05, 0), v3(0.85, 0.75, 0)];
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.014, 5), std(0x5a4a2c)));
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.5, 4), std(0xc8b48a)); cord.position.set(0.85, 0.5, 0); g.add(cord);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.003, 4, 16), std(0xc8b48a)); loop.position.set(0.85, 0.2, 0); loop.rotation.y = Math.PI / 2; g.add(loop);
    g.position.copy(at); g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    this.group.add(g); this.snare = g;
  }
  private snareScene() {
    const z = this.z, c = this.L.camp, toLake = v3(LAKE.x - c.x, 0, LAKE.z - c.z).normalize();
    const at = this.settle(this.byFire(2.6, c.clone().add(toLake)), c.clone().addScaledVector(toLake, 9), false);
    this.scene([
      { hold: 2.6, shot: () => cover.mid(z, -0.7, 2.6), run: () => z.setLookTarget(c.clone().addScaledVector(toLake, 9).add(v3(0, 0.4, 0))) },
      { choice: 'e2.snare', shot: () => cover.mid(z, 0.6, 2.2) },
      { key: 'e2.sn.near', who: 'scientist', if: CHOSE('e2.snare', 'near'), shot: () => cover.close(z, 0.4, 1.0) },
      { key: 'e2.sn.far', who: 'scientist', if: CHOSE('e2.snare', 'far'), shot: () => cover.close(z, 0.4, 1.0) },
    ], () => {
      this.set('e2.snareSet'); this.buildSnare();
      const s = this.snareAt(); void at;
      this.passTime(19.0, false, null, () => { this.player.spawn(s.x + 1.2, s.z + 0.6, 0); this.wait = 0.5; });
    });
  }

  private voiceScene() {
    const z = this.z, ridge = this.L.ridge, s = this.s;
    const at = this.settle(this.byFire(3.2, ridge), ridge, false);
    const look = ridge.clone().add(v3(0, 8, 0));
    this.scene([
      { hold: 3, shot: () => this.wide(at, 7, -0.5, 0.4), run: () => { s.timeOfDay = Math.max(s.timeOfDay, 19.0); z.setLookTarget(this.L.camp); } },
      { key: 'e2.vo.call', shot: () => cover.close(z, 0.9, 1.1), run: () => { z.setGazeRate(5); z.setLookTarget(look); audio.sample('amb_wind', 0.5, { dur: 4 }); } },
      { hold: 1.8, shot: () => ({ from: this.head().add(v3(0, 0.05, 0)), to: look, push: 0.03 }) },
      { key: 'e2.vo.1', who: 'scientist', shot: () => cover.close(z, 0.4, 0.95), run: () => z.setFace({ squint: 0.35, frown: 0.2 }) },
      { key: 'e2.vo.2', who: 'scientist', shot: () => cover.close(z, -0.4, 1.0) },
      { choice: 'e2.voice', shot: () => cover.mid(z, 0.5, 2.2) },
      // go: up into the dusk with a burning branch; nobody; small prints and a cut reed
      { hold: 2.4, if: CHOSE('e2.voice', 'go'), shot: () => this.wide(at, 5, 0.3, 1.6), run: () => { z.setFace(null); this.ui.fade('black', 1, 0.6); this.after(0.8, () => { this.ridgeFind(); this.ui.fade('black', 0, 0.8); }); } },
      { key: 'e2.vo.go.2', who: 'scientist', if: CHOSE('e2.voice', 'go'), shot: () => this.whistleShot() },
      { key: 'e2.vo.shout.1', who: 'scientist', if: CHOSE('e2.voice', 'shout'), shot: () => cover.close(z, 0.5, 1.1) },
      { key: 'e2.vo.shout.2', if: CHOSE('e2.voice', 'shout'), hold: 2.2, shot: () => ({ from: this.head().add(v3(0, 0.05, 0)), to: look, push: 0.02 }) },
      { key: 'e2.vo.shout.3', who: 'scientist', if: CHOSE('e2.voice', 'shout'), shot: () => cover.close(z, -0.3, 0.9), run: () => z.setFace({ frown: 0.35 }) },
      { key: 'e2.vo.stay.2', who: 'scientist', if: CHOSE('e2.voice', 'stay'), shot: () => cover.mid(z, 0.7, 2.4), run: () => { const p = this.settle(this.byFire(1.4, ridge), this.L.camp, true, true); void p; z.setLookTarget(this.L.camp); } },
      { key: 'e2.vo.high', who: 'scientist', if: { flag: 'fire.high' }, shot: () => cover.close(z, 0.3, 1.0) },
    ], () => {
      z.setGazeRate(null); this.clearHands(); this.whistle?.removeFromParent();
      this.set('e2.voiceDone');
      this.passTime(7.2, true, 'e2.day', () => {
        const a = this.byFire(2.4); this.player.spawn(a.x, a.z, 0);
        if (this.f('e2.cold')) this.ui.toast(t('e2.cold'));
      });
    });
  }
  private whistle: THREE.Group | null = null;
  private ridgeFind() {
    const r = this.L.ridge, at = this.settle(r.clone().add(v3(1.5, 0, 1)), r, true);
    const g = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), std(0x7a746c)); rock.scale.set(1.2, 0.6, 1); rock.position.y = 0.12; g.add(rock);
    const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.16, 7), std(0xb8a860)); reed.rotation.z = Math.PI / 2; reed.position.set(0, 0.3, 0); g.add(reed);
    for (let i = 0; i < 3; i++) { const pr = new THREE.Mesh(new THREE.CircleGeometry(0.04, 3), new THREE.MeshBasicMaterial({ color: 0x2a2018 })); pr.rotation.x = -Math.PI / 2; pr.position.set(-0.4 - i * 0.22, 0.01, (i % 2) * 0.12); g.add(pr); }
    g.position.copy(r); g.position.y = this.h(r.x, r.z);
    this.group.add(g); this.whistle = g;
    this.z.setLookTarget(g.position.clone().add(v3(0, 0.3, 0)));
    void at;
  }
  private whistleShot(): Shot {
    const w = this.whistle?.position ?? this.L.ridge;
    return { from: w.clone().add(v3(0.55, 0.45, 0.45)), to: w.clone().add(v3(0, 0.3, 0)), push: 0.02, aperture: 0.005 };
  }

  // ------------------------------------------------------------------ 2.3 someone at the snare (level 12)
  private strangerScene() {
    const z = this.z, at = this.snareAt(), oom = this.oom();
    if (!oom) { this.set('e2.met'); return; }
    this.actors[OOM] = oom;
    const noose = at.clone().add(v3(0.85, 0.2, 0));
    // she crouches at the noose; a nibbet lies in it
    const her = at.clone().add(v3(0.85, 0, 0.55)); her.y = this.h(her.x, her.z);
    this.npcs.pin('local', her, Math.atan2(noose.x - her.x, noose.z - her.z));
    oom.setKneel(true);
    const prey = this.mesh(new THREE.CapsuleGeometry(0.06, 0.12, 3, 8), std(0x8a8478), noose.clone().add(v3(0, -0.14, 0)));
    prey.rotation.z = Math.PI / 2;
    const me = this.settle(her.clone().add(v3(-1.9, 0, -0.9)), her, false);
    const meet = () => { oom.setKneel(false); this.npcs.pin('local', her, Math.atan2(me.x - her.x, me.z - her.z)); oom.setLookTarget(this.head()); };
    this.scene([
      { hold: 3, shot: () => ({ from: me.clone().addScaledVector(this.fwd(), -1.6).add(v3(0.4, 1.7, 0)), to: her.clone().add(v3(0, 0.6, 0)), push: 0.05 }), run: () => { z.setLookTarget(her.clone().add(v3(0, 0.6, 0))); oom.setHold({ R: { at: noose, fingers: v3(0, -1, 0), palm: v3(1, 0, 0), radius: 0.006, grasp: true } }); } },
      { hold: 2, shot: () => ({ from: noose.clone().add(v3(0.4, 0.25, 0.35)), to: noose.clone(), push: 0.01, aperture: 0.005 }) },
      { key: 'e2.st.1', who: OOM, if: { flag: 'e2.called' }, shot: () => cover.close(oom, 0.4, 1.0), run: () => { oom.setHold(null); meet(); } },
      { key: 'e2.st.1b', who: OOM, if: { not: { flag: 'e2.called' } }, shot: () => cover.close(oom, 0.4, 1.0), run: () => { oom.setHold(null); meet(); } },
      { key: 'e2.st.2', who: 'scientist', shot: () => cover.ots(z, oom, 0.5) },
      { key: 'e2.st.3', who: OOM, shot: () => cover.ots(oom, z, -0.5) },
      { key: 'e2.st.3h', who: OOM, if: { flag: 'fire.high' }, shot: () => cover.close(oom, -0.3, 1.0) },
      { choice: 'e2.stranger', shot: () => cover.two(z, oom, 3) },
      { key: 'e2.st.give.1', who: 'scientist', if: CHOSE('e2.stranger', 'give'), shot: () => cover.ots(z, oom, 0.5) },
      { key: 'e2.st.give.2', who: OOM, if: CHOSE('e2.stranger', 'give'), shot: () => cover.close(oom, 0.4, 1.0) },
      { hold: 2, if: CHOSE('e2.stranger', 'sit'), shot: () => cover.two(z, oom, 3.2), run: () => { this.z.setKneel(true, true); oom.setKneel(true, true); } },
      { key: 'e2.st.sit.2', who: OOM, if: CHOSE('e2.stranger', 'sit'), shot: () => cover.close(oom, 0.4, 1.0) },
      { key: 'e2.st.spear.1', who: 'scientist', if: CHOSE('e2.stranger', 'spear'), shot: () => cover.close(z, 0.5, 1.0), run: () => z.setFace({ frown: 0.5 }) },
      { key: 'e2.st.spear.2', who: OOM, if: CHOSE('e2.stranger', 'spear'), shot: () => cover.close(oom, 0.4, 1.1) },
      { key: 'e2.st.joke.1', who: 'scientist', if: CHOSE('e2.stranger', 'joke'), shot: () => cover.ots(z, oom, 0.5) },
      { key: 'e2.st.joke.2', who: OOM, if: CHOSE('e2.stranger', 'joke'), shot: () => cover.close(oom, 0.4, 1.0) },
      { hold: 2.6, if: CHOSE('e2.stranger', 'nothing'), shot: () => cover.two(z, oom, 3.4) },
    ], () => {
      prey.removeFromParent(); this.clearHands(); oom.setKneel(false); oom.setLookTarget(null);
      this.set('e2.met');
      if (test(this.s, CHOSE('e2.stranger', 'spear'))) { this.set('e2.oomsa.away'); this.npcs.pin('local', null); }
      else { const home = this.L.camp.clone().add(v3(9, 0, 7)); home.y = this.h(home.x, home.z); this.npcs.pin('local', null, 0, home); }
    });
  }

  /** After the snare: he needs glue; she shows him the bleeding tree, or he finds it. */
  private glueLines() {
    this.set('e2.l12.glue');
    this.say('e2.hf.1', 'scientist', 4);
    this.after(4.4, () => {
      if (test(this.s, TRUSTS(1))) this.say('e2.hf.oom', OOM, 4.2); else this.say('e2.hf.self', 'scientist', 4.2);
    });
  }

  // ------------------------------------------------------------------ 2.5 the bow drill (level 13)
  private intro13() {
    this.set('e2.l13.intro');
    this.set('e1.fireOut'); this.world.camp.setFire(1);
    this.busy = true;
    this.passTime(8.2, true, 'e2.rain', () => {
      const z = this.z, at = this.settle(this.byFire(1.35), this.L.camp, true, true);
      this.scene([
        { hold: 2.8, shot: () => ({ from: this.L.camp.clone().add(v3(0.9, 1.6, 0.8)), to: this.L.camp.clone().add(v3(0, 0.05, 0)), push: 0.03 }), run: () => { z.setLookTarget(this.L.camp); audio.sample('amb_rain', 0.35, { dur: 4 }); } },
        { key: 'e2.bd.1', who: 'scientist', shot: () => cover.close(z, 0.4, 0.95), run: () => z.setFace({ frown: 0.3 }) },
      ], () => { this.clearHands(); void at; this.ui.toast(t('level.13.hint')); });
    });
  }
  private pyriteScene() {
    this.set('e2.pyriteDone');
    const oom = this.oom(); if (!oom) return;
    this.actors[OOM] = oom;
    const c = this.L.camp, z = this.z;
    const me = this.settle(this.byFire(2.0), c, true, true);
    const her = c.clone().add(c.clone().sub(me).setY(0).normalize().multiplyScalar(1.9)); her.y = this.h(her.x, her.z);
    this.npcs.pin('local', her, Math.atan2(c.x - her.x, c.z - her.z)); oom.setKneel(true, true);
    const hands = her.clone().add(c.clone().sub(her).setY(0).normalize().multiplyScalar(0.35)).add(v3(0, 0.5, 0));
    const pyr = this.mesh(new THREE.DodecahedronGeometry(0.03, 0), std(0xc9a640, { metalness: 0.8, roughness: 0.35 }), hands.clone());
    this.scene([
      { key: 'e2.py.1', who: OOM, shot: () => cover.two(z, oom, 2.8), run: () => { oom.setLookTarget(this.head()); } },
      { hold: 2.4, shot: () => ({ from: hands.clone().add(v3(0.45, 0.2, 0.4)), to: hands, push: 0.01, aperture: 0.005 }), run: () => {
        oom.setHold({ R: { at: hands.clone().add(v3(0.03, 0, 0)), fingers: v3(0, 0, 1), palm: v3(-1, 0, 0), radius: 0.02, grasp: true }, L: { at: hands.clone().add(v3(-0.04, 0, 0)), fingers: v3(0, 0, 1), palm: v3(1, 0, 0), radius: 0.02, grasp: true } });
        for (let i = 0; i < 3; i++) this.after(0.4 + i * 0.6, () => { this.sparks(hands); audio.sample('flint', 0.5); });
      } },
      { key: 'e2.py.2', who: 'scientist', shot: () => cover.close(z, -0.9, 0.9), run: () => { z.setLookTarget(hands); oom.setHold(null); } },
    ], () => {
      pyr.removeFromParent(); this.clearHands(); oom.setKneel(false);
      const home = this.L.camp.clone().add(v3(9, 0, 7)); home.y = this.h(home.x, home.z); this.npcs.pin('local', null, 0, home);
      this.s.inventory.pyrite = (this.s.inventory.pyrite ?? 0) + 1; this.ui.setInventory(this.s.inventory);
      this.set('inv.pyrite'); this.ui.toast(t('e2.learn.pyrite'));
      void me;
    });
  }
  private sparks(at: THREE.Vector3) {
    const N = 14, g = new THREE.BufferGeometry(), pos = new Float32Array(N * 3), vel: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) { pos.set([at.x, at.y, at.z], i * 3); vel.push(v3((Math.random() - 0.5) * 1.2, Math.random() * 0.8 - 0.4, (Math.random() - 0.5) * 1.2)); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xffc060, size: 0.012, transparent: true, depthWrite: false });
    const p = new THREE.Points(g, m); p.frustumCulled = false; this.group.add(p);
    this.anim(0.45, (k) => {
      for (let i = 0; i < N; i++) { pos[i * 3] = at.x + vel[i].x * k; pos[i * 3 + 1] = at.y + vel[i].y * k - 2 * k * k; pos[i * 3 + 2] = at.z + vel[i].z * k; }
      g.attributes.position.needsUpdate = true; m.opacity = 1 - k / 0.45;
      if (k >= 0.45) { p.removeFromParent(); g.dispose(); m.dispose(); }
    });
  }

  // ------------------------------------------------------------------ 2.6 the rock shelter, ochre, the cairn
  /** A dry overhang above the lake shore, on the side towards the ridge: the first rise from the water. */
  shelter() {
    if (this.shelterSite) return this.shelterSite;
    const toRidge = v3(this.L.ridge.x - LAKE.x, 0, this.L.ridge.z - LAKE.z).normalize();
    let best = { at: v3(), score: -Infinity };
    for (let i = -6; i <= 6; i++) {
      const a = Math.atan2(toRidge.z, toRidge.x) + i * 0.08;
      for (let r = LAKE.r + 12; r <= LAKE.r + 40; r += 2) {
        const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r, y = this.world.terrain.rawHeight(x, z);
        if (y < 2 || y > 30) continue;
        const slope = Math.abs(this.world.terrain.rawHeight(x + 2, z) - this.world.terrain.rawHeight(x - 2, z)) + Math.abs(this.world.terrain.rawHeight(x, z + 2) - this.world.terrain.rawHeight(x, z - 2));
        const score = -slope * 3 - Math.abs(i) * 0.4 - Math.abs(r - LAKE.r - 22) * 0.05;
        if (score > best.score) best = { at: v3(x, this.h(x, z), z), score };
      }
    }
    const at = best.at, back = toRidge.clone();
    const wall = at.clone().addScaledVector(back, 2.4); wall.y = this.h(wall.x, wall.z);
    const cairn = at.clone().addScaledVector(back, -2.2).addScaledVector(this.right(back), 2.4); cairn.y = this.h(cairn.x, cairn.z);
    this.shelterSite = { at, facing: Math.atan2(back.x, back.z), wall, cairn };
    return this.shelterSite;
  }
  private shelterBuilt = false;
  private hands: THREE.Mesh[] = [];
  private buildShelter() {
    if (this.shelterBuilt) return;
    this.shelterBuilt = true;
    const S = this.shelter(), g = new THREE.Group(), back = v3(Math.sin(S.facing), 0, Math.cos(S.facing)), side = this.right(back);
    const rockM = std(0x6b625a, { roughness: 0.95 }), sootM = std(0x2b2622, { roughness: 1 });
    // the back wall and two shoulders, the overhang roof leaning out over the floor
    const wall = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 2), rockM); wall.scale.set(1.6, 1.1, 0.55); wall.position.copy(S.wall).add(v3(0, 1.0, 0)); wall.rotation.y = S.facing; g.add(wall);
    for (const sd of [-1, 1]) { const sh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), rockM); sh.scale.set(0.8, 1.2, 1.2); sh.position.copy(S.at).addScaledVector(side, sd * 2.4).addScaledVector(back, 1.2); sh.position.y = this.h(sh.position.x, sh.position.z) + 0.8; g.add(sh); }
    const roof = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 2), rockM); roof.scale.set(1.5, 0.35, 1.1); roof.position.copy(S.at).addScaledVector(back, 1.1).add(v3(0, 2.4, 0)); roof.rotation.y = S.facing; g.add(roof);
    const soot = new THREE.Mesh(new THREE.CircleGeometry(1.2, 16), sootM); soot.position.copy(roof.position).add(v3(0, -0.72, 0)); soot.rotation.x = Math.PI / 2; g.add(soot);
    // the old flakes in the floor dust, pale with weathering, and one hand axe
    for (let i = 0; i < 9; i++) {
      const fl = new THREE.Mesh(new THREE.TetrahedronGeometry(0.035, 0), std(0xbdb6a8, { roughness: 0.6 }));
      fl.scale.set(1, 0.25, 1.4); fl.position.copy(S.at).addScaledVector(back, 0.6 + (i % 3) * 0.25).addScaledVector(side, (i - 4) * 0.16); fl.position.y = this.h(fl.position.x, fl.position.z) + 0.01; fl.rotation.y = i * 1.3; g.add(fl);
    }
    const axe = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), std(0xa8a090, { roughness: 0.55 })); axe.scale.set(0.7, 0.25, 1.3); axe.position.copy(S.at).addScaledVector(back, 0.95); axe.position.y = this.h(axe.position.x, axe.position.z) + 0.02; g.add(axe);
    // red hands on the back wall: small four-fingered ones, and one five-fingered, his size
    const wallFace = S.wall.clone().addScaledVector(back, -0.85).add(v3(0, 1.1, 0));
    const sizes = [[-0.7, 0.2, 0.14, 4], [-0.45, 0.45, 0.13, 4], [-0.2, 0.15, 0.15, 4], [0.15, 0.4, 0.12, 4], [0.55, 0.25, 0.2, 5]];
    for (const [x, y, sz, n] of sizes) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), new THREE.MeshBasicMaterial({ map: handTex(n), transparent: true, depthWrite: false, opacity: 0.85 }));
      m.position.copy(wallFace).addScaledVector(side, x).add(v3(0, y, 0)); m.lookAt(m.position.clone().addScaledVector(back, -1));
      g.add(m); this.hands.push(m);
    }
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    this.group.add(g);
  }
  private cairnG: THREE.Group | null = null;
  private buildCairn(full: boolean) {
    if (this.cairnG) this.cairnG.removeFromParent();
    const S = this.shelter(), g = new THREE.Group(), m = std(0x8a8494, { roughness: 0.9 });
    const n = full ? 6 : 3;
    let y = 0;
    for (let i = 0; i < n; i++) { const r = 0.28 - i * 0.035; const st = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m); st.scale.set(1, 0.55, 1); y += r * 0.55; st.position.set(Math.sin(i) * 0.03, y, Math.cos(i) * 0.03); y += r * 0.45; g.add(st); }
    if (full) {
      const marks = this.f('e2.cairn.six') ? 6 : this.f('e2.cairn.one') ? 1 : this.f('e2.cairn.joke') ? 3 : 0;
      const red = new THREE.MeshBasicMaterial({ color: 0xa8321e });
      for (let i = 0; i < marks; i++) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.022, 8), red); const a = (i / Math.max(1, marks)) * Math.PI * 2; d.position.set(Math.cos(a) * 0.16, 0.42, Math.sin(a) * 0.16); d.lookAt(d.position.clone().multiplyScalar(2).setY(0.42)); g.add(d); }
    }
    g.position.copy(S.cairn); g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    this.group.add(g); this.cairnG = g;
    return g;
  }
  private shelterScene() {
    this.buildShelter();
    const S = this.shelter(), z = this.z, oom = this.oom(), back = v3(Math.sin(S.facing), 0, Math.cos(S.facing)), side = this.right(back);
    const guided = test(this.s, TRUSTS(1)) && !this.f('e2.oomsa.away') && !!oom;
    if (guided && oom) { this.actors[OOM] = oom; const her = S.at.clone().addScaledVector(side, 1.6).addScaledVector(back, -0.4); her.y = this.h(her.x, her.z); this.npcs.pin('local', her, Math.atan2(back.x, back.z)); }
    const floor = S.at.clone().addScaledVector(back, 0.8);
    const me = this.settle(S.at.clone().addScaledVector(back, 0.2), floor.clone().addScaledVector(back, 1), true);
    const five = this.hands[this.hands.length - 1]?.position ?? S.wall;
    const outside = S.at.clone().addScaledVector(back, -5.5).add(v3(0, 1.2, 0)).addScaledVector(side, 1.5);
    this.scene([
      { hold: 3.2, shot: () => ({ from: outside, to: S.at.clone().addScaledVector(back, 1.2).add(v3(0, 1.4, 0)), push: 0.04 }), run: () => z.setLookTarget(floor) },
      { key: 'e2.rs.oom', who: OOM, if: { all: [TRUSTS(1), { not: { flag: 'e2.oomsa.away' } }] }, shot: () => (oom ? cover.close(oom, 0.4, 1.1) : cover.mid(z)) },
      { hold: 2.2, shot: () => ({ from: floor.clone().add(v3(0, 0.45, 0)).addScaledVector(side, 0.4).addScaledVector(back, -0.3), to: floor.clone().add(v3(0, 0.02, 0)), push: 0.01, aperture: 0.005 }) },
      { key: 'e2.rs.1', who: 'scientist', shot: () => cover.close(z, 0.45, 0.95), run: () => { z.setProp('flake'); z.setFace({ squint: 0.3 }); } },
      { key: 'e2.rs.2', who: 'scientist', shot: () => cover.mid(z, -0.5, 2.0) },
      { key: 'e2.rs.3', who: 'scientist', shot: () => cover.close(z, -0.3, 0.9), run: () => z.setFace({ frown: 0.25 }) },
      // the hands on the wall: a slow move along them, ending on the one that is his size
      { hold: 4.6, shot: () => ({ from: five.clone().addScaledVector(back, -1.6).addScaledVector(side, -1.4).add(v3(0, -0.1, 0)), to: five.clone().addScaledVector(side, -0.6), push: 0.12 }), run: () => { z.setProp(null); z.setFace(null); z.setLookTarget(five); } },
      { hold: 2.4, shot: () => ({ from: five.clone().addScaledVector(back, -0.75), to: five, push: 0.03, aperture: 0.004 }) },
      // ochre: a soft red stone ground on a flat one with fat
      { hold: 2.8, shot: () => this.handShot(me.clone().addScaledVector(this.fwd(), 0.4).add(v3(0, 0.05, 0)), 0.7), run: () => this.grind(me) },
    ], () => {
      this.clearHands(); this.ochre?.forEach((o) => o.removeFromParent());
      this.set('inv.ochre'); this.ui.toast(t('e2.learn.ochre'));
      // out on the brow above the lake: a cairn, and what he paints on it
      const c = this.buildCairn(false);
      const stand = this.settle(S.cairn.clone().addScaledVector(back, -0.8), S.cairn, false);
      this.scene([
        { hold: 3, shot: () => ({ from: S.cairn.clone().addScaledVector(back, -6).addScaledVector(side, -3).add(v3(0, 2.2, 0)), to: S.cairn.clone().add(v3(0, 0.6, 0)), push: 0.04 }), run: () => z.setLookTarget(c.position.clone().add(v3(0, 0.4, 0))) },
        { choice: 'e2.mark', shot: () => cover.mid(z, 0.6, 2.2) },
        { key: 'e2.mk.six', who: 'scientist', if: CHOSE('e2.mark', 'six'), shot: () => cover.close(z, 0.4, 1.0), run: () => this.buildCairn(true) },
        { key: 'e2.mk.one', who: 'scientist', if: CHOSE('e2.mark', 'one'), shot: () => cover.close(z, 0.4, 1.0), run: () => this.buildCairn(true) },
        { key: 'e2.mk.joke', who: 'scientist', if: CHOSE('e2.mark', 'joke'), shot: () => cover.close(z, 0.4, 1.0), run: () => { this.buildCairn(true); z.setFace({ smile: 0.4 }); } },
        { hold: 2.4, if: CHOSE('e2.mark', 'bare'), shot: () => cover.mid(z, -0.5, 2.6), run: () => this.buildCairn(true) },
      ], () => { this.clearHands(); this.set('e2.cairnDone'); void stand; if (guided) { const home = this.L.camp.clone().add(v3(9, 0, 7)); home.y = this.h(home.x, home.z); this.npcs.pin('local', null, 0, home); } });
    });
  }
  private ochre: THREE.Mesh[] | null = null;
  private grind(me: THREE.Vector3) {
    const f = this.fwd(), r = this.right(f), z = this.z;
    const base = me.clone().addScaledVector(f, 0.42); base.y = this.h(base.x, base.z);
    const slab = this.mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.05, 9), std(0x77706a), base.clone().add(v3(0, 0.025, 0)));
    const ochre = this.mesh(new THREE.DodecahedronGeometry(0.035, 0), std(0xa8381e, { roughness: 0.9 }), base.clone().add(v3(0, 0.08, 0)));
    const smear = this.mesh(new THREE.CircleGeometry(0.06, 12), new THREE.MeshBasicMaterial({ color: 0x9a2e18 }), base.clone().add(v3(0, 0.052, 0))); smear.rotation.x = -Math.PI / 2; smear.scale.setScalar(0.2);
    this.ochre = [slab, ochre, smear];
    this.anim(2.8, (k) => {
      const p = base.clone().add(v3(0, 0.08, 0)).addScaledVector(r, Math.sin(k * 5) * 0.05).addScaledVector(f, Math.cos(k * 5) * 0.03);
      ochre.position.copy(p); smear.scale.setScalar(0.2 + k * 0.28);
      z.setHold({ R: { at: p.clone().add(v3(0, 0.03, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03, grasp: true }, L: { at: base.clone().add(v3(0, 0.06, 0)).addScaledVector(r, -0.17), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.02 } });
    });
  }

  // ------------------------------------------------------------------ 2.7 clay (level 14), 2.8 the firing night
  private intro14() {
    this.set('e2.l14.intro');
    this.busy = true;
    this.passTime(9.0, true, 'e2.day', () => {
      const z = this.z, at = this.settleWork(1.6), f = this.fwd(), r = this.right(f);
      const lump = this.mesh(new THREE.SphereGeometry(0.06, 10, 8), std(0x8e5a3e, { roughness: 0.6 }), at.clone().addScaledVector(f, 0.34).add(v3(0, 0.55, 0)));
      z.setHold({ L: { at: lump.position.clone().addScaledVector(r, -0.05).add(v3(0, -0.03, 0)), fingers: f.clone(), palm: UP.clone(), radius: 0.05 }, R: { at: lump.position.clone().addScaledVector(r, 0.05).add(v3(0, 0.03, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.05 } });
      this.scene([
        { key: 'e2.cl.1', who: 'scientist', shot: () => this.handShot(lump.position, 0.75), run: () => z.setLookTarget(lump.position) },
        { hold: 6, shot: () => cover.mid(z, -0.6, 2.2), run: () => this.ui.memory('e2.cl.bolzar', 7) },
      ], () => { lump.removeFromParent(); this.clearHands(); this.ui.toast(t('level.14.hint')); });
    });
  }
  private buildPots() {
    for (const p of this.pots) p.removeFromParent();
    this.pots = [];
    const c = this.L.camp, d = v3(1, 0, 0.4).normalize(), side = this.right(d);
    const pts = [v3(0.0, 0), v3(0.075, 0), v3(0.09, 0.04), v3(0.095, 0.1), v3(0.085, 0.16), v3(0.07, 0.2), v3(0.075, 0.22)].map((p) => new THREE.Vector2(p.x, p.y));
    for (let i = 0; i < 4; i++) {
      const at = c.clone().addScaledVector(d, 1.15).addScaledVector(side, (i - 1.5) * 0.26); at.y = this.h(at.x, at.z);
      const m = this.mesh(new THREE.LatheGeometry(pts, 16), std(0x8e5a3e, { side: THREE.DoubleSide, roughness: 0.7 }), at);
      m.scale.setScalar(0.95 + (i % 2) * 0.1); m.rotation.y = i;
      this.pots.push(m);
    }
  }
  private potsLeft() {
    if (this.f('e2.kiln.kept')) return 4;
    if (this.f('e2.kiln.oomsa')) return test(this.s, TRUSTS(3)) ? 4 : 3;
    if (this.f('e2.kiln.left')) return 2;
    return 1;
  }

  private night() {
    this.busy = true;
    const s = this.s, z = this.z, c = this.L.camp;
    this.passTime(19.7, false, s.branch?.log?.some((e) => e.id === 'e2.kiln') ? null : 'e2.nextday', () => {
      this.busy = true;
      if (!this.pots.length) this.buildPots();
      const oom = this.oom();
      // she comes into the light if she trusts him, or for her people's whistle when she does not
      const here = !!oom && !this.f('e2.kiln.decided') && (test(s, TRUSTS(1)) || (this.f('e2.oomsa.away') && this.f('e2.whistle')));
      if (here) this.set('e2.oomsa.here');
      const me = this.settle(this.byFire(2.0), c, true, true);
      const her = c.clone().add(c.clone().sub(me).setY(0).normalize().multiplyScalar(2.0)); her.y = this.h(her.x, her.z);
      if (here && oom) { this.actors[OOM] = oom; this.npcs.pin('local', her, Math.atan2(c.x - her.x, c.z - her.z)); oom.setKneel(true, true); }
      const pots = this.pots[1].position.clone();
      const dark = c.clone().addScaledVector(c.clone().sub(me).setY(0).normalize(), 13).add(v3(0, 0.7, 0));
      const eyes = this.eyes(dark);
      eyes.visible = false;
      this.scene([
        { hold: 3, shot: () => this.wide(me, 6.5, 0.6, 1.3), run: () => z.setLookTarget(pots) },
        { hold: 2.2, shot: () => ({ from: pots.clone().add(v3(0.35, 0.3, 0.45)), to: pots.clone().add(v3(0, 0.15, 0)), push: 0.01, aperture: 0.005 }), run: () => this.steam(pots) },
        { key: 'e2.fr.1', who: 'scientist', shot: () => cover.close(z, 0.45, 0.95) },
        { key: 'e2.fr.2', who: 'scientist', shot: () => cover.mid(z, -0.5, 2.1) },
        { key: 'e2.fr.oom', who: OOM, if: { flag: 'e2.oomsa.here' }, shot: () => (oom ? cover.ots(oom, z, 0.5) : cover.mid(z)), run: () => oom?.setLookTarget(dark) },
        { hold: 2.4, shot: () => ({ from: this.head().add(v3(0, 0.05, 0)), to: dark, push: 0.04 }), run: () => { eyes.visible = true; audio.sample('cb_growl', 0.35); } },
        { key: 'e2.fr.come', who: 'scientist', shot: () => cover.close(z, 0.35, 0.9), run: () => { z.setFace({ frown: 0.4, squint: 0.3 }); z.setLookTarget(dark); } },
        { choice: 'e2.kiln', shot: () => cover.close(z, -0.6, 1.2) },
      ], () => {
        eyes.removeFromParent(); this.clearHands();
        this.set('e2.kiln.decided');
        if (here && oom) { oom.setKneel(false); this.npcs.pin('local', null); this.set('e2.oomsa.hidden'); }
        void this.fight(here);
      });
    });
  }
  private async fight(here: boolean) {
    const s = this.s, cb = this.combat();
    this.busy = true;
    const story = { poisoned: this.f('e2.snare.far'), cubKilled: this.f('e2.snare.near') || !!s.flags.scarred, fireHigh: this.f('e2.kiln.kept') || this.f('e2.kiln.oomsa'), hurt: this.f('e2.cold') };
    let taken = 0;
    if (cb) {
      await new Promise<void>((go) => cb.ensureAsked(go));
      const o = await cb.startEncounter('night.defence', { story });
      for (const [k, v] of Object.entries(o.flags)) if (v) s.flags[`e2.cb.${k}`] = true;
      taken = o.stats.taken;
      if (o.flags.scarred) s.flags.scarred = true;
    } else {
      const r = await this.tension({ kind: 'quick', count: 4 });
      taken = r && r.passed ? 0 : 1;
    }
    if (this.f('e2.kiln.kept') && taken > 0) this.set('e2.bitten');
    // the pots that did not live through the night
    this.pots.forEach((p, i) => { if (i >= this.potsLeft()) { (p.material as THREE.MeshStandardMaterial).color.setHex(0x3a2a22); p.rotation.z = 0.5; } });
    this.after(1.0, () => {
      this.busy = false;
      const z = this.z, c = this.L.camp, me = this.settle(this.byFire(2.0), c, false);
      const dark = c.clone().addScaledVector(c.clone().sub(me).setY(0).normalize(), 11).add(v3(0, 0.75, 0));
      const eyes = this.eyes(dark);
      this.scene([
        { hold: 2.6, shot: () => ({ from: c.clone().addScaledVector(c.clone().sub(dark).setY(0).normalize(), 2.2).add(v3(0.4, 1.0, 0)), to: dark, push: 0.03 }), run: () => z.setLookTarget(dark) },
        { key: 'e2.fr.look', who: 'scientist', shot: () => cover.close(z, 0.35, 0.95), run: () => { z.setFace({ squint: 0.3 }); this.after(1.6, () => { eyes.visible = false; }); } },
      ], () => { eyes.removeFromParent(); this.clearHands(); this.set('e2.nightDone'); this.wait = 1; void here; });
    });
  }
  /** Two points of light out in the dark: something looking back at the fire. */
  private eyes(at: THREE.Vector3) {
    const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: 0xffd27a });
    for (const x of [-0.07, 0.07]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), m); e.position.set(x, 0, 0); g.add(e); }
    g.position.copy(at); g.lookAt(this.L.camp.clone().setY(at.y));
    this.group.add(g);
    return g;
  }
  private steam(at: THREE.Vector3) {
    const N = 24, g = new THREE.BufferGeometry(), pos = new Float32Array(N * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xd8d4cc, size: 0.03, transparent: true, opacity: 0.3, depthWrite: false });
    const p = new THREE.Points(g, m); p.frustumCulled = false; this.group.add(p);
    this.anim(4, (k) => {
      for (let i = 0; i < N; i++) { const a = (k * 0.5 + i / N) % 1; pos[i * 3] = at.x + Math.sin(i * 4.1 + k) * 0.04 * a; pos[i * 3 + 1] = at.y + 0.2 + a * 0.45; pos[i * 3 + 2] = at.z + Math.cos(i * 2.7 + k) * 0.04 * a; }
      g.attributes.position.needsUpdate = true;
      if (k >= 4) { p.removeFromParent(); g.dispose(); m.dispose(); }
    });
  }

  // ------------------------------------------------------------------ 2.9 it rings
  private dawn() {
    this.busy = true;
    this.passTime(6.5, true, 'e2.day', () => {
      if (!this.pots.length) this.buildPots();
      const z = this.z, c = this.L.camp, s = this.s, left = this.potsLeft();
      this.pots.forEach((p, i) => { const mm = p.material as THREE.MeshStandardMaterial; if (i < left) mm.color.setHex(0xa0623c); else { mm.color.setHex(0x3a2a22); p.rotation.z = 0.5; } });
      const pot = this.pots[0], me = this.settle(pot.position.clone().addScaledVector(pot.position.clone().sub(c).setY(0).normalize(), 0.5), pot.position, true, true);
      const oom = this.oom(), with_ = !!oom && test(s, TRUSTS(1)) && !this.f('e2.oomsa.away');
      if (with_ && oom) { this.actors[OOM] = oom; const her = me.clone().addScaledVector(this.right(this.fwd()), 1.3); her.y = this.h(her.x, her.z); this.npcs.pin('local', her, Math.atan2(pot.position.x - her.x, pot.position.z - her.z)); }
      const f = this.fwd(), r = this.right(f);
      const rim = pot.position.clone().add(v3(0, 0.2, 0));
      this.scene([
        { hold: 3.2, shot: () => this.wide(me, 6, 0.5, 1.2), run: () => { this.world.camp.setFire(1); z.setLookTarget(pot.position); } },
        { hold: 1.8, shot: () => ({ from: rim.clone().addScaledVector(f, -0.35).addScaledVector(r, 0.25).add(v3(0, 0.12, 0)), to: rim, push: 0.01, aperture: 0.004 }), run: () => {
          z.setHold({ R: { at: rim.clone().addScaledVector(f, -0.1).addScaledVector(r, 0.04), fingers: f.clone(), palm: f.clone(), radius: 0.02 } });
          this.after(0.6, () => { z.setHold({ R: { at: rim.clone().addScaledVector(f, -0.08), fingers: f.clone(), palm: f.clone(), radius: 0.02 } }); audio.sample('pot', 0.4); audio.tone(1960, 0.9, 'sine', 0.07); audio.tone(2940, 0.6, 'sine', 0.035, 0.01); });
          this.after(0.85, () => z.setHold({ R: { at: rim.clone().addScaledVector(f, -0.16).addScaledVector(r, 0.05), fingers: f.clone(), palm: f.clone(), radius: 0.02 } }));
        } },
        { key: 'e2.dw.1', who: 'scientist', shot: () => cover.close(z, 0.45, 0.95), run: () => { z.setHold(null); z.setFace({ smile: 0.3 }); } },
        { key: 'e2.dw.lost', who: 'scientist', if: { any: [{ flag: 'e2.kiln.left' }, { flag: 'e2.kiln.froze' }] }, shot: () => cover.mid(z, -0.5, 2.0) },
        { hold: 2.6, shot: () => ({ from: c.clone().add(v3(0.5, 0.45, 0.5)), to: c.clone().add(v3(0, 0.15, 0)), push: 0.01, aperture: 0.005 }), run: () => { this.boil(); } },
        { key: 'e2.dw.2', who: 'scientist', shot: () => cover.close(z, -0.4, 0.95) },
        { key: 'e2.dw.3', who: 'scientist', shot: () => cover.mid(z, 0.5, 2.2) },
        { key: 'e2.dw.oom', who: OOM, if: { all: [TRUSTS(1), { not: { flag: 'e2.oomsa.away' } }] }, shot: () => (oom ? cover.close(oom, 0.4, 1.0) : cover.mid(z)) },
      ], () => {
        this.clearHands(); this.boilPot?.removeFromParent();
        if (with_ && oom) { const home = c.clone().add(v3(9, 0, 7)); home.y = this.h(home.x, home.z); this.npcs.pin('local', null, 0, home); }
        this.set('e2.oomsa.hidden', false);
        this.set('inv.pottery'); this.ui.toast(t('e2.learn.pottery'));
        this.busy = true;
        this.discover('pottery', () => {
          this.busy = false;
          for (const p of this.pots) p.removeFromParent(); this.pots = [];
          this.set('e2.done');
        });
      });
    });
  }
  private boilPot: THREE.Mesh | null = null;
  private boil() {
    const c = this.L.camp;
    const pts = [v3(0.0, 0), v3(0.075, 0), v3(0.09, 0.04), v3(0.095, 0.1), v3(0.085, 0.16), v3(0.07, 0.2), v3(0.075, 0.22)].map((p) => new THREE.Vector2(p.x, p.y));
    const pot = this.mesh(new THREE.LatheGeometry(pts, 16), std(0xa0623c, { side: THREE.DoubleSide }), c.clone().add(v3(0, 0.04, 0)));
    const water = this.mesh(new THREE.CircleGeometry(0.085, 16), std(0x6a8a8a, { roughness: 0.1 }), c.clone().add(v3(0, 0.22, 0))); water.rotation.x = -Math.PI / 2; pot.add(water); water.position.set(0, 0.18, 0);
    this.boilPot = pot;
    this.steam(c.clone().add(v3(0, 0.05, 0)));
    audio.sample('splash', 0.15, { rate: 1.6 });
  }
}

/** A red hand stencil on a transparent square (n fingers), drawn once per kind. */
const HAND_TEX = new Map<number, THREE.Texture>();
function handTex(n: number) {
  let tx = HAND_TEX.get(n);
  if (tx) return tx;
  const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgba(160,48,26,0.92)';
  g.beginPath(); g.ellipse(S / 2, S * 0.66, S * 0.17, S * 0.2, 0, 0, Math.PI * 2); g.fill();
  const spread = n === 5 ? [-0.62, -0.3, -0.05, 0.2, 0.45] : [-0.4, -0.12, 0.15, 0.42];
  spread.forEach((a, i) => {
    const thumb = n === 5 && i === 0, len = thumb ? 0.2 : 0.3 - Math.abs(a) * 0.08;
    g.save(); g.translate(S / 2, S * 0.6); g.rotate(thumb ? -1.1 : a * 0.6);
    g.beginPath(); g.ellipse(0, -S * (0.12 + len / 2), S * 0.045, S * len / 2, 0, 0, Math.PI * 2); g.fill(); g.restore();
  });
  tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
  HAND_TEX.set(n, tx);
  return tx;
}
