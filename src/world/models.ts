import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { capSize, loadSet, loadTexture, type PbrMap } from '../core/assets';
import type { Quality, TexSize } from '../core/quality';

/**
 * The scanned Poly Haven models (see tools/fetch_assets.py): three packed GLBs,
 * one per LOD, quantised and meshopt-compressed, plus a manifest with each
 * model's size. Mobile never downloads LOD 0.
 */
export interface ModelInfo {
  set: string;
  kind: 'rock' | 'outcrop' | 'stump' | 'log' | 'roots' | 'branch' | 'plant' | 'shrub';
  alpha: boolean;
  radius: number;
  height: number;
}

export interface ModelPack {
  info: Record<string, ModelInfo>;
  /** Geometry per LOD, position and normal as floats, y up, base at the origin. */
  lods: Record<string, THREE.BufferGeometry[]>;
}

const BASE = `${import.meta.env.BASE_URL}models/world/`;

/** Quantised attributes come with a node transform; bake it so shaders see metres. */
function bake(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry;
  const g = new THREE.BufferGeometry();
  const copy = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, n: number) => {
    const out = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = a.getComponent(i, c);
    return new THREE.BufferAttribute(out, n);
  };
  g.setAttribute('position', copy(src.attributes.position, 3));
  g.setAttribute('normal', copy(src.attributes.normal, 3));
  g.setAttribute('uv', copy(src.attributes.uv, 2));
  g.setIndex(src.index);
  mesh.updateWorldMatrix(true, false);
  g.applyMatrix4(mesh.matrixWorld);
  const n = g.attributes.color ? 0 : g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

export async function loadModelPack(q: Quality): Promise<ModelPack | null> {
  try {
    const info = await (await fetch(`${BASE}manifest.json`)).json() as ModelPack['info'];
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const wanted = q.modelLod0 ? [0, 1, 2] : [1, 2];
    const packs = await Promise.all(wanted.map((k) => loader.loadAsync(`${BASE}pack_lod${k}.glb`)));
    const lods: ModelPack['lods'] = {};
    packs.forEach((p, i) => {
      p.scene.updateMatrixWorld(true);
      p.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const name = (Array.isArray(m.material) ? m.material[0] : m.material).name;
        if (!info[name]) return;
        (lods[name] ??= [])[wanted[i]] = bake(m);
      });
    });
    for (const k in lods) lods[k][0] ??= lods[k][1];
    return { info, lods };
  } catch (e) {
    console.warn('[models] pack failed to load; the world stays sparse', e);
    return null;
  }
}

const ROUGH: Record<ModelInfo['kind'], number> = { rock: 0.88, outcrop: 0.9, stump: 0.85, log: 0.85, roots: 0.85, branch: 0.85, plant: 0.7, shrub: 0.72 };
const FALLBACK: Record<ModelInfo['kind'], number> = { rock: 0x5b5a58, outcrop: 0x5b5a58, stump: 0x4a4034, log: 0x4a4034, roots: 0x4a4034, branch: 0x4a4034, plant: 0x2f4426, shrub: 0x2f4426 };

/** Materials of the scans, shared by the scatter and the story props. */
export const modelMats = new Map<string, THREE.MeshStandardMaterial>();

/** One material per texture set; the maps stream in after the world is up. */
export function modelMaterial(info: ModelInfo, q: Quality, cache: Map<string, THREE.MeshStandardMaterial>): THREE.MeshStandardMaterial {
  let m = cache.get(info.set);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color: FALLBACK[info.kind], roughness: ROUGH[info.kind], metalness: 0,
    vertexColors: true,
    side: info.alpha ? THREE.DoubleSide : THREE.FrontSide,
    alphaTest: info.alpha ? 0.45 : 0,
  });
  if (info.alpha) m.visible = false; // an untextured leaf card would be a solid quad
  cache.set(info.set, m);
  const mat = m;
  // the desktop build's 4K maps fall back to the shipped 1K
  const size: TexSize = q.texSize === '4k' ? '4k' : capSize(q.texSize, '1k');
  const maps: PbrMap[] = ['diff', 'nor'];
  loadSet(`m/${info.set}`, maps, size).then((s) => {
    for (const t of [s.diff, s.nor]) if (t) { t.flipY = false; t.needsUpdate = true; } // glTF UVs start top-left
    if (s.diff) { mat.map = s.diff; mat.color.set(0xffffff); mat.visible = true; }
    if (s.nor) { mat.normalMap = s.nor; mat.normalScale.setScalar(1); }
    mat.needsUpdate = true;
  });
  return m;
}

/** Foliage card sheet: left half a bough, right half a spray. */
export async function loadFoliageCard(name: 'fir' | 'pine' | 'leaf', q: Quality): Promise<THREE.Texture | null> {
  try {
    return await loadTexture('foliage', name, capSize(q.texSize, '1k'));
  } catch { return null; }
}
