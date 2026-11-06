import { desktop } from './desktop';

export type QualityName = 'mobile' | 'web' | 'ultra' | 'cinematic';
/** Presets offered in Settings; `cinematic` only exists in the desktop build. */
export const QUALITY_NAMES: QualityName[] = desktop ? ['mobile', 'web', 'ultra', 'cinematic'] : ['mobile', 'web', 'ultra'];

export interface Quality {
  name: QualityName;
  maxPixelRatio: number;
  minPixelRatio: number;
  dynamicResolution: boolean;
  shadowMapSize: number;
  shadowExtent: number;
  terrainSegments: number;
  treeCount: number;
  plantCount: number;
  rockCount: number;
  grassCount: number;
  grassRadius: number;
  /** Blades per grass instance (tuft). */
  grassBlades: number;
  /** Canopy card density (1 = full). */
  foliageDetail: number;
  viewDistance: number;
  fogDensity: number;
  ao: boolean;
  bloomStrength: number;
  heightRes: number;
  /** Ground texture size (terrain layers); props use at most 1k. */
  texSize: TexSize;
  /** Terrain material layers: 2 = soil + rock, 4 = soil, forest floor, mud, rock. */
  terrainLayers: 2 | 4;
  /** Second, rotated sample of each ground layer to break up tiling. */
  antiTile: boolean;
  /** Triplanar projection for the rock layer on steep slopes. */
  triplanar: boolean;
  /** Load the HDRI for image-based lighting (otherwise a sky-gradient environment). */
  hdri: boolean;
  /** Render scale of the ambient-occlusion pass (1 = full, 0.5 = half; only used when ao is on). */
  aoScale: number;
  /** Shadow filter radius in texels (PCF). */
  shadowSoftness: number;
  /** Metres from the camera covered by the two shadow cascades. */
  shadowRange: number;
  /** Percentage-closer soft shadows: penumbra widens with distance from the caster. */
  pcss: boolean;
  /** Post chain with a depth buffer (AO, volumetrics, DoF...). Off = bloom and grade only. */
  post: boolean;
  /** MSAA samples of the scene buffer (leaf cards use alpha-to-coverage when > 0). */
  msaa: 0 | 2 | 4;
  /** Volumetric light: buffer scale (0 = off, 0.25 = quarter resolution) and ray steps. */
  volumetricScale: number;
  volumetricSteps: number;
  /** Depth of field in cutscenes: 0 = off, else spiral step (smaller = more taps). */
  dofStep: number;
  /** Temporal anti-aliasing and camera motion blur (both need the depth buffer). */
  taa: boolean;
  motionBlur: boolean;
  /** Film grain and chromatic aberration strength in the final grade. */
  grain: number;
  aberration: number;
  /** Planar lake reflection: buffer scale, 0 = sky reflection only. */
  reflectionScale: number;
  /** Cloud ray steps in the sky dome, 0 = flat layer. */
  cloudSteps: number;
  /** Use the world models' highest LOD (mobile stops at LOD 1). */
  modelLod0: boolean;
  /** Metres at which instanced models drop to LOD 1 and LOD 2. */
  lodDistances: [number, number];
  /** Fine rock relief computed per pixel on far terrain. */
  terrainRelief: boolean;
  /** Cheap post anti-aliasing (scene MSAA in half float costs too much on laptops). */
  fxaa: boolean;
  /** Frame rate the dynamic-resolution controller holds; 0 = uncapped work. */
  fpsTarget: number;
  /** Sun shadows are redrawn every n-th frame. */
  shadowInterval: number;
  /** GTAO samples per pixel. */
  aoSamples: number;
}

export type TexSize = '512' | '1k' | '2k' | '4k';

const PRESETS: Record<QualityName, Quality> = {
  // Phones and small tablets: chosen automatically on touch devices.
  mobile: {
    name: 'mobile',
    maxPixelRatio: 1.5,
    minPixelRatio: 0.5,
    dynamicResolution: true,
    shadowMapSize: 512,
    shadowExtent: 40,
    terrainSegments: 24,
    treeCount: 1100,
    plantCount: 900,
    rockCount: 450,
    grassCount: 9000,
    grassRadius: 18,
    grassBlades: 4,
    foliageDetail: 0.55,
    viewDistance: 300,
    fogDensity: 0.003,
    ao: false,
    bloomStrength: 0.6,
    heightRes: 512,
    texSize: '512',
    terrainLayers: 2,
    antiTile: false,
    triplanar: false,
    hdri: false,
    aoScale: 0,
    shadowSoftness: 1,
    shadowRange: 70,
    pcss: false,
    post: false,
    msaa: 0,
    volumetricScale: 0,
    volumetricSteps: 0,
    dofStep: 0,
    taa: false,
    motionBlur: false,
    grain: 0.02,
    aberration: 0,
    reflectionScale: 0,
    cloudSteps: 0,
    modelLod0: false,
    lodDistances: [30, 90],
    terrainRelief: false,
    aoSamples: 0,
    shadowInterval: 3,
    fpsTarget: 30,
    fxaa: false,
  },
  web: {
    name: 'web',
    maxPixelRatio: 1.25,
    minPixelRatio: 0.6,
    dynamicResolution: true,
    shadowMapSize: 2048,
    shadowExtent: 60,
    terrainSegments: 32,
    treeCount: 3200,
    plantCount: 5000,
    rockCount: 900,
    grassCount: 22000,
    grassRadius: 30,
    grassBlades: 6,
    foliageDetail: 0.8,
    viewDistance: 420,
    fogDensity: 0.00062,
    ao: true,
    bloomStrength: 0.75,
    heightRes: 768,
    texSize: '1k',
    terrainLayers: 4,
    antiTile: true,
    triplanar: false,
    hdri: true,
    aoScale: 0.5,
    shadowSoftness: 1.5,
    shadowRange: 170,
    pcss: false,
    post: true,
    msaa: 0,
    volumetricScale: 0.25,
    volumetricSteps: 10,
    dofStep: 1.6,
    taa: false,
    motionBlur: false,
    grain: 0.022,
    aberration: 0.0009,
    reflectionScale: 0.33,
    cloudSteps: 0,
    modelLod0: true,
    lodDistances: [38, 120],
    terrainRelief: true,
    aoSamples: 6,
    shadowInterval: 2,
    fpsTarget: 58,
    fxaa: true,
  },
  ultra: {
    name: 'ultra',
    maxPixelRatio: 2,
    minPixelRatio: 0.75,
    dynamicResolution: true,
    shadowMapSize: 3072,
    shadowExtent: 80,
    terrainSegments: 64,
    treeCount: 5000,
    plantCount: 9000,
    rockCount: 2400,
    grassCount: 60000,
    grassRadius: 52,
    grassBlades: 7,
    foliageDetail: 1.2,
    viewDistance: 700,
    fogDensity: 0.0006,
    ao: true,
    bloomStrength: 0.85,
    heightRes: 1024,
    texSize: '2k',
    terrainLayers: 4,
    antiTile: true,
    triplanar: true,
    hdri: true,
    aoScale: 0.5,
    shadowSoftness: 3,
    shadowRange: 280,
    pcss: false,
    post: true,
    msaa: 0,
    volumetricScale: 0.25,
    volumetricSteps: 16,
    dofStep: 1.0,
    taa: false,
    motionBlur: false,
    grain: 0.022,
    aberration: 0.0009,
    reflectionScale: 0.5,
    cloudSteps: 6,
    modelLod0: true,
    lodDistances: [60, 200],
    terrainRelief: true,
    aoSamples: 8,
    shadowInterval: 2,
    fpsTarget: 34,
    fxaa: true,
  },
  // Desktop build only: everything WebGL2 can do, no budget for phones or Pages.
  cinematic: {
    name: 'cinematic',
    maxPixelRatio: 2,
    minPixelRatio: 1,
    dynamicResolution: false,
    shadowMapSize: 4096,
    shadowExtent: 80,
    terrainSegments: 96,
    treeCount: 9000,
    plantCount: 14000,
    rockCount: 3600,
    grassCount: 180000,
    grassRadius: 70,
    grassBlades: 9,
    foliageDetail: 1.4,
    viewDistance: 900,
    fogDensity: 0.0006,
    ao: true,
    bloomStrength: 0.85,
    heightRes: 1536,
    texSize: '4k',
    terrainLayers: 4,
    antiTile: true,
    triplanar: true,
    hdri: true,
    aoScale: 1,
    shadowSoftness: 3,
    shadowRange: 520,
    pcss: true,
    post: true,
    msaa: 4,
    volumetricScale: 0.5,
    volumetricSteps: 40,
    dofStep: 0.7,
    taa: true,
    motionBlur: true,
    grain: 0.02,
    aberration: 0.0009,
    reflectionScale: 1,
    cloudSteps: 20,
    modelLod0: true,
    lodDistances: [90, 300],
    terrainRelief: true,
    aoSamples: 16,
    shadowInterval: 1,
    fpsTarget: 0,
    fxaa: false,
  },
};

const KEY = 'bs-quality';

/**
 * Priority: ?quality= URL flag > saved user choice > environment default
 * (the desktop build's own preset, Mobile on phones/tablets, Ultra on
 * `npm run dev` / localhost, Web everywhere else e.g. GitHub Pages).
 */
export function detectQuality(): Quality {
  const url = new URLSearchParams(location.search).get('quality');
  if (isQuality(url)) return PRESETS[url];
  const saved = localStorage.getItem(KEY);
  if (isQuality(saved)) return PRESETS[saved];
  if (desktop) return PRESETS[isQuality(desktop.quality) ? desktop.quality : 'cinematic'];
  if (isPhone()) return PRESETS.mobile;
  const local = import.meta.env.DEV || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  return PRESETS[local ? 'ultra' : 'web'];
}

export function saveQualityChoice(q: QualityName) {
  localStorage.setItem(KEY, q);
}

export function qualityFromUrl(): boolean {
  return new URLSearchParams(location.search).has('quality');
}

function isQuality(v: string | null): v is QualityName {
  return v === 'mobile' || v === 'web' || v === 'ultra' || v === 'cinematic';
}

/** Touch-first device with a small screen (phones, small tablets). */
export function isPhone(): boolean {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) <= 900;
  const ua = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return (coarse && small) || (ua && small);
}
