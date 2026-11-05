import * as THREE from 'three';
import { Simplex, smoothstep, lerp, clamp, tileFbm, tileNoise } from '../core/noise';
import { NOISE_GLSL } from '../core/glsl';
import { loadSet, meanColor } from '../core/assets';
import type { Quality } from '../core/quality';

export const WORLD_SIZE = 1400;
export const HALF = WORLD_SIZE / 2;
export const LAKE = { x: -70, z: -125, r: 58 };
export const WATER_LEVEL = 0;

const PAL = {
  mossA: new THREE.Color(0x2f6e64),
  mossB: new THREE.Color(0x534682),
  lilac: new THREE.Color(0x8c73b4),
  ochre: new THREE.Color(0x8f8a5a),
  sand: new THREE.Color(0xb3a9bb),
  mud: new THREE.Color(0x3c3846),
  rockA: new THREE.Color(0x6c6676),
  rockB: new THREE.Color(0x4a4553),
  crystal: new THREE.Color(0xc9c3e6),
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

  rawHeight(x: number, z: number): number {
    const n = this.noise;
    const wx = x + 35 * n.noise2(x * 0.0018, z * 0.0018);
    const wz = z + 35 * n.noise2(x * 0.0018 + 31.7, z * 0.0018 - 11.3);
    const base = n.fbm(wx * 0.0035, wz * 0.0035, 6);
    let h = 8 + base * 15;
    const ridge = 1 - Math.abs(n.noise2(wx * 0.0022 + 7.1, wz * 0.0022 - 3.3));
    const d0 = Math.hypot(x, z);
    h += ridge * ridge * ridge * 32 * smoothstep(90, 320, d0);
    h += n.noise2(x * 0.03, z * 0.03) * 0.7 + n.noise2(x * 0.09, z * 0.09) * 0.2;
    const clear = 1 - smoothstep(14, 55, d0);
    h = lerp(h, 6 + base * 3, clear);
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z) + 10 * n.noise2(x * 0.015, z * 0.015);
    const bed = -0.8 - 5.5 * clamp(1 - dl / LAKE.r, 0, 1);
    const tl = 1 - smoothstep(LAKE.r - 18, LAKE.r + 30, dl);
    h = lerp(h, bed, tl);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const rim = smoothstep(420, 680, edge);
    h += rim * rim * (120 + 70 * ridge);
    return h;
  }

  /** Generates the height grid over several frames so the UI stays responsive. */
  async generate(onProgress: (p: number) => void) {
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
    out.lerp(rock, smoothstep(0.22, 0.42, slope));
    out.lerp(PAL.crystal, smoothstep(75, 130, h) * smoothstep(0.5, 0.2, slope));
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
    this.material = createTerrainMaterial(this.q);
    const CH = 100;
    const n = WORLD_SIZE / CH;
    const segs = [this.q.terrainSegments, this.q.terrainSegments / 2, Math.max(8, this.q.terrainSegments / 8)];
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
function createTerrainMaterial(q: Quality): THREE.MeshStandardMaterial {
  const fb = proceduralDetail();
  const uniforms = {
    tD: { value: LAYERS.map(() => fb.map as THREE.Texture) },
    tN: { value: LAYERS.map(() => fb.nmap as THREE.Texture) },
    uMean: { value: LAYERS.map(() => new THREE.Vector3().setScalar(fb.mean)) },
    uChroma: { value: 0.0 },
    uNormalK: { value: 0.6 },
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
      float slope = 1.0 - tn.y;
      vec3 gx = dFdx(tw), gy = dFdy(tw);
      float nA = vnoise2(tw.xz * 0.045);
      float nB = vnoise2(tw.xz * 0.23 + 7.3);
      float wRock = smoothstep(0.17, 0.36, slope + (nB - 0.5) * 0.14);
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
        Tap t = tap(tD[3], tN[3], tw.xz * ${tile[3]}, gx.xz * ${tile[3]}, gy.xz * ${tile[3]});
        rc = t.c; rn = vec3(t.n.x, 0.0, t.n.y);
      #endif
        dcol = mix(dcol, detail(rc, uMean[3]), wRock);
        nW = mix(nW, rn * 1.4, wRock);
        rough = mix(rough, 0.82, wRock);
      }
      // wet band along the lake shore: darker, glossier
      float wet = 1.0 - smoothstep(0.05, 0.7, tw.y + (nA - 0.5) * 0.3);
      dcol *= mix(1.0, 0.55, wet);
      rough = mix(rough, 0.32, wet);
      diffuseColor.rgb *= clamp(dcol, 0.0, 2.5) * 0.92;
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
  mat.customProgramCacheKey = () => `terrain-${q.terrainLayers}-${q.antiTile}-${q.triplanar}`;

  // Swap in the CC0 photo layers once they arrive (never blocks the build).
  LAYERS.forEach((l, i) => {
    if (q.terrainLayers === 2 && (i === 1 || i === 2)) return;
    loadSet(l.set, ['diff', 'nor'], q.texSize).then((set) => {
      if (!set.diff || !set.nor) return;
      const m = meanColor(set.diff);
      uniforms.tD.value[i] = set.diff;
      uniforms.tN.value[i] = set.nor;
      uniforms.uMean.value[i].set(m.r, m.g, m.b);
      uniforms.uChroma.value = 0.35;
      uniforms.uNormalK.value = 1.0;
    });
  });
  return mat;
}
