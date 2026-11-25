import * as THREE from 'three';
import type { Character, CrewId, CrewPose, Face, Limbs, Dir } from '../characters/character';
import { audio } from '../core/audio';
import { HURT, clearHurt } from '../core/hurtfx';
import { ARRIVALS } from './arrivals';

/**
 * The first moments on another world (~/bs-story/LANDINGS.md): the fall, the hit, the body still, a breath, eyes that
 * will not focus, the hurt found, the world felt (its gravity, its air, its cold or heat, its light, its sound), a
 * failed try to get up, then up, and control. Every arrival is authored here as data (arrivals.ts): the body's keys,
 * the shots, the picture and the sound.
 *
 * Space: everything is written in the landing frame: x to the right, y up, z forward, where forward is the way they
 * face when they are finally up (the player's yaw at the hand-over). Body keys put the hips (or, standing, the feet)
 * somewhere, point the head and the chest, and point each limb in that frame, so a hand stays on the ground while the
 * torso turns over it.
 */
export type V3 = [number, number, number];
export type LimbName = 'armL' | 'foreL' | 'armR' | 'foreR' | 'legL' | 'shinL' | 'legR' | 'shinR';
export interface BodyKey {
  t: number;
  /** The clip under the hand-set limbs ('lie' is the plain rest body); a standing clip plants the feet. */
  clip?: CrewPose | 'crouch' | 'limp';
  /** Where the hips are (landing frame), or with `feet`, where the feet are (the clip sets the hips). */
  at: V3; feet?: boolean;
  /** Which way the head points (along the spine) and the chest faces. */
  head: V3; chest: V3;
  limbs?: Partial<Record<LimbName, V3>>;
  bend?: number; twist?: number;
  face?: Face;
  /** Look at this point (landing frame); omit to look ahead. */
  gaze?: V3;
  /** Head turn in radians [yaw, pitch] over the gaze. */
  look?: [number, number];
  /** How this key is reached from the last: eased (default), linear, a fall (accelerating), or a cut. */
  ease?: 'io' | 'lin' | 'fall' | 'out' | 'cut';
}
export interface Shot {
  t0: number; t1: number;
  /** Camera and its aim, landing frame; `from2`/`to2` move it over the shot. */
  from: V3; to: V3; from2?: V3; to2?: V3;
  fov: number; fov2?: number;
  /** Handheld drift, metres. */
  hand?: number;
  /** Their eyes: the camera sits in the head and looks at `to` (and drifts as a dazed head does). */
  pov?: boolean;
  /** Aim follows the body: `to` is added to where the hips are now. */
  track?: boolean;
  /** A close-up that stays on the face: `from` and `to` are offsets (landing frame) from the head as it moves. */
  onHead?: boolean;
  /** Ease over the shot's move. */
  ease?: 'io' | 'lin' | 'out';
}
/** The picture and the ears at a moment; values ease between keys. */
export interface FxKey { t: number; blur?: number; double?: number; tunnel?: number; desat?: number; red?: number; flash?: number; muffle?: number; ring?: number; black?: number }
export interface Cue { t: number; run: (a: ArrivalCtx) => void }
/** What falls with them: a mesh, flown from the sky to where it comes to rest. */
export interface Faller {
  mesh: (ctx: ArrivalCtx) => THREE.Object3D;
  /** Keys of the object's flight and rest, landing frame (rotation as Euler XYZ, radians). */
  keys: { t: number; at: V3; rot: V3; ease?: BodyKey['ease'] }[];
  /** A glow on its leading face while it comes through air (0..1 over time) */
  heat?: [number, number][];
  /** It stays on the stage after the arrival (continuity into play). */
  stays?: boolean;
}
export interface ArrivalDef {
  id: CrewId;
  /** Seconds from the first frame to control. */
  dur: number;
  /** Real gravity used for anything thrown (metres per second squared) and whether air slows it. */
  g: number; air: boolean;
  /** The moment of impact (dust, shake, flash, the thump). */
  hit: number;
  /** Where the body ends up, stage coordinates (x, z), and the player's yaw there. */
  spot: [number, number]; yaw: number;
  body: BodyKey[];
  shots: Shot[];
  fx: FxKey[];
  cues: Cue[];
  fallers?: Faller[];
  /** Dust thrown at the hit: count, speed, colour, size. */
  dust?: { n: number; speed: number; color: number; size: number; up?: number };
  /** Heard heartbeat over time: [t, bpm, volume]. */
  heart?: [number, number, number][];
  /** A soft light near them for the shots, motivated by their world's own (a rim sun, a lit cloud): colour, strength,
   * where (landing frame). Removed after. */
  fill?: { color: number; i: number; at: V3 };
  /** A dark streak of light behind the faller or body while it is in the sky (atmosphere entry). */
  streak?: { t0: number; t1: number; color: number };
}
export interface ArrivalCtx {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; body: Character;
  ground: (x: number, z: number) => number;
  /** Landing frame to world. */
  P: (v: V3) => THREE.Vector3; D: (v: V3) => THREE.Vector3;
  say: (key: string, speaker: string, seconds: number) => void;
  /** Objects added for the arrival (removed after unless they stay). */
  add: (o: THREE.Object3D, stays?: boolean) => THREE.Object3D;
}

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (x: number) => { const k = clamp(x); return k * k * (3 - 2 * k); };
const EASE: Record<NonNullable<BodyKey['ease']>, (k: number) => number> = {
  io: ss, lin: (k) => clamp(k), fall: (k) => clamp(k) * clamp(k), out: (k) => 1 - (1 - clamp(k)) * (1 - clamp(k)), cut: (k) => (k >= 1 ? 1 : 0),
};
const LIMBS: LimbName[] = ['armL', 'foreL', 'armR', 'foreR', 'legL', 'shinL', 'legR', 'shinR'];
/** Smooth value noise in -1..1. */
const wob = (t: number, k: number) => Math.sin(t * 0.9 + k * 1.3) * 0.5 + Math.sin(t * 1.73 + k * 2.1) * 0.3 + Math.sin(t * 3.1 + k) * 0.2;

/** A body held in one key (the title sequence's short landing shots): where the root goes, its turn, and its limbs in
 * the body's own space. `yaw` turns the landing frame as player.ts does (forward = -sin, -cos). */
export function holdPose(key: BodyKey, origin: THREE.Vector3, yaw: number, hipsH = 0.93) {
  const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), u = new THREE.Vector3(0, 1, 0);
  const D = (v: V3) => new THREE.Vector3().addScaledVector(r, v[0]).addScaledVector(u, v[1]).addScaledVector(f, v[2]).normalize();
  const h = D(key.head), c = D(key.chest); c.addScaledVector(h, -c.dot(h)).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(h, c), h, c));
  const pos = origin.clone().addScaledVector(r, key.at[0]).addScaledVector(u, key.at[1]).addScaledVector(f, key.at[2]);
  if (!key.feet) pos.addScaledVector(new THREE.Vector3(0, hipsH, 0).applyQuaternion(q), -1);
  const inv = q.clone().invert(), limbs: Limbs = { bend: key.bend ?? 0, twist: key.twist ?? 0 };
  for (const n of LIMBS) { const v = key.limbs?.[n]; if (v) { const d = D(v).applyQuaternion(inv); (limbs as Record<string, Dir>)[n] = [d.x, d.y, d.z]; } }
  return { pos, quat: q, limbs };
}

/** One arrival playing on a stage. update() until it returns false. */
export class Arrival {
  readonly def: ArrivalDef;
  t = 0;
  active = true;
  private ctx: ArrivalCtx;
  private origin: THREE.Vector3;
  private r: THREE.Vector3; private f: THREE.Vector3; private u = new THREE.Vector3(0, 1, 0);
  private hipsH = 0.93;
  private temp: THREE.Object3D[] = [];
  private fallers: { o: THREE.Object3D; d: Faller }[] = [];
  private dust: { pts: THREE.Points; v: Float32Array; p: Float32Array; born: number } | null = null;
  private streak: THREE.Mesh | null = null;
  private cueI = 0;
  private lastHeart = -1;
  private onDone: () => void;
  private q = new THREE.Quaternion(); private qa = new THREE.Quaternion(); private qb = new THREE.Quaternion();
  private m = new THREE.Matrix4();

  /** False: the caller drives the camera (the wake-up). */
  private camOn = true;
  constructor(id: CrewId, o: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; body: Character; ground: (x: number, z: number) => number; say: ArrivalCtx['say'] }, done: () => void, def?: ArrivalDef, opt: { at?: [number, number]; yaw?: number; camera?: boolean } = {}) {
    const d0 = def ?? ARRIVALS[id]!;
    this.def = opt.at || opt.yaw !== undefined ? { ...d0, spot: opt.at ?? d0.spot, yaw: opt.yaw ?? d0.yaw } : d0;
    this.camOn = opt.camera ?? true;
    const Y = this.def.yaw;
    // the player's own axes (player.ts: forward -sin, -cos; right = (-fz, fx))
    this.f = new THREE.Vector3(-Math.sin(Y), 0, -Math.cos(Y));
    this.r = new THREE.Vector3(Math.cos(Y), 0, -Math.sin(Y));
    const [sx, sz] = this.def.spot;
    this.origin = new THREE.Vector3(sx, o.ground(sx, sz), sz);
    const P = (v: V3) => this.origin.clone().addScaledVector(this.r, v[0]).addScaledVector(this.u, v[1]).addScaledVector(this.f, v[2]);
    const D = (v: V3) => new THREE.Vector3().addScaledVector(this.r, v[0]).addScaledVector(this.u, v[1]).addScaledVector(this.f, v[2]).normalize();
    this.ctx = { ...o, P, D, add: (obj, stays) => { o.scene.add(obj); if (!stays) this.temp.push(obj); return obj; } };
    this.onDone = done;
    // the rest body's hip height, measured (builds differ)
    const b = o.body; b.root.position.set(0, 0, 0); b.root.quaternion.identity(); b.setLimbs(null);
    b.animate('lie', 0, 0, 0, 1 / 60); b.root.updateMatrixWorld(true);
    let hips: THREE.Object3D | null = null; b.root.traverse((c) => { if (c.name === 'hips' && (c as THREE.Bone).isBone) hips = c; });
    if (hips) { const h = (hips as THREE.Object3D).getWorldPosition(new THREE.Vector3()).y; if (h > 0.5 && h < 1.4) this.hipsH = h; }
    for (const d of this.def.fallers ?? []) { const obj = d.mesh(this.ctx); this.ctx.add(obj, d.stays); this.fallers.push({ o: obj, d }); }
    if (this.def.streak) {
      const g = new THREE.CylinderGeometry(0.05, 1.4, 1, 12, 1, true); g.translate(0, -0.5, 0);
      const mat = new THREE.MeshBasicMaterial({ color: this.def.streak.color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      this.streak = this.ctx.add(new THREE.Mesh(g, mat)) as THREE.Mesh; this.streak.visible = false;
    }
    if (this.def.fill) { const L = new THREE.PointLight(this.def.fill.color, this.def.fill.i, 9, 1.4); L.position.copy(this.ctx.P(this.def.fill.at)); this.ctx.add(L); }
    b.root.visible = true;
    this.update(0);
  }

  /** Where the hips (or feet) and the body's turn are at time t: keys interpolated. */
  private bodyAt(t: number) {
    const K = this.def.body;
    let i = 0; while (i < K.length - 1 && K[i + 1].t <= t) i++;
    const a = K[i], b = K[Math.min(i + 1, K.length - 1)];
    const k = a === b ? 0 : (EASE[b.ease ?? 'io'])((t - a.t) / Math.max(1e-3, b.t - a.t));
    return { a, b, k };
  }
  private basis(head: V3, chest: V3, out: THREE.Quaternion) {
    const h = this.ctx.D(head), c = this.ctx.D(chest);
    c.addScaledVector(h, -c.dot(h)).normalize();
    const x = new THREE.Vector3().crossVectors(h, c);
    return out.setFromRotationMatrix(this.m.makeBasis(x, h, c));
  }
  private rootOf(key: BodyKey, q: THREE.Quaternion) {
    const p = this.ctx.P(key.at);
    if (!key.feet) p.addScaledVector(new THREE.Vector3(0, this.hipsH, 0).applyQuaternion(q), -1);
    return p;
  }

  private poseBody(t: number, dt: number) {
    const body = this.ctx.body, { a, b, k } = this.bodyAt(t);
    this.basis(a.head, a.chest, this.qa); this.basis(b.head, b.chest, this.qb);
    const pa = this.rootOf(a, this.qa), pb = this.rootOf(b, this.qb);
    this.q.slerpQuaternions(this.qa, this.qb, k);
    const root = body.root;
    root.position.lerpVectors(pa, pb, k);
    // a breath that shows: the chest rises (bend) on the body's own rhythm once it is alive
    root.quaternion.copy(this.q);
    root.updateMatrixWorld(true);
    const inv = this.q.clone().invert();
    const L: Limbs = {};
    for (const n of LIMBS) {
      const va = a.limbs?.[n], vb = b.limbs?.[n];
      const v = va && vb ? this.ctx.D(va).lerp(this.ctx.D(vb), k) : vb && k > 0.5 ? this.ctx.D(vb) : va ? this.ctx.D(va) : vb ? this.ctx.D(vb) : null;
      if (!v || v.lengthSq() < 1e-6) continue;
      v.normalize().applyQuaternion(inv);
      (L as Record<string, Dir>)[n] = [v.x, v.y, v.z];
    }
    L.bend = (a.bend ?? 0) + ((b.bend ?? 0) - (a.bend ?? 0)) * k;
    L.twist = (a.twist ?? 0) + ((b.twist ?? 0) - (a.twist ?? 0)) * k;
    body.setLimbs(L);
    const fa = a.face ?? {}, fb = b.face ?? {};
    const face: Face = {};
    for (const n of ['smile', 'frown', 'fear', 'squint', 'open', 'blink'] as const) { const x = fa[n] ?? 0, y = fb[n] ?? 0; if (x || y) face[n] = x + (y - x) * k; }
    body.setFace(face);
    const ga = a.gaze, gb = b.gaze ?? a.gaze;
    if (gb) body.setLookTarget(this.ctx.P(ga && gb ? [ga[0] + (gb[0] - ga[0]) * k, ga[1] + (gb[1] - ga[1]) * k, ga[2] + (gb[2] - ga[2]) * k] : gb));
    else body.setLookTarget(null);
    const la = a.look ?? [0, 0], lb = b.look ?? la;
    body.look2(la[0] + (lb[0] - la[0]) * k, la[1] + (lb[1] - la[1]) * k);
    const clip = (k < 0.5 ? a.clip : b.clip) ?? 'lie';
    body.animate(clip as CrewPose, 0, 0, t, dt);
  }

  private fxAt(t: number) {
    const F = this.def.fx, out = { blur: 0, double: 0, tunnel: 0, desat: 0, red: 0, flash: 0, muffle: 0, ring: 0, black: 0 };
    if (!F.length) return out;
    let i = 0; while (i < F.length - 1 && F[i + 1].t <= t) i++;
    const a = F[i], b = F[Math.min(i + 1, F.length - 1)], k = a === b ? 0 : ss((t - a.t) / Math.max(1e-3, b.t - a.t));
    for (const n of Object.keys(out) as (keyof typeof out)[]) { const x = (a as unknown as Record<string, number>)[n] ?? 0, y = (b as unknown as Record<string, number>)[n] ?? 0; out[n] = t <= a.t ? x : x + (y - x) * k; }
    return out;
  }

  private shoot(t: number) {
    const S = this.def.shots, cam = this.ctx.camera;
    const s = S.find((x) => t >= x.t0 && t < x.t1) ?? S[S.length - 1];
    const k = (s.ease === 'lin' ? (x: number) => clamp(x) : s.ease === 'out' ? EASE.out : ss)((t - s.t0) / Math.max(1e-3, s.t1 - s.t0));
    const lerp3 = (x: V3, y: V3 | undefined): V3 => (y ? [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k] : x);
    let from = this.ctx.P(lerp3(s.from, s.from2));
    let to = this.ctx.P(lerp3(s.to, s.to2));
    const hips = this.ctx.body.root.position.clone().addScaledVector(new THREE.Vector3(0, this.hipsH, 0).applyQuaternion(this.ctx.body.root.quaternion), 1);
    if (s.track) to = hips.clone().add(this.ctx.D(lerp3(s.to, s.to2)).multiplyScalar(new THREE.Vector3(...lerp3(s.to, s.to2)).length()));
    if (s.onHead) {
      const head = this.ctx.body.head.getWorldPosition(new THREE.Vector3());
      const off = (v: V3) => new THREE.Vector3().addScaledVector(this.r, v[0]).addScaledVector(this.u, v[1]).addScaledVector(this.f, v[2]);
      from = head.clone().add(off(lerp3(s.from, s.from2))); to = head.clone().add(off(lerp3(s.to, s.to2)));
    }
    if (s.pov) {
      // their eyes: just in front of the face, on the line to what they look at (never inside the hair), dazed
      const head = this.ctx.body.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0));
      from = head.clone().addScaledVector(to.clone().sub(head).normalize(), 0.32);
      to.add(new THREE.Vector3(wob(t * 0.6, 1), wob(t * 0.5, 2) * 0.6, wob(t * 0.55, 3)).multiplyScalar(0.35));
    }
    // a hand-held camera breathes; the hit shakes it once and the shake dies
    const hand = s.hand ?? 0;
    if (hand) from.add(new THREE.Vector3(wob(t * 1.1, 4), wob(t * 1.3, 5), wob(t * 0.9, 6)).multiplyScalar(hand));
    const since = t - this.def.hit;
    if (since > 0 && since < 1.4) { const a = 0.18 * Math.exp(-since * 4.5); from.add(new THREE.Vector3(Math.sin(t * 61), Math.sin(t * 53 + 1), Math.sin(t * 47 + 2)).multiplyScalar(a)); }
    cam.position.copy(from);
    cam.up.set(0, 1, 0);
    cam.lookAt(to);
    if (s.pov) cam.rotateZ(wob(t * 0.4, 7) * 0.12);
    const fov = s.fov2 ? s.fov + (s.fov2 - s.fov) * k : s.fov;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  private flyFallers(t: number) {
    for (const { o, d } of this.fallers) {
      const K = d.keys; let i = 0; while (i < K.length - 1 && K[i + 1].t <= t) i++;
      const a = K[i], b = K[Math.min(i + 1, K.length - 1)];
      const k = a === b || t <= a.t ? 0 : EASE[b.ease ?? 'lin']((t - a.t) / Math.max(1e-3, b.t - a.t));
      o.visible = t >= K[0].t;
      o.position.lerpVectors(this.ctx.P(a.at), this.ctx.P(b.at), k);
      const ea = new THREE.Quaternion().setFromEuler(new THREE.Euler(...a.rot)), eb = new THREE.Quaternion().setFromEuler(new THREE.Euler(...b.rot));
      const yawQ = new THREE.Quaternion().setFromAxisAngle(this.u, this.def.yaw);
      o.quaternion.copy(yawQ).multiply(ea.slerp(eb, k));
      if (d.heat) {
        let h = 0; for (let j = 0; j < d.heat.length - 1; j++) if (t >= d.heat[j][0] && t <= d.heat[j + 1][0]) h = d.heat[j][1] + (d.heat[j + 1][1] - d.heat[j][1]) * ss((t - d.heat[j][0]) / (d.heat[j + 1][0] - d.heat[j][0]));
        o.traverse((c) => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.userData?.hot) { m.emissiveIntensity = h * 3; } });
      }
    }
  }

  /** Dust and grit thrown at the hit, falling the way this world throws things: slow and high in low gravity, held and
   * drifting in air, flying straight and far with none. */
  private kickDust(t: number) {
    const D = this.def.dust; if (!D) return;
    if (!this.dust && t >= this.def.hit) {
      const n = D.n, p = new Float32Array(n * 3), v = new Float32Array(n * 3);
      const c = this.ctx.P([0, 0.05, 0]);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = D.speed * (0.3 + Math.random() * 0.7), up = (D.up ?? 0.6) * (0.4 + Math.random());
        p.set([c.x, c.y, c.z], i * 3); v.set([Math.cos(a) * s, up * s, Math.sin(a) * s], i * 3);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const c2 = document.createElement('canvas'); c2.width = c2.height = 32; const x2 = c2.getContext('2d')!; const gr = x2.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x2.fillStyle = gr; x2.fillRect(0, 0, 32, 32);
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: D.color, size: D.size, map: new THREE.CanvasTexture(c2), transparent: true, opacity: 0.8, depthWrite: false, sizeAttenuation: true }));
      pts.frustumCulled = false; this.ctx.add(pts);
      this.dust = { pts, v, p, born: t };
    }
    if (!this.dust) return;
    const d = this.dust, age = t - d.born, n = d.p.length / 3;
    if (age > 14) { d.pts.visible = false; return; }
    for (let i = 0; i < n; i++) {
      // closed form, so seeking a frame gives the same picture: ballistic with drag where there is air
      const vx = d.v[i * 3], vy = d.v[i * 3 + 1], vz = d.v[i * 3 + 2];
      const c = this.ctx.P([0, 0.05, 0]);
      let x: number, y: number, z: number;
      if (this.def.air) { const kd = 2.2, e = (1 - Math.exp(-kd * age)) / kd, vt = this.def.g / kd; x = c.x + vx * e; z = c.z + vz * e; y = c.y + (vy + vt) * e - vt * age; }
      else { x = c.x + vx * age; z = c.z + vz * age; y = c.y + vy * age - 0.5 * this.def.g * age * age; }
      const gy = this.ctx.ground(x, z);
      if (y < gy) { y = gy + 0.01; }
      d.p[i * 3] = x; d.p[i * 3 + 1] = y; d.p[i * 3 + 2] = z;
    }
    (d.pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (d.pts.material as THREE.PointsMaterial).opacity = 0.8 * (1 - clamp((age - (this.def.air ? 3 : 6)) / 5));
  }

  private drawStreak(t: number) {
    const s = this.def.streak, m = this.streak; if (!s || !m) return;
    m.visible = t >= s.t0 && t < s.t1;
    if (!m.visible) return;
    const lead = this.fallers[0]?.o ?? this.ctx.body.root;
    const p = lead.getWorldPosition(new THREE.Vector3());
    // a tail back along the path it came by
    const back = this.fallers[0] ? this.ctx.P(this.fallers[0].d.keys[0].at) : p.clone().add(new THREE.Vector3(0, 40, 0));
    const dir = back.clone().sub(p); const len = Math.min(dir.length(), 60); dir.normalize();
    m.position.copy(p); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().negate());
    m.scale.set(1, len, 1);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - ss((t - (s.t1 - 0.4)) / 0.4));
  }

  update(dt: number) {
    if (!this.active) return false;
    this.t += dt;
    const t = this.t;
    while (this.cueI < this.def.cues.length && this.def.cues[this.cueI].t <= t) this.def.cues[this.cueI++].run(this.ctx);
    this.flyFallers(t);
    this.poseBody(t, dt);
    this.kickDust(t);
    this.drawStreak(t);
    if (this.camOn) this.shoot(t);
    const fx = this.fxAt(t), H = HURT.film;
    H.blur = fx.blur; H.double = fx.double; H.tunnel = fx.tunnel; H.desat = fx.desat; H.red = fx.red; H.flash = fx.flash; H.black = fx.black;
    audio.ears(fx.muffle, fx.ring);
    const hb = this.def.heart;
    if (hb) { let j = -1; for (let i = 0; i < hb.length; i++) if (hb[i][0] <= t) j = i; if (j !== this.lastHeart && j >= 0) { this.lastHeart = j; audio.heart(hb[j][1], hb[j][2]); } }
    if (t >= this.def.dur) { this.finish(); return false; }
    return true;
  }

  /** Skip to the hand-over: the body where it ends, the stage props that stay, the sound and picture back to normal. */
  skip() { if (!this.active) return; while (this.cueI < this.def.cues.length) { const c = this.def.cues[this.cueI++]; if (c.t <= this.def.dur) c.run(this.ctx); } this.t = this.def.dur - 1e-3; this.flyFallers(this.def.dur); this.poseBody(this.def.dur, 1 / 60); this.finish(); }

  private finish() {
    if (!this.active) return;
    this.active = false;
    clearHurt('film');
    audio.ears(0, 0); audio.heart(0);
    const b = this.ctx.body; b.setLimbs(null); b.setFace(null); b.setLookTarget(null); b.look2(0, 0);
    // upright again for whoever moves it next (player.ts turns it about y only)
    { const e = new THREE.Euler().setFromQuaternion(b.root.quaternion, 'YXZ'); b.root.rotation.set(0, e.y, 0); }
    // the airless stages keep their own sound in play
    if (!this.def.air) audio.vacuum(false);
    for (const o of this.temp) { o.parent?.remove(o); o.traverse((c) => { const m = c as THREE.Mesh; m.geometry?.dispose?.(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.(); }); }
    this.temp = [];
    for (const { o, d } of this.fallers) if (d.stays) { o.visible = true; o.traverse((c) => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.userData?.hot) m.emissiveIntensity = 0; }); }
    this.onDone();
  }
}
