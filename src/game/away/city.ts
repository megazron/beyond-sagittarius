import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createCharacter, Character, CrewId, CrewPose } from '../../characters/character';
import { LINEAGES, randomLook, PlayerLook, defaultLook } from '../../characters/custom';
import { loadTexture } from '../../core/assets';
import type { AwayStage, AwayTask } from './stage';
import type { StageBody } from './kit';
import { buildFuture } from './cityfuture';

/**
 * Port Sahil, Taravel, 2189: the last normal afternoon. One long bazaar street from the flat (north-east corner)
 * to the spaceport gate (south). The player's list runs down it, and each step teaches one control.
 *
 * Ground is exact by construction: height changes only across the street (road, kerb ramp, pavement and everything
 * behind it), and the ground mesh has a vertex column at every breakpoint, so the drawn surface is the walkable one.
 * Assets: CC0 from Poly Haven (tools/fetch_city.py, credited in CREDITS.md).
 */

const N = 78, S = -78; // street ends (z)
const FRONT = 9.5; // building line, both sides
/** Across the street: [x, height]. Linear between, the same on both sides. */
const PROFILE: [number, number][] = [[0, 0], [4, 0], [4.35, 0.14], [FRONT, 0.14]];
const hx = (x: number) => {
  const a = Math.abs(x);
  for (let i = 1; i < PROFILE.length; i++) {
    const [x0, y0] = PROFILE[i - 1], [x1, y1] = PROFILE[i];
    if (a <= x1) return y0 + (y1 - y0) * (a - x0) / (x1 - x0);
  }
  return PROFILE[PROFILE.length - 1][1];
};
const FLOOR = 0.14;

export interface CityPerson { id: string; fig: Character; pos: THREE.Vector3; yaw: number; pose: CrewPose; phase: number; walk?: { z0: number; z1: number; dir: number; speed: number } }

// ---------- small makers ----------
let seed = 1234567;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function shade(hex: string, k: number) { const c = new THREE.Color(hex); c.offsetHSL(0, 0, k); return `#${c.getHexString()}`; }
const sign = (text: string, bg: string, fg: string) => canvasTex(1024, 192, (g) => {
  const gr = g.createLinearGradient(0, 0, 0, 192); gr.addColorStop(0, bg); gr.addColorStop(1, shade(bg, -0.2));
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 192);
  g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(14, 14, 996, 164);
  g.fillStyle = fg; g.font = '700 100px Rajdhani, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = fg; g.shadowBlur = 16; g.fillText(text, 512, 100);
});
/** What you see through a shop window: shelves of colour, warmly lit. */
const shelves = (hue: number) => canvasTex(512, 256, (g) => {
  g.fillStyle = `hsl(${hue},30%,26%)`; g.fillRect(0, 0, 512, 256);
  for (let r = 0; r < 4; r++) {
    g.fillStyle = 'rgba(40,24,12,.9)'; g.fillRect(0, 50 + r * 56, 512, 8);
    for (let x = 6; x < 506; ) { const w = 10 + rnd() * 26; g.fillStyle = `hsl(${(hue + rnd() * 120) % 360},${55 + rnd() * 30}%,${45 + rnd() * 25}%)`; g.fillRect(x, 50 + r * 56 - 14 - rnd() * 26, w - 3, 40); x += w; }
  }
  const lg = g.createRadialGradient(256, 30, 10, 256, 30, 300); lg.addColorStop(0, 'rgba(255,230,180,.55)'); lg.addColorStop(1, 'rgba(255,230,180,0)');
  g.fillStyle = lg; g.fillRect(0, 0, 512, 256);
});
const stripes = (a: string, b: string) => { const t = canvasTex(256, 64, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * 32, 0, 32, 64); } }); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
/** A box whose uvs are in metres / tile, so a texture keeps one scale on every wall. */
function boxGeo(w: number, h: number, d: number, tile = 3) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / tile, uv.getY(k) * dims[f][1] / tile); }
  return g;
}

/** Shops on the bazaar: name, side (-1 west, 1 east), z, sign colours. The names are parodies on purpose. */
export const SHOPS: { id: string; name: string; side: number; z: number; bg: string; fg: string; hue: number }[] = [
  { id: 'capple', name: 'Capple Store', side: 1, z: 44, bg: '#f4f4f6', fg: '#202024', hue: 210 },
  { id: 'lamazon', name: 'Lamazon Orbit', side: -1, z: 30, bg: '#232f3e', fg: '#ff9900', hue: 30 },
  { id: 'chai', name: 'Chai Cosmos', side: 1, z: 14, bg: '#7a2e12', fg: '#ffd27a', hue: 20 },
  { id: 'biryani', name: 'Biryani Supernova', side: -1, z: 0, bg: '#1d6b3a', fg: '#fff3c4', hue: 45 },
  { id: 'dawai', name: 'Dawai Dome', side: 1, z: -16, bg: '#e8f6f2', fg: '#0d7a5f', hue: 160 },
  { id: 'mehndi', name: 'Pixel Mehndi', side: -1, z: -30, bg: '#5a1f6e', fg: '#ffb6e6', hue: 300 },
];

/** The player's list, top to bottom. `label` keys live in the i18n files under `city.task.*`. */
const TASKS: { id: string; x: number; z: number; r?: number; need?: string[] }[] = [
  { id: 'paratha', x: 12.4, z: 66.6 },
  { id: 'pack', x: 12.0, z: 69.8, need: ['paratha'] },
  { id: 'phone', x: 8.4, z: 44, need: ['pack'] },
  { id: 'parcel', x: -8.4, z: 30, need: ['phone'] },
  { id: 'chai', x: 7.4, z: 15.6, need: ['parcel'] },
  { id: 'tram', x: -5.2, z: -6, need: ['chai'] },
  { id: 'ring', x: 2.8, z: -44, r: 2.2, need: ['tram'] },
  { id: 'gate', x: 0, z: -72, r: 4, need: ['ring'] },
];

/** Where the five are, and what they're doing when you get there. */
const FRIENDS: { id: CrewId; x: number; z: number; yaw: number; pose: CrewPose }[] = [
  { id: 'strong', x: -6.6, z: 2.5, yaw: Math.PI / 2, pose: 'idle' },
  { id: 'medic', x: 7.4, z: -14, yaw: -Math.PI / 2, pose: 'argue' },
  { id: 'explorer', x: 6.2, z: 17.4, yaw: -Math.PI / 2, pose: 'write' },
  { id: 'builder', x: -5.0, z: -8.6, yaw: Math.PI / 2, pose: 'present' },
  { id: 'social', x: -1.5, z: -40.5, yaw: 0.3, pose: 'selfie' },
];

/** Townsfolk standing: where, and the one line each gives you (`city.npc.*`). */
const FOLK: { id: string; x: number; z: number; yaw: number; pose: CrewPose; lineage: PlayerLook['lineage'] }[] = [
  { id: 'chaiwala', x: 8.4, z: 11.6, yaw: -Math.PI / 2, pose: 'idle', lineage: 'ortek' },
  { id: 'aunty', x: -7.6, z: -28, yaw: Math.PI / 2, pose: 'argue', lineage: 'sirelle' },
  { id: 'clerk', x: 8.9, z: 46.2, yaw: -Math.PI / 2, pose: 'present', lineage: 'vael' },
  { id: 'driver', x: 3, z: 22, yaw: 0, pose: 'idle', lineage: 'korrath' },
  { id: 'kid1', x: -1, z: -60, yaw: 0.4, pose: 'cheer', lineage: 'tarnkin' },
  { id: 'kid2', x: 2, z: -63, yaw: -2.6, pose: 'point', lineage: 'ulari' },
  { id: 'queue1', x: -6.6, z: 4.2, yaw: Math.PI / 2, pose: 'idle', lineage: 'tarnkin' },
  { id: 'queue2', x: -6.6, z: 5.9, yaw: Math.PI / 2, pose: 'write', lineage: 'vael' },
  { id: 'pharma', x: 8.9, z: -17.2, yaw: -Math.PI / 2, pose: 'facepalm', lineage: 'ulari' },
  { id: 'tourist', x: 5.5, z: -36, yaw: 2.2, pose: 'selfie', lineage: 'sirelle' },
];

// ---------- models (CC0, Poly Haven, packed by tools/fetch_city.py) ----------
const gl = new GLTFLoader(); gl.setMeshoptDecoder(MeshoptDecoder);
const modelCache = new Map<string, Promise<THREE.Object3D>>();
function model(name: string) {
  let p = modelCache.get(name);
  if (!p) {
    p = gl.loadAsync(`${import.meta.env.BASE_URL}models/city/${name}.glb`).then((g) => {
      g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      return g.scene;
    });
    modelCache.set(name, p);
  }
  return p;
}

export function buildCity(label: (k: string) => string, detail = 1): AwayStage & { bind(b: StageBody): void; people: CityPerson[] } {
  seed = 1234567; // the same city every time
  const rich = detail >= 1; // phones get fewer props, people and lights
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf2b88a, 38, 210); // warm evening haze gives the street depth
  const blocks: THREE.Box3[] = [];
  const add = <T extends THREE.Object3D>(o: T) => { scene.add(o); return o; };
  const solid = (m: THREE.Object3D) => { m.updateMatrixWorld(true); blocks.push(new THREE.Box3().setFromObject(m)); return m; };
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, tile = 3) => {
    const o = new THREE.Mesh(boxGeo(w, h, d, tile), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return add(o);
  };
  const place = (name: string, x: number, y: number, z: number, yaw: number, scale = 1) => void model(name).then((m) => {
    const o = m.clone(); o.position.set(x, y, z); o.rotation.y = yaw; o.scale.setScalar(scale); add(o);
  }).catch(() => undefined);

  // ---- sky: warm horizon to deep blue, the sun, and Taravel's ringed neighbour ----
  const skyMesh = add(new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sun: { value: new THREE.Vector3(-0.38, 0.34, -0.86).normalize() } },
    vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `varying vec3 d; uniform vec3 sun;
      void main(){ float h = clamp(d.y, -0.1, 1.); vec3 top = vec3(.2, .38, .7), hor = vec3(1., .74, .48), low = vec3(.92, .64, .44);
        vec3 c = mix(hor, top, pow(max(h, 0.), .55)); c = mix(low, c, smoothstep(-.1, .05, d.y));
        float s = max(dot(d, sun), 0.); c += vec3(1., .75, .45) * (pow(s, 700.) * 6. + pow(s, 10.) * .3);
        gl_FragColor = vec4(c, 1.); }`,
  })));
  // the renderer turns this sky into image-based light: shade reads as sky-lit, not black
  scene.userData.skyForEnv = skyMesh; scene.userData.envIntensity = 1.6; scene.userData.ao = rich;
  const planet = add(new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, depthWrite: false, transparent: true, opacity: 0.85, map: canvasTex(512, 512, (g) => {
    g.translate(256, 256); g.rotate(-0.35);
    g.strokeStyle = 'rgba(240,220,200,.45)'; g.lineWidth = 10; g.beginPath(); g.ellipse(0, 0, 230, 60, 0, Math.PI, 2 * Math.PI); g.stroke();
    const b = g.createRadialGradient(-30, -30, 10, 0, 0, 120); b.addColorStop(0, '#f6e8d6'); b.addColorStop(1, '#b7a2c6');
    g.fillStyle = b; g.beginPath(); g.arc(0, 0, 118, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(240,220,200,.6)'; g.beginPath(); g.ellipse(0, 0, 230, 60, 0, 0, Math.PI); g.stroke();
  }) })));
  planet.position.set(120, 150, -260); planet.scale.setScalar(150);

  // late afternoon: a low warm sun down the street, cool sky fill
  add(new THREE.HemisphereLight(0xbfd4ff, 0xc8925f, 1.0)); // bounce off warm paving
  const sun = new THREE.DirectionalLight(0xffb878, 3.2); // golden hour, low, straight down the street from the spaceport end
  sun.position.set(-30, 30, -70); sun.castShadow = true;
  sun.shadow.mapSize.set(rich ? 2048 : 1024, rich ? 2048 : 1024); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 90, bottom: -90, far: 240 });
  add(sun); add(sun.target);

  // ---- textures: Poly Haven sets, one tile in metres ----
  const tex = (set: string, mats: THREE.MeshStandardMaterial[], rep: [number, number] = [1, 1], size: '1k' | '512' = rich ? '1k' : '512') => {
    void Promise.all([loadTexture(`city/${set}`, 'diff', size), loadTexture(`city/${set}`, 'nor', size)]).then(([a, n]) => {
      for (const m of mats) {
        const a2 = a.clone(), n2 = n.clone(); a2.repeat.set(...rep); n2.repeat.set(...rep); a2.needsUpdate = n2.needsUpdate = true;
        m.map = a2; m.normalMap = n2; m.needsUpdate = true;
      }
    }).catch(() => undefined);
  };

  // ---- ground: columns at the profile's breakpoints, rows every 2 m ----
  const xs = [...new Set([-26, -20, -14, ...PROFILE.flatMap(([x]) => [x, -x]), 14, 20, 26])].sort((a, b) => a - b);
  const rows = Math.round((N - S + 8) / 2), z0 = S - 4;
  const strip = (cols: number[], tile: number) => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [], W = cols.length;
    for (let j = 0; j <= rows; j++) for (const x of cols) { const z = z0 + j * 2; pos.push(x, hx(x), z); uv.push(x / tile, z / tile); }
    for (let j = 0; j < rows; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i, b = a + 1, c = a + W, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const paving = new THREE.MeshStandardMaterial({ color: 0xe0d2c0, roughness: 0.9 }); tex('pavement', [paving]);
  const ground = add(new THREE.Mesh(strip(xs, 2.5), paving)); ground.receiveShadow = true; ground.userData.ground = true;
  // the road and the kerbs: the same vertices, drawn over in depth instead of lifted, never something to stand on
  const over = (m: THREE.MeshStandardMaterial, k = 2) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -k });
  const roadM = over(new THREE.MeshStandardMaterial({ color: 0x9a948e, roughness: 0.92 })); tex('road', [roadM]);
  const road = add(new THREE.Mesh(strip([-4, 4], 4), roadM)); road.receiveShadow = true; road.userData.ground = false;
  const kerbM = over(new THREE.MeshStandardMaterial({ color: 0xc8c0b2, roughness: 0.8 }));
  for (const sd of [-1, 1]) { const kb = add(new THREE.Mesh(strip(sd < 0 ? [-4.35, -4] : [4, 4.35], 1), kerbM)); kb.receiveShadow = true; kb.userData.ground = false; }
  const lineM = new THREE.MeshBasicMaterial({ color: 0xf2e6c8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  for (let z = S; z < N; z += 6) { const l = add(new THREE.Mesh(new THREE.PlaneGeometry(0.14, 3), lineM)); l.rotation.x = -Math.PI / 2; l.position.set(0, 0, z); l.userData.ground = false; }

  // ---- buildings ----
  const facades = [
    { set: 'plaster', tints: [0xf3d9b1, 0xe9b98f, 0xd7e3d0, 0xf1c6c0, 0xcfdcea, 0xf6e7a8] },
    { set: 'brick', tints: [0xffffff, 0xf0d8d0] },
    { set: 'peeling', tints: [0xffffff, 0xe8f0f6, 0xfbe3c4] },
  ];
  const facadeMats = facades.map((f) => f.tints.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 })));
  facades.forEach((f, i) => tex(f.set, facadeMats[i]));
  const parapetM = new THREE.MeshStandardMaterial({ color: 0xd8d0c4, roughness: 0.9 }); tex('parapet', [parapetM], [1, 1], '512');
  const glassM = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.08, metalness: 0.6 });
  const litM = new THREE.MeshStandardMaterial({ color: 0x2a1c10, emissive: 0xffc37a, emissiveIntensity: 1.1, roughness: 0.3 });
  const frameM = new THREE.MeshStandardMaterial({ color: 0xece4d6, roughness: 0.7 });
  const tankM = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 });
  const railM = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.5, metalness: 0.6 });
  const ledMats = [0x6ff7ff, 0xff6ec7, 0xffc36b].map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2), toneMapped: false }));
  const podM = new THREE.MeshStandardMaterial({ color: 0x9fc0d6, roughness: 0.08, metalness: 0.5, emissive: 0xffd9a8, emissiveIntensity: 0.35 });
  const awnings = [stripes('#c0392b', '#f4e6d0'), stripes('#16a085', '#f0f0e0'), stripes('#f39c12', '#fff6e0'), stripes('#2c3e94', '#f2efe6'), stripes('#8e44ad', '#fbe9ff')];
  const lit = (map: THREE.Texture, k = 0.6) => new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: k, roughness: 0.5 });
  const plane = (w: number, h: number, m: THREE.Material, x: number, y: number, z: number, yaw: number) => { const p = add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), m)); p.position.set(x, y, z); p.rotation.y = yaw; return p; };

  const shopAt = (side: number, z0b: number, z1b: number) => SHOPS.find((s) => s.side === side && s.z > z1b + 3.5 && s.z < z0b - 3.5);
  const FLAT = { side: 1, z0: 61, z1: 77 }; // the friends' flat: its own interior, built below
  const h0 = (_f: typeof FLAT) => 2 * 3.3 + 0.6;
  let k = 0;
  for (const side of [-1, 1]) {
    for (let z = N + 2; z > S + 6; ) {
      let len = 10 + Math.floor(rnd() * 5);
      const inFlat = side === FLAT.side && z > FLAT.z0;
      if (inFlat) len = z - FLAT.z0;
      const zc = z - len / 2, floors = inFlat ? 2 : 2 + Math.floor(rnd() * 2), h = floors * 3.3 + 0.6, depth = 12;
      const fi = k % 3 === 2 ? 2 : k % 5 === 1 ? 1 : 0, wallM = pick(facadeMats[fi]);
      const face = side * FRONT, out = -side; // `out` points from the wall into the street
      if (!inFlat) solid(box(depth, h, len - 0.3, wallM, side * (FRONT + depth / 2), h / 2, zc));
      box(depth + 0.3, 0.6, len - 0.1, parapetM, side * (FRONT + depth / 2), h + 0.3, zc);
      // stepped back above the street front: upper floors 4 m behind it, so the skyline shows from the pavement
      if (!inFlat && rnd() < 0.75) {
        const up = 1 + Math.floor(rnd() * 4), uh = up * 3.3, ux = side * (FRONT + 4);
        box(8, uh, len - 2, pick(facadeMats[(fi + 1) % 3]), ux + side * 4, h + 0.6 + uh / 2, zc);
        for (let f = 0; f < up; f++) box(0.06, 1.3, len - 3.4, rnd() < 0.35 ? litM : glassM, ux - side * 0.03, h + 2.3 + f * 3.3, zc).castShadow = false;
        add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, len - 2), ledMats[(k + 2) % ledMats.length])).position.set(ux - side * 0.05, h + 0.6 + uh + 0.05, zc);
      }
      // 2189 on an old street: an LED line along every roof, and smart-glass pods hung off the upper floors
      const led = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, len - 0.3), ledMats[k % ledMats.length])); led.position.set(face + out * 0.18, h + 0.62, zc);
      if (floors >= 3 && rnd() < 0.55) {
        const py = (1 + Math.floor(rnd() * (floors - 1))) * 3.3 + 1.6, pz = zc + (rnd() - 0.5) * (len - 6);
        box(1.7, 2.6, 3.2, podM, face + out * 0.85, py, pz).castShadow = true;
        box(1.72, 0.12, 3.22, ledMats[(k + 1) % ledMats.length], face + out * 0.85, py - 1.3, pz).castShadow = false;
      }
      if (rich) for (let t = 0; t < 1 + Math.floor(rnd() * 2); t++) {
        const tk = add(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.3, 16), tankM)); tk.position.set(side * (FRONT + 3 + rnd() * 6), h + 1.25, zc + (rnd() - 0.5) * (len - 3)); tk.castShadow = true;
      }
      // upper floors: framed windows, some lit, AC units, balconies with washing
      for (let f = 1; f < floors; f++) {
        const y = f * 3.3 + 1.5;
        for (let wz = zc - len / 2 + 1.6; wz < zc + len / 2 - 1.2; wz += 2.6) {
          box(0.12, 1.75, 1.3, frameM, face + out * 0.04, y, wz);
          const g = box(0.06, 1.5, 1.05, rnd() < 0.22 ? litM : glassM, face + out * 0.1, y, wz); g.castShadow = false;
          if (rnd() < 0.18) box(0.55, 0.45, 0.8, frameM, face + out * 0.3, y - 1.05, wz + 0.9);
        }
        if (rnd() < 0.45) {
          const bz = zc + (rnd() - 0.5) * (len - 5), bw = 3.4;
          box(1.1, 0.14, bw, parapetM, face + out * 0.55, y - 1.0, bz);
          box(0.05, 0.9, bw, railM, face + out * 1.08, y - 0.5, bz);
          if (rich && rnd() < 0.6) {
            const cloth = add(new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), new THREE.MeshStandardMaterial({ color: pick([0xd64545, 0x3a7bd5, 0xf0c419, 0xffffff, 0x2ecc71]), side: THREE.DoubleSide, roughness: 1 })));
            cloth.position.set(face + out * 1.12, y - 0.55, bz + (rnd() - 0.5) * 2); cloth.rotation.y = Math.PI / 2;
          }
        }
      }
      if (!inFlat) {
        // ground floor: a lit shopfront where the list sends you, roller shutters elsewhere
        const shop = shopAt(side, z, z - len);
        if (shop) {
          for (const dz of [-3.15, 3.15]) box(0.3, 3.4, 0.3, frameM, face + out * 0.15, 1.7 + FLOOR, shop.z + dz);
          box(0.3, 0.3, 6.6, frameM, face + out * 0.15, 3.25 + FLOOR, shop.z); box(0.35, 0.25, 6.6, frameM, face + out * 0.17, 0.12 + FLOOR, shop.z);
          plane(6, 2.7, lit(shelves(shop.hue), 1.0), face + out * 0.03, 1.6 + FLOOR, shop.z, out > 0 ? Math.PI / 2 : -Math.PI / 2); // the lit interior, on the wall behind the glass
          plane(6, 2.7, new THREE.MeshStandardMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.4 }), face + out * 0.33, 1.6 + FLOOR, shop.z, out > 0 ? Math.PI / 2 : -Math.PI / 2);
          plane(6.2, 1.15, lit(sign(shop.name, shop.bg, shop.fg)), face + out * 0.32, 3.85 + FLOOR, shop.z, out > 0 ? Math.PI / 2 : -Math.PI / 2);
          if (rich) { const pl = add(new THREE.PointLight(0xffc98a, 6, 9, 2)); pl.position.set(face + out * 1.6, 3.0, shop.z); }
        }
        for (let wz = zc - len / 2 + 2.2; wz < zc + len / 2 - 2; wz += 4.2) {
          if (shop && Math.abs(wz - shop.z) < 4.6) continue;
          place(rnd() < 0.6 ? 'rollershutter_door' : 'rollershutter_window_01', face + out * 0.02, FLOOR, wz, out > 0 ? Math.PI / 2 : -Math.PI / 2);
        }
        // an awning over the pavement: striped cloth, tilted down to the street
        const am = new THREE.MeshStandardMaterial({ map: awnings[k % awnings.length].clone(), side: THREE.DoubleSide, roughness: 0.9 });
        am.map!.repeat.set(1, (len - 1.4) / 2); am.map!.needsUpdate = true;
        const aw = add(new THREE.Mesh(new THREE.PlaneGeometry(1.7, len - 1.4), am));
        aw.rotation.set(-Math.PI / 2, out * 0.3, 0, 'XYZ'); aw.position.set(face + out * 0.8, 3.75 + FLOOR, zc); aw.castShadow = true;
      }
      z -= len; k++;
    }
  }
  // walls closing both ends of the street, so nobody walks off the map
  blocks.push(new THREE.Box3(new THREE.Vector3(-30, -1, N + 2), new THREE.Vector3(30, 20, N + 10)), new THREE.Box3(new THREE.Vector3(-30, -1, S - 12), new THREE.Vector3(30, 20, S - 1.5)));
  box(19, 9, 1, facadeMats[0][1], 0, 4.5, N + 2.5);

  // ---- the flat: a small, cluttered home with a window on the street ----
  {
    const x0 = FRONT, x1 = FRONT + 6.5, zA = 64, zB = 71.5, hgt = 3.1;
    const inM = new THREE.MeshStandardMaterial({ color: 0xf6dfbc, roughness: 0.95 }); tex('plaster', [inM], [1, 1], '512');
    const outM = facadeMats[0][4];
    const floorM = over(new THREE.MeshStandardMaterial({ color: 0xc8956a, roughness: 0.7 }), 1); tex('planks', [floorM], [3, 3], '512');
    const fl = add(new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, zB - zA), floorM)); fl.rotation.x = -Math.PI / 2; fl.position.set((x0 + x1) / 2, FLOOR, (zA + zB) / 2); fl.receiveShadow = true; fl.userData.ground = false;
    // the rest of the block is solid: the neighbours' flats
    solid(box(12, h0(FLAT), zA - FLAT.z0, outM, FRONT + 6, h0(FLAT) / 2, (FLAT.z0 + zA) / 2));
    solid(box(12, h0(FLAT), FLAT.z1 - zB, outM, FRONT + 6, h0(FLAT) / 2, (zB + FLAT.z1) / 2));
    solid(box(12 - (x1 - x0), h0(FLAT), zB - zA, outM, x1 + (12 - (x1 - x0)) / 2, h0(FLAT) / 2, (zA + zB) / 2));
    box(x1 - x0, h0(FLAT) - hgt, zB - zA, outM, (x0 + x1) / 2, hgt + FLOOR + (h0(FLAT) - hgt - FLOOR) / 2, (zA + zB) / 2);
    const wall = (w: number, hh: number, d: number, x: number, y: number, z: number, m: THREE.Material) => solid(box(w, hh, d, m, x, y, z));
    // street wall: door at z 64.6 to 66.2, a window at z 68 to 70.4
    wall(0.3, hgt, 0.6, x0, hgt / 2 + FLOOR, 64.3, outM);
    wall(0.3, hgt, 1.8, x0, hgt / 2 + FLOOR, 67.1, outM); wall(0.3, hgt, 1.1, x0, hgt / 2 + FLOOR, 70.95, outM);
    box(0.3, hgt - 2.3, 1.6, outM, x0, 2.3 + (hgt - 2.3) / 2 + FLOOR, 65.4);
    wall(0.3, 1.0, 2.4, x0, 0.5 + FLOOR, 69.2, outM); box(0.3, hgt - 2.3, 2.4, outM, x0, 2.3 + (hgt - 2.3) / 2 + FLOOR, 69.2);
    box(0.08, 1.3, 2.4, new THREE.MeshStandardMaterial({ color: 0xbfd7e6, transparent: true, opacity: 0.15, roughness: 0.05 }), x0, 1.65 + FLOOR, 69.2);
    wall(0.3, hgt, zB - zA, x1, hgt / 2 + FLOOR, (zA + zB) / 2, inM); wall(x1 - x0, hgt, 0.3, (x0 + x1) / 2, hgt / 2 + FLOOR, zA, inM); wall(x1 - x0, hgt, 0.3, (x0 + x1) / 2, hgt / 2 + FLOOR, zB, inM);
    const ceil = add(new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, zB - zA), inM)); ceil.rotation.x = Math.PI / 2; ceil.position.set((x0 + x1) / 2, hgt + FLOOR, (zA + zB) / 2);
    const lamp = add(new THREE.PointLight(0xffd9a0, rich ? 8 : 6, 9, 1.5)); lamp.position.set(12.8, 2.7, 68);
    const fairy = add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, zB - zA - 0.6), ledMats[2])); fairy.position.set(x1 - 0.2, 2.8, (zA + zB) / 2);
    plane(1.6, 0.4, lit(canvasTex(512, 128, (g) => { g.fillStyle = '#20324a'; g.fillRect(0, 0, 512, 128); g.fillStyle = '#f2ead8'; g.font = '600 64px Rajdhani, sans-serif'; g.textAlign = 'center'; g.fillText('FLAT 4B', 256, 86); }), 0.3), x0 - 0.17, 2.55 + FLOOR, 65.4, -Math.PI / 2);
    // the morning's clutter: a small table, a sofa under the window, a bed in the corner, shelves, a kettle
    for (const [n, x, y, z, yaw, sc] of [
      ['dining_table', 13.2, FLOOR, 66.4, Math.PI / 2, 0.8], ['dining_chair_02', 13.2, FLOOR, 65.4, 0, 1], ['sofa_02', 10.2, FLOOR, 69.2, Math.PI / 2, 0.9],
      ['old_bed_frame', 14.6, FLOOR, 70.2, Math.PI / 2, 0.9], ['wooden_bookshelf_worn', 15.6, FLOOR, 65.2, -Math.PI / 2, 0.85], ['drawer_cabinet', 15.6, FLOOR, 67.2, -Math.PI / 2, 0.85],
      ['vintage_electric_kettle', 13.4, FLOOR + 0.63, 66.7, 0.4, 1], ['wall_clock', x1 - 0.2, 2.2, 68.6, -Math.PI / 2, 1], ['potted_plant_02', 10.4, FLOOR, 71, 0, 0.8],
      ['ceiling_fan', 12.8, hgt + FLOOR - 0.05, 68, 0, 0.8], ['cardboard_box_01', 11.0, FLOOR, 64.7, 0.3, 0.8], ['wicker_basket_01', 15.2, FLOOR, 68.6, 0, 1],
    ] as [string, number, number, number, number, number][]) place(n, x, y, z, yaw, sc);
    for (const b of [[13.2, 66.4, 0.6, 0.8], [10.2, 69.2, 0.5, 1.0], [14.6, 70.2, 0.9, 1.1], [15.6, 66.2, 0.4, 1.4]]) blocks.push(new THREE.Box3(new THREE.Vector3(b[0] - b[2], 0, b[1] - b[3]), new THREE.Vector3(b[0] + b[2], 1, b[1] + b[3])));
    const plate = add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.02, 24), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.4 }))); plate.position.set(13.1, FLOOR + 0.64, 66.2);
    const para = add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 24), new THREE.MeshStandardMaterial({ color: 0xd9a35a, roughness: 0.8 }))); para.position.set(13.1, FLOOR + 0.66, 66.2);
    box(0.55, 0.4, 0.3, new THREE.MeshStandardMaterial({ color: 0x2c4a6a, roughness: 0.8 }), 12.0, FLOOR + 0.2, 70.6);
    const jacket = box(0.5, 0.06, 0.4, new THREE.MeshStandardMaterial({ color: 0x7a3b2e, roughness: 0.95 }), 10.3, FLOOR + 0.55, 68.6); jacket.rotation.y = 0.4;
    const rug = add(new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), over(new THREE.MeshStandardMaterial({ roughness: 1, map: canvasTex(512, 352, (g) => {
      g.fillStyle = '#8e2b2b'; g.fillRect(0, 0, 512, 352); g.strokeStyle = '#e8c27a'; g.lineWidth = 14; g.strokeRect(20, 20, 472, 312);
      g.fillStyle = '#e8c27a'; g.beginPath(); g.moveTo(256, 110); g.lineTo(330, 176); g.lineTo(256, 242); g.lineTo(182, 176); g.closePath(); g.fill();
    }) }), 3))); rug.rotation.x = -Math.PI / 2; rug.position.set(12.4, FLOOR, 68.8); rug.userData.ground = false;
    const poster = (title: string, bg: string, fg: string, x: number, z: number, yaw: number) => plane(0.8, 1.1, new THREE.MeshStandardMaterial({ roughness: 0.6, map: canvasTex(256, 360, (g) => {
      g.fillStyle = bg; g.fillRect(0, 0, 256, 360); g.fillStyle = fg; g.font = '700 34px Rajdhani, sans-serif'; g.textAlign = 'center';
      title.split('|').forEach((l, i) => g.fillText(l, 128, 70 + i * 40));
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(40 + i * 35, 260, 14, 0, Math.PI * 2); g.fill(); g.fillRect(28 + i * 35, 276, 24, 40); }
    }) }), x, 1.9 + FLOOR, z, yaw);
    poster('TARAVEL|TITANS|CUP FINAL', '#0d3b66', '#f4d35e', 12.0, zB - 0.17, Math.PI); poster('SIX|LINEAGES|ONE BRAIN CELL', '#ff5d8f', '#ffffff', 14.4, zA + 0.17, 0);
  }

  // ---- pools of light on the paving: under the lamps and in front of every lit shop ----
  const poolTex = canvasTex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 4, 64, 64, 62); r.addColorStop(0, 'rgba(255,200,130,.9)'); r.addColorStop(1, 'rgba(255,200,130,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
  const poolM = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  const pool = (x: number, z: number, r: number) => { const m = add(new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), poolM)); m.rotation.x = -Math.PI / 2; m.position.set(x, hx(x) + 0.01, z); m.userData.ground = false; };
  for (const sh of SHOPS) pool(sh.side * (FRONT - 1.6), sh.z, 3.6);

  // ---- street life: lamps, stalls, the chai stall, furniture ----
  for (let z = S + 10; z < N - 4; z += 14) for (const sd of [-1, 1]) {
    const lz = z + (sd > 0 ? 7 : 0);
    place(rnd() < 0.5 ? 'street_lamp_01' : 'street_lamp_02', sd * 4.8, FLOOR, lz, sd > 0 ? -Math.PI / 2 : Math.PI / 2);
    pool(sd * 4.6, lz, 2.6);
    blocks.push(new THREE.Box3(new THREE.Vector3(sd * 4.8 - 0.2, 0, lz - 0.2), new THREE.Vector3(sd * 4.8 + 0.2, 5, lz + 0.2)));
  }
  // the chai stall: a brass pot on a table, the tea set, plastic chairs that have seen things
  for (const [n, x, y, z, yaw] of [
    ['round_wooden_table_01', 6.4, FLOOR, 12.6, 0], ['brass_pot_01', 6.4, FLOOR + 0.75, 12.6, 0], ['pot_enamel_01', 6.6, FLOOR + 0.75, 12.2, 0], ['tea_set_01', 7.6, FLOOR, 10.6, 0],
    ['plastic_monobloc_chair_01', 5.3, FLOOR, 12.0, 1.2], ['plastic_monobloc_chair_01', 5.5, FLOOR, 13.6, 2.1], ['plastic_monobloc_chair_01', 6.9, FLOOR, 10.4, -0.4],
    ['folding_wooden_stool', 7.2, FLOOR, 14.2, 0.3], ['brass_diya_lantern', 8.9, 2.6, 13.2, 0], ['caged_hanging_light', 7.8, 2.9, 12.8, 0],
  ] as [string, number, number, number, number][]) place(n, x, y, z, yaw);
  blocks.push(new THREE.Box3(new THREE.Vector3(5.8, 0, 12), new THREE.Vector3(7.0, 1, 13.2)));
  // fruit stalls in the middle stretch, under striped canopies
  for (const [x, z] of [[-6.4, 18], [6.4, 26], [-6.4, -20], [6.4, -26]] as [number, number][]) {
    for (const [n, dx, dy, dz, yaw] of [['wooden_crate_01', 0, 0, 0, 0.2], ['wooden_crate_01', 0, 0, 1, -0.1], ['wicker_basket_01', 0, 0.55, 0, 0], ['wicker_basket_02', 0, 0.55, 1, 0]] as [string, number, number, number, number][]) place(n, x + dx, FLOOR + dy, z + dz, yaw);
    for (const f of ['food_apple_01', 'food_pomegranate_01', 'food_lime_01', 'food_pears_asian_01']) place(f, x + (rnd() - 0.5) * 0.3, FLOOR + 0.72, z + rnd() * 1.0, rnd() * 6);
    const canopy = add(new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.8), new THREE.MeshStandardMaterial({ map: awnings[(x > 0 ? 1 : 0) + (z > 0 ? 2 : 0)], side: THREE.DoubleSide })));
    canopy.rotation.set(-Math.PI / 2 + 0.12, 0, 0); canopy.position.set(x, 2.4, z + 0.5); canopy.castShadow = true;
    for (const dz of [-0.8, 1.8]) for (const dx of [-0.95, 0.95]) box(0.05, 2.3, 0.05, railM, x + dx, 1.2, z + dz);
    blocks.push(new THREE.Box3(new THREE.Vector3(x - 0.95, 0, z - 0.8), new THREE.Vector3(x + 0.95, 2, z + 1.8)));
  }
  if (rich) for (const [n, x, y, z, yaw] of [
    ['metal_trash_can', 5, FLOOR, 36, 0], ['metal_trash_can', -5, FLOOR, -12, 0], ['utility_box_01', -9, FLOOR, 22, Math.PI / 2], ['power_box_01', 9.3, 2.2, 3, -Math.PI / 2],
    ['fire_hydrant', 4.8, FLOOR, -2, 0], ['modular_street_seating', -6.5, FLOOR, -48, Math.PI / 2], ['painted_wooden_bench', 6.5, FLOOR, -52, -Math.PI / 2],
    ['planter_box_01', -6.2, FLOOR, 50, 0], ['potted_plant_02', 8.6, FLOOR, 47.8, 0], ['potted_plant_02', 8.6, FLOOR, 40.2, 0], ['plastic_crate_01', -8.6, FLOOR, 27, 0.3],
    ['plastic_crate_02', -8.6, FLOOR, 27.6, -0.2], ['cardboard_box_01', -8.3, FLOOR, 32.6, 0.5], ['cardboard_box_01', -8.6, FLOOR, 33.2, 1.1], ['trashbag', 5.2, FLOOR, 36.7, 0],
    ['security_light', -9.3, 3.0, 30, Math.PI / 2],
  ] as [string, number, number, number, number][]) place(n, x, y, z, yaw);

  // parked hover cars along the kerbs, resting on their glow
  {
    const body = new THREE.CapsuleGeometry(0.85, 2.6, 4, 12); body.rotateX(Math.PI / 2);
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6ff7ff).multiplyScalar(2), toneMapped: false });
    const spots = rich ? [[-3.2, 52, 0xf4f4f6], [3.2, 38, 0xffb347], [-3.2, 22, 0x2c3e94], [3.2, -22, 0xe8e2d4], [-3.2, -30, 0xc0392b], [3.2, 58, 0x16a085]] : [[-3.2, 52, 0xf4f4f6], [3.2, -22, 0xffb347]];
    for (const [x, z, c] of spots) {
      const car = add(new THREE.Mesh(body, new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, metalness: 0.4 }))); car.position.set(x, 0.75, z); car.castShadow = true;
      const g = add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 2.8), glow)); g.position.set(x, 0.1, z);
      blocks.push(new THREE.Box3(new THREE.Vector3(x - 0.9, 0, z - 2.2), new THREE.Vector3(x + 0.9, 1.6, z + 2.2)));
    }
  }
  // stalls spilling onto the road: mats of goods at the kerb
  for (const [x, z] of (rich ? [[3.3, 30], [-3.3, 10], [3.3, -32], [-3.3, -16], [3.3, 48]] : [[3.3, 30], [-3.3, -16]]) as [number, number][]) {
    const mat = add(new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.4), over(new THREE.MeshStandardMaterial({ map: awnings[Math.abs(Math.round(z)) % awnings.length], roughness: 1 }), 3))); mat.rotation.x = -Math.PI / 2; mat.position.set(x, 0, z); mat.userData.ground = false;
    for (const [n, dx, dz] of [['wicker_basket_01', 0, -0.6], ['plastic_crate_01', 0, 0.5], ['food_apple_01', 0.1, -0.6]] as [string, number, number][]) place(n, x + dx, n.startsWith('food') ? 0.3 : 0, z + dz, rnd() * 6);
    place('plastic_monobloc_chair_01', x + Math.sign(x) * 0.2, 0, z + 1.6, Math.sign(x) > 0 ? -Math.PI / 2 : Math.PI / 2);
    blocks.push(new THREE.Box3(new THREE.Vector3(x - 0.65, 0, z - 1.2), new THREE.Vector3(x + 0.65, 0.9, z + 2.1)));
  }
  // hanging signs at every height, sticking out over the pavement
  {
    const names = ['Sharma Tailors', 'Noor Opticals', 'Bombay Bytes', 'Lahore Lassi', 'Qmail Repairs', 'Gupta Hover Parts', 'Meera Mehndi', 'Haji Dry Fruits', 'Zaika Rolls', 'Raju Sim Cards', 'Pyaar Photos', 'Saturn Sweets'];
    const cols = ['#ffd36e', '#7fd8ff', '#ff6ec7', '#b6ff6e', '#ffffff', '#ff9f6e'];
    for (let i = 0, n = rich ? 22 : 10; i < n; i++) {
      const side = i % 2 ? 1 : -1, z = N - 6 - (i / n) * (N - S - 14) + (rnd() - 0.5) * 3, y = 3.0 + rnd() * 4.5;
      const t = canvasTex(256, 96, (g) => { const c = cols[i % cols.length]; g.fillStyle = '#1b1b24'; g.fillRect(0, 0, 256, 96); g.strokeStyle = c; g.lineWidth = 5; g.strokeRect(4, 4, 248, 88); g.fillStyle = c; g.font = '700 30px Rajdhani, sans-serif'; g.textAlign = 'center'; g.fillText(names[i % names.length], 128, 58); });
      const sg = add(new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9, side: THREE.DoubleSide })));
      sg.position.set(side * (FRONT - 0.9), y, z); sg.userData.ground = false;
      box(0.9, 0.04, 0.04, railM, side * (FRONT - 0.45), y + 0.32, z).castShadow = false;
    }
  }

  // overhead: cables sagging across the street, and bunting on every other one
  if (rich) {
    const cableM = new THREE.LineBasicMaterial({ color: 0x222222 });
    let c = 0;
    for (let z = S + 12; z < N - 6; z += 7, c++) {
      const pts: THREE.Vector3[] = []; const y0 = 6.5 + rnd() * 1.5;
      for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector3(-FRONT + t * 2 * FRONT, y0 - Math.sin(t * Math.PI) * 0.9, z)); }
      add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cableM));
      if (c % 2 === 0) {
        const flags = new THREE.InstancedMesh(new THREE.ConeGeometry(0.22, 0.45, 3), new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), 15);
        for (let i = 1; i < 16; i++) {
          const p = pts[i];
          flags.setMatrixAt(i - 1, new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y - 0.28, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0)), new THREE.Vector3(1, 1, 0.15)));
          flags.setColorAt(i - 1, new THREE.Color(pick([0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db, 0xe67e22, 0x9b59b6])));
        }
        add(flags);
      }
    }
  }

  // ---- the tram at its stop, and the shelter ----
  {
    const tram = add(new THREE.Group());
    const liv = new THREE.MeshStandardMaterial({ color: 0x0f7d74, roughness: 0.45, metalness: 0.3 }), cream = new THREE.MeshStandardMaterial({ color: 0xf4ead2, roughness: 0.5 });
    const part = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; tram.add(o); return o; };
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 10.4, 6, 16), new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.25, metalness: 0.5 })); capsule.rotation.x = Math.PI / 2; capsule.position.y = 1.9; capsule.castShadow = true; tram.add(capsule);
    void liv;
    const band = new THREE.Mesh(new THREE.CapsuleGeometry(1.32, 9.4, 4, 16), new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0xffe6c0, emissiveIntensity: 0.4, roughness: 0.1 })); band.rotation.x = Math.PI / 2; band.position.y = 2.15; band.scale.set(1, 1, 0.35); tram.add(band);
    part(new THREE.BoxGeometry(1.6, 0.08, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6ff7ff).multiplyScalar(2.5), toneMapped: false }), 0, 0.5, 0);
    part(new THREE.BoxGeometry(0.08, 2.0, 1.3), new THREE.MeshStandardMaterial({ color: 0x0f7d74, roughness: 0.4 }), -1.3, 1.6, 3);
    void cream;
    tram.position.set(-2.2, 0, -9);
    blocks.push(new THREE.Box3(new THREE.Vector3(-3.5, 0, -15.5), new THREE.Vector3(-0.9, 3.5, -2.5)));
    const shelter = add(new THREE.Group()); shelter.position.set(-6.8, FLOOR, -6);
    const roofS = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 4), cream); roofS.position.y = 2.7; roofS.castShadow = true; shelter.add(roofS);
    for (const dz of [-1.8, 1.8]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.7, 0.08), railM); p.position.set(0.6, 1.35, dz); shelter.add(p); }
    const stop = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), lit(sign('Tram 7: Spaceport', '#0f7d74', '#ffffff'), 0.4)); stop.position.set(0, 2.95, 0); stop.rotation.y = Math.PI / 2; shelter.add(stop);
  }

  // ---- the square, the fountain, the gate and the liner ----
  const fountain = add(new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.7, 32), parapetM)); fountain.position.set(0, 0.35, -44); fountain.castShadow = fountain.receiveShadow = true; solid(fountain);
  const water = add(new THREE.Mesh(new THREE.CircleGeometry(2.25, 32), new THREE.MeshStandardMaterial({ color: 0x4a9fc4, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85 })));
  water.rotation.x = -Math.PI / 2; water.position.set(0, 0.62, -44);
  const ringLight = add(new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffffff }))); ringLight.position.set(1.6, 0.66, -43.4); ringLight.rotation.x = -Math.PI / 2;
  // the boarding gateway: two pylons with light running up them, a floating ring of panels, the departures board
  const gateM = new THREE.MeshStandardMaterial({ color: 0xe8edf2, metalness: 0.4, roughness: 0.25 });
  const cyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6ff7ff).multiplyScalar(2.4), toneMapped: false });
  for (const sx of [-1, 1]) {
    solid(box(1.6, 11, 2.2, gateM, sx * 6.2, 5.5, S + 1));
    box(0.1, 10, 0.12, cyan, sx * 6.2 - sx * 0.82, 5.5, S + 1).castShadow = false;
    box(0.1, 10, 0.12, cyan, sx * 6.2 - sx * 0.82, 5.5, S + 1.8).castShadow = false;
  }
  const ring = add(new THREE.Group()); ring.position.set(0, 13.5, S + 1);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, pnl = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.3), i % 2 ? gateM : cyan); pnl.position.set(Math.cos(a) * 5, Math.sin(a) * 2.2, 0); pnl.rotation.z = a + Math.PI / 2; ring.add(pnl); }
  const board = canvasTex(1024, 256, (g) => {
    g.fillStyle = '#0a1426'; g.fillRect(0, 0, 1024, 256); g.fillStyle = '#9fd8ff'; g.font = '700 64px Rajdhani, sans-serif'; g.fillText('DEPARTURES', 40, 76);
    g.font = '500 44px Rajdhani, sans-serif';
    [['SAGITTARIUS CORRIDOR', 'GATE 7', 'BOARDING', '#7fff9a'], ['EUROPA', 'GATE 2', '19:40', '#ffffff'], ['CERES SHIPYARDS', 'GATE 4', 'DELAYED', '#ffb347']].forEach(([a, b2, c, col], i) => {
      g.fillStyle = '#ffffff'; g.fillText(a, 40, 140 + i * 48); g.fillText(b2, 640, 140 + i * 48); g.fillStyle = col; g.fillText(c, 820, 140 + i * 48);
    });
  });
  plane(10, 2.5, new THREE.MeshBasicMaterial({ map: board, color: new THREE.Color(1.4, 1.4, 1.4), toneMapped: false }), 0, 9.2, S + 1.2, 0);

  // ---- the spaceport: the apron, pads with light rings, the terminal's long canopy, the liner docked with its bridge ----
  {
    const apronM = over(new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.8 }), 1); tex('road', [apronM], [30, 24]);
    const apron = add(new THREE.Mesh(new THREE.PlaneGeometry(200, 160), apronM)); apron.rotation.x = -Math.PI / 2; apron.position.set(0, 0, S - 80); apron.receiveShadow = true; apron.userData.ground = false;
    const hull = new THREE.MeshStandardMaterial({ color: 0xf6f7fa, metalness: 0.35, roughness: 0.3 });
    const pad = (x: number, z: number, r: number) => {
      const ringP = add(new THREE.Mesh(new THREE.RingGeometry(r - 0.4, r, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6ff7ff).multiplyScalar(2), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3 })));
      ringP.rotation.x = -Math.PI / 2; ringP.position.set(x, 0.02, z);
      const disc = add(new THREE.Mesh(new THREE.CircleGeometry(r - 0.4, 64), over(new THREE.MeshStandardMaterial({ color: 0x5c6670, roughness: 0.6 }), 2))); disc.rotation.x = -Math.PI / 2; disc.position.set(x, 0.01, z);
    };
    pad(16, S - 66, 22); pad(-44, S - 90, 14); pad(44, S - 104, 14);
    // the terminal: a long glass hall under a curved canopy, warm inside, with people-sized detail at the front
    const canopy = add(new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 60, 32, 1, true, -Math.PI / 2, Math.PI), hull));
    canopy.rotation.z = Math.PI / 2; canopy.position.set(-38, 2, S - 26); canopy.castShadow = true;
    box(60, 9, 0.2, new THREE.MeshStandardMaterial({ color: 0x9fbfd6, roughness: 0.05, metalness: 0.5, emissive: 0xffd6a0, emissiveIntensity: 0.45, transparent: true, opacity: 0.85 }), -38, 4.5, S - 13);
    for (let i = 0; i < 9; i++) box(0.4, 10, 0.4, gateM, -66 + i * 7, 5, S - 12.8);
    plane(14, 2, lit(sign('TERMINAL 2 · TARAVEL', '#10233d', '#9fd8ff'), 0.9), -38, 11.5, S - 12.6, 0);
    // the liner on its pad, and the boarding bridge reaching out to it
    const liner = add(new THREE.Group()); liner.position.set(16, 9, S - 66); liner.rotation.y = 0.5;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(7.5, 52, 8, 32), hull); body.rotation.x = Math.PI / 2; body.castShadow = true; liner.add(body);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(7.58, 7.58, 52, 32, 1, true, -0.25, 0.5), cyan); stripe.rotation.x = Math.PI / 2; liner.add(stripe);
    for (const sx of [-1, 1]) { const fin = new THREE.Mesh(new THREE.BoxGeometry(12, 0.7, 14), hull); fin.position.set(sx * 11, -2.5, 16); fin.rotation.z = sx * -0.18; fin.castShadow = true; liner.add(fin); }
    for (let i = 0; i < 14; i++) { const w = new THREE.Mesh(new THREE.CircleGeometry(0.6, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe2b0).multiplyScalar(1.5), toneMapped: false })); w.position.set(-7.55, 1.5, -22 + i * 3.2); w.rotation.y = -Math.PI / 2; liner.add(w); }
    for (const [lx, lz] of [[-5, -16], [5, -16], [-5, 16], [5, 16]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 9), gateM); leg.position.set(lx, -4.5, lz); liner.add(leg); }
    const bridge = add(new THREE.Mesh(new THREE.BoxGeometry(3, 3, 26), hull)); bridge.position.set(-6, 8, S - 40); bridge.rotation.y = 0.9; bridge.castShadow = true;
    const bridgeGlow = add(new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.2, 26), cyan)); bridgeGlow.position.set(-6, 6.6, S - 40); bridgeGlow.rotation.y = 0.9;
    // light masts and a few ground vehicles
    for (const [mx, mz] of [[-20, -30], [36, -40], [-10, -110], [60, -80]]) {
      box(0.5, 18, 0.5, gateM, mx, 9, S + mz);
      const head = add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2d8).multiplyScalar(2), toneMapped: false }))); head.position.set(mx, 18, S + mz);
    }
    for (const [vx, vz, c] of [[0, -46, 0xffb347], [26, -52, 0xf4f4f6], [-14, -60, 0xffb347]] as [number, number, number][]) {
      box(2.2, 1.2, 4, new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }), vx, 0.9, S + vz);
      box(1.8, 0.06, 3.6, cyan, vx, 0.25, S + vz).castShadow = false;
    }
  }
  // ---- people ----
  const people: CityPerson[] = [];
  const person = (id: string, fig: Character, x: number, z: number, yaw: number, pose: CrewPose, walk?: CityPerson['walk']) => {
    fig.root.position.set(x, hx(x), z); fig.root.rotation.y = yaw;
    fig.setGround((px) => hx(px));
    add(fig.root);
    people.push({ id, fig, pos: fig.root.position, yaw, pose, phase: rnd() * 10, walk });
  };
  for (const f of FRIENDS) person(f.id, createCharacter(f.id, detail), f.x, f.z, f.yaw, f.pose);
  const someone = (lineage: PlayerLook['lineage'], i: number) => createCharacter('scientist', detail * 0.8, { ...defaultLook(), ...randomLook({ name: '', gender: i % 2 ? 'f' : 'm' }), lineage, ...LINEAGES[lineage] } as PlayerLook);
  FOLK.forEach((f, i) => person(f.id, someone(f.lineage, i), f.x, f.z, f.yaw, f.pose));
  // Mir: a chai stall regular in a three-piece, the same man as the suit skin and the Drexon cameo
  person('mir', createCharacter('strong', detail, undefined, 'suit'), 5.0, 15.4, Math.PI / 2 + 0.5, 'idle');
  // walkers: up and down the pavements' outer edge, clear of the stalls
  const lineages = Object.keys(LINEAGES) as PlayerLook['lineage'][];
  for (let i = 0, n = rich ? 16 : 5; i < n; i++) {
    const sd = i % 2 ? 1 : -1, x = sd * (4.9 + rnd() * 0.5), za = S + 12 + rnd() * 30, zb = Math.min(za + 40 + rnd() * 50, N - 12);
    person(`walker${i}`, someone(lineages[i % lineages.length], i + 3), x, za + rnd() * (zb - za), 0, 'idle', { z0: za, z1: zb, dir: rnd() < 0.5 ? 1 : -1, speed: 1.1 + rnd() * 0.5 });
  }

  const future = buildFuture(scene, { rich, N, S, FRONT, FLOOR, shops: SHOPS });
  blocks.push(...future.solids);
  scene.traverse((o) => { if (o !== ground && o.userData.ground === undefined) o.userData.ground = false; });
  // people stood in threes, talking, on the pavements
  const groups: [number, number][] = rich ? [[6.6, 34], [-6.4, 12], [6.4, -8], [-6.6, -36], [6.2, -58]] : [[6.6, 34], [-6.6, -36]];
  const talk: CrewPose[] = ['argue', 'idle', 'present', 'cheer', 'point', 'facepalm'];
  groups.forEach(([x, z], gi) => { for (let j = 0; j < 3; j++) {
    const a = (j / 3) * Math.PI * 2 + gi, px = x + Math.cos(a) * 0.75, pz = z + Math.sin(a) * 0.75;
    person(`group${gi}_${j}`, someone(lineages[(gi + j) % lineages.length], gi * 3 + j + 30), px, pz, Math.atan2(x - px, z - pz), talk[(gi + j) % talk.length]);
  } });

  const tasks: AwayTask[] = TASKS.map((x) => ({ id: x.id, pos: new THREE.Vector3(x.x, hx(x.x), x.z), radius: x.r ?? 1.8, label: label(`city.task.${x.id}`), need: x.need }));
  // townsfolk and friends answer whenever you like; they never count towards leaving
  for (const p of people) if (!p.walk && !p.id.startsWith('group')) tasks.push({ id: `talk.${p.id}`, pos: p.pos, radius: 1.6, label: label('city.talk'), optional: true, repeat: true });

  /** How far the camera may go from the player before a wall: 1 is all the way. */
  const clearance = (fx: number, fz: number, cx: number, cz: number) => {
    let best = 1;
    const dx = cx - fx, dz = cz - fz;
    for (const b of blocks) {
      if (b.max.y < 1.5) continue;
      let t0 = 0, t1 = 1;
      for (const [o, d, lo, hi] of [[fx, dx, b.min.x - 0.25, b.max.x + 0.25], [fz, dz, b.min.z - 0.25, b.max.z + 0.25]] as [number, number, number, number][]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = 2; break; } continue; }
        let a = (lo - o) / d, c = (hi - o) / d; if (a > c) [a, c] = [c, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      }
      if (t0 <= t1 && t0 > 0.02 && t0 < best) best = t0;
    }
    return best;
  };

  return {
    scene, gravity: 22, jump: 6.2, spawn: new THREE.Vector3(12.4, FLOOR, 68.4), tasks, people, clearance,
    height: (x) => hx(x),
    collide(p, r) {
      for (const b of blocks) {
        if (p.y > b.max.y || p.y + 1.8 < b.min.y) continue;
        const cx = Math.max(b.min.x, Math.min(p.x, b.max.x)), cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
        const dx = p.x - cx, dz = p.z - cz, dd = Math.hypot(dx, dz);
        if (dd < r) {
          if (dd > 1e-6) { p.x = cx + dx / dd * r; p.z = cz + dz / dd * r; }
          else {
            const o = [p.x - b.min.x, b.max.x - p.x, p.z - b.min.z, b.max.z - p.z], m = Math.min(...o);
            if (m === o[0]) p.x = b.min.x - r; else if (m === o[1]) p.x = b.max.x + r; else if (m === o[2]) p.z = b.min.z - r; else p.z = b.max.z + r;
          }
        }
      }
      for (const q of people) { const dx = p.x - q.pos.x, dz = p.z - q.pos.z, dd = Math.hypot(dx, dz); if (dd < r + 0.3 && dd > 1e-6) { p.x = q.pos.x + dx / dd * (r + 0.3); p.z = q.pos.z + dz / dd * (r + 0.3); } }
    },
    bind() { /* the city asks nothing of the body: no lineage tricks on the last normal day */ },
    update(dt, time) {
      for (const q of people) {
        const w = q.walk;
        if (w) {
          q.pos.z += w.dir * w.speed * dt;
          if (q.pos.z > w.z1) w.dir = -1; else if (q.pos.z < w.z0) w.dir = 1;
          const want = w.dir > 0 ? 0 : Math.PI; q.yaw += Math.atan2(Math.sin(want - q.yaw), Math.cos(want - q.yaw)) * (1 - Math.exp(-dt * 5));
          q.pos.y = hx(q.pos.x); q.fig.root.rotation.y = q.yaw; q.phase += dt * w.speed * 2.2;
          q.fig.animate('walk', q.phase, Math.min(1.1, w.speed / 3), time, dt);
        } else { q.phase += dt; q.fig.animate(q.pose, q.phase, 0, time, dt); }
      }
      ringLight.rotation.z += dt;
      future.update(dt, time);
    },
    dispose() { scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); },
  };
}
