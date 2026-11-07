import * as THREE from 'three';
import { t } from '../i18n';
import { voice } from '../core/voice';
import { Renderer } from '../core/renderer';
import type { Character, CrewId, CrewPose } from '../characters/character';
import type { Cond, Effect, LineChoice } from '../game/branch/types';

export type Who = CrewId | 'megazron';

/** A camera set-up: `from` looks at `to`; `push` drifts towards the subject. */
export interface Shot { from: THREE.Vector3; to: THREE.Vector3; push?: number; roll?: number; /** Lens blur override (fraction of screen height). */ aperture?: number; /** Keep this actor's head where it is in frame, whatever the body does. */ track?: Character }

/**
 * A step of a scene. Beyond the line itself it can branch: `if` plays it only
 * when the condition holds, `swap` and `fallback` change the line (see
 * LineChoice; a dead speaker's line is skipped unless it has a fallback), and
 * `choice` or `qte` stops the scene for the player. Put the consequences in
 * the beats that follow, behind `if`.
 */
export interface Beat extends Omit<LineChoice, 'who' | 'fallbackWho'> {
  /** i18n key of the line (also its voice file). */
  key?: string;
  who?: Who;
  fallbackWho?: Who;
  /** Plays only if this holds. */
  if?: Cond;
  /** Id of a Decision. The scene waits; an answered decision is passed over. */
  choice?: string;
  /** Id of a Qte. The scene waits; an answered one is passed over. */
  qte?: string;
  /** Applied when the beat plays, even if the rest of the scene is skipped. */
  effects?: Effect[];
  /** Builds the shot when the beat starts, so it can read actor positions. */
  shot?: () => Shot;
  poses?: Partial<Record<CrewId, CrewPose>>;
  /** Who turns to look at whom: id -> target id, or a world position. */
  faces?: Partial<Record<CrewId, CrewId>>;
  /** Fixed length in seconds; default is the spoken length. */
  hold?: number;
  /** Extra pause after the line, for comic timing. */
  after?: number;
  run?: () => void;
}

/** What a scene needs from the story system. Without it no beat is conditional. */
export interface SceneBranch {
  test(c?: Cond): boolean;
  line(b: Beat): { key?: string; who?: string } | null;
  apply(e: Effect[]): void;
  /** Has this decision or quick-time moment been answered? */
  answered(id: string): boolean;
  ask(decision: string, done: () => void): void;
  quick(qte: string, done: () => void): void;
}

export interface CutsceneCtx {
  branch?: SceneBranch;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  actors: Partial<Record<CrewId, Character>>;
  subtitle: (key: string | null, speaker?: string) => void;
  onDone: () => void;
  /** Can a camera stand here? Walls, trees, the ground. */
  cameraOk?: (p: THREE.Vector3) => boolean;
}

const headOf = (c: Character) => new THREE.Vector3().setFromMatrixPosition(c.head.matrixWorld).add(new THREE.Vector3(0, 0.12, 0));
const yawDir = (c: Character) => new THREE.Vector3(Math.sin(c.root.rotation.y), 0, Math.cos(c.root.rotation.y));

/** Classic coverage, computed from where the actors stand. */
export const cover = {
  close(c: Character, side = 0.5, dist = 1.05, drop = 0.03): Shot {
    const h = headOf(c), f = yawDir(c), r = new THREE.Vector3(f.z, 0, -f.x);
    return { from: h.clone().addScaledVector(f, dist).addScaledVector(r, side * dist).add(new THREE.Vector3(0, -drop, 0)), to: h.clone().add(new THREE.Vector3(0, -0.12, 0)), push: 0.1, track: c };
  },
  mid(c: Character, side = 0.45, dist = 2): Shot {
    const h = headOf(c), f = yawDir(c), r = new THREE.Vector3(f.z, 0, -f.x);
    return { from: h.clone().addScaledVector(f, dist).addScaledVector(r, side * dist).add(new THREE.Vector3(0, -0.2, 0)), to: h.clone().add(new THREE.Vector3(0, -0.28, 0)), push: 0.08, track: c };
  },
  /** Over b's shoulder onto a. */
  ots(a: Character, b: Character, side = 0.6): Shot {
    const A = headOf(a), Bh = headOf(b), d = A.clone().sub(Bh).setY(0).normalize(), r = new THREE.Vector3(d.z, 0, -d.x);
    return { from: Bh.clone().addScaledVector(d, -1.05).addScaledVector(r, side).add(new THREE.Vector3(0, 0.14, 0)), to: A.clone().add(new THREE.Vector3(0, -0.1, 0)), push: 0.05, track: a };
  },
  two(a: Character, b: Character, dist = 2.8, side = 1): Shot {
    const A = headOf(a), Bh = headOf(b), m = A.clone().add(Bh).multiplyScalar(0.5), d = Bh.clone().sub(A).setY(0).normalize(), n = new THREE.Vector3(d.z, 0, -d.x).multiplyScalar(side);
    return { from: m.clone().addScaledVector(n, dist).add(new THREE.Vector3(0, -0.2, 0)), to: m.clone().add(new THREE.Vector3(0, -0.2, 0)), push: 0.06 };
  },
};

/**
 * Key, fill and rim for whoever is talking. The lights live in the scene from
 * the start, off: adding a light later would recompile every material in the
 * scene mid-game, which is a multi-second freeze.
 */
export function addCutsceneRig(scene: THREE.Scene) {
  const rig = new THREE.Group(); rig.name = 'cutscene-rig';
  rig.add(new THREE.PointLight(0xfff0e0, 0, 7, 1.6), new THREE.PointLight(0xc4d6ff, 0, 7, 1.6), new THREE.PointLight(0xffd8b0, 0, 6, 1.6));
  scene.add(rig);
}
const RIG = [2.6, 1.3, 3];
const rigFor = (scene: THREE.Scene) => scene.getObjectByName('cutscene-rig') as THREE.Group;

/** How each spoken shot framed its speaker (tests read this). */
export const frameReport: { key: string; x: number; y: number; fixed: boolean }[] = [];
const P = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Plays a list of beats: cuts between shots, stages poses and looks, and holds
 * each beat for as long as its voice line lasts. Works on any scene.
 */
export class Cutscene {
  private i = -1;
  private left = 0;
  private shotT = 0;
  private shotLen = 1;
  private shot: Shot | null = null;
  private fresh = false;
  private aim = new THREE.Vector3();
  private trackOff = new THREE.Vector3();
  done = false;

  /** A panel is up: the scene holds until it answers. */
  private waiting = false;

  constructor(private beats: Beat[], private ctx: CutsceneCtx) {
    voice.preload(beats.flatMap((b) => [b.key, b.fallback, ...(b.swap ?? []).map((x) => x.key)].filter((k): k is string => !!k)));
    this.rig = rigFor(ctx.scene);
  }

  private plays(b: Beat) { return this.ctx.branch?.test(b.if) ?? true; }
  private pending(b: Beat) {
    const id = b.choice ?? b.qte;
    return !!id && !!this.ctx.branch && !this.ctx.branch.answered(id);
  }
  private rig: THREE.Group;

  /** Is anyone standing in this shot's way, or is the speaker facing away from it? */
  private shotCost(a: Character, h: THREE.Vector3, cam: THREE.Vector3) {
    const seg = new THREE.Line3(cam, h), near = new THREE.Vector3();
    let cost = 0;
    for (const id in this.ctx.actors) {
      const o = this.ctx.actors[id as CrewId];
      if (!o || o === a || !o.root.visible) continue;
      for (const [part, r] of [[o.head, 0.55], [o.chest, 0.36]] as [THREE.Object3D, number][]) {
        const p = part.getWorldPosition(new THREE.Vector3());
        seg.closestPointToPoint(p, true, near);
        // a shoulder at the edge of frame is coverage; a body across the lens is a mistake. Heads count hair.
        if (near.distanceTo(p) < r) cost += 10;
      }
    }
    const to = cam.clone().sub(h).setY(0).normalize();
    const facing = to.dot(yawDir(a));
    if (facing < 0.2) cost += (0.2 - facing) * 6;
    if (facing < -0.1) cost += 40; // the back of a speaker's head is the worst shot there is
    if (this.ctx.cameraOk && !this.ctx.cameraOk(cam)) cost += 20;
    return cost;
  }

  /** Swing the camera around the speaker to the nearest angle that sees them clearly. */
  private clearShot(a: Character, h: THREE.Vector3, s: Shot) {
    const base = s.from.clone().sub(h);
    let best = 0, top = Infinity;
    for (const turn of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.25, -1.25, 1.6, -1.6, 2, -2, 2.5, -2.5, Math.PI]) {
      const cam = base.clone().applyAxisAngle(UP, turn).add(h);
      const c = this.shotCost(a, h, cam) + Math.abs(turn) * 0.05;
      if (c < top - 1e-6) { top = c; best = turn; }
    }
    if (best) { s.from.copy(base.applyAxisAngle(UP, best).add(h)); }
  }

  /** Keep the speaker's head inside the safe area, and light them from the camera side. */
  private frame(who: Who | undefined, key: string | undefined) {
    const on = who && who !== 'megazron' ? this.ctx.actors[who] : undefined;
    const a = on?.root.visible ? on : undefined; // a voice on the radio is nobody to frame
    const cam = this.ctx.camera, s = this.shot;
    if (!a || !s) return;
    const h = headOf(a);
    // only coverage built on the speaker can swing: a set-up aimed at something else stays put
    if (this.fresh && s.track) this.clearShot(a, h, s);
    this.fresh = false;
    const look = () => { cam.position.copy(s.from); cam.up.set(0, 1, 0); cam.lookAt(s.to); cam.updateMatrixWorld(); return P.copy(h).project(cam); };
    let q = look(), fixed = false;
    if (Math.abs(q.x) > 0.8 || Math.abs(q.y) > 0.8 || q.z > 1) { s.to.copy(h); s.to.y -= 0.05; q = look(); fixed = true; }
    if (key) frameReport.push({ key, x: q.x, y: q.y, fixed });
    const d = s.from.clone().sub(h).setY(0).normalize(), r = new THREE.Vector3(d.z, 0, -d.x), up = new THREE.Vector3(0, 1, 0);
    const [k, f, b] = this.rig.children;
    this.rig.children.forEach((l, i) => ((l as THREE.PointLight).intensity = RIG[i]));
    k.position.copy(h).addScaledVector(d, 1.2).addScaledVector(r, 0.8).addScaledVector(up, 0.9);
    f.position.copy(h).addScaledVector(d, 1.3).addScaledVector(r, -1.1).addScaledVector(up, -0.1);
    b.position.copy(h).addScaledVector(d, -1.1).addScaledVector(r, -0.5).addScaledVector(up, 0.7);
    // a lamp beside a listener would burn them out: ease it off as they get close
    for (const l of this.rig.children as THREE.PointLight[]) {
      for (const id in this.ctx.actors) {
        const o = this.ctx.actors[id as CrewId];
        if (!o || o === a || !o.root.visible) continue;
        const dist = l.position.distanceTo(o.chest.getWorldPosition(P));
        if (dist < 1.5) l.intensity *= Math.max(0.15, (dist / 1.5) ** 2);
      }
    }
  }

  /** Test hook: go straight to the next beat. */
  debugNext() { this.left = 0; }

  private next() {
    for (;;) {
      this.i++;
      if (this.i >= this.beats.length) { this.end(); return; }
      if (this.start(this.beats[this.i])) return;
    }
  }

  /** Starts a beat; false if it has nothing to do in this story. */
  private start(b: Beat): boolean {
    const br = this.ctx.branch;
    if (!this.plays(b)) return false;
    if ((b.choice || b.qte) && !this.pending(b)) return false;
    const line = br ? br.line(b) : { key: b.key, who: b.who };
    if (!line) return false;
    const key = line.key, who = line.who as Who | undefined;
    const { actors, subtitle } = this.ctx;
    b.run?.();
    if (b.effects) br?.apply(b.effects);
    if (b.poses) for (const id in b.poses) this.poses[id as CrewId] = b.poses[id as CrewId]!;
    if (b.faces) Object.assign(this.faces, b.faces);
    let dur = b.hold ?? 0;
    if (key) {
      const speaker = who ? (who === 'megazron' ? 'mz.name' : `crew.${who}.name`) : undefined;
      subtitle(key, speaker);
      const spoken = voice.duration(key);
      const est = Math.max(1.4, t(key).length * 0.062);
      dur = Math.max(dur, spoken ?? est);
      if (who && who !== 'megazron') actors[who]?.say(dur);
    } else subtitle(null);
    this.left = dur + (b.after ?? 0.28);
    if (b.shot) {
      // a cut hides the turn: whoever was going to face someone already has
      for (const id in this.faces) {
        const x = actors[id as CrewId], y = actors[this.faces[id as CrewId]!];
        if (!x || !y) continue;
        x.root.rotation.y = Math.atan2(y.root.position.x - x.root.position.x, y.root.position.z - x.root.position.z);
        x.root.updateMatrixWorld(true);
      }
      this.shot = b.shot(); this.shotT = 0; this.shotLen = Math.max(this.left, 6); this.fresh = true;
    }
    this.frame(who, key);
    const sh = this.shot;
    if (b.shot && sh) { this.aim.copy(sh.to); if (sh.track) this.trackOff.copy(sh.to).sub(headOf(sh.track)); }
    if (br && (b.choice || b.qte)) {
      this.waiting = true;
      const done = () => { this.waiting = false; this.left = 0; };
      if (b.choice) br.ask(b.choice, done); else br.quick(b.qte!, done);
    }
    return true;
  }

  poses: Partial<Record<CrewId, CrewPose>> = {};
  private faces: Partial<Record<CrewId, CrewId>> = {};

  /** Advance; call once per frame before the actors are animated. */
  update(dt: number) {
    if (this.done) return;
    if (this.i < 0) { this.next(); if (this.done) return; }
    if (!this.waiting) {
      this.left -= dt;
      if (this.left <= 0) { this.next(); if (this.done) return; }
    }
    // turn actors towards whoever they're addressing
    for (const id in this.faces) {
      const a = this.ctx.actors[id as CrewId], b = this.ctx.actors[this.faces[id as CrewId]!];
      if (!a || !b) continue;
      const want = Math.atan2(b.root.position.x - a.root.position.x, b.root.position.z - a.root.position.z);
      const d = Math.atan2(Math.sin(want - a.root.rotation.y), Math.cos(want - a.root.rotation.y));
      a.root.rotation.y += d * (1 - Math.exp(-dt * 3));
    }
    const s = this.shot;
    if (s) {
      this.shotT += dt;
      const k = Math.min(1, this.shotT / this.shotLen);
      const cam = this.ctx.camera;
      // the frame follows the head through a gesture, gently, as an operator would
      if (s.track) this.aim.lerp(P.copy(headOf(s.track)).add(this.trackOff), 1 - Math.exp(-dt * 5));
      cam.position.copy(s.from).lerp(this.aim, (s.push ?? 0) * k);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.aim);
      if (s.roll) cam.rotateZ(s.roll);
      // focus on the subject; a close-up has a shallower field than a wide shot
      const d = cam.position.distanceTo(this.aim);
      Renderer.current?.setDof(d, s.aperture ?? Math.min(0.016, 0.022 / Math.max(d, 1)));
    }
  }

  /**
   * Jumps to the next open choice, or ends the scene if none is left: skipping
   * can pass the talking, never the deciding. Skipped beats still take effect.
   */
  skip() {
    if (this.done || this.waiting) return;
    voice.stop();
    while (++this.i < this.beats.length) {
      const b = this.beats[this.i];
      if (!this.plays(b)) continue;
      if (this.pending(b)) { this.i--; this.left = 0; this.next(); return; }
      if (b.effects) this.ctx.branch?.apply(b.effects);
      b.run?.();
      if (b.poses) for (const id in b.poses) this.poses[id as CrewId] = b.poses[id as CrewId]!;
    }
    this.end();
  }

  private end() {
    this.done = true;
    this.rig.children.forEach((l) => ((l as THREE.PointLight).intensity = 0));
    Renderer.current?.setDof(0, 0);
    this.ctx.subtitle(null);
    voice.stop();
    this.ctx.onDone();
  }
}
