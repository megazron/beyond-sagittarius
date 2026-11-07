import * as THREE from 'three';
import beat from './beatmap.json';
import { clamp, easeInOut, lerp, smoothstep } from '../core/noise';
import { audio } from '../core/audio';
import { voice } from '../core/voice';
import { t } from '../i18n';
import { Renderer } from '../core/renderer';
import type { Character, CrewId, CrewPose, Dir, Face, Limbs } from '../characters/character';
import type { Cinematic } from './cinematic';
import type { World } from '../world/world';
import { LAKE } from '../world/heightfield';

const BEAT = 60 / beat.bpm;
const S = beat.sections;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Beats since a hit, as a decay from 1. */
const after = (b: number, at: number, len = 1) => (b < at ? 0 : Math.exp(-((b - at) / len) * 3));
const shakeAt = (time: number, amp: number, out: THREE.Vector3) => out.set(Math.sin(time * 37) + Math.sin(time * 61) * 0.6, Math.sin(time * 43 + 1) + Math.sin(time * 71) * 0.6, 0).multiplyScalar(amp);
const wob = (d: Dir, time: number, seed: number, amt = 0.12): Dir => [d[0] + Math.sin(time * 1.1 + seed) * amt, d[1] + Math.sin(time * 0.9 + seed * 2) * amt, d[2] + Math.sin(time * 1.3 + seed * 3) * amt];

/** Smooth noise, -1..1: three sines that never line up, so no joint ever repeats or rests. */
const nz = (t: number, s: number) => (Math.sin(t + s) + Math.sin(t * 1.73 + s * 2.3) * 0.6 + Math.sin(t * 2.91 + s * 3.7) * 0.3) / 1.9;
const nzDir = (d: Dir, t: number, s: number, a: number): Dir => [d[0] + nz(t, s) * a, d[1] + nz(t * 1.1, s + 5) * a, d[2] + nz(t * 0.9, s + 11) * a];
/**
 * A thrown body never holds a shape. Every joint chases its own path around the base pose, and
 * forearms and shins run behind the joint above them, so a limb whips instead of pivoting.
 * k is the violence (0 calm, 1 flung), t is seconds.
 */
export function flail(base: Limbs, t: number, seed: number, k: number): Limbs {
  const lag = 0.32, w = 2.6 + k * 2.2, T = t * w;
  const o: Limbs = { ...base };
  const d = (x: Dir | undefined, f: Dir, tt: number, s: number, a: number) => nzDir(x ?? f, tt, s, a);
  o.armL = d(base.armL, [1, 0.3, 0], T, seed, 0.95 * k); o.foreL = d(base.foreL, [1, 0.6, 0.2], T - lag * w, seed + 1, 1.15 * k);
  o.armR = d(base.armR, [-1, 0.3, 0], T * 0.93, seed + 2, 0.95 * k); o.foreR = d(base.foreR, [-1, 0.6, 0.2], T * 0.93 - lag * w, seed + 3, 1.15 * k);
  o.legL = d(base.legL, [0.3, -1, 0], T * 0.8, seed + 4, 0.6 * k); o.shinL = d(base.shinL, [0.2, -1, -0.5], T * 0.8 - lag * w, seed + 5, 0.75 * k);
  o.legR = d(base.legR, [-0.3, -1, 0], T * 0.86, seed + 6, 0.6 * k); o.shinR = d(base.shinR, [-0.2, -1, -0.5], T * 0.86 - lag * w, seed + 7, 0.75 * k);
  o.bend = (base.bend ?? 0) + nz(T * 0.7, seed + 8) * 0.55 * k;
  o.twist = (base.twist ?? 0) + nz(T * 0.6, seed + 9) * 0.7 * k;
  return o;
}
/** Blend two limb sets: from a body on its feet to the same body in the air. */
export function mixLimbs(a: Limbs, b: Limbs, k: number): Limbs {
  const o: Limbs = { ...b };
  for (const n of ['armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR'] as const) {
    const x = a[n], y = b[n];
    if (x && y) o[n] = [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
  }
  return o;
}
/** Hands down, feet under: where a standing body's limbs already are. */
export const STANDING: Limbs = { armL: [0.18, -1, 0.02], foreL: [0.14, -1, 0.14], armR: [-0.18, -1, 0.02], foreR: [-0.14, -1, 0.14], legL: [0.08, -1, 0], shinL: [0.06, -1, -0.04], legR: [-0.08, -1, 0], shinR: [-0.06, -1, -0.04] };

/** Fill-in for the order they land in; the player is always last. */
const ORDER: CrewId[] = ['strong', 'medic', 'builder', 'explorer', 'social', 'scientist'];
const TRAIL: Record<CrewId, number> = { scientist: 0x45f0e0, strong: 0xff6a12, medic: 0xb58cff, explorer: 0xff4560, builder: 0x63ff6a, social: 0xffd23c, megazron: 0xffffff } as Record<CrewId, number>;

/** Bodies in free fall: where each one's arms and legs are trying to go. */
export const FALL: Record<string, Limbs> = {
  spread: { armL: [1, 0.3, 0.15], foreL: [0.9, 0.65, 0.2], armR: [-1, 0.3, 0.15], foreR: [-0.9, 0.65, 0.2], legL: [0.32, -1, -0.28], shinL: [0.2, -1, -0.65], legR: [-0.28, -1, -0.1], shinR: [-0.22, -1, -0.4], hair: [0, 1, 0], openHands: true },
  strong: { armL: [1, 0.05, 0.5], foreL: [0.25, 0.9, 0.5], armR: [-1, 0.2, 0.55], foreR: [-0.3, 0.3, 1], legL: [0.45, -0.9, 0.3], shinL: [0.25, -1, -0.5], legR: [-0.4, -1, -0.2], shinR: [-0.25, -1, -0.5], bend: 0.3, hair: [0, 1, -0.3] },
  medic: { armL: [0.3, -0.85, 0.45], foreL: [-0.85, 0.3, 0.42], armR: [-0.3, -0.85, 0.45], foreR: [0.85, 0.22, 0.46], legL: [0.08, -1, 0.05], shinL: [0.02, -1, -0.15], legR: [-0.02, -1, 0.15], shinR: [0.08, -1, -0.1], hair: [0, 1, 0] },
  explorer: { armL: [0.65, 0.5, -0.35], foreL: [0.6, 0.8, -0.2], armR: [-0.3, 0.45, 1], foreR: [-0.2, 0.3, 1], legL: [0.3, -1, 0.35], shinL: [0.2, -1, -0.55], legR: [-0.15, -1, -0.3], shinR: [-0.15, -1, -0.55], bend: -0.15, hair: [0, 1, -0.4], openHands: true },
  builder: { armL: [0.5, -0.4, 0.9], foreL: [-0.4, 0.15, 1], armR: [-0.5, -0.4, 0.9], foreR: [0.4, 0.15, 1], legL: [0.2, -0.8, 0.6], shinL: [0.15, -1, -0.4], legR: [-0.25, -0.75, 0.65], shinR: [-0.15, -1, -0.4], bend: 0.45, hair: [0, 1, 0] },
  social: { armL: [0.9, 0.15, -0.3], foreL: [0.9, 0.5, -0.1], armR: [-0.5, 0.25, 0.85], foreR: [0.05, 0.75, 0.65], legL: [0.25, -1, -0.15], shinL: [0.28, -0.9, -0.5], legR: [-0.3, -0.9, 0.3], shinR: [-0.15, -1, -0.5], hair: [0, 1, 0] },
  scientist: { armL: [0.65, 0.6, 0.6], foreL: [0.25, 0.65, 0.8], armR: [-0.65, 0.6, 0.6], foreR: [-0.25, 0.65, 0.8], legL: [0.3, -1, -0.3], shinL: [0.25, -1, -0.65], legR: [-0.25, -1, -0.15], shinR: [-0.2, -1, -0.55], hair: [0, 1, -0.2], openHands: true },
};
const FACE: Record<string, Face> = {
  strong: { frown: 0.9, open: 0.55, squint: 0.3 }, medic: { blink: 0.96, smile: 0.08 }, explorer: { fear: 0.7, open: 0.4, frown: 0.25 },
  builder: { fear: 0.5, frown: 0.5, open: 0.18 }, social: { fear: 0.6, smile: 0.25, open: 0.3 }, scientist: { fear: 0.9, open: 0.5, frown: 0.25 },
};

/** A camera-facing ribbon of light behind a moving point. */
class Trail {
  static N = 56;
  mesh: THREE.Mesh;
  private pos = new Float32Array(Trail.N * 2 * 3);
  private u: THREE.ShaderMaterial;
  private a = new THREE.Vector3(); private b = new THREE.Vector3(); private c = new THREE.Vector3();
  constructor(color: number, parent: THREE.Object3D) {
    const n = Trail.N, g = new THREE.BufferGeometry(), uv = new Float32Array(n * 4), idx: number[] = [];
    for (let i = 0; i < n; i++) {
      uv.set([i / (n - 1), 0, i / (n - 1), 1], i * 4);
      if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.u = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uGain: { value: 1 } },
      vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime, uGain; varying vec2 vU;
        void main(){
          float x = vU.x, y = abs(vU.y * 2.0 - 1.0);
          float core = exp(-y * y * 16.0), halo = exp(-y * y * 3.0);
          float flow = 0.62 + 0.38 * sin(x * 34.0 - uTime * 24.0 + sin(x * 9.0 + uTime * 3.0) * 2.0);
          float fade = pow(1.0 - x, 1.3) * smoothstep(0.0, 0.015, x);
          vec3 c = (uColor * 0.8 * halo * flow + mix(uColor, vec3(1.0), 0.6) * core * 0.9 * (1.0 - x)) * fade * uGain;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.u);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }
  set color(c: number) { this.u.uniforms.uColor.value.set(c); }
  /** `at(s)`: the path, s = 0 at the head. Width in metres. */
  draw(at: (s: number, out: THREE.Vector3) => void, cam: THREE.Camera, width: number, time: number, gain = 1) {
    const n = Trail.N, { a, b, c } = this;
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      at(s, a); at(Math.min(1, s + 0.02), b);
      b.sub(a).normalize();
      c.copy(a).sub(cam.position).cross(b).normalize().multiplyScalar(width * (0.35 + 0.65 * Math.pow(1 - s, 0.7)) * (i === 0 ? 0.05 : 1));
      this.pos[i * 6] = a.x + c.x; this.pos[i * 6 + 1] = a.y + c.y; this.pos[i * 6 + 2] = a.z + c.z;
      this.pos[i * 6 + 3] = a.x - c.x; this.pos[i * 6 + 4] = a.y - c.y; this.pos[i * 6 + 5] = a.z - c.z;
    }
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.u.uniforms.uTime.value = time;
    this.u.uniforms.uGain.value = gain;
    this.mesh.visible = true;
  }
}

/** Particles as a pure function of time since they were let go: sparks, dust, spray, smoke. */
class Burst {
  points: THREE.Points;
  u: Record<string, THREE.IUniform>;
  constructor(count: number, parent: THREE.Object3D, additive: boolean, seed = 1) {
    const a = new Float32Array(count * 4);
    let s = seed * 9301 + 49297;
    const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < count; i++) {
      const z = r() * 2 - 1, ph = r() * Math.PI * 2, q = Math.sqrt(1 - z * z);
      a.set([q * Math.cos(ph), z, q * Math.sin(ph), r()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aS', new THREE.BufferAttribute(a, 4));
    this.u = {
      uT: { value: 0 }, uLife: { value: 2 }, uSpeed: { value: 8 }, uDrag: { value: 2 }, uGrav: { value: 2 }, uSize: { value: 1 }, uGrow: { value: 2 }, uStagger: { value: 0 },
      uH: { value: 1000 }, uOrigin: { value: new THREE.Vector3() }, uSquash: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3() },
      uC0: { value: new THREE.Color(1, 1, 1) }, uC1: { value: new THREE.Color(0.2, 0.2, 0.2) }, uAlpha: { value: 1 },
    };
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: this.u,
      vertexShader: /* glsl */ `
        attribute vec4 aS; uniform float uT, uLife, uSpeed, uDrag, uGrav, uSize, uGrow, uStagger, uH; uniform vec3 uOrigin, uSquash, uLift;
        varying float vK; varying float vOn;
        void main(){
          float life = uLife * (0.6 + 0.4 * fract(aS.w * 7.3));
          float tt = uT - aS.w * uStagger;
          vOn = step(0.0, tt) * step(tt, life);
          tt = max(tt, 0.0);
          float k = clamp(tt / life, 0.0, 1.0); vK = k;
          float d = (1.0 - exp(-tt * uDrag)) / uDrag;
          vec3 p = uOrigin + aS.xyz * uSquash * (0.3 + 0.7 * fract(aS.w * 13.7)) * uSpeed * d + uLift * tt - vec3(0.0, uGrav * tt * tt, 0.0);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(uSize * (0.4 + k * uGrow) * (0.6 + 0.8 * fract(aS.w * 3.1)) * uH / max(-mv.z, 0.2), 900.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uC0, uC1; uniform float uAlpha; varying float vK; varying float vOn;
        void main(){
          if (vOn < 0.5) discard;
          vec2 q = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.05, length(q)) * (1.0 - vK) * (1.0 - vK) * uAlpha;
          gl_FragColor = vec4(mix(uC0, uC1, sqrt(vK)), a);
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.visible = false;
    parent.add(this.points);
  }
  set(o: { at?: THREE.Vector3; c0?: number | THREE.Color; c1?: number | THREE.Color; life?: number; speed?: number; drag?: number; grav?: number; size?: number; grow?: number; stagger?: number; squash?: [number, number, number]; lift?: [number, number, number]; alpha?: number }) {
    const u = this.u;
    if (o.at) u.uOrigin.value.copy(o.at);
    if (o.c0 !== undefined) u.uC0.value.set(o.c0 as THREE.ColorRepresentation);
    if (o.c1 !== undefined) u.uC1.value.set(o.c1 as THREE.ColorRepresentation);
    if (o.life !== undefined) u.uLife.value = o.life;
    if (o.speed !== undefined) u.uSpeed.value = o.speed;
    if (o.drag !== undefined) u.uDrag.value = o.drag;
    if (o.grav !== undefined) u.uGrav.value = o.grav;
    if (o.size !== undefined) u.uSize.value = o.size;
    if (o.grow !== undefined) u.uGrow.value = o.grow;
    if (o.stagger !== undefined) u.uStagger.value = o.stagger;
    if (o.squash) u.uSquash.value.set(...o.squash);
    if (o.lift) u.uLift.value.set(...o.lift);
    if (o.alpha !== undefined) u.uAlpha.value = o.alpha;
    return this;
  }
  play(time: number) { this.u.uT.value = time; this.u.uH.value = innerHeight * Renderer.current!.pixelRatio; this.points.visible = time >= 0; }
}

/** Torn hull plates: one draw, positions from time alone. */
class Debris {
  mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private p = new THREE.Vector3(); private s = new THREE.Vector3();
  private seeds: Float32Array;
  constructor(count: number, mat: THREE.Material, parent: THREE.Object3D) {
    const g = new THREE.BoxGeometry(1, 0.04, 0.7);
    this.mesh = new THREE.InstancedMesh(g, mat, count);
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.seeds = new Float32Array(count * 8);
    for (let i = 0; i < this.seeds.length; i++) this.seeds[i] = (Math.sin(i * 127.1) * 43758.5453) % 1;
    parent.add(this.mesh);
  }
  /** Plates leave along `pull` with some scatter, released one by one from `from` to `to` in the hull's length. */
  update(time: number, pull: THREE.Vector3, along: number, spread: number, base = 0, scale = 1) {
    const n = this.mesh.count, sd = this.seeds;
    for (let i = 0; i < n; i++) {
      const k = i * 8, rel = Math.abs(sd[k]) * 0.8, tt = Math.max(0, time - rel * 2.4);
      const z = base + along * sd[k + 1], a = sd[k + 2] * 6.283;
      this.p.set(Math.cos(a) * 1.05, Math.sin(a) * 1.05, z);
      this.p.addScaledVector(pull, tt * tt * (0.8 + Math.abs(sd[k + 3]) * 2.2));
      this.p.x += sd[k + 4] * spread * tt; this.p.y += sd[k + 5] * spread * tt;
      this.e.set(sd[k + 6] * 3 + tt * sd[k + 3] * 3, sd[k + 7] * 3 + tt * sd[k + 4] * 2, tt * sd[k + 5] * 2);
      const sc = tt > 0 ? (0.25 + Math.abs(sd[k + 2]) * 0.8) * scale : 0.0001;
      this.s.set(sc, sc * 1.2, sc);
      this.m.compose(this.p, this.q.setFromEuler(this.e), this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = true;
  }
}

interface FilmShot { from: number; to: number; where: 'deep' | 'interior' | 'home' | 'world'; enter?: () => void; at: (k: number, b: number) => void; }

/** Where each one comes down: the world's own places, the distances the beacon reports in Level 10. */
interface Landing { id: CrewId; at: THREE.Vector3; hit: THREE.Vector3; hours: number; boost: number; from: THREE.Vector3; wide: [THREE.Vector3, THREE.Vector3]; close: [THREE.Vector3, THREE.Vector3]; yaw: number; dir: THREE.Vector3 }

/**
 * "The Scatter": the title sequence between the deck and the wake-up. Every frame is a
 * function of music time, so a slow frame drops, and the picture never drifts off the beat.
 */
export class Montage {
  private set: Cinematic['set'];
  private trails: Trail[] = [];
  private worldTrails: Trail[] = [];
  private embers: Burst;
  private debris: Debris;
  private group = new THREE.Group();
  private crack: THREE.Mesh;
  private shards: Debris;
  private wgroup = new THREE.Group();
  private dust!: Burst; private fire!: Burst; private spray!: Burst; private smoke!: Burst; private scorch!: THREE.Mesh; private ringFx!: THREE.Mesh; private plate!: THREE.Mesh; private heat!: THREE.Mesh; private trunk!: THREE.Mesh;
  private shots: FilmShot[] = [];
  private cur: FilmShot | null = null;
  private cast!: Record<CrewId, Character>;
  private poses: Partial<Record<CrewId, CrewPose>> = {};
  private seen = new Set<CrewId>();
  private posed: Partial<Record<CrewId, CrewPose>> = {};
  private fx: Parameters<Renderer['setFilm']>[0] = {};
  private time = 0;
  private lastCue = -1;
  private onDone: (() => void) | null = null;
  private cues: { b: number; fn: () => void; done?: boolean }[] = [];
  private lands: Landing[] = [];
  private el: { root: HTMLElement; card: HTMLElement; name: HTMLElement; role: HTMLElement; loc: HTMLElement; bar: HTMLElement; title: HTMLElement; main: HTMLElement; sub: HTMLElement };
  private markL = V(-0.9, -1.45, 0); private markR = V(0.9, -1.45, 0);
  private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3(); private tmp3 = new THREE.Vector3();
  playing = false;
  hours = 22;
  /** Night shots are printed brighter than the game's night. */
  boost = 1;
  /** And some of the valley haze is taken out, so distance keeps its detail. */
  fog = 1;
  /** The world camera; its far plane suits the terrain, not the cosmos. */
  wcam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 2600);
  focus = new THREE.Vector3();
  inWorld = false;
  /** Set when the music is really running: seconds on the audio clock. */
  private score: { now: () => number | undefined; stop: () => void } | null = null;
  /** Tests step the picture by hand: the audio clock doesn't drive it then. */
  manual = false;

  constructor(private cine: Cinematic, private getWorld: () => World | null, private view: (scene: THREE.Scene, cam: THREE.PerspectiveCamera, ao: boolean) => void, private playerGlow: () => number, private extras: () => THREE.Object3D[], private ui: { subtitle: (k: string | null, sp?: string) => void; fade: (c: 'black' | 'white', to: number, s: number) => void }) {
    this.set = cine.set;
    const s = this.set.scene;
    s.add(this.group);
    this.group.name = 'film';
    for (let i = 0; i < 6; i++) this.trails.push(new Trail(TRAIL[ORDER[i]], this.group));
    this.embers = new Burst(260, this.group, true, 3);
    this.debris = new Debris(240, this.set.ship.broken.hull, this.group);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, metalness: 0.2, roughness: 0.08, transparent: true, opacity: 0.55, emissive: 0x335577 });
    this.shards = new Debris(160, glassMat, this.group);
    // the crack is drawn once; its reveal is a shader threshold, so it grows from the first impact point
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 1024);
    let sd = 7; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    g.lineCap = 'round';
    const bolt = (x: number, y: number, a: number, len: number, w: number) => {
      g.lineWidth = w; g.strokeStyle = `rgb(${200 + r() * 55},${220 + r() * 35},255)`;
      g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < len; i++) {
        a += (r() - 0.5) * 0.7; x += Math.cos(a) * 24; y += Math.sin(a) * 24; g.lineTo(x, y);
        if (w > 1.2 && r() < 0.12) { g.stroke(); bolt(x, y, a + (r() - 0.5) * 2, len * 0.6, w * 0.6); g.lineWidth = w; g.beginPath(); g.moveTo(x, y); }
      }
      g.stroke();
    };
    for (let i = 0; i < 16; i++) bolt(512, 470, (i / 16) * Math.PI * 2 + r() * 0.3, 22, 3.4);
    const tex = new THREE.CanvasTexture(c);
    this.crack = new THREE.Mesh(new THREE.PlaneGeometry(13, 7), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { tMap: { value: tex }, uK: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tMap; uniform float uK; varying vec2 vUv;
        void main(){ float d = length((vUv - vec2(0.5, 0.54)) * vec2(1.8, 1.0)); vec3 c = texture2D(tMap, vUv).rgb * smoothstep(uK, uK - 0.12, d) * 1.6; gl_FragColor = vec4(c, 1.0); }`,
    }));
    this.crack.position.set(0, 0.2, -3.6);
    this.crack.visible = false;
    this.group.add(this.crack);
    this.el = {
      root: document.getElementById('film')!, card: document.getElementById('film-card')!, name: document.getElementById('fc-name')!, role: document.getElementById('fc-role')!,
      loc: document.getElementById('fc-loc')!, bar: document.getElementById('fc-bar')!, title: document.getElementById('film-title')!, main: document.getElementById('ft-main')!, sub: document.getElementById('ft-sub')!,
    };
    this.script();
  }

  /** Things that live in the world scene: built once the world exists, and compiled during loading. */
  private buildWorldFx(w: World) {
    if (this.dust) return;
    w.scene.add(this.wgroup);
    this.wgroup.name = 'film-world';
    this.dust = new Burst(260, this.wgroup, false, 5);
    this.smoke = new Burst(90, this.wgroup, false, 6);
    this.fire = new Burst(200, this.wgroup, true, 7);
    this.spray = new Burst(320, this.wgroup, false, 8);
    for (let i = 0; i < 2; i++) this.worldTrails.push(new Trail(0xffffff, this.wgroup));
    // scorched ground, draped over the terrain when a landing starts
    const sg = new THREE.PlaneGeometry(1, 1, 30, 30);
    sg.rotateX(-Math.PI / 2);
    this.scorch = new THREE.Mesh(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uColor: { value: new THREE.Color(1, 0.5, 0.2) }, uHeat: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uHeat; varying vec2 vUv;
        void main(){
          vec2 q = vUv - 0.5; float r = length(q) * 2.0, a = atan(q.y, q.x);
          float ragged = r + 0.08 * sin(a * 7.0) + 0.05 * sin(a * 17.0 + 1.0);
          float burn = smoothstep(1.0, 0.45, ragged);
          float ember = smoothstep(0.86, 0.7, ragged) * smoothstep(0.5, 0.72, ragged) * (0.5 + 0.5 * sin(a * 11.0 + r * 30.0));
          gl_FragColor = vec4(mix(vec3(0.006, 0.005, 0.004), uColor * 0.1, ember * uHeat), burn * 0.92);
        }`,
    }));
    this.scorch.frustumCulled = false; this.scorch.visible = false; this.scorch.renderOrder = 2;
    this.wgroup.add(this.scorch);
    this.ringFx = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 64).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uA: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uA; void main(){ gl_FragColor = vec4(uColor * uA * 2.5, 1.0); }`,
    }));
    this.ringFx.visible = false;
    this.wgroup.add(this.ringFx);
    const hull = new THREE.MeshStandardMaterial({ color: 0x3c4148, metalness: 0.7, roughness: 0.62 });
    this.plate = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.5), hull);
    this.plate.visible = false; this.plate.castShadow = true;
    this.wgroup.add(this.plate);
    // the tree that started it. Bigger than anything the forest grows, because it won.
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = '#3a2a20'; g.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 520; i++) { const x = (i * 97) % 256, y = (i * 193) % 512, v = 26 + (i * 31) % 60; g.fillStyle = `rgba(${v},${v * 0.72},${v * 0.55},0.75)`; g.fillRect(x, y, 3 + (i % 9), 30 + (i * 13) % 150); }
    const bark = new THREE.CanvasTexture(c); bark.wrapS = bark.wrapT = THREE.RepeatWrapping; bark.repeat.set(5, 9); bark.magFilter = THREE.LinearFilter; bark.colorSpace = THREE.SRGBColorSpace;
    this.trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.05, 30, 20, 1), new THREE.MeshStandardMaterial({ map: bark, bumpMap: bark, bumpScale: 2, roughness: 0.95 }));
    this.trunk.visible = false; this.trunk.castShadow = true;
    this.wgroup.add(this.trunk);
    this.heat = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color(1, 0.5, 0.2) }, uA: { value: 1 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 p = modelViewMatrix * vec4(position, 1.0); vV = normalize(-p.xyz); gl_Position = projectionMatrix * p; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uA; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(uColor * f * uA * 2.4, 1.0); }`,
    }));
    this.heat.visible = false;
    this.wgroup.add(this.heat);
    this.layout(w);
  }

  /** Everyone's landing spot, from the world as it was generated. */
  private layout(w: World) {
    const T = w.terrain, L = w.layout;
    const at = (x: number, z: number) => V(x, T.height(x, z), z);
    const above = (v: THREE.Vector3, m: number) => { v.y = Math.max(v.y, T.height(v.x, v.z) + m); return v; };
    const slope = (x: number, z: number) => { const e = 2; return Math.hypot(T.height(x + e, z) - T.height(x - e, z), T.height(x, z + e) - T.height(x, z - e)) / (2 * e); };
    /** Flattest, or highest, spot in a box. */
    const find = (x0: number, x1: number, z0: number, z1: number, score: (x: number, z: number) => number) => {
      let best = at((x0 + x1) / 2, (z0 + z1) / 2), top = -Infinity;
      for (let x = x0; x <= x1; x += 6) for (let z = z0; z <= z1; z += 6) { const s = score(x, z); if (s > top) { top = s; best = at(x, z); } }
      return best;
    };
    /** Comets cross the frame on a diagonal: straight down the lens they'd read as nothing. */
    const across = (cam: THREE.Vector3, to: THREE.Vector3, side: number) => {
      const f = to.clone().sub(cam).normalize(), r = f.clone().cross(V(0, 1, 0)).normalize();
      return r.multiplyScalar(side * 0.85).add(V(0, 0.62, 0)).addScaledVector(f, -0.12).normalize();
    };
    const land = (id: CrewId, p: THREE.Vector3, hit: THREE.Vector3, hours: number, boost: number, side: number, wideCam: THREE.Vector3, closeCam: THREE.Vector3, closeTo: THREE.Vector3, yaw: number, dir = V(0, 0, 1)) => {
      const to = hit.clone().add(V(0, 30, 0)); // the sky is where the comet is
      this.lands.push({ id, at: p, hit, hours, boost, from: across(wideCam, to, side), wide: [wideCam, to], close: [above(closeCam, 0.45), closeTo], yaw, dir });
    };
    const face = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(to.x - from.x, to.z - from.z);

    // Draxum: the biggest trunk in the north-east forest, shoulder to bark
    const tp = find(210, 290, -250, -170, (x, z) => -slope(x, z) - (w.forest.blocks(x, z, 4) ? 10 : 0)), td = V(-0.6, 0, 0.8).normalize();
    this.trunk.position.copy(tp).add(V(0, 14, 0)); this.trunk.visible = false;
    const a = tp.clone().addScaledVector(td, 1.85); a.y = T.height(a.x, a.z);
    const aSide = V(td.z, 0, -td.x);
    land('strong', a, a.clone().addScaledVector(td, 6), 18.9, 1.5, 1, above(a.clone().addScaledVector(td, 62).add(V(20, 34, 0)), 30), a.clone().addScaledVector(aSide, 3.1).addScaledVector(td, 0.7).add(V(0, 0.9, 0)), a.clone().add(V(0, 1.45, 0)).addScaledVector(td, -0.5), face(a, tp));

    // Lyrra: splashes down mid-lake, wades to the shore in front of us
    const d = V(-0.75, 0, -0.66).normalize(), c0 = V(LAKE.x, 0, LAKE.z);
    let wade = 0, shore = 0;
    for (let s = 0; s < 120; s += 0.5) { const h = T.height(c0.x + d.x * s, c0.z + d.z * s); if (!wade && h > -0.95) wade = s; if (h > 0.3) { shore = s; break; } }
    const m = c0.clone().addScaledVector(d, wade), sh = c0.clone().addScaledVector(d, shore);
    // the wide sits out over the water: nothing can stand in front of the lens there
    land('medic', m, c0.clone().addScaledVector(d, Math.max(4, wade - 26)), 19.5, 1.05, -1, sh.clone().addScaledVector(d, -7).add(V(0, 5, 0)), sh.clone().add(V(0.6, 0.85, 0)), m.clone().addScaledVector(d, 2).add(V(0, 0.75, 0)), face(c0, sh), d);

    this.lands[1].wide[1].y = 3; // horizon mid-frame, so the splash is in shot

    // Bolzar: a flat rock in the southern hills
    const b = find(10, 90, 290, 370, (x, z) => -slope(x, z) - Math.abs(T.height(x, z) - 30) * 0.002);
    land('builder', b, b.clone(), 20.3, 1.5, 1, above(b.clone().add(V(-50, 30, -44)), 28), b.clone().add(V(-2.2, 1.05, -2.3)), b.clone().add(V(0, 0.75, 0)), face(b, V(b.x - 2.2, 0, b.z - 2.3)));

    // Skyvra: against her pod, which is where the rescue finds her
    const e = L.crewSpot.clone(), away = e.clone().sub(L.pod2).setY(0).normalize(), es = V(away.z, 0, -away.x);
    land('explorer', e, L.pod2.clone(), 4.9, 1.2, -1, above(e.clone().addScaledVector(away, 60).add(V(0, 34, 0)), 30), e.clone().addScaledVector(away, 2.5).addScaledVector(es, 0.9).add(V(0, 0.75, 0)), e.clone().add(V(0, 0.6, 0)).addScaledVector(away, -0.3), face(e, e.clone().addScaledVector(away, 3)));

    // Nuvexa: the highest ledge you could stand on, past the valley
    const s = find(-240, -30, -670, -550, (x, z) => T.height(x, z) - (slope(x, z) > 0.75 ? 1000 : 0));
    const out = V(-s.x, 0, -s.z).normalize();
    land('social', s, s.clone(), 5.25, 1.25, 1, above(s.clone().addScaledVector(out, 120).add(V(30, 30, 0)), 20), s.clone().addScaledVector(out, 2.4).add(V(0.5, 1.5, 0)), s.clone().add(V(0, 1.45, 0)), face(s, s.clone().addScaledVector(out, 3)), out);

    // The player: the clearing where the wake-up starts
    const z = at(0, 2);
    land('scientist', z, z.clone(), 5.8, 1.1, 1, z.clone().add(V(-5, 1.5, 12)), z.clone().add(V(-2.6, 0.55, 3.6)), z.clone().add(V(0, 1.1, 0)), 0.35);
    this.lands[5].wide = [z.clone().add(V(-5, 1.5, 12)), z.clone().add(V(5, 24, -14))];
    this.lands[5].from = V(0.18, 1, -0.4).normalize();
  }

  /** Compile the sequence's world materials while the game loads. */
  warm(w: World, draw: (scene: THREE.Scene, cam: THREE.PerspectiveCamera) => void) {
    this.buildWorldFx(w);
    const shown = [this.scorch, this.ringFx, this.plate, this.heat, this.trunk];
    shown.forEach((o) => (o.visible = true));
    [this.dust, this.smoke, this.fire, this.spray].forEach((b) => b.play(0.1));
    this.worldTrails[0].draw((s, o) => o.set(0, 40 + s * 30, 0), this.wcam, 1, 0);
    this.wcam.position.set(0, 44, 30); this.wcam.lookAt(0, 44, 0); this.wcam.updateMatrixWorld();
    draw(w.scene, this.wcam);
    shown.forEach((o) => (o.visible = false));
    [this.dust, this.smoke, this.fire, this.spray].forEach((b) => (b.points.visible = false));
    this.worldTrails[0].mesh.visible = false;
  }

  private get crew() { const ids: CrewId[] = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social']; return Object.fromEntries(ids.map((id, i) => [id, this.set.interior.crew[i]])) as Record<CrewId, Character>; }

  /** Rolls the sequence; `done` fires at the end or on a skip. */
  async play(done: () => void) {
    this.onDone = done;
    this.cast = this.crew;
    const w = this.getWorld();
    if (w) this.buildWorldFx(w);
    this.cues.forEach((c) => (c.done = false));
    for (const id of ORDER) { const c = this.cast[id]; c.root.rotation.set(0, 0, 0); this.group.add(c.root); c.root.visible = false; }
    this.trails[5].color = this.playerGlow();
    this.time = 0; this.cur = null; this.inWorld = false; this.lastCue = -1;
    this.el.root.classList.remove('hidden');
    this.el.card.style.opacity = '0'; this.el.title.style.opacity = '0';
    this.playing = true;
    this.score = await audio.playScore('theme', 'theme_sfx');
  }

  /** Test hook: jump to a beat. Everything on screen is derived from it. */
  seek(b: number) {
    if (!this.playing) return;
    this.time = b * BEAT;
    this.score = null;
    this.cues.forEach((c) => { c.done = c.b < b; });
  }
  get beat() { return this.time / BEAT; }
  get lengthSeconds() { return beat.length * BEAT; }

  skip() { if (this.playing) this.finish(); }

  private finish() {
    this.playing = false;
    this.score?.stop(); this.score = null;
    this.ui.subtitle(null);
    voice.stop();
    this.clear();
    this.el.root.classList.add('hidden');
    Renderer.current?.setFilm();
    Renderer.current?.setDof(0, 0);
    const { interior, sun, ship } = this.set;
    for (const id of ORDER) {
      const c = this.cast[id];
      c.setLimbs(null); c.setFace(null); c.setLookTarget(null); c.root.visible = true; c.root.quaternion.identity();
      interior.group.add(c.root);
    }
    sun.intensity = 3.2; sun.color.set(0xfff2e0); sun.position.copy(V(1, 0.22, 0.55).normalize()).multiplyScalar(100);
    ship.group.scale.set(1, 1, 1);
    this.mend();
    this.setRig(null);
    const { dome } = this.set;
    dome.uniforms.uWarp.value = 0; dome.uniforms.uOther.value = 0; dome.uniforms.uBH.value = 0;
    const w = this.world();
    if (w) { w.explorer.root.visible = true; w.grass.setClearings(w.clearings); }
    this.extras().forEach((o) => (o.visible = true));
    const f = this.onDone; this.onDone = null;
    this.inWorld = false;
    f?.();
  }

  private world() { return this.getWorld(); }

  private mend() {
    const b = this.set.ship.broken;
    b.spine.visible = true; b.front.visible = false; b.rear.visible = false;
    this.set.ship.ring.position.set(0, 0, 1.2); this.set.ship.ring.rotation.set(0, 0, 0);
    this.set.ship.group.children.forEach((c) => { const u = c.userData.film as { p: THREE.Vector3; q: THREE.Quaternion } | undefined; if (u) { c.position.copy(u.p); c.quaternion.copy(u.q); } });
  }

  /** Hide everything that belongs to one shot only. */
  private clear() {
    for (const tr of [...this.trails, ...this.worldTrails]) tr.mesh.visible = false;
    this.embers.points.visible = false; this.debris.mesh.visible = false; this.shards.mesh.visible = false; this.crack.visible = false;
    if (this.dust) { [this.dust, this.smoke, this.fire, this.spray].forEach((b) => (b.points.visible = false)); [this.scorch, this.ringFx, this.plate, this.heat, this.trunk].forEach((o) => (o.visible = false)); }
    for (const id of ORDER) if (this.cast[id]) { this.cast[id].root.visible = false; this.cast[id].setLimbs(null); this.cast[id].setFace(null); this.cast[id].look2(0, 0); }
    this.seen.clear();
  }

  private act(id: CrewId, p: THREE.Vector3, q: THREE.Quaternion | null, pose: CrewPose, limbs: Limbs | null, face: Face | null = null) {
    const c = this.cast[id];
    c.root.visible = true;
    c.root.position.copy(p);
    if (q) c.root.quaternion.copy(q);
    c.setLimbs(limbs); c.setFace(face);
    this.poses[id] = pose;
    this.seen.add(id);
    return c;
  }

  private lens(from: THREE.Vector3, to: THREE.Vector3, fov: number, focus: number, aperture: number, roll = 0, up: THREE.Vector3 | null = null) {
    const cam = this.inWorld ? this.wcam : this.set.camera;
    cam.position.copy(from);
    cam.up.copy(up ?? this.tmp3.set(0, 1, 0));
    cam.lookAt(to);
    if (roll) cam.rotateZ(roll);
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    Renderer.current?.setDof(focus, aperture);
    return cam;
  }

  private hole(x: number, y: number, z: number, warp = 0, other = 0) {
    const u = this.set.dome.uniforms;
    u.uBH.value = 1; u.uBHPos.value.set(x, y, z); u.uWarp.value = warp; u.uOther.value = other; u.uNebula.value = 0.8;
  }

  private setRig(l: { p: THREE.Vector3; color: number; i: number; d?: number }[] | null) {
    const scene = this.inWorld ? this.world()!.scene : this.set.scene;
    const rig = scene.getObjectByName('cutscene-rig');
    if (!rig) return;
    rig.children.forEach((c, i) => {
      const light = c as THREE.PointLight, s = l?.[i];
      if (s) { light.position.copy(s.p); light.color.set(s.color); light.intensity = s.i; light.distance = s.d ?? 12; } else light.intensity = 0;
    });
  }

  private sun(dir: THREE.Vector3, color: number, i: number) {
    const s = this.set.sun;
    s.position.copy(dir).normalize().multiplyScalar(100); s.color.set(color); s.intensity = i;
  }

  private card(id: CrewId | null, show: number) {
    const e = this.el;
    if (!id) { e.card.style.opacity = '0'; return; }
    if (e.card.dataset.id !== id) {
      e.card.dataset.id = id;
      e.name.textContent = t(`crew.${id}.name`);
      e.role.textContent = t(`crew.${id}.role`);
      e.loc.textContent = t(`film.loc.${id}`);
      const c = new THREE.Color(id === 'scientist' ? this.playerGlow() : TRAIL[id]);
      e.bar.style.background = `#${c.getHexString()}`;
      e.name.style.color = `#${c.clone().lerp(new THREE.Color(1, 1, 1), 0.55).getHexString()}`;
    }
    // slams in from the left, overshoots a touch, settles
    const k = clamp(show, 0, 1), o = 1 - Math.pow(1 - k, 3);
    e.card.style.opacity = String(Math.min(1, k * 3));
    e.card.style.transform = `translateX(${(1 - o) * -60}px) skewX(${(1 - o) * -14}deg)`;
  }

  private script() {
    const P = (from: number, to: number, where: FilmShot['where'], at: FilmShot['at'], enter?: () => void) => this.shots.push({ from, to, where, at, enter });
    const set = this.set, ship = set.ship, tmp = this.tmp;
    const down = V(0, 0, -1);
    this.cues.push(
      { b: 20.4, fn: () => { this.ui.subtitle('cine.line8', 'crew.strong.name'); this.cast.strong.say(voice.duration('cine.line8') ?? 2); } },
      { b: 27.4, fn: () => this.ui.subtitle('op.21', 'crew.explorer.name') },
      { b: 31, fn: () => this.ui.subtitle(null) },
      ...ORDER.slice(0, 5).map((id, i) => ({ b: beat.cards[i] + 0.25, fn: () => { this.ui.subtitle(`film.${id}`, `crew.${id}.name`); this.cast[id].say(voice.duration(`film.${id}`) ?? 1.4); } })),
      ...ORDER.slice(0, 5).map((_, i) => ({ b: beat.impacts[i] + 7, fn: () => this.ui.subtitle(null) })),
      { b: 129.2, fn: () => this.ui.subtitle('film.scientist', 'crew.scientist.name') },
    );

    // ---- Act I: The Horizon ----
    const breakShip = () => {
      const b = ship.broken;
      b.spine.visible = false; b.front.visible = true; b.rear.visible = true;
      ship.group.children.forEach((c) => { if (!c.userData.film) c.userData.film = { p: c.position.clone(), q: c.quaternion.clone() }; });
    };
    P(0, 8, 'deep', (k, b) => {
      const e = easeInOut(k);
      ship.group.position.set(lerp(-1.8, 2, k), 0.5, 0);
      ship.group.rotation.set(0.1, 1.15, lerp(-0.08, 0.05, k));
      set.ship.ring.rotation.z = b * 0.05;
      (ship.plume.material as THREE.ShaderMaterial).uniforms.uPower.value = 0;
      this.hole(4, -3.5, -44);
      this.sun(V(0.4, -0.3, -1), 0xff9a50, 1.2);
      this.lens(V(0, 1.4, 120 - e * 8), V(0, 0.4, 0), 13, 110, 0);
      this.fx = { exposure: 0.42 };
    }, () => { this.mend(); });

    P(8, 16, 'deep', (k, b) => {
      const tt = (b - 8) * BEAT, e = easeInOut(k);
      ship.group.position.set(0, 0, 0);
      ship.group.rotation.set(0, 0, 0.1 + k * 0.25);
      ship.group.scale.set(1 - k * 0.1, 1 - k * 0.1, 1 + k * k * 0.5);
      // front and rear part ways, the ring lets go
      const gap = smoothstep(0.1, 1, k) * 5;
      ship.broken.front.position.z = gap; ship.broken.rear.position.z = -gap * 0.4;
      ship.broken.front.rotation.y = gap * 0.04;
      ship.group.children.forEach((c) => {
        const u = c.userData.film as { p: THREE.Vector3 } | undefined;
        if (!u || c === ship.broken.front || c === ship.broken.rear || c === ship.ring) return;
        c.position.z = u.p.z + (u.p.z > 0 ? gap : -gap * 0.4);
      });
      ship.ring.position.set(k * k * 2.4, k * k * -1.6, 1.2 + gap); ship.ring.rotation.set(k * 0.7, k * 0.3, tt * 0.8);
      this.debris.update(tt, tmp.set(0.05, -0.04, -1).normalize(), 6, 2.4);
      const a = lerp(2.5, 1.7, e);
      const cam = V(Math.sin(a) * 15, 3.4 - k * 1.2, Math.cos(a) * 15 + 2);
      this.hole(-3, -2, -30, 0.1);
      this.sun(V(0.1, 0.2, -1), 0xffa060, 4.5);
      this.lens(cam.add(shakeAt(b, 0.03 + k * 0.05, tmp)), V(0, 0, 1.5), 30, 15, 0.002, Math.sin(b * 0.5) * 0.02);
      this.fx = { exposure: 0.8 };
    }, breakShip);

    // Thrown, not lifted: each one goes at their own moment, and the rotation builds as they go.
    const lift = (id: CrewId, i: number, k: number, b: number) => {
      const t = b * BEAT, go = smoothstep(0.04 * i, 0.5 + 0.05 * i, k), g2 = go * go;
      const mark = DECK[id], side = i % 2 ? 1 : -1;
      const p = V(mark[0] + side * g2 * 0.9 + nz(t * 2.1, i) * 0.25 * go, -2.2 + go * (1.1 + (i % 3) * 0.45) + nz(t * 1.7, i + 3) * 0.2 * go, lerp(mark[1], mark[1] - 3.4, g2));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-g2 * (1.6 + (i % 3) * 0.7) + nz(t * 2, i) * 0.3 * go, Math.PI + (i - 2.5) * 0.15 + side * g2 * 1.8, side * g2 * (1 + (i % 2)) + nz(t * 2.4, i + 7) * 0.25 * go));
      const c = this.act(id, p, q, 'float', mixLimbs(STANDING, flail({ ...FALL.spread, openHands: true }, t, i * 3.1, 0.75), smoothstep(0, 0.3, go)), { fear: 0.4 + 0.5 * go, open: 0.15 + 0.45 * go });
      c.look2(nz(t * 2.4, i + 2) * 0.9, nz(t * 1.8, i + 4) * 0.35);
      return c;
    };
    P(16, 20, 'interior', (k, b) => {
      const tt = (b - 16) * BEAT;
      const i = set.interior;
      const crack = smoothstep(0, 0.3, k);
      this.crack.visible = k < 0.55;
      (this.crack.material as THREE.ShaderMaterial).uniforms.uK.value = crack * 1.5;
      if (k > 0.45) this.shards.update((k - 0.45) * 4, tmp.set(0, 0.05, -1), 1.2, 4, -3.2, 0.3);
      else this.shards.mesh.visible = false;
      ORDER.forEach((id, n) => lift(id, n, k, b));
      i.alarmLight.intensity = 6 + 14 * after(b % 1, 0, 0.6);
      i.mainLight.intensity = 1.2;
      i.consoleLight.intensity = 1.5;
      this.hole(-2, 6, -20, 0.1);
      this.lens(V(-0.3 + k * 0.5, -0.45, 3.7).add(shakeAt(b, 0.012 + k * 0.03, tmp)), V(0, -0.85, -3), 64, 4.5, 0.003, -0.05 + k * 0.09);
      const fl = after(k, 0.45, 0.1) * 0.3;
      this.fx = { flash: [fl, fl, fl * 1.2], exposure: 0.8 };
      void tt;
    }, () => set.show('interior'));

    P(20, 24, 'interior', (k, b) => {
      const i = set.interior;
      i.alarmLight.intensity = 8 + 14 * after(b % 1, 0, 0.6);
      i.mainLight.intensity = 1.2;
      // one hand on the rib, and the whole body swinging from it in the gale
      const t = b * BEAT;
      const p = V(-1.5 + nz(t * 2.6, 1) * 0.22, -1.0 + nz(t * 2.2, 2) * 0.16, -0.2 + nz(t * 1.9, 3) * 0.16);
      const body = flail({ ...FALL.strong, armR: [-0.3, 0.1, 1], foreR: [-0.2, 0.1, 1], openHands: true, hair: [0, 0.4, 1] }, t, 4, 0.5);
      this.act('strong', p, new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5 + nz(t * 2.1, 5) * 0.3, Math.PI * 0.86 + nz(t * 1.7, 6) * 0.3, 0.12 + nz(t * 2.4, 7) * 0.26)), 'float', { ...body, armL: [0.55, 0.85, -0.2], foreL: [0.45, 0.9, -0.1] }, { frown: 0.8, open: 0.45, squint: 0.2 });
      const c = this.cast.strong;
      c.look2(nz(t * 2, 8) * 0.55, nz(t * 1.6, 9) * 0.2);
      // the others go past him and out of the window
      (['explorer', 'builder'] as CrewId[]).forEach((id, n) => {
        const u = clamp((k - 0.12 - n * 0.36) / 0.5, 0, 1);
        if (u <= 0 || u >= 1) { this.cast[id].root.visible = false; return; }
        this.act(id, V(lerp(-2.6, -0.4, u) + n * 0.5, -1.2 + u * 1.1, lerp(1.6, -4.4, u)), new THREE.Quaternion().setFromEuler(new THREE.Euler(u * 5 + n, u * 3.4, u * 2.6)), 'float', flail({ ...FALL.spread, openHands: true }, t, n * 7, 0.9), { fear: 0.9, open: 0.6 });
      });
      const h = c.head.getWorldPosition(tmp);
      this.lens(V(h.x + 1.3 - k * 0.3, h.y - 0.1, h.z - 2.3 + k * 0.5).add(shakeAt(b, 0.012, this.tmp2)), V(h.x, h.y - 0.15, h.z), 34, 2.4, 0.012, 0.06);
      this.setRig([{ p: V(h.x + 1.2, h.y + 0.6, h.z - 1.4), color: 0xff4030, i: 12 }, { p: V(h.x - 1.2, h.y + 0.2, h.z + 1.4), color: 0xff9a50, i: 9 }]);
      this.hole(-2, 6, -18, 0.1);
    }, () => set.show('interior'));

    // Six in a ring above the hole, hand reaching for hand. The ring is breaking.
    P(24, 28, 'deep', (k, b) => {
      const e = easeInOut(k), R = lerp(1.0, 1.9, e * e);
      ship.group.visible = false;
      const spin = b * 0.03;
      ORDER.forEach((id, i) => {
        const a = (i / 6) * Math.PI * 2 + spin;
        const radial = V(Math.cos(a), 0, Math.sin(a));
        const up = radial.clone().negate(), fwd = V(0, -1, 0), left = up.clone().cross(fwd);
        const m = new THREE.Matrix4().makeBasis(left, up, fwd);
        const h = 1.75, t = b * BEAT;
        // the grip is going: arms still reach, bodies pitch and roll against each other, legs kick for nothing
        const roll = new THREE.Quaternion().setFromEuler(new THREE.Euler(nz(t * 1.5, i) * 0.45 * (0.4 + e), nz(t * 1.2, i + 2) * 0.4 * (0.4 + e), nz(t * 1.7, i + 4) * 0.5 * (0.4 + e)));
        const c = this.act(id, radial.clone().multiplyScalar(R + h + nz(t * 1.4, i + 6) * 0.14), new THREE.Quaternion().setFromRotationMatrix(m).multiply(roll), 'float', {
          ...flail({ armL: [1, 0.32, 0.02], armR: [-1, 0.32, 0.02], legL: [0.22, -1, 0.05], shinL: [0.15, -1, 0.3], legR: [-0.2, -1, 0], shinR: [-0.15, -1, 0.25], openHands: true, hair: [0, 0.2, 1] }, t, i * 2.7, 0.22 + 0.3 * e),
        }, { fear: 0.5, frown: 0.5 });
        c.look2(nz(t * 1.6, i + 8) * 0.7, nz(t * 1.3, i + 9) * 0.25);
      });
      this.hole(1.2, -26, -1.2);
      this.fx = { exposure: 0.7 };
      this.sun(V(0.2, -1, 0.1), 0xffb070, 3.5);
      this.setRig([{ p: V(0, 4, 0), color: 0xc8d8ff, i: 70, d: 16 }]);
      this.lens(V(0.3, 8.5 + e * 3.5, 0.4), V(0, 0, 0), 44, 10, 0, 0.3 + b * 0.008, down);
    }, () => set.show('deep'));

    // Two hands, a few centimetres short.
    P(28, 31, 'deep', (k, b) => {
      ship.group.visible = false;
      const gap = 0.1 + k * k * 0.16;
      const fit = (c: Character, side: 'L' | 'R', want: number, id: CrewId, o: THREE.Vector3, tilt: number) => {
        // the arm's length differs per body: steer the body so the wrist lands on its mark
        const w = this.handOf(c, side);
        if (c.root.visible && this.seen.has(id)) o.set(o.x + want - w.x, o.y - w.y, o.z - w.z);
        const t = b * BEAT, loose = flail({ ...FALL.spread, openHands: true }, t, side === 'L' ? 3 : 9, 0.3);
        return this.act(id, o, new THREE.Quaternion().setFromEuler(new THREE.Euler(nz(t * 1.1, 2) * 0.1, nz(t * 0.9, 4) * 0.1, tilt + nz(t, side === 'L' ? 6 : 8) * 0.08)), 'float', side === 'L'
          ? { ...loose, armL: [1, 0.05 + nz(t * 2, 1) * 0.06, nz(t * 1.6, 3) * 0.05], foreL: [1, 0.02 + nz(t * 2.4, 2) * 0.08, nz(t * 1.9, 5) * 0.06] } : { ...loose, armR: [-1, 0.05 + nz(t * 2, 7) * 0.06, nz(t * 1.6, 9) * 0.05], foreR: [-1, 0.02 + nz(t * 2.4, 8) * 0.08, nz(t * 1.9, 11) * 0.06] }, FACE[id]);
      };
      fit(this.cast.explorer, 'L', -gap, 'explorer', this.markL, -0.03);
      fit(this.cast.scientist, 'R', gap, 'scientist', this.markR, 0.03);
      this.hole(0.5, 0.3, -30);
      this.sun(V(0, 0.2, -1), 0xffa060, 3);
      this.setRig([{ p: V(0.1, 0.5, 0.9), color: 0xbfd6ff, i: 3, d: 4 }, { p: V(-0.6, -0.3, -0.6), color: 0xff9a50, i: 2.5, d: 4 }]);
      const dist = lerp(0.95, 0.82, k);
      this.lens(V(lerp(-0.08, 0.08, k), 0.05, dist), V(0, 0, 0), 26, dist, 0.012, -0.06);
      this.fx = { exposure: 0.5 };
    }, () => set.show('deep'));

    P(31, 32, 'deep', () => { ship.group.visible = false; this.hole(0, 0, -6000); this.lens(V(0, 0, 0), V(0, 0, -1), 40, 0, 0); this.fx = { flash: [-1, -1, -1] }; }, () => set.show('deep'));

    // ---- Act II: The Scatter ----
    const dirs = [V(1, 0.5, 0.2), V(-1, 0.65, 0.1), V(0.35, -1, 0.2), V(-0.75, -0.75, 0.3), V(0.9, -0.3, 0.6), V(-0.1, 0.95, 0.5)].map((d) => d.normalize());
    P(32, 36, 'deep', (k, b) => {
      ship.group.visible = false;
      const tt = (b - 32) * BEAT, e = 1 - Math.pow(1 - k, 3);
      this.lens(V(0, 0, lerp(10, 44, e)).add(shakeAt(b, 0.3 * (1 - k), tmp)), V(0, 0, 0), lerp(70, 46, e), 0, 0);
      this.hole(0, 0, -34, 0.35);
      const cam = set.camera;
      this.trails.forEach((tr, i) => {
        const len = 22 + e * 26, d = dirs[i];
        tr.draw((s, o) => { o.copy(d).multiplyScalar(len * (1 - s * 0.97)); o.x += Math.sin(s * 3 + i) * s * 2; o.y += Math.cos(s * 3 + i) * s * 2; }, cam, 1 + (1 - k) * 0.8, b);
      });
      this.embers.set({ at: V(0, 0, 0), c0: 0xfff2d0, c1: 0xff8040, life: 2, speed: 40, drag: 1.2, grav: 0, size: 0.2, grow: 0.2, stagger: 0, squash: [1, 1, 0.3] }).play(tt);
      const f = after(b, 32, 1.1);
      this.fx = { flash: [f * 1.2, f * 1.15, f * 1.1], zoom: 0.12 * (1 - k), lines: 0.8 * (1 - k), exposure: 0.7 };
    }, () => set.show('deep'));

    const fly = (from: number, to: number, id: CrewId, n: number, o: { cam: (k: number) => THREE.Vector3; aim?: THREE.Vector3; roll?: (k: number) => number; spin?: (b: number) => THREE.Euler; dir: THREE.Vector3; fov?: number; thrash?: number }) => {
      P(from, to, 'deep', (k, b) => {
        ship.group.visible = false;
        const eu = o.spin ? o.spin(b) : new THREE.Euler(-1.1, 0, 0);
        const t = b * BEAT;
        const c = this.act(id, V(nz(t * 2.6, n) * 0.3, -0.9 + nz(t * 2.2, n + 3) * 0.3, nz(t * 2, n + 6) * 0.25), new THREE.Quaternion().setFromEuler(eu), 'float', flail(FALL[id], t, n * 4.3, o.thrash ?? 0.8), FACE[id]);
        c.look2(nz(t * 2.7, n + 1) * 0.8, nz(t * 2.1, n + 2) * 0.3);
        const col = id === 'scientist' ? this.playerGlow() : TRAIL[id];
        const h = c.chest.getWorldPosition(tmp).clone();
        const cam = this.lens(o.cam(k).add(shakeAt(b, 0.012, this.tmp2)), o.aim ?? h, o.fov ?? 32, 3.2, 0.006, o.roll ? o.roll(k) : 0);
        const dir = o.dir, tr = this.trails[n];
        tr.color = col;
        tr.draw((s, out) => { out.copy(h).addScaledVector(dir, -s * 34); out.x += Math.sin(s * 6 + b * 2) * s * 0.9; out.y += Math.cos(s * 5 + b * 2) * s * 0.9; }, cam, 0.34, b, 0.7);
        this.embers.set({ at: h, c0: col, c1: col, life: 0.8, speed: 3, drag: 0.5, grav: 0, size: 0.03, grow: 0.5, stagger: 0.4, lift: [-dir.x * 18, -dir.y * 18, -dir.z * 18] }).play(0.4 + (b % 2) * BEAT);
        this.setRig([{ p: h.clone().addScaledVector(dir, -1.2).add(V(0.3, 0.6, 0)), color: col, i: 26, d: 7 }, { p: cam.position.clone().add(V(0.6, 1, 0)), color: 0xe8efff, i: 7, d: 8 }]);
        const u = set.dome.uniforms;
        u.uWarpDir.value.copy(dir).negate();
        this.hole(30 * dir.x, 30 * dir.y, -70, 0.5);
        const hit = after(b, from, 0.5);
        this.fx = { zoom: 0.02 + hit * 0.05, flash: [hit * 0.1, hit * 0.1, hit * 0.1], lines: 0.15, exposure: 0.75 };
      }, () => set.show('deep'));
    };
    fly(36, 38, 'strong', 0, { dir: V(0.8, 0.1, -0.6).normalize(), cam: (k) => V(lerp(3.2, 2.2, k), 0.4, 3.4), roll: (k) => 0.3 - k * 0.5, spin: (b) => new THREE.Euler(-1.0 + b * 0.5, b * 1.5, 0.4 + b * 0.35), thrash: 1 });
    fly(38, 40, 'medic', 1, { dir: V(-0.9, 0.2, -0.2).normalize(), cam: (k) => V(-1.3, -1.6 + k * 0.5, 2.8), roll: (k) => -0.25 + k * 0.3, spin: (b) => new THREE.Euler(-0.3 + (b - 38) * 0.32, 0.3 + (b - 38) * 0.22, -0.5 + (b - 38) * 0.5), thrash: 0.3 });
    fly(40, 42, 'explorer', 2, { dir: V(0.2, -0.3, 0.92).normalize(), cam: (k) => V(0.8, 0.6, -3.1 - k * 0.8), spin: (b) => new THREE.Euler(0.8 + nz(b, 1) * 0.5, Math.PI + nz(b * 0.8, 2) * 0.6, 0.15 + (b - 40) * 0.8), thrash: 0.85 });
    fly(42, 44, 'builder', 3, { dir: V(-0.3, 0.2, 0.9).normalize(), cam: (k) => V(0.5, -0.5, lerp(5, 2.1, k)), spin: (b) => new THREE.Euler(-0.5 + (b - 42) * 0.7, 0.2 + nz(b, 3) * 0.4, 0.2 + (b - 42) * 0.9), thrash: 0.55 });
    fly(44, 46, 'social', 4, { dir: V(-0.95, -0.1, 0.25).normalize(), cam: (k) => V(0.3, 0.7, 3.2 - k * 0.7), roll: (k) => 0.35 - k * 0.3, spin: (b) => new THREE.Euler(-0.4 + (b - 44) * 0.9, -0.5 + (b - 44) * 1.1, 0.5 + nz(b, 5) * 0.5), thrash: 0.75 });
    fly(46, 48, 'scientist', 5, { dir: V(0, -0.1, 1).normalize(), cam: (k) => V(0.15, 0.3, lerp(1.9, 3.8, k)), spin: (b) => new THREE.Euler(-0.15 + nz(b * 0.9, 7) * 0.4, nz(b * 0.7, 8) * 0.5, 0.08 + (b - 46) * 0.7), thrash: 0.85 });

    P(48, 52, 'deep', (k, b) => {
      ship.group.visible = false;
      const z = -(b - 48) * 26;
      const cam = this.lens(V(Math.sin(b * 0.7) * 0.6, Math.cos(b * 0.55) * 0.5, z), V(0, 0, z - 20), lerp(70, 104, k), 0, 0, b * 0.09);
      this.trails.forEach((tr, i) => {
        tr.color = i === 5 ? this.playerGlow() : TRAIL[ORDER[i]];
        const ph = (i / 6) * 6.283;
        tr.draw((s, o) => { const zz = z - 34 + s * 70, a = ph + zz * 0.09, r = 3.2 + Math.sin(zz * 0.05 + i) * 1.4; o.set(Math.cos(a) * r, Math.sin(a) * r, zz); }, cam, 0.3, b, 0.9);
      });
      const u = set.dome.uniforms;
      u.uWarpDir.value.set(0, 0, -1);
      this.hole(0, 0, -2600, 1.3, smoothstep(0, 1, k));
      set.dome.uniforms.uBH.value = 0;
      this.fx = { zoom: 0.04 + k * 0.08, lines: 0.3 + k * 0.5, exposure: 0.8 };
    }, () => set.show('deep'));

    const face = (from: number, to: number, id: CrewId) => P(from, to, 'deep', (k, b) => {
      ship.group.visible = false;
      const c = this.act(id, V(0, -1.62, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.02, 0.28 * (id === 'medic' ? -1 : 1), 0.02)), 'float', { ...FALL[id], hair: [0.3, 1, 0] }, FACE[id]);
      const h = c.head.getWorldPosition(tmp).clone();
      const push = 1 - k * 0.1;
      this.lens(h.clone().add(V(0.1, 0.07, 0.95 * push)), h.clone().add(V(0, 0.06, 0)), 30, 0.95, 0);
      const col = id === 'scientist' ? this.playerGlow() : TRAIL[id];
      const u = set.dome.uniforms; u.uBH.value = 0; u.uOther.value = 1; u.uWarp.value = 0.4;
      this.setRig([{ p: h.clone().add(V(0.7, 0.5, 0.9)), color: 0xffffff, i: 3, d: 5 }, { p: h.clone().add(V(-0.7, 0.2, -0.6)), color: col, i: 9, d: 5 }]);
      const ink = 1 - smoothstep(0.3, 0.5, k);
      this.fx = { ink, dark: new THREE.Color(col).multiplyScalar(0.12), light: new THREE.Color(col).lerp(new THREE.Color(1, 1, 1), 0.8), lines: 0.4 * ink, exposure: 0.8 };
    }, () => set.show('deep'));
    const fh = beat.faceHits;
    ORDER.forEach((id, i) => face(fh[i], fh[i + 1] ?? S.planet, id));

    P(56, 62, 'home', (k, b) => {
      const e = easeInOut(k);
      const a = lerp(-0.55, -0.32, e);
      const cam = this.lens(V(Math.sin(a) * 1160, 160 - e * 40, Math.cos(a) * 1160), V(-90, -30 + e * 60, 0), 34, 0, 0, -0.1 + e * 0.05);
      this.trails.forEach((tr, i) => {
        tr.color = i === 5 ? this.playerGlow() : TRAIL[ORDER[i]];
        const start = V(-420 + i * 90, 520 - i * 24, 380 - i * 40), end = V(-210 + i * 42 + Math.sin(i * 3) * 30, 90 + Math.cos(i * 2) * 40, 330 - i * 12);
        const head = smoothstep(0.1 + i * 0.05, 0.85 + i * 0.02, k);
        tr.draw((s, o) => o.lerpVectors(start, end, Math.max(0, head - s * 0.32)), cam, 1.6 + head * 1.6, b, head > 0 ? 1.6 : 0);
      });
      const u = set.dome.uniforms;
      u.uBH.value = 0; u.uWarp.value = 0; u.uOther.value = 0; u.uNebula.value = 0.6;
      const pf = after(b, 56, 0.6) * 0.15;
      this.fx = { flash: [pf, pf, pf], exposure: 1 };
    }, () => set.show('home'));

    // ---- Act III: The Landing ----
    ORDER.slice(0, 5).forEach((id, i) => {
      const imp = beat.impacts[i], nextTo = imp + 6;
      P(imp - 2, imp + 1.5, 'world', (k, b) => this.wide(id, b, imp), () => this.setLand(id));
      P(imp + 1.5, nextTo, 'world', (k, b) => this.closeShot(id, k, b, imp));
    });

    // ---- Act IV: The player comes down ----
    P(102, 108, 'world', (k, b) => this.lookUp(k, b), () => this.setLand('scientist'));
    P(108, 112, 'world', (k, b) => this.falling(k, b, 0));
    P(112, 116, 'world', (k, b) => this.falling(k, b, 1));
    P(116, 118, 'world', (k, b) => this.falling(k, b, 2));
    P(118, 119, 'world', (k, b) => this.falling(k, b, 3));
    P(119, 120, 'world', (k, b) => this.falling(k, b, 4));
    P(120, S.end + 1, 'world', (k, b) => this.titleShot(k, b));
  }

  private handOf(c: Character, side: 'L' | 'R') { return (side === 'L' ? c.handL : c.handR).getWorldPosition(new THREE.Vector3()); }
  private land(id: CrewId) { return this.lands.find((l) => l.id === id)!; }

  private setLand(id: CrewId) {
    const w = this.world();
    if (!w) return;
    const l = this.land(id), T = w.terrain;
    this.hours = l.hours; this.boost = l.boost; this.fog = id === 'social' || id === 'scientist' ? 0.3 : 0.75;
    w.grass.setClearings([[l.at.x, l.at.z, 11], [l.hit.x, l.hit.z, 9]]);
    const size = id === 'medic' ? 1 : 15;
    const pos = this.scorch.geometry.getAttribute('position') as THREE.BufferAttribute;
    const base = this.scorchXZ ??= Float32Array.from({ length: pos.count * 2 }, (_, i) => (i % 2 ? pos.getZ(i >> 1) : pos.getX(i >> 1)));
    this.scorch.position.set(l.hit.x, 0, l.hit.z);
    this.scorch.scale.set(size, 1, size);
    for (let i = 0; i < pos.count; i++) pos.setY(i, T.height(l.hit.x + base[i * 2] * size, l.hit.z + base[i * 2 + 1] * size) + 0.12);
    pos.needsUpdate = true;
    (this.scorch.material as THREE.ShaderMaterial).uniforms.uColor.value.set(id === 'scientist' ? this.playerGlow() : TRAIL[id]);
  }
  private scorchXZ: Float32Array | null = null;

  /** The comet comes in on a long lens; the hit lands exactly on the downbeat. */
  private wide(id: CrewId, b: number, imp: number) {
    const l = this.land(id), col = TRAIL[id];
    const k = b < imp ? clamp((b - (imp - 2)) / 2, 0, 1) : 1;
    const head = this.tmp.copy(l.hit).addScaledVector(l.from, 58 * (1 - k)); // on screen for the whole approach
    const sh = shakeAt(b, b >= imp ? 0.7 * after(b, imp, 1.2) : 0.03, this.tmp2);
    const cam = this.lens(this.tmp3.copy(l.wide[0]).add(sh).clone(), l.wide[1], 38, 0, 0);
    if (b < imp) {
      const tr = this.worldTrails[0]; tr.color = col;
      const h = head.clone();
      tr.draw((s, o) => o.copy(h).addScaledVector(l.from, s * 150), cam, 2.6, b, 2.2);
    } else this.worldTrails[0].mesh.visible = false;
    this.impact(l, id, (b - imp) * BEAT, col);
    const f = after(b, imp, 0.45) * 0.8;
    const c = new THREE.Color(col).lerp(new THREE.Color(1, 1, 1), 0.7);
    this.fx = { flash: [c.r * f, c.g * f, c.b * f], zoom: 0.06 * after(b, imp, 0.6) };
  }

  /** Everything that happens at the point of impact, from `tt` seconds after it. */
  private impact(l: Landing, id: CrewId, tt: number, col: number) {
    const on = tt >= 0;
    const at = l.hit;
    this.scorch.visible = on && id !== 'medic';
    if (id === 'medic') {
      this.spray.set({ at, c0: 0xe0f4ff, c1: 0x8fb0c8, life: 1.8, speed: 26, drag: 0.9, grav: 7, size: 0.5, grow: 2, stagger: 0.1, squash: [0.4, 1.6, 0.4], alpha: 0.85 }).play(on ? tt : -1);
      this.smoke.set({ at, c0: 0xd0e4f0, c1: 0x708090, life: 1.6, speed: 12, drag: 1.1, grav: 0, size: 2, grow: 3, stagger: 0.1, squash: [1.2, 0.3, 1.2], lift: [0, 1, 0], alpha: 0.28 }).play(on ? tt : -1);
    } else {
      this.dust.set({ at, c0: 0x4b3a2c, c1: 0x2a2520, life: 2.6, speed: 24, drag: 1.3, grav: 1.6, size: 1.1, grow: 2.6, stagger: 0.05, squash: [1, 1.2, 1], alpha: 0.9 }).play(on ? tt : -1);
      this.smoke.set({ at, c0: 0x2e2a28, c1: 0x121214, life: 6, speed: 3, drag: 1, grav: 0, size: 1.6, grow: 3.2, stagger: 2.4, squash: [1, 0.5, 1], lift: [0.6, 3.4, 0.2], alpha: 0.55 }).play(on ? tt : -1);
    }
    this.fire.set({ at, c0: new THREE.Color(col).lerp(new THREE.Color(1, 1, 1), 0.4), c1: col, life: 1.2, speed: 30, drag: 1.4, grav: 5, size: 0.22, grow: 0.5, stagger: 0.1, squash: [1, 1.3, 1] }).play(on ? tt : -1);
    const glow = on ? Math.exp(-tt * 1.1) : 0;
    this.setRig([{ p: at.clone().add(this.tmp3.set(0, 4, 0)), color: col, i: 260 * glow + 14, d: 70 }]);
    this.focus.copy(at);
  }

  /** The dust settles, the card lands, one beat of character. */
  private closeShot(id: CrewId, k: number, b: number, imp: number) {
    const l = this.land(id), col = TRAIL[id], tt = (b - imp) * BEAT;
    this.impact(l, id, tt, col);
    const q = (x: number, y: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, 0, 'YXZ'));
    const p = l.at.clone(), yaw = l.yaw;
    const cam = l.close[0].clone(), to = l.close[1].clone();
    const drift = easeInOut(k);
    let fov = 34;
    switch (id) {
      case 'strong':
        this.trunk.visible = true;
        // shoulder to the trunk, feet dug in. The tree has not noticed.
        this.act(id, p, q(0.2, yaw), 'float', { armL: [0.42, -0.12, 1], foreL: [0.1, 0.1, 1], armR: [-0.42, -0.05, 1], foreR: [-0.1, 0.16, 1], legL: [0.12, -1, 0.3], shinL: [0.1, -1, -0.15], legR: [-0.14, -1, -0.5], shinR: [-0.1, -1, -0.75], bend: 0.25, openHands: true }, { frown: 0.95, squint: 0.5, open: 0.1 });
        cam.add(V(0.25, 0, 0.2).multiplyScalar(drift));
        break;
      case 'medic': {
        const w = this.world()!, s = lerp(-1.8, 1.0, drift), wx = p.x + l.dir.x * s, wz = p.z + l.dir.z * s;
        this.act(id, V(wx, w.terrain.height(wx, wz), wz), q(0, yaw), 'walk', { armL: [0.55, -0.7, 0.1], armR: [-0.55, -0.7, 0.1] }, { smile: 0.05, squint: 0.15 });
        to.set(wx, w.terrain.height(wx, wz) + 1.4, wz); fov = 20;
        break;
      }
      case 'builder':
        this.plate.visible = true; this.plate.position.copy(p).add(V(0, 0.16, 0)); this.plate.rotation.set(-0.06, yaw, 0.1);
        this.act(id, p.clone().add(V(0, 0.2, 0)), q(0, yaw), 'sit', { armR: [-0.65, 0.4, 0.65], foreR: [-0.1, 1, 0.3] }, { smile: 0.55, frown: 0.3, squint: 0.2 });
        break;
      case 'explorer':
        this.act(id, p, q(0, yaw), 'injured', null, { frown: 0.5, squint: 0.25 });
        break;
      case 'social':
        this.act(id, p, q(0, yaw), 'selfie', null, { smile: 0.85 });
        fov = 30;
        break;
    }
    const pos = cam.add(shakeAt(b, 0.012 * after(b, imp + 1, 1.5), this.tmp2)).clone();
    this.lens(pos, to, fov, pos.distanceTo(to), 0.01);
    const side = this.tmp3.copy(to).sub(pos).cross(V(0, 1, 0)).normalize().clone();
    const back = to.clone().sub(pos).setY(0).normalize();
    this.setRig([
      { p: pos.clone().lerp(to, 0.45).addScaledVector(side, 1.2).add(V(0, 1.1, 0)), color: 0xffe8d0, i: 9, d: 10 },
      { p: to.clone().addScaledVector(back, 1.3).addScaledVector(side, -1).add(V(0, 0.7, 0)), color: col, i: 3.5, d: 7 },
    ]);
    this.card(id, (b - (imp + 1.75)) / 0.5);
    if (b >= imp + 5.6) this.el.card.style.opacity = '0';
  }

  /** From the clearing: one light up there, and it is getting bigger. */
  private lookUp(k: number, b: number) {
    const l = this.land('scientist');
    const cam = this.lens(l.wide[0], l.wide[1], 46, 0, 0, 0);
    const c = this.playerGlow();
    const head = l.at.clone().addScaledVector(l.from, lerp(1500, 520, k * k));
    const tr = this.worldTrails[0]; tr.color = c;
    tr.draw((s, o) => o.copy(head).addScaledVector(l.from, s * 500), cam, 4 + k * 8, b, 2);
    this.focus.copy(l.at);
  }

  /** The player, in pieces of a fall that gets shorter and closer every cut. */
  private falling(k: number, b: number, n: number) {
    const l = this.land('scientist'), col = this.playerGlow();
    const u = (b - 108) / 12; // 0 at the first cut, 1 at the ground
    const alt = 480 * Math.pow(1 - u, 1.6) + 8;
    const p = l.at.clone().addScaledVector(l.from, alt);
    const c = this.act('scientist', p, new THREE.Quaternion().setFromEuler(new THREE.Euler(1.3, 0.25, Math.sin(b * 0.4) * 0.2)), 'float', { ...FALL.scientist, armL: wob(FALL.scientist.armL!, b, 1, 0.08), armR: wob(FALL.scientist.armR!, b, 3, 0.08), hair: [0, 0, -1] }, { fear: 0.95, open: 0.65 });
    c.root.updateWorldMatrix(true, true);
    const chest = c.chest.getWorldPosition(this.tmp).clone(), hd = c.head.getWorldPosition(this.tmp2).clone();
    const sh = shakeAt(b, 0.03 + u * 0.12, this.tmp3).clone();
    let cam: THREE.PerspectiveCamera;
    if (n === 0) cam = this.lens(chest.clone().add(V(-2.2, 0.8, 3.1)).add(sh), chest, 30, 3.5, 0.004, 0.35);
    else if (n === 1) cam = this.lens(chest.clone().add(V(0.3, 2.8, -0.9)).add(sh), l.at, 54, 3, 0.002, b * 0.03);
    else if (n === 2) cam = this.lens(hd.clone().add(V(0.35, -1.0, 0.5)).add(sh), hd, 32, 1.1, 0.008, -0.2);
    else if (n === 3) cam = this.lens(hd.clone().add(V(0.12, -0.52, 0.28)).add(sh), hd, 26, 0.6, 0.008, 0.25);
    else cam = this.lens(chest.clone().add(V(0, -1.1, 0.2)).add(sh), l.at, 76, 0, 0, 0);
    const tr = this.worldTrails[0]; tr.color = col;
    const dir = l.from;
    tr.draw((s, o) => o.copy(chest).addScaledVector(dir, 0.6 + s * 60), cam, 0.42, b, 0.7);
    this.fire.set({ at: chest, c0: 0xffffff, c1: col, life: 0.7, speed: 3, drag: 0.5, grav: -40, size: 0.05, grow: 0.5, stagger: 0.6 }).play(0.6 + (b % 1) * 0.3);
    this.setRig([{ p: chest.clone().add(V(0, -2, 0.5)), color: col, i: 5, d: 8 }, { p: chest.clone().add(V(1.5, 1.5, 2)), color: 0xfff0e0, i: 4, d: 7 }]);
    this.card('scientist', n === 0 ? (b - 109) / 0.5 : 0);
    if (n > 0) this.el.card.style.opacity = '0';
    const hit = after(b % 1, 0, 0.5) * (0.05 + u * 0.15) + (n === 4 ? k * k * 1.4 : 0);
    this.fx = { zoom: 0.015 + u * 0.07, lines: u * 0.5, flash: [hit, hit, hit] };
    this.focus.copy(p);
  }

  /** The hit. White, then the title over the clearing at dawn. */
  private titleShot(k: number, b: number) {
    const l = this.land('scientist'), col = this.playerGlow();
    const tt = (b - S.hit) * BEAT;
    this.hours = l.hours;
    const e = easeInOut(clamp((b - S.hit) / 12, 0, 1));
    this.lens(l.close[0].clone().lerp(this.tmp.copy(l.close[0]).add(V(0.9, 0.05, -1.1)), e), l.close[1], 40, 0, 0);
    this.impact(l, 'scientist', tt + 0.3, col);
    // face down at the end of his own furrow. Two doctorates.
    this.act('scientist', l.at.clone().add(V(0, 0.2, 0)), new THREE.Quaternion().setFromEuler(new THREE.Euler(1.5, 2.2, 0, 'YXZ')), 'float', { armL: [1, 0.3, 0.05], foreL: [0.9, 0.5, 0.05], armR: [-1, 0.25, 0.05], foreR: [-0.9, 0.5, 0.05], legL: [0.2, -1, 0], shinL: [0.18, -1, 0.1], legR: [-0.16, -1, 0], shinR: [-0.2, -1, -0.05] }, { blink: 0.92 });
    this.boost = 1.5;
    this.setRig([{ p: l.at.clone().add(V(-2.4, 3, 3)), color: 0xffd8b0, i: 30, d: 14 }, { p: l.at.clone().add(V(2.5, 2, -2)), color: 0xff9a70, i: 14, d: 10 }]);
    const f = after(b, S.hit, 1.6);
    const out = smoothstep(S.end - 1.5, S.end, b);
    this.fx = { flash: [f * 1.4 - out, f * 1.4 - out, f * 1.4 - out] };
    const ti = this.el, on = smoothstep(S.hit + 0.15, S.hit + 0.7, b);
    if (ti.main.textContent === '') { ti.main.textContent = t('title.name'); ti.sub.textContent = t('film.sub'); }
    ti.title.style.opacity = String(on * (1 - smoothstep(S.end - 1.5, S.end - 0.4, b)));
    ti.main.style.letterSpacing = `${0.32 - 0.1 * easeInOut(clamp((b - S.hit) / 10, 0, 1))}em`;
    ti.main.style.transform = `scale(${1 + 0.35 * Math.exp(-Math.max(0, b - S.hit) * 3.2)})`;
    this.card(null, 0);
  }

  /** Advance on the music's clock; without music, on the frame clock. */
  update(dt: number) {
    if (!this.playing) return;
    const now = this.manual ? undefined : this.score?.now();
    this.time = now !== undefined ? Math.max(now, this.time) : this.time + dt;
    const b = this.time / BEAT;
    if (b >= S.end) { this.finish(); return; }
    const land = !!this.world();
    const bb = !land && b >= S.landing - 2 ? S.end - 0.01 : b;
    if (bb !== b) { this.finish(); return; }
    const shot = this.shots.find((s) => b >= s.from && b < s.to) ?? null;
    this.fx = {};
    if (shot && shot !== this.cur) {
      const wasWorld = this.inWorld;
      this.clear();
      this.card(null, 0);
      this.cur = shot;
      this.inWorld = shot.where === 'world';
      if (this.inWorld && !wasWorld) {
        const w = this.world()!;
        for (const id of ORDER) w.scene.add(this.cast[id].root);
        w.explorer.root.visible = false;
        this.extras().forEach((o) => (o.visible = false));
        this.view(w.scene, this.wcam, true);
      } else if (!this.inWorld && wasWorld) {
        for (const id of ORDER) this.group.add(this.cast[id].root);
        this.view(this.set.scene, this.set.camera, false);
      }
      if (!this.inWorld) this.set.show(shot.where as 'deep' | 'interior' | 'home');
      this.setRig(null);
      shot.enter?.();
    }
    for (const c of this.cues) if (!c.done && b >= c.b) { c.done = true; c.fn(); }
    if (shot) shot.at(clamp((b - shot.from) / (shot.to - shot.from), 0, 1), b);
    for (const id of this.seen) {
      const c = this.cast[id];
      c.root.updateMatrixWorld();
      const pose = this.poses[id] ?? 'float';
      // a cut is a cut: the body is already in its pose, it doesn't blend there on camera
      if (this.posed[id] !== pose) { this.posed[id] = pose; c.animate(pose, 0, 0, this.time, 1.2); }
      c.animate(pose, 0, 0, this.time, dt);
    }
    this.set.tick(dt);
    if (shot && this.inWorld) this.set.camera.updateMatrixWorld();
    Renderer.current?.setFilm(this.fx);
  }
}

const DECK: Record<string, [number, number]> = { social: [-1.5, 1.4], strong: [-0.25, 2.0], medic: [1.15, 1.75], explorer: [1.95, 0.75], builder: [-2.5, 0.5], scientist: [0.3, -0.45] };
