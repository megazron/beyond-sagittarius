import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, smoothstep } from '../core/noise';
import type { Quality } from '../core/quality';
import { Terrain, HALF, LAKE } from './terrain';
import { applyBark, applyRock, chainCompile } from './pbr';
import { foliageAtlas, spireCanopy, crownCanopy } from './foliage';

export const windUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

function colorize(g: THREE.BufferGeometry, hex: number, jitter = 0): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = 1 + (Math.random() - 0.5) * jitter;
    arr[i * 3] = c.r * j; arr[i * 3 + 1] = c.g * j; arr[i * 3 + 2] = c.b * j;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.attributes.aBark) g.setAttribute('aBark', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}

/** Marks a geometry as bark and scales its cylinder UVs to ~1.4 m texture tiles. */
function barkify(g: THREE.BufferGeometry, circumference: number, height: number): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  g.setAttribute('aBark', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  const uv = g.attributes.uv;
  const ru = Math.max(1, Math.round(circumference / 1.4)), rv = height / 1.4;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
  return g;
}

/** Tapered cylinder bent along a quadratic curve. */
function bentTrunk(h: number, r0: number, r1: number, bend: number, radial = 9, hs = 8): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, radial, hs, false);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / h;
    p.setX(i, p.getX(i) + bend * y * y * h);
    p.setZ(i, p.getZ(i) + Math.sin(y * 4) * 0.08 * h * 0.1);
  }
  g.computeVertexNormals();
  return barkify(g, Math.PI * (r0 + r1), h);
}

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: [number, number, number] = [1, 1, 1]) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...s));
  g.applyMatrix4(m);
  return g;
}

interface Variant { solid: THREE.BufferGeometry; glow: THREE.BufferGeometry | null; radius: number; leaf?: THREE.BufferGeometry }

/** Three original alien tree species. Units: metres, base at origin. */
function buildVariants(detail: number): Variant[] {
  const out: Variant[] = [];
  // 1. Parasol — bent trunk with a violet cap and glowing hanging tendrils
  {
    const solid: THREE.BufferGeometry[] = [];
    const glow: THREE.BufferGeometry[] = [];
    solid.push(colorize(bentTrunk(9, 0.42, 0.18, 0.12), 0x4a3b3a, 0.15));
    const capTop = new THREE.SphereGeometry(4.2, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
    place(capTop, 1.0, 8.2, 0, 0, 0, 0, [1, 0.42, 1]);
    solid.push(colorize(capTop, 0x6b2f86, 0.25));
    const under = new THREE.CylinderGeometry(3.9, 0.6, 0.8, 20, 1, true);
    place(under, 1.0, 8.0, 0);
    solid.push(colorize(under, 0x2a1838, 0.1));
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 2.2 + (i % 3) * 0.6;
      const len = 1.4 + (i % 4) * 0.5;
      const t = new THREE.CylinderGeometry(0.03, 0.05, len, 4);
      place(t, 1.0 + Math.cos(a) * r, 8.0 - len / 2, Math.sin(a) * r);
      solid.push(colorize(t, 0x3a2a4c));
      const b = new THREE.SphereGeometry(0.16, 8, 6);
      place(b, 1.0 + Math.cos(a) * r, 8.0 - len, Math.sin(a) * r);
      glow.push(colorize(b, 0x37e6ff));
    }
    const rim = new THREE.TorusGeometry(3.85, 0.06, 6, 40);
    place(rim, 1.0, 7.95, 0, Math.PI / 2);
    glow.push(colorize(rim, 0x7b5cff));
    out.push({ solid: mergeGeometries(solid)!, glow: mergeGeometries(glow)!, radius: 0.5 });
  }
  // 2. Lantern spire — tall trunk, spiralling fronds, pink lantern pods
  {
    const solid: THREE.BufferGeometry[] = [];
    const glow: THREE.BufferGeometry[] = [];
    solid.push(colorize(bentTrunk(15, 0.55, 0.08, -0.05, 10, 10), 0x2c3a3c, 0.15));
    for (let i = 0; i < 22; i++) {
      const y = 4 + i * 0.5;
      const a = i * 2.4;
      const len = 3.4 * (1 - i / 26);
      const f = new THREE.SphereGeometry(1, 8, 5);
      place(f, Math.cos(a) * len * 0.5, y, Math.sin(a) * len * 0.5, 0, -a, 0.5, [len * 0.55, 0.12, 0.42]);
      solid.push(colorize(f, i % 2 ? 0x1c5b57 : 0x24706a, 0.3));
      if (i % 3 === 0) {
        const p = new THREE.SphereGeometry(0.28, 10, 8);
        place(p, Math.cos(a) * len * 0.95, y - 0.6, Math.sin(a) * len * 0.95, 0, 0, 0, [1, 1.35, 1]);
        glow.push(colorize(p, 0xff5fc8));
      }
    }
    const tip = new THREE.SphereGeometry(0.35, 10, 8);
    place(tip, -0.05 * 15, 15.2, 0);
    glow.push(colorize(tip, 0xffd2f4));
    out.push({ solid: mergeGeometries(solid)!, glow: mergeGeometries(glow)!, radius: 0.6 });
  }
  // 3. Coral fan — several bent tubes from one root, glowing tips and gill fans
  {
    const solid: THREE.BufferGeometry[] = [];
    const glow: THREE.BufferGeometry[] = [];
    solid.push(colorize(barkify(new THREE.CylinderGeometry(0.5, 0.9, 1.2, 10).translate(0, 0.6, 0), Math.PI * 1.4, 1.2), 0x3b2c2a, 0.1));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const h = 4.5 + (i % 3) * 1.6;
      const tb = bentTrunk(h, 0.28, 0.09, 0.22, 7, 6);
      place(tb, 0, 0.8, 0, 0, a, 0);
      solid.push(colorize(tb, 0x8a3b4b, 0.2));
      const tipX = Math.cos(-a) * 0.22 * h * 1.0, tipZ = Math.sin(-a) * 0.22 * h;
      const g = new THREE.SphereGeometry(0.25, 8, 6);
      place(g, tipX, 0.8 + h, tipZ);
      glow.push(colorize(g, 0xc8ff4a));
      const fan = new THREE.CircleGeometry(0.9, 10, 0, Math.PI);
      place(fan, tipX * 0.7, 0.8 + h * 0.75, tipZ * 0.7, Math.PI / 2 * 0.3, a, 0);
      solid.push(colorize(fan, 0xd0607a, 0.2));
    }
    const merged = mergeGeometries(solid.map((g) => g.toNonIndexed()))!;
    out.push({ solid: merged, glow: mergeGeometries(glow)!, radius: 0.9 });
  }
  // 4-5. Duskpine: tall dark conifers, the bulk of the forest
  for (const [h, r, bend] of [[23, 0.46, 0.015], [31, 0.6, -0.012]] as const) {
    const trunk = colorize(bentTrunk(h, r, 0.05, bend, 9, 10), 0x4e4238, 0.15);
    const roots: THREE.BufferGeometry[] = [trunk];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 6.28;
      const root = new THREE.ConeGeometry(r * 0.5, 1.6, 6);
      place(root, Math.cos(a) * r * 0.75, 0.32, Math.sin(a) * r * 0.75, Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25);
      roots.push(colorize(barkify(root, 2, 1.6), 0x4e4238, 0.12));
    }
    out.push({ solid: mergeGeometries(roots.map((g) => g.toNonIndexed()))!, glow: null, radius: r, leaf: spireCanopy(h, h * 0.2, detail) });
  }
  // 6. Broadcrown: a forked hardwood with a rounded leafy crown
  {
    const parts: THREE.BufferGeometry[] = [colorize(bentTrunk(7, 0.62, 0.3, 0.04, 10, 8), 0x51463c, 0.15)];
    const crown: [number, number, number, number][] = [[0, 12.5, 0, 4.4]];
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + 0.4, L = 7.5 - (i % 2);
      const b = bentTrunk(L, 0.3, 0.07, 0.26, 7, 6);
      place(b, 0.2, 6.2, 0, 0, a, -0.25);
      parts.push(colorize(b, 0x51463c, 0.15));
      crown.push([Math.cos(-a) * 4.6, 10 + (i % 3) * 1.3, Math.sin(-a) * 4.6, 3.3]);
    }
    out.push({ solid: mergeGeometries(parts.map((g) => g.toNonIndexed()))!, glow: null, radius: 0.7, leaf: crownCanopy(crown, detail) });
  }
  return out;
}

function windify(mat: THREE.Material, amp: number) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windUniforms.uTime;
    sh.uniforms.uWind = windUniforms.uWind;
    sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
      #else
        vec3 ip = vec3(0.0);
      #endif
      float sw = pow(max(position.y, 0.0) * 0.1, 2.0) * uWind * ${amp.toFixed(3)};
      transformed.x += sin(uTime * 1.1 + ip.x * 0.07 + ip.z * 0.05) * sw;
      transformed.z += cos(uTime * 0.9 + ip.z * 0.07) * sw * 0.7;`,
    );
  };
}

export interface Obstacle { x: number; z: number; r: number }

export class Forest {
  group = new THREE.Group();
  cells: THREE.Group[] = [];
  obstacles = new Map<string, Obstacle[]>();
  glowMats: THREE.MeshBasicMaterial[] = [];
  readonly cellSize = 200;

  constructor(private terrain: Terrain, private q: Quality) {}

  /** Story locations kept free of trees and rocks (camp, ridge, crash sites). */
  private reserved: Obstacle[] = [];
  reserve(x: number, z: number, r: number) { this.reserved.push({ x, z, r }); }
  private isReserved(x: number, z: number, pad: number) {
    for (const o of this.reserved) if (Math.hypot(x - o.x, z - o.z) < o.r + pad) return true;
    return false;
  }

  private key(x: number, z: number) { return `${Math.floor(x / 10)},${Math.floor(z / 10)}`; }

  addObstacle(x: number, z: number, r: number) {
    const k = this.key(x, z);
    let a = this.obstacles.get(k);
    if (!a) { a = []; this.obstacles.set(k, a); }
    a.push({ x, z, r });
  }

  /** Push a circle of radius pr at (x,z) out of nearby obstacles. */
  collide(p: THREE.Vector3, pr: number) {
    const cx = Math.floor(p.x / 10), cz = Math.floor(p.z / 10);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const a = this.obstacles.get(`${cx + dx},${cz + dz}`);
      if (!a) continue;
      for (const o of a) {
        const ex = p.x - o.x, ez = p.z - o.z;
        const d = Math.hypot(ex, ez), min = o.r + pr;
        if (d < min && d > 1e-4) { p.x = o.x + (ex / d) * min; p.z = o.z + (ez / d) * min; }
      }
    }
  }

  build() {
    const T = this.terrain;
    const variants = buildVariants(this.q.foliageDetail);
    const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide });
    windify(solidMat, 0.12);
    applyBark(solidMat, this.q);
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: true });
    windify(glowMat, 0.12);
    this.glowMats.push(glowMat);

    const rnd = mulberry32(77);
    const n = T.noise;
    const nc = Math.ceil((HALF * 2) / this.cellSize);
    type Inst = { m: THREE.Matrix4; c: THREE.Color };
    const buckets: Inst[][][] = []; // [cell][variant]
    for (let i = 0; i < nc * nc; i++) buckets.push([[], [], [], [], [], [], [], []]);
    const cellIndex = (x: number, z: number) =>
      Math.min(nc - 1, Math.floor((x + HALF) / this.cellSize)) + Math.min(nc - 1, Math.floor((z + HALF) / this.cellSize)) * nc;

    const nrm = new THREE.Vector3();
    const q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    let placed = 0, tries = 0;
    while (placed < this.q.treeCount && tries < this.q.treeCount * 30) {
      tries++;
      const x = (rnd() * 2 - 1) * (HALF - 60), z = (rnd() * 2 - 1) * (HALF - 60);
      const d0 = Math.hypot(x, z);
      if (d0 < 18) continue;
      const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
      if (dl < LAKE.r + 6) continue;
      if (this.isReserved(x, z, 4)) continue;
      const h = T.height(x, z);
      if (h < 1.2 || h > 90) continue;
      T.normal(x, z, nrm);
      if (nrm.y < 0.82) continue;
      const dens = n.noise2(x * 0.006 + 40, z * 0.006 - 13) * 0.5 + 0.5;
      const near = smoothstep(260, 40, d0) * 0.25;
      if (rnd() > smoothstep(0.32, 0.62, dens) + near * 0.4) continue;
      const vSel = n.noise2(x * 0.01 - 3, z * 0.01 + 8);
      // mostly ordinary forest; the glowing species only in rare groves
      const rare = n.noise2(x * 0.017 + 9, z * 0.017 + 4) > 0.42;
      const v = rare ? (vSel < -0.1 ? 2 : vSel < 0.2 ? 0 : 1) : (vSel < -0.12 ? 7 : rnd() < 0.55 ? 5 : 6);
      const giant = rnd() < 0.025;
      const sc = (0.7 + rnd() * 0.7) * (giant ? (v >= 5 ? 1.5 : 2.4) : 1);
      e.set((rnd() - 0.5) * 0.08, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.08);
      q.setFromEuler(e); s.set(sc, sc * (0.85 + rnd() * 0.3), sc); pos.set(x, h - 0.2, z);
      const c = new THREE.Color().setHSL(0, 0, 0.8 + rnd() * 0.35);
      if (rnd() < 0.3) c.multiply(new THREE.Color(1.0, 0.85 + rnd() * 0.2, 1.1));
      if (v >= 5) c.multiply(new THREE.Color(0.82 + rnd() * 0.4, 0.9 + rnd() * 0.2, 0.74 + rnd() * 0.3));
      buckets[cellIndex(x, z)][v].push({ m: new THREE.Matrix4().compose(pos, q, s), c });
      this.addObstacle(x, z, variants[v >= 5 ? v - 2 : v].radius * sc);
      placed++;
    }

    // Small glowing ground plants and rocks share the cell structure.
    const plantSolid = mergeGeometries([
      colorize(new THREE.CylinderGeometry(0.02, 0.04, 0.6, 5).translate(0, 0.3, 0), 0x2c5a50),
      colorize(new THREE.CylinderGeometry(0.02, 0.04, 0.45, 5).translate(0, 0.22, 0).rotateZ(0.4), 0x2c5a50),
      colorize(new THREE.CylinderGeometry(0.02, 0.04, 0.5, 5).translate(0, 0.25, 0).rotateZ(-0.35).rotateY(1.2), 0x2c5a50),
      colorize(new THREE.SphereGeometry(0.5, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.25, 1), 0x3a6b4a, 0.3),
    ])!;
    const plantGlow = mergeGeometries([
      colorize(new THREE.SphereGeometry(0.07, 6, 4).translate(0, 0.62, 0), 0x6effe0),
      colorize(new THREE.SphereGeometry(0.06, 6, 4).translate(0.18, 0.43, 0), 0x6effe0),
      colorize(new THREE.SphereGeometry(0.06, 6, 4).translate(-0.12, 0.47, -0.14), 0xa0ffd8),
    ])!;
    const rockGeo = new THREE.IcosahedronGeometry(1, 2);
    {
      const p = rockGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
        const k = 1 + n.noise2(vx * 1.7 + vz, vy * 1.7) * 0.25 + n.noise2(vx * 4, vz * 4 + vy) * 0.08;
        p.setXYZ(i, vx * k, vy * k * 0.7, vz * k);
      }
      rockGeo.computeVertexNormals();
      colorize(rockGeo, 0x58525f, 0.2);
    }
    const addSmall = (count: number, slot: number, minH: number, scale: [number, number], obstacle: number) => {
      let k = 0, tr = 0;
      while (k < count && tr < count * 20) {
        tr++;
        const x = (rnd() * 2 - 1) * (HALF - 60), z = (rnd() * 2 - 1) * (HALF - 60);
        const h = T.height(x, z);
        if (h < minH || h > 95) continue;
        if (Math.hypot(x, z) < 6) continue;
        if (slot === 4 && this.isReserved(x, z, 1.5)) continue;
        const sc = scale[0] + rnd() * (scale[1] - scale[0]);
        e.set(slot === 4 ? rnd() * 3 : 0, rnd() * 6.28, slot === 4 ? rnd() * 3 : 0); q.setFromEuler(e);
        pos.set(x, h - (slot === 4 ? sc * 0.25 : 0.02), z); s.setScalar(sc);
        buckets[cellIndex(x, z)][slot].push({ m: new THREE.Matrix4().compose(pos, q, s), c: new THREE.Color().setHSL(0, 0, 0.75 + rnd() * 0.4) });
        if (obstacle > 0 && sc > 0.8) this.addObstacle(x, z, sc * obstacle);
        k++;
      }
    };
    addSmall(this.q.plantCount, 3, 0.3, [0.7, 1.6], 0);
    addSmall(this.q.rockCount, 4, -1.5, [0.3, 2.2], 0.8);

    const atlas = foliageAtlas();
    const leafMat = new THREE.MeshStandardMaterial({ map: atlas.map, alphaMap: atlas.alpha, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85 });
    windify(leafMat, 0.12);
    // a little light through the leaves
    chainCompile(leafMat, 'leaf', (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.05, 0.08, 0.03);`);
    });
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    applyRock(rockMat, this.q);
    const plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    windify(plantMat, 2.5);
    const plantGlowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.4, 2.4, 2.4) });
    windify(plantGlowMat, 2.5);
    this.glowMats.push(plantGlowMat);

    for (let ci = 0; ci < nc * nc; ci++) {
      const cell = new THREE.Group();
      cell.userData.center = new THREE.Vector3(
        -HALF + ((ci % nc) + 0.5) * this.cellSize, 0, -HALF + (Math.floor(ci / nc) + 0.5) * this.cellSize,
      );
      const make = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Inst[], shadow: boolean) => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((it, i) => { im.setMatrixAt(i, it.m); im.setColorAt(i, it.c); });
        im.castShadow = shadow; im.receiveShadow = true;
        im.computeBoundingSphere();
        cell.add(im);
      };
      for (let v = 0; v < 3; v++) {
        make(variants[v].solid, solidMat, buckets[ci][v], true);
        make(variants[v].glow!, glowMat, buckets[ci][v], false);
      }
      for (let v = 5; v < 8; v++) {
        const tv = variants[v - 2];
        make(tv.solid, solidMat, buckets[ci][v], true);
        make(tv.leaf!, leafMat, buckets[ci][v], true);
      }
      make(plantSolid, plantMat, buckets[ci][3], false);
      make(plantGlow, plantGlowMat, buckets[ci][3], false);
      make(rockGeo, rockMat, buckets[ci][4], true);
      if (cell.children.length) { this.cells.push(cell); this.group.add(cell); }
    }
  }

  /** Distance-cull whole cells. */
  update(cam: THREE.Vector3) {
    const vd = this.q.viewDistance + this.cellSize * 0.7;
    for (const c of this.cells) {
      const ctr = c.userData.center as THREE.Vector3;
      c.visible = Math.hypot(ctr.x - cam.x, ctr.z - cam.z) < vd;
    }
  }

  setGlow(k: number) {
    for (const m of this.glowMats) m.color.setScalar(k);
  }
}
