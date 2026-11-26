import * as THREE from 'three';
import { createSpaceDome } from '../cinematic/space';
import { createCharacter, Character, CrewPose } from '../characters/character';
import { voice } from '../core/voice';
import { t } from '../i18n';
import { smoothstep } from '../core/noise';
import { audio } from '../core/audio';
import { Renderer } from '../core/renderer';
import { sceneSound } from '../core/soundscape';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Soft round sprite so dust near the lens isn't a square. */
function dot() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d')!, r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, '#fff'); r.addColorStop(0.35, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/**
 * One camera move: from `a` to `b` (through `via` if given: a crane or an arc, never a cut), looking from `la` to `lb`,
 * focus from `fa` to `fb` metres (a rack focus between `rack[0]` and `rack[1]` of the beat), lens `fov`.
 */
export interface Move { a: THREE.Vector3; b: THREE.Vector3; via?: THREE.Vector3; la: THREE.Vector3; lb?: THREE.Vector3; look?: [number, number]; fov?: [number, number]; fa?: number; fb?: number; rack?: [number, number]; ap?: number; ease?: 'io' | 'out' | 'lin' }
/** What he does in a beat of the entrance. */
export interface Act { walk?: THREE.Vector3[]; face?: [number, number, number?]; gaze?: 'cam' | 'book' | 'window' | 'down' | null; gazeAt?: number; pose?: CrewPose; lamp?: [number, number]; glow?: [number, number]; note?: 'on' | 'off' | 'swell' | 'resolve'; page?: number; taps?: number[]; scratch?: [number, number]; steps?: [number, number] }

/** One spoken line with a gesture and a camera set-up (the visits), or a beat of the entrance with its move and acting. */
export interface VaultLine { key: string; pose?: CrewPose; shot?: VaultShot; after?: number; move?: Move; act?: Act; min?: number; lead?: number }
export type VaultShot = 'wide' | 'push' | 'close' | 'hands' | 'orrery' | 'window' | 'profile' | 'low';

const SHOTS: Record<VaultShot, { a: THREE.Vector3; b: THREE.Vector3; to: THREE.Vector3 }> = {
  wide: { a: V(0.15, 2.05, 3.2), b: V(-0.2, 2.05, 2.7), to: V(0, 1.75, 0) },
  push: { a: V(-1.1, 1.9, 4.2), b: V(-0.75, 1.92, 3.1), to: V(0, 1.85, 0) },
  close: { a: V(0.42, 2.0, 1.42), b: V(0.3, 2.0, 1.16), to: V(0, 1.9, 0) },
  profile: { a: V(1.7, 1.98, 0.5), b: V(1.45, 1.98, 0.62), to: V(0, 1.82, 0.1) },
  low: { a: V(-1.2, 0.5, 2.4), b: V(-0.95, 0.56, 2.1), to: V(0, 2.2, 0) },
  hands: { a: V(0.9, 1.75, 1.75), b: V(0.75, 1.65, 1.5), to: V(0, 1.22, 0.75) },
  orrery: { a: V(-2.6, 1.35, 1.8), b: V(-2.45, 1.6, 1.3), to: V(-3.2, 2.9, -1.6) },
  window: { a: V(0.3, 1.5, 3.2), b: V(0.1, 1.55, 2.2), to: V(0, 4.6, -18) },
};

/** Where the black hole is, in the room's metres (the dome draws it ray-marched from wherever the camera stands). */
const BH_AT = V(0, 24, -96);
/** Metres per Schwarzschild radius of the dome's black hole. */
const BH_SCALE = 2.0;
const BH_ROT = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.3, 0, -0.24))).transpose();

/** The room's own sounds: the held note, the swell, the taps and the nib, made here so they sit with the voice. */
class VaultSound {
  private note: { g: GainNode; o: OscillatorNode[] } | null = null;
  private noise: AudioBuffer | null = null;
  private get ctx() { return audio.ctx; }
  private out() { return audio.master; }
  held(on: boolean) {
    const ctx = this.ctx; if (!ctx || !this.out()) return;
    if (on && !this.note) {
      const g = ctx.createGain(); g.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.4;
      // a low D with its fifth and octave, slightly beating: one long bowed note under the room
      const o = [73.42, 73.6, 110.0, 146.83].map((f, i) => {
        const x = ctx.createOscillator(); x.type = i === 3 ? 'triangle' : i === 2 ? 'sine' : 'sawtooth'; x.frequency.value = f;
        const xg = ctx.createGain(); xg.gain.value = [0.05, 0.05, 0.05, 0.025][i]; x.connect(xg).connect(lp); x.start(); return x;
      });
      lp.connect(g).connect(this.out());
      g.gain.setTargetAtTime(0.55, ctx.currentTime, 1.6);
      this.note = { g, o };
    } else if (!on && this.note) {
      const n = this.note; this.note = null;
      n.g.gain.cancelScheduledValues(ctx.currentTime); n.g.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
      for (const x of n.o) x.stop(ctx.currentTime + 4);
    }
  }
  /** A slow rise under the hook, then a soft chord to hand over. */
  swell(dur: number, resolve = false) {
    const ctx = this.ctx; if (!ctx) return;
    const t0 = ctx.currentTime;
    const freqs = resolve ? [146.83, 220, 293.66, 440] : [110, 164.8, 220];
    for (const [i, f] of freqs.entries()) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * (1 + i * 0.0015);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t0);
      const peak = (resolve ? 0.05 : 0.06) / (1 + i * 0.6);
      g.gain.linearRampToValueAtTime(peak, t0 + dur * (resolve ? 0.25 : 0.7)); g.gain.linearRampToValueAtTime(0, t0 + dur);
      o.connect(g).connect(this.out()); o.start(t0); o.stop(t0 + dur + 0.1);
    }
  }
  private noiseBuf() {
    const ctx = this.ctx!;
    this.noise ??= (() => { const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })();
    return this.noise;
  }
  /** Filtered noise: a quill tap on the page (low, short) or the nib's scratch (high, longer). */
  burst(freq: number, q: number, dur: number, vol: number, when = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.01, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(this.out()); s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02);
  }
  tap() { this.burst(900, 2.5, 0.07, 0.5); this.burst(240, 1.2, 0.09, 0.35); }
  scratch(dur: number) { for (let i = 0; i < Math.floor(dur / 0.16); i++) this.burst(3600 + Math.random() * 1800, 3, 0.07 + Math.random() * 0.05, 0.05 + Math.random() * 0.04, i * 0.16 + Math.random() * 0.05); }
  stop() { this.held(false); }
}

/**
 * The Vault of the Last Ledger: an observatory-archive on the rim of
 * Sagittarius A*. A circular basalt-and-brass hall with a great window onto
 * the black hole, walls of glowing ledger slates, the six-world orrery, two
 * lanterns, a hooded desk lamp, and MegaZroN at his lectern.
 */
export class Vault {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.05, 20000);
  host!: Character;
  private dome = createSpaceDome();
  private orrery = new THREE.Group();
  private worlds: { m: THREE.Mesh; r: number; s: number; a: number }[] = [];
  private motes!: THREE.Points;
  private beamMotes!: THREE.Points;
  private beams: THREE.Mesh[] = [];
  private quill = new THREE.Group();
  private page!: THREE.MeshStandardMaterial;
  private leaf = new THREE.Group();
  private lampBulb!: THREE.MeshStandardMaterial;
  private lantern: { l: THREE.PointLight; m: THREE.MeshStandardMaterial; base: number }[] = [];
  private halo = new THREE.PointLight(0xffc36a, 0, 5);
  private key = new THREE.PointLight(0xffd9a0, 7, 11);
  private lamp = new THREE.SpotLight(0xffd29a, 0, 7, 0.75, 0.55, 1.6);
  private built = false;
  private lines: VaultLine[] = [];
  private i = -1;
  private left = 0;
  private late = 0;
  private shot: VaultShot = 'wide';
  private shotT = 0;
  private shotLen = 1;
  private pose: CrewPose = 'idle';
  private time = 0;
  private onDone: (() => void) | null = null;
  private snd = new VaultSound();
  private rimL!: THREE.SpotLight;
  private hemi!: THREE.HemisphereLight;
  private slateMat!: THREE.MeshStandardMaterial;
  private beamMat!: THREE.ShaderMaterial;
  private leather!: THREE.MeshStandardMaterial;
  private outside: Record<string, THREE.Group> = {};
  private sky: THREE.ShaderMaterial | null = null;
  private flash = 0;
  private flashAt = 3;
  private rain: THREE.Points | null = null;
  private train: THREE.Group | null = null;
  /** What the window shows and how the room is dressed: the black hole (this game), a storm over a bay, or a dawn over fields and a city. */
  dressing: 'bh' | 'storm' | 'dawn' = 'bh';
  /** The entrance's state: the beat's clock, its length, whether its line has been said, where he stands and faces. */
  private beat = { t: 0, len: 1, said: true, walked: 0, yaw: 0, lampK: 0, glowK: 0 };
  private at = new THREE.Vector3();
  private yaw = 0;
  private lookV = new THREE.Vector3();
  private focusV = 0;
  playing = false;

  constructor(private subtitle: (key: string | null, speaker?: string) => void, private detail = 1) {}

  private build() {
    this.built = true;
    const s = this.scene;
    s.add(this.dome.mesh);
    const d = this.dome.uniforms;
    // the black hole is a real place out of the window: ray-marched in the dome from where the camera is each frame
    d.uBH.value = 1; d.uNebula.value = 1; d.uDisk.value = 0.42;
    d.uBHRot.value = BH_ROT;
    // the metal needs something to reflect, or brass and basalt go black wherever no lamp hits them
    const gl = Renderer.current?.renderer;
    if (gl) {
      const pm = new THREE.PMREMGenerator(gl);
      s.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      s.environmentIntensity = 0.32;
      pm.dispose();
    }

    const basalt = new THREE.MeshStandardMaterial({ color: 0x24242c, roughness: 0.32, metalness: 0.35 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.7 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc09a5a, roughness: 0.32, metalness: 0.9 });
    const brassDark = new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 0.45, metalness: 0.85 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.5, metalness: 0.7 });
    // in the rendered film each surface is a real CC0 material (tools/fetch_vault.py), tiled and tinted to these colours
    const film = (m: THREE.Material, set: string, repeat: number, tint: number) => { m.userData.film = { kind: 'pbr', set: `vault/${set}`, repeat, tint }; };
    film(basalt, 'floor', 9, 0x3c3c48); film(stone, 'pillar', 2, 0x6a6a76); film(brass, 'brass', 3, 0xd9a85c); film(brassDark, 'brass', 3, 0x8a6236);

    // polished floor with inlaid rings (the room reflects the disk)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(11, 96), basalt);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    for (const r of [1.6, 3.1, 5.2, 8.4]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.035, 128), brass);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004; s.add(ring);
    }
    // back wall opens onto the black hole: a horseshoe of pillars and shelves of glowing slates
    const slates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.42, 0.03), this.slateMat = new THREE.MeshStandardMaterial({ color: 0x14161e, emissive: 0xffb35c, emissiveIntensity: 0.34, roughness: 0.4 }), 620);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(); let n = 0;
    for (let k = 0; k < 16; k++) {
      const a = 0.72 + (k / 15) * (Math.PI * 2 - 1.44);
      const x = Math.sin(a) * 10, z = -Math.cos(a) * 10;
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 13, 20), stone);
      pil.position.set(x, 6.5, z); pil.castShadow = true; s.add(pil);
      const cap = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 20), brass);
      cap.rotation.x = Math.PI / 2; cap.position.set(x, 0.32, z); s.add(cap);
      if (k < 15) for (let row = 0; row < 9; row++) for (let c = 0; c < 4; c++) {
        const aa = a + ((c + 0.75) / 5) * ((Math.PI * 2 - 1.44) / 15);
        const r = 10.05, y = 0.9 + row * 0.66;
        if (n >= 620 || ((row * 7 + c * 3 + k) % 5 === 0)) continue;
        e.set(0, -aa + Math.PI, (((row + c + k) % 4) - 1.5) * 0.02);
        m4.compose(V(Math.sin(aa) * r, y, -Math.cos(aa) * r), q.setFromEuler(e), V(1, 1, 1));
        slates.setMatrixAt(n++, m4);
      }
    }
    slates.count = n; s.add(slates);
    for (let row = 0; row < 10; row++) {
      const shelf = new THREE.Mesh(new THREE.TorusGeometry(10.2, 0.05, 6, 96, Math.PI * 2 - 1.44).rotateZ(-Math.PI / 2 + 0.72), brassDark);
      shelf.rotation.x = Math.PI / 2; shelf.position.y = 0.58 + row * 0.66; s.add(shelf);
    }
    // ceiling ring around the oculus
    const roof = new THREE.Mesh(new THREE.TorusGeometry(10.6, 1.1, 10, 96), stone); roof.rotation.x = Math.PI / 2; roof.position.y = 13; s.add(roof);

    // the great window in the opening: an iron frame with mullions, so the disk's light comes in as beams
    const win = new THREE.Group(); win.position.set(0, 0, -7.6); s.add(win);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.12, 8, 64, Math.PI), iron); arch.position.y = 6.2; win.add(arch);
    for (const x of [-6.4, -3.2, 0, 3.2, 6.4]) { const mu = new THREE.Mesh(new THREE.BoxGeometry(0.09, x === 0 ? 12.6 : Math.abs(x) > 6 ? 6.2 : 11.6, 0.09), iron); mu.position.set(x, (x === 0 ? 12.6 : Math.abs(x) > 6 ? 6.2 : 11.6) / 2, 0); win.add(mu); }
    for (const y of [3.1, 6.2]) { const tr = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.08, 0.08), iron); tr.position.y = y; win.add(tr); }
    const sill = new THREE.Mesh(new THREE.BoxGeometry(13.2, 0.18, 0.6), stone); sill.position.y = 0.09; win.add(sill);

    // light coming in through the window: long soft beams (additive, brightest in the middle, fading towards the floor)
    const beamMat = this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uK: { value: 1 }, uCol: { value: new THREE.Color(0xffa860) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform float uTime, uK; uniform vec3 uCol; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        void main(){ float side = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
          float along = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
          float drift = 0.82 + 0.18 * sin(uTime * 0.35 + vUv.y * 7.0);
          gl_FragColor = vec4(uCol * side * along * drift * 0.05 * uK, 1.0); }`,
    });
    for (const [x, w] of [[-1.6, 1.3], [1.6, 1.1], [0.0, 1.6]] as [number, number][]) {
      const g = new THREE.CylinderGeometry(w * 0.7, w, 1, 24, 1, true);
      const beam = new THREE.Mesh(g, beamMat);
      const top = V(x * 1.4, 10.5, -8.2), bot = V(x * 0.55, 0.0, 1.6 + Math.abs(x) * 0.4);
      beam.position.copy(top).add(bot).multiplyScalar(0.5);
      beam.scale.set(1, top.distanceTo(bot), 1);
      beam.quaternion.setFromUnitVectors(V(0, 1, 0), top.clone().sub(bot).normalize());
      beam.renderOrder = 5; s.add(beam); this.beams.push(beam);
    }

    // the lectern and the Ledger
    const desk = new THREE.Group(); desk.position.set(0, 0, 0.82); s.add(desk);
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2016, roughness: 0.42 });
    film(wood, 'desk', 1, 0x8a5a44);
    const leather = this.leather = new THREE.MeshStandardMaterial({ color: 0x4a2416, roughness: 0.55 }); film(leather, 'binding', 1, 0x9a6a50);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.72), wood); top.position.y = 1.08; top.rotation.x = 0.24; top.castShadow = true; desk.add(top);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.24, 1.04, 16), wood); leg.position.y = 0.52; desk.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.06, 24), brassDark); foot.position.y = 0.03; desk.add(foot);
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d')!; g.fillStyle = '#e8dcc0'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(40,24,14,0.85)'; for (let y = 22; y < 240; y += 13) for (const x0 of [24, 272]) { let x = x0; while (x < x0 + 214) { const w = 8 + ((x * 7 + y * 3) % 26); g.fillRect(x, y, w, 2.2); x += w + 5; } }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(253, 0, 6, 256);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.page = new THREE.MeshStandardMaterial({ map: tex, color: 0x766e60, roughness: 0.8, emissive: 0xffc98a, emissiveMap: tex, emissiveIntensity: 0.02 });
    film(this.page, 'page', 1, 0xfff0dc); // the film's page: the same writing, drawn at full size by tools/fetch_vault.py
    // the Ledger: a leather-bound block with its open pages as their own sheet (one material per mesh, so the film reads both)
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.07, 0.56), leather);
    book.position.set(0, 1.15, 0); book.rotation.x = 0.24; desk.add(book);
    const pages = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.53).rotateX(-Math.PI / 2), this.page);
    pages.position.y = 0.036; book.add(pages);
    // the page he turns: hinged on the spine
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.85, side: THREE.DoubleSide, emissive: 0xffc98a, emissiveIntensity: 0.02 });
    const leafMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.47, 0.52, 8, 1).rotateX(-Math.PI / 2).translate(0.235, 0, 0), leafMat);
    this.leaf.position.y = 0.04; this.leaf.add(leafMesh); book.add(this.leaf);

    // the hooded desk lamp at the lectern's left: his one practical light (it comes up as he reaches it)
    const lampG = new THREE.Group(); lampG.position.set(-0.62, 1.12, -0.05); desk.add(lampG);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.42, 10), brass); stem.position.y = 0.21; stem.rotation.z = -0.25; lampG.add(stem);
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.14, 24, 1, true), brass); hood.position.set(0.09, 0.42, 0.05); hood.rotation.set(0.35, 0, -0.9); lampG.add(hood);
    this.lampBulb = new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xffd29a, emissiveIntensity: 0 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), this.lampBulb); bulb.position.set(0.1, 0.39, 0.05); lampG.add(bulb);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.02, 16), brassDark); lampG.add(lampBase);
    this.lamp.position.set(-0.5, 1.56, 0.82); this.lamp.target.position.set(0.05, 1.25, 0.9);
    this.lamp.castShadow = this.detail >= 1; this.lamp.shadow.mapSize.set(1024, 1024); this.lamp.shadow.bias = -0.0006;
    s.add(this.lamp, this.lamp.target);

    // the quill rides in his right hand (it floated and wrote by itself before)
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0035, 0.3, 8).translate(0, 0.15, 0), new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.6 }));
    const vane = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10).scale(0.018, 0.12, 0.0025).translate(0, 0.2, 0), new THREE.MeshStandardMaterial({ color: 0xb4a78c, roughness: 0.8, side: THREE.DoubleSide }));
    const nib = new THREE.Mesh(new THREE.ConeGeometry(0.0032, 0.022, 8).rotateX(Math.PI).translate(0, -0.011, 0), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.3, metalness: 0.6 }));
    this.quill.add(shaft, vane, nib);

    // the six-world orrery on the host's right
    const orr = this.orrery; orr.position.set(-3.2, 2.9, -1.6); s.add(orr);
    const ostem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.26, 2.9, 16), brassDark); ostem.position.set(-3.2, 1.45, -1.6); ostem.userData.orrery = true; s.add(ostem);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.1, metalness: 1 })); orr.add(core);
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.02, 8, 48), new THREE.MeshStandardMaterial({ color: 0x331a06, emissive: 0xff9a3c, emissiveIntensity: 3.2 })); coreRing.rotation.x = 1.3; orr.add(coreRing);
    [0x57b3ad, 0xc77d33, 0xc3a8ee, 0xe68a78, 0x6fa867, 0x4d70e0].forEach((col, i) => {
      const r = 0.62 + i * 0.22;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 72), brass);
      const tilt = new THREE.Group(); tilt.rotation.set(0.25 + i * 0.12, 0, (i - 2.5) * 0.09); tilt.add(ring); ring.rotation.x = Math.PI / 2;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.06 + (i === 0 ? 0.02 : 0), 16, 12), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.1, roughness: 0.3 }));
      tilt.add(m); orr.add(tilt);
      this.worlds.push({ m, r, s: 0.6 - i * 0.06, a: i * 1.1 });
    });

    // two lanterns on stands: one near the lens for the reveal's rack focus, one deep in the room for depth
    for (const [x, z, h, base] of [[-2.05, 2.15, 1.05, 2.6], [2.9, -2.6, 1.35, 3.4], [-5.6, -4.8, 1.2, 3.0]] as [number, number, number, number][]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, h, 10), iron); st.position.set(x, h / 2, z); s.add(st);
      const ft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.03, 16), iron); ft.position.set(x, 0.015, z); s.add(ft);
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.2, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.5, metalness: 0.7, wireframe: false, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
      cage.position.set(x, h + 0.1, z); s.add(cage);
      const capL = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.07, 6), brassDark); capL.position.set(x, h + 0.235, z); s.add(capL);
      const fm = new THREE.MeshStandardMaterial({ color: 0x331a06, emissive: 0xffa040, emissiveIntensity: 2.6 });
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8).scale(1, 1.7, 1), fm); flame.position.set(x, h + 0.09, z); s.add(flame);
      const l = new THREE.PointLight(0xffa850, base, 6.5, 2); l.position.set(x, h + 0.12, z); s.add(l);
      this.lantern.push({ l, m: fm, base });
    }

    // dust: a few motes everywhere, many more inside the window's beams
    const N = this.detail >= 1 ? 900 : 400, p = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { p[i * 3] = (Math.random() - 0.5) * 12; p[i * 3 + 1] = Math.random() * 5; p[i * 3 + 2] = (Math.random() - 0.5) * 10; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const sprite = dot();
    this.motes = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffd9a8, size: 0.014, map: sprite, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.add(this.motes);
    const NB = this.detail >= 1 ? 1400 : 500, pb = new Float32Array(NB * 3);
    for (let i = 0; i < NB; i++) {
      const b = this.beams[i % this.beams.length], u = Math.random();
      const ax = V(0, 1, 0).applyQuaternion(b.quaternion), len = b.scale.y;
      const pt = b.position.clone().addScaledVector(ax, (u - 0.5) * len * 0.8);
      const r = Math.sqrt(Math.random()) * 0.9; const th = Math.random() * 6.283;
      pt.x += Math.cos(th) * r; pt.z += Math.sin(th) * r * 0.6;
      pb.set([pt.x, pt.y, pt.z], i * 3);
    }
    const pbg = new THREE.BufferGeometry(); pbg.setAttribute('position', new THREE.BufferAttribute(pb, 3));
    this.beamMotes = new THREE.Points(pbg, new THREE.PointsMaterial({ color: 0xffc890, size: 0.018, map: sprite, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.add(this.beamMotes);

    // lighting: the disk's hot rim through the window behind him, a cold fill off the shelves, a soft front fill so his
    // face and coat read in the wide shots, and the room never under a floor of light (it read as near black before)
    this.key.position.set(0.5, 1.75, 1.5); s.add(this.key);
    const rim = this.rimL = new THREE.SpotLight(0xff9a50, 90, 34, 0.5, 0.6);
    rim.position.set(1.8, 6.5, -8); rim.target.position.set(0, 1.9, 0); rim.castShadow = true; rim.shadow.mapSize.set(1024, 1024); rim.shadow.bias = -0.0004; s.add(rim, rim.target);
    const rim2 = new THREE.SpotLight(0x8fb4ff, 70, 26, 0.5, 0.8); rim2.position.set(-6, 4, 1.5); rim2.target.position.set(0, 1.9, 0); s.add(rim2, rim2.target);
    s.add(this.hemi = new THREE.HemisphereLight(0x6a76a0, 0x3a2418, 2.6));
    const fill = new THREE.SpotLight(0xffe9d2, 80, 14, 0.34, 0.9); fill.position.set(0.9, 3.0, 4.6); fill.target.position.set(0, 2.1, 0); s.add(fill, fill.target);
    // the window's glow across the floor
    const sill2 = new THREE.SpotLight(0xffa860, 160, 30, 0.7, 0.9); sill2.position.set(0, 9, -12); sill2.target.position.set(0, 0, 1); s.add(sill2, sill2.target);
    this.halo.position.set(0, 2.4, -0.7); s.add(this.halo);

    this.host = createCharacter('megazron', this.detail);
    s.add(this.host.root);
    void this.host.whenReady.then(() => this.fitHost()); void this.host.whenFull.then(() => this.smoothAll());
    this.dome.mesh.position.set(0, 0, 0);
  }

  /** Once his body is in: the quill into his right hand, a smooth coat (its flat facets caught the lamp), a pen grip. */
  private fitHost() {
    const hand = this.host.root.getObjectByName('handR');
    const f3 = this.host.root.getObjectByName('finger3_1R'), f1 = this.host.root.getObjectByName('finger1_3R'), f5 = this.host.root.getObjectByName('finger5_1R');
    if (hand && f3) {
      hand.updateWorldMatrix(true, true);
      // the hand's frame: fingers' way, the palm's way, the thumb's side (character.ts handAxes does the same)
      const fl = f3.position.clone().normalize();
      const nl = V(0, -1, 0); nl.addScaledVector(fl, -nl.dot(fl)).normalize();
      const th = new THREE.Vector3().crossVectors(fl, nl);
      if (f1 && f5) {
        const sd = hand.worldToLocal(f1.getWorldPosition(new THREE.Vector3())).sub(hand.worldToLocal(f5.getWorldPosition(new THREE.Vector3())));
        if (sd.dot(th) < 0) th.negate();
      }
      const sc = 1 / Math.max(1e-3, hand.getWorldScale(new THREE.Vector3()).x);
      // held as a pen: pinched by the thumb and the first two fingers, nib out past the fingertips towards the palm side,
      // the feather back over the web of the thumb
      const up = fl.clone().multiplyScalar(-0.75).addScaledVector(nl, -0.45).addScaledVector(th, 0.5).normalize();
      this.quill.quaternion.setFromUnitVectors(V(0, 1, 0), up);
      this.quill.position.copy(fl).multiplyScalar(f3.position.length() * 1.25).addScaledVector(th, 0.022 * sc).addScaledVector(nl, 0.012 * sc);
      this.quill.scale.setScalar(sc);
      hand.add(this.quill);
    }
    this.host.setGrip('R', { shape: 'pinch', radius: 0.004 });
    this.smoothAll();
  }

  /** Smooth shading across the coat's split vertices: the same normal for every copy of a point. */
  private smoothAll() {
    this.host.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      // no glowing dots on his face: the baked marks map scattered pale specks over the skin (owner: "face dots")
      for (const mt of (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as THREE.Material[]) {
        const u = mt.userData?.u as { uMarks?: { value: THREE.Texture | null } } | undefined;
        if (u?.uMarks) u.uMarks.value = NO_MARKS;
        // his pale hair burned white under the lamp and the room's reflections (GPU take a1): a shade down, little sheen
        if ((mt.userData?.film as { kind?: string } | undefined)?.kind === 'hair' && !mt.userData.dimmed) {
          mt.userData.dimmed = true; (mt as THREE.MeshStandardMaterial).envMapIntensity = 0.12;
          const hu = mt.userData.hairU as Record<string, { value: THREE.Color }> | undefined;
          if (hu) { hu.uRoot.value.multiplyScalar(0.7); hu.uMid.value.multiplyScalar(0.6); hu.uTip.value.multiplyScalar(0.55); hu.uShine.value.multiplyScalar(0.4); }
          else (mt as THREE.MeshStandardMaterial).color?.multiplyScalar(0.62);
        }
      }
      if (!m.isSkinnedMesh || !m.geometry.attributes.normal) return;
      smoothNormals(m.geometry);
    });
  }


  /** Dresses the room for a world outside the window (see the bible: one room, each story's view). Films only, built on first use. */
  dress(name: 'bh' | 'storm' | 'dawn') {
    if (!this.built) this.build();
    this.dressing = name;
    const s = this.scene, d = this.dome.uniforms;
    if (name !== 'bh' && !this.sky) {
      this.sky = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uCloud: { value: new THREE.Color() }, uStars: { value: 0 } },
        vertexShader: /* glsl */ `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `uniform float uTime, uFlash, uStars; uniform vec3 uTop, uHor, uCloud; varying vec3 vD;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
          float fbm(vec2 p){ float a = 0.5, r = 0.0; for (int i = 0; i < 5; i++) { r += a * n(p); p *= 2.03; a *= 0.5; } return r; }
          void main(){ vec3 d = normalize(vD); float y = clamp(d.y, -0.2, 1.0);
            vec3 col = mix(uHor, uTop, smoothstep(-0.02, 0.45, y));
            vec2 q = d.xz / max(0.08, d.y + 0.12) * 0.6 + vec2(uTime * 0.012, 0.0);
            float c = smoothstep(0.42, 0.85, fbm(q * 1.3));
            col = mix(col, uCloud * (0.7 + 0.6 * fbm(q * 3.0)), c * smoothstep(-0.05, 0.12, y));
            col += uFlash * vec3(0.7, 1.1, 0.85) * (0.6 + 1.4 * c) * smoothstep(-0.05, 0.3, y);
            float st = step(0.9965, h(floor(d.xy * 420.0 + d.z * 97.0))) * uStars * (1.0 - c) * smoothstep(0.1, 0.5, y);
            gl_FragColor = vec4(col + st, 1.0); }`,
      });
      const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), this.sky); sky.renderOrder = -9; sky.frustumCulled = false;
      const g = new THREE.Group(); g.add(sky); s.add(g); this.outside.sky = g;
    }
    if (name === 'storm' && !this.outside.storm) {
      const g = new THREE.Group(); s.add(g); this.outside.storm = g;
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(1600, 900).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x060a09, roughness: 0.35, metalness: 0.5, envMapIntensity: 0.05 }));
      sea.position.set(0, -8, -460); g.add(sea);
      // the ferry far out on the bay: a dark hull, a lit wheelhouse, a mast light
      const ferry = new THREE.Group(); ferry.position.set(16, -7.2, -120); ferry.rotation.y = 0.5; ferry.scale.setScalar(1.4); g.add(ferry);
      ferry.add(new THREE.Mesh(new THREE.BoxGeometry(16, 2.2, 5), new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.7 })));
      const lit = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff0c0, emissiveIntensity: 2.2 });
      const wh = new THREE.Mesh(new THREE.BoxGeometry(5, 1.6, 3.4), lit); wh.position.set(-2, 1.9, 0); ferry.add(wh);
      const mast = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshStandardMaterial({ color: 0, emissive: 0x9cff7a, emissiveIntensity: 4 })); mast.position.set(-2, 5.5, 0); ferry.add(mast);
      // rain past the window
      const N = 1800, p = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) p.set([(Math.random() - 0.5) * 40, Math.random() * 22 - 4, -12 - Math.random() * 30], i * 3);
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(p, 3));
      this.rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: 0x9fb8aa, size: 0.06, transparent: true, opacity: 0.45, depthWrite: false })); g.add(this.rain);
      // the frame of threads that replaces the orrery: twenty-four glowing green threads strung across brass
      const fr = new THREE.Group(); fr.position.set(-3.0, 0, -1.4); fr.rotation.y = 0.5; g.add(fr);
      const br = new THREE.MeshStandardMaterial({ color: 0xa08050, roughness: 0.35, metalness: 0.9 });
      for (const x of [-0.9, 0.9]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 2.9, 12), br); post.position.set(x, 1.45, 0); fr.add(post); }
      for (const y of [0.55, 2.75]) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 10).rotateZ(Math.PI / 2), br); bar.position.set(0, y, 0); fr.add(bar); }
      for (let i = 0; i < 24; i++) {
        const th = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 2.2, 5), new THREE.MeshStandardMaterial({ color: 0x0a1a0e, emissive: 0x6dff8a, emissiveIntensity: 1.4 + (i % 5) * 0.35 }));
        th.position.set(-0.82 + i * (1.64 / 23), 1.65, (i % 2) * 0.02); fr.add(th);
      }
    }
    if (name === 'dawn' && !this.outside.dawn) {
      const g = new THREE.Group(); s.add(g); this.outside.dawn = g;
      const land = new THREE.Mesh(new THREE.PlaneGeometry(1600, 900).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a2016, roughness: 0.95, envMapIntensity: 0.05 }));
      land.position.set(0, -10, -460); g.add(land);
      // a sleeping city's lights on the horizon and a train going along under them
      const N = 1400, p = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { const a = (Math.random() - 0.5) * 1.6, r = 220 + Math.random() * 240; p.set([Math.sin(a) * r, -9.6 + Math.random() * (Math.random() < 0.1 ? 6 : 1.2), -Math.cos(a) * r], i * 3); }
      const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.add(new THREE.Points(cg, new THREE.PointsMaterial({ color: 0xffc070, size: 2.2, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false })));
      this.train = new THREE.Group(); this.train.position.set(-160, -9.2, -170); g.add(this.train);
      for (let i = 0; i < 9; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.1, 1.2), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, emissive: 0xfff2c8, emissiveIntensity: 1.6 })); c.position.x = -i * 5.8; this.train.add(c); }
    }
    for (const [k, g] of Object.entries(this.outside)) g.visible = k === 'sky' ? name !== 'bh' : k === name;
    const bh = name === 'bh';
    d.uBH.value = bh ? 1 : 0; d.uNebula.value = bh ? 1 : 0;
    this.orrery.parent && (this.orrery.visible = bh);
    this.scene.traverse((o) => { if (o.userData.orrery) o.visible = bh; });
    if (this.sky) {
      const u = this.sky.uniforms;
      if (name === 'storm') { u.uTop.value.set(0x070b0c); u.uHor.value.set(0x2c403a); u.uCloud.value.set(0x3a4c46); u.uStars.value = 0; }
      if (name === 'dawn') { u.uTop.value.set(0x141a3a); u.uHor.value.set(0xd8805a); u.uCloud.value.set(0x5a4a5e); u.uStars.value = 0.8; }
    }
    // the room's colour for each view: warm amber (the disk), cold green and white (the storm), rose and gold (dawn)
    const tint = { bh: [0xff9a50, 0xffb35c, 0xffa860, 0xffa850, 0x4a2416], storm: [0x8affb0, 0x5aff8a, 0x9affc8, 0xd8ffe8, 0x1c2a22], dawn: [0xffb08a, 0xffc890, 0xffb890, 0xffb060, 0x6a2a20] }[name];
    this.rimL.color.set(tint[0]); this.slateMat.emissive.set(tint[1]); this.slateMat.emissiveIntensity = name === 'dawn' ? 0.12 : name === 'storm' ? 0.22 : 0.34;
    this.beamMat.uniforms.uCol.value.set(tint[2]);
    for (const ln of this.lantern) { ln.l.color.set(tint[3]); ln.m.emissive.set(tint[3]); }
    this.leather.color.set(tint[4]);
    this.hemi.color.set(name === 'storm' ? 0x5a7a70 : name === 'dawn' ? 0x8a7aa0 : 0x6a76a0);
  }

  /**
   * Builds the room and compiles its shaders ahead of time. Done on the first
   * real-GPU test run, this stall held the fade-in back for seconds, so the
   * scene sat nearly black long after it had started.
   */
  prepare() {
    if (!this.built) this.build();
    this.update(0.016);
  }

  /** Runs a scene; `done` fires when it ends or is skipped. */
  play(lines: VaultLine[], done: () => void) {
    if (!this.built) this.build();
    const fd = (globalThis as { __mzFilm?: { dress?: 'bh' | 'storm' | 'dawn' } }).__mzFilm?.dress ?? 'bh';
    if (fd !== this.dressing) this.dress(fd);
    this.lines = lines;
    this.onDone = done;
    this.i = -1; this.left = 0;
    this.playing = true;
    this.pose = 'idle';
    voice.preload(lines.map((l) => l.key).filter(Boolean));
    this.said = [];
    const entrance = lines.some((l) => l.move);
    this.beat = { t: 0, len: 1, said: true, walked: 0, yaw: 0, lampK: entrance ? 0 : 1, glowK: 0 };
    this.at.set(0, 0, 0); this.yaw = 0;
    this.host.root.position.set(0, 0, 0); this.host.root.rotation.y = 0;
    this.leaf.rotation.z = 0;
    if (entrance) sceneSound({ music: null, beds: { amb_room: 0.55 } });
    else audio.startDrone();
    if (this.skipNext) { this.skipNext = false; this.finish(); }
  }

  /** Skip pressed while the scene was still loading under the black: it ends as soon as it starts. */
  skipNext = false;
  skip() { if (this.playing) this.finish(); else this.skipNext = true; }

  private finish() {
    this.playing = false;
    this.subtitle(null);
    voice.stop();
    audio.stopDrone();
    this.snd.stop();
    sceneSound(null);
    Renderer.current?.setDof(0, 0);
    const f = this.onDone; this.onDone = null;
    f?.();
  }

  get lineIndex() { return this.i; }
  /** The scene's lines, in order (tests). */
  get keys() { return this.lines.map((l) => l.key).filter(Boolean); }
  /** Lines said in this scene so far, in order (tests). */
  said: string[] = [];

  private speak(l: VaultLine) {
    const dur = voice.duration(l.key) ?? Math.max(2.2, t(l.key).length * 0.07);
    this.subtitle(l.key, 'mz.name'); this.host.say(dur); this.said.push(l.key);
    // a film of the room for another story writes down when each line starts (wall clock, as the recorder stamps frames)
    const f = (globalThis as { __mzFilm?: { log?: [string, number, number][] } }).__mzFilm;
    if (f) (f.log ??= []).push([l.key, Date.now() / 1000, dur]);
    return dur;
  }

  private next() {
    this.i++;
    if (this.i >= this.lines.length) { this.finish(); return; }
    const l = this.lines[this.i];
    if (l.move) {
      // a beat of the entrance: its length is its own, or the line's with its lead-in and tail, whichever is longer
      const dur = !l.key ? 0 : voice.duration(l.key) ?? Math.max(2.2, t(l.key).length * 0.07);
      const lead = l.lead ?? 0;
      this.beat.t = 0; this.beat.len = Math.max(l.min ?? 0, lead + dur + (l.after ?? 0.5)); this.beat.said = !l.key; this.beat.walked = 0;
      this.beat.yaw = this.yaw;
      if (!l.key || lead <= 0) { if (l.key) { this.speak(l); this.beat.said = true; } else this.subtitle(null); }
      else this.subtitle(null);
      this.left = this.beat.len; this.late = 0;
      this.pose = l.act?.pose ?? 'stand';
      this.cue(l.act, true);
      return;
    }
    // a beat with no line: a held shot (the room before he speaks, the quill after)
    const dur = !l.key ? 0 : voice.duration(l.key) ?? Math.max(2.2, t(l.key).length * 0.07);
    if (l.key) this.speak(l); else this.subtitle(null);
    this.left = dur + (l.after ?? 0.5);
    this.late = 0;
    this.pose = l.pose ?? 'idle';
    this.shot = l.shot ?? 'push';
    this.shotT = 0;
    this.shotLen = this.left;
  }

  /** The sounds a beat starts with. */
  private cue(a: Act | undefined, start: boolean) {
    if (!a || !start) return;
    if (a.note === 'on') this.snd.held(true);
    if (a.note === 'off') this.snd.held(false);
    if (a.note === 'swell') this.snd.swell(Math.max(4, this.beat.len));
    if (a.note === 'resolve') { this.snd.held(false); this.snd.swell(Math.max(4, this.beat.len + 1.5), true); }
  }

  /** The entrance's beat on its clock: the camera's move, his walk and turn, the lamp, the page, the sounds. */
  private entrance(l: VaultLine, dt: number) {
    const b = this.beat, a = l.act ?? {}, mv = l.move!;
    const t0 = b.t; b.t += dt;
    const k = Math.min(1, b.t / b.len);
    const at = (x: number) => t0 < x && b.t >= x; // a cue at x seconds into the beat
    if (!b.said && b.t >= (l.lead ?? 0)) { b.said = true; this.speak(l); }
    // camera
    const ease = mv.ease === 'lin' ? k : mv.ease === 'out' ? 1 - (1 - k) * (1 - k) : smoothstep(0, 1, k);
    const cam = this.camera.position;
    if (mv.via) { const u = 1 - ease; cam.set(0, 0, 0).addScaledVector(mv.a, u * u).addScaledVector(mv.via, 2 * u * ease).addScaledVector(mv.b, ease * ease); }
    else cam.lerpVectors(mv.a, mv.b, ease);
    const lk = mv.look ? smoothstep(mv.look[0], mv.look[1], k) : ease;
    this.lookV.lerpVectors(mv.la, mv.lb ?? mv.la, lk);
    // a slow breath in the frame: the camera is held, not locked off
    cam.y += Math.sin(this.time * 0.6) * 0.006; cam.x += Math.sin(this.time * 0.43) * 0.005;
    this.camera.lookAt(this.lookV);
    if (mv.fov) { const f = mv.fov[0] + (mv.fov[1] - mv.fov[0]) * ease; if (Math.abs(this.camera.fov - f) > 0.01) { this.camera.fov = f; this.camera.updateProjectionMatrix(); } }
    else if (this.camera.fov !== 36) { this.camera.fov = 36; this.camera.updateProjectionMatrix(); }
    if (mv.fa !== undefined) {
      const rk = mv.rack ? smoothstep(mv.rack[0], mv.rack[1], k) : 0;
      this.focusV = mv.fa + ((mv.fb ?? mv.fa) - mv.fa) * rk;
      const ap = mv.ap ?? Math.min(0.02, 0.03 / Math.max(this.focusV, 0.6));
      Renderer.current?.setDof(this.focusV, ap);
    } else Renderer.current?.setDof(0, 0);
    // his walk along the path at an even pace, turning into it; then the turn he is given
    if (a.walk && a.walk.length > 1) {
      const span = a.steps ? [a.steps[0], a.steps[1]] : [0, b.len];
      const u = smoothstep(0, 1, Math.min(1, Math.max(0, (b.t - span[0]) / (span[1] - span[0]))));
      const pts = a.walk, seg = u * (pts.length - 1), si = Math.min(pts.length - 2, Math.floor(seg)), f = seg - si;
      const prev = this.at.clone();
      this.at.lerpVectors(pts[si], pts[si + 1], f);
      const d = this.at.clone().sub(prev);
      if (d.lengthSq() > 1e-8 && u < 0.97) { const want = Math.atan2(d.x, d.z); this.yaw += Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)) * Math.min(1, dt * 5); }
      else this.yaw += Math.atan2(Math.sin(0 - this.yaw), Math.cos(0 - this.yaw)) * Math.min(1, dt * 3);
      // his steps, heard on the stone (the gait clip lands about every 0.62 s at this pace)
      b.walked += d.length();
      if (b.walked > 0.58 && u < 0.98) { b.walked = 0; audio.step('stone', 0.62, { x: this.at.x, y: 0.05, z: this.at.z }); }
    }
    if (a.face) {
      const [y1, s0, s1] = a.face, w = smoothstep(s0, s1 ?? s0 + 1.4, b.t);
      this.yaw = b.yaw + Math.atan2(Math.sin(y1 - b.yaw), Math.cos(y1 - b.yaw)) * w;
    }
    this.host.root.position.copy(this.at);
    this.host.root.rotation.y = this.yaw;
    // where he looks
    const gz = a.gazeAt !== undefined && b.t < a.gazeAt ? 'book' : a.gaze ?? 'cam';
    const book = V(0, 1.2, 0.85);
    this.host.setLookTarget(gz === 'cam' ? this.camera.position : gz === 'book' ? book : gz === 'window' ? V(BH_AT.x * 0.2, BH_AT.y * 0.2, BH_AT.z * 0.2) : gz === 'down' ? V(this.at.x + Math.sin(this.yaw) * 3, 0.3, this.at.z + Math.cos(this.yaw) * 3) : null);
    if (gz === 'book' && this.pose === 'write') this.host.setLookTarget(null);
    // the lamp comes up as he reaches it, with a flicker as it catches
    if (a.lamp) { const w = smoothstep(a.lamp[0], a.lamp[1], b.t); b.lampK = Math.max(b.lampK, w); }
    if (a.glow) b.glowK = smoothstep(a.glow[0], a.glow[1], b.t);
    // a page turned over the spine
    if (a.page !== undefined) { const w = smoothstep(a.page, a.page + 0.9, b.t); this.leaf.rotation.z = w * Math.PI * 0.985; this.leaf.position.y = 0.04 + Math.sin(w * Math.PI) * 0.02; if (at(a.page)) audio.sample('paper', 0.75, { at: { x: 0, y: 1.2, z: 0.85 }, near: 2 }); }
    for (const tp of a.taps ?? []) if (at(tp)) this.snd.tap();
    if (a.scratch && at(a.scratch[0])) this.snd.scratch(a.scratch[1] - a.scratch[0]);
  }

  private outsideFrame(t0: number, dt: number) {
    const sky = this.sky!.uniforms; sky.uTime.value = t0;
    this.outside.sky.position.copy(this.camera.position);
    if (this.dressing === 'storm') {
      if (t0 > this.flashAt) { this.flash = 1; this.flashAt = nextFlash(t0); }
      this.flash = Math.max(0, this.flash - dt * 3.2);
      const f = this.flash * (0.6 + 0.4 * Math.sin(t0 * 60));
      sky.uFlash.value = f; this.rimL.intensity = 50 + 260 * f;
      if (this.rain) { this.rain.position.y = -((t0 * 14) % 22); this.rain.position.x = -((t0 * 2) % 2); }
    } else if (this.train) this.train.position.x = -160 + ((t0 * 6) % 360);
  }

  update(dt: number) {
    if (!this.built) return;
    this.time += dt;
    const t0 = this.time;
    if (this.playing) {
      this.left -= dt;
      // the next line waits for this one to be said to its end (a take that loaded late, a slow frame), up to 4 s more
      if (this.left <= 0 && this.i >= 0 && voice.speaking() && this.late < 4) this.late += dt;
      else if (this.left <= 0) { this.next(); if (!this.playing) return; }
    }
    // after its last beat an entrance holds its last frame under the fade out (it cut to the wide set-up for a moment)
    const l = this.lines[Math.min(Math.max(this.i, 0), this.lines.length - 1)];
    if (l?.move) this.entrance(l, this.i < 0 || !this.playing ? 0 : dt);
    else {
      const sh = SHOTS[this.shot];
      const k = smoothstep(0, 1, Math.min(1, this.shotT / this.shotLen));
      this.shotT += dt;
      this.camera.position.lerpVectors(sh.a, sh.b, k);
      this.camera.lookAt(sh.to);
      if (this.camera.fov !== 36) { this.camera.fov = 36; this.camera.updateProjectionMatrix(); }
      // he looks at us, except while he shows us the orrery: then at the orrery (the over-shoulder camera sits low, and
      // looking down at it buried his chin in his collar)
      this.host.setLookTarget(this.pose === 'write' ? null : this.shot === 'orrery' ? this.orrery.position : this.camera.position);
      this.host.root.position.set(0, 0, 0); this.host.root.rotation.y = 0;
      this.beat.lampK = 1; this.beat.glowK = 0;
    }
    // the black hole stays where it is in the room: the dome is drawn round the camera, so its centre moves with it
    this.dome.mesh.position.copy(this.camera.position);
    this.dome.uniforms.uBHPos.value.copy(BH_AT).sub(this.camera.position).divideScalar(BH_SCALE);
    this.dome.uniforms.uTime.value = t0;
    if (this.dressing !== 'bh') this.outsideFrame(t0, dt);
    this.host.root.updateMatrixWorld();
    this.host.animate(this.pose, 0, this.pose === 'walk' ? 0.25 : 0, t0, dt);
    this.host.look2(0, 0);
    const lvl = voice.level();
    const lampK = this.beat.lampK, flick = lampK < 1 ? (Math.sin(t0 * 41) > 0.2 ? 1 : 0.55) : 1;
    this.lamp.intensity = 4 * lampK * flick * (1 + Math.sin(t0 * 3.1) * 0.015);
    this.lampBulb.emissiveIntensity = 3.5 * lampK * flick;
    this.halo.intensity = 0.15 + lvl * 0.45;
    this.key.intensity = (2.0 + 3.0 * lampK) + Math.sin(t0 * 7.3) * 0.12 + Math.sin(t0 * 3.1) * 0.2;
    this.page.emissiveIntensity = 0.02 + lvl * 0.04 + lampK * 0.012 + this.beat.glowK * 2.2;
    for (const [i, ln] of this.lantern.entries()) { const f = 0.86 + 0.1 * Math.sin(t0 * (8.1 + i) + i) + 0.04 * Math.sin(t0 * 23.7 + i * 2); ln.l.intensity = ln.base * f; ln.m.emissiveIntensity = 2.6 * f; }
    (this.beams[0]?.material as THREE.ShaderMaterial | undefined)?.uniforms.uTime && ((this.beams[0].material as THREE.ShaderMaterial).uniforms.uTime.value = t0);
    this.orrery.rotation.y = t0 * 0.05;
    for (const w of this.worlds) { const a = w.a + t0 * w.s; w.m.position.set(Math.cos(a) * w.r, 0, Math.sin(a) * w.r); }
    this.motes.rotation.y = t0 * 0.008;
    this.motes.position.y = Math.sin(t0 * 0.1) * 0.1;
    this.beamMotes.position.y = Math.sin(t0 * 0.07) * 0.18 - (t0 * 0.012) % 0.6;
    this.beamMotes.position.x = Math.sin(t0 * 0.05) * 0.12;
  }
}

const NO_MARKS = (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; })();

/** A storm's lightning in a film: a flash every few seconds, lighting the sky and the room through the window. */
function nextFlash(t: number) { return t + 3.5 + ((Math.sin(t * 12.9898) * 43758.5453) % 1 + 1) % 1 * 4; }

/** One normal for every copy of a point (split along UV seams and garment edges, each copy had its own: facets). */
function smoothNormals(g: THREE.BufferGeometry) {
  const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
  if (!pos || !nor || g.userData.smoothed) return;
  g.userData.smoothed = true;
  const key = (i: number) => `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`;
  const sum = new Map<string, THREE.Vector3>(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { const k = key(i); const s = sum.get(k) ?? sum.set(k, new THREE.Vector3()).get(k)!; s.add(n.fromBufferAttribute(nor, i)); }
  for (let i = 0; i < pos.count; i++) {
    const s = sum.get(key(i))!, own = n.fromBufferAttribute(nor, i);
    // a hard edge (a collar's fold, a cuff) keeps its own normal
    if (s.lengthSq() < 1e-8 || own.dot(s.clone().normalize()) < 0.5) continue;
    const m = s.clone().normalize(); nor.setXYZ(i, m.x, m.y, m.z);
  }
  nor.needsUpdate = true;
}

// The cold open, beat by beat (see ~/megazron/NARRATOR_BIBLE.md 3.1): the room and the black hole first, his steps, his
// silhouette between the pillars, the lamp as he reaches the Ledger, the first look, the hook over his shoulder, the
// Ledger, two taps and the hand-over into the page. Each beat is one continuous move; no cut lands on a word.
const WALK = [V(-3.4, 0, -6.2), V(-2.4, 0, -4.2), V(-1.1, 0, -2.2), V(-0.25, 0, -0.7), V(0, 0, 0)];
function introBeats(): VaultLine[] {
  const eyes = V(0, 1.93, 0), page = V(0.05, 1.2, 0.84);
  return [
    // 1. establishing: crane down from high in the room past the orrery, the black hole through the great window
    { key: '', min: 9.5, act: { pose: 'stand', walk: [WALK[0], WALK[0]], note: 'on', gaze: 'down' },
      move: { a: V(1.4, 8.8, 5.6), via: V(0.2, 5.5, 5.2), b: V(-1.5, 1.8, 4.6), la: V(0, 16, -80), lb: V(-1.2, 2.6, -6), look: [0.25, 1], fov: [42, 34], ease: 'io' } },
    // 2. the reveal: low along the floor past the near lantern; focus racks off its flame to him walking out of the dark
    { key: '', min: 8.6, act: { pose: 'walk', walk: WALK, steps: [0.3, 8.0], lamp: [7.0, 8.4], gaze: 'down' },
      move: { a: V(-2.75, 1.05, 3.5), b: V(-2.2, 1.2, 2.75), la: V(-1.6, 1.3, -3.4), lb: V(-0.2, 1.65, -0.2), fa: 0.75, fb: 4.6, rack: [0.18, 0.5], ap: 0.016, fov: [32, 30] } },
    // 3. at the lectern: the lamp is up, he looks down at the Ledger and turns the page
    { key: '', min: 4.6, act: { pose: 'stand', gaze: 'book', page: 1.0, lamp: [0, 0.4] },
      move: { a: V(1.45, 1.55, 3.0), b: V(1.15, 1.62, 2.55), la: V(0, 1.45, 0.3), lb: V(0, 1.6, 0.2), fa: 2.9, fb: 2.6, rack: [0, 1], ap: 0.012 } },
    // 4. the first look: a slow push in; his eyes come up off the page to the lens; a beat of silence, then the door line
    { key: 'mz.intro.0', lead: 1.6, min: 4.2, after: 0.5, act: { pose: 'stand', gaze: 'cam', gazeAt: 0.9, note: 'off' },
      move: { a: V(0.62, 1.95, 2.45), b: V(0.36, 1.96, 1.5), la: eyes, fa: 2.45, fb: 1.5, rack: [0, 1], ap: 0.014, fov: [30, 28] } },
    // 5. who he is: the close-up holds, drifting in
    { key: 'mz.intro.1', after: 0.6, act: { pose: 'stand', gaze: 'cam' },
      move: { a: V(0.36, 1.96, 1.5), b: V(0.27, 1.96, 1.3), la: eyes, fa: 1.5, fb: 1.3, rack: [0, 1], ap: 0.015, fov: [28, 27] } },
    // 6. the hook: he turns to the window; the camera rises behind his shoulder until the black hole fills the frame past him
    { key: 'mz.intro.2', lead: 1.2, after: 0.8, act: { pose: 'stand', face: [Math.PI - 0.32, 0.1, 1.9], gaze: 'window', note: 'swell' },
      move: { a: V(1.2, 1.85, 2.4), via: V(1.9, 2.3, 2.3), b: V(1.25, 2.75, 3.0), la: eyes, lb: V(-0.6, 4.6, -14), look: [0.12, 0.7], fa: 2.0, fb: 30, rack: [0.15, 0.65], ap: 0.01, fov: [34, 38] } },
    // 7. the Ledger: he turns back and writes; from the nib, focus racks up to his face
    { key: 'mz.intro.3', lead: 1.6, after: 0.5, act: { pose: 'stand', face: [0, 0, 1.4], gaze: 'book', scratch: [1.6, 4.6] },
      move: { a: V(0.75, 1.48, 1.7), b: V(0.62, 1.58, 1.52), la: page, lb: V(0, 1.75, 0.2), look: [0.35, 0.8], fa: 0.95, fb: 1.65, rack: [0.4, 0.75], ap: 0.016 } },
    // 8. the hand-over: two taps of the quill, "Turn the page", and the camera goes into the glowing page
    { key: 'mz.intro.4', lead: 1.1, min: 5.2, after: 0.2, act: { pose: 'stand', gaze: 'cam', taps: [0.3, 0.62], glow: [1.8, 5.0], note: 'resolve' },
      move: { a: V(0.34, 1.9, 1.8), b: V(0.04, 1.34, 1.02), la: V(0, 1.9, 0.05), lb: page, look: [0.45, 0.8], fa: 1.8, fb: 0.35, rack: [0.3, 0.8], ap: 0.012, fov: [30, 24], ease: 'io' } },
  ];
}

/**
 * A film of this room for another of the host's stories (tools only: a capture sets `window.__mzFilm` before it plays
 * the intro): the same beats as the cold open, as data, with points as [x, y, z].
 */
function filmBeats(): VaultLine[] | null {
  const f = (globalThis as { __mzFilm?: { beats: unknown[] } }).__mzFilm;
  if (!f?.beats) return null;
  // number lists that are not points (a turn's [yaw, from, to], tap times) stay as they are
  const KEEP = new Set(['face', 'taps', 'scratch', 'steps', 'lamp', 'glow', 'rack', 'look', 'fov']);
  const vec = (x: unknown, k = ''): unknown => KEEP.has(k) ? x : Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === 'number') ? V(x[0], x[1], x[2]) : Array.isArray(x) ? x.map((y) => vec(y)) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([kk, v]) => [kk, vec(v, kk)])) : x;
  return f.beats.map((b) => vec(b) as VaultLine);
}

/** Scene scripts. `s` says what the player actually did. */
export function vaultScript(id: 'intro' | 'l3' | 'l7' | 'ch1' | 'ch2' | 'ep2', s: { ateRed: boolean; deaths: number; bites: number; renamed: boolean; failed?: number; comments?: string[] }): VaultLine[] {
  // what the record earned: the Ledger, read back
  const said = (s.comments ?? []).map((key, i): VaultLine => ({ key, shot: i % 2 ? 'profile' : 'hands', pose: i % 2 ? 'present' : 'write' }));
  switch (id) {
    case 'intro': return filmBeats() ?? introBeats();
    case 'l3': return [
      { key: 'mz.l3.1', shot: 'wide', pose: 'stand' },
      { key: s.ateRed ? 'mz.l3.red' : 'mz.l3.safe', shot: 'hands', pose: 'write' },
      ...(s.deaths > 0 ? [{ key: 'mz.l3.died', shot: 'profile' as VaultShot, pose: 'present' as CrewPose }] : []),
      { key: 'j.8', shot: 'profile', pose: 'present' },
      { key: 'mz.l3.hint', shot: 'close', pose: 'idle' },
      { key: 'mz.l3.2', shot: 'window', pose: 'idle' },
    ];
    case 'l7': return [
      { key: 'mz.l7.1', shot: 'push', pose: 'present' },
      { key: s.bites === 0 ? 'mz.l7.clean' : 'mz.l7.bitten', shot: 'profile', pose: 'idle' },
      { key: 'mz.l7.2', shot: 'orrery', pose: 'point' },
      ...said,
      { key: 'mz.l7.hint', shot: 'close', pose: 'idle' },
    ];
    // Episode Two's page: the kitchen, who he met and how, the cairn, and the next place
    case 'ep2': return [
      { key: 'e2.mz.1', shot: 'wide', pose: 'write' },
      ...said,
      { key: 'e2.mz.4', shot: 'close', pose: 'idle', after: 1.2 },
    ];
    case 'ch2': return [
      { key: 'mz.ch2.1', shot: 'wide', pose: 'write' },
      { key: (s.failed ?? 0) >= 4 ? 'mz.ch2.messy' : 'mz.ch2.clean', shot: 'hands', pose: 'write' },
      { key: 'mz.ch2.2', shot: 'profile', pose: 'present' },
      { key: 'mz.ch2.3', shot: 'close', pose: 'idle', after: 1.2 },
    ];
    case 'ch1': return [
      { key: 'mz.ch1.1', shot: 'wide', pose: 'stand' },
      { key: s.renamed ? 'mz.ch1.names' : 'mz.ch1.nonames', shot: 'hands', pose: 'write' },
      ...said,
      { key: 'mz.ch1.2', shot: 'low', pose: 'present' },
      { key: 'mz.ch1.3', shot: 'window', pose: 'idle' },
      { key: 'mz.ch1.4', shot: 'close', pose: 'idle', after: 1.2 },
    ];
  }
}
