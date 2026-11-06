import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, smoothstep } from '../core/noise';
import type { Quality } from '../core/quality';
import { Terrain, HALF, LAKE } from './terrain';
import { applyBark, chainCompile } from './pbr';
import { foliageAtlas, coniferCrown, broadCrown, CROWN_LODS } from './foliage';
import { modelMaterial, modelMats, type ModelPack, type ModelInfo } from './models';

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

interface Variant { solid: THREE.BufferGeometry; glow: THREE.BufferGeometry | null; radius: number }

/** The planet's three alien species, only found in rare groves. Units: metres, base at origin. */
function buildVariants(): Variant[] {
  const out: Variant[] = [];
  // 1. Parasol: bent trunk with a violet cap and glowing hanging tendrils
  {
    const solid: THREE.BufferGeometry[] = [];
    const glow: THREE.BufferGeometry[] = [];
    solid.push(colorize(bentTrunk(9, 0.42, 0.18, 0.12), 0x4a3b3a, 0.15));
    const capTop = new THREE.SphereGeometry(4.2, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
    place(capTop, 1.0, 8.2, 0, 0, 0, 0, [1, 0.42, 1]);
    solid.push(colorize(capTop, 0x4a3a52, 0.25));
    const under = new THREE.CylinderGeometry(3.9, 0.6, 0.8, 20, 1, true);
    place(under, 1.0, 8.0, 0);
    solid.push(colorize(under, 0x241d28, 0.1));
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 2.2 + (i % 3) * 0.6;
      const len = 1.4 + (i % 4) * 0.5;
      const t = new THREE.CylinderGeometry(0.03, 0.05, len, 4);
      place(t, 1.0 + Math.cos(a) * r, 8.0 - len / 2, Math.sin(a) * r);
      solid.push(colorize(t, 0x3a2a4c));
      const b = new THREE.SphereGeometry(0.16, 8, 6);
      place(b, 1.0 + Math.cos(a) * r, 8.0 - len, Math.sin(a) * r);
      glow.push(colorize(b, 0x4fbfd0));
    }
    const rim = new THREE.TorusGeometry(3.85, 0.06, 6, 40);
    place(rim, 1.0, 7.95, 0, Math.PI / 2);
    glow.push(colorize(rim, 0x6a62b0));
    out.push({ solid: mergeGeometries(solid)!, glow: mergeGeometries(glow)!, radius: 0.5 });
  }
  // 2. Lantern spire: tall trunk, spiralling fronds, pink lantern pods
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
      solid.push(colorize(f, i % 2 ? 0x24403a : 0x2c4c44, 0.3));
      if (i % 3 === 0) {
        const p = new THREE.SphereGeometry(0.28, 10, 8);
        place(p, Math.cos(a) * len * 0.95, y - 0.6, Math.sin(a) * len * 0.95, 0, 0, 0, [1, 1.35, 1]);
        glow.push(colorize(p, 0xc06a9c));
      }
    }
    const tip = new THREE.SphereGeometry(0.35, 10, 8);
    place(tip, -0.05 * 15, 15.2, 0);
    glow.push(colorize(tip, 0xd8b4c8));
    out.push({ solid: mergeGeometries(solid)!, glow: mergeGeometries(glow)!, radius: 0.6 });
  }
  // 3. Coral fan: several bent tubes from one root, glowing tips and gill fans
  {
    const solid: THREE.BufferGeometry[] = [];
    const glow: THREE.BufferGeometry[] = [];
    solid.push(colorize(barkify(new THREE.CylinderGeometry(0.5, 0.9, 1.2, 10).translate(0, 0.6, 0), Math.PI * 1.4, 1.2), 0x3b2c2a, 0.1));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const h = 4.5 + (i % 3) * 1.6;
      const tb = bentTrunk(h, 0.28, 0.09, 0.22, 7, 6);
      place(tb, 0, 0.8, 0, 0, a, 0);
      solid.push(colorize(tb, 0x5e4040, 0.2));
      const tipX = Math.cos(-a) * 0.22 * h * 1.0, tipZ = Math.sin(-a) * 0.22 * h;
      const g = new THREE.SphereGeometry(0.25, 8, 6);
      place(g, tipX, 0.8 + h, tipZ);
      glow.push(colorize(g, 0x9fc06a));
      const fan = new THREE.CircleGeometry(0.9, 10, 0, Math.PI);
      place(fan, tipX * 0.7, 0.8 + h * 0.75, tipZ * 0.7, Math.PI / 2 * 0.3, a, 0);
      solid.push(colorize(fan, 0x8a5a5e, 0.2));
    }
    const merged = mergeGeometries(solid.map((g) => g.toNonIndexed()))!;
    out.push({ solid: merged, glow: mergeGeometries(glow)!, radius: 0.9 });
  }
  return out;
}

function windify(mat: THREE.Material, amp: number, flutter = 0) {
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
      transformed.z += cos(uTime * 0.9 + ip.z * 0.07) * sw * 0.7;
      ${flutter > 0 ? `transformed.y += sin(uTime * 2.3 + position.x * 1.7 + position.z * 1.3 + ip.x) * ${flutter.toFixed(3)} * uWind;` : ''}`,
    );
  };
}

/** A geometry with up to three LODs and the material to draw it. */
interface Part { lods: THREE.BufferGeometry[]; mat: THREE.Material; shadow: [boolean, boolean, boolean] }

/**
 * All instances of one model or tree species in the world. Instead of one draw
 * per area, each LOD is a single instanced draw whose instance list is rebuilt
 * as the camera moves: a tree costs a few dozen triangles until you are close.
 */
class Field {
  private n = 0;
  private x: Float32Array;
  private z: Float32Array;
  private m: Float32Array;
  private c: Float32Array;
  private meshes: THREE.InstancedMesh[][] = [];

  constructor(cap: number, parts: Part[], group: THREE.Group, private near: [number, number], private far: number) {
    this.x = new Float32Array(cap); this.z = new Float32Array(cap);
    this.m = new Float32Array(cap * 16); this.c = new Float32Array(cap * 3);
    for (const p of parts) {
      const row: THREE.InstancedMesh[] = [];
      p.lods.forEach((g, k) => {
        const im = new THREE.InstancedMesh(g, p.mat, Math.max(1, cap));
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.instanceColor.setUsage(THREE.DynamicDrawUsage);
        im.frustumCulled = false; // lists are small and spread out; the LOD does the saving
        im.castShadow = p.shadow[k];
        im.receiveShadow = true;
        im.count = 0;
        row.push(im);
        group.add(im);
      });
      this.meshes.push(row);
    }
  }

  add(mat: THREE.Matrix4, col: THREE.Color) {
    const i = this.n++;
    this.x[i] = mat.elements[12]; this.z[i] = mat.elements[14];
    this.m.set(mat.elements, i * 16);
    this.c[i * 3] = col.r; this.c[i * 3 + 1] = col.g; this.c[i * 3 + 2] = col.b;
  }

  refresh(cx: number, cz: number) {
    const d0 = this.near[0] ** 2, d1 = this.near[1] ** 2, d2 = this.far ** 2;
    const count = [0, 0, 0];
    for (const row of this.meshes) for (const im of row) im.count = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[i] - cx, dz = this.z[i] - cz, d = dx * dx + dz * dz;
      if (d > d2) continue;
      const k = d < d0 ? 0 : d < d1 ? 1 : 2;
      const at = count[k]++;
      for (const row of this.meshes) {
        const im = row[k];
        (im.instanceMatrix.array as Float32Array).set(this.m.subarray(i * 16, i * 16 + 16), at * 16);
        (im.instanceColor!.array as Float32Array).set(this.c.subarray(i * 3, i * 3 + 3), at * 3);
      }
    }
    for (const row of this.meshes) row.forEach((im, k) => {
      im.count = count[k];
      im.visible = count[k] > 0;
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, count[k] * 16); im.instanceMatrix.needsUpdate = true;
      const ic = im.instanceColor!;
      ic.clearUpdateRanges(); ic.addUpdateRange(0, count[k] * 3); ic.needsUpdate = true;
    });
  }
}

export interface Obstacle { x: number; z: number; r: number }

export class Forest {
  group = new THREE.Group();
  private fields: Field[] = [];
  private refreshAt = 0;
  private last = new THREE.Vector2(1e9, 1e9);
  private dirty = 0;
  obstacles = new Map<string, Obstacle[]>();
  glowMats: THREE.MeshBasicMaterial[] = [];

  constructor(private terrain: Terrain, private q: Quality, private pack: ModelPack | null = null, private cards: Record<'fir' | 'pine' | 'leaf', THREE.Texture | null> = { fir: null, pine: null, leaf: null }) {}

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

  /** Is a circle of radius r at (x,z) inside an obstacle? (camera collision) */
  blocks(x: number, z: number, r: number): boolean {
    const cx = Math.floor(x / 10), cz = Math.floor(z / 10);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const a = this.obstacles.get(`${cx + dx},${cz + dz}`);
      if (a) for (const o of a) if (Math.hypot(x - o.x, z - o.z) < o.r + r) return true;
    }
    return false;
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

  /**
   * How much of the segment (ax,az)-(bx,bz) is free of obstacles, 1 = all of it.
   * Used by the camera to stay on the player's side of a trunk.
   */
  clearance(ax: number, az: number, bx: number, bz: number, pad: number): number {
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) return 1;
    let best = 1;
    const x0 = Math.floor(Math.min(ax, bx) / 10) - 1, x1 = Math.floor(Math.max(ax, bx) / 10) + 1;
    const z0 = Math.floor(Math.min(az, bz) / 10) - 1, z1 = Math.floor(Math.max(az, bz) / 10) + 1;
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const list = this.obstacles.get(`${cx},${cz}`);
      if (!list) continue;
      for (const o of list) {
        const t = ((o.x - ax) * dx + (o.z - az) * dz) / len2;
        if (t <= 0.05 || t >= best) continue;
        const r = o.r + pad, ex = ax + dx * t - o.x, ez = az + dz * t - o.z;
        const miss = ex * ex + ez * ez;
        if (miss < r * r) best = Math.min(best, Math.max(0, t - Math.sqrt(r * r - miss) / Math.sqrt(len2)));
      }
    }
    return best;
  }

  private leafMaterial(tex: THREE.Texture | null, fallback: { map: THREE.Texture; alpha: THREE.Texture } | null) {
    const m = new THREE.MeshStandardMaterial({
      map: tex ?? fallback!.map, alphaMap: tex ? null : fallback!.alpha,
      vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.82,
    });
    windify(m, 0.12, 0.05);
    // sunlight through the needles when you look towards it
    chainCompile(m, 'leaf', (sh) => {
      sh.uniforms.uLeafSun = this.leafSun;
      sh.uniforms.uLeafCol = this.leafCol;
      sh.fragmentShader = 'uniform vec3 uLeafSun, uLeafCol;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 lfL = normalize((viewMatrix * vec4(uLeafSun, 0.0)).xyz);
        float lfT = pow(clamp(dot(-normalize(vViewPosition), lfL), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * uLeafCol * (0.05 + 0.5 * lfT);`);
    });
    return m;
  }

  private leafSun = { value: new THREE.Vector3(0, 1, 0) };
  private leafCol = { value: new THREE.Color(1, 1, 1) };

  /** Sun direction and colour for the light passing through the leaves. */
  setSun(dir: THREE.Vector3, col: THREE.Color) {
    this.leafSun.value.copy(dir);
    this.leafCol.value.copy(col);
  }

  /** Round trunk with a root flare; LODs drop rings. */
  private trunk(h: number, r: number, bend: number, lod: number): THREE.BufferGeometry {
    const [radial, rings] = ([[10, 10], [6, 5], [4, 2]] as const)[lod];
    const g = colorize(bentTrunk(h, r, 0.03, bend, radial, rings), 0x6b5d50, 0.12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), f = 1 + 0.75 * Math.exp(-y * 1.4 / r * 0.45);
      p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * f);
    }
    g.computeVertexNormals();
    return g;
  }

  build() {
    const T = this.terrain, Q = this.q;
    const atlas = this.cards.fir && this.cards.leaf ? null : foliageAtlas();
    const barkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.0 });
    windify(barkMat, 0.12);
    applyBark(barkMat, Q);
    const firLeaf = this.leafMaterial(this.cards.fir, atlas);
    const pineLeaf = this.leafMaterial(this.cards.pine ?? this.cards.fir, atlas);
    const broadLeaf = this.leafMaterial(this.cards.leaf, atlas);

    // trunk and crown LODs of the ordinary forest
    const treeNear: [number, number] = [Q.lodDistances[0] * 1.3, Q.lodDistances[1] * 1.3];
    const treeFar = Q.name === 'mobile' ? Q.viewDistance : 2000;
    const fd = Q.foliageDetail;
    const conifer = (h: number, r: number, bend: number, crownStart: number, spread: number, leaf: THREE.Material, seed: number): Part[] => [
      { lods: [0, 1, 2].map((l) => this.trunk(h, r, bend, l)), mat: barkMat, shadow: [true, true, false] },
      { lods: CROWN_LODS.map((l) => coniferCrown(h, h * crownStart, l, fd, seed, spread)), mat: leaf, shadow: [true, true, true] },
    ];
    const lobes: [number, number, number, number][] = [[0, 12.5, 0, 4.4]];
    for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.4; lobes.push([Math.cos(-a) * 4.6, 10 + (i % 3) * 1.3, Math.sin(-a) * 4.6, 3.3]); }
    const broadTrunk = (lod: number) => {
      const parts = [this.trunk(8.5, 0.55, 0.05, lod)];
      for (let i = 0; i < (lod === 2 ? 3 : 5); i++) {
        const a = i * 1.26 + 0.4, b = bentTrunk(7, 0.26, 0.05, 0.26, lod ? 4 : 7, lod ? 3 : 6);
        place(b, 0.2, 5.8, 0, 0, a, -0.25);
        parts.push(colorize(b, 0x6b5d50, 0.12));
      }
      return mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
    };
    const species = [
      conifer(23, 0.42, 0.015, 0.16, 0.24, firLeaf, 11),
      conifer(31, 0.55, -0.012, 0.22, 0.2, firLeaf, 12),
      conifer(21, 0.4, 0.03, 0.58, 0.3, pineLeaf, 13),
      [
        { lods: [0, 1, 2].map(broadTrunk), mat: barkMat, shadow: [true, true, false] as [boolean, boolean, boolean] },
        { lods: CROWN_LODS.map((l) => broadCrown(lobes, l, fd, 14)), mat: broadLeaf, shadow: [true, true, true] as [boolean, boolean, boolean] },
      ],
      conifer(4.5, 0.07, 0.01, 0.1, 0.34, firLeaf, 15), // saplings in the undergrowth
    ];
    const capTrees = Math.ceil(Q.treeCount * 1.3);
    const fields = species.map((p) => new Field(capTrees, p, this.group, treeNear, treeFar));
    this.fields.push(...fields);

    // the alien groves
    const variants = buildVariants();
    const alienSolid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide });
    windify(alienSolid, 0.12);
    applyBark(alienSolid, Q);
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.2, 1.2, 1.2), toneMapped: true });
    windify(glowMat, 0.12);
    this.glowMats.push(glowMat);
    const alien = variants.map((v) => {
      const parts: Part[] = [{ lods: [v.solid], mat: alienSolid, shadow: [true, true, true] }];
      if (v.glow) parts.push({ lods: [v.glow], mat: glowMat, shadow: [false, false, false] });
      const f = new Field(Math.ceil(Q.treeCount * 0.04) + 1, parts.map((p) => ({ ...p, lods: [p.lods[0], p.lods[0], p.lods[0]] })), this.group, [1e5, 1e6], Math.min(Q.viewDistance, 420));
      this.fields.push(f);
      return f;
    });

    const rnd = mulberry32(77);
    const n = T.noise;
    const nrm = new THREE.Vector3();
    const q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    const M = new THREE.Matrix4();
    let placed = 0, tries = 0, aliens = 0;
    const forestAt = (x: number, z: number) => n.noise2(x * 0.006 + 40, z * 0.006 - 13) * 0.5 + 0.5;
    while (placed < Q.treeCount && tries < Q.treeCount * 30) {
      tries++;
      const x = (rnd() * 2 - 1) * (HALF - 40), z = (rnd() * 2 - 1) * (HALF - 40);
      const d0 = Math.hypot(x, z);
      if (d0 < 16) continue;
      const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
      if (dl < LAKE.r + 6) continue;
      if (this.isReserved(x, z, 4)) continue;
      const h = T.height(x, z);
      if (h < 1.2 || h > 150) continue;
      T.normal(x, z, nrm);
      if (nrm.y < 0.8) continue;
      const dens = forestAt(x, z);
      const near = smoothstep(260, 40, d0) * 0.25;
      if (rnd() > smoothstep(0.36, 0.54, dens) + near * 0.4) continue;
      // treeline: thinner, then gone
      if (rnd() < smoothstep(95, 150, h)) continue;
      const vSel = n.noise2(x * 0.01 - 3, z * 0.01 + 8);
      // far from the crash site, a rare stand of something that isn't quite a tree
      const grove = d0 > 190 && n.noise2(x * 0.017 + 9, z * 0.017 + 4) > 0.68 && aliens < Q.treeCount * 0.035;
      const sc = 0.7 + rnd() * 0.65;
      e.set((rnd() - 0.5) * 0.06, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.06);
      q.setFromEuler(e); pos.set(x, h - 0.15, z);
      const c = new THREE.Color().setHSL(0, 0, 0.82 + rnd() * 0.3);
      c.multiply(new THREE.Color(0.9 + rnd() * 0.2, 0.92 + rnd() * 0.12, 0.8 + rnd() * 0.2));
      if (grove) {
        const v = vSel < -0.1 ? 2 : vSel < 0.2 ? 0 : 1;
        s.setScalar(sc * 0.9);
        alien[v].add(M.compose(pos, q, s), c);
        this.addObstacle(x, z, variants[v].radius * sc);
        aliens++;
      } else {
        const low = h < 26 && d0 < 330;
        const v = low && vSel < -0.25 ? 3 : vSel > 0.22 ? 2 : rnd() < 0.55 ? 0 : 1;
        const giant = rnd() < 0.03 ? 1.35 : 1;
        s.set(sc * giant, sc * giant * (0.88 + rnd() * 0.28), sc * giant);
        fields[v].add(M.compose(pos, q, s), c);
        this.addObstacle(x, z, (v === 3 ? 0.62 : v === 1 ? 0.6 : 0.46) * sc * giant);
      }
      placed++;
    }
    // saplings
    for (let i = 0, k = 0; i < Q.treeCount * 6 && k < Q.treeCount * 0.25; i++) {
      const x = (rnd() * 2 - 1) * (HALF - 60), z = (rnd() * 2 - 1) * (HALF - 60);
      const h = T.height(x, z);
      if (h < 1.5 || h > 110 || Math.hypot(x, z) < 10 || this.isReserved(x, z, 2) || rnd() > forestAt(x, z) + 0.1) continue;
      T.normal(x, z, nrm); if (nrm.y < 0.82) continue;
      const sc = 0.35 + rnd() * 0.9;
      e.set(0, rnd() * 6.28, 0); q.setFromEuler(e); pos.set(x, h - 0.05, z); s.setScalar(sc);
      fields[4].add(M.compose(pos, q, s), new THREE.Color().setHSL(0, 0, 0.8 + rnd() * 0.3));
      k++;
    }

    if (this.pack) this.scatter(rnd, forestAt);
    this.group.updateMatrixWorld();
  }

  /** Scanned rocks, dead wood and undergrowth. */
  private scatter(rnd: () => number, forestAt: (x: number, z: number) => number) {
    const T = this.terrain, Q = this.q, pack = this.pack!;
    const near = Q.lodDistances;
    const byKind = new Map<ModelInfo['kind'], { name: string; info: ModelInfo; field: Field }[]>();
    const counts: Record<ModelInfo['kind'], number> = {
      rock: Q.rockCount * 1.2, outcrop: Math.round(Q.rockCount * 0.22), stump: Q.treeCount * 0.035, log: Q.treeCount * 0.04, roots: Q.treeCount * 0.025,
      branch: Q.plantCount * 0.12, plant: Q.plantCount, shrub: Q.plantCount * 0.22,
    };
    const reach: Record<ModelInfo['kind'], number> = {
      rock: Q.viewDistance * 0.8, outcrop: 2000, stump: 130, log: 180, roots: 130, branch: 70, plant: near[1] * 0.9, shrub: near[1] * 1.3,
    };
    for (const name in pack.lods) {
      const info = pack.info[name];
      const list = byKind.get(info.kind) ?? [];
      byKind.set(info.kind, list);
      const fresh = !modelMats.has(info.set);
      const mat = modelMaterial(info, Q, modelMats);
      if (info.alpha && fresh) windify(mat, 22, 0);
      const lods = pack.lods[name];
      const cap = Math.ceil(counts[info.kind] / 1.5) + 4;
      const big = info.kind === 'outcrop' || info.kind === 'rock';
      const shadow: [boolean, boolean, boolean] = big ? [true, true, true] : info.kind === 'plant' ? [false, false, false] : [true, true, false];
      const f = new Field(cap, [{ lods, mat, shadow }], this.group, big ? [near[0] * 1.2, near[1] * 1.6] : near, reach[info.kind]);
      this.fields.push(f);
      list.push({ name, info, field: f });
    }
    const nrm = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    const M = new THREE.Matrix4(), col = new THREE.Color();
    const fill = new Map<Field, number>();
    const put = (kind: ModelInfo['kind'], accept: (x: number, z: number, h: number, ny: number) => number, count = counts[kind], around?: [number, number, number]) => {
      const list = byKind.get(kind);
      if (!list) return;
      let k = 0, tr = 0;
      const want = count;
      while (k < want && tr < want * 40) {
        tr++;
        let x = (rnd() * 2 - 1) * (HALF - 30), z = (rnd() * 2 - 1) * (HALF - 30);
        if (around) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * around[2]; x = around[0] + Math.cos(a) * r; z = around[1] + Math.sin(a) * r; }
        const h = T.height(x, z);
        T.normal(x, z, nrm);
        const sc = accept(x, z, h, nrm.y);
        if (sc <= 0) continue;
        const it = list[Math.floor(rnd() * list.length)];
        const used = fill.get(it.field) ?? 0;
        if (used >= Math.ceil(counts[kind] / 1.5) + 3) continue;
        fill.set(it.field, used + 1);
        const scale = it.info.height < 0.25 ? sc * 3.2 : sc;   // the small plant scans are shot at 1:1 and sized up here
        q.setFromAxisAngle(up, rnd() * 6.283);
        if (kind === 'rock' || kind === 'outcrop' || kind === 'log' || kind === 'roots' || kind === 'branch') {
          q2.setFromUnitVectors(up, nrm);
          q.premultiply(q2);
        }
        const sink = kind === 'outcrop' ? it.info.height * scale * 0.28 : kind === 'rock' ? it.info.height * scale * 0.2 : kind === 'stump' ? 0.05 : 0.02;
        pos.set(x, h - sink, z);
        s.setScalar(scale);
        col.setHSL(0, 0, 0.78 + rnd() * 0.3);
        if (kind === 'plant' || kind === 'shrub') col.multiply(tmpC.setRGB(0.86 + rnd() * 0.2, 0.92 + rnd() * 0.1, 0.72 + rnd() * 0.2));
        it.field.add(M.compose(pos, q, s), col);
        const r = it.info.radius * scale;
        if ((kind === 'rock' || kind === 'outcrop' || kind === 'stump') && r > 0.55) this.addObstacle(x, z, r * 0.72);
        k++;
      }
    };
    const clear = (x: number, z: number, pad: number) => !this.isReserved(x, z, pad) && Math.hypot(x, z) > 7;
    put('outcrop', (x, z, h, ny) => (ny < 0.9 && h > 6 && clear(x, z, 5) ? 1.1 + rnd() * rnd() * 5.5 : 0));
    put('rock', (x, z, h, ny) => (h > -1.2 && h < 160 && clear(x, z, 2) ? 0.2 + rnd() * rnd() * 1.4 : 0));
    // the lake's edge: stones in the shallows and wood washed ashore
    const shore: [number, number, number] = [LAKE.x, LAKE.z, LAKE.r + 40];
    put('rock', (x, z, h) => (h > -0.7 && h < 1.1 && clear(x, z, 1.5) ? 0.12 + rnd() * rnd() * 0.75 : 0), Math.round(Q.rockCount * 0.16), shore);
    put('log', (x, z, h) => (h > -0.2 && h < 1.4 && clear(x, z, 3) ? 0.8 + rnd() * 0.8 : 0), 10, shore);
    put('stump', (x, z, h, ny) => (h > 1.5 && ny > 0.85 && forestAt(x, z) > 0.42 && clear(x, z, 2) ? 0.8 + rnd() * 0.7 : 0));
    put('log', (x, z, h, ny) => (h > 1.5 && ny > 0.86 && forestAt(x, z) > 0.42 && clear(x, z, 3) ? 0.9 + rnd() * 1.1 : 0));
    put('roots', (x, z, h, ny) => (h > 1.5 && ny > 0.85 && forestAt(x, z) > 0.4 && clear(x, z, 2) ? 0.9 + rnd() * 0.8 : 0));
    put('branch', (x, z, h, ny) => (h > 1 && ny > 0.85 && clear(x, z, 1.5) ? 0.8 + rnd() * 0.9 : 0));
    put('shrub', (x, z, h, ny) => (h > 1.4 && h < 110 && ny > 0.83 && clear(x, z, 2) && rnd() < forestAt(x, z) + 0.15 ? 0.45 + rnd() * 0.8 : 0));
    put('plant', (x, z, h, ny) => (h > 0.8 && h < 110 && ny > 0.82 && clear(x, z, 1) && rnd() < forestAt(x, z) * 1.3 ? 0.8 + rnd() * 1.1 : 0));
  }

  /** Rebuilds the instance lists a few at a time; all of them after a long move. */
  update(cam: THREE.Vector3) {
    const moved = this.last.distanceToSquared(tmpV.set(cam.x, cam.z));
    if (moved > 16) { this.last.copy(tmpV); this.dirty = this.fields.length; }
    if (moved > 40 * 40) {
      for (const f of this.fields) f.refresh(cam.x, cam.z);
      this.dirty = 0;
      return;
    }
    for (let i = 0; i < 4 && this.dirty > 0; i++) {
      this.fields[this.refreshAt % this.fields.length].refresh(cam.x, cam.z);
      this.refreshAt++;
      this.dirty--;
    }
  }

  setGlow(k: number) {
    for (const m of this.glowMats) m.color.setScalar(k);
  }
}
const tmpC = new THREE.Color();
const tmpV = new THREE.Vector2();
