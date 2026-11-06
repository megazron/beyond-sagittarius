import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { LAKE, Terrain } from './terrain';
import type { Forest } from './forest';
import type { StoryLayout } from './story';
import type { Item, ItemType } from './props';

/** Chapter Two pickups only exist from this level on, so Chapter One is untouched. */
export const RESOURCE_GATE = 11;

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });

/** Real raw materials near the camp, the lake and the ridge. */
export function addResources(items: Item[], group: THREE.Group, terrain: Terrain, forest: Forest, L: StoryLayout) {
  const rnd = mulberry32(1911);
  const rock = new THREE.DodecahedronGeometry(0.17, 0); rock.scale(1, 0.65, 0.85);
  const mound = new THREE.SphereGeometry(0.26, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2); mound.scale(1, 0.5, 1);
  const pool = new THREE.CircleGeometry(0.38, 12); pool.rotateX(-Math.PI / 2);
  const crust = new THREE.RingGeometry(0.34, 0.46, 12); crust.rotateX(-Math.PI / 2);
  const reed = new THREE.CylinderGeometry(0.012, 0.02, 0.9, 4); reed.translate(0, 0.45, 0);
  const nut = new THREE.SphereGeometry(0.075, 7, 5);
  const podG = new THREE.CapsuleGeometry(0.06, 0.1, 3, 6);
  const tuft = new THREE.IcosahedronGeometry(0.11, 0); tuft.scale(1, 0.4, 1);
  const stick = new THREE.CylinderGeometry(0.025, 0.04, 1.0, 5); stick.rotateZ(Math.PI / 2);
  const ringG = new THREE.RingGeometry(0.35, 0.42, 24); ringG.rotateX(-Math.PI / 2);
  const ringM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.4, 2.6), transparent: true, opacity: 0, depthWrite: false });
  const M = {
    nodule: mat(0x2a2c38, { roughness: 0.35 }), skin: mat(0xcfc8b8), clay: mat(0x9a5a3c, { roughness: 0.6 }), sand: mat(0xd8cda8),
    lime: mat(0xd6d2c2), brine: mat(0x8fc8c8, { roughness: 0.15, metalness: 0.1 }), salt: mat(0xf2f0ea), reed: mat(0xa89a4c),
    ash: mat(0x8c8c90), oil: mat(0x6a4a24, { roughness: 0.4 }), pod: mat(0xe0a030, { emissive: 0x402000 }), lichen: mat(0xa03a6a),
    stone: mat(0x8a8494), wood: mat(0x5a4334), moss: mat(0xb59a58),
  };
  const build = (type: ItemType) => {
    const o = new THREE.Group();
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.rotation.y = rnd() * 6; mesh.castShadow = true; o.add(mesh); return mesh;
    };
    const few = (n: number, g: THREE.BufferGeometry, m: THREE.Material, r: number, y: number) => { for (let i = 0; i < n; i++) add(g, m, (rnd() - 0.5) * r, y, (rnd() - 0.5) * r); };
    switch (type) {
      case 'nodule': add(rock, M.nodule, 0, 0.1).scale.setScalar(1.3); add(rock, M.skin, 0.1, 0.13, 0.05).scale.setScalar(0.7); break;
      case 'clay': add(mound, M.clay); break;
      case 'sand': add(mound, M.sand); break;
      case 'limestone': add(rock, M.lime, 0, 0.1).scale.setScalar(1.5); add(rock, M.lime, 0.2, 0.06, 0.1); break;
      case 'brine': add(pool, M.brine, 0, 0.03); add(crust, M.salt, 0, 0.04); break;
      case 'fibre': for (let i = 0; i < 7; i++) add(reed, M.reed, (rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4).rotation.z = (rnd() - 0.5) * 0.3; break;
      case 'ash': add(mound, M.ash).scale.set(1.1, 0.5, 1.1); break;
      case 'oilnut': few(4, nut, M.oil, 0.3, 0.07); break;
      case 'sugarpod': few(3, podG, M.pod, 0.3, 0.09); break;
      case 'lichen': few(5, tuft, M.lichen, 0.4, 0.05); break;
      case 'stone': add(rock, M.stone, 0, 0.08); break;
      case 'branch': add(stick, M.wood, 0, 0.05, 0); break;
      case 'tinder': few(4, tuft, M.moss, 0.25, 0.04); break;
    }
    const ring = new THREE.Mesh(ringG, ringM.clone());
    ring.position.y = 0.02; ring.name = 'ring';
    o.add(ring);
    return o;
  };
  const probe = new THREE.Vector3();
  const scatter = (type: ItemType, count: number, cx: number, cz: number, r0: number, r1: number, opt: { a?: number; spread?: number; h0?: number; h1?: number } = {}) => {
    const { a = 0, spread = Math.PI, h0 = 0.5, h1 = 70 } = opt;
    let k = 0, tries = 0;
    while (k < count && tries < 3000) {
      tries++;
      const ang = a + (rnd() * 2 - 1) * spread, r = r0 + rnd() * (r1 - r0);
      const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
      const h = terrain.height(x, z);
      if (h < h0 || h > h1) continue;
      probe.set(x, 0, z);
      forest.collide(probe, 0.6);
      if (Math.hypot(probe.x - x, probe.z - z) > 0.01) continue;
      const o = build(type);
      o.position.set(x, h + 0.02, z);
      o.visible = false;
      group.add(o);
      items.push({ id: `c2-${type}-${items.length}`, type, obj: o, pos: o.position, active: false, gate: RESOURCE_GATE });
      k++;
    }
  };
  // shore facing the camp
  const shore = { a: Math.atan2(L.camp.z - LAKE.z, L.camp.x - LAKE.x), spread: 1.3, h0: 0.15, h1: 7 };
  scatter('clay', 8, LAKE.x, LAKE.z, LAKE.r - 6, LAKE.r + 14, shore);
  scatter('sand', 8, LAKE.x, LAKE.z, LAKE.r - 6, LAKE.r + 14, shore);
  scatter('fibre', 8, LAKE.x, LAKE.z, LAKE.r - 6, LAKE.r + 14, shore);
  // ridge rock and the seep at its foot
  scatter('nodule', 6, L.ridge.x, L.ridge.z, 4, 26);
  scatter('limestone', 6, L.ridge.x, L.ridge.z, 4, 30);
  scatter('lichen', 5, L.ridge.x, L.ridge.z, 4, 24);
  const foot = { a: Math.atan2(L.camp.z - L.ridge.z, L.camp.x - L.ridge.x), spread: 0.7 };
  scatter('brine', 7, L.ridge.x, L.ridge.z, 30, 60, foot);
  // forest around camp
  scatter('oilnut', 7, L.camp.x, L.camp.z, 18, 60);
  scatter('sugarpod', 7, L.camp.x, L.camp.z, 18, 60);
  // what the fire and the clearing give you
  scatter('ash', 8, L.camp.x, L.camp.z, 2.2, 5.5);
  scatter('stone', 6, L.camp.x, L.camp.z, 8, 26);
  scatter('branch', 14, L.camp.x, L.camp.z, 8, 30);
  scatter('tinder', 4, L.camp.x, L.camp.z, 8, 26);

  // finished work collects around the fire
  const camp = new THREE.Group();
  const kiln = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2), M.clay);
  kiln.position.set(L.camp.x - 2.6, L.camp.y, L.camp.z - 2.2); kiln.castShadow = true;
  const potG = new THREE.CylinderGeometry(0.13, 0.09, 0.26, 8);
  const pots = new THREE.Group();
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(potG, M.clay); m.position.set(L.camp.x + 2.8 + i * 0.32, L.camp.y + 0.13, L.camp.z + 1.2 + (i % 2) * 0.28); m.castShadow = true; pots.add(m); }
  const glass = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), new THREE.MeshStandardMaterial({ color: 0x9fe8d8, roughness: 0.08, transparent: true, opacity: 0.65 }));
  glass.position.set(L.camp.x + 2.9, L.camp.y + 0.36, L.camp.z + 1.3);
  camp.add(kiln, pots, glass);
  group.add(camp);
  return (done: string[]) => {
    pots.visible = done.includes('pottery');
    kiln.visible = done.includes('charcoal');
    glass.visible = done.includes('glass');
  };
}
