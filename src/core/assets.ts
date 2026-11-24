import * as THREE from 'three';
import type { TexSize } from './quality';
import { desktop } from './desktop';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/**
 * Lazy texture loading for the CC0 PBR sets in public/textures (see
 * tools/fetch_assets.py and CREDITS.md). Every call returns immediately; the
 * callback fires when the image has arrived so materials can render with
 * their procedural fallback until then. Failures are logged as warnings only.
 */
const BASE = import.meta.env.BASE_URL;
/** Where 4K textures live: the desktop download's asset folder, else this site. */
const slash = (s: string) => (s.endsWith('/') ? s : `${s}/`);
export const ASSET_BASE = desktop?.assetBase ? slash(desktop.assetBase) : BASE;
const loader = new THREE.TextureLoader();
const cache = new Map<string, Promise<THREE.Texture>>();
let maxAniso = 4;

// Uploading a big texture on first use stalls that frame, so upload as they arrive, one at a time.
const warmQueue: THREE.Texture[] = [];
let warmer: ((t: THREE.Texture) => void) | null = null, pumping = false;
function pumpWarm() {
  if (pumping || !warmer) return;
  const t = warmQueue.shift();
  if (!t) return;
  pumping = true;
  warmer(t);
  setTimeout(() => { pumping = false; pumpWarm(); }, 60);
}
/** Textures still waiting for their upload (perf_gate's settle). */
export function warmPending() { return warmQueue.length + (pumping ? 1 : 0); }
export function setTextureWarmer(f: (t: THREE.Texture) => void) { warmer = f; pumpWarm(); }

/**
 * Colour maps as KTX2 (Basis ETC1S, tools/ktx2_encode.py): about the webp's size to download, but they stay compressed
 * on the GPU (BC1/BC7 on a laptop, ETC/ASTC on a phone), a quarter to an eighth of the memory and of the upload of the
 * decoded webp, with their mipmaps made at build time instead of on upload. Only the files listed in
 * textures/ktx2.json are tried; a failure falls back to the webp. `?ktx2=0` turns it off.
 */
let ktx2: KTX2Loader | null = null, ktx2List: Promise<Set<string>> | null = null;
export function setKtx2Renderer(r: THREE.WebGLRenderer) {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('ktx2') === '0') return;
  try { ktx2 = new KTX2Loader().setTranscoderPath(`${BASE}basis/`).detectSupport(r); } catch { ktx2 = null; return; }
  ktx2List = fetch(`${BASE}textures/ktx2.json`).then((x) => (x.ok ? x.json() : [])).then((a: string[]) => new Set(a)).catch(() => new Set<string>());
}
async function loadKtx2(set: string, map: MapKind, size: TexSize): Promise<THREE.Texture | null> {
  if (!ktx2 || !ktx2List || size === '4k' || map !== 'diff') return null;
  const rel = `${set}/${map}_${size}`;
  if (!(await ktx2List).has(rel)) return null;
  try { return await ktx2.loadAsync(`${BASE}textures/${rel}.ktx2`); } catch (e) { console.warn('[assets] ktx2', rel, e); return null; }
}

export function setMaxAnisotropy(n: number) { maxAniso = Math.max(1, n); }

export type MapKind = 'diff' | 'nor' | 'arm' | 'fir' | 'pine' | 'leaf';

export function texUrl(set: string, map: MapKind, size: TexSize): string {
  return `${size === '4k' ? ASSET_BASE : BASE}textures/${set}/${map}_${size}.webp`;
}

/** Caps a requested size (e.g. props never need more than 1k). */
export function capSize(size: TexSize, max: TexSize): TexSize {
  const order: TexSize[] = ['512', '1k', '2k', '4k'];
  return order[Math.min(order.indexOf(size), order.indexOf(max))];
}

/** Sizes tried after the requested one: a missing 4K file falls back to the shipped 2K, 1K, 512. */
const FALLBACK: Record<TexSize, TexSize | null> = { '4k': '2k', '2k': '1k', '1k': '512', '512': null };

export function loadTexture(set: string, map: MapKind, size: TexSize): Promise<THREE.Texture> {
  const url = texUrl(set, map, size);
  let p = cache.get(url);
  if (!p) {
    p = loadKtx2(set, map, size).then((k) => k ? (() => {
      k.wrapS = k.wrapT = THREE.RepeatWrapping; k.anisotropy = maxAniso; k.needsUpdate = true;
      warmQueue.push(k); pumpWarm();
      return k;
    })() : new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(url, (t) => {
        t.colorSpace = map === 'nor' || map === 'arm' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = maxAniso;
        t.needsUpdate = true;
        warmQueue.push(t); pumpWarm();
        resolve(t);
      }, undefined, reject);
    })).catch((e) => {
      const next = FALLBACK[size];
      if (next) return loadTexture(set, map, next);
      throw e;
    });
    cache.set(url, p);
  }
  return p;
}

export type PbrMap = 'diff' | 'nor' | 'arm';
export interface PbrSet { diff?: THREE.Texture; nor?: THREE.Texture; arm?: THREE.Texture }

/** Loads several maps of one set; resolves with whatever loaded (never rejects). */
export async function loadSet(set: string, maps: PbrMap[], size: TexSize): Promise<PbrSet> {
  const out: PbrSet = {};
  await Promise.all(maps.map((m) => loadTexture(set, m, size).then(
    (t) => { out[m] = t; },
    () => console.warn(`[assets] missing ${texUrl(set, m, size)}`),
  )));
  return out;
}

/** Average linear colour of a loaded sRGB image (used to normalise albedo detail). */
export function meanColor(tex: THREE.Texture): THREE.Color {
  const img = tex.image as CanvasImageSource | undefined;
  const c = new THREE.Color(0.5, 0.5, 0.5);
  if (!img) return c;
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let r = 0, gg = 0, b = 0;
    const lin = (v: number) => Math.pow(v / 255, 2.2);
    for (let i = 0; i < d.length; i += 4) { r += lin(d[i]); gg += lin(d[i + 1]); b += lin(d[i + 2]); }
    const n = d.length / 4;
    c.setRGB(r / n, gg / n, b / n);
  } catch { /* tainted canvas: keep grey */ }
  return c;
}

/**
 * Applies a PBR set to a standard material once it has loaded. `tint` keeps the
 * alien palette: the albedo is normalised by its mean and multiplied by the
 * material colour, so the photo only contributes detail.
 */
export function applyPbr(mat: THREE.MeshStandardMaterial, set: PbrSet, opts: { normalScale?: number; useArm?: boolean } = {}) {
  if (set.diff) mat.map = set.diff;
  if (set.nor) {
    mat.normalMap = set.nor;
    mat.normalScale.setScalar(opts.normalScale ?? 1);
  }
  if (set.arm && opts.useArm !== false) {
    mat.roughnessMap = set.arm;
    mat.aoMap = null;
  }
  mat.needsUpdate = true;
}
