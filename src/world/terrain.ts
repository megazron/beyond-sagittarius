import * as THREE from 'three';
import { Simplex, smoothstep, lerp, clamp, tileFbm, tileNoise } from '../core/noise';
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
    this.material = createTerrainMaterial();
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

/** Procedural tiling detail albedo + normal map, multiplied with vertex colours. */
function createTerrainMaterial(): THREE.MeshStandardMaterial {
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
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const h = hgt[i];
      const g = Math.floor(clamp(222 + (h - 0.5) * 120, 150, 255));
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
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map,
    normalMap: nmap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.92,
    metalness: 0.0,
  });
  return mat;
}
