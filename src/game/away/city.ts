import * as THREE from 'three';
import { fitCanvasText } from '../../core/canvastext';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createCharacter, Character, CrewId, CrewPose, CHAR_BUDGET } from '../../characters/character';
import { LINEAGES, townLook, PlayerLook, defaultLook } from '../../characters/custom';
import { loadTexture } from '../../core/assets';
import type { AwayStage, AwayTask } from './stage';
import type { StageBody } from './kit';
import { buildFuture } from './cityfuture';
import { buildMega } from './citymega';
import { buildDense, Facade } from './citydense';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeChildren, passMaps, watchChanges, atlasCanvases } from '../../core/merge';
import { BATCH, batchStatic } from '../../core/ibatch';
import { buildDistricts, inOld, BOUNDS as DIST_BOUNDS } from './districts';
import { navGrid } from './navgrid';
import { impostorBaker } from './impostor';
import { FACADE } from './facade';
import { cityProbe } from './probe';
import { carKit } from './cars';
import { dayCycle, skyMaterial, wetify } from './daycycle';
import { Renderer } from '../../core/renderer';

/**
 * Zenvora, Taravel, 2189: the last normal afternoon. One long bazaar street from the flat (north-east corner)
 * to the spaceport gate (south). The player's list runs down it, and each step teaches one control.
 *
 * Ground is exact by construction: height changes only across the street (road, kerb ramp, pavement and everything
 * behind it), and the ground mesh has a vertex column at every breakpoint, so the drawn surface is the walkable one.
 * Assets: CC0 from Poly Haven (tools/fetch_city.py, credited in CREDITS.md).
 */

const N = 78, S = -78; // street ends (z)
const FRONT = 9.5; // building line, both sides
/** The friends' flat, from the street wall back: room enough for the follow camera (it was 6.5 m). */
const FLAT_D = 11.5; // the flat runs almost the block's whole depth: a hall, a living room, a kitchen, a bedroom and a bathroom
const FLAT_Z0 = 61.4, FLAT_Z1 = 76.6;
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
/** Phones: townsfolk past this many metres from the camera are not drawn. */
const PHONE_CROWD_FAR = 34;
/** Other presets: townsfolk past this many metres are drawn as cards (citydense.ts stand-ins). */
const CROWD_FAR = 34; // beyond the 30 m everyone must stay drawn within (tools/crowd_smoke.py), from a camera a few metres behind you
/** Phones: props smaller than SMALL_PROP metres across (as a radius) are not drawn past SMALL_FAR metres. */
const SMALL_PROP = 0.45, SMALL_FAR = 24;
/** Props further than this from the camera (to their stretch of street) are drawn with their light build. */
const PROP_NEAR = 14;
const SHADOW_FAR0 = CHAR_BUDGET.shadowFar;

export interface CityPerson { id: string; fig: Character; pos: THREE.Vector3; yaw: number; pose: CrewPose; phase: number; walk?: { z0: number; z1: number; dir: number; speed: number; home?: number; shop?: { x: number; z: number; t: number; stage: 'in' | 'inside' | 'out' }; nextShop?: number }; met?: boolean; greet?: number }

// ---------- small makers ----------
let seed = 1234567;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  fitCanvasText(c.getContext('2d')!, draw);
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
/** What you see through a shop window: a room, not a poster. A back wall in shadow, shelves of small goods under their own strip lights, hanging lamps, a counter, the floor running out to the glass. */
const shelves = (hue: number) => canvasTex(512, 256, (g) => {
  let sd = 9000 + hue * 31; const rnd = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; }; // its own dice: the city's stay as they were
  const wall = g.createLinearGradient(0, 0, 0, 256); wall.addColorStop(0, `hsl(${hue},22%,14%)`); wall.addColorStop(1, `hsl(${hue},18%,8%)`);
  g.fillStyle = wall; g.fillRect(0, 0, 512, 256);
  // the side walls and the floor, drawn in to a vanishing point: depth
  g.fillStyle = `hsl(${hue},16%,11%)`; g.beginPath(); g.moveTo(0, 0); g.lineTo(70, 26); g.lineTo(70, 196); g.lineTo(0, 256); g.fill();
  g.beginPath(); g.moveTo(512, 0); g.lineTo(442, 26); g.lineTo(442, 196); g.lineTo(512, 256); g.fill();
  const fl = g.createLinearGradient(0, 196, 0, 256); fl.addColorStop(0, 'rgb(46,38,32)'); fl.addColorStop(1, 'rgb(92,78,64)');
  g.fillStyle = fl; g.beginPath(); g.moveTo(70, 196); g.lineTo(442, 196); g.lineTo(512, 256); g.lineTo(0, 256); g.fill();
  for (let r = 0; r < 3; r++) {
    const y = 58 + r * 44;
    // a strip light under each shelf, and what it lights
    const lg = g.createLinearGradient(0, y - 34, 0, y + 4); lg.addColorStop(0, 'rgba(255,226,180,.34)'); lg.addColorStop(1, 'rgba(255,226,180,0)');
    g.fillStyle = lg; g.fillRect(78, y - 34, 356, 38);
    for (let x = 82; x < 428; ) {
      const w = 5 + rnd() * 11, h = 12 + rnd() * 18;
      g.fillStyle = `hsl(${(hue + rnd() * 90 - 20 + 360) % 360},${28 + rnd() * 30}%,${30 + rnd() * 26}%)`; g.fillRect(x, y - h, w - 1.5, h);
      g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(x, y - h, 1.2, h);
      x += w + (rnd() < 0.12 ? 8 : 0);
    }
    g.fillStyle = 'rgb(58,42,30)'; g.fillRect(74, y, 364, 5); g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(74, y + 5, 364, 6);
  }
  // the counter, a till, someone's stool
  g.fillStyle = 'rgb(74,52,36)'; g.fillRect(110, 190, 250, 34); g.fillStyle = 'rgb(104,76,52)'; g.fillRect(104, 184, 262, 8);
  g.fillStyle = 'rgb(28,30,36)'; g.fillRect(300, 164, 36, 20); g.fillStyle = `hsl(${(hue + 180) % 360},60%,62%)`; g.fillRect(304, 168, 28, 9);
  // two hanging lamps and their glow
  for (const lx of [176, 336]) {
    g.strokeStyle = 'rgb(20,20,22)'; g.lineWidth = 2; g.beginPath(); g.moveTo(lx, 0); g.lineTo(lx, 30); g.stroke();
    const gl = g.createRadialGradient(lx, 36, 2, lx, 36, 120); gl.addColorStop(0, 'rgba(255,224,170,.85)'); gl.addColorStop(0.12, 'rgba(255,214,150,.35)'); gl.addColorStop(1, 'rgba(255,214,150,0)');
    g.fillStyle = gl; g.fillRect(lx - 130, 0, 260, 200);
    g.fillStyle = 'rgb(255,240,214)'; g.beginPath(); g.ellipse(lx, 36, 9, 6, 0, 0, 7); g.fill();
  }
  const vg = g.createRadialGradient(256, 120, 120, 256, 120, 330); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = vg; g.fillRect(0, 0, 512, 256);
});
const stripes = (a: string, b: string) => { const t = canvasTex(256, 64, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * 32, 0, 32, 64); } }); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
/** A box whose uvs are in metres / tile, so a texture keeps one scale on every wall. */
function boxGeo(w: number, h: number, d: number, tile = 3) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / tile, uv.getY(k) * dims[f][1] / tile); }
  return g;
}

/**
 * Canvases of one width stacked into one texture, so the signs, shop windows and awnings that used them are one
 * material (and merge per stretch of street) instead of one each. `tile` points a geometry's uvs at one of them;
 * `flat` puts v at the tile's middle, for patterns that only change across (the stripes).
 */
function stack(cs: HTMLCanvasElement[]) {
  const w = cs[0].width, H = cs.reduce((a, c) => a + c.height, 0);
  const t = canvasTex(w, H, (g) => { let y = 0; for (const c of cs) { g.drawImage(c, 0, y); y += c.height; } });
  const rows: [number, number][] = []; let y = 0;
  // the canvas is flipped on upload: its first rows are the top of the texture
  for (const c of cs) { rows.push([1 - (y + c.height) / H, 1 - y / H]); y += c.height; }
  const tile = <G extends THREE.BufferGeometry>(g: G, i: number, flat = false) => {
    const uv = g.attributes.uv as THREE.BufferAttribute, [v0, v1] = rows[i], us = cs[i].width / w;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * us, flat ? (v0 + v1) / 2 : v0 + uv.getY(k) * (v1 - v0));
    return g;
  };
  return { t, tile };
}
const canvasOf = (t: THREE.Texture) => t.image as HTMLCanvasElement;

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
  { id: 'medic', x: 7.4, z: -14, yaw: -Math.PI / 2, pose: 'idle' },
  { id: 'explorer', x: 6.2, z: 17.4, yaw: -Math.PI / 2, pose: 'write' },
  { id: 'builder', x: -5.0, z: -8.6, yaw: Math.PI / 2, pose: 'idle' },
  { id: 'social', x: -5.4, z: -40.5, yaw: 0.3, pose: 'selfie' }, // on the pavement: the road is for the cars
];

/** Townsfolk standing: where, and the one line each gives you (`city.npc.*`). */
const FOLK: { id: string; x: number; z: number; yaw: number; pose: CrewPose; lineage: PlayerLook['lineage'] }[] = [
  { id: 'chaiwala', x: 8.4, z: 11.6, yaw: -Math.PI / 2, pose: 'idle', lineage: 'ortek' },
  { id: 'aunty', x: -7.6, z: -28, yaw: Math.PI / 2, pose: 'idle', lineage: 'sirelle' },
  { id: 'clerk', x: 8.9, z: 46.2, yaw: -Math.PI / 2, pose: 'idle', lineage: 'vael' },
  { id: 'driver', x: 3, z: 22, yaw: 0, pose: 'idle', lineage: 'korrath' },
  { id: 'kid1', x: -1, z: -60, yaw: 0.4, pose: 'idle', lineage: 'tarnkin' },
  { id: 'kid2', x: 2, z: -63, yaw: -2.6, pose: 'idle', lineage: 'ulari' },
  { id: 'queue1', x: -6.6, z: 4.2, yaw: Math.PI / 2, pose: 'idle', lineage: 'tarnkin' },
  { id: 'queue2', x: -6.6, z: 5.9, yaw: Math.PI / 2, pose: 'idle', lineage: 'vael' },
  { id: 'pharma', x: 8.9, z: -17.2, yaw: -Math.PI / 2, pose: 'idle', lineage: 'ulari' },
  { id: 'tourist', x: 5.5, z: -36, yaw: 2.2, pose: 'selfie', lineage: 'sirelle' },
];

const TMP_C = new THREE.Color();
/** `?probe=1`: the reflection probe (probe.ts). Off by default: on the GPU its first rounds white the picture out, and until that is found the sky alone lights the city. */
const NOPROBE = typeof location === 'undefined' || !new URLSearchParams(location.search).has('probe');
const CELL = 26, UP = new THREE.Vector3(0, 1, 0), TMP_M = new THREE.Matrix4(), TMP_V = new THREE.Vector3();
/** A stretch of street on one side: small enough that what is off screen is still culled. */
const cellOf = (x: number, z: number, size = CELL) => `${Math.floor(z / size)}:${x < -4 ? -1 : x > 4 ? 1 : 0}`;

/** Is this part of someone's body (their kit, their name tag)? */
const inBody = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.isCharacter) return true; return false; };

/**
 * The street is built from hundreds of separate boxes, planes, signs and lights, a draw call each (and another in the
 * shadow pass). Whatever never moves, hides or changes colour (tried by running the city's own animations a few times
 * first: `watchChanges`) is merged per material and shadow flags: on the street itself one mesh per stretch of street
 * and side (12 m, 39 m on phones, where draw calls cost far more than drawing a little off screen), and inside the
 * groups (ships, platforms, holograms) one per group. Materials that look the same are shared first. `keep` is what
 * changes later for other reasons (tasks, the city's own update).
 */
function mergeStatic(scene: THREE.Scene, keep: Set<THREE.Object3D>, cellM: number, animate: (t: number) => void, phone = false) {
  const watch = watchChanges(scene);
  for (const t of [1.3, 4.7, 9.1, 23.5]) animate(t);
  const { moved, recoloured } = watch.changed();
  // every little canvas (shop shelves, signs, posters, banners) on to shared atlases, so their meshes can merge too
  atlasCanvases(scene, (o, m) => !moved.has(o) && !keep.has(o) && !o.userData.keep && !o.name && !recoloured.has(m) && !inBody(o), 4096, phone);
  // groups that never move (a terminal's parts, a shelter, a platform) give their meshes to the old town itself, where
  // they merge with everything else of their material instead of being a draw or three per group
  const still = (o: THREE.Object3D): boolean => !moved.has(o) && !keep.has(o) && !o.userData.keep && !o.userData.isCharacter && !(o as THREE.Light).isLight && o.children.every(still);
  const INV = new THREE.Matrix4(), REL = new THREE.Matrix4();
  for (const root of scene.children.filter((c) => c.userData.cells)) {
    root.updateMatrixWorld(true); INV.copy(root.matrixWorld).invert();
    for (const g of [...root.children]) {
      if (g.type !== 'Group' || !still(g)) continue;
      const list: THREE.Object3D[] = [];
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) list.push(o); });
      for (const o of list) { REL.multiplyMatrices(INV, o.matrixWorld); root.add(o); REL.decompose(o.position, o.quaternion, o.scale); o.updateMatrix(); }
      root.remove(g);
    }
  }
  // phones: nothing splits a merge but the material. The shadow is static there (drawn once in a while), so everything
  // solid may cast it; and one stretch holds the whole street
  const classes = new Map<string, THREE.MeshBasicMaterial>();
  if (phone) scene.traverse((o) => {
    const m = o as THREE.Mesh, mat = m.material as THREE.Material | undefined;
    if (!m.isMesh || !mat || Array.isArray(mat) || (m as THREE.InstancedMesh).isInstancedMesh || moved.has(o) || keep.has(o) || o.userData.keep || o.name || inBody(o) || o.userData.ground === true) return;
    m.castShadow = !mat.transparent && mat.type === 'MeshStandardMaterial'; m.receiveShadow = true; m.userData = { ground: false };
    // plain unlit colours (glows, lines, panels of light) and plain glass: whatever their colour and opacity, one
    // material per way of blending, the colour and the opacity per vertex. They were sixty materials, a draw each.
    const b = mat as THREE.MeshBasicMaterial;
    const plain = (mat.type === 'MeshBasicMaterial' || (mat.type === 'MeshStandardMaterial' && mat.transparent)) && !b.map && !b.alphaMap && !recoloured.has(mat)
      && mat.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && !m.geometry.attributes.color && !b.vertexColors && !Object.keys(m.geometry.morphAttributes).length;
    if (!plain) return;
    const key = [mat.blending, mat.transparent, mat.depthWrite, mat.side, mat.polygonOffset ? mat.polygonOffsetFactor : 0, mat.toneMapped, b.fog].join('|');
    let cls = classes.get(key);
    if (!cls) {
      cls = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: mat.transparent, blending: mat.blending, depthWrite: mat.depthWrite, side: mat.side, toneMapped: mat.toneMapped, fog: b.fog,
        polygonOffset: mat.polygonOffset, polygonOffsetFactor: mat.polygonOffsetFactor, polygonOffsetUnits: mat.polygonOffsetUnits });
      classes.set(key, cls);
    }
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count, col = new Float32Array(n * 4), c = b.color, a = mat.transparent ? mat.opacity : 1;
    for (let i = 0; i < n; i++) { col[i * 4] = c.r; col[i * 4 + 1] = c.g; col[i * 4 + 2] = c.b; col[i * 4 + 3] = a; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    m.geometry = g; m.material = cls; m.castShadow = false;
  });
  const side = (x: number) => (phone ? 0 : x < -4 ? -1 : x > 4 ? 1 : 0);
  const shared = (m: THREE.Material) => !recoloured.has(m);
  const visit = (o: THREE.Object3D) => {
    if ((o as THREE.Bone).isBone || o.userData.isCharacter) return;
    for (const c of [...o.children]) {
      if (moved.has(c) || keep.has(c)) c.userData.keep = true;
      visit(c);
    }
    mergeChildren(o, { shared, tint: true, pbr: true, anyBlend: phone, cell: o === scene || o.userData.cells ? (c) => (phone ? '' : `${Math.floor(c.z / cellM)}:${side(c.x)}`) : undefined });
  };
  visit(scene);
  for (const c of keep) delete c.userData.keep;
  for (const c of moved) delete c.userData.keep;
  // what never moves keeps its local matrix: three.js then skips recomposing it every frame (a tenth of a phone's
  // frame went to matrices). A moving parent still carries them along.
  const freeze = (o: THREE.Object3D) => {
    if ((o as THREE.Bone).isBone || o.userData.isCharacter) return;
    if (!moved.has(o) && !keep.has(o)) { o.updateMatrix(); o.matrixAutoUpdate = false; }
    for (const c of o.children) freeze(c);
  };
  for (const c of scene.children) freeze(c);
  return moved;
}

/**
 * Makes a container refresh only the children that can move (anything not frozen by mergeStatic, and every body);
 * the rest keep the world matrix they were given. The list is rebuilt whenever a child is added or removed, after one
 * full pass. A hidden container refreshes nothing.
 */
function skipStatic(g: THREE.Object3D) {
  const base = THREE.Object3D.prototype.updateMatrixWorld;
  const live = (o: THREE.Object3D): boolean => o.matrixAutoUpdate || !!o.userData.isCharacter || o.children.some(live);
  let n = -1, dyn: THREE.Object3D[] = [];
  g.updateMatrixWorld = function (force?: boolean) {
    if (!g.visible) return;
    if (n !== g.children.length) { base.call(g, true); n = g.children.length; dyn = g.children.filter(live); return; }
    for (const c of dyn) c.updateMatrixWorld(force);
  };
}

/**
 * From inside the flat the street is only seen through its door and its window. While the camera is in there, whatever
 * outside neither opening shows is taken off the camera's layer (it still casts its shadow: the sun's shadow camera
 * sees layer 1 too). The view out of the flat drew most of the street through the walls.
 */
function flatPortals(scene: THREE.Scene, room: THREE.Box3, x: number, openings: [number, number, number, number][], skip: (o: THREE.Object3D) => boolean, count: () => number = () => scene.children.length) {
  let cands: { o: THREE.Object3D; box: THREE.Box3 }[] = [], seenN = -1, hidden = false;
  const collect = () => {
    cands = [];
    const visit = (o: THREE.Object3D) => {
      if (skip(o)) return;
      const m = o as THREE.Mesh;
      if ((m.isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Line).isLine || (o as THREE.Points).isPoints) && m.geometry) {
        const box = new THREE.Box3().setFromObject(o, false);
        if (!box.isEmpty() && !room.intersectsBox(box)) cands.push({ o, box }); // the flat's own walls and floor always draw
      }
      for (const c of o.children) visit(c);
    };
    visit(scene); seenN = count();
  };
  const planes = [0, 1, 2, 3, 4].map(() => new THREE.Plane()), P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const inside = (b: THREE.Box3) => planes.every((p) => p.distanceToPoint(new THREE.Vector3(p.normal.x > 0 ? b.max.x : b.min.x, p.normal.y > 0 ? b.max.y : b.min.y, p.normal.z > 0 ? b.max.z : b.min.z)) >= 0);
  return (cam: THREE.Camera) => {
    const c = cam.position;
    if (!room.containsPoint(c)) { if (hidden) { for (const k of cands) k.o.layers.set(0); hidden = false; } return; }
    if (seenN !== count()) { if (hidden) for (const k of cands) k.o.layers.set(0); collect(); }
    const show = new Set<THREE.Object3D>();
    for (const [z0, z1, y0, y1] of openings) {
      P[0].set(x, y0, z0); P[1].set(x, y1, z0); P[2].set(x, y1, z1); P[3].set(x, y0, z1);
      for (let i = 0; i < 4; i++) planes[i].setFromCoplanarPoints(c, P[i], P[(i + 1) % 4]);
      planes[4].setFromCoplanarPoints(P[0], P[1], P[2]);
      // a point out in the street on the line through the opening's middle is inside all five: face them towards it
      const Q = new THREE.Vector3(x, (y0 + y1) / 2, (z0 + z1) / 2).multiplyScalar(2).sub(c);
      for (const p of planes) if (p.distanceToPoint(Q) < 0) p.negate();
      for (const k of cands) if (!show.has(k.o) && inside(k.box)) show.add(k.o);
    }
    for (const k of cands) k.o.layers.set(show.has(k.o) ? 0 : 1);
    hidden = true;
  };
}

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

export function buildCity(label: (k: string) => string, detail = 1): AwayStage & { bind(b: StageBody): void; people: CityPerson[]; mapLayer: import('../../ui/minimap').MapLayer; drawnAs(id: string): string; readonly perfState: Record<string, unknown>; crowdState(): { near: number; bodies: number; lost: number; room?: number }; trafficState(): unknown } {
  seed = 1234567; // the same city every time
  const rich = detail >= 1; // phones get fewer props, people and lights
  const scene = new THREE.Scene();
  const HAZE = new THREE.Color(0x4a4468);
  scene.fog = new THREE.Fog(HAZE, 45, 300); // blue-hour haze: the far city fades to violet
  const blocks: THREE.Box3[] = [];
  // what the preset can afford: 0 phones, 1 Web, 2 Ultra and Cinematic
  const qn = Renderer.current?.quality.name ?? (rich ? 'ultra' : 'mobile');
  const tier = !rich ? 0 : qn === 'web' ? 1 : 2;
  // the old town (the bazaar, its side streets, the gate and the spaceport) is one group: it is not drawn, moved or
  // animated when the camera is out in the districts with a block of buildings between
  const oldTown = new THREE.Group(); oldTown.userData.cells = true; scene.add(oldTown);
  const add = <T extends THREE.Object3D>(o: T) => { oldTown.add(o); return o; };
  /** For what is seen from everywhere: the sky, the lights, the districts. */
  const top = <T extends THREE.Object3D>(o: T) => { scene.add(o); return o; };
  const solid = (m: THREE.Object3D) => { m.updateMatrixWorld(true); blocks.push(new THREE.Box3().setFromObject(m)); return m; };
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, tile = 3) => {
    const o = new THREE.Mesh(boxGeo(w, h, d, tile), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return add(o);
  };
  // props are drawn as instances, one draw per model part per stretch of street: as separate clones the
  // shutters, chairs, crates and lamps cost a draw call each per pass (thousands a frame on a phone)
  const placed = new Map<string, { name: string; at: THREE.Matrix4[] }>();
  // phones: fruit, tea sets, baskets and the like are not drawn from further than SMALL_FAR (a few pixels each)
  const propCells: { c: THREE.Vector3; r: number; near: THREE.InstancedMesh[]; far: THREE.Mesh | null; farSmall: THREE.Mesh | null; always: THREE.InstancedMesh[]; lod: number; old: boolean }[] = [];
  let propTick = 0;
  const place = (name: string, x: number, y: number, z: number, yaw: number, scale = 1) => {
    const key = tier === 0 ? `${name}|${Math.floor(z / 78)}` : `${name}|${cellOf(x, z, CELL)}`; // phones: longer stretches, both sides of the street as one
    const e = placed.get(key) ?? placed.set(key, { name, at: [] }).get(key)!;
    e.at.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(scale, scale, scale)));
  };

  // ---- sky: warm horizon to deep blue, the sun, and Taravel's ringed neighbour ----
  // the sky follows the camera (a city 650 m across), and its time of day is daycycle.ts's
  const skyMat = skyMaterial();
  const skyMesh = top(new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), skyMat));
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyMat); // the same sky, small enough for the light probe's camera
  // the renderer turns this sky into image-based light: shade reads as sky-lit, not black
  scene.userData.direct = tier === 0; scene.userData.skyForEnv = envSky; scene.userData.envIntensity = 1.2; scene.userData.ao = rich;
  const planet = top(new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, depthWrite: false, transparent: true, opacity: 0.85, map: canvasTex(512, 512, (g) => {
    g.translate(256, 256); g.rotate(-0.35);
    g.strokeStyle = 'rgba(240,220,200,.45)'; g.lineWidth = 10; g.beginPath(); g.ellipse(0, 0, 230, 60, 0, Math.PI, 2 * Math.PI); g.stroke();
    const b = g.createRadialGradient(-30, -30, 10, 0, 0, 120); b.addColorStop(0, '#f6e8d6'); b.addColorStop(1, '#b7a2c6');
    g.fillStyle = b; g.beginPath(); g.arc(0, 0, 118, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(240,220,200,.6)'; g.beginPath(); g.ellipse(0, 0, 230, 60, 0, 0, Math.PI); g.stroke();
  }) })));
  planet.position.set(120, 150, -260); planet.scale.setScalar(150);

  // late afternoon: a low warm sun down the street, cool sky fill
  const hemi = top(new THREE.HemisphereLight(0x8a96d8, 0xb07a58, 1.35)); // the city's own glow: violet sky above, warm street light bouncing below // bounce off warm paving
  const sun = new THREE.DirectionalLight(0xff9a70, 1.4); // the last of the sun, a rim from the spaceport end: the city is the light now
  sun.position.set(-30, 30, -70); sun.castShadow = true;
  sun.shadow.mapSize.set(rich ? 2048 : 1024, rich ? 2048 : 1024); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  const SHADOW_R = rich ? 46 : 28, SUN_OFF = new THREE.Vector3(-30, 30, -70), SHV = new THREE.Vector3(), SHC = new THREE.Vector3();
  Object.assign(sun.shadow.camera, { left: -SHADOW_R, right: SHADOW_R, top: SHADOW_R, bottom: -SHADOW_R, near: 1, far: 240 });
  sun.shadow.camera.updateProjectionMatrix();
  top(sun); top(sun.target);
  const stand: import('./citydense').StandIn[] = [];
  // nobody stands in the lens: a body (or card) within arm's reach of the camera, or on the line from the camera to
  // you, is not drawn until it has moved on
  const lens = { cx: 0, cz: 0, px: 0, pz: 0, on: false };
  const inLens = (x: number, z: number) => {
    if (!lens.on) return false;
    const ax = x - lens.cx, az = z - lens.cz, d2 = ax * ax + az * az;
    if (d2 < 1.7 * 1.7) return true;
    const bx = lens.px - lens.cx, bz = lens.pz - lens.cz, L2 = bx * bx + bz * bz;
    if (L2 < 0.5) return false;
    const t = (ax * bx + az * bz) / L2;
    if (t <= 0 || t > 0.72) return false;
    const ex = ax - bx * t, ez = az - bz * t;
    return ex * ex + ez * ez < 0.5 * 0.5;
  };
  const BLOBS = 80, BM = new THREE.Matrix4();
  const blobs = new THREE.InstancedMesh((() => { const g = new THREE.PlaneGeometry(1.1, 1.1); g.rotateX(-Math.PI / 2); return g; })(), new THREE.MeshBasicMaterial({
    map: canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 31); r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(0.6, 'rgba(0,0,0,.25)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }),
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }), BLOBS);
  blobs.count = 0; blobs.frustumCulled = false; blobs.userData.ground = false; blobs.renderOrder = 1; blobs.matrixAutoUpdate = false; top(blobs);
  // on phones the shadow map (the whole street) is redrawn every third frame: the sun never moves, only people do
  sun.shadow.autoUpdate = tier === 2;
  let shadowFrame = 0, shadowStale = true, bodiesLeft = 0, cardsNear = 0;
  /** Real bodies drawn at once, the player aside. */
  const BODY_CAP = [2, 5, 12][tier], OLD_FAR = [50, 80, 130][tier];
  const candK = new Float64Array(256), candI = new Int32Array(256);
  if (tier === 0) CHAR_BUDGET.shadowFar = 0; // phones: no body casts a shadow in the city (contact shadows instead)
  else if (tier === 1) CHAR_BUDGET.shadowFar = 10; // Web: only the bodies close by cast one

  // ---- textures: Poly Haven sets, one tile in metres ----
  // what is still loading: the renderer waits for it before it compiles the city's shaders (Renderer.precompile)
  const loads: Promise<unknown>[] = []; scene.userData.loads = loads;
  const tex = (set: string, mats: THREE.MeshStandardMaterial[], rep: [number, number] = [1, 1], size: '1k' | '512' = rich ? '1k' : '512') => {
    for (const m of mats) m.userData.late = `${set}|${rep}|${size}`; // its maps arrive later: shared only with the same set (mergeStatic)
    loads.push(Promise.all([loadTexture(`city/${set}`, 'diff', size), loadTexture(`city/${set}`, 'nor', size)]).then(([a, n]) => {
      for (const m of mats) {
        const a2 = a.clone(), n2 = n.clone(); a2.repeat.set(...rep); n2.repeat.set(...rep); a2.needsUpdate = n2.needsUpdate = true;
        m.map = a2; m.normalMap = n2; m.needsUpdate = true; passMaps(m);
      }
    }).catch(() => undefined));
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
  const paving = wetify(new THREE.MeshStandardMaterial({ color: 0xe0d2c0, roughness: 0.9 }), 0.6); tex('pavement', [paving]);
  const ground = add(new THREE.Mesh(strip(xs, 2.5), paving)); ground.receiveShadow = true; ground.userData.ground = true;
  // the road and the kerbs: the same vertices, drawn over in depth instead of lifted, never something to stand on
  const over = (m: THREE.MeshStandardMaterial, k = 2) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -k });
  const roadM = wetify(over(new THREE.MeshStandardMaterial({ color: 0x7c7779, roughness: 0.74, metalness: 0 }))); tex('road', [roadM], [1, 1]);
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
  const litM = new THREE.MeshStandardMaterial({ color: 0x2a1c10, emissive: 0xffc37a, emissiveIntensity: 1.8, roughness: 0.3 });
  const frameM = new THREE.MeshStandardMaterial({ color: 0xece4d6, roughness: 0.7 });
  const tankM = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 });
  const railM = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.5, metalness: 0.6 });
  const ledMats = [0x6ff7ff, 0xff6ec7, 0xffc36b].map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2), toneMapped: false }));
  const podM = new THREE.MeshStandardMaterial({ color: 0x9fc0d6, roughness: 0.08, metalness: 0.5, emissive: 0xffd9a8, emissiveIntensity: 0.35 });
  const awnings: THREE.Texture[] = [stripes('#c0392b', '#f4e6d0'), stripes('#16a085', '#f0f0e0'), stripes('#f39c12', '#fff6e0'), stripes('#2c3e94', '#f2efe6'), stripes('#8e44ad', '#fbe9ff')];
  // the stripes only change across, so the five share one texture, each awning reading one row of it
  const stripeSet = stack(awnings.map(canvasOf));
  const awningM = new THREE.MeshStandardMaterial({ map: stripeSet.t, side: THREE.DoubleSide, roughness: 0.9 });
  const lit = (map: THREE.Texture, k = 0.6) => new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: k, roughness: 0.5 });
  const plane = (w: number, h: number, m: THREE.Material, x: number, y: number, z: number, yaw: number) => { const p = add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), m)); p.position.set(x, y, z); p.rotation.y = yaw; return p; };

  // ---- pools of light on the paving: under the lamps and in front of every lit shop ----
  const poolTex = canvasTex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 4, 64, 64, 62); r.addColorStop(0, 'rgba(255,200,130,.9)'); r.addColorStop(1, 'rgba(255,200,130,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
  const poolM = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  const pool = (x: number, z: number, r: number) => { const m = add(new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), poolM)); m.rotation.x = -Math.PI / 2; m.position.set(x, hx(x) + 0.01, z); m.userData.ground = false; };
  // shared looks for the small shops: six lit interiors, a dozen names (desi trades in three scripts)
  const fronts = stack([20, 45, 160, 210, 300, 340].map((h) => canvasOf(shelves(h)))), frontM = lit(fronts.t, 1.1);
  const shopSignsC = ['Sharma Nano-Tailors', 'Noor Holo-Opticals', 'Nebula Bytes', 'Lunar Lassi', 'Gupta Hover Parts', 'Haji Orbital Dry Fruits', 'Zaika Zero-G Rolls', 'Raju Neural SIMs', 'शर्मा स्पेस स्वीट्स', 'नूर होलो-मोबाइल', 'حاجی مداری میوے', 'زائقہ زیرو جی رولز']
    .map((n, i) => canvasOf(canvasTex(512, 96, (g) => { const c = ['#ffd36e', '#7fd8ff', '#ff6ec7', '#b6ff6e', '#ffffff', '#ff9f6e'][i % 6]; g.fillStyle = '#16121e'; g.fillRect(0, 0, 512, 96); g.strokeStyle = c; g.lineWidth = 5; g.strokeRect(4, 4, 504, 88); g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 12; g.font = '700 46px Rajdhani, "Noto Sans Devanagari", "Noto Nastaliq Urdu", sans-serif'; g.textAlign = 'center'; g.fillText(n, 256, 64, 480); })));
  const signSet = stack(shopSignsC), signM = lit(signSet.t, 1.2);
  const shopAt = (side: number, z0b: number, z1b: number) => SHOPS.find((s) => s.side === side && s.z > z1b + 3.5 && s.z < z0b - 3.5);
  const FLAT = { side: 1, z0: 61, z1: 77 }; // the friends' flat: its own interior, built below
  // an open shop door shows the warm inside past it; the display ledges are painted wood
  const shopDoors: { side: number; x: number; z: number }[] = []; // open shop doors the walkers go in and out of
  const doorDarkM = new THREE.MeshStandardMaterial({ color: 0x2a1a10, emissive: 0xffb877, emissiveIntensity: 0.55, roughness: 0.9 });
  const ledgeM = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.75 });
  const facadesOut: Facade[] = [];
  const greebles: Record<'ledge' | 'pipe' | 'panel', THREE.BufferGeometry[]> = { ledge: [], pipe: [], panel: [] };
  // junctions: the canyon opens to side streets, and the skyline shows down them
  const GAPS: Record<number, [number, number][]> = { 1: [[34, 26]], [-1]: [[-40, -48]] };
  const sideStreets: { side: number; z0: number; z1: number; m: THREE.Material }[] = [];
  const h0 = (_f: typeof FLAT) => 2 * 3.3 + 0.6;
  let k = 0;
  for (const side of [-1, 1]) {
    for (let z = N + 2; z > S + 6; ) {
      let len = 10 + Math.floor(rnd() * 5);
      const inFlat = side === FLAT.side && z > FLAT.z0;
      const gap = (GAPS[side] ?? []).find(([a, b]) => z - len < a && z > b);
      if (gap && !inFlat) {
        if (z > gap[0]) len = z - gap[0]; // build up to the junction
        else { // a side street: built below, once the main street is up (sideStreet)
          sideStreets.push({ side, z0: gap[0], z1: gap[1], m: pick(facadeMats[1]) });
          for (const zz of [gap[0], gap[1]]) blocks.push(new THREE.Box3(new THREE.Vector3(Math.min(side * FRONT, side * (FRONT + 12)), 0, zz - 0.2), new THREE.Vector3(Math.max(side * FRONT, side * (FRONT + 12)), 20, zz + 0.2)));
          z = gap[1]; continue;
        }
      }
      if (inFlat) len = z - FLAT.z0;
      const zc = z - len / 2, floors = inFlat ? 2 : rnd() < 0.55 ? 3 : 4, h = floors * 3.3 + 0.6, depth = 12;
      if (!inFlat) facadesOut.push({ side, z0: z, z1: z - len, h });
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
      // surface richness: a ledge at every floor, rain pipes, inset panels, slatted vents
      if (!inFlat) {
        for (let f = 1; f <= floors; f++) greebles.ledge.push(new THREE.BoxGeometry(0.28, 0.16, len - 0.4).translate(face + out * 0.14, f * 3.3 + 0.05, zc).toNonIndexed());
        for (const pz of [zc - len / 2 + 0.6, zc + len / 2 - 0.6]) greebles.pipe.push(new THREE.CylinderGeometry(0.07, 0.07, h, 6).translate(face + out * 0.12, h / 2, pz).toNonIndexed());
        for (let f = 1; f < floors; f++) for (let wz = zc - len / 2 + 2.9; wz < zc + len / 2 - 2.6; wz += 2.6) greebles.panel.push(new THREE.BoxGeometry(0.05, 1.1, 0.9).translate(face + out * 0.03, f * 3.3 + 1.4, wz).toNonIndexed());
        if (rnd() < 0.5) for (let v = 0; v < 5; v++) greebles.pipe.push(new THREE.BoxGeometry(0.06, 0.06, 1.2).translate(face + out * 0.08, 3.9 + v * 0.12, zc + len / 2 - 1.6).toNonIndexed());
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
          if (tier === 2) { const pl = top(new THREE.PointLight(0xffc98a, 6, 9, 2)); pl.position.set(face + out * 1.6, 3.0, shop.z); }
        }
        for (let wz = zc - len / 2 + 2.2; wz < zc + len / 2 - 2; wz += 4.2) {
          if (shop && Math.abs(wz - shop.z) < 4.6) continue;
          if (rnd() < 0.72) { // open and lit: a little shop, its goods glowing, its name over the door
            const yaw = out > 0 ? Math.PI / 2 : -Math.PI / 2;
            fronts.tile(plane(3.6, 2.6, frontM, face + out * 0.03, 1.45 + FLOOR, wz, yaw).geometry, Math.floor(rnd() * 6));
            signSet.tile(plane(3.4, 0.6, signM, face + out * 0.06, 3.15 + FLOOR, wz, yaw).geometry, Math.floor(rnd() * shopSignsC.length));
            pool(face + out * 1.4, wz, 2.2);
            // open for business: the door at one end of the front stands open into the lit inside, and goods are set
            // out on a display ledge in front of the window (no rnd() here: the street's own sequence stays as it was)
            if (rich) {
              const hsh = Math.abs(Math.sin(wz * 12.9898 + side * 78.233) * 43758.5453) % 1, dzs = hsh < 0.5 ? -1 : 1;
              box(0.14, 2.25, 1.05, doorDarkM, face + out * 0.05, 1.12 + FLOOR, wz + dzs * 1.25).castShadow = false;
              shopDoors.push({ side, x: face + out * 0.15, z: wz + dzs * 1.05 });
              // the leaf swung out on its hinge at the far edge of the opening, 66 degrees open
              const hz = wz + dzs * 1.75, ldx = out * Math.sin(1.15), ldz = -dzs * Math.cos(1.15);
              const leaf = box(0.05, 2.15, 0.95, ledgeM, face + ldx * 0.475, 1.08 + FLOOR, hz + ldz * 0.475); leaf.rotation.y = Math.atan2(ldx, ldz);
              { const ex = face + ldx * 0.95, ez = hz + ldz * 0.95; blocks.push(new THREE.Box3(new THREE.Vector3(Math.min(face, ex) - 0.05, 0, Math.min(hz, ez) - 0.05), new THREE.Vector3(Math.max(face, ex) + 0.05, 2.2, Math.max(hz, ez) + 0.05))); }
              box(0.55, 0.07, 1.9, ledgeM, face + out * 0.42, 0.82 + FLOOR, wz - dzs * 0.6);
              // light scans only (a few thousand triangles each): the heavy baskets and crates put the gate over budget
              const goods = [['brass_pot_01', 0.8], ['food_pomegranate_01', 1], ['wooden_crate_01', 0.5], ['pot_enamel_01', 0.8], ['wicker_basket_02', 0.8], ['food_apple_01', 1]] as [string, number][];
              for (let g = 0; g < (tier === 2 ? 2 : 1); g++) { const [gn, gs] = goods[Math.floor(hsh * 6 + g * 3) % goods.length]; place(gn, face + out * 0.42, FLOOR + 0.86, wz - dzs * (0.15 + g * 0.85), hsh * 6.28, gs); }
            }
          } else place(rnd() < 0.6 ? 'rollershutter_door' : 'rollershutter_window_01', face + out * 0.02, FLOOR, wz, out > 0 ? Math.PI / 2 : -Math.PI / 2);
        }
        // an awning over the pavement: striped cloth, tilted down to the street
        // one material per stripe, shared by every awning in it: the repeat along the street is in the uvs
        const ag = new THREE.PlaneGeometry(1.7, len - 1.4), auv = ag.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < auv.count; i++) auv.setY(i, auv.getY(i) * (len - 1.4) / 2);
        const aw = add(new THREE.Mesh(stripeSet.tile(ag, k % awnings.length, true), awningM));
        aw.rotation.set(-Math.PI / 2, out * 0.3, 0, 'XYZ'); aw.position.set(face + out * 0.8, 3.75 + FLOOR, zc); aw.castShadow = true;
      }
      z -= len; k++;
    }
  }
  for (const [k2, m] of [['ledge', parapetM], ['pipe', railM], ['panel', frameM]] as ['ledge' | 'pipe' | 'panel', THREE.Material][]) {
    if (!greebles[k2].length) continue;
    const g = add(new THREE.Mesh(mergeGeometries(greebles[k2], false)!, m)); g.castShadow = rich; g.receiveShadow = true;
  }
  // ---- side streets: the two junctions open into lanes of their own, SIDE_L metres deep, lined with shops and flats,
  // ending in a little square with a landmark (a light fountain, a statue of the first liner). The bazaar was one
  // street; now it has corners to turn ----
  const SIDE_L = 46, plazas: { x: number; z: number }[] = [];
  for (const st of sideStreets) {
    const { side, z0, z1 } = st, zc = (z0 + z1) / 2, wz = z0 - z1, xA = FRONT + 12, xE = FRONT + SIDE_L;
    const X = (d: number) => side * d; // distance from the street centre line, out along the side street
    // the lane: paving, a strip of road down the middle, lit edges
    const lane = add(new THREE.Mesh(new THREE.PlaneGeometry(SIDE_L + 14, wz + 0.4), paving)); lane.rotation.x = -Math.PI / 2; lane.position.set(X(FRONT + (SIDE_L + 14) / 2), FLOOR - 0.001, zc); lane.receiveShadow = true; lane.userData.ground = false;
    const mid = add(new THREE.Mesh(new THREE.PlaneGeometry(SIDE_L - 14, 3), roadM)); mid.rotation.x = -Math.PI / 2; mid.position.set(X(FRONT + 12 + (SIDE_L - 14) / 2 - 6), FLOOR + 0.002, zc); mid.receiveShadow = true; mid.userData.ground = false;
    // both sides: buildings of three to six floors, their fronts on the lane, a lit shop on the ground floor of each
    for (const dz of [1, -1]) {
      const zf = dz > 0 ? z0 : z1; // the building line on this side of the lane
      for (let x = xA; x < xE - 4; ) {
        const w = 7 + Math.floor(rnd() * 4), floors = 3 + Math.floor(rnd() * 4), h = floors * 3.3 + 0.6, depth = 10, xm = x + w / 2;
        const wall = pick(facadeMats[Math.floor(rnd() * 3)]);
        solid(box(w - 0.2, h, depth, wall, X(xm), h / 2, zf + dz * depth / 2));
        box(w, 0.5, depth + 0.3, parapetM, X(xm), h + 0.25, zf + dz * depth / 2);
        const faceZ = zf - dz * 0.03, yaw = dz > 0 ? Math.PI : 0;
        for (let f = 1; f < floors; f++) for (let wx = x + 1.3; wx < x + w - 1; wx += 2.4) {
          box(1.2, 1.75, 0.12, frameM, X(wx), f * 3.3 + 1.5, faceZ - dz * 0.02);
          box(0.95, 1.5, 0.06, rnd() < 0.3 ? litM : glassM, X(wx), f * 3.3 + 1.5, faceZ - dz * 0.08).castShadow = false;
        }
        fronts.tile(plane(Math.min(3.6, w - 2), 2.6, frontM, X(xm), 1.45 + FLOOR, faceZ - dz * 0.02, yaw).geometry, Math.floor(rnd() * 6));
        signSet.tile(plane(Math.min(3.4, w - 2.2), 0.6, signM, X(xm), 3.15 + FLOOR, faceZ - dz * 0.05, yaw).geometry, Math.floor(rnd() * shopSignsC.length));
        pool(X(xm), zf - dz * 1.4, 2.2);
        add(new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.08, 0.08), ledMats[(k++) % ledMats.length])).position.set(X(xm), h + 0.55, faceZ - dz * 0.1);
        x += w;
      }
    }
    // lamps down the lane, alternating sides, each with its pool of light
    for (let x = FRONT + 8, i = 0; x < FRONT + SIDE_L + 12; x += 9, i++) {
      const lz = i % 2 ? z0 - 0.6 : z1 + 0.6;
      place('street_lamp_02', X(x), FLOOR, lz, i % 2 ? Math.PI : 0);
      pool(X(x), lz + (i % 2 ? -1.4 : 1.4), 3);
    }
    // the square at the end: open on three sides to more buildings, a landmark in the middle
    const px = FRONT + SIDE_L + 8, pz = zc;
    plazas.push({ x: X(px), z: pz });
    const sq = add(new THREE.Mesh(new THREE.PlaneGeometry(18, 22), paving)); sq.rotation.x = -Math.PI / 2; sq.position.set(X(px), FLOOR - 0.001, pz); sq.receiveShadow = true; sq.userData.ground = false;
    for (const [bx, bz, bw, bd] of [[px + 12, pz + 10, 6, 10], [px + 12, pz - 10, 6, 10], [px, pz + 14, 18, 6], [px, pz - 14, 18, 6], [FRONT + SIDE_L - 1, pz + 9.5, 3, 11], [FRONT + SIDE_L - 1, pz - 9.5, 3, 11]] as number[][]) {
      const hh = 8 + Math.floor(rnd() * 3) * 3.3;
      solid(box(bw, hh, bd, rnd() < 0.5 ? st.m : pick(facadeMats[0]), X(bx), hh / 2, bz));
      box(bw + 0.2, 0.5, bd + 0.2, parapetM, X(bx), hh + 0.25, bz);
    }
    if (side > 0) {
      // the light fountain: a basin, a ring of jets, a glowing column
      const basin = add(new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.6, 32), parapetM)); basin.position.set(X(px), 0.3, pz); basin.castShadow = basin.receiveShadow = true;
      const water = add(new THREE.Mesh(new THREE.CircleGeometry(2.9, 32), new THREE.MeshStandardMaterial({ color: 0x1d4c63, roughness: 0.05, metalness: 0.3, emissive: 0x0b3a4a }))); water.rotation.x = -Math.PI / 2; water.position.set(X(px), 0.55, pz);
      const col = add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 3.2, 12), ledMats[0])); col.position.set(X(px), 2, pz);
      blocks.push(new THREE.Box3(new THREE.Vector3(X(px) - 3.3, 0, pz - 3.3), new THREE.Vector3(X(px) + 3.3, 0.7, pz + 3.3)));
    } else {
      // the statue: the first liner to leave Taravel, nose up on a plinth
      const plinth = add(new THREE.Mesh(new THREE.BoxGeometry(3, 2, 3), parapetM)); plinth.position.set(X(px), 1, pz); plinth.castShadow = plinth.receiveShadow = true;
      const ship = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 3.6, 6, 16), new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 0.9, roughness: 0.3 }))); ship.position.set(X(px), 4.3, pz); ship.rotation.z = 0.35; ship.castShadow = true;
      blocks.push(new THREE.Box3(new THREE.Vector3(X(px) - 1.6, 0, pz - 1.6), new THREE.Vector3(X(px) + 1.6, 2, pz + 1.6)));
    }
    // shops on the square's three walls, lit like the bazaar's: the square is a place to be, not a dark yard
    for (const [fx, fz, fyaw, n] of [[px + 8.9, pz, side > 0 ? -Math.PI / 2 : Math.PI / 2, 3], [px, pz + 10.9, Math.PI, 3], [px, pz - 10.9, 0, 3]] as number[][]) {
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 5, ax = fz === pz ? X(fx) : X(px + off), az = fz === pz ? pz + off : fz;
        const ys = fyaw;
        fronts.tile(plane(3.6, 2.6, frontM, ax, 1.45 + FLOOR, az, ys).geometry, Math.floor(rnd() * 6));
        signSet.tile(plane(3.4, 0.6, signM, ax + (fz === pz ? -side * 0.03 : 0), 3.15 + FLOOR, az + (fz === pz ? 0 : fz > pz ? -0.03 : 0.03), ys).geometry, Math.floor(rnd() * shopSignsC.length));
        pool(fz === pz ? ax - side * 1.6 : ax, fz === pz ? az : az + (fz > pz ? -1.6 : 1.6), 2.6);
      }
    }
    // the square lit like the street: lamps at its corners, pools of light, a warm light over the landmark on bigger screens
    for (const [lx, lz] of [[px - 7, pz - 9], [px - 7, pz + 9], [px + 7, pz - 9], [px + 7, pz + 9]]) { place('street_lamp_01', X(lx), FLOOR, lz, 0); pool(X(lx), lz, 3.4); }
    pool(X(px), pz, 7); pool(X(px - 5), pz, 4); pool(X(px + 4), pz + 5, 4); pool(X(px + 4), pz - 5, 4);
    if (tier === 2) { const pl = top(new THREE.PointLight(side > 0 ? 0x9fe9ff : 0xffd9a0, 22, 20, 1.4)); pl.position.set(X(px), 5, pz); }
    for (const [bx, bz] of [[px - 4, pz + 5], [px - 4, pz - 5]]) place(side > 0 ? 'painted_wooden_bench' : 'modular_street_seating', X(bx), FLOOR, bz, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    // the square's far side opens on to the avenue (districts.ts): the way out of the old town to the rest of the city
  }

  // walls closing both ends of the street, so nobody walks off the map
  // the north end opens through the old town's gate to the ring street and the city beyond; the gate end stays closed
  blocks.push(new THREE.Box3(new THREE.Vector3(-30, -1, S - 12), new THREE.Vector3(30, 20, S - 1.5)));

  // ---- the flat: a lived-in two-room home, a hall, a kitchen along one wall, two windows on the street ----
  {
    const x0 = FRONT, x1 = FRONT + FLAT_D, zA = FLAT_Z0, zB = FLAT_Z1, hgt = 3.0, B = 0; // a 3 m ceiling, a 2.2 m door
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
    // street wall: the door at z 64.6 to 66.2, the living room's windows at z 68 to 70.4 and 73.2 to 75.6
    wall(0.3, hgt, 64.6 - zA, x0, hgt / 2 + FLOOR, (zA + 64.6) / 2, outM);
    wall(0.3, hgt, 1.8, x0, hgt / 2 + FLOOR, 67.1, outM); wall(0.3, hgt, 2.8, x0, hgt / 2 + FLOOR, 71.8, outM); wall(0.3, hgt, zB - 75.6, x0, hgt / 2 + FLOOR, (75.6 + zB) / 2, outM);
    box(0.3, hgt - 2.2, 1.6, outM, x0, 2.2 + (hgt - 2.2) / 2 + FLOOR, 65.4);
    const glassM = new THREE.MeshStandardMaterial({ color: 0xbfd7e6, transparent: true, opacity: 0.15, roughness: 0.05 });
    for (const wz of [69.2, 74.4]) {
      wall(0.3, 1.0, 2.4, x0, 0.5 + FLOOR, wz, outM); box(0.3, hgt - 2.3, 2.4, outM, x0, 2.3 + (hgt - 2.3) / 2 + FLOOR, wz);
      box(0.08, 1.3, 2.4, glassM, x0, 1.65 + FLOOR, wz);
    }
    // inside: the hall and the kitchen to the left of the door, the living room under the windows; at the back a
    // bedroom and a bathroom behind a wall with two doorways
    const XB = x0 + 7.0; // the back wall of the living room
    wall(0.12, hgt, 64.8 - zA, XB, hgt / 2 + FLOOR, (zA + 64.8) / 2, inM); wall(0.12, hgt, 69.0 - 65.8, XB, hgt / 2 + FLOOR, (65.8 + 69.0) / 2, inM); // the bathroom's doorway is z 64.8 to 65.8
    for (const [dz0, dz1] of [[64.8, 65.8], [69.0, 71.2]]) box(0.12, hgt - 2.15, dz1 - dz0, inM, XB, 2.15 + (hgt - 2.15) / 2 + FLOOR, (dz0 + dz1) / 2); // lintels
    wall(0.12, hgt, zB - 71.2, XB, hgt / 2 + FLOOR, (71.2 + zB) / 2, inM); // living room | bedroom; the doorway is z 69 to 71.2
    wall(x1 - XB, hgt, 0.12, (XB + x1) / 2, hgt / 2 + FLOOR, 66.4, inM); // bathroom | bedroom
    // the kitchen: a counter along the wall by the door, a hob, a sink, a tall fridge, open shelves over them
    const ctrM = new THREE.MeshStandardMaterial({ color: 0x3a4a52, roughness: 0.6 }), topM = new THREE.MeshStandardMaterial({ color: 0xd8d0c4, roughness: 0.35 });
    solid(box(4.2, 0.88, 0.62, ctrM, x0 + 3.0, 0.44 + FLOOR, zA + 0.47)); box(4.24, 0.04, 0.66, topM, x0 + 3.0, 0.9 + FLOOR, zA + 0.47);
    box(0.56, 0.02, 0.5, new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.3, metalness: 0.4 }), x0 + 3.9, 0.93 + FLOOR, zA + 0.47);
    box(0.5, 0.06, 0.4, new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.2, metalness: 0.9 }), x0 + 2.2, 0.9 + FLOOR, zA + 0.47);
    solid(box(0.7, 1.9, 0.66, new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.3, metalness: 0.2 }), x0 + 5.5, 0.95 + FLOOR, zA + 0.45));
    for (const sy of [1.55, 1.95]) box(2.6, 0.04, 0.3, topM, x0 + 2.6, sy + FLOOR, zA + 0.2);
    wall(0.3, hgt, zB - zA, x1, hgt / 2 + FLOOR, (zA + zB) / 2, inM); wall(x1 - x0, hgt, 0.3, (x0 + x1) / 2, hgt / 2 + FLOOR, zA, inM); wall(x1 - x0, hgt, 0.3, (x0 + x1) / 2, hgt / 2 + FLOOR, zB, inM);
    const ceil = add(new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, zB - zA), inM)); ceil.rotation.x = Math.PI / 2; ceil.position.set((x0 + x1) / 2, hgt + FLOOR, (zA + zB) / 2);
    const lamp = top(new THREE.PointLight(0xffd9a0, rich ? 8 : 6, 9, 1.5)); lamp.position.set(x0 + 3.5, 2.7, 69.5);
    const fairy = add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, zB - zA - 0.6), ledMats[2])); fairy.position.set(x1 - 0.2, 2.8, (zA + zB) / 2);
    plane(1.6, 0.4, lit(canvasTex(512, 128, (g) => { g.fillStyle = '#20324a'; g.fillRect(0, 0, 512, 128); g.fillStyle = '#f2ead8'; g.font = '600 64px Rajdhani, sans-serif'; g.textAlign = 'center'; g.fillText('FLAT 4B', 256, 86); }), 0.3), x0 - 0.17, 2.55 + FLOOR, 65.4, -Math.PI / 2);
    // the morning's clutter: a small table, a sofa under the window, a bed in the corner, shelves, a kettle
    for (const [n, x, y, z, yaw, sc] of [
      ['dining_table', 13.2, FLOOR, 66.4, Math.PI / 2, 0.8], ['dining_chair_02', 13.2, FLOOR, 65.4, 0, 1], ['sofa_02', 10.2, FLOOR, 71.8, Math.PI / 2, 0.9],
      ['old_bed_frame', 19.6, FLOOR, 73.6, Math.PI / 2, 0.9], ['wooden_bookshelf_worn', 16.2, FLOOR, 75.9, Math.PI, 0.85], ['drawer_cabinet', 20.6, FLOOR, 69.2, -Math.PI / 2, 0.85],
      ['vintage_electric_kettle', 13.4, FLOOR + 0.63, 66.7, 0.4, 1], ['wall_clock', x1 - 0.2, 2.2, 68.6, -Math.PI / 2, 1], ['potted_plant_02', 10.4, FLOOR, 76.0, 0, 0.8],
      ['ceiling_fan', x0 + 3.5, hgt + FLOOR - 0.05, 71.5, 0, 0.8], ['cardboard_box_01', 11.0, FLOOR, 64.7, 0.3, 0.8], ['wicker_basket_01', 18.0, FLOOR, 75.8, 0, 1],
    ] as [string, number, number, number, number, number][]) place(n, x, y, z, yaw, sc);
    for (const b of [[13.2, 66.4, 0.6, 0.8], [10.2, 71.8, 0.5, 1.0], [19.6, 73.6, 0.9, 1.1], [16.2, 75.9, 1.0, 0.3], [20.6, 69.2, 0.4, 0.6]]) blocks.push(new THREE.Box3(new THREE.Vector3(b[0] - b[2], 0, b[1] - b[3]), new THREE.Vector3(b[0] + b[2], 1, b[1] + b[3])));
    const plate = add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.02, 24), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.4 }))); plate.position.set(13.1, FLOOR + 0.64, 66.2);
    const para = add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 24), new THREE.MeshStandardMaterial({ color: 0xd9a35a, roughness: 0.8 }))); para.position.set(13.1, FLOOR + 0.66, 66.2); para.name = 'paratha'; para.userData.keep = true;
    box(0.55, 0.4, 0.3, new THREE.MeshStandardMaterial({ color: 0x2c4a6a, roughness: 0.8 }), 12.0, FLOOR + 0.2, 70.6);
    const jacket = box(0.5, 0.06, 0.4, new THREE.MeshStandardMaterial({ color: 0x7a3b2e, roughness: 0.95 }), 10.3, FLOOR + 0.55, 68.6); jacket.rotation.y = 0.4; jacket.name = 'jacket'; jacket.userData.keep = true;
    const rug = add(new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), over(new THREE.MeshStandardMaterial({ roughness: 1, map: canvasTex(512, 352, (g) => {
      g.fillStyle = '#8e2b2b'; g.fillRect(0, 0, 512, 352); g.strokeStyle = '#e8c27a'; g.lineWidth = 14; g.strokeRect(20, 20, 472, 312);
      g.fillStyle = '#e8c27a'; g.beginPath(); g.moveTo(256, 110); g.lineTo(330, 176); g.lineTo(256, 242); g.lineTo(182, 176); g.closePath(); g.fill();
    }) }), 3))); rug.rotation.x = -Math.PI / 2; rug.position.set(12.4, FLOOR, 68.8); rug.userData.ground = false;
    const poster = (title: string, bg: string, fg: string, x: number, z: number, yaw: number) => plane(0.8, 1.1, new THREE.MeshStandardMaterial({ roughness: 0.6, map: canvasTex(256, 360, (g) => {
      g.fillStyle = bg; g.fillRect(0, 0, 256, 360); g.fillStyle = fg; g.font = '700 34px Rajdhani, sans-serif'; g.textAlign = 'center';
      title.split('|').forEach((l, i) => g.fillText(l, 128, 70 + i * 40, 232));
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(40 + i * 35, 260, 14, 0, Math.PI * 2); g.fill(); g.fillRect(28 + i * 35, 276, 24, 40); }
    }) }), x, 1.9 + FLOOR, z, yaw);
    poster('TARAVEL|TITANS|CUP FINAL', '#0d3b66', '#f4d35e', 12.0, zB - 0.17, Math.PI); poster('SIX|LINEAGES|ONE BRAIN CELL', '#ff5d8f', '#ffffff', x0 + 6.9, 74.0, -Math.PI / 2);
    // lived in: the bed made (badly), a wardrobe, the telly on a low bench facing the sofa, cushions, shoes by the door,
    // pans and a jug in the kitchen, and a bathroom with a toilet, a basin under a mirror, a shower and a towel
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.25 }), chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.15, metalness: 0.9 });
    const woodM = new THREE.MeshStandardMaterial({ color: 0x5a3e2b, roughness: 0.7 });
    // the bed (its frame is 0.9 by 2 m, along the back wall): mattress, a rumpled duvet, a pillow
    box(1.75, 0.18, 0.8, new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.9 }), 19.65, FLOOR + 0.36, 73.6);
    const duvet = box(1.25, 0.1, 0.86, new THREE.MeshStandardMaterial({ color: 0x3f6f8f, roughness: 0.95 }), 19.35, FLOOR + 0.48, 73.62); duvet.rotation.z = 0.03; duvet.rotation.y = 0.04;
    box(0.36, 0.12, 0.62, white, 20.35, FLOOR + 0.5, 73.6);
    // the wardrobe against the bedroom's street-end wall, a rug by the bed
    place('painted_wooden_cabinet', 17.6, FLOOR, zB - 0.62, Math.PI, 1.35);
    blocks.push(new THREE.Box3(new THREE.Vector3(16.8, 0, zB - 1.1), new THREE.Vector3(18.4, 2, zB)));
    const mat2 = add(new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), over(new THREE.MeshStandardMaterial({ color: 0x9a8f7a, roughness: 1 }), 3))); mat2.rotation.x = -Math.PI / 2; mat2.position.set(19.5, FLOOR, 72.6); mat2.userData.ground = false;
    // the living room: a low bench with the telly, facing the sofa; cushions on the sofa
    solid(box(0.42, 0.42, 1.2, woodM, 16.15, FLOOR + 0.21, 71.85));
    place('television_02', 16.1, FLOOR + 0.42, 71.85, -Math.PI / 2, 1.3);
    if (rich) place('throw_pillows_01', 9.95, FLOOR + 0.36, 71.8, Math.PI / 2, 0.75);
    // shoes by the door, a coat hook with a scarf
    for (const [sx, sz, c] of [[9.85, 63.6, 0x2a2a2e], [9.85, 63.95, 0x2a2a2e], [10.25, 63.7, 0xc94f3a], [10.25, 64.02, 0xc94f3a]] as [number, number, number][]) box(0.26, 0.09, 0.11, new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }), sx, FLOOR + 0.045, sz);
    box(0.05, 0.75, 0.32, new THREE.MeshStandardMaterial({ color: 0xd9b44a, roughness: 0.95 }), x0 + 0.2, FLOOR + 1.3, 63.0);
    // the kitchen counter: a jug, a bowl, the pan on the hob; a vase on the shelf; a notebook and a mug on the table
    if (rich) {
      place('jug_01', 10.7, FLOOR + 0.92, zA + 0.42, 0.6, 0.9); place('wooden_bowl_01', 12.7, FLOOR + 0.92, zA + 0.45, 0, 0.8);
      place('brass_pan_01', 13.9, FLOOR + 0.94, zA + 0.47, 1.4, 1); place('ceramic_vase_01', 11.2, FLOOR + 1.57, zA + 0.2, 0, 0.6);
      place('binder_notebook', 12.95, FLOOR + 0.63, 67.0, 0.3, 0.9); place('desk_lamp_arm_01', 20.6, FLOOR + 1.6, 68.85, -Math.PI / 2, 0.6);
      place('book_encyclopedia_set_01', 20.55, FLOOR + 1.6, 69.15, -Math.PI / 2, 1);
    }
    const mug = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.5 }))); mug.position.set(13.45, FLOOR + 0.68, 65.9);
    // the bathroom (x 16.5 to 21, z 61.4 to 66.4): toilet in the far corner, basin and mirror on the back wall, a shower
    // tray with a glass screen by the bedroom wall, a towel on a rail, a bath mat, a cleaner by the toilet
    const bowl = add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.4, 20), white)); bowl.position.set(20.45, FLOOR + 0.2, 62.3); bowl.castShadow = true;
    box(0.2, 0.42, 0.44, white, 20.78, FLOOR + 0.55, 62.3); box(0.42, 0.03, 0.4, white, 20.42, FLOOR + 0.415, 62.3);
    const ped = add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.78, 16), white)); ped.position.set(18.4, FLOOR + 0.39, zA + 0.32);
    box(0.56, 0.14, 0.42, white, 18.4, FLOOR + 0.84, zA + 0.36); box(0.03, 0.12, 0.03, chrome, 18.4, FLOOR + 0.96, zA + 0.2);
    place('ornate_mirror_01', 18.4, FLOOR + 1.55, zA + 0.16, 0, 1);
    box(0.9, 0.06, 0.9, white, 20.5, FLOOR + 0.03, 65.85);
    box(0.02, 1.9, 0.9, new THREE.MeshStandardMaterial({ color: 0xcfe4ec, transparent: true, opacity: 0.18, roughness: 0.05 }), 20.03, FLOOR + 1.0, 65.85);
    box(0.04, 0.04, 0.3, chrome, 20.9, FLOOR + 2.05, 65.85); box(0.14, 0.03, 0.14, chrome, 20.8, FLOOR + 2.0, 65.85);
    box(0.6, 0.02, 0.02, chrome, 17.3, FLOOR + 1.2, zA + 0.18); box(0.5, 0.55, 0.03, new THREE.MeshStandardMaterial({ color: 0xd2694a, roughness: 1 }), 17.3, FLOOR + 0.95, zA + 0.2);
    const bm = add(new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), over(new THREE.MeshStandardMaterial({ color: 0x6f9a8f, roughness: 1 }), 3))); bm.rotation.x = -Math.PI / 2; bm.position.set(18.4, FLOOR, zA + 1.0); bm.userData.ground = false;
    if (rich) place('multi_cleaner_bottle', 20.0, FLOOR, 61.8, 0.5, 1);
    for (const b of [[20.5, 62.3, 0.4, 0.3], [18.4, zA + 0.35, 0.3, 0.25], [16.15, 71.85, 0.25, 0.65]]) blocks.push(new THREE.Box3(new THREE.Vector3(b[0] - b[2], 0, b[1] - b[3]), new THREE.Vector3(b[0] + b[2], 1, b[1] + b[3])));
  }

  for (const sh of SHOPS) pool(sh.side * (FRONT - 1.6), sh.z, 3.6);

  // ---- street life: lamps, stalls, the chai stall, furniture ----
  for (let z = S + 10; z < N - 4; z += 14) for (const sd of [-1, 1]) {
    const lz = z + (sd > 0 ? 7 : 0);
    place(rnd() < 0.5 ? 'street_lamp_01' : 'street_lamp_02', sd * 4.8, FLOOR, lz, sd > 0 ? -Math.PI / 2 : Math.PI / 2);
    pool(sd * 4.6, lz, 2.6);
    const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(3), toneMapped: false }))); head.position.set(sd * 4.2, 4.5, lz);
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
  const canopyM = new THREE.MeshStandardMaterial({ map: stripeSet.t, side: THREE.DoubleSide });
  for (const [x, z] of [[-6.4, 18], [6.4, 26], [-6.4, -20], [6.4, -26]] as [number, number][]) {
    for (const [n, dx, dy, dz, yaw] of [['wooden_crate_01', 0, 0, 0, 0.2], ['wooden_crate_01', 0, 0, 1, -0.1], ['wicker_basket_01', 0, 0.55, 0, 0], ['wicker_basket_02', 0, 0.55, 1, 0]] as [string, number, number, number, number][]) place(n, x + dx, FLOOR + dy, z + dz, yaw);
    for (const f of ['food_apple_01', 'food_pomegranate_01', 'food_lime_01', 'food_pears_asian_01']) place(f, x + (rnd() - 0.5) * 0.3, FLOOR + 0.72, z + rnd() * 1.0, rnd() * 6);
    const canopy = add(new THREE.Mesh(stripeSet.tile(new THREE.PlaneGeometry(2.2, 2.8), (x > 0 ? 1 : 0) + (z > 0 ? 2 : 0), true), canopyM));
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

  // cars parked along the kerbs (drawn with the traffic below: the same saloon, cars.ts)
  const parkedAt: [number, number, number][] = rich ? [[-3.2, 52, 0xf4f4f6], [3.2, 38, 0xffb347], [-3.2, 22, 0x2c3e94], [3.2, -22, 0xe8e2d4], [-3.2, -30, 0xc0392b], [3.2, 58, 0x16a085]] : [[-3.2, 52, 0xf4f4f6], [3.2, -22, 0xffb347]];
  for (const [x, z] of parkedAt) blocks.push(new THREE.Box3(new THREE.Vector3(x - 0.95, 0, z - 2.4), new THREE.Vector3(x + 0.95, 1.5, z + 2.4)));
  // stalls spilling onto the road: mats of goods at the kerb
  const kerbMatM = over(new THREE.MeshStandardMaterial({ map: stripeSet.t, roughness: 1 }), 3);
  for (const [x, z] of (rich ? [[3.3, 30], [-3.3, 10], [3.3, -32], [-3.3, -16], [3.3, 48]] : [[3.3, 30], [-3.3, -16]]) as [number, number][]) {
    const mat = add(new THREE.Mesh(stripeSet.tile(new THREE.PlaneGeometry(1.3, 2.4), Math.abs(Math.round(z)) % awnings.length, true), kerbMatM)); mat.rotation.x = -Math.PI / 2; mat.position.set(x, 0, z); mat.userData.ground = false;
    for (const [n, dx, dz] of [['wicker_basket_01', 0, -0.6], ['plastic_crate_01', 0, 0.5], ['food_apple_01', 0.1, -0.6]] as [string, number, number][]) place(n, x + dx, n.startsWith('food') ? 0.3 : 0, z + dz, rnd() * 6);
    place('plastic_monobloc_chair_01', x + Math.sign(x) * 0.2, 0, z + 1.6, Math.sign(x) > 0 ? -Math.PI / 2 : Math.PI / 2);
    blocks.push(new THREE.Box3(new THREE.Vector3(x - 0.65, 0, z - 1.2), new THREE.Vector3(x + 0.65, 0.9, z + 2.1)));
  }
  // hanging signs at every height, sticking out over the pavement
  {
    const names = ['Sharma Nano-Tailors', 'Noor Holo-Opticals', 'Nebula Bytes', 'Lunar Lassi', 'Qmail Repairs', 'Gupta Hover Parts', 'Meera Laser Mehndi', 'Haji Orbital Dry Fruits', 'Zaika Zero-G Rolls', 'Raju Neural SIMs', 'Pyaar Holo-Photos', 'Saturn Sweets'];
    const cols = ['#ffd36e', '#7fd8ff', '#ff6ec7', '#b6ff6e', '#ffffff', '#ff9f6e'];
    // one material for all of them: their canvases are stacked once the loop has drawn them
    const hangM = new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 0.9, side: THREE.DoubleSide });
    const hung: [THREE.Mesh, HTMLCanvasElement][] = [];
    for (let i = 0, n = rich ? 22 : 10; i < n; i++) {
      const side = i % 2 ? 1 : -1, z = N - 6 - (i / n) * (N - S - 14) + (rnd() - 0.5) * 3, y = 3.0 + rnd() * 4.5;
      const t = canvasTex(256, 96, (g) => { const c = cols[i % cols.length]; g.fillStyle = '#1b1b24'; g.fillRect(0, 0, 256, 96); g.strokeStyle = c; g.lineWidth = 5; g.strokeRect(4, 4, 248, 88); g.fillStyle = c; g.font = '700 30px Rajdhani, sans-serif'; g.textAlign = 'center'; g.fillText(names[i % names.length], 128, 58, 236); });
      const sg = add(new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), hangM)); hung.push([sg, canvasOf(t)]);
      sg.position.set(side * (FRONT - 0.9), y, z); sg.userData.ground = false;
      box(0.9, 0.04, 0.04, railM, side * (FRONT - 0.45), y + 0.32, z).castShadow = false;
    }
    const hs = stack(hung.map(([, c]) => c)); hangM.map = hangM.emissiveMap = hs.t;
    hung.forEach(([m], i) => hs.tile(m.geometry, i));
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

  // ---- traffic: taxis and cars down both lanes of the bazaar; they wait for you if you are in the way. Three
  // instanced draws (bodies, glass, lamps) for all of them and the parked ones ----
  const traffic: { x: number; z: number; v: number; speed: number; col: THREE.Color }[] = [];
  const NCAR = rich ? 10 : 5, CK = carKit();
  const carMeshes = [new THREE.InstancedMesh(CK.bodyG, CK.carBodyM, NCAR + parkedAt.length), new THREE.InstancedMesh(CK.glassG, CK.carGlassM, NCAR + parkedAt.length), new THREE.InstancedMesh(CK.lightG, CK.carLightM, NCAR + parkedAt.length)];
  const cars = carMeshes[0];
  const carCols = [0xf4f4f6, 0xffb347, 0x2c3e94, 0xc0392b, 0x16a085, 0x1b1b1f, 0xf2d64b];
  for (let i = 0; i < NCAR; i++) {
    const dir = i % 2 ? 1 : -1;
    traffic.push({ x: dir * 1.7, z: S + 6 + rnd() * (N - S - 12), v: dir, speed: 6 + rnd() * 4, col: new THREE.Color(carCols[i % carCols.length]) });
    cars.setColorAt(i, traffic[i].col);
  }
  for (const m of carMeshes) { m.castShadow = tier > 0 && m !== carMeshes[2]; m.frustumCulled = false; m.matrixAutoUpdate = false; add(m); }
  parkedAt.forEach(([x, z, c], i) => {
    const M0 = new THREE.Matrix4().compose(new THREE.Vector3(x, 0.02, z), new THREE.Quaternion().setFromAxisAngle(UP, x < 0 ? Math.PI : 0), new THREE.Vector3(1, 1, 1));
    for (const m of carMeshes) m.setMatrixAt(NCAR + i, M0); cars.setColorAt(NCAR + i, new THREE.Color(c));
  });
  const CM = new THREE.Matrix4(), CQ = new THREE.Quaternion(), CP = new THREE.Vector3(), C1 = new THREE.Vector3(1, 1, 1), YAX = new THREE.Vector3(0, 1, 0);
  const drive = (dt: number, _time: number) => {
    traffic.forEach((c, i) => {
      // slow for you, or for the car ahead in the lane
      let gap = 99;
      if (you && Math.abs(you.position.x - c.x) < 1.6) { const ahead = (you.position.z - c.z) * c.v; if (ahead > 0) gap = Math.min(gap, ahead - 4.0); }
      for (const o of traffic) if (o !== c && o.v === c.v) { const ahead = (o.z - c.z) * c.v; if (ahead > 0) gap = Math.min(gap, ahead - 6.5); }
      // and for anyone in its lane: a card of the crowd, a body walking one, a townsperson (cars never pass through people)
      for (const q of dense.cards) if (Math.abs(q.x - c.x) < 1.5) { const ahead = (q.z - c.z) * c.v; if (ahead > 0 && ahead < 16) gap = Math.min(gap, ahead - 4.2); }
      for (const q of people) if (q.fig.root.visible && Math.abs(q.pos.x - c.x) < 1.5) { const ahead = (q.pos.z - c.z) * c.v; if (ahead > 0 && ahead < 16) gap = Math.min(gap, ahead - 4.2); }
      const want = gap < 1 ? 0 : Math.min(c.speed, gap * 0.9);
      c.z += c.v * want * dt;
      if (c.z > N - 2) c.z = S + 4; if (c.z < S + 4) c.z = N - 2;
      CP.set(c.x, 0.02, c.z); CQ.setFromAxisAngle(YAX, c.v > 0 ? 0 : Math.PI); CM.compose(CP, CQ, C1);
      for (const m of carMeshes) m.setMatrixAt(i, CM);
    });
    for (const m of carMeshes) m.instanceMatrix.needsUpdate = true;
  };

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

  let linerG: THREE.Group | null = null;
  // ---- the spaceport: the apron, pads with light rings, the terminal's long canopy, the liner docked with its bridge ----
  {
    const apronM = over(new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.8 }), 1); tex('road', [apronM], [30, 24]);
    const apron = add(new THREE.Mesh(new THREE.PlaneGeometry(156, 160), apronM)); apron.rotation.x = -Math.PI / 2; apron.position.set(0, 0, S - 80); apron.receiveShadow = true; apron.userData.ground = false;
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
    const liner = add(new THREE.Group()); liner.position.set(16, 9, S - 66); liner.rotation.y = 0.5; linerG = liner;
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
  // who is talking to the player right now, and the way they faced before
  let talking: { q: CityPerson; until: number; at: THREE.Vector3; rest: number } | null = null, clock = 0;
  const eye = new THREE.Vector3();
  let you: THREE.Object3D | null = null; // the player's body, from bind()
  const person = (id: string, fig: Character, x: number, z: number, yaw: number, pose: CrewPose, walk?: CityPerson['walk']) => {
    fig.root.position.set(x, hx(x), z); fig.root.rotation.y = yaw;
    fig.setGround((px) => hx(px));
    add(fig.root);
    people.push({ id, fig, pos: fig.root.position, yaw, pose, phase: rnd() * 10, walk });
  };
  for (const f of FRIENDS) person(f.id, createCharacter(f.id, detail), f.x, f.z, f.yaw, f.pose);
  // the townsfolk, the walkers and the people stood in groups are a crowd (CHAR_BUDGET): no corrective shapes, the light
  // build and no shadow from closer in
  const crowd = new Set<Character>();
  // Eight townsfolk looks, each kept by everyone who wears it: a far card is baked from a body of that look (impostor.ts)
  // and the body that takes over a card near the camera wears the same look, so nobody turns into someone else when
  // they come close or walk away.
  // Twelve on desktops (eight on phones), each its own outfit, hair and lineage, the same every visit; none in the white
  // lab coat, which is yours.
  const NLOOK = tier === 0 ? 8 : 12, LOOKS: PlayerLook[] = [], lookOf = new Map<Character, number>();
  { let ls = 777; const lr = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; }; // their own seed: the city's own sequence is untouched
    for (let v = 0; v < NLOOK; v++) LOOKS.push(townLook(v, lr)); }
  const someone = (_lineage: PlayerLook['lineage'], i: number) => {
    const v = ((i % NLOOK) + NLOOK) % NLOOK;
    const c = createCharacter('scientist', detail * 0.8, LOOKS[v]);
    c.setCrowd(true); crowd.add(c); lookOf.set(c, v); return c;
  };
  FOLK.forEach((f, i) => person(f.id, someone(f.lineage, i), f.x, f.z, f.yaw, f.pose));
  // Mir: a chai stall regular in a three-piece, the same man as the suit skin and the Drexon cameo
  person('mir', createCharacter('strong', detail, undefined, 'suit'), 5.0, 15.4, Math.PI / 2 + 0.5, 'idle');
  // walkers: up and down the pavements' outer edge, clear of the stalls
  const lineages = Object.keys(LINEAGES) as PlayerLook['lineage'][];
  for (let i = 0, n = rich ? 14 : 6; i < n; i++) {
    const sd = i % 2 ? 1 : -1, x = sd * (4.9 + rnd() * 0.5), za = S + 12 + rnd() * 30, zb = Math.min(za + 40 + rnd() * 50, N - 12);
    person(`walker${i}`, someone(lineages[i % lineages.length], i + 3), x, za + rnd() * (zb - za), 0, 'idle', { z0: za, z1: zb, dir: rnd() < 0.5 ? 1 : -1, speed: 1.1 + rnd() * 0.5 });
  }

  // the side streets: people at the shopfronts, window shopping and talking
  sideStreets.forEach((st, si) => {
    const poses: CrewPose[] = ['idle', 'idle', 'write', 'idle', 'idle', 'write'];
    for (let j = 0; j < 6; j++) {
      const d = FRONT + 14 + j * 5.2, dz = j % 2 ? 1 : -1, z = (dz > 0 ? st.z0 : st.z1) - dz * 1.3;
      person(`group_ss${si}_${j}`, someone(lineages[(si * 2 + j) % lineages.length], 100 + si * 7 + j), st.side * d, z, dz > 0 ? 0 : Math.PI, poses[j]);
    }
  });
  // the squares: a pair talking by the landmark, someone sat on a bench, a couple taking a photo
  plazas.forEach((pz, pi) => {
    const sd = Math.sign(pz.x), poses: [number, number, number, CrewPose][] = [[-2.2, 4.2, 0, 'idle'], [-2.2, 5.6, Math.PI, 'idle'], [-4, 5, sd > 0 ? -Math.PI / 2 : Math.PI / 2, 'sit'], [3, -5, 0.8, 'selfie'], [3.8, -5.6, 0.6, 'idle']];
    poses.forEach(([dx, dz, yaw, pose], j) => person(`group_sq${pi}_${j}`, someone(lineages[(pi * 3 + j) % lineages.length], 80 + pi * 5 + j), pz.x - sd * dx, pz.z + dz, yaw, pose));
  });

  // ---- props. Each model has two builds (tools/lod_city.py): the scan, and a light one of about an eighth of its
  // triangles. Per stretch of street, the light builds of every model there are baked into ONE mesh on a shared
  // texture atlas (one draw for a whole stretch's lamps, shutters, crates, chairs and fruit); within PROP_NEAR metres
  // that mesh gives way to the scans (instanced, a draw per model part). Phones only ever draw the merged meshes.
  // As separate instanced models they were 600 draws looking down the street.
  const instanced = (src: THREE.Object3D, at: THREE.Matrix4[], host: THREE.Object3D = oldTown) => {
    src.updateMatrixWorld(true);
    const out: THREE.InstancedMesh[] = [];
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const im = new THREE.InstancedMesh(m.geometry, m.material, at.length);
      at.forEach((w, i) => im.setMatrixAt(i, TMP_M.multiplyMatrices(w, m.matrixWorld)));
      im.castShadow = im.receiveShadow = true; im.userData.ground = false; im.userData.prop = true; im.matrixAutoUpdate = false;
      im.computeBoundingSphere(); host.add(im); out.push(im);
    });
    return out;
  };
  const buildProps = (placed: Map<string, { name: string; at: THREE.Matrix4[] }>, host: THREE.Object3D, old: boolean) => {
    const names = [...new Set([...placed.values()].map((e) => e.name))];
    type Loaded = [string, THREE.Object3D | null, THREE.Object3D | null];
    const load = (n: string): Promise<Loaded> => model(`${n}.lod1`).catch(() => null).then((far): Loaded | Promise<Loaded> => (tier === 0 && far ? [n, null, far] : model(n).then((near): Loaded => [n, near, far])));
    void Promise.all(names.map((n) => load(n).catch((): Loaded | null => null))).then((list) => {
      const TILE = tier === 0 ? 256 : 512, COLS = 8;
      const cv = document.createElement('canvas'); cv.width = cv.height = TILE * COLS;
      const g2 = cv.getContext('2d')!; g2.fillStyle = '#ffffff'; g2.fillRect(0, 0, TILE, TILE);
      const tileOf = new Map<unknown, number>(); let nTiles = 1;
      type Part = { geo: THREE.BufferGeometry; base: THREE.Matrix4; tile: number; uvm: THREE.Matrix3 | null; col: THREE.Color };
      const farParts = new Map<string, Part[]>(), nearOf = new Map<string, THREE.Object3D>(), small = new Map<string, boolean>();
      const V2 = new THREE.Vector2();
      for (const e of list) {
        if (!e) continue;
        const [n, near, far] = e;
        if (near) nearOf.set(n, near);
        let r = 0; (near ?? far)!.updateMatrixWorld(true);
        (near ?? far)!.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); r = Math.max(r, m.geometry.boundingSphere!.radius * m.matrixWorld.getMaxScaleOnAxis()); } });
        small.set(n, r < SMALL_PROP);
        if (!far) continue;
        far.updateMatrixWorld(true);
        const parts: Part[] = []; let ok = true;
        far.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !ok) return;
          const mat = m.material as THREE.MeshStandardMaterial, map = mat.map, img = map?.image as CanvasImageSource | undefined;
          let tile = 0, uvm: THREE.Matrix3 | null = null;
          if (map && img) {
            map.updateMatrix(); uvm = map.matrix.clone();
            // only textures used once across (no tiling) can live in an atlas
            const uv = m.geometry.attributes.uv as THREE.BufferAttribute | undefined;
            if (!uv) { ok = false; return; }
            for (let i = 0; i < uv.count; i += 7) { V2.fromBufferAttribute(uv, i).applyMatrix3(uvm); if (V2.x < -0.02 || V2.x > 1.02 || V2.y < -0.02 || V2.y > 1.02) { ok = false; return; } }
            const key = (map.source as unknown) ?? map;
            let t = tileOf.get(key);
            if (t === undefined) {
              if (nTiles >= COLS * COLS) { ok = false; return; }
              t = nTiles++; tileOf.set(key, t);
              try { g2.drawImage(img, (t % COLS) * TILE, Math.floor(t / COLS) * TILE, TILE, TILE); } catch { ok = false; return; }
            }
            tile = t;
          }
          parts.push({ geo: m.geometry, base: m.matrixWorld.clone(), tile, uvm, col: mat.color.clone() });
        });
        if (ok && parts.length) farParts.set(n, parts);
      }
      const atlas = new THREE.CanvasTexture(cv); atlas.colorSpace = THREE.SRGBColorSpace; atlas.flipY = false; atlas.anisotropy = tier === 0 ? 2 : 8; atlas.generateMipmaps = true;
      const atlasM = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.82, metalness: 0.05, alphaTest: 0.5 });
      // one merged mesh per stretch (and, on phones, one more for its small things, shown only close by)
      const byCell = new Map<string, { name: string; at: THREE.Matrix4[] }[]>();
      for (const [key, e] of placed) { const c = key.slice(key.indexOf('|') + 1); (byCell.get(c) ?? byCell.set(c, []).get(c)!).push(e); }
      const P = new THREE.Vector3(), Nn = new THREE.Vector3(), M = new THREE.Matrix4(), inset = 0.5 / TILE;
      const bake = (entries: { name: string; at: THREE.Matrix4[] }[]) => {
        let nv = 0, ni = 0;
        for (const e of entries) for (const pt of farParts.get(e.name)!) { nv += pt.geo.attributes.position.count * e.at.length; ni += (pt.geo.index ? pt.geo.index.count : pt.geo.attributes.position.count) * e.at.length; }
        if (!nv) return null;
        const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
        let v = 0, k = 0;
        for (const e of entries) for (const pt of farParts.get(e.name)!) {
          const gp = pt.geo.attributes.position as THREE.BufferAttribute, gn = pt.geo.attributes.normal as THREE.BufferAttribute | undefined, gu = pt.geo.attributes.uv as THREE.BufferAttribute | undefined, gi = pt.geo.index;
          const tx = pt.tile % COLS, ty = Math.floor(pt.tile / COLS);
          for (const w of e.at) {
            M.multiplyMatrices(w, pt.base);
            const v0 = v;
            for (let i = 0; i < gp.count; i++, v++) {
              P.fromBufferAttribute(gp, i).applyMatrix4(M); pos[v * 3] = P.x; pos[v * 3 + 1] = P.y; pos[v * 3 + 2] = P.z;
              if (gn) Nn.fromBufferAttribute(gn, i).transformDirection(M); else Nn.set(0, 1, 0);
              nor[v * 3] = Nn.x; nor[v * 3 + 1] = Nn.y; nor[v * 3 + 2] = Nn.z;
              if (gu && pt.uvm) V2.fromBufferAttribute(gu, i).applyMatrix3(pt.uvm); else V2.set(0.5, 0.5);
              uvs[v * 2] = (tx + inset + Math.min(1, Math.max(0, V2.x)) * (1 - 2 * inset)) / COLS; uvs[v * 2 + 1] = (ty + inset + Math.min(1, Math.max(0, V2.y)) * (1 - 2 * inset)) / COLS;
              col[v * 3] = pt.col.r; col[v * 3 + 1] = pt.col.g; col[v * 3 + 2] = pt.col.b;
            }
            if (gi) for (let i = 0; i < gi.count; i++) idx[k++] = v0 + gi.getX(i); else for (let i = 0; i < gp.count; i++) idx[k++] = v0 + i;
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere(); g.computeBoundingBox();
        const mesh = new THREE.Mesh(g, atlasM); mesh.castShadow = tier === 2; mesh.receiveShadow = true; mesh.userData.ground = false; mesh.userData.prop = true; mesh.matrixAutoUpdate = false;
        mesh.userData.bakeOf = [...new Set(entries.map((e) => e.name))].join(',');
        host.add(mesh); return mesh;
      };
      for (const entries of byCell.values()) {
        const mergeable = entries.filter((e) => farParts.has(e.name)), rest = entries.filter((e) => !farParts.has(e.name) && nearOf.has(e.name));
        const far = bake(tier === 0 ? mergeable.filter((e) => !small.get(e.name)) : mergeable);
        const farSmall = tier === 0 ? bake(mergeable.filter((e) => small.get(e.name))) : null;
        const near = tier === 0 ? [] : mergeable.flatMap((e) => instanced(nearOf.get(e.name)!, e.at, host));
        const always = rest.flatMap((e) => instanced(nearOf.get(e.name)!, e.at, host));
        for (const im of near) im.visible = false;
        const box = new THREE.Box3();
        for (const o of [far, farSmall, ...near, ...always]) if (o) { const sp = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).boundingSphere! : o.geometry.boundingSphere!; box.expandByPoint(TMP_V.copy(sp.center).addScalar(sp.radius)); box.expandByPoint(TMP_V.copy(sp.center).addScalar(-sp.radius)); }
        const sph = box.getBoundingSphere(new THREE.Sphere());
        propCells.push({ c: sph.center, r: sph.radius * 0.6, near, far, farSmall, always, lod: 1, old });
      }
    }).catch((e) => console.warn('[city] props', e));
  };
  buildProps(placed, oldTown, true);
  const future = buildFuture(oldTown as unknown as THREE.Scene, { rich, N, S, FRONT, FLOOR, shops: SHOPS });
  blocks.push(...future.solids);
  const mega = buildMega(scene, { rich, N, S, FRONT, haze: HAZE });
  const dense = buildDense(oldTown as unknown as THREE.Scene, { top: scene, rich, FRONT, S, N, facades: facadesOut });
  // ---- the crowd crowdPool: real bodies that take over the painted crowd near the camera. A card closer than TAKE metres
  // is walked by a body from the crowd pool (the nearest first) and hidden; the body goes back when the card is far again.
  // Before this, the cards simply vanished within 9 m and the street emptied as you walked into it.
  const POOL = [2, 5, 12][tier], TAKE = 14;
  // a body of every look (two of each on Ultra): card i is only ever walked by a body of look i mod NLOOK
  const crowdPool: { fig: Character; card: number; phase: number; dx: number; look: number }[] = [];
  for (let i = 0; i < (tier === 2 ? 2 : 1) * NLOOK; i++) {
    const fig = someone(lineages[(i + 2) % lineages.length], i);
    fig.root.visible = false; fig.setGround((px) => hx(px)); add(fig.root);
    crowdPool.push({ fig, card: -1, phase: rnd() * 10, dx: 0, look: i % NLOOK });
  }
  const byCard = new Map<number, (typeof crowdPool)[number]>(), near: [number, number][] = [];
  let lastCam: THREE.Vector3 | null = null;
  const walkCrowd = (dt: number, time: number, cam: THREE.Camera, budget: number) => {
    lastCam = cam.position;
    const cards = dense.cards, taken = dense.taken, c = cam.position;
    near.length = 0;
    // a card in the lens (on the line from the camera to you) would be hidden as a body too: the body goes to the next one
    for (let i = 0; i < cards.length; i++) { const d = Math.hypot(cards[i].x - c.x, cards[i].z - c.z); if (d < TAKE * (taken[i] ? 1.15 : 1) && !inLens(cards[i].x, cards[i].z)) near.push([d, i]); }
    near.sort((a, b) => a[0] - b[0]);
    cardsNear = 0; for (const [d] of near) if (d < 10) cardsNear++;
    const want = new Set(near.slice(0, Math.min(POOL, budget)).map(([, i]) => i));
    for (const b of crowdPool) if (b.card >= 0 && !want.has(b.card)) { taken[b.card] = 0; byCard.delete(b.card); b.card = -1; b.fig.root.visible = false; }
    for (const i of want) if (!byCard.has(i)) { const b = crowdPool.find((x) => x.card < 0 && x.look === i % NLOOK); if (!b) continue; b.card = i; b.dx = 0; byCard.set(i, b); taken[i] = 1; b.fig.root.visible = true; }
    for (const b of crowdPool) {
      if (b.card < 0) continue;
      const q = cards[b.card], sp = Math.abs(q.v), yaw = q.v > 0 ? 0 : Math.PI;
      // nobody walks through you: a body about to reach you steps round (a card has no idea where you are)
      let want = 0;
      if (you) { const ahead = (you.position.z - q.z) * Math.sign(q.v || 1), ax = you.position.x - (q.x + b.dx); if (ahead > -0.6 && ahead < 2.6 && Math.abs(ax) < 1.1) want = -Math.sign(ax || 1) * 1.3; }
      b.dx += (want - b.dx) * (1 - Math.exp(-dt * 4));
      const bx = q.x + b.dx;
      b.fig.root.position.set(bx, hx(bx), q.z); b.fig.root.rotation.y = yaw;
      const hide = inLens(bx, q.z); if (b.fig.root.visible === hide) b.fig.root.visible = !hide;
      b.phase += dt * sp * 2.2;
      b.fig.animate(sp > 0.3 ? 'walk' : 'idle', b.phase, Math.min(1.1, sp / 3), time, dt);
    }
  };

  const moved = mergeStatic(scene, new Set<THREE.Object3D>([ground, skyMesh, ringLight, sun, sun.target, ...(linerG ? [linerG] : [])]), tier === 2 ? 39 : tier === 1 ? 117 : 400, (t) => { future.update(0.05, t); mega.update(0.05, t); dense.update(0.05, t, null); }, tier === 0);
  // ---- the rest of Zenvora: districts, traffic and people round the old town (districts.ts) ----
  const placedD = new Map<string, { name: string; at: THREE.Matrix4[] }>(), DCELL = tier === 0 ? 104 : 52;
  const placeD = (name: string, x: number, y: number, z: number, yaw: number, scale = 1) => {
    const key = `${name}|d${Math.floor(x / DCELL)}:${Math.floor(z / DCELL)}`;
    const e = placedD.get(key) ?? placedD.set(key, { name, at: [] }).get(key)!;
    e.at.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(scale, scale, scale)));
  };
  const dist = buildDistricts(scene, { rich, tier, place: placeD, paving, road: roadM, kerb: kerbM, label });
  blocks.push(...dist.solids);
  buildProps(placedD, scene, false);
  const day = dayCycle({ sky: skyMat, sun, hemi, fog: scene.fog as THREE.Fog, rich, scene });
  let envTex: THREE.Texture | null = null;
  const refreshEnv = () => {
    const r = Renderer.current?.renderer; if (!r) return;
    const env = new THREE.Scene(); env.add(envSky);
    const pm = new THREE.PMREMGenerator(r), t = pm.fromScene(env, 0.02, 0.1, 200).texture; pm.dispose();
    envTex?.dispose(); envTex = t; scene.environment = t;
  };
  // the grade by quarter: the bazaar warm, downtown cool, the bay a little teal
  const TINT = new THREE.Vector3(1, 1, 1), TW = new THREE.Vector3();
  const H = (x: number, z: number) => (inOld(x, z) ? hx(x) : dist.height(x, z));
  const nav = navGrid([DIST_BOUNDS[0], DIST_BOUNDS[1], DIST_BOUNDS[2], DIST_BOUNDS[3]], blocks, (x, z) => (H(x, z) < 0.07 ? 0.6 : 0));
  // the district's walkers drawn as real bodies near the camera (a pool), as cards further off
  const DPOOL = [2, 5, 12][tier], DNEAR = 30, CARD_FAR = [110, 170, 200][tier];
  dense.setFar(CARD_FAR);
  const dpool: { fig: Character; ped: number; phase: number; look: number }[] = [];
  for (let i = 0; i < (tier === 2 ? 2 : 1) * NLOOK; i++) {
    const fig = someone(lineages[(i + 4) % lineages.length], i);
    fig.root.visible = false; fig.setGround((px, pz) => H(px, pz ?? 0)); top(fig.root);
    dpool.push({ fig, ped: -1, phase: rnd() * 10, look: i % NLOOK });
  }
  const dnear: [number, number][] = [];
  const pedsAt = new THREE.Vector3(1e9, 0, 0); // where the camera was when the walkers were last drawn (crowdState)
  const drawPeds = (dt: number, time: number, cam: THREE.Camera, budget: number) => {
    const c = cam.position, ps = dist.peds;
    pedsAt.copy(c);
    dnear.length = 0;
    for (let i = 0; i < ps.length; i++) { const d = Math.hypot(ps[i].x - c.x, ps[i].z - c.z); if (d < CARD_FAR) dnear.push([d, i]); }
    dnear.sort((a, b) => a[0] - b[0]);
    const want = new Set<number>();
    const dcap = Math.min(DPOOL, budget);
    for (const [d, i] of dnear) { if (d > DNEAR || want.size >= dcap) break; want.add(i); }
    for (const b of dpool) if (b.ped >= 0 && !want.has(b.ped)) { b.ped = -1; b.fig.root.visible = false; }
    for (const i of want) if (!dpool.some((b) => b.ped === i)) { const b = dpool.find((x) => x.ped < 0 && x.look === i % NLOOK); if (b) { b.ped = i; b.fig.root.visible = true; } }
    const held = new Set(dpool.map((b) => b.ped));
    for (const b of dpool) {
      if (b.ped < 0) continue;
      const q = ps[b.ped], walking = q.mode === 'walk' || q.mode === 'cross';
      b.fig.root.position.set(q.x, H(q.x, q.z), q.z); b.fig.root.rotation.y = q.yaw;
      { const hide = inLens(q.x, q.z); if (b.fig.root.visible === hide) b.fig.root.visible = !hide; }
      // they notice you: within a few metres they look at you (and a walker steps round you, districts.ts)
      if (you && Math.hypot(you.position.x - q.x, you.position.z - q.z) < 4.5) b.fig.setLookTarget(eye.set(you.position.x, you.position.y + 1.6, you.position.z)); else b.fig.setLookTarget(null);
      b.phase += dt * (walking ? q.v * 2.2 : 1);
      b.fig.animate(walking ? 'walk' : q.mode === 'wait' ? 'idle' : (q.pose as CrewPose), b.phase, walking ? Math.min(1.1, q.v / 3) : 0, time, dt);
    }
    for (const [d, i] of dnear) { if (held.has(i) && d <= DNEAR * 1.2) continue; const q = ps[i]; if (d < 9 && inLens(q.x, q.z)) continue; stand.push({ x: q.x, y: H(q.x, q.z) + (q.pose === 'sit' ? -0.45 : 0), z: q.z, h: q.pose === 'sit' ? 1.3 : 1.72, k: 1e6 + i, yaw: q.yaw, walk: q.mode === 'walk' || q.mode === 'cross' }); }
  };

  // far people are pictures of real bodies (impostor.ts): eight townsfolk baked into one atlas while you are in the flat
  const bakeBodies = dpool.slice(0, NLOOK).map((b) => b.fig); // variant v of the atlas is look v
  // a row a frame in play (half a row on phones), so the bake never shows in the frame time; but normally it is all done
  // under the title card, before you arrive (prebake, called by Renderer.precompile)
  const makeBaker = () => impostorBaker(Renderer.current!.renderer, bakeBodies, tier === 0 ? [72, 128] : [124, 224], () => scene.environment, tier === 0 ? 4 : 8, tier === 0 ? 2 : 8, tier === 0 ? 14 : 7);
  scene.userData.prebake = async () => {
    const all = Promise.all(bakeBodies.map((b) => b.whenReady)).then(() => true);
    if (!(await Promise.race([all, new Promise<boolean>((r) => setTimeout(() => r(false), 6000))])) || !Renderer.current || bakeBodies.length < 4) return;
    baker ??= makeBaker();
    await Promise.all(bakeBodies.map((b) => b.whenReady)); // the baker counts them ready in its own callbacks, which run first
    for (let i = 0; i < 2000 && !baker.done; i++) if (baker.step()) dense.setAtlas(baker.texture, baker.cols, baker.rows, baker.variants, baker.views);
  };
  let baker: ReturnType<typeof impostorBaker> | null = null;
  // experimental (?probe=1), Web and Ultra: wet ground and glass reflect the street, not just the sky (probe.ts)
  let probe: ReturnType<typeof cityProbe> | null = null;
  const cardLight = new THREE.Color();

  // what never moves and shares a material is drawn by one InstancedBatch per material: one draw call per pass for, say,
  // every stretch of street's plaster, each stretch still culled on its own (core/ibatch.ts). The old town's in the old
  // town (it is hidden as a whole out in the districts), the districts' zones in the scene.
  if (BATCH.on) {
    const under = (o: THREE.Object3D, r: THREE.Object3D) => { for (let p = o.parent; p; p = p.parent) if (p === r) return true; return false; };
    batchStatic(oldTown, (m) => m.userData.ground !== true);
    batchStatic(scene, (m) => m.userData.ground !== true && !under(m, oldTown));
  }
  // inside the flat: only what the door and the window show (the moving things, the people and the sky always)
  const portals = flatPortals(scene, new THREE.Box3(new THREE.Vector3(FRONT + 0.15, -1, FLAT_Z0), new THREE.Vector3(FRONT + FLAT_D, 3.4, FLAT_Z1)), FRONT - 0.15,
    [[64.6, 66.2, FLOOR - 0.1, 2.2 + FLOOR], [68.0, 70.4, 1.14, 2.44], [73.2, 75.6, 1.14, 2.44]],
    (o) => moved.has(o) || !!o.userData.isCharacter || !!(o as unknown as { isBatchedMesh?: boolean }).isBatchedMesh || o === skyMesh || o === planet || ((o as THREE.InstancedMesh).isInstancedMesh && !o.userData.prop) || (o as THREE.Sprite).isSprite, () => scene.children.length + oldTown.children.length);
  // three.js walks every object of a scene each frame to refresh its matrix, moving or not (a fifth of a phone's frame
  // here): the scene and the old town walk only what can move
  skipStatic(oldTown); skipStatic(scene);
  sun.shadow.camera.layers.enable(1); // what the flat hides still casts its shadow
  scene.traverse((o) => { if (o !== ground && o.userData.ground === undefined) o.userData.ground = false; });
  // people stood in threes, talking, on the pavements
  const groups: [number, number][] = rich ? [[6.6, 38], [-6.4, 12], [6.4, -8], [-6.6, -36], [6.2, -58], [-3, -66], [3.5, -69], [-5.5, -71], [5.5, -73]] : [[6.6, 38], [-6.6, -36], [-3, -66]];
  // no stock emotes on a loop: they stand easy, look at whoever in the three is talking, and the talker's mouth moves
  const chats: { members: CityPerson[]; next: number; who: number }[] = [];
  groups.forEach(([x, z], gi) => {
    const members: CityPerson[] = [];
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * Math.PI * 2 + gi, px = x + Math.cos(a) * 0.75, pz = z + Math.sin(a) * 0.75;
      person(`group${gi}_${j}`, someone(lineages[(gi + j) % lineages.length], gi * 3 + j + 30), px, pz, Math.atan2(x - px, z - pz), 'idle');
      members.push(people[people.length - 1]);
    }
    chats.push({ members, next: Math.random() * 3, who: 0 });
  });

  // what a task uses up goes: the paratha is eaten, the jacket goes in the bag (both stayed where they were)
  const gone: Record<string, string> = { paratha: 'paratha', pack: 'jacket' };
  const tasks: AwayTask[] = TASKS.map((x) => ({ id: x.id, pos: new THREE.Vector3(x.x, hx(x.x), x.z), radius: x.r ?? 1.8, label: label(`city.task.${x.id}`), need: x.need,
    run: gone[x.id] ? () => { const o = scene.getObjectByName(gone[x.id]); if (o) o.visible = false; } : undefined }));
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

  // ---- the take-off: the six walk out through the gate to the terminal, the liner lifts off its pad and climbs over the
  // city towards the one in orbit. Three shots, about fourteen seconds; the camera is the game's own ----
  const OUTRO = 14;
  let outroT = -1, outroDone: (() => void) | null = null;
  const boarding = new Map<CityPerson, THREE.Vector3>();
  const plumes: THREE.Mesh[] = [];
  const eyeP = new THREE.Vector3(), aimP = new THREE.Vector3(), linerHome = new THREE.Vector3();
  const smooth = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  function startOutro(playerFig: Character | null, done: () => void) {
    outroT = 0; outroDone = done;
    const crew = people.filter((q) => FRIENDS.some((f) => f.id === q.id));
    const all: CityPerson[] = [...crew];
    if (playerFig) all.unshift({ id: 'player', fig: playerFig, pos: playerFig.root.position, yaw: 0, pose: 'idle', phase: 0 });
    // in a loose group at the gate, facing the spaceport (south, -z)
    all.forEach((q, i) => {
      q.pos.set(-2.6 + (i % 3) * 2.1 + (i > 2 ? 0.9 : 0), hx(0), S + 6.5 + Math.floor(i / 3) * 1.6);
      q.yaw = Math.PI; q.fig.root.rotation.y = Math.PI; q.fig.root.visible = true; q.fig.setLookTarget(null);
      boarding.set(q, new THREE.Vector3(q.pos.x * 0.6, 0, S - 16 - i * 0.8));
    });
    if (linerG) {
      linerHome.copy(linerG.position);
      if (!plumes.length) {
        const pm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fdcff).multiplyScalar(1.8), transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
        // lift jets under the fins, and the main drive at the stern
        for (const [px, py, pz, rx] of [[-11, -4, 16, Math.PI], [11, -4, 16, Math.PI], [-6, -6, -16, Math.PI], [6, -6, -16, Math.PI], [0, 0, -34, -Math.PI / 2]] as number[][]) {
          const c = new THREE.Mesh(new THREE.ConeGeometry(rx < 0 ? 4 : 1.8, rx < 0 ? 22 : 9, 16, 1, true), pm); c.position.set(px, py - (rx < 0 ? 0 : 4.5), pz + (rx < 0 ? -11 : 0)); c.rotation.x = rx; linerG.add(c); plumes.push(c);
        }
      }
    }
  }
  function endOutro() {
    if (outroT < 0) return;
    outroT = -1;
    const d = outroDone; outroDone = null; d?.();
  }
  function outro(dt: number, time: number, cam?: THREE.PerspectiveCamera) {
    outroT += dt;
    const T = outroT;
    // the six walk out through the gate and are gone into the terminal
    for (const [q, to] of boarding) {
      const dx = to.x - q.pos.x, dz = to.z - q.pos.z, d = Math.hypot(dx, dz);
      const v = T < 0.6 ? 0 : Math.min(1.35, d / Math.max(dt, 1e-3));
      if (d > 0.05) { q.pos.x += dx / d * v * dt; q.pos.z += dz / d * v * dt; }
      q.pos.y = hx(q.pos.x); q.phase += dt * v * 2.2;
      q.fig.root.rotation.y = Math.atan2(dx, dz);
      q.fig.animate(v > 0.1 ? 'walk' : 'idle', q.phase, v / 3, time, dt);
      if (q.pos.z < S - 8) q.fig.root.visible = false;
    }
    // the liner: the lift jets light, it rises off its pad, noses up and climbs away towards the one in orbit
    if (linerG) {
      const lift = smooth(4.2, 7, T), climb = Math.max(0, T - 7);
      linerG.position.set(linerHome.x - climb * climb * 0.8, linerHome.y + lift * 22 + climb * climb * 2.6, linerHome.z - climb * climb * 3.2);
      linerG.rotation.x = -smooth(6.5, 9.5, T) * 0.32;
      const jets = smooth(3.6, 4.6, T) * (1 + Math.sin(time * 40) * 0.08);
      for (let i = 0; i < plumes.length; i++) { const m = plumes[i]; (m.material as THREE.MeshBasicMaterial).opacity = (i === plumes.length - 1 ? smooth(6.8, 8, T) : jets * (1 - smooth(10, 12, T))) * 0.6; }
    }
    if (cam) {
      const L = linerG ? linerG.position : linerHome;
      if (T < 4.4) {
        // behind the group at the gate, the docked liner beyond them
        const k = smooth(0, 4.4, T);
        eyeP.set(4.5 - k * 2, 2.1 + k * 0.6, S + 13 - k * 3); aimP.set(4, 4 + k * 2, S - 40);
      } else if (T < 9.4) {
        // high over the apron, clear of the terminal's canopy: the whole liner on its pad as it lifts
        const k = smooth(4.4, 9.4, T);
        eyeP.set(linerHome.x - 38 + k * 3, linerHome.y + 22 + k * 2, linerHome.z + 30); aimP.set(L.x, L.y, L.z);
      } else {
        // over the street, the city lights below, the liner climbing away
        const k = smooth(9.4, OUTRO, T);
        eyeP.set(3, 26 + k * 10, 30 - k * 20); aimP.set(L.x * 0.7, L.y * 0.8, L.z * 0.85);
      }
      cam.position.copy(eyeP); cam.lookAt(aimP);
    }
    if (T >= OUTRO) endOutro();
  }

  return {
    outro: { start: startOutro, skip: endOutro, get active() { return outroT >= 0; }, get remaining() { return outroT >= 0 ? OUTRO - outroT : 0; } },
    // what the sky is doing, for the ears (soundscape.ts lays the rain bed under the street)
    get weather() { return { rain: day.state.rain, night: day.state.night }; },
    mapLayer: {
      id: 'zenvora', bounds: [DIST_BOUNDS[0] - 20, DIST_BOUNDS[1] - 6, DIST_BOUNDS[2] + 6, DIST_BOUNDS[3] + 6], pxPerM: 3, span: 80, northPlusZ: true,
      paint(g, X, Y) {
        g.fillStyle = '#1b1922'; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
        dist.paint(g, X, Y);
        const W = (x0: number, x1: number, z0: number, z1: number, c: string) => { g.fillStyle = c; g.fillRect(Math.min(X(x0), X(x1)), Math.min(Y(z0), Y(z1)), Math.abs(X(x1) - X(x0)), Math.abs(Y(z1) - Y(z0))); };
        W(-78, 78, S - 30, N + 4, '#1b1922');
        W(-FRONT, FRONT, S - 30, N + 2, '#8b8378'); // pavements
        W(-4, 4, S - 30, N + 2, '#3d3b44'); // the road
        g.fillStyle = '#e9dfc8'; for (let z = S; z < N; z += 6) W(-0.08, 0.08, z - 1.5, z + 1.5, '#e9dfc8');
        for (const f of facadesOut) W(f.side * FRONT, f.side * (FRONT + 12), f.z1 + 0.2, f.z0 - 0.2, f.h < 6 ? '#4a4556' : '#5d566c');
        for (const st of sideStreets) {
          const X2 = (d: number) => st.side * d, zc = (st.z0 + st.z1) / 2;
          W(X2(FRONT + 12), X2(FRONT + SIDE_L - 2), st.z0, st.z0 + 10, '#5d566c'); W(X2(FRONT + 12), X2(FRONT + SIDE_L - 2), st.z1 - 10, st.z1, '#5d566c');
          W(X2(FRONT), X2(FRONT + SIDE_L + 17), st.z1, st.z0, '#8b8378'); W(X2(FRONT + SIDE_L - 2), X2(FRONT + SIDE_L + 17), zc - 11, zc + 11, '#8b8378');
          W(X2(FRONT + SIDE_L + 17), X2(FRONT + SIDE_L + 21), zc - 17, zc + 17, '#5d566c'); W(X2(FRONT + SIDE_L - 1), X2(FRONT + SIDE_L + 17), zc + 11, zc + 17, '#5d566c'); W(X2(FRONT + SIDE_L - 1), X2(FRONT + SIDE_L + 17), zc - 17, zc - 11, '#5d566c');
          g.beginPath(); g.fillStyle = '#7fd8ff'; g.arc(X(X2(FRONT + SIDE_L + 8)), Y(zc), 10, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#f2ebdd'; g.fillText(label(st.side > 0 ? 'city.map.fountain' : 'city.map.statue'), X(X2(FRONT + SIDE_L + 8)), Y(zc) + 22);
        }
        W(FRONT, FRONT + FLAT_D, FLAT_Z0, FLAT_Z1, '#b39a6e'); // the flat
        W(-12, 12, S - 30, S - 1.5, '#6f6a62'); // the gate plaza
        W(-3, 3, S - 2.5, S - 0.5, '#e8a33d');
        g.font = '600 13px Barlow, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        for (const sh of SHOPS) { g.fillStyle = '#f2ebdd'; g.fillText(sh.name, X(sh.side * (FRONT + 6)), Y(sh.z)); }
        g.fillStyle = '#e8a33d'; g.fillText(label('city.map.gate'), X(0), Y(S - 14));
        g.fillStyle = '#14120e'; g.fillText(label('city.map.flat'), X(FRONT + FLAT_D / 2), Y(67.7));
      },
      // along the street: out of (or into) the flat by its door, then down the pavement or the road
      route(ax, az, bx, bz) {
        // anywhere off the bazaar itself: the city's grid router (pavements first, roads crossed at junctions)
        const street = (x: number, z: number) => Math.abs(x) < FRONT + FLAT_D && z > S - 2 && z < N + 2;
        if (!street(ax, az) || !street(bx, bz)) return nav.route(ax, az, bx, bz);
        const inFlat = (x: number, z: number) => x > FRONT && x < FRONT + FLAT_D && z > FLAT_Z0 && z < FLAT_Z1;
        const pts: [number, number][] = [[ax, az]];
        if (inFlat(ax, az) && !inFlat(bx, bz)) pts.push([FRONT + 0.8, 65.4], [FRONT - 1.2, 65.4]);
        const tail: [number, number][] = inFlat(bx, bz) && !inFlat(ax, az) ? [[FRONT - 1.2, 65.4], [FRONT + 0.8, 65.4]] : [];
        const [cx, cz] = pts[pts.length - 1], [ex, ez] = tail[0] ?? [bx, bz];
        if (Math.abs(ez - cz) > 4) { const lane = (cx < 0 ? -1 : 1) * Math.max(5.4, Math.min(6.8, Math.abs(cx))); /* the middle of the pavement, clear of the awnings and the stalls */ if (Math.abs(lane - cx) > 0.5) pts.push([lane, cz]); pts.push([lane, ez]); }
        return [...pts, ...tail, [bx, bz]];
      },
    },
    /** Test hook: how a person is drawn now: a body, a card standing in for one, or (never, within sight) nothing. */
    drawnAs(id: string) { const i = people.findIndex((q) => q.id === id); return i < 0 ? 'none' : people[i].fig.root.visible && oldTown.visible ? 'body' : stand.some((x) => x.k === i) ? 'card' : 'none'; },
    get perfState() { return { tier, bodyCap: BODY_CAP, oldTown: oldTown.visible, cards: stand.length, probe: (() => { try { return probe?.debug() ?? null; } catch { return 'unreadable'; } })(), envI: scene.environmentIntensity, hour: day.state.hour, exposure: day.state.exposure }; },
    /** Test hook (tools/traffic_smoke.py): the cars and the people, old town and districts, this frame. */
    trafficState() {
      const d = dist.traffic();
      const cars = [...d.cars, ...traffic.map((c) => [c.x, c.z, c.v > 0 ? 0 : Math.PI])];
      const peds = [...d.peds, ...dense.cards.map((q) => [q.x, q.z, 0]), ...people.filter((q) => q.fig.root.visible).map((q) => [q.pos.x, q.pos.z, 0])];
      return { cars, peds, old: oldTown.visible };
    },
    crowdState() {
      const cards = dense.cards, taken = dense.taken, c = lastCam;
      let nearN = 0, lost = 0;
      if (c) cards.forEach((q, i) => { if (Math.hypot(q.x - c.x, q.z - c.z) < TAKE) { nearN++; if (taken[i] && !(byCard.get(i)?.fig.root.visible) && !inLens(q.x, q.z)) lost++; } }); // someone cleared from the lens is not lost
      // the districts: every walker within 30 m of the camera is a body or a card, never nothing
      let dnear = 0, dlost = 0;
      dist.peds.forEach((q, i) => { if (Math.hypot(q.x - pedsAt.x, q.z - pedsAt.z) < 30) { dnear++; if (!dpool.some((b) => b.ped === i && b.fig.root.visible) && !stand.some((x) => x.k === 1e6 + i) && !inLens(q.x, q.z)) dlost++; } });
      return { near: nearN, bodies: crowdPool.filter((b) => b.card >= 0 && b.fig.root.visible).length, lost, room: bodiesLeft, dnear, dbodies: dpool.filter((b) => b.ped >= 0 && b.fig.root.visible).length, dlost };
    },
    scene, gravity: 22, jump: 6.2, spawn: new THREE.Vector3(12.4, FLOOR, 68.4), tasks, people, clearance,
    // the hero views: stepping out of the flat, and the run to the gate
    vistas: [{ x0: 4, x1: FRONT - 0.4, z0: 63, z1: 69, yaw: 0, pitch: 0.42, secs: 4 }, { x0: -8, x1: 8, z0: -40, z1: -30, yaw: 0, pitch: 0.3, secs: 3.5 }, { x0: -9, x1: 9, z0: -76, z1: -66, yaw: 0, pitch: 0.34, secs: 5 }],
    height: (x, z) => H(x, z),
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
      dist.carCollide(p, r);
      for (const c of traffic) { const dx = p.x - c.x; if (Math.abs(dx) < 0.95 + r && Math.abs(p.z - c.z) < 2.4 + r && p.y < 1.4) p.x = c.x + Math.sign(dx || 1) * (0.95 + r); }
      for (const q of people) { const dx = p.x - q.pos.x, dz = p.z - q.pos.z, dd = Math.hypot(dx, dz); if (dd < r + 0.3 && dd > 1e-6) { p.x = q.pos.x + dx / dd * (r + 0.3); p.z = q.pos.z + dz / dd * (r + 0.3); } }
    },
    bind(b) { you = b.root; /* no lineage tricks on the last normal day: the city only wants to know where you are */ },
    talk(id, seconds, listener) {
      const q = people.find((x) => x.id === id);
      if (!q) return;
      if (talking && talking.q !== q) talking.q.fig.setLookTarget(null);
      talking = { q, until: clock + seconds + 0.6, at: listener, rest: talking?.q === q ? talking.rest : q.yaw };
      q.fig.say(seconds);
    },
    update(dt, time, cam) {
      clock = time;
      shadowFrame++;
      if (talking) {
        // the one you spoke to turns to you (a little first, the head and eyes do the rest) and looks you in the eye
        const k = talking, q = k.q, on = time < k.until;
        const face = Math.atan2(k.at.x - q.pos.x, k.at.z - q.pos.z);
        const d = Math.atan2(Math.sin(face - k.rest), Math.cos(face - k.rest));
        const want = on ? k.rest + THREE.MathUtils.clamp(d, -1.4, 1.4) * 0.8 : k.rest;
        q.yaw += Math.atan2(Math.sin(want - q.yaw), Math.cos(want - q.yaw)) * (1 - Math.exp(-dt * 3));
        q.fig.root.rotation.y = q.yaw;
        if (on) q.fig.setLookTarget(eye.set(k.at.x, k.at.y + 1.62, k.at.z));
        else { q.fig.setLookTarget(null); if (Math.abs(q.yaw - k.rest) < 0.01) { q.yaw = k.rest; talking = null; } }
      }
      if (outroT >= 0) outro(dt, time, cam as THREE.PerspectiveCamera | undefined);
      // the old town is drawn only from inside it or close by (or from the air); deep inside it, the districts' streets,
      // cars and people are not
      let deep = false;
      if (cam) {
        const p = cam.position, north = Math.max(0, p.z - 82) * (Math.abs(p.x) < 14 ? 0.45 : 1); // down the north gate's road you see in from further
        const dOut = Math.hypot(Math.max(0, Math.abs(p.x) - 78), north);
        const on = outroT >= 0 || p.y > 40 || dOut < OLD_FAR * (oldTown.visible ? 1.15 : 1);
        if (on !== oldTown.visible) { oldTown.visible = on; shadowStale = true; }
        deep = outroT < 0 && p.y < 20 && Math.abs(p.x) < 48 && p.z < 52;
      }
      const oldOn = oldTown.visible;
      if (cam) { if (oldOn) portals(cam); walkCrowd(dt, time, cam, oldOn ? bodiesLeft : 0); }
      if (oldOn) drive(dt, time);
      dist.update(dt, time, cam ?? null, you ? you.position : null, deep);
      if (day.update(dt, time, cam ?? null) && !probe?.ready) refreshEnv();
      // wet streets mirror the signs and the windows (Ultra's screen-space reflections, renderer.ts): damp after the evening's wash, soaked in rain
      scene.userData.ssr = tier === 2 ? Math.min(1, 0.25 + FACADE.wet.value * 0.9 + 0.15 * day.state.night) : 0;
      if (tier > 0 && cam && Renderer.current && !NOPROBE) {
        probe ??= cityProbe(Renderer.current.renderer, scene, { size: tier === 2 ? 128 : 64, every: tier === 2 ? 5 : 14, hide: () => scene.children.filter((o) => o.userData.isCharacter) });
        const e = probe.step(cam.position);
        if (e) { envTex?.dispose(); envTex = null; scene.environment = e; }
      }
      Renderer.current?.setLook(day.state.exposure, day.state.bloom, day.state.threshold);
      // the cards take the light of the hour: the sky's fill and what is left of the sun
      cardLight.copy(hemi.color).multiplyScalar(hemi.intensity * 0.42).add(TMP_C.copy(sun.color).multiplyScalar(sun.intensity * 0.16)).addScalar(0.1 * day.state.night);
      dense.setLight(cardLight);
      if (!baker && Renderer.current && bakeBodies.length >= 4) baker = makeBaker();
      if (baker && !baker.done && baker.step()) dense.setAtlas(baker.texture, baker.cols, baker.rows, baker.variants, baker.views);
      poolM.opacity = 0.08 + 0.72 * day.state.night;
      if (cam) {
        skyMesh.position.copy(cam.position);
        const p = cam.position, k = 1 - Math.exp(-dt * 0.8);
        if (inOld(p.x, p.z)) TW.set(1.04, 1.0, 0.94); else if (p.x > 160) TW.set(0.96, 1.0, 1.05); else if (p.x < -200) TW.set(0.95, 1.02, 1.03); else if (p.z > 190) TW.set(0.98, 1.03, 0.96); else TW.set(1.0, 1.0, 1.0);
        TINT.lerp(TW, k);
        const f = Renderer.current?.final.uniforms.uTint.value as THREE.Vector3 | undefined; f?.copy(TINT);
      }
      // props: the scans within PROP_NEAR of a stretch, its one merged mesh further off, nothing past the haze
      if (cam && propTick++ % 6 === 0) for (const pc of propCells) {
        if (pc.old && !oldOn) continue;
        const d = !pc.old && deep ? 999 : pc.c.distanceTo(cam.position) - pc.r;
        // the scans themselves only on Ultra: on Web their light builds (an eighth of the triangles) are near enough
        const want = tier === 2 && pc.near.length && d < PROP_NEAR * (pc.lod === 0 ? 1.15 : 1) ? 0 : 1;
        if (want !== pc.lod) { pc.lod = want; for (const im of pc.near) im.visible = want === 0; }
        // in the old town's narrow streets a stretch of props further than a block or so is behind the walls anyway
        // the districts' bins, hydrants and service boxes are knee-high: past 90 m they are a pixel or two (a stretch of
        // them was tens of thousands of triangles drawn from across the city)
        if (pc.far) pc.far.visible = want === 1 && d < (!pc.old ? (tier === 0 ? 60 : 90) : tier === 0 ? 110 : tier === 1 ? 80 : 230);
        if (pc.farSmall) pc.farSmall.visible = d < SMALL_FAR;
        // props cast shadows on Ultra; on Web the scans' shadow pass was most of a frame's triangles in the bazaar (the
        // shadow is redrawn every other frame, so every other frame cost half as much again)
        const sh = d < 34 && tier === 2;
        if (want === 0) for (const im of pc.near) im.castShadow = sh;
        for (const im of pc.always) { im.castShadow = sh; im.visible = d < (!pc.old ? (tier === 0 ? 60 : 90) : tier === 0 ? 110 : 230); }
      }
      // townsfolk further off than CROWD_FAR are not drawn as bodies: a card of their height stands where they are, so
      // the street stays as full as it was and nobody blinks out. A body is a dozen draw calls and tens of thousands of
      // triangles (both passes); a hundred of them were most of a laptop GPU's frame.
      if (cam) {
        stand.length = 0;
        // a hard cap on real bodies (BODY_CAP): the friends and whoever is nearest are bodies, everyone else a card
        const cp = cam.position; let used = 0, nc = 0;
        lens.on = !!you && outroT < 0; lens.cx = cp.x; lens.cz = cp.z; if (you) { lens.px = you.position.x; lens.pz = you.position.z; }
        if (oldOn) for (let i = 0; i < people.length; i++) {
          const q = people[i];
          if (boarding.has(q) || talking?.q === q) { if (!q.fig.root.visible) q.fig.root.visible = true; used++; continue; }
          if (q.walk?.shop?.stage === 'inside') { if (q.fig.root.visible) q.fig.root.visible = false; continue; }
          const d = Math.hypot(q.pos.x - cp.x, q.pos.z - cp.z);
          if (d < 9 && inLens(q.pos.x, q.pos.z)) { if (q.fig.root.visible) q.fig.root.visible = false; continue; }
          // the six of the story and Mir have no card of their own look: they stay themselves (a body) out to 48 m
          if (d >= CROWD_FAR && !crowd.has(q.fig)) { const v = tier > 0 && d < 48; /* a body to 48 m (they have no card of their own look); phones: only within the card range */ if (q.fig.root.visible !== v) q.fig.root.visible = v; continue; }
          if (d >= CROWD_FAR) { if (q.fig.root.visible) q.fig.root.visible = false; stand.push({ x: q.pos.x, y: q.pos.y, z: q.pos.z, h: 1.72, k: i, v: lookOf.get(q.fig), yaw: q.yaw, walk: !!q.walk }); continue; }
          // the six of the story (and Mir) are never a card within speaking distance, whatever the cap
          const dy = you ? Math.hypot(q.pos.x - you.position.x, q.pos.z - you.position.z) : 99;
          // the six of the story and Mir have no card of their own look, so they are never a card: a body out to the card range
          if (!crowd.has(q.fig)) { if (!q.fig.root.visible) q.fig.root.visible = true; used++; continue; }
          // whoever is drawn now holds on a little, the six of the story come first, and then anyone at your elbow (a
          // card reads as cardboard at arm's length), all within the cap
          const key = d - (q.fig.root.visible ? 1.5 : 0) - (crowd.has(q.fig) ? 0 : 5) - (tier > 0 && dy < 4 ? 30 : 0);
          let j = nc++; while (j > 0 && candK[j - 1] > key) { candK[j] = candK[j - 1]; candI[j] = candI[j - 1]; j--; }
          candK[j] = key; candI[j] = i;
        }
        else for (const q of people) if (q.fig.root.visible && !boarding.has(q)) q.fig.root.visible = false;
        // the painted crowd right beside you comes before a townsperson thirty metres off: up to half the bodies are
        // kept for it while it is within reach
        const cap = outroT >= 0 ? 99 : BODY_CAP - Math.min(Math.floor(BODY_CAP / 2), cardsNear);
        for (let j = 0; j < nc; j++) {
          // whoever is at your elbow is a body even when the cap is spent (two over it at most)
          const q = people[candI[j]], show = used < cap || (j < 2 && candK[j] < -20);
          if (show) used++; else stand.push({ x: q.pos.x, y: q.pos.y, z: q.pos.z, h: 1.72, k: candI[j], v: lookOf.get(q.fig), yaw: q.yaw, walk: !!q.walk });
          if (show !== q.fig.root.visible) q.fig.root.visible = show;
        }
        bodiesLeft = Math.max(0, (outroT >= 0 ? 99 : BODY_CAP) - used);
        if (!deep) drawPeds(dt, time, cam, Math.max(0, bodiesLeft - crowdPool.reduce((n, b) => n + (b.card >= 0 ? 1 : 0), 0))); else for (const b of dpool) if (b.ped >= 0) { b.ped = -1; b.fig.root.visible = false; }
        dense.standIns(stand, cam);
        // a soft contact shadow under every body that casts none of its own (the crowd: CHAR_BUDGET.crowdShadowFar)
        let nb = 0;
        const blob = (x: number, z: number) => { if (nb < BLOBS) blobs.setMatrixAt(nb++, BM.makeTranslation(x, H(x, z) + 0.02, z)); };
        if (oldOn) for (const q of people) if (q.fig.root.visible && (tier === 0 || crowd.has(q.fig))) blob(q.pos.x, q.pos.z);
        if (tier === 0 && you) blob(you.position.x, you.position.z);
        for (const b of crowdPool) if (b.card >= 0 && b.fig.root.visible) blob(b.fig.root.position.x, b.fig.root.position.z);
        for (const b of dpool) if (b.ped >= 0 && b.fig.root.visible) blob(b.fig.root.position.x, b.fig.root.position.z);
        blobs.count = nb; blobs.instanceMatrix.needsUpdate = true;
      }
      // the sun's shadow covers the ground round the camera, not the whole street: snapped to its texels, so it never
      // swims, and moved only on frames that redraw it
      if (cam) {
        const sc = sun.shadow.camera, texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
        cam.getWorldDirection(SHV); SHC.copy(cam.position).addScaledVector(SHV.setY(0).normalize(), SHADOW_R * (tier === 0 ? 0.3 : 0.55));
        SHC.x = Math.round(SHC.x / texel) * texel; SHC.z = Math.round(SHC.z / texel) * texel; SHC.y = 0;
        // Ultra: every frame. Web: every other. Phones: the shadow is static (nothing that moves casts one there: bodies
        // and cars get contact shadows), redrawn when the camera has gone 9 m, and now and then for the sun
        const due = tier === 2 || (tier === 1 ? shadowFrame % 2 === 0 : shadowStale || SHC.distanceTo(sun.target.position) > 9 || shadowFrame % 300 === 0 || (shadowFrame < 900 && shadowFrame % 45 === 0));
        if (due) {
          sun.target.position.copy(SHC); sun.position.copy(SHC).addScaledVector((sun.userData.dir as THREE.Vector3 | undefined) ?? SUN_OFF.clone().normalize(), 90);
          if (tier < 2) sun.shadow.needsUpdate = true;
          shadowStale = false;
        }
      }
      if (oldOn) for (const q of people) {
        if (boarding.has(q)) continue;
        const w = q.walk;
        if (w && (w.shop || (shopDoors.length && time > (w.nextShop ?? (w.nextShop = time + 8 + (q.phase * 7.3) % 20))))) {
          // a walker going shopping: across the pavement to the nearest open door on their side, inside for a while,
          // then back out to where they were walking
          if (!w.shop) {
            const home = w.home ?? (w.home = q.pos.x), sd = Math.sign(home);
            const door = shopDoors.find((d) => d.side === sd && (d.z - q.pos.z) * w.dir > 0.5 && (d.z - q.pos.z) * w.dir < 2.5);
            if (door) w.shop = { x: door.x, z: door.z, t: 0, stage: 'in' };
            else w.nextShop = time + 1.5; // none just ahead: look again in a moment
          }
          const sh = w.shop;
          if (!sh) { q.pos.z += w.dir * w.speed * dt; if (q.pos.z > w.z1) w.dir = -1; else if (q.pos.z < w.z0) w.dir = 1; }
          else if (sh.stage === 'inside') { sh.t -= dt; if (sh.t <= 0) { sh.stage = 'out'; q.fig.root.visible = true; } }
          else {
            const tx = sh.stage === 'in' ? sh.x : w.home!, tz = sh.stage === 'in' ? sh.z : q.pos.z;
            const dx = tx - q.pos.x, dz = tz - q.pos.z, dd = Math.hypot(dx, dz), stp = Math.min(dd, w.speed * 0.8 * dt);
            if (dd > 0.02) { q.pos.x += (dx / dd) * stp; q.pos.z += (dz / dd) * stp; const want = Math.atan2(dx, dz); q.yaw += Math.atan2(Math.sin(want - q.yaw), Math.cos(want - q.yaw)) * (1 - Math.exp(-dt * 6)); }
            if (dd < 0.08) {
              if (sh.stage === 'in') { sh.stage = 'inside'; sh.t = 6 + (q.phase * 3.7) % 10; q.fig.root.visible = false; }
              else { w.shop = undefined; w.nextShop = time + 25 + (q.phase * 5.1) % 30; }
            }
          }
          q.pos.y = hx(q.pos.x); q.fig.root.rotation.y = q.yaw; q.phase += dt * w.speed * 2.2;
          if (sh?.stage !== 'inside') q.fig.animate(sh ? 'walk' : 'walk', q.phase, Math.min(1.1, (sh ? 0.8 : 1) * w.speed / 3), time, dt);
        } else if (w) {
          q.pos.z += w.dir * w.speed * dt;
          if (q.pos.z > w.z1) w.dir = -1; else if (q.pos.z < w.z0) w.dir = 1;
          // someone in the way: step aside (towards the wall or the kerb, away from you), and back once past
          if (you) {
            const dz = (you.position.z - q.pos.z) * w.dir, dx = you.position.x - q.pos.x;
            const side = w.home ?? (w.home = q.pos.x);
            const want = dz > -0.5 && dz < 3.2 && Math.abs(dx) < 1.1 ? side - Math.sign(dx || 1) * 1.2 : side;
            q.pos.x += (want - q.pos.x) * (1 - Math.exp(-dt * 4));
          }
          const want = w.dir > 0 ? 0 : Math.PI; q.yaw += Math.atan2(Math.sin(want - q.yaw), Math.cos(want - q.yaw)) * (1 - Math.exp(-dt * 5));
          q.pos.y = hx(q.pos.x); q.fig.root.rotation.y = q.yaw; q.phase += dt * w.speed * 2.2;
          q.fig.animate('walk', q.phase, Math.min(1.1, w.speed / 3), time, dt);
        } else {
          q.phase += dt;
          // you walk up: they look at you, and the first time you come close they wave (once: a greeting, not a loop)
          if (you && talking?.q !== q) {
            const d = Math.hypot(you.position.x - q.pos.x, you.position.z - q.pos.z);
            if (d < 4) { q.fig.setLookTarget(eye.set(you.position.x, you.position.y + 1.6, you.position.z)); if (!q.met) { q.met = true; q.greet = time + 1.6; } }
            else if (d > 5 && q.met !== undefined) {
              // the threes on the pavement go back to each other at their next turn to talk (chats, below)
              if (!q.id.startsWith('group')) q.fig.setLookTarget(null);
              if (d > 9) q.met = false;
            }
          }
          const pose = q.greet && time < q.greet && !FRIENDS.some((f) => f.id === q.id) ? 'wave' : q.pose;
          q.fig.animate(pose, q.phase, 0, time, dt);
        }
      }
      // the threes on the pavement take turns: one talks a few seconds, the other two look at them
      if (oldOn) for (const c of chats) {
        if (time < c.next) continue;
        c.who = (c.who + 1 + Math.floor(Math.random() * 2)) % 3;
        const dur = 1.6 + Math.random() * 2.6, talker = c.members[c.who];
        c.next = time + dur + 0.3 + Math.random() * 0.8;
        talker.fig.say(dur);
        talker.fig.setLookTarget(eye.copy(c.members[(c.who + 1) % 3].pos).setY(c.members[(c.who + 1) % 3].pos.y + 1.6).clone());
        for (const m of c.members) if (m !== talker) m.fig.setLookTarget(talker.pos.clone().setY(talker.pos.y + 1.6));
      }
      if (oldOn) { ringLight.rotation.z += dt; future.update(dt, time); }
      mega.update(dt, time);
      dense.update(dt, time, cam ?? null, oldOn);
    },
    dispose() { CHAR_BUDGET.shadowFar = SHADOW_FAR0; Renderer.current?.setLook(); (Renderer.current?.final.uniforms.uTint.value as THREE.Vector3 | undefined)?.set(1, 1, 1); envTex?.dispose(); baker?.dispose(); probe?.dispose(); scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); },
  };
}
