export type QualityName = 'mobile' | 'web' | 'ultra';
export const QUALITY_NAMES: QualityName[] = ['mobile', 'web', 'ultra'];

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
}

export type TexSize = '512' | '1k' | '2k';

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
    treeCount: 1300,
    plantCount: 900,
    rockCount: 450,
    grassCount: 9000,
    grassRadius: 18,
    grassBlades: 4,
    foliageDetail: 0.55,
    viewDistance: 300,
    fogDensity: 0.0026,
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
  },
  web: {
    name: 'web',
    maxPixelRatio: 1.25,
    minPixelRatio: 0.6,
    dynamicResolution: true,
    shadowMapSize: 2048,
    shadowExtent: 60,
    terrainSegments: 32,
    treeCount: 2600,
    plantCount: 2500,
    rockCount: 900,
    grassCount: 30000,
    grassRadius: 30,
    grassBlades: 7,
    foliageDetail: 0.8,
    viewDistance: 420,
    fogDensity: 0.0015,
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
  },
  ultra: {
    name: 'ultra',
    maxPixelRatio: 2,
    minPixelRatio: 1,
    dynamicResolution: false,
    shadowMapSize: 4096,
    shadowExtent: 80,
    terrainSegments: 64,
    treeCount: 7000,
    plantCount: 8000,
    rockCount: 2400,
    grassCount: 110000,
    grassRadius: 52,
    grassBlades: 9,
    foliageDetail: 1.2,
    viewDistance: 700,
    fogDensity: 0.0012,
    ao: true,
    bloomStrength: 0.85,
    heightRes: 1024,
    texSize: '2k',
    terrainLayers: 4,
    antiTile: true,
    triplanar: true,
    hdri: true,
    aoScale: 1,
    shadowSoftness: 3,
  },
};

const KEY = 'bs-quality';

/**
 * Priority: ?quality= URL flag > saved user choice > environment default
 * (Mobile on phones/tablets, Ultra on `npm run dev` / localhost, Web everywhere
 * else e.g. GitHub Pages).
 */
export function detectQuality(): Quality {
  const url = new URLSearchParams(location.search).get('quality');
  if (isQuality(url)) return PRESETS[url];
  const saved = localStorage.getItem(KEY);
  if (isQuality(saved)) return PRESETS[saved];
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
  return v === 'mobile' || v === 'web' || v === 'ultra';
}

/** Touch-first device with a small screen (phones, small tablets). */
export function isPhone(): boolean {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) <= 900;
  const ua = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return (coarse && small) || (ua && small);
}
