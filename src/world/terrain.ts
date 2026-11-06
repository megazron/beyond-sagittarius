import * as THREE from 'three';
import { Simplex, smoothstep, clamp, mulberry32, tileFbm, tileNoise } from '../core/noise';
import { NOISE_GLSL } from '../core/glsl';
import { loadSet, meanColor } from '../core/assets';
import type { Quality } from '../core/quality';

import { baseHeight, ridged, WORLD_SIZE, HALF, LAKE } from './heightfield';

export { WORLD_SIZE, HALF, LAKE };
export const WATER_LEVEL = 0;

const PAL = {
  mossA: new THREE.Color(0x4a5236),
  mossB: new THREE.Color(0x565040),
  lilac: new THREE.Color(0x565058),
  ochre: new THREE.Color(0x665c40),
  sand: new THREE.Color(0x6f6858),
  mud: new THREE.Color(0x35302a),
  rockA: new THREE.Color(0x6a6662),
  rockB: new THREE.Color(0x4a4744),
};

export class Terrain {
  readonly noise = new Simplex(2189);
  res: number;
  cell: number;
  data!: Float32Array;
  heightTex!: THREE.DataTexture;
  group = new THREE.Group();
  material!: THREE.MeshStandardMaterial;

  constructor(private q: Quality) {
    this.res = q.heightRes;
    this.cell = WORLD_SIZE / (this.res - 1);
  }

  /** Baked hydraulic erosion: height delta in metres and water flow 0..1, bilinear. */
  private erosion: { res: number; delta: Int16Array; flow: Uint8Array } | null = null;
  flowTex: THREE.Texture | null = null;

  private async loadErosion() {
    const res = this.q.name === 'mobile' ? 512 : 1024;
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}models/world/erosion_${res}.bin`);
      if (!r.ok) throw new Error(String(r.status));
      const buf = await r.arrayBuffer();
      const flow = new Uint8Array(buf, res * res * 2);
      this.erosion = { res, delta: new Int16Array(buf, 0, res * res), flow };
      const t = new THREE.DataTexture(flow, res, res, THREE.RedFormat, THREE.UnsignedByteType);
      t.magFilter = t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      this.flowTex = t;
    } catch (e) { console.warn('[terrain] no baked erosion', e); }
  }

  private sampleErosion(x: number, z: number, field: Int16Array | Uint8Array): number {
    const er = this.erosion!, res = er.res;
    const fx = clamp((x + HALF) / WORLD_SIZE * (res - 1), 0, res - 1.001), fz = clamp((z + HALF) / WORLD_SIZE * (res - 1), 0, res - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, o = iz * res + ix;
    return (field[o] * (1 - tx) + field[o + 1] * tx) * (1 - tz) + (field[o + res] * (1 - tx) + field[o + res + 1] * tx) * tz;
  }

  rawHeight(x: number, z: number): number {
    const h = baseHeight(this.noise, x, z);
    return this.erosion ? h + this.sampleErosion(x, z, this.erosion.delta) * 0.01 : h;
  }

  /** Generates the height grid over several frames so the UI stays responsive. */
  async generate(onProgress: (p: number) => void) {
    await this.loadErosion();
    const res = this.res;
    this.data = new Float32Array(res * res);
    let row = 0;
    while (row < res) {
      const t0 = performance.now();
      while (row < res && performance.now() - t0 < 14) {
        const z = -HALF + row * this.cell;
        for (let i = 0; i < res; i++) this.data[row * res + i] = this.rawHeight(-HALF + i * this.cell, z);
        row++;
      }
      onProgress(row / res * 0.6);
      await new Promise((r) => setTimeout(r, 0));
    }
    const half = new Uint16Array(res * res);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(this.data[i]);
    this.heightTex = new THREE.DataTexture(half, res, res, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTex.needsUpdate = true;
  }

  height(x: number, z: number): number {
    const res = this.res;
    const fx = clamp((x + HALF) / this.cell, 0, res - 1.001);
    const fz = clamp((z + HALF) / this.cell, 0, res - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const d = this.data, o = iz * res + ix;
    const a = d[o], b = d[o + 1], c = d[o + res], e = d[o + res + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (e - c) * tx) * tz;
  }

  normal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = this.cell;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  colorAt(x: number, z: number, h: number, ny: number, out: THREE.Color): THREE.Color {
    const n = this.noise;
    const v = n.noise2(x * 0.018, z * 0.018) * 0.5 + 0.5;
    const v2 = n.noise2(x * 0.06 + 5, z * 0.06 - 2) * 0.5 + 0.5;
    const v3 = n.noise2(x * 0.004 - 9, z * 0.004 + 3) * 0.5 + 0.5;
    out.copy(PAL.mossA).lerp(PAL.mossB, smoothstep(0.3, 0.8, v));
    out.lerp(PAL.lilac, smoothstep(0.62, 0.9, v2) * 0.55);
    out.lerp(PAL.ochre, smoothstep(0.6, 0.85, v3) * 0.45);
    if (h < 1.6) out.lerp(PAL.sand, 1 - smoothstep(0.1, 1.6, h));
    if (h < -0.1) out.lerp(PAL.mud, smoothstep(-0.1, -1.5, h));
    const slope = 1 - ny;
    const rock = tmpC.copy(PAL.rockA).lerp(PAL.rockB, v2);
    out.lerp(rock, smoothstep(0.16, 0.34, slope));
    // above the treeline the soil thins out to stone
    out.lerp(rock, smoothstep(110, 170, h) * 0.85);
    return out;
  }

  private chunkGeometry(cx: number, cz: number, size: number, seg: number): THREE.BufferGeometry {
    const vcount = (seg + 1) * (seg + 1) + seg * 4 * 2 + 8;
    const pos = new Float32Array(vcount * 3);
    const nor = new Float32Array(vcount * 3);
    const col = new Float32Array(vcount * 3);
    const uv = new Float32Array(vcount * 2);
    const idx: number[] = [];
    const step = size / seg;
    const nv = new THREE.Vector3(), c = new THREE.Color();
    let v = 0;
    const put = (x: number, y: number, z: number, src = -1) => {
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      if (src >= 0) {
        nor.set(nor.subarray(src * 3, src * 3 + 3), v * 3);
        col.set(col.subarray(src * 3, src * 3 + 3), v * 3);
      } else {
        this.normal(x, z, nv);
        nor[v * 3] = nv.x; nor[v * 3 + 1] = nv.y; nor[v * 3 + 2] = nv.z;
        this.colorAt(x, z, y, nv.y, c);
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
      }
      const drop = src >= 0 ? 3 : 0; // skirts: keep the UV gradient non-degenerate
      uv[v * 2] = (x + drop) / 5.3; uv[v * 2 + 1] = (z + drop) / 5.3;
      return v++;
    };
    for (let j = 0; j <= seg; j++) {
      for (let i = 0; i <= seg; i++) {
        const x = cx + i * step, z = cz + j * step;
        put(x, this.height(x, z), z);
      }
    }
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i, b = a + 1, cc = a + seg + 1, d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    }
    // Skirts hide cracks between neighbouring LOD levels.
    const edges: number[][] = [[], [], [], []];
    for (let i = 0; i <= seg; i++) {
      edges[0].push(i);
      edges[1].push(seg * (seg + 1) + i);
      edges[2].push(i * (seg + 1));
      edges[3].push(i * (seg + 1) + seg);
    }
    for (const e of edges) {
      let prevTop = -1, prevBot = -1;
      for (const top of e) {
        const bot = put(pos[top * 3], pos[top * 3 + 1] - 3, pos[top * 3 + 2], top);
        if (prevTop >= 0) idx.push(prevTop, prevBot, top, top, prevBot, bot, prevTop, top, prevBot, top, bot, prevBot);
        prevTop = top; prevBot = bot;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, v * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, v * 2), 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** Builds chunked LOD meshes. Yields between chunks. */
  async buildMeshes(onProgress: (p: number) => void) {
    this.material = createTerrainMaterial(this.q, this);
    const CH = 100;
    const n = WORLD_SIZE / CH;
    const segs = [this.q.terrainSegments, this.q.terrainSegments / 2, Math.max(6, Math.round(this.q.terrainSegments * 0.375))];
    let t0 = performance.now();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const cx = -HALF + i * CH, cz = -HALF + j * CH;
        const lod = new THREE.LOD();
        const dists = [0, 170, 380];
        segs.forEach((s, k) => {
          const m = new THREE.Mesh(this.chunkGeometry(cx, cz, CH, s), this.material);
          m.receiveShadow = true;
          m.castShadow = k === 0;
          lod.addLevel(m, dists[k]);
        });
        this.group.add(lod);
        if (performance.now() - t0 > 14) {
          onProgress(0.6 + ((j * n + i) / (n * n)) * 0.3);
          await new Promise((r) => setTimeout(r, 0));
          t0 = performance.now();
        }
      }
    }
    this.group.add(this.backdrop());
  }

  /** Far ranges beyond the playable world: they give the valley its scale, and the air does the rest. */
  private backdrop(): THREE.Mesh {
    const rings = 44, segs = 288, n = this.noise, rnd = mulberry32(5);
    const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
    const c = new THREE.Color();
    const r0 = 640, r1 = 2300;
    for (let j = 0; j <= rings; j++) {
      const t = j / rings, r = r0 + (r1 - r0) * t * t * 0.6 + (r1 - r0) * t * 0.4;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
        const y = -40 + smoothstep(0, 0.12, t) * 180 + ridged(n, x * 0.0009 + 5, z * 0.0009 - 2, 6) * (0.35 + ridged(n, x * 0.0004 - 3, z * 0.0004 + 1, 2)) * 620 * smoothstep(0.02, 0.4, t);
        pos.push(x, y, z);
        c.copy(PAL.rockA).lerp(PAL.rockB, rnd());
        col.push(c.r, c.g, c.b);
        uv.push(x / 5.3, z / 5.3);
        if (j < rings) {
          const o = j * segs + i, p = j * segs + ((i + 1) % segs);
          idx.push(o, p, o + segs, p, p + segs, o + segs);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.material);
    m.frustumCulled = false;
    return m;
  }
}
const tmpC = new THREE.Color();

/** Procedural tiling detail albedo + normal map: the fallback until the photo textures arrive. */
function proceduralDetail(): { map: THREE.DataTexture; nmap: THREE.DataTexture; mean: number } {
  const S = 256;
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S * 8, v = y / S * 8;
      let h = tileFbm(u, v, 8, 5, 3);
      const pebble = tileNoise(u * 4, v * 4, 32, 9);
      h += Math.max(0, pebble - 0.72) * 1.6;
      hgt[y * S + x] = h;
    }
  }
  const alb = new Uint8Array(S * S * 4);
  const nrm = new Uint8Array(S * S * 4);
  let sum = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const h = hgt[i];
      const g = Math.floor(clamp(222 + (h - 0.5) * 120, 150, 255));
      sum += g;
      alb[i * 4] = g; alb[i * 4 + 1] = g; alb[i * 4 + 2] = g; alb[i * 4 + 3] = 255;
      const hl = hgt[y * S + ((x + S - 1) % S)], hr = hgt[y * S + ((x + 1) % S)];
      const hd = hgt[((y + S - 1) % S) * S + x], hu = hgt[((y + 1) % S) * S + x];
      const nx = (hl - hr) * 3.5, ny = (hd - hu) * 3.5, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nrm[i * 4] = (nx / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 1] = (ny / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 2] = (nz / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 3] = 255;
    }
  }
  const map = new THREE.DataTexture(alb, S, S, THREE.RGBAFormat);
  map.colorSpace = THREE.NoColorSpace;
  const nmap = new THREE.DataTexture(nrm, S, S, THREE.RGBAFormat);
  for (const t of [map, nmap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
  }
  return { map, nmap, mean: sum / (S * S) / 255 };
}

/** Ground layers: texture set, tile size in metres (from the scan's real size). */
const LAYERS = [
  { set: 'ground', tile: 3.2 },
  { set: 'dirt', tile: 3.6 },
  { set: 'mud', tile: 2.8 },
  { set: 'rock', tile: 6.0 },
] as const;

/**
 * Terrain material: the palette vertex colours stay (they make the planet alien);
 * CC0 photo-scanned layers (soil, forest floor, mud, rock) add albedo detail,
 * normals and roughness. Layers are blended by height (wet shore / mud), slope
 * (rock, triplanar on Ultra) and noise patches, each sampled twice at rotated
 * scales to hide tiling.
 */
function createTerrainMaterial(q: Quality, terrain: Terrain): THREE.MeshStandardMaterial {
  const fb = proceduralDetail();
  const uniforms = {
    tD: { value: LAYERS.map(() => fb.map as THREE.Texture) },
    tN: { value: LAYERS.map(() => fb.nmap as THREE.Texture) },
    uMean: { value: LAYERS.map(() => new THREE.Vector3().setScalar(fb.mean)) },
    uChroma: { value: 0.0 },
    uNormalK: { value: 0.6 },
    tHeight: { value: terrain.heightTex as THREE.Texture },
    tFlow: { value: terrain.flowTex },
  };
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.0,
  });
  mat.defines = {
    LAYERS: q.terrainLayers,
    ...(q.antiTile ? { ANTI_TILE: '' } : {}),
    ...(q.triplanar ? { TRIPLANAR: '' } : {}),
    ...(q.terrainRelief ? { RELIEF: '' } : {}),
    ...(terrain.flowTex ? { FLOW: '' } : {}),
  };
  const tile = LAYERS.map((l) => (1 / l.tile).toFixed(4));
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec3 vTW; varying vec3 vTN;\n' + sh.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vTN = normalize(mat3(modelMatrix) * objectNormal);`,
    );
    sh.fragmentShader = /* glsl */ `
      varying vec3 vTW; varying vec3 vTN;
      uniform sampler2D tD[4]; uniform sampler2D tN[4]; uniform vec3 uMean[4];
      uniform float uChroma, uNormalK;
      uniform sampler2D tHeight, tFlow;
      ${NOISE_GLSL}
      struct Tap { vec3 c; vec2 n; };
      const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
      // gradients are taken once, outside any branch (derivatives in divergent flow are undefined)
      Tap tap(sampler2D d, sampler2D n, vec2 uv, vec2 dx, vec2 dy) {
        Tap t;
        t.c = textureGrad(d, uv, dx, dy).rgb;
        t.n = textureGrad(n, uv, dx, dy).xy * 2.0 - 1.0;
        return t;
      }
      // two decorrelated samples blended by low-frequency noise hide the repeat
      Tap tapAT(sampler2D d, sampler2D n, vec2 uv, vec2 dx, vec2 dy) {
        Tap a = tap(d, n, uv, dx, dy);
      #ifdef ANTI_TILE
        float k = smoothstep(0.32, 0.68, vnoise2(uv * 0.21 + 3.7));
        if (k > 0.001) {
          Tap b = tap(d, n, ROT * uv * 0.61 + vec2(0.37, 0.71), ROT * dx * 0.61, ROT * dy * 0.61);
          b.n = b.n * ROT; // rotate the tangent normal back
          a.c = mix(a.c, b.c, k); a.n = mix(a.n, b.n, k);
        }
      #endif
        return a;
      }
      vec3 detail(vec3 c, vec3 mean) {
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722)) / max(dot(mean, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
        return mix(vec3(l), c / max(mean, vec3(1e-3)), uChroma);
      }
    ` + sh.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
      vec3 tw = vTW; vec3 tn = normalize(vTN);
      vec2 huv = (tw.xz + ${HALF.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)};
      float inWorld = step(abs(tw.x), ${(HALF - 2).toFixed(1)}) * step(abs(tw.z), ${(HALF - 2).toFixed(1)});
      #ifdef RELIEF
      // per-pixel normals from the heightfield: gullies stay crisp however coarse the far mesh is
      if (inWorld > 0.5) {
        const float E = ${(1.2 / terrain.res).toFixed(6)};
        float hl = texture2D(tHeight, huv - vec2(E, 0.0)).r, hr = texture2D(tHeight, huv + vec2(E, 0.0)).r;
        float hd = texture2D(tHeight, huv - vec2(0.0, E)).r, hu = texture2D(tHeight, huv + vec2(0.0, E)).r;
        tn = normalize(vec3(hl - hr, ${(2 * 1.2 * WORLD_SIZE / terrain.res).toFixed(3)}, hd - hu));
      }
      #endif
      float slope = 1.0 - tn.y;
      vec3 gx = dFdx(tw), gy = dFdy(tw);
      float nA = vnoise2(tw.xz * 0.045);
      float nB = vnoise2(tw.xz * 0.23 + 7.3);
      float wRock = smoothstep(0.13, 0.3, slope + (nB - 0.5) * 0.14);
      wRock = max(wRock, smoothstep(120.0, 175.0, tw.y + (nA - 0.5) * 40.0));
      float wMud = 1.0 - smoothstep(0.3, 2.2, tw.y + (nB - 0.5) * 0.9);
      float wDirt = smoothstep(0.5, 0.78, nA + (nB - 0.5) * 0.35);
      Tap g = tapAT(tD[0], tN[0], tw.xz * ${tile[0]}, gx.xz * ${tile[0]}, gy.xz * ${tile[0]});
      vec3 dcol = detail(g.c, uMean[0]);
      vec3 nW = vec3(g.n.x, 0.0, g.n.y);
      float rough = 0.94;
      #if LAYERS > 2
      if (wDirt > 0.001) {
        Tap t = tapAT(tD[1], tN[1], tw.xz * ${tile[1]}, gx.xz * ${tile[1]}, gy.xz * ${tile[1]});
        dcol = mix(dcol, detail(t.c, uMean[1]) * 0.95, wDirt);
        nW = mix(nW, vec3(t.n.x, 0.0, t.n.y), wDirt);
      }
      if (wMud > 0.001) {
        Tap t = tap(tD[2], tN[2], tw.xz * ${tile[2]}, gx.xz * ${tile[2]}, gy.xz * ${tile[2]});
        dcol = mix(dcol, detail(t.c, uMean[2]), wMud);
        nW = mix(nW, vec3(t.n.x, 0.0, t.n.y), wMud);
      }
      #endif
      if (wRock > 0.001) {
        vec3 rc; vec3 rn;
      #ifdef TRIPLANAR
        vec3 bw = pow(abs(tn), vec3(4.0)); bw /= bw.x + bw.y + bw.z;
        Tap tx = tap(tD[3], tN[3], tw.zy * ${tile[3]}, gx.zy * ${tile[3]}, gy.zy * ${tile[3]});
        Tap tz = tap(tD[3], tN[3], tw.xy * ${tile[3]}, gx.xy * ${tile[3]}, gy.xy * ${tile[3]});
        Tap ty = tap(tD[3], tN[3], tw.xz * ${tile[3]}, gx.xz * ${tile[3]}, gy.xz * ${tile[3]});
        rc = tx.c * bw.x + ty.c * bw.y + tz.c * bw.z;
        rn = vec3(0.0, tx.n.y, tx.n.x) * sign(tn.x) * bw.x + vec3(ty.n.x, 0.0, ty.n.y) * bw.y + vec3(tz.n.x, tz.n.y, 0.0) * sign(tn.z) * bw.z;
      #else
        // one tap: project along the dominant axis, so cliffs don't stretch into streaks
        bool flat_ = tn.y > 0.72, xs = abs(tn.x) > abs(tn.z);
        vec2 ruv = flat_ ? tw.xz : (xs ? tw.zy : tw.xy);
        vec2 rgx = flat_ ? gx.xz : (xs ? gx.zy : gx.xy), rgy = flat_ ? gy.xz : (xs ? gy.zy : gy.xy);
        Tap t = tap(tD[3], tN[3], ruv * ${tile[3]}, rgx * ${tile[3]}, rgy * ${tile[3]});
        rc = t.c;
        rn = flat_ ? vec3(t.n.x, 0.0, t.n.y) : (xs ? vec3(0.0, t.n.y, t.n.x) * sign(tn.x) : vec3(t.n.x, t.n.y, 0.0) * sign(tn.z));
      #endif
      #ifdef RELIEF
        // the same rock at 12x scale: cracks and ledges that read from a kilometre away
        {
          vec2 muv = (tn.y > 0.72 ? tw.xz : (abs(tn.x) > abs(tn.z) ? tw.zy : tw.xy)) * 0.0139;
          vec2 mdx = (tn.y > 0.72 ? gx.xz : (abs(tn.x) > abs(tn.z) ? gx.zy : gx.xy)) * 0.0139, mdy = (tn.y > 0.72 ? gy.xz : (abs(tn.x) > abs(tn.z) ? gy.zy : gy.xy)) * 0.0139;
          Tap mt = tap(tD[3], tN[3], muv, mdx, mdy);
          float macroL = dot(mt.c, vec3(0.2126, 0.7152, 0.0722)) / max(dot(uMean[3], vec3(0.2126, 0.7152, 0.0722)), 1e-3);
          rc *= mix(1.0, macroL, 0.75);
          rn += vec3(mt.n.x, 0.0, mt.n.y) * 1.6;
        }
      #endif
        // sedimentary banding that follows the height of the massif
        float strata = vnoise2(vec2(tw.y * 0.19 + nA * 4.0, tw.x * 0.003 + tw.z * 0.003));
        rc *= mix(0.78, 1.14, strata);
        dcol = mix(dcol, detail(rc, uMean[3]), wRock);
        nW = mix(nW, rn * 1.4, wRock);
        rough = mix(rough, 0.82, wRock);
      }
      #ifdef FLOW
      // where the water ran: dark wet gullies and paler scree fans
      float flowK = texture2D(tFlow, huv).r * inWorld;
      dcol *= 1.0 - 0.42 * smoothstep(0.22, 0.75, flowK);
      #endif
      // wet band along the lake shore: darker, glossier
      float wet = 1.0 - smoothstep(0.05, 0.7, tw.y + (nA - 0.5) * 0.3);
      dcol *= mix(1.0, 0.55, wet);
      rough = mix(rough, 0.32, wet);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.135, 0.125, 0.115), wRock * 0.8);
      diffuseColor.rgb *= clamp(dcol, 0.0, 2.5) * 0.92;
      // snow where it can lie: high up and not too steep
      float snow = smoothstep(235.0, 300.0, tw.y + (nB - 0.5) * 70.0 + (nA - 0.5) * 60.0) * smoothstep(0.42, 0.2, slope);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.8, 0.84), snow);
      rough = mix(rough, 0.6, snow);
      vec3 terrainN = normalize(tn + nW * uNormalK);
      `,
    ).replace(
      '#include <roughnessmap_fragment>',
      'float roughnessFactor = roughness * rough / 0.92;',
    ).replace(
      '#include <normal_fragment_maps>',
      'normal = normalize((viewMatrix * vec4(terrainN, 0.0)).xyz);',
    );
  };
  mat.customProgramCacheKey = () => `terrain-${q.terrainLayers}-${q.antiTile}-${q.triplanar}-${q.terrainRelief}-${!!terrain.flowTex}`;

  // Swap in the CC0 photo layers once they arrive (never blocks the build).
  LAYERS.forEach((l, i) => {
    if (q.terrainLayers === 2 && (i === 1 || i === 2)) return;
    loadSet(l.set, ['diff', 'nor'], q.texSize).then((set) => {
      if (!set.diff || !set.nor) return;
      const m = meanColor(set.diff);
      uniforms.tD.value[i] = set.diff;
      uniforms.tN.value[i] = set.nor;
      uniforms.uMean.value[i].set(m.r, m.g, m.b);
      uniforms.uChroma.value = 0.75;
      uniforms.uNormalK.value = 1.0;
    });
  });
  return mat;
}
