import * as THREE from 'three';
import { t } from '../i18n';
import { voice } from '../core/voice';
import { Renderer } from '../core/renderer';
import type { Character, CrewId, CrewPose } from '../characters/character';

export type Who = CrewId | 'megazron';

/** A camera set-up: `from` looks at `to`; `push` drifts towards the subject. */
export interface Shot { from: THREE.Vector3; to: THREE.Vector3; push?: number; roll?: number; /** Lens blur override (fraction of screen height). */ aperture?: number }

export interface Beat {
  /** i18n key of the line (also its voice file). */
  key?: string;
  who?: Who;
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

export interface CutsceneCtx {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  actors: Partial<Record<CrewId, Character>>;
  subtitle: (key: string | null, speaker?: string) => void;
  onDone: () => void;
}

const headOf = (c: Character) => new THREE.Vector3().setFromMatrixPosition(c.head.matrixWorld).add(new THREE.Vector3(0, 0.12, 0));
const yawDir = (c: Character) => new THREE.Vector3(Math.sin(c.root.rotation.y), 0, Math.cos(c.root.rotation.y));

/** Classic coverage, computed from where the actors stand. */
export const cover = {
  close(c: Character, side = 0.5, dist = 1.05, drop = 0.03): Shot {
    const h = headOf(c), f = yawDir(c), r = new THREE.Vector3(f.z, 0, -f.x);
    return { from: h.clone().addScaledVector(f, dist).addScaledVector(r, side * dist).add(new THREE.Vector3(0, -drop, 0)), to: h.clone().add(new THREE.Vector3(0, -0.04, 0)), push: 0.1 };
  },
  mid(c: Character, side = 0.45, dist = 2): Shot {
    const h = headOf(c), f = yawDir(c), r = new THREE.Vector3(f.z, 0, -f.x);
    return { from: h.clone().addScaledVector(f, dist).addScaledVector(r, side * dist).add(new THREE.Vector3(0, -0.2, 0)), to: h.clone().add(new THREE.Vector3(0, -0.28, 0)), push: 0.08 };
  },
  /** Over b's shoulder onto a. */
  ots(a: Character, b: Character, side = 0.6): Shot {
    const A = headOf(a), Bh = headOf(b), d = A.clone().sub(Bh).setY(0).normalize(), r = new THREE.Vector3(d.z, 0, -d.x);
    return { from: Bh.clone().addScaledVector(d, -1.05).addScaledVector(r, side).add(new THREE.Vector3(0, 0.14, 0)), to: A.clone().add(new THREE.Vector3(0, -0.05, 0)), push: 0.05 };
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
const RIG = [6, 2.2, 5];
const rigFor = (scene: THREE.Scene) => scene.getObjectByName('cutscene-rig') as THREE.Group;

/** How each spoken shot framed its speaker (tests read this). */
export const frameReport: { key: string; x: number; y: number; fixed: boolean }[] = [];
const P = new THREE.Vector3();

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
  done = false;

  constructor(private beats: Beat[], private ctx: CutsceneCtx) {
    voice.preload(beats.flatMap((b) => (b.key ? [b.key] : [])));
    this.rig = rigFor(ctx.scene);
  }
  private rig: THREE.Group;

  /** Keep the speaker's head inside the safe area, and light them from the camera side. */
  private frame(who: Who | undefined, key: string | undefined) {
    const a = who && who !== 'megazron' ? this.ctx.actors[who] : undefined;
    const cam = this.ctx.camera, s = this.shot;
    if (!a || !s) return;
    const h = headOf(a);
    const look = () => { cam.position.copy(s.from); cam.up.set(0, 1, 0); cam.lookAt(s.to); cam.updateMatrixWorld(); return P.copy(h).project(cam); };
    let q = look(), fixed = false;
    if (Math.abs(q.x) > 0.8 || Math.abs(q.y) > 0.8 || q.z > 1) { s.to.copy(h); s.to.y -= 0.05; q = look(); fixed = true; }
    if (key) frameReport.push({ key, x: q.x, y: q.y, fixed });
    const d = s.from.clone().sub(h).setY(0).normalize(), r = new THREE.Vector3(d.z, 0, -d.x), up = new THREE.Vector3(0, 1, 0);
    const [k, f, b] = this.rig.children;
    this.rig.children.forEach((l, i) => ((l as THREE.PointLight).intensity = RIG[i]));
    k.position.copy(h).addScaledVector(d, 1.2).addScaledVector(r, 0.8).addScaledVector(up, 0.5);
    f.position.copy(h).addScaledVector(d, 1.3).addScaledVector(r, -1.1).addScaledVector(up, -0.1);
    b.position.copy(h).addScaledVector(d, -1.1).addScaledVector(r, -0.5).addScaledVector(up, 0.7);
  }

  /** Test hook: go straight to the next beat. */
  debugNext() { this.left = 0; }

  private next() {
    this.i++;
    if (this.i >= this.beats.length) { this.end(); return; }
    const b = this.beats[this.i];
    const { actors, subtitle } = this.ctx;
    b.run?.();
    if (b.poses) for (const id in b.poses) this.poses[id as CrewId] = b.poses[id as CrewId]!;
    if (b.faces) Object.assign(this.faces, b.faces);
    let dur = b.hold ?? 0;
    if (b.key) {
      const speaker = b.who ? (b.who === 'megazron' ? 'mz.name' : `crew.${b.who}.name`) : undefined;
      subtitle(b.key, speaker);
      const spoken = voice.duration(b.key);
      const est = Math.max(1.4, t(b.key).length * 0.062);
      dur = Math.max(dur, spoken ?? est);
      if (b.who && b.who !== 'megazron') actors[b.who]?.say(dur);
    } else subtitle(null);
    this.left = dur + (b.after ?? 0.28);
    if (b.shot) { this.shot = b.shot(); this.shotT = 0; this.shotLen = this.left; }
    this.frame(b.who, b.key);
  }

  poses: Partial<Record<CrewId, CrewPose>> = {};
  private faces: Partial<Record<CrewId, CrewId>> = {};

  /** Advance; call once per frame before the actors are animated. */
  update(dt: number) {
    if (this.done) return;
    if (this.i < 0) this.next();
    this.left -= dt;
    if (this.left <= 0) { this.next(); if (this.done) return; }
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
      cam.position.copy(s.from).lerp(s.to, (s.push ?? 0) * k);
      cam.up.set(0, 1, 0);
      cam.lookAt(s.to);
      if (s.roll) cam.rotateZ(s.roll);
      // focus on the subject; a close-up has a shallower field than a wide shot
      const d = cam.position.distanceTo(s.to);
      Renderer.current?.setDof(d, s.aperture ?? Math.min(0.016, 0.022 / Math.max(d, 1)));
    }
  }

  skip() { if (!this.done) this.end(); }

  private end() {
    this.done = true;
    this.rig.children.forEach((l) => ((l as THREE.PointLight).intensity = 0));
    Renderer.current?.setDof(0, 0);
    this.ctx.subtitle(null);
    voice.stop();
    this.ctx.onDone();
  }
}
