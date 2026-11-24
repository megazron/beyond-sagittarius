import * as THREE from 'three';
import { twoFaced } from '../../core/textfaces';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { facadeMaterial, facadeBox, FACADE } from './facade';
import { broadCrown, CROWN_LODS } from '../../world/foliage';
import { loadTexture } from '../../core/assets';
import { fitCanvasText } from '../../core/canvastext';
import { carKit } from './cars';

/**
 * Zenvora beyond the bazaar: a real street grid round the old town. Downtown towers to the east, a market quarter and
 * the waterfront to the west, flats and a park to the north, joined to the bazaar through its two squares and the old
 * town's north gate. Roads have two lanes each way (left-hand traffic, as in the bazaar), kerbs, zebra crossings and
 * signals; the pavements have lamps, trees, benches, bins, shelters and shop signs (original names only).
 *
 * Buildings are boxes drawn by the facade shader (facade.ts): every building of a zone is one draw per wall finish,
 * always there, so the skyline never pops. What is small (furniture, signs, trees) is built per zone too and shown only
 * within reach. The people and the traffic live here as well: the walkers loop the blocks, cross at the zebras when the
 * signal lets them, sit, shop, chat and look at their phones; the cars follow their lanes, turn at junctions, stop at
 * red lights and for anyone on a crossing (you too).
 *
 * Ground is exact by construction: `height` is the one function both the player and the meshes use (0 on a road, the
 * pavement 14 cm up, a 35 cm ramp at every kerb).
 */

export const FLOOR = 0.14, KERB = 0.35, PAVE = 4;
export interface Road { along: 'x' | 'z'; c: number; a: number; b: number; hw: number; cars: boolean }
export type BlockKind = 'tower' | 'mid' | 'market' | 'water' | 'res' | 'park' | 'fill';
export interface Block { x0: number; x1: number; z0: number; z1: number; kind: BlockKind }

const AVE_E = [90, 170, 250, 330], AVE_W = [-90, -170, -250], ROWS = [-90, -10, 70, 150, 230, 310];
export const ROADS: Road[] = [
  ...AVE_E.map((c) => ({ along: 'z' as const, c, a: -90, b: 310, hw: 6, cars: true })),
  ...AVE_W.map((c) => ({ along: 'z' as const, c, a: -90, b: 310, hw: 6, cars: true })),
  { along: 'z', c: 0, a: 110, b: 190, hw: 6, cars: true },
  { along: 'z', c: 0, a: 78, b: 110, hw: 4, cars: false }, // the bazaar's own road running on out of the north gate
  ...ROWS.slice(0, 5).flatMap((c) => [{ along: 'x' as const, c, a: 90, b: 330, hw: 6, cars: true }, { along: 'x' as const, c, a: -250, b: -90, hw: 6, cars: true }]),
  { along: 'x', c: 110, a: -90, b: 90, hw: 6, cars: true },
  { along: 'x', c: 190, a: -90, b: 90, hw: 6, cars: true },
  { along: 'x', c: 310, a: -250, b: 330, hw: 6, cars: true },
];

export const BLOCKS: Block[] = [];
for (let r = 0; r < 5; r++) {
  const z0 = ROWS[r], z1 = ROWS[r + 1];
  BLOCKS.push({ x0: 90, x1: 170, z0, z1, kind: 'mid' }, { x0: 170, x1: 250, z0, z1, kind: 'tower' }, { x0: 250, x1: 330, z0, z1, kind: 'tower' });
  BLOCKS.push({ x0: -170, x1: -90, z0, z1, kind: 'market' }, { x0: -250, x1: -170, z0, z1, kind: 'water' });
}
BLOCKS.push({ x0: -90, x1: 0, z0: 110, z1: 190, kind: 'res' }, { x0: 0, x1: 90, z0: 110, z1: 190, kind: 'res' }, { x0: -90, x1: 90, z0: 190, z1: 310, kind: 'park' });
/** Pavement that is not a block: along the old town's edges and in front of the north gate. */
const STRIPS: Block[] = [
  { x0: 72.5, x1: 90, z0: -90, z1: 110, kind: 'fill' }, { x0: -90, x1: -72.5, z0: -90, z1: 110, kind: 'fill' },
  { x0: -72.5, x1: 72.5, z0: 82, z1: 110, kind: 'fill' },
  // the waterfront promenade and the far kerbs
  { x0: -281, x1: -250, z0: -96, z1: 316, kind: 'fill' },
  { x0: 330, x1: 340, z0: -96, z1: 316, kind: 'fill' }, { x0: -250, x1: 330, z0: 310, z1: 320, kind: 'fill' },
  { x0: 84, x1: 336, z0: -100, z1: -90, kind: 'fill' }, { x0: -256, x1: -84, z0: -100, z1: -90, kind: 'fill' },
];
/** The walkable city: the old town is inside `inOld`. */
export const BOUNDS: [number, number, number, number] = [-300, -104, 344, 324];
export const inOld = (x: number, z: number) => Math.abs(x) < 78 && z < 82;

/** Distance from a point to a road's centre line (out to its ends, square-capped). */
function roadDist(r: Road, x: number, z: number) {
  const [u, v] = r.along === 'z' ? [z, x] : [x, z];
  const du = u < r.a ? r.a - u : u > r.b ? u - r.b : 0;
  return Math.max(Math.abs(v - r.c), du > 0 ? du + r.hw - 0.001 : 0) - r.hw; // <= 0 on the road
}
/** Ground height off the old town: 0 on a road, FLOOR on the pavement, a ramp at the kerb. */
export function districtHeight(x: number, z: number) {
  let d = 99;
  for (const r of ROADS) { const k = roadDist(r, x, z); if (k < d) d = k; }
  if (x < -281) return -1.4; // the bay
  return d <= 0 ? 0 : d >= KERB ? FLOOR : FLOOR * d / KERB;
}

let seed = 77;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; fitCanvasText(c.getContext('2d')!, draw);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/** Original names only: shops, banks, hotels and screens of Zenvora. */
/**
 * What each shop sells decides what is behind its glass (the facade shader draws one of five interiors: 0 clothes rails,
 * 1 a cafe or kitchen, 2 shelves of goods, 3 a bright counter, 4 a bright shop with shelves) and whether it puts tables
 * out on the pavement (only places that serve food).
 */
const BRANDS: [string, string, string, number][] = [
  ['NOVA NOODLES', '#ffcf5a', '#1a1206', 1], ['KESARI KITCHEN', '#ff9a3c', '#1e0a02', 1], ['ORBITAL OPTICS', '#9fe2ff', '#06121e', 3], ['PULSAR PHARMACY', '#6effc0', '#041a10', 4],
  ['COMET COFFEE', '#f2d3a0', '#2a1406', 1], ['TARAVEL TELECOM', '#ff5d8f', '#1e0612', 3], ['ZENVORA BANK', '#f4f4f6', '#14233d', 3], ['HALO HOTEL', '#ffe8b0', '#2a1c08', 3],
  ['MERIDIAN MART', '#b6ff6e', '#0e1a04', 2], ['DRIFT DENIM', '#7fb6ff', '#060e1e', 0], ['SAFFRON SKY', '#ffb347', '#1e0e04', 3], ['NEON NAAN', '#ff6ec7', '#1e0616', 1],
  ['STARDUST SALON', '#e3b6ff', '#14061e', 3], ['QUASAR GAMES', '#6ef7ff', '#041618', 2], ['LOTUS LAUNDRY', '#ffc0d8', '#1e0a12', 3], ['VEGA VISION', '#ffffff', '#101418', 3],
  ['ATLAS BOOKS', '#f2e6c8', '#2a2014', 2], ['MANGO MOON', '#ffd36e', '#1a1204', 1], ['ROCKET RICKSHAW', '#ff7b54', '#1a0804', 3], ['SKYLINE GYM', '#9fd8ff', '#06101a', 3],
  ['नोवा नूडल्स', '#ffcf5a', '#1a1206', 1], ['केसरी किचन', '#ff9a3c', '#1e0a02', 1], ['सितारा स्वीट्स', '#ff8fd0', '#1e0616', 4], ['चाँद कैफ़े', '#bfe9ff', '#0b1420', 1],
  ['ستارہ بیکری', '#ffd36e', '#1a1204', 4], ['چاند کیفے', '#9fd8ff', '#06101a', 1], ['زعفران ہوٹل', '#ffb347', '#1e0e04', 1], ['لوٹس لانڈری', '#ffc0d8', '#1e0a12', 3],
  ['ORBIT THREADS', '#ffd0a8', '#1e1008', 0], ['RINGWEAR', '#c8f0ff', '#081420', 0], ['सितारा फ़ैशन', '#ffb6e0', '#1e0816', 0], ['ستارہ ملبوسات', '#f2e6c8', '#1a1408', 0],
];
const ADS: [string, string, string, string][] = [
  ['ZENVORA BANK', 'Your savings, now in orbit', '#f4f4f6', '#14233d'], ['HALO HOTEL', 'Sleep above the rings', '#ffe8b0', '#2a1c08'],
  ['TARAVEL TELECOM', 'Six lineages. One signal.', '#ff5d8f', '#1e0612'], ['COMET COFFEE', 'Brewed at escape velocity', '#f2d3a0', '#2a1406'],
  ['नोवा नूडल्स', 'हर गली, हर ग्रह', '#ffcf5a', '#1a1206'], ['چاند کیفے', 'چائے، چاند کے نیچے', '#9fd8ff', '#06101a'],
  ['QUASAR GAMES', 'Level 99 is not a rumour', '#6ef7ff', '#041618'], ['SAFFRON SKY', 'Liner tickets from 9,999', '#ffb347', '#1e0e04'],
];

export interface DistrictPerson { x: number; z: number; yaw: number; pose: string; speed: number; id: number }

export function buildDistricts(scene: THREE.Scene, o: { rich: boolean; tier: number; place: (name: string, x: number, y: number, z: number, yaw: number, scale?: number) => void; paving: THREE.Material; road: THREE.Material; kerb: THREE.Material; label: (k: string) => string }) {
  seed = 77;
  const { rich, tier } = o;
  // nothing built here moves as an object (cars and bulbs move by instance): no matrix refresh per frame
  const add = <T extends THREE.Object3D>(x: T) => { x.userData.ground = false; x.matrixAutoUpdate = false; x.updateMatrix(); scene.add(x); return x; };
  const solids: THREE.Box3[] = [];
  /** Roofs over the pavement (awnings, shelters): the follow camera stays under them (city.ts ceiling). */
  const covers: THREE.Box3[] = [];
  const solid = (x0: number, z0: number, x1: number, z1: number, h = 30) => solids.push(new THREE.Box3(new THREE.Vector3(Math.min(x0, x1), -2, Math.min(z0, z1)), new THREE.Vector3(Math.max(x0, x1), h, Math.max(z0, z1))));

  // ---- zones: 160 m squares; each holds its own merged meshes ----
  const ZONE = tier === 0 ? 320 : 160;
  const zones = new Map<string, { cx: number; cz: number; near: THREE.Object3D[]; walls?: THREE.Object3D[]; geo: Record<string, THREE.BufferGeometry[]> }>();
  const zoneOf = (x: number, z: number) => {
    const ix = Math.floor(x / ZONE), iz = Math.floor(z / ZONE), k = `${ix}:${iz}`;
    return zones.get(k) ?? zones.set(k, { cx: (ix + 0.5) * ZONE, cz: (iz + 0.5) * ZONE, near: [], geo: {} }).get(k)!;
  };
  // phones: one wall finish, and the metalwork and lamp heads drawn with the rest of the kit (a draw per kind per zone)
  const PHONE_KIND: Record<string, string> = { metal: 'kit', lamp: 'kit', trim: 'kit', wall_brick: 'wall_plaster', wall_glass: 'wall_plaster' };
  // the sills and cornices (trim) share the kit's material, its shadow and its reach: one draw with it, not two
  const put = (kind: string, x: number, z: number, g: THREE.BufferGeometry) => { const zn = zoneOf(x, z), k = tier === 0 ? PHONE_KIND[kind] ?? kind : kind === 'trim' ? 'kit' : kind; (zn.geo[k] ??= []).push(g); };

  // ---- materials ----
  const tex = (set: string, m: THREE.MeshStandardMaterial, size: '512' | '1k' = rich ? '1k' : '512') => {
    ((scene.userData.loads ??= []) as Promise<unknown>[]).push(Promise.all([loadTexture(`city/${set}`, 'diff', size), loadTexture(`city/${set}`, 'nor', size)]).then(([a, n]) => {
      const a2 = a.clone(), n2 = n.clone(); a2.wrapS = a2.wrapT = n2.wrapS = n2.wrapT = THREE.RepeatWrapping; a2.needsUpdate = n2.needsUpdate = true;
      m.map = a2; m.normalMap = n2; m.needsUpdate = true;
    }).catch(() => undefined));
  };
  const wallMats = { plaster: facadeMaterial({ tile: 3, simple: tier === 0 }), brick: facadeMaterial({ tile: 2.5 }), glass: facadeMaterial({ tile: 4, roughness: 0.55, shops: 0.9 }) };
  if (tier > 0) { tex('plaster', wallMats.plaster); tex('brick', wallMats.brick); tex('parapet', wallMats.glass, '512'); }
  const kitM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.2 });
  const metalM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.8 });
  const lampM = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe2b0, emissiveIntensity: 0.2, roughness: 0.4 });
  const markM = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const leafM = new THREE.MeshStandardMaterial({ vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.82, color: 0xb8d090 });
  void loadTexture('foliage', 'leaf', rich ? '1k' : '512').then((t) => { leafM.map = t; leafM.needsUpdate = true; }).catch(() => undefined);
  const grassM = new THREE.MeshStandardMaterial({ color: 0x7f9a52, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  void Promise.all([loadTexture('ground', 'diff', rich ? '1k' : '512'), loadTexture('ground', 'nor', rich ? '1k' : '512')]).then(([a, n]) => {
    const a2 = a.clone(), n2 = n.clone(); a2.wrapS = a2.wrapT = n2.wrapS = n2.wrapT = THREE.RepeatWrapping; a2.repeat.set(0.2, 0.2); n2.repeat.set(0.2, 0.2); a2.needsUpdate = n2.needsUpdate = true;
    grassM.map = a2; grassM.normalMap = n2; grassM.needsUpdate = true;
  }).catch(() => undefined);

  // ---- ground: roads (world-space uvs, so overlapping strips at junctions are the same pixels) and pavement slabs ----
  const plane = (x0: number, z0: number, x1: number, z1: number, y: number, tile: number) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    const p = g.attributes.position, uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / tile, -p.getZ(i) / tile);
    return g;
  };
  for (const r of ROADS) {
    const [x0, x1, z0, z1] = r.along === 'z' ? [r.c - r.hw, r.c + r.hw, r.a - r.hw, r.b + r.hw] : [r.a - r.hw, r.b + r.hw, r.c - r.hw, r.c + r.hw];
    // in pieces, so each lies in its own zone (and is culled with it)
    const L = r.along === 'z' ? z1 - z0 : x1 - x0, n = Math.max(1, Math.ceil(L / 80));
    for (let i = 0; i < n; i++) {
      const a = i / n, b = (i + 1) / n;
      const g = r.along === 'z' ? plane(x0, z0 + (z1 - z0) * a, x1, z0 + (z1 - z0) * b, 0, 6) : plane(x0 + (x1 - x0) * a, z0, x0 + (x1 - x0) * b, z1, 0, 6);
      g.computeBoundingBox(); const c = g.boundingBox!.getCenter(new THREE.Vector3());
      put('road', c.x, c.z, g);
    }
  }
  /** A pavement slab over a rect: a grid with a row and a column at every kerb breakpoint, heights from districtHeight. */
  const slab = (b: Block) => {
    const xs = new Set([b.x0, b.x1]), zs = new Set([b.z0, b.z1]);
    for (const r of ROADS) for (const k of [r.c - r.hw - KERB, r.c - r.hw, r.c + r.hw, r.c + r.hw + KERB, r.a - r.hw - KERB, r.a - r.hw, r.b + r.hw, r.b + r.hw + KERB]) {
      if (r.along === 'z') { if (k > b.x0 && k < b.x1) xs.add(k); } else if (k > b.z0 && k < b.z1) zs.add(k);
    }
    for (let x = Math.ceil(b.x0 / 20) * 20; x < b.x1; x += 20) xs.add(x);
    for (let z = Math.ceil(b.z0 / 20) * 20; z < b.z1; z += 20) zs.add(z);
    const X = [...xs].sort((a, c) => a - c), Z = [...zs].sort((a, c) => a - c);
    // split into zone-sized pieces
    for (let zi = 0; zi < Z.length - 1; ) {
      const zEnd = Math.min(Z.length - 1, zi + 12);
      const pos: number[] = [], uv: number[] = [], idx: number[] = [], W = X.length;
      for (let j = zi; j <= zEnd; j++) for (const x of X) { pos.push(x, districtHeight(x, Z[j]), Z[j]); uv.push(x / 2.5, -Z[j] / 2.5); }
      for (let j = 0; j < zEnd - zi; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i, c = a + W; idx.push(a, c, a + 1, a + 1, c, c + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      put('pave', (b.x0 + b.x1) / 2, (Z[zi] + Z[zEnd]) / 2, g.toNonIndexed());
      zi = zEnd;
    }
  };
  for (const b of [...BLOCKS, ...STRIPS]) slab(b);
  // the road the flat looks out on runs out of the north gate between kerbs: the old town's road is |x| < 4
  // lane markings: a dashed centre line, lane dashes, and zebras and stop lines at every junction
  const nodes: { x: number; z: number; roads: Road[] }[] = [];
  for (const r of ROADS) for (const s of ROADS) {
    if (r.along !== 'z' || s.along !== 'x' || !r.cars || !s.cars) continue;
    if (s.c >= r.a - 0.1 && s.c <= r.b + 0.1 && r.c >= s.a - 0.1 && r.c <= s.b + 0.1) nodes.push({ x: r.c, z: s.c, roads: [r, s] });
  }
  const atNode = (x: number, z: number, m: number) => nodes.some((n) => Math.abs(n.x - x) < m && Math.abs(n.z - z) < m);
  for (const r of ROADS) {
    if (!r.cars) continue;
    for (let u = r.a + 10; u < r.b - 10; u += 6) {
      const ax = r.along === 'z';
      if (atNode(ax ? r.c : u, ax ? u : r.c, r.hw + 5)) continue;
      for (const off of [0, -3, 3]) {
        const len = off === 0 ? 3 : 2, w = off === 0 ? 0.15 : 0.12;
        const g = ax ? plane(r.c + off - w / 2, u, r.c + off + w / 2, u + len, 0.01, 1) : plane(u, r.c + off - w / 2, u + len, r.c + off + w / 2, 0.01, 1);
        put('mark', ax ? r.c : u, ax ? u : r.c, g);
      }
    }
  }
  for (const n of nodes) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    // a zebra across each arm, just outside the junction, and the stop line before it
    const arm = n.roads.find((r) => (dx ? r.along === 'x' : r.along === 'z'));
    if (!arm) continue;
    const u = (dx ? n.x : n.z) + (dx || dz) * (6 + 2.2);
    if (u < arm.a - 1 || u > arm.b + 1) continue;
    for (let k = -5; k <= 5; k += 1.2) {
      const g = dx ? plane(u - 1.6, n.z + k - 0.3, u + 1.6, n.z + k + 0.3, 0.012, 1) : plane(n.x + k - 0.3, u - 1.6, n.x + k + 0.3, u + 1.6, 0.012, 1);
      put('mark', dx ? u : n.x, dx ? n.z : u, g);
    }
  }

  // ---- buildings ----
  const tints = {
    plaster: [0xf1dcc0, 0xe9c4a0, 0xd9e4d6, 0xf0cdc6, 0xd2deea, 0xf4e6b4, 0xe6d6f0, 0xffffff].map((c) => new THREE.Color(c)),
    brick: [0xffffff, 0xf0d8d0, 0xd8c8c0].map((c) => new THREE.Color(c)),
    glass: [0xbcd0e0, 0xd8dee6, 0xa8c0cc, 0xe8e0d0, 0xc0c8d8].map((c) => new THREE.Color(c)),
  };
  /** Any geometry into a zone's kit, in one colour. */
  const kitGeo = (kind: string, g0: THREE.BufferGeometry, col: number, zx: number, zz: number) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const c = new THREE.Color(col), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv');
    put(kind, zx, zz, g);
  };
  const kitBox = (kind: string, x: number, y: number, z: number, w: number, h: number, d: number, col: number, zx = x, zz = z) => kitGeo(kind, new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), col, zx, zz);
  /** A box lying along a wall: `len` along it, `out` deep from it, centred `off` out from the face point (fx, fz). */
  const wallBox = (kind: string, fx: number, fz: number, nx: number, nz: number, y: number, len: number, h: number, out: number, off: number, col: number, shift = 0) =>
    kitBox(kind, fx + nx * off + (nx ? 0 : shift), y, fz + nz * off + (nx ? shift : 0), nx ? out : len, h, nx ? len : out, col, fx, fz);
  const AWN = [0xb03a2e, 0x1f6f5c, 0xc98a1b, 0x2c3e7a, 0x6d3b7a, 0xd8d2c0, 0x3a3a3e];
  /** What a street floor is made of besides the wall: piers, a plinth, a fascia for the sign, a door, an awning. */
  const shopKit = (fx: number, fz: number, nx: number, nz: number, w: number, fh: number, kind: number) => {
    const trim = pick([0x2a2c30, 0x3a2e26, 0x1e2a36, 0x4a4640, 0x202020]);
    for (const sgn of [-1, 1]) wallBox('kit', fx, fz, nx, nz, FLOOR, 0.34, fh * 0.98, 0.2, 0.1, trim, sgn * (w / 2 - 0.17));
    wallBox('kit', fx, fz, nx, nz, FLOOR, w - 0.7, 0.32, 0.12, 0.06, trim);
    wallBox('kit', fx, fz, nx, nz, FLOOR + fh * 0.76, w - 0.7, fh * 0.2, 0.22, 0.11, 0x101114);
    // the door, off centre: a frame, a leaf, a bright handle
    const dsh = (rnd() - 0.5) * (w - 3.4), dc = pick([0x6a3a2a, 0x24405a, 0x2f4f3a, 0x8a8478, 0x30343a]);
    wallBox('kit', fx, fz, nx, nz, FLOOR, 1.34, 2.36, 0.12, 0.06, trim, dsh);
    wallBox('kit', fx, fz, nx, nz, FLOOR + 0.04, 1.06, 2.16, 0.1, 0.1, dc, dsh);
    wallBox('metal', fx, fz, nx, nz, FLOOR + 1.0, 0.05, 0.22, 0.05, 0.17, 0xc8c4b8, dsh + 0.38);
    wallBox('kit', fx, fz, nx, nz, FLOOR, 1.5, 0.06, 0.5, 0.25, 0x8a857c, dsh); // the step
    // what stands out on the pavement in front: tables where food is served, a sandwich board, planters by the door
    const at = (out: number, along: number) => [fx + nx * out + (nx ? 0 : along), fz + nz * out + (nx ? along : 0)];
    const r = rnd(), side = (rnd() - 0.5) * (w - 5);
    if (kind === 1 && w > 5 && r < 0.7) {
      for (const k of [-1, 1]) {
        const [tx, tz] = at(1.9, side + k * 1.6);
        kitGeo('kit', new THREE.CylinderGeometry(0.36, 0.36, 0.04, 12).translate(tx, FLOOR + 0.74, tz), 0xe8e2d6, fx, fz);
        kitGeo('kit', new THREE.CylinderGeometry(0.04, 0.05, 0.72, 6).translate(tx, FLOOR + 0.37, tz), 0x2a2a2a, fx, fz);
        solid(tx - 1.15, tz - 1.15, tx + 1.15, tz + 1.15, 0.8); // the table and its chairs: you walk round them
        for (const c of [-1, 1]) {
          const [cxx, czz] = at(1.9, side + k * 1.6 + c * 0.72);
          kitBox('kit', cxx, FLOOR + 0.42, czz, 0.4, 0.05, 0.4, 0x5a3a24, fx, fz);
          kitBox('kit', cxx + (nx ? 0 : c * 0.18), FLOOR + 0.45, czz + (nx ? c * 0.18 : 0), nx ? 0.4 : 0.05, 0.45, nx ? 0.05 : 0.4, 0x5a3a24, fx, fz);
          for (const l of [-1, 1]) kitBox('kit', cxx + (nx ? l * 0.16 : 0), FLOOR, czz + (nx ? 0 : l * 0.16), 0.04, 0.42, 0.04, 0x2a2a2a, fx, fz);
          cafes.push({ x: cxx, z: czz, yaw: Math.atan2((nx ? 0 : -c), (nx ? -c : 0)) });
        }
      }
    } else if (r < 0.4 || (kind === 1 && r < 0.85)) {
      const [bx, bz] = at(1.1, side), g = new THREE.BoxGeometry(nx ? 0.06 : 0.6, 0.9, nx ? 0.6 : 0.06);
      kitGeo('kit', g.clone().rotateX(nx ? 0 : 0.2).rotateZ(nx ? 0.2 : 0).translate(bx - nz * 0, FLOOR + 0.45, bz), 0x1c1d20, fx, fz);
      kitGeo('kit', g.rotateX(nx ? 0 : -0.2).rotateZ(nx ? -0.2 : 0).translate(bx + nx * 0.18, FLOOR + 0.45, bz + nz * 0.18), 0x1c1d20, fx, fz);
    } else if (r < 0.68) {
      for (const k of [-1, 1]) {
        const [px, pz] = at(0.45, dsh + k * 1.0);
        kitBox('kit', px, FLOOR, pz, 0.5, 0.55, 0.5, pick([0x8a8478, 0x3a3d42, 0xa0603a]), fx, fz);
        kitGeo('kit', new THREE.IcosahedronGeometry(0.42, 0).translate(px, FLOOR + 0.9, pz), pick([0x3f6a32, 0x2f5a2a, 0x557a3a]), fx, fz);
      }
    }
    if (rnd() < 0.6 && fh < 4) {
      // an awning: cloth sloping out over the pavement, on two arms
      const aw = Math.min(w - 1, 3 + rnd() * 3), sh = (rnd() - 0.5) * (w - aw - 0.8), col = pick(AWN), tilt = 0.32;
      const g = new THREE.BoxGeometry(nx ? 1.5 : aw, 0.05, nx ? aw : 1.5);
      if (nx) g.rotateZ(-nx * tilt); else g.rotateX(nz * tilt);
      g.translate(fx + nx * 0.86 + (nx ? 0 : sh), FLOOR + fh * 0.72, fz + nz * 0.86 + (nx ? sh : 0));
      g.computeBoundingBox(); covers.push(g.boundingBox!.clone());
      kitGeo('kit', g, col, fx, fz);
      const v = new THREE.BoxGeometry(nx ? 0.04 : aw, 0.22, nx ? aw : 0.04).translate(fx + nx * 1.56 + (nx ? 0 : sh), FLOOR + fh * 0.72 - 0.34, fz + nz * 1.56 + (nx ? sh : 0));
      kitGeo('kit', v, col, fx, fz);
    }
  };
  const cafes: { x: number; z: number; yaw: number }[] = [];
  const footprints: { x0: number; z0: number; x1: number; z1: number; h: number; kind: BlockKind }[] = [];
  /** One building: a box (or a podium and setbacks), its roof kit, its collision. */
  const building = (x0: number, z0: number, x1: number, z1: number, floors: number, finish: 'plaster' | 'brick' | 'glass', style: number, fh = 3.2, kind = -1) => {
    // the seed's whole part, mod 5, is the kind of shop on the street floor (facade.ts draws its interior from it)
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, h = floors * fh, sd = kind >= 0 ? kind + 5 * Math.floor(rnd() * 19) : rnd() * 97, tint = pick(tints[finish]);
    put(`wall_${finish}`, cx, cz, facadeBox(cx, cz, w, d, FLOOR, h, fh, style === 1 ? 1.6 : 2.7, sd, style, tint, FLOOR));
    let top = FLOOR + h;
    // towers step back as they rise
    if (style === 1 && floors > 16) {
      let ww = w, dd = d, fl = floors;
      for (let s = 0; s < 2 && fl > 8; s++) {
        ww *= 0.78; dd *= 0.78; const up = Math.round(fl * (0.3 + rnd() * 0.25)); fl -= up;
        put('wall_glass', cx, cz, facadeBox(cx, cz, ww, dd, top, up * fh, fh, 1.6, sd + s + 1, 1, tint, FLOOR, [cx - ww / 2, cz - dd / 2]));
        top += up * fh;
      }
      kitBox('kit', cx, top, cz, ww * 0.4, 4, dd * 0.4, 0x8a8f96, cx, cz);
      kitBox('kit', cx, top + 4, cz, 0.4, 14, 0.4, 0xd0d4d8, cx, cz); // a mast
      // a crown: a lit band under the roof line (how a skyline is read at dusk) and a red beacon on the mast for aircraft
      if (tier > 0) {
        for (const [bx, bz, bw2, bd2] of [[cx, cz - dd / 2 - 0.05, ww, 0.1], [cx, cz + dd / 2 + 0.05, ww, 0.1], [cx - ww / 2 - 0.05, cz, 0.1, dd], [cx + ww / 2 + 0.05, cz, 0.1, dd]]) {
          const g = new THREE.BoxGeometry(bw2, 0.35, bd2).toNonIndexed(); g.translate(bx, top - 1.6, bz); put('lamp', cx, cz, g);
        }
        kitBox('kit', cx, top + 18, cz, 0.5, 0.5, 0.5, 0x9a1a10, cx, cz);
      }
    } else {
      // a parapet round the roof, and what lives up there: plant rooms, water tanks, AC units
      const pc = finish === 'glass' ? 0x9aa0a8 : 0xd8d0c4;
      // a cornice under the parapet and a string course over the street floor: edges that catch the light
      if (finish !== 'glass') for (const [yy, hh, oo] of [[top - 0.32, 0.3, 0.26], [FLOOR + fh - 0.12, 0.2, 0.14]] as number[][]) {
        kitBox('kit', cx, yy, z0 - oo / 2, w + oo * 2, hh, oo, pc, cx, cz); kitBox('kit', cx, yy, z1 + oo / 2, w + oo * 2, hh, oo, pc, cx, cz);
        kitBox('kit', x0 - oo / 2, yy, cz, oo, hh, d, pc, cx, cz); kitBox('kit', x1 + oo / 2, yy, cz, oo, hh, d, pc, cx, cz);
      }
      kitBox('kit', cx, top, z0 + 0.15, w, 0.9, 0.3, pc, cx, cz); kitBox('kit', cx, top, z1 - 0.15, w, 0.9, 0.3, pc, cx, cz);
      kitBox('kit', x0 + 0.15, top, cz, 0.3, 0.9, d - 0.6, pc, cx, cz); kitBox('kit', x1 - 0.15, top, cz, 0.3, 0.9, d - 0.6, pc, cx, cz);
      for (let i = 0, n = 1 + Math.floor(rnd() * 3); i < n; i++) kitBox('kit', x0 + 2 + rnd() * (w - 5), top, z0 + 2 + rnd() * (d - 5), 1.5 + rnd() * 2.5, 1.2 + rnd() * 2, 1.5 + rnd() * 2.5, pick([0x9a9a9a, 0xbfbfbf, 0x6f7377, 0x2a2a2a]), cx, cz);
      // the clutter a skyline is made of: condenser units in a row, a mast or two, a dish turned to the sky
      if (tier > 0) {
        const ax = x0 + 1.5 + rnd() * (w - 3), az = z0 + 1.5 + rnd() * (d - 3), n = 2 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) { kitBox('kit', ax + (w > d ? i * 1.1 : 0), top, az + (w > d ? 0 : i * 1.1), 0.9, 0.8, 0.7, 0xc8c6c0, cx, cz); kitGeo('metal', new THREE.CylinderGeometry(0.3, 0.3, 0.04, 10).rotateX(Math.PI / 2).translate(ax + (w > d ? i * 1.1 : 0), top + 0.42, az + (w > d ? 0 : i * 1.1) + 0.36), 0x2a2c30, cx, cz); }
        if (rnd() < 0.6) { const mx = x0 + 1 + rnd() * (w - 2), mz = z0 + 1 + rnd() * (d - 2), mh = 3 + rnd() * 4; kitBox('metal', mx, top, mz, 0.08, mh, 0.08, 0x3a3d42, cx, cz); kitBox('metal', mx, top + mh * 0.7, mz, 1.2, 0.04, 0.04, 0x3a3d42, cx, cz); kitBox('metal', mx, top + mh * 0.85, mz, 0.8, 0.04, 0.04, 0x3a3d42, cx, cz); }
        if (rnd() < 0.5) { const dx = x0 + 1.5 + rnd() * (w - 3), dz = z0 + 1.5 + rnd() * (d - 3); kitGeo('kit', new THREE.SphereGeometry(0.6, 10, 5, 0, Math.PI * 2, 0, 1.0).rotateX(-0.9).translate(dx, top + 1.2, dz), 0xe4e2dc, cx, cz); kitBox('metal', dx, top, dz, 0.07, 1.0, 0.07, 0x3a3d42, cx, cz); }
      }
    }
    solid(x0, z0, x1, z1, top);
    footprints.push({ x0, z0, x1, z1, h: top, kind: 'mid' });
    return top;
  };
  /** Balconies on a residential wall (side: the wall's outward normal). */
  const balconies = (x0: number, z0: number, x1: number, z1: number, floors: number, nx: number, nz: number) => {
    const along = nx === 0, L = along ? x1 - x0 : z1 - z0, bays = Math.max(1, Math.round(L / 2.7)), bw = L / bays;
    for (let f = 1; f < floors; f++) for (let b = 0; b < bays; b++) {
      const u = (along ? x0 : z0) + (b + 0.5) * bw, y = FLOOR + f * 3.2;
      const fx = nx > 0 ? x1 : nx < 0 ? x0 : u, fz = nz > 0 ? z1 : nz < 0 ? z0 : u;
      // an air conditioner under the odd window, on its bracket
      if ((b + f) % 2) { if (rnd() < 0.16) { wallBox('kit', fx, fz, nx, nz, y + 0.2, 0.8, 0.5, 0.36, 0.2, 0xd4d2cc); wallBox('metal', fx, fz, nx, nz, y + 0.14, 0.86, 0.05, 0.4, 0.2, 0x30343a); } continue; }
      const px = fx + nx * 0.6, pz = fz + nz * 0.6, w = along ? bw * 0.9 : 1.2, d = along ? 1.2 : bw * 0.9;
      kitBox('kit', px, y - 0.1, pz, w, 0.14, d, 0xd8d2c8, x0, z0);
      kitBox('metal', px + nx * 0.58, y + 0.04, pz + nz * 0.58, along ? w : 0.05, 1.0, along ? 0.05 : d, 0x30343a, x0, z0);
    }
  };
  /**
   * The street wall in relief: a sill course under every row of windows, pilasters between the bays, a deeper cornice
   * and, now and then, a set-back top floor or a pitched roof, so a street of buildings has edges, shadows and a
   * skyline instead of flat boxes. Only the face to the street (the courtyard sides are never seen).
   */
  const relief = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number, floors: number, finish: string, fh = 3.2) => {
    if (finish === 'glass') return;
    const along = nx === 0, L = along ? x1 - x0 : z1 - z0, c = along ? (x0 + x1) / 2 : (z0 + z1) / 2;
    const fx = nx > 0 ? x1 : nx < 0 ? x0 : c, fz = nz > 0 ? z1 : nz < 0 ? z0 : c, top = FLOOR + floors * fh;
    const stone = pick([0xe2d8c8, 0xd0c4b0, 0xbfb6a8, 0xf0e8da, 0x9c8f80]);
    const k = 'trim';
    if (tier > 0) {
      // sills: a thin ledge under each floor's windows, the length of the wall
      for (let f = 1; f < floors; f++) wallBox(k, fx, fz, nx, nz, FLOOR + f * fh + fh * 0.22, L, 0.1, 0.14, 0.07, stone);
      // pilasters every other bay, and at both corners
      const bays = Math.max(1, Math.round(L / 2.7)), bw = L / bays;
      for (let b = 0; b <= bays; b += 2) wallBox(k, fx, fz, nx, nz, FLOOR + fh, 0.36, top - FLOOR - fh - 0.3, 0.16, 0.08, stone, -L / 2 + Math.min(L - 0.18, Math.max(0.18, b * bw)));
      // a deeper cornice on brackets at the top
      wallBox(k, fx, fz, nx, nz, top - 0.55, L + 0.4, 0.25, 0.5, 0.25, stone);
      wallBox(k, fx, fz, nx, nz, top - 0.8, L, 0.25, 0.24, 0.12, stone);
    }
    // the skyline: a pitched roof on the low streets, a set-back top floor on taller ones
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0, r = rnd();
    if (floors <= 7 && r < 0.45) {
      const ridgeAlongX = along, span = ridgeAlongX ? d : w, len = ridgeAlongX ? w : d, rise = Math.min(4.5, span * 0.32);
      const g = new THREE.BufferGeometry(), h = span / 2;
      // a prism: two slopes and two gable ends, ridge along x (rotated for z)
      const P = [-len / 2, 0, -h, len / 2, 0, -h, len / 2, rise, 0, -len / 2, 0, -h, len / 2, rise, 0, -len / 2, rise, 0,
        -len / 2, 0, h, len / 2, rise, 0, -len / 2, rise, 0, -len / 2, 0, h, len / 2, 0, h, len / 2, rise, 0,
        -len / 2, 0, -h, -len / 2, 0, h, -len / 2, rise, 0, len / 2, 0, -h, len / 2, rise, 0, len / 2, 0, h];
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      if (!ridgeAlongX) g.rotateY(Math.PI / 2);
      g.translate(cx, top + 0.9, cz); g.computeVertexNormals();
      kitGeo('roof', g, pick([0x8a3b2a, 0x6b4a3a, 0x4a4e58, 0x9a5a3a, 0x3e4248]), cx, cz); // the skyline: drawn at any distance
    } else if (floors > 5 && r < 0.4) {
      const sw = w * 0.7, sd = d * 0.6;
      put(`wall_${finish}`, cx, cz, facadeBox(cx - nx * w * 0.1, cz - nz * d * 0.15, sw, sd, top, fh, fh, 2.7, rnd() * 97, 0, pick(tints[finish as 'plaster' | 'brick']), FLOOR));
    } else if (r < 0.75) {
      // a water tank on legs
      const tx = x0 + 2.5 + rnd() * Math.max(0.1, w - 5), tz = z0 + 2.5 + rnd() * Math.max(0.1, d - 5);
      kitGeo('roof', new THREE.CylinderGeometry(1.3, 1.3, 2.4, 10).translate(tx, top + 2.6, tz), 0x6f6a62, cx, cz);
      kitGeo('roof', new THREE.ConeGeometry(1.4, 0.8, 10).translate(tx, top + 4.2, tz), 0x4a4640, cx, cz);
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) kitBox(k, tx + a * 0.9, top, tz + b * 0.9, 0.14, 1.4, 0.14, 0x30343a, cx, cz);
    }
  };
  const lotsAlong = (a: number, b: number, min: number, max: number) => { const out: [number, number][] = []; for (let u = a; u < b - 1; ) { let w = min + rnd() * (max - min); if (b - (u + w) < min) w = b - u; out.push([u, u + w]); u += w; } return out; };
  const inset = (b: Block) => ({ x0: b.x0 + 6 + PAVE, x1: b.x1 - 6 - PAVE, z0: b.z0 + 6 + PAVE, z1: b.z1 - 6 - PAVE });
  const shopfronts: { x: number; z: number; nx: number; nz: number; w: number; fh: number; brand: number }[] = [];
  /** A brand for a shop, of one of the given kinds (any if none given). */
  const brandOf = (kinds?: number[]) => { const k = kinds ? pick(kinds) : -1; return pick(BRANDS.map((b, i) => (k < 0 || b[3] === k ? i : -1)).filter((i) => i >= 0)); };
  const front = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number, fh = 3.2, brand = brandOf()) => {
    // the ground floor's sign over the shop, on the wall facing the street
    const along = nx === 0, c = along ? (x0 + x1) / 2 : (z0 + z1) / 2;
    const fx = nx > 0 ? x1 : nx < 0 ? x0 : c, fz = nz > 0 ? z1 : nz < 0 ? z0 : c, wd = along ? x1 - x0 : z1 - z0;
    shopfronts.push({ x: fx, z: fz, nx, nz, w: Math.min(9, wd - 1.5), fh, brand });
    if (tier > 0 || rnd() < 0.5) shopKit(fx, fz, nx, nz, wd, fh, BRANDS[brand][3]);
  };
  /** A block ringed by buildings on its four sides (a closed courtyard behind). */
  const perimeter = (b: Block, depth: [number, number], floors: [number, number], finishes: ('plaster' | 'brick' | 'glass')[], style: number, lot: [number, number], balc: boolean, kinds?: number[]) => {
    const I = inset(b), D = depth[0] + rnd() * (depth[1] - depth[0]);
    for (const [u0, u1] of lotsAlong(I.x0, I.x1, lot[0], lot[1])) for (const [zz0, zz1, nz] of [[I.z0, I.z0 + D, -1], [I.z1 - D, I.z1, 1]] as [number, number, number][]) {
      const fl = floors[0] + Math.floor(rnd() * (floors[1] - floors[0] + 1));
      const fin = pick(finishes), br = brandOf(kinds); building(u0, zz0, u1, zz1, fl, fin, style, 3.2, BRANDS[br][3]); front(u0, zz0, u1, zz1, 0, nz, 3.2, br); relief(u0, zz0, u1, zz1, 0, nz, fl, fin);
      if (balc) balconies(u0, zz0, u1, zz1, fl, 0, nz);
    }
    for (const [u0, u1] of lotsAlong(I.z0 + D, I.z1 - D, lot[0], lot[1])) for (const [xx0, xx1, nx] of [[I.x0, I.x0 + D, -1], [I.x1 - D, I.x1, 1]] as [number, number, number][]) {
      const fl = floors[0] + Math.floor(rnd() * (floors[1] - floors[0] + 1));
      const fin = pick(finishes), br = brandOf(kinds); building(xx0, u0, xx1, u1, fl, fin, style, 3.2, BRANDS[br][3]); front(xx0, u0, xx1, u1, nx, 0, 3.2, br); relief(xx0, u0, xx1, u1, nx, 0, fl, fin);
      if (balc) balconies(xx0, u0, xx1, u1, fl, nx, 0);
    }
  };
  const parks: Block[] = [];
  for (const b of BLOCKS) {
    if (b.kind === 'tower') {
      const I = inset(b), two = rnd() < 0.5;
      // a podium of shops filling the block, one or two towers on it
      building(I.x0, I.z0, I.x1, I.z1, 3, 'glass', 2, 4.2, 3); // the podium: banks, opticians, travel desks, a salon
      for (const [x0, x1, z0, z1, dz] of [[I.x0, I.x1, I.z0, I.z1, 0]] as number[][]) { for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) for (let k = 0; k < 3; k++) { const a = k / 3, b = (k + 1) / 3; if (nx) front(x0, z0 + (z1 - z0) * a, x1, z0 + (z1 - z0) * b, nx, nz, 4.2, brandOf([3])); else front(x0 + (x1 - x0) * a, z0, x0 + (x1 - x0) * b, z1, nx, nz, 4.2, brandOf([3])); } void dz; }
      const tw = two ? 22 : 32, cs = two ? [[-0.25, -0.2], [0.25, 0.22]] : [[0, 0]];
      for (const [fx, fz] of cs) {
        const cx = (I.x0 + I.x1) / 2 + fx * (I.x1 - I.x0), cz = (I.z0 + I.z1) / 2 + fz * (I.z1 - I.z0), fl = 22 + Math.floor(Math.pow(rnd(), 1.4) * 34);
        const top = building(cx - tw / 2, cz - tw / 2, cx + tw / 2, cz + tw / 2, fl, 'glass', 1);
        void top;
      }
    } else if (b.kind === 'mid') perimeter(b, [14, 18], [6, 12], ['brick', 'plaster', 'glass'], 2, [16, 26], false, [0, 1, 2, 3, 3]);
    else if (b.kind === 'market') perimeter(b, [12, 16], [3, 5], ['plaster', 'plaster', 'brick'], 0, [8, 13], true, [0, 1, 1, 2, 4]);
    else if (b.kind === 'water') perimeter(b, [14, 18], [7, 13], ['plaster', 'glass', 'brick'], 0, [14, 22], true, [1, 1, 3]);
    else if (b.kind === 'res') perimeter(b, [12, 15], [4, 7], ['plaster', 'brick'], 0, [12, 18], true, [1, 2, 3, 4]);
    else if (b.kind === 'park') parks.push(b);
  }
  // the old town's back streets: dense flats over the bazaar's roofs (the bazaar used to end at its own walls)
  const OLD_FILL: [number, number, number, number, number, number][] = [
    [21.5, -78, 72.5, 13, 5, 10], [21.5, 47, 72.5, 80, 5, 10], [9.6, 80, 21.5, 98, 3, 5], [21.5, 80, 72.5, 98, 4, 8],
    [-72.5, -78, -21.5, -61, 5, 10], [-72.5, -27, -21.5, 80, 5, 10], [-21.5, 80, -9.6, 98, 3, 5], [-72.5, 80, -21.5, 98, 4, 8],
  ];
  for (const [x0, z0, x1, z1, f0, f1] of OLD_FILL) {
    for (const [u0, u1] of lotsAlong(z0, z1, 12, 22)) {
      const mid = (x0 + x1) / 2, split = x1 - x0 > 30;
      for (const [a, b] of split ? [[x0, mid], [mid, x1]] : [[x0, x1]]) {
        const fl = f0 + Math.floor(rnd() * (f1 - f0 + 1));
        const br = brandOf();
        building(a, u0, b, u1, fl, pick(['plaster', 'plaster', 'brick'] as const), 0, 3.2, BRANDS[br][3]);
        if (z0 >= 80) front(a, u0, b, u1, a > 0 ? -1 : 1, 0, 3.2, br);
      }
    }
  }
  // edge of the city: towers beyond the east avenue and the north street, behind a low wall; the bay to the west
  for (let z = -90; z < 330; z += 34 + rnd() * 20) building(344, z, 370 + rnd() * 10, z + 26 + rnd() * 6, 18 + Math.floor(rnd() * 30), 'glass', 1);
  for (let x = -240; x < 340; x += 30 + rnd() * 20) building(x, 324, x + 22 + rnd() * 6, 352, 12 + Math.floor(rnd() * 26), pick(['glass', 'brick'] as const), rnd() < 0.5 ? 1 : 2);
  solid(340, -110, 344, 330, 3); solid(72.5, -104, 84, -90, 3); solid(-84, -104, -72.5, -90, 3); solid(-260, 320, 344, 324, 3); solid(84, -104, 340, -100, 3); solid(-260, -104, -84, -100, 3); solid(-282, -110, -281, 330, 1.2);

  // ---- the bay: deep water, a sea wall, railings along the promenade ----
  {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1400), (() => {
      const m = new THREE.MeshStandardMaterial({ color: 0x0f3b4a, roughness: 0.08, metalness: 0.1 });
      const nt = canvasTex(256, 256, (g) => { const id = g.createImageData(256, 256); for (let i = 0; i < 256 * 256; i++) { const x = i % 256, y = (i / 256) | 0; const v = 128 + 40 * Math.sin(x * 0.19 + Math.sin(y * 0.11) * 3) + 30 * Math.sin(y * 0.23 + x * 0.05); id.data[i * 4] = v; id.data[i * 4 + 1] = 255 - v * 0.5; id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = 255; } g.putImageData(id, 0, 0); });
      nt.colorSpace = THREE.NoColorSpace; nt.wrapS = nt.wrapT = THREE.RepeatWrapping; nt.repeat.set(160, 140);
      m.normalMap = nt; m.normalScale.set(0.35, 0.35); m.userData.water = nt;
      return m;
    })());
    water.rotation.x = -Math.PI / 2; water.position.set(-282 - 800, -1.4, 110); water.receiveShadow = true; add(water);
    waterTex = (water.material as THREE.MeshStandardMaterial).userData.water as THREE.Texture;
    kitBox('kit', -282, -1.6, 110, 2, 1.74, 424, 0x8a8478, -270, 110);
    for (let z = -94; z < 314; z += 2.5) kitBox('metal', -280.8, FLOOR, z, 0.08, 1.05, 0.08, 0x2a2e33, -270, z);
    for (let z = -94; z < 314; z += 40) kitBox('metal', -280.8, FLOOR + 1.0, z + 20, 0.1, 0.08, 40, 0x3a3e43, -270, z + 20);
  }

  // ---- the park: lawns, paths, a pond, trees ----
  const trees: [number, number, number][] = [];
  for (const b of parks) {
    const I = inset(b);
    for (const [x0, z0, x1, z1] of [[I.x0, I.z0, -3, I.z1 - 0.01], [3, I.z0, I.x1, I.z1 - 0.01]] as number[][]) {
      // lawns split by a cross of paths
      const mz = (I.z0 + I.z1) / 2;
      for (const [a, c] of [[z0, mz - 3], [mz + 3, z1]]) put('grass', (x0 + x1) / 2, (a + c) / 2, plane(x0, a, x1, c, FLOOR + 0.002, 1));
    }
    const px = 40, pz = 262;
    const pond = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.MeshStandardMaterial({ color: 0x1f4c56, roughness: 0.06, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    pond.rotation.x = -Math.PI / 2; pond.position.set(px, FLOOR + 0.01, pz); add(pond);
    for (let a = 0; a < 40; a++) { const t = a / 40 * Math.PI * 2; kitBox('kit', px + Math.cos(t) * 14.3, FLOOR, pz + Math.sin(t) * 14.3, 2.4, 0.45, 0.6, 0xc8c0b2, px, pz); }
    solid(px - 13, pz - 13, px + 13, pz + 13, 0.5);
    for (let i = 0; i < (rich ? 90 : 45); i++) {
      const x = I.x0 + 4 + rnd() * (I.x1 - I.x0 - 8), z = I.z0 + 4 + rnd() * (I.z1 - I.z0 - 8);
      if (Math.abs(x) < 6 || Math.abs(z - (I.z0 + I.z1) / 2) < 6 || Math.hypot(x - px, z - pz) < 18) continue;
      trees.push([x, z, 0.8 + rnd() * 0.5]);
    }
  }

  // ---- street furniture along every pavement: lamps, trees, benches, bins, bus shelters, signals ----
  const lamps: THREE.Vector3[] = [];
  const furnish = (b: Block) => {
    const I = { x0: b.x0 + 6, x1: b.x1 - 6, z0: b.z0 + 6, z1: b.z1 - 6 }; // the kerb line
    const sides: [number, number, number, number, number, number][] = [ // start, end, fixed, axis (0: along x), normal x, normal z
      [I.x0 + 8, I.x1 - 8, I.z0, 0, 0, -1], [I.x0 + 8, I.x1 - 8, I.z1, 0, 0, 1], [I.z0 + 8, I.z1 - 8, I.x0, 1, -1, 0], [I.z0 + 8, I.z1 - 8, I.x1, 1, 1, 0],
    ];
    // kerbstones: a pale stone edge to every pavement
    kitBox('kit', (I.x0 + I.x1) / 2, 0, I.z0 + 0.25, I.x1 - I.x0, 0.15, 0.2, 0xb6b2a8, (I.x0 + I.x1) / 2, I.z0 + 4); kitBox('kit', (I.x0 + I.x1) / 2, 0, I.z1 - 0.25, I.x1 - I.x0, 0.15, 0.2, 0xb6b2a8, (I.x0 + I.x1) / 2, I.z1 - 4);
    kitBox('kit', I.x0 + 0.25, 0, (I.z0 + I.z1) / 2, 0.2, 0.15, I.z1 - I.z0, 0xb6b2a8, I.x0 + 4, (I.z0 + I.z1) / 2); kitBox('kit', I.x1 - 0.25, 0, (I.z0 + I.z1) / 2, 0.2, 0.15, I.z1 - I.z0, 0xb6b2a8, I.x1 - 4, (I.z0 + I.z1) / 2);
    // bollards round each corner, where the zebras land: people cross there, cars must not cut it
    if (tier > 0) for (const [cx, cz, sx, sz] of [[I.x0, I.z0, 1, 1], [I.x1, I.z0, -1, 1], [I.x0, I.z1, 1, -1], [I.x1, I.z1, -1, -1]]) {
      for (const k of [2.2, 3.4]) { kitGeo('metal', new THREE.CylinderGeometry(0.09, 0.11, 0.9, 8).translate(cx + sx * k, FLOOR + 0.45, cz + sz * 0.45), 0x2e3236, cx, cz); kitGeo('metal', new THREE.CylinderGeometry(0.09, 0.11, 0.9, 8).translate(cx + sx * 0.45, FLOOR + 0.45, cz + sz * k), 0x2e3236, cx, cz); }
    }
    for (const [a, c, f, ax, nx, nz] of sides) {
      let i = 0;
      for (let u = a; u <= c; u += 12, i++) {
        // just inside the kerb: out from the block edge by its normal is the road, so step back in
        const kx = ax ? f - nx * 0.7 : u, kz = ax ? u : f - nz * 0.7;
        if (i % 2 === 0) lampAt(kx, kz, nx, nz);
        else if (b.kind !== 'market' || rnd() < 0.5) trees.push([kx - nx * 0.5, kz - nz * 0.5, 0.55 + rnd() * 0.25]);
        if (i % 5 === 3) { benchAt(kx - nx * 1.6, kz - nz * 1.6, nx, nz); }
        // scanned street furniture (Poly Haven, CC0), drawn through the city's prop atlas: bins, hydrants, service boxes
        const px = kx - nx * 0.45, pz = kz - nz * 0.45, yaw = Math.atan2(-nx, -nz);
        if (i % 7 === 5) { o.place('metal_trash_can', px, FLOOR, pz, yaw); solid(px - 0.3, pz - 0.3, px + 0.3, pz + 0.3, 1); }
        else if (i % 9 === 2) { o.place('fire_hydrant', px, FLOOR, pz, yaw); solid(px - 0.25, pz - 0.25, px + 0.25, pz + 0.25, 0.9); }
        else if (i % 11 === 6) { o.place('utility_box_01', px, FLOOR, pz, yaw); solid(px - 0.4, pz - 0.4, px + 0.4, pz + 0.4, 1.2); }
        else if (i % 6 === 1 && (b.kind === 'market' || b.kind === 'res' || b.kind === 'water')) { o.place('planter_box_01', kx - nx * 2.9, FLOOR, kz - nz * 2.9, yaw); }
        if (i === 4 && rnd() < 0.5) shelterAt(kx - nx * 1.4, kz - nz * 1.4, nx, nz);
        else if ((i === 2 || i === 7) && b.kind !== 'tower' && rnd() < (b.kind === 'market' ? 0.6 : 0.3)) cartAt(kx - nx * 1.3, kz - nz * 1.3, nx, nz);
      }
    }
  };
  const lampAt = (x: number, z: number, nx: number, nz: number) => {
    kitBox('metal', x, FLOOR, z, 0.16, 7, 0.16, 0x33373c, x, z);
    kitBox('metal', x + nx * 1.1, FLOOR + 6.9, z + nz * 1.1, nx ? 2.2 : 0.12, 0.12, nz ? 2.2 : 0.12, 0x33373c, x, z);
    if (tier === 0) kitBox('kit', x + nx * 2, FLOOR + 6.8, z + nz * 2, nx ? 0.9 : 0.36, 0.12, nz ? 0.9 : 0.36, 0xfff0d0, x, z);
    else { const head = new THREE.BoxGeometry(nx ? 0.9 : 0.36, 0.12, nz ? 0.9 : 0.36).toNonIndexed(); head.translate(x + nx * 2, FLOOR + 6.86, z + nz * 2); put('lamp', x, z, head); }
    lamps.push(new THREE.Vector3(x + nx * 2, FLOOR, z + nz * 2));
    solid(x - 0.15, z - 0.15, x + 0.15, z + 0.15, 7);
  };
  const benchAt = (x: number, z: number, nx: number, nz: number) => {
    const w = nx ? 0.5 : 1.8, d = nx ? 1.8 : 0.5;
    kitBox('kit', x, FLOOR + 0.42, z, w, 0.08, d, 0x8a5a3a, x, z);
    kitBox('kit', x - nx * 0.22, FLOOR + 0.5, z - nz * 0.22, nx ? 0.06 : 1.8, 0.45, nz ? 0.06 : 1.8, 0x8a5a3a, x, z);
    for (const s of [-0.7, 0.7]) kitBox('metal', x + (nx ? 0 : s), FLOOR, z + (nx ? s : 0), nx ? 0.4 : 0.06, 0.42, nx ? 0.06 : 0.4, 0x2a2e33, x, z);
    benches.push({ x: x - nx * 0.05, z: z - nz * 0.05, yaw: Math.atan2(nx, nz) });
    solid(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 0.9);
  };
  const shelterAt = (x: number, z: number, nx: number, nz: number) => {
    const w = nx ? 1.6 : 4.4, d = nx ? 4.4 : 1.6;
    kitBox('metal', x, FLOOR + 2.5, z, w, 0.1, d, 0xd8dde2, x, z);
    covers.push(new THREE.Box3(new THREE.Vector3(x - w / 2, FLOOR + 2.45, z - d / 2), new THREE.Vector3(x + w / 2, FLOOR + 2.55, z + d / 2)));
    kitBox('metal', x - nx * 0.75, FLOOR, z - nz * 0.75, nx ? 0.06 : 4.4, 2.5, nx ? 4.4 : 0.06, 0x9fb8c8, x, z);
    for (const s of [-2.1, 2.1]) kitBox('metal', x + (nx ? 0 : s) - nx * 0.75, FLOOR, z + (nx ? s : 0) - nz * 0.75, 0.08, 2.5, 0.08, 0x30343a, x, z);
    solid(x - nx * 0.75 - (nx ? 0.1 : 2.2), z - nz * 0.75 - (nz ? 0.1 : 2.2), x - nx * 0.75 + (nx ? 0.1 : 2.2), z - nz * 0.75 + (nz ? 0.1 : 2.2), 2.6);
  };
  /** A street food cart at the kerb: a box on wheels, a counter, a canopy and a bulb; its cook and a customer or two. */
  const carts: { x: number; z: number; nx: number; nz: number }[] = [];
  const CART = [0xb8432e, 0x1f6f5c, 0xd8a02a, 0x2c4e8a, 0xe8e0d0];
  const cartAt = (x: number, z: number, nx: number, nz: number) => {
    const col = pick(CART), lx = nx ? 0.9 : 1.8, lz = nx ? 1.8 : 0.9;
    kitBox('kit', x, FLOOR + 0.3, z, lx, 0.62, lz, col, x, z);
    kitBox('kit', x - nx * 0.05, FLOOR + 0.92, z - nz * 0.05, lx + 0.1, 0.05, lz + 0.1, 0xb0aaa0, x, z);
    for (const s2 of [-0.7, 0.7]) kitGeo('kit', new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10).rotateZ(nx ? 0 : Math.PI / 2).rotateX(nx ? Math.PI / 2 : 0).translate(x + (nx ? 0 : s2) + nx * 0.2, FLOOR + 0.2, z + (nx ? s2 : 0) + nz * 0.2), 0x1a1a1a, x, z);
    for (const s2 of [-0.85, 0.85]) kitBox('metal', x + (nx ? 0 : s2) + nx * 0.4, FLOOR + 0.95, z + (nx ? s2 : 0) + nz * 0.4, 0.04, 1.3, 0.04, 0x2a2c30, x, z);
    kitBox('kit', x, FLOOR + 2.25, z, lx + 0.5, 0.06, lz + 0.5, pick(AWN), x, z);
    const bulb = new THREE.BoxGeometry(0.16, 0.16, 0.16).toNonIndexed(); bulb.translate(x, FLOOR + 2.1, z); put(tier === 0 ? 'kit' : 'lamp', x, z, bulb);
    solid(x - lx / 2, z - lz / 2, x + lx / 2, z + lz / 2, 1);
    carts.push({ x, z, nx, nz });
  };
  const benches: { x: number; z: number; yaw: number }[] = [];
  let manholes: THREE.Object3D | null = null;
  for (const b of BLOCKS) furnish(b);
  for (let z = -86; z < 306; z += 14) { lampAt(-279.5, z, 1, 0); if (z % 28 === 0) benchAt(-276, z + 7, 1, 0); else trees.push([-262, z + 7, 0.9]); }
  // the promenade's own trade: a food cart every so often, facing the walkers
  for (let z = -60; z < 300; z += 52 + Math.floor(rnd() * 20)) cartAt(-266, z + 3, -1, 0);

  // trees: a trunk and a broad crown, merged per zone
  {
    const crown = broadCrown([[0, 5.2, 0, 2.2], [1.4, 4.6, 0.4, 1.6], [-1.2, 4.8, -0.6, 1.7], [0.3, 4.4, -1.4, 1.5], [-0.4, 4.3, 1.3, 1.5]], CROWN_LODS[rich ? 1 : 2], rich ? 1 : 0.7, 21);
    const trunk = new THREE.CylinderGeometry(0.12, 0.2, 4.4, 6).toNonIndexed(); trunk.translate(0, 2.2, 0);
    { const n = trunk.attributes.position.count, a = new Float32Array(n * 3).fill(0.32); for (let i = 0; i < n; i++) { a[i * 3] = 0.36; a[i * 3 + 2] = 0.26; } trunk.setAttribute('color', new THREE.BufferAttribute(a, 3)); trunk.deleteAttribute('uv'); }
    const cr = crown.index ? crown.toNonIndexed() : crown;
    for (const [x, z, s] of trees) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, FLOOR, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), new THREE.Vector3(s, s * (0.9 + rnd() * 0.2), s));
      put('kit', x, z, trunk.clone().applyMatrix4(m));
      const c = cr.clone().applyMatrix4(m); put('leaf', x, z, c);
      solid(x - 0.25, z - 0.25, x + 0.25, z + 0.25, 4);
    }
  }

  // ---- pools of lamplight on the pavement and the road: one additive draw, brighter as night comes ----
  const poolTex = canvasTex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 4, 64, 64, 62); r.addColorStop(0, 'rgba(255,214,160,.85)'); r.addColorStop(0.5, 'rgba(255,200,140,.3)'); r.addColorStop(1, 'rgba(255,200,140,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, toneMapped: false });
  const poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2);
  // under every lamp, and spilling out of every shop window on to its pavement
  const spills = shopfronts.map((sf) => new THREE.Vector3(sf.x + sf.nx * 2.2, FLOOR + 0.02, sf.z + sf.nz * 2.2));
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, Math.max(1, lamps.length + spills.length));
  lamps.forEach((l, i) => pools.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(l.x, FLOOR + 0.02, l.z), new THREE.Quaternion(), new THREE.Vector3(18, 1, 18))));
  spills.forEach((l, i) => pools.setMatrixAt(lamps.length + i, new THREE.Matrix4().compose(l, new THREE.Quaternion(), new THREE.Vector3(8, 1, 8))));
  pools.frustumCulled = false; add(pools);

  // ---- manhole covers and drain grates set into the roads: one instanced draw ----
  {
    const tex = canvasTex(128, 128, (g) => {
      g.fillStyle = '#2a2a2c'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill();
      g.strokeStyle = '#55565a'; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.stroke(); g.lineWidth = 3;
      for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(64 + i * 14, 20); g.lineTo(64 + i * 14, 108); g.stroke(); g.beginPath(); g.moveTo(20, 64 + i * 14); g.lineTo(108, 64 + i * 14); g.stroke(); }
    });
    const at: [number, number][] = [];
    for (const r of ROADS) if (r.cars) for (let u = r.a + 17; u < r.b - 10; u += 31 + rnd() * 14) { const off = pick([-4.3, -1.5, 1.7, 4.4]); if (!atNode(r.along === 'z' ? r.c : u, r.along === 'z' ? u : r.c, 10)) at.push(r.along === 'z' ? [r.c + off, u] : [u, r.c + off]); }
    const g = new THREE.CircleGeometry(0.42, 20); g.rotateX(-Math.PI / 2);
    const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }), Math.max(1, at.length));
    at.forEach(([x, z], i) => im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0.006, z)));
    im.count = at.length; im.frustumCulled = false; im.receiveShadow = true; add(im); manholes = im;
  }

  // ---- shop signs over the street floor, billboards on the roofs: two atlases, instanced ----
  const COLS = 4, sw = 512, shh = 96;
  const signAtlas = canvasTex(sw * COLS, shh * Math.ceil(BRANDS.length / COLS), (g) => BRANDS.forEach(([n, fg, bg], i) => {
    const x = (i % COLS) * sw, y = Math.floor(i / COLS) * shh;
    g.fillStyle = bg; g.fillRect(x, y, sw, shh); g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(x + 4, y + 4, sw - 8, shh - 8);
    g.fillStyle = fg; g.shadowColor = fg; g.shadowBlur = 10; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 50px Rajdhani, "Noto Sans Devanagari", "Noto Nastaliq Urdu", sans-serif'; g.fillText(n, x + sw / 2, y + shh / 2 + 3, sw - 30); g.shadowBlur = 0;
  }));
  const signRows = Math.ceil(BRANDS.length / COLS);
  const signList = shopfronts.filter(() => rnd() < 0.85).map((s) => {
    const y = FLOOR + s.fh * 0.855, w = Math.min(s.w, 6.5), h = Math.min(s.fh * 0.17, w * shh / sw * 1.15);
    return { x: s.x + s.nx * 0.24, y, z: s.z + s.nz * 0.24, w: Math.min(w, h * sw / shh * 0.95), h, yaw: Math.atan2(s.nx, s.nz), tile: s.brand };
  });
  // a projecting sign on a bracket at the shop's edge, square to the wall: the one you read from down the street
  for (const s of shopfronts) {
    if (s.fh > 4 || rnd() > 0.55) continue;
    const tx = Math.abs(s.nz), tz = Math.abs(s.nx), along = (rnd() < 0.5 ? -1 : 1) * (s.w / 2 - 0.2), out = 0.95, y = FLOOR + s.fh + 0.75;
    const x = s.x + s.nx * out + tx * along, z = s.z + s.nz * out + tz * along, yaw = Math.atan2(tx, tz);
    for (const k of [0, 1]) signList.push({ x: x + tx * (k ? -0.03 : 0.03), y, z: z + tz * (k ? -0.03 : 0.03), w: 1.7, h: 0.32, yaw: yaw + k * Math.PI, tile: s.brand });
    kitBox('metal', s.x + s.nx * 0.55 + tx * along, y + 0.17, s.z + s.nz * 0.55 + tz * along, s.nx ? 1.1 : 0.05, 0.05, s.nx ? 0.05 : 1.1, 0x26292d, s.x, s.z);
    kitBox('kit', x, y - 0.19, z, s.nx ? 1.8 : 0.1, 0.4, s.nx ? 0.1 : 1.8, 0x14151a, s.x, s.z);
  }
  const signs = atlasPlanes(signAtlas, COLS, signRows, signList);
  add(signs.mesh);
  const adAtlas = canvasTex(1024, 512 * ADS.length, (g) => ADS.forEach(([a, b, fg, bg], i) => {
    const y = i * 512, gr = g.createLinearGradient(0, y, 1024, y + 512); gr.addColorStop(0, bg); gr.addColorStop(1, '#05060a');
    g.fillStyle = gr; g.fillRect(0, y, 1024, 512); g.textAlign = 'center';
    g.fillStyle = fg; g.shadowColor = fg; g.shadowBlur = 24; g.font = '700 120px Rajdhani, "Noto Sans Devanagari", "Noto Nastaliq Urdu", sans-serif'; g.fillText(a, 512, y + 230, 960);
    g.shadowBlur = 0; g.fillStyle = '#ffffff'; g.font = '500 58px Rajdhani, "Noto Sans Devanagari", "Noto Nastaliq Urdu", sans-serif'; g.fillText(b, 512, y + 360, 960);
  }));
  const bill = footprints.filter((f) => f.h > 18 && f.h < 60 && rnd() < 0.3).map((f) => {
    const w = Math.min(14, f.x1 - f.x0 - 2), side = rnd() < 0.5 ? -1 : 1;
    return { x: (f.x0 + f.x1) / 2, y: f.h + 1.5 + w * 0.25, z: side < 0 ? f.z0 + 0.6 : f.z1 - 0.6, w, h: w * 0.5, yaw: side < 0 ? Math.PI : 0, tile: Math.floor(rnd() * ADS.length) };
  });
  const ads = atlasPlanes(adAtlas, 1, ADS.length, bill, true); add(ads.mesh);
  for (const b of bill) kitBox('metal', b.x, b.y - b.h / 2 - 1.5, b.z, 0.3, 1.5, 0.3, 0x30343a, b.x, b.z);

  // ---- traffic signals at every junction where three or more roads meet ----
  const sigNodes = nodes.map((n) => ({ ...n, arms: [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => ROADS.some((r) => r.cars && (dx ? r.along === 'x' && Math.abs(r.c - n.z) < 0.1 && (dx > 0 ? r.b > n.x + 1 : r.a < n.x - 1) : r.along === 'z' && Math.abs(r.c - n.x) < 0.1 && (dz > 0 ? r.b > n.z + 1 : r.a < n.z - 1)))) }))
    .filter((n) => n.arms.length >= 3);
  const bulbs: { x: number; y: number; z: number; axis: 'x' | 'z'; k: number }[] = [];
  for (const n of sigNodes) for (const [dx, dz] of n.arms) {
    // a post on the near-side kerb of each arm, its head facing the traffic coming in on it
    const px = n.x + dx * 8.4 + (dz ? 6.8 * (dz > 0 ? -1 : 1) : 0) * -1, pz = n.z + dz * 8.4 + (dx ? 6.8 * (dx > 0 ? 1 : -1) : 0);
    kitBox('metal', px, FLOOR, pz, 0.18, 3.4, 0.18, 0x2a2e33, px, pz);
    kitBox('metal', px, FLOOR + 3.2, pz, dz ? 0.34 : 0.34, 1.0, 0.34, 0x1a1c1f, px, pz);
    for (let k = 0; k < 3; k++) bulbs.push({ x: px + dx * 0.18, y: FLOOR + 4.0 - k * 0.3, z: pz + dz * 0.18, axis: dx ? 'x' : 'z', k });
    solid(px - 0.12, pz - 0.12, px + 0.12, pz + 0.12, 4);
  }
  const bulbM = new THREE.MeshBasicMaterial({ toneMapped: false });
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6), bulbM, Math.max(1, bulbs.length));
  bulbs.forEach((b, i) => bulbMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(b.x, b.y, b.z)));
  add(bulbMesh);
  const OFF = new THREE.Color(0x101010), RED = new THREE.Color(3, 0.3, 0.2), AMB = new THREE.Color(3, 1.8, 0.2), GRN = new THREE.Color(0.3, 3, 1.2);
  // phase: 0 x-roads go, 1 x amber, 2 z-roads go, 3 z amber
  const CYCLE = [14, 2.5, 14, 2.5];
  let phase = -1;
  const phaseAt = (t: number) => { const T = CYCLE.reduce((a, b) => a + b, 0); let u = t % T; for (let i = 0; i < 4; i++) { if (u < CYCLE[i]) return i; u -= CYCLE[i]; } return 0; };
  /** Can traffic along this axis go now (green)? */
  const go = (axis: 'x' | 'z') => (axis === 'x' ? phase === 0 : phase === 2);
  const setBulbs = () => {
    bulbs.forEach((b, i) => {
      const green = go(b.axis), amber = b.axis === 'x' ? phase === 1 : phase === 3;
      const c = b.k === 0 ? (!green && !amber ? RED : OFF) : b.k === 1 ? (amber ? AMB : OFF) : green ? GRN : OFF;
      bulbMesh.setColorAt(i, c);
    });
    if (bulbMesh.instanceColor) bulbMesh.instanceColor.needsUpdate = true;
  };

  // ---- merge every zone's pieces: one mesh per kind per zone ----
  const kindMat: Record<string, THREE.Material> = { road: o.road, pave: o.paving, mark: markM, kit: kitM, trim: kitM, roof: kitM, metal: metalM, lamp: lampM, leaf: leafM, grass: grassM, wall_plaster: wallMats.plaster, wall_brick: wallMats.brick, wall_glass: wallMats.glass };
  const NEAR_KINDS = new Set(['kit', 'metal', 'lamp', 'leaf', 'mark', 'trim']); // trim (sills, pilasters, cornices) only matters up close
  for (const zn of zones.values()) {
    for (const [kind, gs] of Object.entries(zn.geo)) {
      const gg = gs.map((g) => (g.index ? g.toNonIndexed() : g));
      // the same attributes everywhere in one merge
      const names = Object.keys(gg[0].attributes);
      const ok = gg.filter((g) => names.every((n) => g.attributes[n]) && Object.keys(g.attributes).length === names.length);
      const merged = mergeGeometries(ok, false);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, kindMat[kind]);
      m.castShadow = kind.startsWith('wall') || kind === 'kit' || kind === 'trim' || kind === 'roof' || kind === 'metal' || kind === 'leaf';
      m.receiveShadow = true;
      m.userData.district = kind;
      m.frustumCulled = true;
      add(m);
      if (kind === 'road' || kind === 'pave') m.userData.ground = true;
      if (NEAR_KINDS.has(kind)) zn.near.push(m);
      if (kind.startsWith('wall')) (zn.walls ??= []).push(m);
    }
    zn.geo = {};
  }

  // ---- traffic: cars on lanes, turning at junctions, stopping at red and for anyone on a crossing ----
  type Edge = { r: Road; from: number; to: number; dir: number }; // along the road from `from` to `to` (u values)
  const nodeAt = (x: number, z: number) => sigNodes.find((n) => Math.abs(n.x - x) < 0.1 && Math.abs(n.z - z) < 0.1);
  // every road's junctions along it, worked out once (it was a filter, a map and a sort per car per frame)
  const stopsOf = new Map<Road, { up: number[]; down: number[] }>();
  for (const r of ROADS) { const up = nodes.filter((n) => n.roads.includes(r)).map((n) => (r.along === 'z' ? n.z : n.x)).sort((a, b) => a - b); stopsOf.set(r, { up, down: [...up].reverse() }); }
  interface Car { r: Road; u: number; dir: number; lane: number; v: number; vmax: number; col: THREE.Color; turn: { p0: THREE.Vector3; p1: THREE.Vector3; c: THREE.Vector3; t: number; len: number; next: Road; nu: number; ndir: number } | null; x: number; z: number; yaw: number }
  const carRoads = ROADS.filter((r) => r.cars);
  const cars: Car[] = [];
  const NCAR = [20, 55, 100][tier]; // moving cars; with the recall they keep to the streets round the camera
  /** Past this a moving car or walker is brought back round the camera (cars beyond 420 m are not drawn anyway). */
  const RECALL = [240, 300, 340][tier], PED_RECALL = [170, 210, 240][tier];
  const carCols = [0xf4f4f6, 0x1b1b1f, 0x8a8f96, 0xc0392b, 0x2c3e94, 0x16a085, 0xf2d64b, 0xe8e2d4, 0x5a3a7a, 0xff8c42].map((c) => new THREE.Color(c));
  for (let i = 0; i < NCAR; i++) {
    const r = pick(carRoads), dir = rnd() < 0.5 ? 1 : -1;
    cars.push({ r, u: r.a + 8 + rnd() * (r.b - r.a - 16), dir, lane: rnd() < 0.5 ? 0 : 1, v: 0, vmax: 9 + rnd() * 5, col: pick(carCols), turn: null, x: 0, z: 0, yaw: 0 });
  }
  /** Lane centre offset from the road's centre line: left-hand traffic, inner lane 1.6 m, outer 4.4 m. */
  const laneOff = (dir: number, lane: number, along: 'x' | 'z') => (along === 'z' ? dir : -dir) * (lane ? 4.4 : 1.6);
  /** Streets with cars parked at the kerb have one lane each way (the outer one is the parking). */
  const parkRoads = new Set<Road>();
  const laneOn = (r: Road, lane: number) => (parkRoads.has(r) ? 0 : lane);
  const pos = (r: Road, u: number, dir: number, lane: number, out: THREE.Vector3) => {
    const off = laneOff(dir, laneOn(r, lane), r.along);
    return r.along === 'z' ? out.set(r.c + off, 0, u) : out.set(u, 0, r.c + off);
  };
  // ---- the cars (cars.ts): three draws for every car in the districts ----
  const { bodyG, glassG, lightG, carBodyM, carGlassM, carLightM } = carKit();
  const PARKED = [20, 50, 80][tier];
  const carMesh = [new THREE.InstancedMesh(bodyG, carBodyM, NCAR + PARKED), new THREE.InstancedMesh(glassG, carGlassM, NCAR + PARKED), new THREE.InstancedMesh(lightG, carLightM, NCAR + PARKED)];
  for (const m of carMesh) { m.frustumCulled = false; m.castShadow = tier > 0 && m !== carMesh[2]; add(m); }
  cars.forEach((c, i) => carMesh[0].setColorAt(i, c.col));
  // parked along the outer lane of the quieter streets
  const parked: { x: number; z: number; yaw: number; col: THREE.Color }[] = [];
  /** A car is drawn only within reach and not behind the camera (every car was drawn before, at any distance, in both passes). */
  const CAR_VIS = [170, 240, 300][tier];
  const seen = (x: number, z: number, cam: THREE.Vector3, fx: number, fz: number) => { const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz); return d < 35 || (d < CAR_VIS && (dx * fx + dz * fz) / d > -0.35); };
  for (let i = 0; i < PARKED; i++) {
    const r = pick(carRoads.filter((x) => x.along === 'x')), u = r.a + 14 + rnd() * (r.b - r.a - 28);
    if (nodes.some((n) => Math.abs((r.along === 'x' ? n.x : n.z) - u) < 14)) { i--; continue; }
    const side = rnd() < 0.5 ? 1 : -1;
    parkRoads.add(r);
    parked.push({ x: u, z: r.c + side * 5.2, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, col: pick(carCols) });
    solid(u - 2.4, r.c + side * 5.2 - 1, u + 2.4, r.c + side * 5.2 + 1, 1.5);
  }
  const CM = new THREE.Matrix4(), CQ = new THREE.Quaternion(), CP = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), YAX = new THREE.Vector3(0, 1, 0), T1 = new THREE.Vector3();
  for (const m of carMesh) m.count = 0; // filled each frame with the cars in view (driveCars)
  for (const m of carMesh) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  /** Pick where a car goes at the junction at u on its road: straight on if it can, else a turn. */
  const nextAt = (c: Car, nu: number) => {
    const nx = c.r.along === 'z' ? c.r.c : nu, nz = c.r.along === 'z' ? nu : c.r.c;
    const opts: { r: Road; dir: number }[] = [];
    for (const r of carRoads) {
      const on = r.along === 'z' ? Math.abs(r.c - nx) < 0.1 && nz >= r.a - 0.1 && nz <= r.b + 0.1 : Math.abs(r.c - nz) < 0.1 && nx >= r.a - 0.1 && nx <= r.b + 0.1;
      if (!on) continue;
      const u = r.along === 'z' ? nz : nx;
      for (const dir of [1, -1]) {
        if (dir > 0 ? u > r.b - 8 : u < r.a + 8) continue;
        if (r === c.r && dir !== c.dir) continue; // no U-turns
        opts.push({ r, dir });
      }
    }
    if (!opts.length) return { r: c.r, dir: -c.dir };
    const straight = opts.find((q) => q.r === c.r);
    return straight && rnd() < 0.55 ? straight : pick(opts);
  };
  /**
   * Life follows the camera: a car far out of sight is moved to a road near the camera, out of view (70 to 170 m off
   * along its road, behind the camera or far enough not to pop), so the streets you are in have their traffic.
   */
  let carRR = 0;
  const recallCar = (c: Car, cam: THREE.Vector3, fx: number, fz: number) => {
    for (let tries = 0; tries < 4; tries++) {
      const r = pick(carRoads), perp = r.along === 'z' ? Math.abs(cam.x - r.c) : Math.abs(cam.z - r.c);
      if (perp > 120) continue;
      const u0 = r.along === 'z' ? cam.z : cam.x, u = u0 + (rnd() < 0.5 ? -1 : 1) * (70 + rnd() * 100);
      if (u < r.a + 12 || u > r.b - 12) continue;
      const st = stopsOf.get(r)!; if (st.up.some((n) => Math.abs(n - u) < 12)) continue;
      const x = r.along === 'z' ? r.c : u, z = r.along === 'z' ? u : r.c, dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
      if ((dx * fx + dz * fz) / d > 0.2) continue; // anywhere ahead: it would be seen to appear
      const dir = rnd() < 0.5 ? 1 : -1, lane = rnd() < 0.5 ? 0 : 1;
      if (cars.some((o) => o !== c && o.r === r && o.dir === dir && o.lane === lane && Math.abs(o.u - u) < 20)) continue;
      c.r = r; c.u = u; c.dir = dir; c.lane = lane; c.turn = null; c.v = c.vmax * 0.8;
      pos(r, u, dir, lane, T1); c.x = T1.x; c.z = T1.z;
      return;
    }
  };
  const crossers: THREE.Vector3[] = []; let crossN = 0; // people on the zebras now, set each frame (the first crossN)
  const driveCars = (dt: number, you: THREE.Vector3 | null, cam: THREE.Vector3, fx: number, fz: number) => {
    const k = Math.min(dt, 0.1);
    // two cars a frame are looked at: one far out of sight comes back round the camera
    for (let j = 0; j < 2 && cars.length; j++) { const c = cars[carRR = (carRR + 1) % cars.length]; if (Math.hypot(c.x - cam.x, c.z - cam.z) > RECALL) recallCar(c, cam, fx, fz); }
    let slot = 0;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const far = !seen(c.x, c.z, cam, fx, fz);
      if (c.turn) {
        const tr = c.turn;
        // a turning car gives way to anyone on the crossing it is turning over
        let clear = true;
        for (let ci = 0; ci < crossN; ci++) { const p = crossers[ci], dx = p.x - c.x, dz = p.z - c.z; if (dx * dx + dz * dz < 36 && dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw) > -0.5) { clear = false; break; } }
        c.v = clear ? Math.max(c.v, 3) : 0;
        tr.t += (c.v * k) / tr.len;
        if (tr.t >= 1) { c.r = tr.next; c.u = tr.nu; c.dir = tr.ndir; c.turn = null; }
        else {
          const t = tr.t, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), d = t * t;
          const nx = a * tr.p0.x + b * tr.c.x + d * tr.p1.x, nz = a * tr.p0.z + b * tr.c.z + d * tr.p1.z;
          c.yaw = Math.atan2(nx - c.x, nz - c.z) || c.yaw; c.x = nx; c.z = nz;
        }
      }
      if (!c.turn) {
        // the next junction ahead on this road and its stop line
        const st = stopsOf.get(c.r)!, ahead = c.dir > 0 ? st.up.find((s) => s > c.u + 0.5) : st.down.find((s) => s < c.u - 0.5);
        let want = c.vmax;
        const endU = c.dir > 0 ? c.r.b - 8 : c.r.a + 8;
        const nu = ahead ?? endU, gap = (nu - c.u) * c.dir;
        const sig = ahead !== undefined ? nodeAt(c.r.along === 'z' ? c.r.c : ahead, c.r.along === 'z' ? ahead : c.r.c) : undefined;
        const stopD = gap - 12.4; // the front bumper at the stop line, short of the zebra (6.6 to 9.8 m out)
        if (sig && !go(c.r.along) && stopD > -0.5) want = Math.min(want, Math.max(0, stopD) * 0.9);
        // the car ahead in the same lane
        for (const o of cars) if (o !== c && !o.turn && o.r === c.r && o.dir === c.dir && laneOn(o.r, o.lane) === laneOn(c.r, c.lane)) { const g = (o.u - c.u) * c.dir; if (g > 0 && g < 30) want = Math.min(want, Math.max(0, g - 6.5) * 0.8); }
        // anyone on the road in front: a walker on a zebra, or you
        pos(c.r, c.u, c.dir, c.lane, T1);
        for (let ci = 0; ci < crossN; ci++) { const p = crossers[ci]; const fx = (c.r.along === 'z' ? p.z - T1.z : p.x - T1.x) * c.dir, sx = c.r.along === 'z' ? p.x - T1.x : p.z - T1.z; if (fx > -1 && fx < 18 && Math.abs(sx) < 1.9) want = Math.min(want, Math.max(0, fx - 4.6) * 0.8); }
        if (you) { const fx = (c.r.along === 'z' ? you.z - T1.z : you.x - T1.x) * c.dir, sx = c.r.along === 'z' ? you.x - T1.x : you.z - T1.z; if (fx > 0 && fx < 16 && Math.abs(sx) < 1.9) want = Math.min(want, Math.max(0, fx - 4) * 0.7); }
        c.v += (want - c.v) * (1 - Math.exp(-k * (want < c.v ? 4 : 1.2)));
        c.u += c.dir * c.v * k;
        if (gap - c.v * k <= 0.3 + 6.2) {
          // into the junction: a curve from here to the lane of the road it takes
          const n = nextAt(c, nu);
          const p0 = pos(c.r, c.u, c.dir, c.lane, new THREE.Vector3());
          const exitU = (n.r.along === 'z' ? (c.r.along === 'z' ? nu : c.r.c) : (c.r.along === 'x' ? nu : c.r.c)) + n.dir * 7;
          const lane = n.r === c.r ? c.lane : rnd() < 0.5 ? 0 : 1;
          const p1 = pos(n.r, exitU, n.dir, lane, new THREE.Vector3());
          const corner = new THREE.Vector3(c.r.along === 'z' ? p0.x : p1.x, 0, c.r.along === 'z' ? p1.z : p0.z);
          const ctl = n.r === c.r ? p0.clone().add(p1).multiplyScalar(0.5) : corner;
          if (n.r === c.r && n.dir === -c.dir) { c.dir = -c.dir; } // a dead end: turn round
          else { c.turn = { p0, p1, c: ctl, t: 0, len: Math.max(4, p0.distanceTo(p1) * 1.1), next: n.r, nu: exitU, ndir: n.dir }; c.lane = lane; }
        }
        if (!c.turn) { pos(c.r, c.u, c.dir, c.lane, T1); c.x = T1.x; c.z = T1.z; c.yaw = c.r.along === 'z' ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2); }
      }
      if (far) continue;
      CQ.setFromAxisAngle(YAX, c.yaw);
      CM.compose(CP.set(c.x, 0.02, c.z), CQ, ONE);
      for (const m of carMesh) m.setMatrixAt(slot, CM);
      carMesh[0].setColorAt(slot++, c.col);
    }
    // the parked ones too: only those near enough and not behind the camera take a slot
    for (const p of parked) {
      if (!seen(p.x, p.z, cam, fx, fz)) continue;
      CM.compose(CP.set(p.x, 0.02, p.z), CQ.setFromAxisAngle(YAX, p.yaw), ONE);
      for (const m of carMesh) m.setMatrixAt(slot, CM);
      carMesh[0].setColorAt(slot++, p.col);
    }
    for (const m of carMesh) { m.count = slot; m.instanceMatrix.needsUpdate = true; }
    if (carMesh[0].instanceColor) carMesh[0].instanceColor.needsUpdate = true;
  };

  // ---- people: walkers round the blocks, crossing at the zebras; others sit, shop, chat, film, wait for a bus ----
  type Ped = { b: Block; s: number; dir: number; off: number; v: number; mode: 'walk' | 'wait' | 'cross' | 'stay'; pose: string; x: number; z: number; yaw: number; t: number; cross?: { x0: number; z0: number; x1: number; z1: number; axis: 'x' | 'z'; nb: Block; ns: number } };
  const walkBlocks = BLOCKS.filter((b) => b.kind !== 'park');
  const ring = (b: Block, off: number) => ({ x0: b.x0 + 6 + off, x1: b.x1 - 6 - off, z0: b.z0 + 6 + off, z1: b.z1 - 6 - off });
  const perim = (b: Block, off: number) => { const R = ring(b, off); return 2 * (R.x1 - R.x0 + R.z1 - R.z0); };
  const onRing = (b: Block, off: number, s: number, out: { x: number; z: number; yaw: number }) => {
    const R = ring(b, off), W = R.x1 - R.x0, H = R.z1 - R.z0, P = 2 * (W + H);
    let u = ((s % P) + P) % P;
    if (u < W) { out.x = R.x0 + u; out.z = R.z0; out.yaw = Math.PI / 2; return out; } u -= W;
    if (u < H) { out.x = R.x1; out.z = R.z0 + u; out.yaw = 0; return out; } u -= H;
    if (u < W) { out.x = R.x1 - u; out.z = R.z1; out.yaw = -Math.PI / 2; return out; } u -= W;
    out.x = R.x0; out.z = R.z1 - u; out.yaw = Math.PI; return out;
  };
  const peds: Ped[] = [];
  const NPED = [60, 130, 190][tier]; // walkers in the whole district grid; the recall keeps them round the camera
  const P0 = { x: 0, z: 0, yaw: 0 };
  for (let i = 0; i < NPED; i++) {
    const b = pick(walkBlocks), off = 0.9 + rnd() * 2.4, s = rnd() * perim(b, off);
    const p: Ped = { b, s, dir: rnd() < 0.5 ? 1 : -1, off, v: 1.0 + rnd() * 0.6, mode: 'walk', pose: 'walk', x: 0, z: 0, yaw: 0, t: 0 };
    onRing(b, off, s, P0); p.x = P0.x; p.z = P0.z; p.yaw = P0.yaw;
    peds.push(p);
  }
  // people staying put: on the benches, at shop windows, chatting in twos and threes, filming, waiting at shelters
  const stayPoses = ['idle', 'selfie', 'write', 'idle', 'sit']; // no stock emotes on a loop: standing, on the phone, writing, sitting
  for (const bn of benches.filter(() => rnd() < 0.5)) peds.push({ b: walkBlocks[0], s: 0, dir: 1, off: 0, v: 0, mode: 'stay', pose: 'sit', x: bn.x, z: bn.z, yaw: bn.yaw + Math.PI, t: 0 });
  for (const sf of shopfronts.filter(() => rnd() < (rich ? 0.12 : 0.07))) {
    const n = rnd() < 0.5 ? 1 : 2 + Math.floor(rnd() * 2), bx = sf.x + sf.nx * 1.6, bz = sf.z + sf.nz * 1.6;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + rnd(), r = n > 1 ? 0.7 : 0;
      const x = bx + Math.cos(a) * r, z = bz + Math.sin(a) * r;
      peds.push({ b: walkBlocks[0], s: 0, dir: 1, off: 0, v: 0, mode: 'stay', pose: n > 1 ? 'idle' : pick(stayPoses), x, z, yaw: n > 1 ? Math.atan2(bx - x, bz - z) : Math.atan2(-sf.nx, -sf.nz), t: 0 });
    }
  }
  // the cooks at their carts (on the road side, facing the pavement) and whoever is buying
  for (const c of carts) {
    peds.push({ b: walkBlocks[0], s: 0, dir: 1, off: 0, v: 0, mode: 'stay', pose: 'idle', x: c.x + c.nx * 0.85, z: c.z + c.nz * 0.85, yaw: Math.atan2(-c.nx, -c.nz), t: 0 });
    for (let j = 0, n = Math.floor(rnd() * (rich ? 3 : 2)); j < n; j++) {
      const sh = (j - (n - 1) / 2) * 0.8;
      peds.push({ b: walkBlocks[0], s: 0, dir: 1, off: 0, v: 0, mode: 'stay', pose: pick(['idle', 'idle', 'selfie']), x: c.x - c.nx * 1.05 + (c.nx ? 0 : sh), z: c.z - c.nz * 1.05 + (c.nx ? sh : 0), yaw: Math.atan2(c.nx, c.nz), t: 0 });
    }
  }
  // a cafe's chairs: most have someone in them of an evening
  for (const c of cafes) if (rnd() < (rich ? 0.45 : 0.2)) peds.push({ b: walkBlocks[0], s: 0, dir: 1, off: 0, v: 0, mode: 'stay', pose: pick(['idle', 'selfie', 'idle', 'write']), x: c.x - Math.sin(c.yaw) * 0.35, z: c.z - Math.cos(c.yaw) * 0.35, yaw: c.yaw, t: 0 }); // standing by the table: the sit clip is for the ground
  // along the sea rail: people looking out over the bay, alone or in twos, filming the sunset
  for (let z = -80; z < 300; z += 9 + rnd() * 14) {
    const n = rnd() < 0.6 ? 1 : 2;
    for (let j = 0; j < n; j++) peds.push({ b: walkBlocks[0], s: 0, dir: 1, off: 0, v: 0, mode: 'stay', pose: pick(['idle', 'selfie', 'idle']), x: -279.4 + rnd() * 0.3, z: z + j * 0.7, yaw: -Math.PI / 2 + (rnd() - 0.5) * 0.6, t: 0 });
  }
  // the park: strollers on its paths, people on the lawns
  for (let i = 0; i < (rich ? 40 : 14); i++) {
    const x = (rnd() - 0.5) * 150, z = 205 + rnd() * 90;
    if (Math.hypot(x - 40, z - 262) < 17) continue;
    peds.push({ b: walkBlocks[0], s: 0, dir: 1, off: 0, v: 0, mode: 'stay', pose: pick(['sit', 'idle', 'selfie', 'sit', 'idle']), x, z, yaw: rnd() * 6.28, t: 0 });
  }
  const pedSolid = (x: number, z: number) => solids.some((b) => b.max.y > 0.8 && x > b.min.x - 0.3 && x < b.max.x + 0.3 && z > b.min.z - 0.3 && z < b.max.z + 0.3);
  for (let i = peds.length - 1; i >= 0; i--) if (peds[i].mode === 'stay' && peds[i].pose !== 'sit' && pedSolid(peds[i].x, peds[i].z)) peds.splice(i, 1);
  /** Where a walker at a corner can cross to: the block across the road, straight on. */
  const across = (p: Ped, yaw0: number) => {
    const R = ring(p.b, p.off);
    const atX = Math.abs(p.x - R.x0) < 0.6 ? -1 : Math.abs(p.x - R.x1) < 0.6 ? 1 : 0, atZ = Math.abs(p.z - R.z0) < 0.6 ? -1 : Math.abs(p.z - R.z1) < 0.6 ? 1 : 0;
    if (!atX || !atZ) return null;
    // keep the way they were going: walking along x at this corner crosses the z-road ahead, and so on
    const alongX = Math.abs(Math.sin(yaw0)) > 0.7;
    const dx = alongX ? atX : 0, dz = alongX ? 0 : atZ;
    const nb = walkBlocks.find((b) => (dx ? (dx > 0 ? Math.abs(b.x0 - p.b.x1) < 1 : Math.abs(b.x1 - p.b.x0) < 1) && b.z0 === p.b.z0 : (dz > 0 ? Math.abs(b.z0 - p.b.z1) < 1 : Math.abs(b.z1 - p.b.z0) < 1) && b.x0 === p.b.x0));
    if (!nb) return null;
    const R2 = ring(nb, p.off);
    const x1 = dx ? (dx > 0 ? R2.x0 : R2.x1) : p.x, z1 = dz ? (dz > 0 ? R2.z0 : R2.z1) : p.z;
    // the same corner on the new block's ring
    let ns = 0; const W2 = R2.x1 - R2.x0, H2 = R2.z1 - R2.z0;
    if (Math.abs(z1 - R2.z0) < 0.6) ns = Math.abs(x1 - R2.x0) < 0.6 ? 0 : W2; else ns = Math.abs(x1 - R2.x1) < 0.6 ? W2 + H2 : 2 * W2 + H2;
    return { x0: p.x, z0: p.z, x1, z1, axis: (dx ? 'z' : 'x') as 'x' | 'z', nb, ns };
  };
  /** Walkers too: one far away is put on a pavement near the camera where it is not looking (55 to 140 m off). */
  let pedRR = 0, nearPeds = 0;
  const PED_NEAR = [28, 70, 110][tier];
  const recallPed = (p: Ped, cam: THREE.Vector3, fx: number, fz: number) => {
    for (let tries = 0; tries < 5; tries++) {
      const b = pick(walkBlocks), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      if (Math.hypot(cx - cam.x, cz - cam.z) > 170) continue;
      const s2 = rnd() * perim(b, p.off); onRing(b, p.off, s2, P0);
      const dx = P0.x - cam.x, dz = P0.z - cam.z, d = Math.hypot(dx, dz);
      if (d < 55 || d > 140 || (dx * fx + dz * fz) / d > 0.2) continue; // never in view: nobody pops in
      p.b = b; p.s = s2; p.mode = 'walk'; p.cross = undefined; p.x = P0.x; p.z = P0.z; p.yaw = p.dir > 0 ? P0.yaw : P0.yaw + Math.PI;
      return;
    }
  };
  const walkPeds = (dt: number, you: THREE.Vector3 | null, cam: THREE.Vector3, fx: number, fz: number) => {
    crossN = 0;
    // no more than so many walkers round the camera (phones draw them all as cards, but each costs a little)
    if (nearPeds < PED_NEAR) for (let j = 0; j < 4 && peds.length; j++) { const p = peds[pedRR = (pedRR + 1) % peds.length]; if (p.mode === 'walk' && Math.hypot(p.x - cam.x, p.z - cam.z) > PED_RECALL) recallPed(p, cam, fx, fz); }
    let n = 0; for (const p of peds) if (Math.abs(p.x - cam.x) < 140 && Math.abs(p.z - cam.z) < 140) n++; nearPeds = n;
    for (const p of peds) {
      if (p.mode === 'stay') continue;
      if (p.mode === 'walk') {
        // turning a corner: sometimes cross the road instead (at the zebra, when the lights let them)
        const R = ring(p.b, p.off), W = R.x1 - R.x0, H = R.z1 - R.z0, P = 2 * (W + H);
        const side = (u: number) => (u < W ? 0 : u < W + H ? 1 : u < 2 * W + H ? 2 : 3);
        const before = side(p.s), yaw0 = p.yaw;
        p.s = (((p.s + p.dir * p.v * dt) % P) + P) % P;
        const hit = side(p.s) !== before;
        onRing(p.b, p.off, p.s, P0);
        // step round you, like the bazaar's walkers
        let ox = 0, oz = 0;
        if (you) { const dx = you.x - P0.x, dz = you.z - P0.z, d = Math.hypot(dx, dz); if (d < 1.4 && d > 1e-3) { ox = -dx / d * (1.4 - d); oz = -dz / d * (1.4 - d); } }
        p.x = P0.x + ox; p.z = P0.z + oz; p.yaw = p.dir > 0 ? P0.yaw : P0.yaw + Math.PI;
        if (hit && rnd() < 0.45) { const c = across(p, yaw0); if (c) { p.cross = c; p.mode = 'wait'; p.t = 0; } }
      } else if (p.mode === 'wait') {
        p.t += dt;
        // walk when traffic along the road being crossed has a red, and not into the amber
        const cr = p.cross!;
        // and only when no car is on or at the crossing (one already over the line drives on)
        let ok = cr.axis === 'z' ? phase === 0 : phase === 2;
        if (ok) for (const c of cars) { const ex = cr.x1 - cr.x0, ez = cr.z1 - cr.z0, L2 = ex * ex + ez * ez || 1, tt = Math.max(0, Math.min(1, ((c.x - cr.x0) * ex + (c.z - cr.z0) * ez) / L2)), dx = c.x - (cr.x0 + ex * tt), dz = c.z - (cr.z0 + ez * tt); if (dx * dx + dz * dz < 20) { ok = false; break; } }
        p.yaw = Math.atan2(cr.x1 - cr.x0, cr.z1 - cr.z0);
        if (ok && p.t > 0.4) { p.mode = 'cross'; p.t = 0; }
      } else {
        const cr = p.cross!, L = Math.hypot(cr.x1 - cr.x0, cr.z1 - cr.z0);
        p.t += (p.v * 1.15 * dt) / L;
        if (p.t >= 1) { p.b = cr.nb; p.s = cr.ns; p.mode = 'walk'; p.cross = undefined; }
        else { p.x = cr.x0 + (cr.x1 - cr.x0) * p.t; p.z = cr.z0 + (cr.z1 - cr.z0) * p.t; (crossers[crossN] ??= new THREE.Vector3()).set(p.x, 0, p.z); crossN++; }
      }
    }
  };

  // ---- streaming: what is small is drawn only within reach of the camera ----
  const NEAR_R = [130, 210, 260][tier];
  const ground: THREE.Object3D[] = [], extras: THREE.Object3D[] = [];
  scene.traverse((x) => { const k = x.userData.district as string | undefined; if (k === 'road' || k === 'pave' || k === 'grass') ground.push(x); });
  extras.push(signs.mesh, ads.mesh, pools, bulbMesh, ...carMesh); if (manholes) extras.push(manholes);
  let wasDeep = false;
  const FWD = new THREE.Vector3();
  let lastPhase = -2, acc = 0;
  return {
    solids,
    height: districtHeight,
    peds,
    /** Test hook: where every moving car is (x, z, yaw) and every walker (x, z, crossing?). */
    traffic: () => ({ cars: cars.map((c) => [c.x, c.z, c.yaw]), peds: peds.map((p) => [p.x, p.z, p.mode === 'cross' ? 1 : 0, p.mode !== 'cross' && !inOld(p.x, p.z) && districtHeight(p.x, p.z) < 0.07 ? 1 : 0]) }),
    nodes: sigNodes,
    bounds: BOUNDS,
    footprints,
    covers,
    update(dt: number, t: number, cam: THREE.Camera | null, you: THREE.Vector3 | null, deep = false) {
      phase = phaseAt(t);
      if (phase !== lastPhase) { lastPhase = phase; setBulbs(); }
      if (waterTex) waterTex.offset.set(t * 0.004, t * 0.0025);
      lampM.emissiveIntensity = 0.2 + FACADE.night.value * 5;
      // a wet road does not glow under a lamp, it mirrors it: the pools thin out as the street gets wetter
      poolMat.opacity = Math.min(0.75, 0.12 + FACADE.night.value * 0.9) * (1.15 - 0.75 * FACADE.wet.value);
      if (!cam) return;
      acc += dt;
      if (acc > 0.25) {
        acc = 0;
        // deep in the old town none of the districts' streets shows (their buildings still stand over its roofs)
        for (const zn of zones.values()) { const d = Math.hypot(zn.cx - cam.position.x, zn.cz - cam.position.z) - ZONE * 0.7; for (const m of zn.near) m.visible = !deep && d < NEAR_R;
          // phones: from deep in the old town only the nearer districts' buildings stand over its roofs
          if (tier === 0 && zn.walls) for (const m of zn.walls) m.visible = !deep || d < 150; }
        if (deep !== wasDeep) { wasDeep = deep; for (const m of ground) m.visible = !deep; for (const m of extras) m.visible = !deep; }
      }
      if (deep) return;
      cam.getWorldDirection(FWD); const fl = Math.hypot(FWD.x, FWD.z) || 1;
      walkPeds(dt, you, cam.position, FWD.x / fl, FWD.z / fl);
      driveCars(dt, you, cam.position, FWD.x / fl, FWD.z / fl);
    },
    /** Collision with the cars for the player (they are solid, and stop for you). */
    carCollide(p: THREE.Vector3, r: number) {
      for (const c of cars) {
        const dx = p.x - c.x, dz = p.z - c.z, s = Math.sin(c.yaw), co = Math.cos(c.yaw);
        const lx = dx * co - dz * s, lz = dx * s + dz * co; // into the car's frame
        if (Math.abs(lx) < 1 + r && Math.abs(lz) < 2.4 + r && p.y < 1.5) {
          const px = Math.abs(lx) / (1 + r), pz = Math.abs(lz) / (2.4 + r);
          let nlx = lx, nlz = lz;
          if (px > pz) nlx = Math.sign(lx || 1) * (1 + r); else nlz = Math.sign(lz || 1) * (2.4 + r);
          p.x = c.x + nlx * co + nlz * s; p.z = c.z - nlx * s + nlz * co;
        }
      }
    },
    /** The map: roads, pavements, buildings, the park, the bay, district names. */
    paint(g: CanvasRenderingContext2D, X: (x: number) => number, Y: (z: number) => number) {
      const R = (x0: number, z0: number, x1: number, z1: number, c: string) => { g.fillStyle = c; g.fillRect(Math.min(X(x0), X(x1)), Math.min(Y(z0), Y(z1)), Math.abs(X(x1) - X(x0)), Math.abs(Y(z1) - Y(z0))); };
      R(-1400, -104, -281, 324, '#16303b');
      for (const b of [...BLOCKS, ...STRIPS]) R(b.x0, b.z0, b.x1, b.z1, '#7d766c');
      for (const r of ROADS) r.along === 'z' ? R(r.c - r.hw, r.a - r.hw, r.c + r.hw, r.b + r.hw, '#34323a') : R(r.a - r.hw, r.c - r.hw, r.b + r.hw, r.c + r.hw, '#34323a');
      for (const b of parks) R(b.x0 + 10, b.z0 + 10, b.x1 - 10, b.z1 - 10, '#4f6b3a');
      g.fillStyle = '#2a5866'; g.beginPath(); g.arc(X(40), Y(262), 14 * Math.abs(X(1) - X(0)), 0, 7); g.fill();
      for (const f of footprints) R(f.x0, f.z0, f.x1, f.z1, f.h > 40 ? '#6a6380' : f.h > 18 ? '#5d566c' : '#544e60');
      g.font = '700 30px Barlow, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(242,235,221,0.85)';
      for (const [k, x, z] of [['downtown', 250, 110], ['midtown', 130, 30], ['market', -130, 110], ['waterfront', -215, 30], ['north', 0, 150], ['park', -40, 250], ['bay', -330, 110]] as [string, number, number][]) g.fillText(o.label(`city.map.d.${k}`), X(x), Y(z));
    },
    debug: () => ({ cars: cars.length, peds: peds.length, zones: zones.size, nodes: sigNodes.length, phase }),
  };
}
let waterTex: THREE.Texture | null = null;

/** Planes that each show one tile of an atlas: one instanced draw. */
function atlasPlanes(t: THREE.Texture, cols: number, rows: number, list: { x: number; y: number; z: number; w: number; h: number; yaw: number; tile: number }[], both = false) {
  // drawn from the front only (two-sided, the words read mirrored from behind); `both`: two faces back to back, each
  // read from its own side (the roof billboards, seen from the streets on both sides)
  const geo = both ? twoFaced(new THREE.PlaneGeometry(1, 1)) : new THREE.PlaneGeometry(1, 1), tile = new Float32Array(Math.max(1, list.length) * 2);
  list.forEach((s, i) => { tile[i * 2] = (s.tile % cols) / cols; tile[i * 2 + 1] = 1 - (Math.floor(s.tile / cols) + 1) / rows; });
  geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tile, 2));
  const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = FACADE.night;
    sh.vertexShader = `attribute vec2 aTile;\n${sh.vertexShader}`.replace('#include <uv_vertex>', `#include <uv_vertex>\n  vMapUv = aTile + vMapUv * vec2(${(1 / cols).toFixed(5)}, ${(1 / rows).toFixed(5)});\n  vEmissiveMapUv = vMapUv;`);
    sh.fragmentShader = `uniform float uNight;\n${sh.fragmentShader}`.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= 0.35 + 1.4 * uNight;');
  };
  m.customProgramCacheKey = () => `atlas-planes|${cols}x${rows}`;
  const mesh = new THREE.InstancedMesh(geo, m, Math.max(1, list.length));
  list.forEach((s, i) => mesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw), new THREE.Vector3(s.w, s.h, 1))));
  mesh.count = list.length; mesh.frustumCulled = false; mesh.userData.ground = false;
  return { mesh };
}
