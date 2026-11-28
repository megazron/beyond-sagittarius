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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bs3Film, BS3_LINES } from './bs3';
import { Film, FilmSound, Ink, Page, Shot, WritingHand, paperGround, shoot, smooth as sm } from './entrance';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Soft round sprite so dust near the lens isn't a square. */
function dot() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d')!, r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, '#fff'); r.addColorStop(0.35, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** One spoken line with a gesture and a camera set-up (the visits between chapters), or a line of a film at its second. */
export interface VaultLine { key: string; pose?: CrewPose; shot?: VaultShot; after?: number; at?: number }
export type VaultShot = 'wide' | 'push' | 'close' | 'hands' | 'orrery' | 'window' | 'profile' | 'low';

// He stands at the lectern facing the great window (the black hole beyond the page, seen over his shoulder); the
// visits' set-ups look at him from the window side, the 'window' one from behind him.
const SHOTS: Record<VaultShot, { a: THREE.Vector3; b: THREE.Vector3; to: THREE.Vector3 }> = {
  wide: { a: V(-0.15, 2.05, -3.2), b: V(0.2, 2.05, -2.7), to: V(0, 1.75, 0) },
  push: { a: V(1.1, 1.9, -4.2), b: V(0.75, 1.92, -3.1), to: V(0, 1.85, 0) },
  close: { a: V(-0.42, 2.0, -1.42), b: V(-0.3, 2.0, -1.16), to: V(0, 1.9, 0) },
  profile: { a: V(-1.7, 1.98, -0.5), b: V(-1.45, 1.98, -0.62), to: V(0, 1.82, -0.1) },
  low: { a: V(1.2, 0.5, -2.4), b: V(0.95, 0.56, -2.1), to: V(0, 2.2, 0) },
  hands: { a: V(-0.7, 1.95, 0.55), b: V(-0.55, 1.9, 0.4), to: V(0.05, 1.18, -0.75) },
  orrery: { a: V(-2.6, 1.35, 1.8), b: V(-2.45, 1.6, 1.3), to: V(-3.2, 2.9, -1.6) },
  window: { a: V(0.3, 1.5, 3.2), b: V(0.1, 1.55, 2.2), to: V(0, 4.6, -18) },
};

/** Where the black hole is, in the room's metres (the dome draws it ray-marched from wherever the camera stands). */
const BH_AT = V(0, 24, -96);
/** Metres per Schwarzschild radius of the dome's black hole. */
const BH_SCALE = 2.0;
const BH_ROT = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.16, 0, -0.2))).transpose();

/** The Ledger's spread as he sees it: pixels of the page canvas. */
const PW = 2048, PH = 1144, BW = 0.95, BD = 0.53;
/** The entry, as written (names and homes are the crew panel's; nothing past the opening film is on the page). */
const ROWS: [string, string][] = [['Draxum', 'Titan'], ['Lyrra', 'Mars'], ['Skyvra', 'Ganymede'], ['Bolzar', 'Ceres'], ['Nuvexa', 'Venus'], ['Zenvik', 'Europa']];
const COL = { name: 1092, from: 1352, to: 1598, cost: 1810 }, ROW0 = 470, ROWH = 96;

/**
 * The Vault of the Last Ledger: an observatory-archive on the rim of Sagittarius A*. A circular basalt-and-brass hall
 * with a great window onto the black hole, walls of glowing ledger slates, the six-world orrery, lanterns, a hooded
 * desk lamp, and MegaZroN at his lectern. It also runs his films: a timeline (entrance.ts) instead of beats.
 */
export class Vault {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.05, 20000);
  host!: Character;
  /** The room (everything but him and the sky): a film for another story hides it and builds its own set. */
  room = new THREE.Group();
  dome = createSpaceDome();
  private orrery = new THREE.Group();
  private worlds: { m: THREE.Mesh; r: number; s: number; a: number }[] = [];
  private motes!: THREE.Points;
  private beamMotes!: THREE.Points;
  private beams: THREE.Mesh[] = [];
  quill = new THREE.Group();
  private ink!: THREE.Mesh;
  private book = new THREE.Group();
  /** The left half of the spread, hinged on the spine: it lifts in the pull and shuts over the right half. */
  private leaf = new THREE.Group();
  page!: Page;
  private pageMats: THREE.MeshStandardMaterial[] = [];
  private lampBulb!: THREE.MeshStandardMaterial;
  private lampG = new THREE.Group();
  private lantern: { l: THREE.PointLight; m: THREE.MeshStandardMaterial; f: THREE.Mesh; base: number }[] = [];
  /** The candle on the lectern: the flame the pull is read by in the close shots. */
  private candle!: THREE.Group;
  private candleGlow!: THREE.Sprite;
  /** The candle's brass stick and wax (a film that moves the candle moves them with it). */
  private candleBase: THREE.Object3D[] = [];
  /** Loose slips of paper round the lectern: the pull takes them across the floor to the window. */
  private slips: { m: THREE.Mesh; a: THREE.Vector3; b: THREE.Vector3; d: number; h: number; s: number }[] = [];
  private motes2!: THREE.Points;
  private beamMotes2!: THREE.Points;
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
  snd = new FilmSound();
  hand!: WritingHand;
  private rimL!: THREE.SpotLight;
  private hemi!: THREE.HemisphereLight;
  private beamMat!: THREE.ShaderMaterial;
  /** The film playing (null: a visit, line by line). */
  private film: Film | null = null;
  private filmT = 0;
  private subEnd = 0;
  private handedOver = false;
  /** Called when a film begins its hand-over into what comes next (the title screen): the caller starts its fade. */
  onHandover: (() => void) | null = null;
  playing = false;

  constructor(private subtitle: (key: string | null, speaker?: string) => void, private detail = 1) { (globalThis as { __mzVault?: Vault }).__mzVault = this; }

  private build() {
    this.built = true;
    const s = this.room;
    this.scene.add(this.dome.mesh, this.room);
    const d = this.dome.uniforms;
    // the black hole is a real place out of the window: ray-marched in the dome from where the camera is each frame,
    // a sharp thin disk lensed over and under the shadow, the old haze only as a faint glow round it
    d.uBH.value = 1; d.uNebula.value = 1; d.uDisk.value = 0.1; d.uThin.value = 1.25;
    d.uBHRot.value = BH_ROT;
    // the metal needs something to reflect, or brass and basalt go black wherever no lamp hits them
    const gl = Renderer.current?.renderer;
    if (gl) {
      const pm = new THREE.PMREMGenerator(gl);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.32;
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
    const slates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.42, 0.03), new THREE.MeshStandardMaterial({ color: 0x14161e, emissive: 0xffb35c, emissiveIntensity: 0.34, roughness: 0.4 }), 620);
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
    const roof = new THREE.Mesh(new THREE.TorusGeometry(10.6, 1.1, 10, 96), stone); roof.rotation.x = Math.PI / 2; roof.position.y = 13; s.add(roof);

    // the great window in the opening: an iron frame with mullions, so the disk's light comes in as beams
    const win = new THREE.Group(); win.position.set(0, 0, -7.6); s.add(win);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.12, 8, 64, Math.PI), iron); arch.position.y = 6.2; win.add(arch);
    for (const x of [-6.4, -3.2, 0, 3.2, 6.4]) { const h = x === 0 ? 12.6 : Math.abs(x) > 6 ? 6.2 : 11.6; const mu = new THREE.Mesh(new THREE.BoxGeometry(0.09, h, 0.09), iron); mu.position.set(x, h / 2, 0); win.add(mu); }
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

    // the lectern and the Ledger, between him and the window (its local +z is away from him)
    const desk = new THREE.Group(); desk.position.set(0, 0, -0.82); desk.rotation.y = Math.PI; s.add(desk);
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2016, roughness: 0.42 });
    film(wood, 'desk', 1, 0x8a5a44);
    const leather = new THREE.MeshStandardMaterial({ color: 0x4a2416, roughness: 0.55 }); film(leather, 'binding', 1, 0x9a6a50);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.72), wood); top.position.y = 1.08; top.rotation.x = 0.24; top.castShadow = true; desk.add(top);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.24, 1.04, 16), wood); leg.position.y = 0.52; desk.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.06, 24), brassDark); foot.position.y = 0.03; desk.add(foot);
    // the open Ledger: a leather block, the right half of the spread fixed, the left half on its hinge
    this.page = new Page(PW, PH, paperGround({ rules: ROWH, spine: true, scribble: [80, 900] }), ledgerInk());
    const pageMat = (u0: number) => {
      const m = new THREE.MeshStandardMaterial({ map: this.page.tex, color: 0xa89c88, roughness: 0.82, emissive: 0xffc98a, emissiveMap: this.page.tex, emissiveIntensity: 0.02 });
      film(m, 'page', 1, 0xfff0dc); m.userData.u0 = u0; this.pageMats.push(m); return m;
    };
    const half = (u0: number) => {
      // a half page with the canvas's half on it, upright for him (plane x+ is his left, the far edge is +z)
      const g = new THREE.PlaneGeometry(BW / 2, BD, 12, 6).rotateX(-Math.PI / 2);
      const uv = g.attributes.uv as THREE.BufferAttribute, p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) { const x = p.getX(i), z = p.getZ(i); uv.setXY(i, (BW / 4 + u0 * BW - x) / BW, (z + BD / 2) / BD); }
      return g;
    };
    const book = this.book; book.position.set(0, 1.15, 0); book.rotation.x = 0.24; desk.add(book);
    const block = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.04, 0.06, BD + 0.03), leather); block.position.y = -0.005; book.add(block);
    const right = new THREE.Mesh(half(0.5), pageMat(0.5)); right.position.set(-BW / 4, 0.031, 0); book.add(right);
    this.leaf.position.set(0, 0.031, 0); book.add(this.leaf);
    const lp = new THREE.Mesh(half(0), pageMat(0)); lp.position.x = BW / 4; this.leaf.add(lp);
    const lback = new THREE.Mesh(new THREE.BoxGeometry(BW / 2 + 0.02, 0.012, BD + 0.03), leather); lback.position.set(BW / 4 + 0.01, -0.008, 0); this.leaf.add(lback);
    // the inkwell and the quill's rest at his right hand, the hooded lamp at his left
    const well = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.15, metalness: 0.2 }));
    well.position.set(-0.6, 1.14, -0.2); well.rotation.x = 0.24; desk.add(well);
    const lampG = this.lampG; lampG.position.set(0.62, 1.12, -0.05); desk.add(lampG);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.42, 10), brass); stem.position.y = 0.21; stem.rotation.z = 0.25; lampG.add(stem);
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.14, 24, 1, true), brass); hood.position.set(-0.09, 0.42, 0.05); hood.rotation.set(0.35, 0, 0.9); lampG.add(hood);
    this.lampBulb = new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xffd29a, emissiveIntensity: 0 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), this.lampBulb); bulb.position.set(-0.1, 0.39, 0.05); lampG.add(bulb);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.02, 16), brassDark); lampG.add(lampBase);
    this.lamp.position.set(-0.55, 1.6, -0.82); this.lamp.target.position.set(0.0, 1.2, -0.85);
    this.lamp.castShadow = this.detail >= 1; this.lamp.shadow.mapSize.set(1024, 1024); this.lamp.shadow.bias = -0.0006;
    s.add(this.lamp, this.lamp.target);

    // the quill rides in his right hand: cream feather, dark nib, big enough to read in a medium shot
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0032, 0.2, 8).translate(0, 0.1, 0), new THREE.MeshStandardMaterial({ color: 0x9a917c, roughness: 0.6 }));
    // a pen-sized quill: a narrow feather, its vane a soft leaf and not a blade (it read as a knife at twice this size)
    const vane = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10).scale(0.013, 0.07, 0.002).translate(0.002, 0.135, 0), new THREE.MeshStandardMaterial({ color: 0x8f8672, roughness: 0.9, side: THREE.DoubleSide })); // (cream burned to a white glowing blade under the lamps and the bloom)
    const nib = new THREE.Mesh(new THREE.ConeGeometry(0.0034, 0.024, 8).rotateX(Math.PI).translate(0, -0.012, 0), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.3, metalness: 0.6 }));
    this.ink = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 8), new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.05, metalness: 0.3 }));
    this.ink.position.y = -0.026; this.ink.visible = false;
    this.quill.add(shaft, vane, nib, this.ink);

    // the six-world orrery off to the side
    const orr = this.orrery; orr.position.set(-3.2, 2.9, -1.6); s.add(orr);
    const ostem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.26, 2.9, 16), brassDark); ostem.position.set(-3.2, 1.45, -1.6); s.add(ostem);
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

    // lanterns on stands: their flames are the room's weathervanes (they lean when the pull comes)
    for (const [x, z, h, base] of [[1.35, -1.55, 1.1, 2.2], [-2.05, 2.15, 1.05, 2.6], [2.9, -2.6, 1.35, 3.4], [-5.6, -4.8, 1.2, 3.0]] as [number, number, number, number][]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, h, 10), iron); st.position.set(x, h / 2, z); s.add(st);
      const ft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.03, 16), iron); ft.position.set(x, 0.015, z); s.add(ft);
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.2, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.45 }));
      cage.position.set(x, h + 0.1, z); s.add(cage);
      const capL = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.07, 6), brassDark); capL.position.set(x, h + 0.235, z); s.add(capL);
      const fm = new THREE.MeshStandardMaterial({ color: 0x331a06, emissive: 0xffa040, emissiveIntensity: 2.6 });
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8).scale(1, 1.7, 1).translate(0, 0.035, 0), fm); flame.position.set(x, h + 0.06, z); s.add(flame);
      const l = new THREE.PointLight(0xffa850, base, 6.5, 2); l.position.set(x, h + 0.12, z); s.add(l);
      this.lantern.push({ l, m: fm, f: flame, base });
    }

    // a candle on the lectern's far corner, on a short brass stick: in the close shots its flame is what leans
    {
      const cx = -0.5, cz = -1.1, cy = 1.2;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.1, 12), brass); stick.position.set(cx, cy + 0.05, cz); s.add(stick);
      const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.07, 12), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6, emissive: 0x5a3a18, emissiveIntensity: 0.5 })); wax.position.set(cx, cy + 0.135, cz); s.add(wax);
      // a teardrop: round at the wick, drawn to a point
      const prof: THREE.Vector2[] = []; for (let i = 0; i <= 14; i++) { const u = i / 14; prof.push(new THREE.Vector2(0.0085 * Math.sin(Math.PI * Math.pow(u, 0.62)) * (1 - 0.25 * u), u * 0.046)); }
      const fg = new THREE.LatheGeometry(prof, 14);
      const outer = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0xffa238, transparent: true, opacity: 0.9, toneMapped: false }));
      const inner = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0xfff2c4, toneMapped: false })); inner.scale.set(0.55, 0.62, 0.55);
      this.candleBase = [stick, wax]; this.candle = new THREE.Group(); this.candle.add(outer, inner); this.candle.position.set(cx, cy + 0.172, cz); s.add(this.candle);
      this.candleGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot(), color: 0xff9a40, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.candleGlow.scale.setScalar(0.22); this.candleGlow.position.set(cx, cy + 0.195, cz); s.add(this.candleGlow);
    }
    // loose slips round the lectern (notes that never went into the Ledger)
    {
      const sm0 = new THREE.MeshStandardMaterial({ color: 0xcfc3a4, roughness: 0.85, side: THREE.DoubleSide, emissive: 0x3a2c18, emissiveIntensity: 0.35 });
      const at: [number, number, number, number, number, number, number][] = [
        [0.62, 0.012, -0.25, 1.9, -7.2, 0.0, 0.5], [-0.75, 0.012, -0.5, -1.2, -7.6, 0.9, 0.35], [0.3, 0.012, 0.75, 0.6, -6.6, 1.8, 0.7],
        [-0.3, 0.012, 1.4, -2.3, -6.9, 2.9, 0.6], [1.5, 0.012, 0.9, 2.8, -7.4, 3.6, 0.45], [-1.6, 0.012, 0.2, -0.4, -7.9, 4.6, 0.55],
      ];
      for (const [x, y, z, bx, bz, d, h] of at) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.15).rotateX(-Math.PI / 2), sm0); m.position.set(x, y, z); m.rotation.y = x * 2.1 + z; s.add(m);
        this.slips.push({ m, a: V(x, y, z), b: V(bx, 0.012, bz), d, h, s: x * 3 + z * 5 });
      }
    }

    // dust: a few motes everywhere, many more inside the window's beams
    const N = this.detail >= 1 ? 900 : 400, p = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { p[i * 3] = (Math.random() - 0.5) * 12; p[i * 3 + 1] = Math.random() * 5; p[i * 3 + 2] = (Math.random() - 0.5) * 10; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const sprite = dot();
    this.motes = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffd9a8, size: 0.014, map: sprite, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.add(this.motes);
    // the same dust again one room-length behind: in the pull the two go to the window in turn, so the stream never runs out
    this.motes2 = new THREE.Points(pg, this.motes.material); s.add(this.motes2);
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
    this.beamMotes2 = new THREE.Points(pbg, this.beamMotes.material); s.add(this.beamMotes2);

    // lighting: the window is his key (the disk's amber on his face as he faces it), a warm lamp pool on the page, a
    // cold fill off the shelves, a warm back light from the room behind him, and a floor of light so nothing goes black
    this.key.position.set(-0.5, 1.75, -1.5); s.add(this.key);
    const rim = this.rimL = new THREE.SpotLight(0xff9a50, 70, 34, 0.5, 0.6);
    rim.position.set(1.8, 6.5, -8); rim.target.position.set(0, 1.9, 0); rim.castShadow = true; rim.shadow.mapSize.set(1024, 1024); rim.shadow.bias = -0.0004; s.add(rim, rim.target);
    const rim2 = new THREE.SpotLight(0x8fb4ff, 60, 26, 0.5, 0.8); rim2.position.set(-6, 4, 1.5); rim2.target.position.set(0, 1.9, 0); s.add(rim2, rim2.target);
    const back = new THREE.SpotLight(0xffb070, 55, 14, 0.4, 0.8); back.position.set(1.2, 3.6, 4.2); back.target.position.set(0, 1.9, 0); s.add(back, back.target);
    s.add(this.hemi = new THREE.HemisphereLight(0x6a76a0, 0x3a2418, 2.4));
    const fill = new THREE.SpotLight(0xffe9d2, 60, 14, 0.34, 0.9); fill.position.set(-0.9, 3.0, -4.6); fill.target.position.set(0, 2.1, 0); s.add(fill, fill.target);
    const sill2 = new THREE.SpotLight(0xffa860, 160, 30, 0.7, 0.9); sill2.position.set(0, 9, -12); sill2.target.position.set(0, 0, 1); s.add(sill2, sill2.target);
    this.halo.position.set(0, 2.4, 0.7); s.add(this.halo);

    this.host = createCharacter('megazron', this.detail);
    this.host.setFilmed(true); // in his Vault he is always on camera: his breath is drawn to be seen
    this.scene.add(this.host.root);
    this.host.root.rotation.y = Math.PI;
    this.hand = new WritingHand(this.host, this.quill);
    void this.host.whenReady.then(() => this.fitHost()); void this.host.whenFull.then(() => this.smoothAll());
    this.dome.mesh.position.set(0, 0, 0);
  }

  /**
   * His own acting clips (tools/build_mz_animations.py: captured motion with its real path over the floor): loaded once,
   * on the first film that asks. `acting` then says where the capture's stool stands from where `mz_sit_down` starts.
   */
  private actingFailed = false;
  acting: { seat: [number, number, number]; seatYaw: number; upEnd: [number, number]; upYaw: number; walkFrom?: [number, number]; clips: Record<string, { dur: number; loop: boolean }> } | null = null;
  private actingP: Promise<void> | null = null;
  loadActing() {
    return (this.actingP ??= (async () => {
      const base = `${import.meta.env.BASE_URL}models/crew/`;
      const [g, j] = await Promise.all([new GLTFLoader().loadAsync(`${base}anim_mz.glb`), fetch(`${base}anim_mz.json`).then((r) => r.json())]);
      // one side for every rotation track (a key and its negative are one pose, but blending between them goes the long way)
      for (const c of g.animations) for (const tr of c.tracks) {
        if (!tr.name.endsWith('.quaternion')) continue;
        const v = tr.values;
        for (let i = 4; i < v.length; i += 4) if (v[i] * v[i - 4] + v[i + 1] * v[i - 3] + v[i + 2] * v[i - 2] + v[i + 3] * v[i - 1] < 0) { v[i] = -v[i]; v[i + 1] = -v[i + 1]; v[i + 2] = -v[i + 2]; v[i + 3] = -v[i + 3]; }
      }
      await this.host.whenReady;
      this.host.addClips(g.animations);
      this.acting = j;
      // and what his mouth does on each line (the spoken language's tracks, and English's for lines only said in English)
      await voice.loadVisemes();
    })().catch((e) => { console.error('[vault] acting clips', e); this.actingFailed = true; }));
  }

  /** Once his body is in: the quill into his right hand, a smooth coat (its flat facets caught the lamp), a pen grip. */
  private fitHost() {
    const hand = this.host.root.getObjectByName('handR');
    const f3 = this.host.root.getObjectByName('finger3_1R'), f1 = this.host.root.getObjectByName('finger1_3R'), f5 = this.host.root.getObjectByName('finger5_1R');
    if (hand && f3) {
      hand.updateWorldMatrix(true, true);
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
      for (const mt of (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as THREE.Material[]) {
        const u = mt.userData?.u as { uMarks?: { value: THREE.Texture | null } } | undefined;
        if (u?.uMarks) u.uMarks.value = NO_MARKS;
        // his pale hair burned white under the lamp and the room's reflections (GPU take a1): a shade down, little sheen
        // his eyes under the Vault's lamps and the bloom were two glowing slits with no iris or pupil to be seen (GPU
        // reel r1): the ball shaded down, less of a mirror, so the iris and the pupil are what you read
        if ((mt.userData?.film as { kind?: string } | undefined)?.kind === 'eye' && !mt.userData.dimmed) {
          mt.userData.dimmed = true; const em = mt as THREE.MeshStandardMaterial; em.color.setScalar(0.62); em.roughness = 0.45; em.envMapIntensity = 0.08;
          const eu = mt.userData.u as { uEyeGlow?: { value: number } } | undefined; if (eu?.uEyeGlow) eu.uEyeGlow.value = 0;
        }
        // the coat's weave normal map, laid over so few triangles, lit each triangle its own way (crumpled foil in close-up)
        // the clear shell over each eye mirrored the window and the lamps as a white veil over the iris and the pupil (GPU take r5)
        // (the material, not the mesh: the body's own level-of-detail switch shows its meshes again every frame)
        if (m.name === 'cornea') mt.visible = false;
        if ((mt.userData?.film as { kind?: string } | undefined)?.kind === 'cloth' && !mt.userData.dimmed) { mt.userData.dimmed = true; (mt as THREE.MeshStandardMaterial).normalScale?.set(0.45, 0.45); }
        if ((mt.userData?.film as { kind?: string } | undefined)?.kind === 'hair' && !mt.userData.dimmed) {
          mt.userData.dimmed = true; (mt as THREE.MeshStandardMaterial).envMapIntensity = 0.12;
          const hu = mt.userData.hairU as Record<string, { value: THREE.Color }> | undefined;
          const thr = (mt.userData.hairU as { uThrough?: { value: number } } | undefined)?.uThrough; if (thr) thr.value = 0.8;
          if (hu) { hu.uRoot.value.multiplyScalar(0.7); hu.uMid.value.multiplyScalar(0.6); hu.uTip.value.multiplyScalar(0.55); hu.uShine.value.multiplyScalar(0.4); }
          else (mt as THREE.MeshStandardMaterial).color?.multiplyScalar(0.62);
        }
      }
      if (!m.isSkinnedMesh || !m.geometry.attributes.normal) return;
      smoothNormals(m.geometry);
      // his coat's coarse cut caught the key as a crumple of flat triangles in every close shot: its shading (not its shape) eased across neighbours
      if (m.name === 'cloth') relaxNormals(m.geometry, 1); // (one pass now: his coat is built four times as fine)
    });
  }

  /**
   * His long hair out of his shoulders, back and collar (owner: "his hairs are penetrating his body"): the strands'
   * capsules (hair.ts uCap) are his upper back, his collar and both shoulders and upper arms, in the head's space,
   * set after every pose whether or not his head is bent. Only the free part of a strand moves; roots stay on the scalp.
   */
  private hairCaps() {
    const h = this.host, hb = h.root.getObjectByName('head');
    const caps = h.sway?.uCap.value; if (!hb || !caps) return;
    const tc = h.torsoCapsules();
    const P = (n: string) => h.root.getObjectByName(n)?.getWorldPosition(new THREE.Vector3()) ?? null;
    const neck = P('neck'), chest = P('chest'), sp1 = P('spine1'), uaL = P('upperarmL'), uaR = P('upperarmR'), laL = P('lowerarmL'), laR = P('lowerarmR');
    const sc = hb.getWorldScale(new THREE.Vector3()).y || 1;
    const back = tc ? Math.max(tc[1].rb, tc[2].rb) : 0.13;
    const set = (i: number, a: THREE.Vector3 | null, b: THREE.Vector3 | null, r: number) => {
      const A = caps[i * 2], B = caps[i * 2 + 1];
      if (!a || !b) { A.w = 0; return; }
      const la = hb.worldToLocal(a.clone()), lb = hb.worldToLocal(b.clone());
      A.set(la.x, la.y, la.z, r / sc); B.set(lb.x, lb.y, lb.z, 0);
    };
    set(0, sp1, chest, back + 0.035);
    // the collar stands round the neck: a fat capsule from the chest to just under the jaw
    set(1, chest, neck, back + 0.03);
    // the shoulders: from the collar out over each shoulder to the top of the arm
    set(2, neck, uaL, 0.085); set(3, neck, uaR, 0.085);
    set(4, uaL, laL, 0.075); set(5, uaR, laR, 0.075);
  }

  /**
   * Builds the room and compiles its shaders ahead of time. Done on the first real-GPU test run, this stall held the
   * fade-in back for seconds, so the scene sat nearly black long after it had started.
   */
  prepare() {
    if (!this.built) this.build();
    void this.loadActing(); // his own clips are in before any film asks (they came a second into a film, and he popped into the room)
    this.page.draw(0);
    this.update(0.016);
  }

  /** Runs a scene; `done` fires when it ends or is skipped. Lines with `at` are a film (the cold open). */
  play(lines: VaultLine[], done: () => void) {
    if (!this.built) this.build();
    this.lines = lines;
    this.onDone = done;
    this.lastWall = 0;
    this.i = -1; this.left = 0;
    this.playing = true;
    this.pose = 'idle';
    this.handedOver = false;
    voice.preload(lines.map((l) => l.key).filter(Boolean));
    this.said = [];
    this.host.root.position.set(0, 0, 0); this.host.root.rotation.y = Math.PI;
    this.leaf.rotation.z = 0;
    this.film = lines.length && lines.every((l) => l.at !== undefined) ? this.makeFilm() : null;
    this.filmT = 0; this.subEnd = 0;
    if (this.film) { this.room.visible = true; this.film.start(); }
    else { audio.startDrone(); this.hand.set(null); this.page.draw(99); }
    if (this.skipNext) { this.skipNext = false; this.finish(); }
  }

  /** The film for the lines: Beyond Sagittarius's own, or another story's set (tools: window.__mzFilm). */
  private makeFilm(): Film {
    const ext = (globalThis as { __mzSet?: (v: Vault) => Film }).__mzSet;
    // (the older film stays as the fallback: without his captured clips the new one has no body to stage)
    return ext ? ext(this) : this.actingFailed ? this.entry() : bs3Film(this, voice.spoken);
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
    this.film?.stop?.();
    this.film = null;
    this.room.visible = true; this.dome.mesh.visible = true;
    audio.stopTag('mz');
    sceneSound(null);
    this.hand.set(null);
    this.host.setFace(null);
    Renderer.current?.setDof(0, 0);
    const f = this.onDone; this.onDone = null;
    f?.();
  }

  get lineIndex() { return this.i; }
  /** The scene's lines, in order (tests). */
  get keys() { return this.lines.map((l) => l.key).filter(Boolean); }
  /** Lines said in this scene so far, in order (tests). */
  said: string[] = [];

  /** Tools: jump a playing film to second `t` (stills for checking a shot's framing; lines before it count as said). */
  seekFilm(t: number) {
    if (!this.film) return;
    this.filmT = t;
    while (this.i + 1 < this.lines.length && this.lines[this.i + 1].at! <= t) { this.i++; this.said.push(this.lines[this.i].key); }
  }

  /** His body's clip for a film's frame ('walk' moves the legs at the film's pace). */
  setPose(p: CrewPose) { this.pose = p; }

  /** Says a line now: subtitle, voice, lips. */
  speak(key: string) {
    const dur = voice.duration(key) ?? Math.max(2.2, t(key).length * 0.07);
    this.subtitle(key, 'mz.name'); this.host.say(dur); this.said.push(key);
    // a recording writes down when each line starts (wall clock, as the recorder stamps frames)
    const f = (globalThis as { __mzFilm?: { log?: [string, number, number][] } }).__mzFilm;
    if (f) (f.log ??= []).push([key, Date.now() / 1000, dur]);
    return dur;
  }

  private next() {
    this.i++;
    if (this.i >= this.lines.length) { this.finish(); return; }
    const l = this.lines[this.i];
    const dur = !l.key ? 0 : voice.duration(l.key) ?? Math.max(2.2, t(l.key).length * 0.07);
    if (l.key) this.speak(l.key); else this.subtitle(null);
    this.left = dur + (l.after ?? 0.5);
    this.late = 0;
    this.pose = l.pose ?? 'idle';
    this.shot = l.shot ?? 'push';
    this.shotT = 0;
    this.shotLen = this.left;
  }

  /** A film's frame: its clock, its lines at their seconds, its end. */
  private filmFrame(dt: number) {
    const f = this.film!;
    this.filmT += dt;
    const ft = this.filmT;
    // a line starts at its second; if the one before is still being said (a take that loaded late) it waits for it
    const nx = this.lines[this.i + 1];
    if (nx && ft >= nx.at! && !(voice.speaking() && this.i >= 0)) { this.i++; this.subEnd = ft + this.speak(nx.key) + 0.5; }
    // a line's subtitle goes when the line is over (it stayed up until the next line, half a minute in the long silences)
    else if (this.subEnd && ft >= this.subEnd && !voice.speaking()) { this.subEnd = 0; this.subtitle(null); }
    if (f.handover !== undefined && !this.handedOver && ft >= f.handover) { this.handedOver = true; this.onHandover?.(); }
    f.frame(ft, dt);
    if (ft >= f.len && !voice.speaking()) this.finish();
  }

  private lastWall = 0;
  update(dt0: number) {
    if (!this.built) return;
    // the scene keeps to the wall clock, as its voice does: frames slower than the game's 50 ms step (software GL, a
    // weak phone) would otherwise stretch it out of sync with the lines. A held clock (recordings) steps it itself.
    const now = performance.now(), wall = this.lastWall ? Math.min(1, (now - this.lastWall) / 1000) : dt0;
    this.lastWall = now;
    const dt = voice.manual ? dt0 : Math.max(dt0, wall);
    this.time += dt;
    const t0 = this.time;
    if (this.playing && this.film) this.filmFrame(dt);
    else if (this.playing) {
      this.left -= dt;
      if (this.left <= 0 && this.i >= 0 && voice.speaking() && this.late < 4) this.late += dt;
      else if (this.left <= 0) { this.next(); if (!this.playing) return; }
    }
    if (!this.film) {
      const sh = SHOTS[this.shot];
      const k = smoothstep(0, 1, Math.min(1, this.shotT / this.shotLen));
      this.shotT += dt;
      this.camera.position.lerpVectors(sh.a, sh.b, k);
      this.camera.lookAt(sh.to);
      if (this.camera.fov !== 36) { this.camera.fov = 36; this.camera.updateProjectionMatrix(); }
      Renderer.current?.setDof(0, 0);
      // he looks at us, except while he shows us the orrery or writes; writing is his own hand on the page (the game's
      // writing clip raised the quill over his head)
      const writing = this.pose === 'write';
      this.host.setLookTarget(writing ? this.pagePoint(1400, 700 + Math.sin(t0 * 0.3) * 120) : this.shot === 'orrery' ? this.orrery.position : this.camera.position);
      this.hand.set(writing ? this.pagePoint(1150 + ((t0 * 140) % 640), 640 + Math.floor(t0 / 4.6) % 5 * ROWH + Math.sin(t0 * 9) * 8) : null);
      this.host.root.position.set(0, 0, 0); this.host.root.rotation.y = Math.PI;
      this.lampK = 1; this.glowK = 0;
    }
    // the black hole stays where it is in the room: the dome is drawn round the camera, so its centre moves with it
    this.dome.mesh.position.copy(this.camera.position);
    this.dome.uniforms.uBHPos.value.copy(BH_AT).sub(this.camera.position).divideScalar(BH_SCALE);
    this.dome.uniforms.uTime.value = t0;
    this.host.root.updateMatrixWorld();
    const pose = this.pose === 'write' ? 'stand' : this.pose;
    this.host.animate(pose, 0, pose === 'walk' ? 0.25 : 0, t0, dt);
    this.host.look2(0, 0);
    // in the pull his hair and the coat's hem lean to the window with everything else (he faces it: the body's +z)
    if (this.pullK > 0 && this.host.sway) { const sw = this.host.sway; sw.uSwing.value.z += this.pullK * (0.045 + 0.012 * Math.sin(t0 * 5.3)); sw.uFlutter.value += this.pullK * 0.012; }
    this.hairCaps();
    this.hand.after();
    if (this.room.visible) this.roomFrame(t0);
  }

  /** The room's own life each frame: lamp, page glow, lanterns (leaning with the pull), dust, orrery. */
  private lampK = 1; private glowK = 0; private pullK = 0;
  private roomFrame(t0: number) {
    const lvl = voice.level();
    const lampK = this.lampK, flick = lampK < 1 ? (Math.sin(t0 * 41) > 0.2 ? 1 : 0.55) : 1;
    this.lamp.intensity = 4 * lampK * flick * (1 + Math.sin(t0 * 3.1) * 0.015);
    this.lampBulb.emissiveIntensity = 3.5 * lampK * flick;
    this.halo.intensity = 0.15 + lvl * 0.45;
    this.key.intensity = (2.0 + 3.0 * lampK) + Math.sin(t0 * 7.3) * 0.12 + Math.sin(t0 * 3.1) * 0.2;
    for (const m of this.pageMats) m.emissiveIntensity = 0.02 + lampK * 0.015 + this.glowK * 2.2;
    const pk = this.pullK;
    for (const [i, ln] of this.lantern.entries()) {
      const f = 0.86 + 0.1 * Math.sin(t0 * (8.1 + i) + i) + 0.04 * Math.sin(t0 * 23.7 + i * 2) - pk * 0.25 * (0.5 + 0.5 * Math.sin(t0 * 31 + i));
      ln.l.intensity = ln.base * f; ln.m.emissiveIntensity = 2.6 * f;
      // the flame leans towards the window and stretches thin
      ln.f.rotation.x = -pk * (0.9 + 0.15 * Math.sin(t0 * 17 + i)); ln.f.scale.set(1 - pk * 0.35, 1 + pk * 0.6, 1 - pk * 0.35);
    }
    this.lampG.rotation.x = pk * 0.03 * Math.sin(t0 * 23);
    // the candle: upright and breathing, then laid over towards the window, drawn long and thin, guttering
    {
      const gut = pk > 0.05 ? 0.75 + 0.25 * Math.sin(t0 * 37) * Math.sin(t0 * 11.3) : 1;
      this.candle.rotation.x = -pk * (1.12 + 0.12 * Math.sin(t0 * 19)) + Math.sin(t0 * 2.3) * 0.03; this.candle.rotation.z = Math.sin(t0 * 3.1) * 0.03 + pk * 0.08 * Math.sin(t0 * 27);
      this.candle.scale.set(1 - pk * 0.3, (1 + 0.06 * Math.sin(t0 * 9.1) + pk * 0.85) * gut, 1 - pk * 0.3);
      (this.candleGlow.material as THREE.SpriteMaterial).opacity = 0.35 * gut * (1 - pk * 0.35);
      this.candleGlow.position.z = this.candle.position.z - pk * 0.03;
    }
    // the slips: one after another they lift, tumble and skate across the floor to the foot of the window
    for (const sl of this.slips) {
      const u = Math.min(1, Math.max(0, (this.drift - sl.d) / 5.5)), e = u * u * (3 - 2 * u);
      sl.m.position.lerpVectors(sl.a, sl.b, e); sl.m.position.y += Math.sin(Math.PI * Math.min(1, u * 1.15)) * sl.h * (0.8 + 0.2 * Math.sin(u * 23 + sl.s));
      const tum = Math.sin(Math.PI * u);
      sl.m.rotation.set(tum * Math.sin(u * 17 + sl.s) * 1.6, sl.s + u * 7, tum * Math.cos(u * 13 + sl.s) * 1.3);
      // waiting its turn, a slip trembles on the floor
      if (u <= 0 && pk > 0.2 && this.drift > sl.d - 1.2) sl.m.rotation.x = Math.sin(t0 * 31 + sl.s) * 0.07 * pk;
    }
    this.beamMat.uniforms.uTime.value = t0;
    this.orrery.rotation.y = t0 * 0.05;
    for (const w of this.worlds) { const a = w.a + t0 * w.s; w.m.position.set(Math.cos(a) * w.r, 0, Math.sin(a) * w.r); }
    this.motes.rotation.y = t0 * 0.008;
    this.motes.position.y = Math.sin(t0 * 0.1) * 0.1;
    this.beamMotes.position.y = Math.sin(t0 * 0.07) * 0.18 - (t0 * 0.012) % 0.6;
    this.beamMotes.position.x = Math.sin(t0 * 0.05) * 0.12;
    // the dust drifts towards the window while the pull is on (and stays where the pull left it)
    this.drift += pk * 0.9 * Math.min(0.05, Math.max(0, t0 - this.roomT));
    this.roomT = t0;
    const mz = (this.drift * 1.4) % 10, bz = this.drift % 10;
    this.motes.position.z = -mz; this.motes2.position.z = 10 - mz; this.motes2.position.y = this.motes.position.y; this.motes2.rotation.y = this.motes.rotation.y;
    this.beamMotes.position.z = -bz; this.beamMotes2.position.set(this.beamMotes.position.x, this.beamMotes.position.y, 10 - bz);
    this.motes2.visible = this.beamMotes2.visible = this.drift > 0;
    // in the pull the dust is a stream you can see: brighter and larger
    (this.motes.material as THREE.PointsMaterial).opacity = 0.4 + pk * 0.5; (this.motes.material as THREE.PointsMaterial).size = 0.014 + pk * 0.012;
  }
  private drift = 0; private roomT = 0;

  /** Where his eyes are now (the head bone, a little forward and up): close-ups follow him as he leans. */
  eyesAt(out = new THREE.Vector3()) {
    const l = this.host.root.getObjectByName('eyeL'), r = this.host.root.getObjectByName('eyeR');
    if (!l || !r) return out.set(0, 1.93, -0.07);
    l.updateWorldMatrix(true, false); r.updateWorldMatrix(true, false);
    return l.getWorldPosition(out).add(r.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
  }

  /** A point on the open spread (canvas pixels) in the world; on the left half it rides the hinged leaf. */
  pagePoint(px: number, py: number, lift = 0, out = new THREE.Vector3()) {
    const x = BW / 2 - (px / PW) * BW, z = BD / 2 - (py / PH) * BD;
    if (px < PW / 2) { out.set(x, 0.002 + lift, z); this.leaf.updateWorldMatrix(true, false); return this.leaf.localToWorld(out); }
    out.set(x, 0.033 + lift, z); this.book.updateWorldMatrix(true, false); return this.book.localToWorld(out);
  }
  /** The page's normal (up out of the paper) and its far direction (away from him), in the world. */
  private pageAxes(onLeaf: boolean) {
    const o = onLeaf ? this.leaf : this.book; o.updateWorldMatrix(true, false);
    const q = o.getWorldQuaternion(new THREE.Quaternion());
    return { up: V(0, 1, 0).applyQuaternion(q), far: V(0, 0, 1).applyQuaternion(q), side: V(1, 0, 0).applyQuaternion(q) };
  }
  /** His left hand flat on the page at (px, py): palm down on the paper, fingers to the far edge. */
  private palmOn(px: number, py: number) {
    const ax = this.pageAxes(px < PW / 2);
    return { at: this.pagePoint(px, py, 0.018), fingers: ax.far.clone().addScaledVector(ax.side, -0.25).normalize(), palm: ax.up.clone().negate() };
  }

  /**
   * Beyond Sagittarius's cold open, "The Entry" (~/megazron/ENTRANCES_v2.md section 4): the nib finishing the sixth
   * name of an entry already written; the empty TO and COST columns; the pull reaching the room; his palm holding the
   * page down; a planned silence and his first look; the Ledger shut; into the black hole's shadow and the title.
   */
  private entry(): Film {
    const cam = this.camera, page = this.page, snd = this.snd;
    const eyes = V(0, 1.93, -0.07), win = V(0, 24, -96);
    const nibAt = (px: number, py: number, lift = 0) => this.pagePoint(px, py, lift);
    const cost = nibAt(COL.cost + 30, ROW0 + 5 * ROWH - 14, 0.012);
    const wellAt = V(0.6, 1.2, -0.66), restAt = nibAt(2250, 930, 0.0);
    const shots: Shot[] = [
      // 1. macro on the nib: the sixth name and its home being written, his hand in frame
      { t0: 0, t1: 7, a: V(-0.03, 1.56, -0.33), b: V(-0.02, 1.55, -0.36), la: nibAt(COL.name + 120, ROW0 + 5 * ROWH), lb: nibAt(COL.from + 120, ROW0 + 5 * ROWH), fov: [12, 12], f: [0.5, 0.5], ap: 0.03, breath: 0.4 },
      // 2. the nib lifts; pull back and up over his left shoulder until the whole entry reads, then it travels to COST
      { t0: 7, t1: 15, a: V(-0.02, 1.55, -0.36), via: V(-0.85, 1.8, -0.55), b: V(-0.82, 2.08, -0.12), la: nibAt(COL.from + 120, ROW0 + 5 * ROWH), lb: nibAt(1460, 700), fov: [12, 30], f: [0.5, 1.75], ap: 0.012, ease: 'io' },
      // 3. from beyond the lectern, low: the nib over the empty COST cell, a bead of ink gathering; him and the window's light behind
      { t0: 15, t1: 24, a: V(0.95, 2.0, 0.32), b: V(0.88, 1.96, 0.24), la: nibAt(1600, 760), lb: cost, fov: [30, 26], f: [1.35, 1.25], ap: 0.016, breath: 0.6 },
      // 4. the pull: the camera goes with the dust past his right shoulder towards the window, the black hole in it
      { t0: 24, t1: 34.5, a: V(0.75, 1.55, 0.7), via: V(0.85, 1.95, -0.9), b: V(0.35, 2.5, -3.6), la: V(0.2, 1.3, -0.8), lb: win, look: [0.15, 0.85], fov: [34, 28], f: [1.4, 60], rack: [0.3, 0.9], ap: 0.01 },
      // 5. the reverse, low and frontal: his left palm comes down flat on the lifting page, his eyes on the window
      { t0: 34.5, t1: 44, a: V(-0.28, 1.28, -2.0), b: V(-0.22, 1.32, -1.85), la: V(0, 1.62, -0.35), lb: V(0, 1.68, -0.3), fov: [38, 36], f: [1.95, 1.85], ap: 0.012 },
      // 6. the slow push to his eyes; at the top of the swell everything stops; he looks into the lens
      { t0: 44, t1: 53.6, origin: () => this.eyesAt(), a: V(-0.08, 0.02, -1.25), b: V(-0.04, 0.0, -0.95), la: V(0, 0, 0), fov: [17, 14], f: [1.25, 0.95], ap: 0.016, breath: 0.6 },
      // 7. on the book's thump: the wide from behind him, small against the window
      { t0: 53.6, t1: 59, a: V(0.7, 1.95, 5.6), b: V(0.6, 2.0, 5.2), la: V(0, 3.6, -9), fov: [40, 39] },
      // 8. the hand-over: over him and on into the window, the lens closing on the shadow until it fills the frame
      { t0: 59, t1: 70, a: V(0.6, 2.0, 5.2), via: V(0.3, 3.1, 0.6), b: V(0.08, 3.5, -6.2), la: V(0, 3.6, -9), lb: win, look: [0, 0.35], fov: [39, 3.2], ease: 'in' },
    ];
    let bedOn = false, hold = -1, sub = -1, low = -1, rise = -1, cut = false, shut = false;
    const film: Film = {
      len: 70, handover: 66.6,
      lines: [],
      start: () => {
        this.drift = 0; this.pullK = 0; this.lampK = 1; this.glowK = 0;
        this.host.setFace(null); this.ink.visible = false; this.leaf.rotation.z = 0;
        sceneSound({ music: null, beds: {} });
        bedOn = false; hold = sub = low = rise = -1; cut = shut = false;
        page.draw(0);
      },
      frame: (ft, dt) => {
        void dt;
        shoot(shots, ft, cam);
        page.draw(ft);
        // --- his acting ---
        const writing = page.nib(ft);
        let nib: THREE.Vector3 | null = null;
        if (writing) nib = nibAt(writing[0], writing[1]);
        else if (ft < 11) nib = nibAt(COL.from + 230, ROW0 + 5 * ROWH - 30, 0.02 + sm(5.2, 6.5, ft) * 0.02);
        else if (ft < 19.6) nib = nibAt(COL.from + 230 + (COL.cost + 30 - COL.from - 230) * sm(11, 13, ft), ROW0 + 5 * ROWH - 30 + 16 * sm(11, 13, ft), 0.04 - 0.028 * sm(11.5, 13.2, ft));
        else if (ft < 21.2) nib = cost.clone().lerp(wellAt, sm(19.6, 21.2, ft)).add(V(0, Math.sin(sm(19.6, 21.2, ft) * Math.PI) * 0.06, 0));
        else if (ft < 22.2) nib = wellAt.clone().add(V(0, Math.sin(ft * 9) * 0.003, 0));
        // then down beside the book, off the page, low: the quill stays by the Ledger for the rest of the film
        else nib = wellAt.clone().lerp(restAt, sm(22.2, 24.0, ft)).add(V(0, Math.sin(sm(22.2, 24.0, ft) * Math.PI) * 0.04 + Math.sin(ft * 0.7) * 0.002, 0));
        // the left hand: steadies the page while he writes, lifts off as he straightens to the window, comes down flat on
        // the lifting page without his eyes leaving the window, and shuts the book
        let left: ReturnType<Vault['palmOn']> | null = null;
        if (ft < 24.5) left = this.palmOn(760, 720);
        else if (ft >= 35.6 && ft < 46.5) left = this.palmOn(560 + sm(35.6, 37, ft) * 40, 760);
        else if (ft >= 52.2 && ft < 54.4) left = this.palmOn(520, 700);
        this.hand.set(nib, left);
        this.ink.visible = ft > 14 && ft < 20.8; this.ink.scale.setScalar(0.4 + sm(14, 19, ft) * 1.1);
        // the page lifts in the pull until his palm holds it; later he shuts it with that hand
        const lift = ft < 46.5 ? sm(28, 31, ft) * (0.32 + 0.12 * Math.sin(ft * 13) + 0.06 * Math.sin(ft * 29)) * (1 - sm(35.8, 36.9, ft)) : 0; // after the silence it lies flat by itself
        this.leaf.rotation.z = lift + sm(52.4, 53.6, ft) * Math.PI * 0.985;
        if (!shut && ft >= 53.6) { shut = true; snd.thump(0.7, 80); audio.sample('leather', 0.8, { at: { x: 0, y: 1.2, z: -0.8 }, near: 2, tag: 'mz' }); }
        // the pull: dust, flames and the lamp lean to the window from 24 s; it all stops dead at 46.5 s
        this.pullK = ft < 46.5 ? sm(24, 30, ft) * (0.85 + 0.15 * Math.sin(ft * 3.3)) : 0;
        // where he looks: the nib, the empty column, the window, then us
        const gaze = ft < 13 ? (nib ?? eyes) : ft < 24.5 ? cost : ft < 47.0 ? V(0, 6, -30) : ft < 52.4 ? cam.position : ft < 54 ? nibAt(1500, 600) : V(0, 5, -30);
        this.host.setLookTarget(gaze);
        this.host.setGazeRate(ft > 46.9 && ft < 47.6 ? 1.2 : null);
        this.host.setFace(ft > 47 && ft < 52.5 ? { squint: 0.18, frown: 0.12 } : ft > 25 && ft < 46.5 ? { squint: 0.25 } : null);
        // --- sound ---
        snd.scratch(page.writing(ft), ft, 0.08);
        if (!bedOn && ft > 7) { bedOn = true; sceneSound({ music: null, beds: { amb_room: 0.5 } }); hold = snd.hold([73.42, 110.0, 146.83], 0.22, 5); }
        if (sub < 0 && ft > 24) { sub = snd.hold([36.7, 55.0], 0.0, 1, 'sine', 200); snd.fade(sub, 0.55, 18); audio.sample('rumble', 0.55, { tag: 'mz', dur: 23 }); rise = snd.hold([220, 233.08], 0.0, 1, 'sawtooth', 900); snd.fade(rise, 0.06, 20); snd.bend(rise, 1.5, 20); }
        if (ft > 27 && ft < 46.5) {
          // the room straining: slates ticking in their shelves, the page and the lantern cages rattling
          if (Math.random() < this.pullK * 0.18) snd.burst(1800 + Math.random() * 2400, 6, 0.04, 0.06 * this.pullK);
          if (lift > 0.05 && Math.random() < 0.3) snd.burst(500 + Math.random() * 400, 1.2, 0.08, 0.05);
        }
        // the planned silence: everything at once
        if (!cut && ft >= 46.5) { cut = true; for (const id of [hold, sub, rise]) snd.fade(id, 0, 0); audio.stopTag('mz', 0.05); audio.bedLevel('amb_room', 0, 0.05); }
        if (low < 0 && ft >= 53.6) { low = snd.hold([36.71, 55.0, 73.42], 0.26, 2.5); audio.bedLevel('amb_room', 0.4, 1.2); }
        if (ft >= 66) { snd.fade(low, 0, 3); audio.bedLevel('amb_room', 0, 3); }
      },
      stop: () => { this.pullK = 0; this.ink.visible = false; },
    };
    return film;
  }
}

/** The entry on the Ledger's spread: the header and five rows already written, the sixth being written as we open. */
function ledgerInk() {
  const ink: Ink[] = [];
  const brown = 'rgba(36,20,12,0.9)';
  ink.push({ text: 'THE LAST LEDGER', x: 1290, y: 190, t0: -1, t1: -1, size: 52, color: brown });
  ink.push({ text: '2189 . Day 41 . the galactic centre corridor', x: 1110, y: 290, t0: -1, t1: -1, size: 36, color: brown });
  const head = (text: string, x: number) => ink.push({ text, x, y: ROW0 - 70, t0: -1, t1: -1, size: 34, color: 'rgba(60,30,20,0.85)' });
  head('NAME', COL.name); head('FROM', COL.from); head('TO', COL.to); head('COST', COL.cost);
  ROWS.forEach(([name, from], i) => {
    const y = ROW0 + i * ROWH;
    if (i < 5) { ink.push({ text: name, x: COL.name, y, t0: -1, t1: -1, size: 46, color: brown }); ink.push({ text: from, x: COL.from, y, t0: -1, t1: -1, size: 46, color: brown }); }
    else { ink.push({ text: name, x: COL.name, y, t0: 0.4, t1: 2.6, size: 46, color: brown }); ink.push({ text: from, x: COL.from, y, t0: 3.1, t1: 5.2, size: 46, color: brown }); }
  });
  return ink;
}

const NO_MARKS = (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; })();

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
    if (s.lengthSq() < 1e-8 || own.dot(s.clone().normalize()) < 0.5) continue;
    const m = s.clone().normalize(); nor.setXYZ(i, m.x, m.y, m.z);
  }
  nor.needsUpdate = true;
}

/** Shading eased across a mesh's neighbouring points (a few passes of each normal with its neighbours'): soft cloth, no facets. */
function relaxNormals(g: THREE.BufferGeometry, passes: number) {
  const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute, idx = g.index;
  if (!pos || !nor || !idx || g.userData.relaxed) return;
  g.userData.relaxed = true;
  const id = new Int32Array(pos.count), seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`;
    let w = seen.get(k); if (w === undefined) { w = seen.size; seen.set(k, w); }
    id[i] = w;
  }
  const n = seen.size; let N = new Float32Array(n * 3);
  for (let i = 0; i < pos.count; i++) { const w = id[i] * 3; N[w] += nor.getX(i); N[w + 1] += nor.getY(i); N[w + 2] += nor.getZ(i); }
  const nb: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < idx.count; t += 3) { const a = id[idx.getX(t)], b = id[idx.getX(t + 1)], c = id[idx.getX(t + 2)]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
  const unit = (A: Float32Array) => { for (let w = 0; w < n; w++) { const l = Math.hypot(A[w * 3], A[w * 3 + 1], A[w * 3 + 2]) || 1; A[w * 3] /= l; A[w * 3 + 1] /= l; A[w * 3 + 2] /= l; } };
  unit(N);
  for (let p = 0; p < passes; p++) {
    const M = N.slice();
    for (let w = 0; w < n; w++) for (const o of nb[w]) { M[w * 3] += N[o * 3]; M[w * 3 + 1] += N[o * 3 + 1]; M[w * 3 + 2] += N[o * 3 + 2]; }
    unit(M); N = M;
  }
  // (a point whose own normal faces away from the eased one keeps its own: the two sides of a doubled layer)
  for (let i = 0; i < pos.count; i++) { const w = id[i] * 3; if (nor.getX(i) * N[w] + nor.getY(i) * N[w + 1] + nor.getZ(i) * N[w + 2] > 0.3) nor.setXYZ(i, N[w], N[w + 1], N[w + 2]); }
  nor.needsUpdate = true;
}

// The cold open's lines at their seconds (the film itself is Vault.entry; ENTRANCES_v2.md section 4).
// the opening's lines (bs3.ts): he talks to the player
const INTRO: VaultLine[] = BS3_LINES.map(([key, at]) => ({ key, at }));

/** Scene scripts. `s` says what the player actually did. */
export function vaultScript(id: 'intro' | 'l3' | 'l7' | 'ch1' | 'ch2' | 'ep2', s: { ateRed: boolean; deaths: number; bites: number; renamed: boolean; failed?: number; comments?: string[] }): VaultLine[] {
  // what the record earned: the Ledger, read back
  const said = (s.comments ?? []).map((key, i): VaultLine => ({ key, shot: i % 2 ? 'profile' : 'hands', pose: i % 2 ? 'present' : 'write' }));
  switch (id) {
    // another story's film (tools: a recording sets window.__mzFilm = { lines: [[key, second], ...] } and __mzSet)
    case 'intro': { const f = (globalThis as { __mzFilm?: { lines?: [string, number][] } }).__mzFilm; return f?.lines ? f.lines.map(([key, at]) => ({ key, at })) : INTRO.map((l) => ({ ...l })); }
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
