export type QualityName = 'web' | 'ultra';

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
  viewDistance: number;
  fogDensity: number;
  ao: boolean;
  bloomStrength: number;
  heightRes: number;
}

const PRESETS: Record<QualityName, Quality> = {
  web: {
    name: 'web',
    maxPixelRatio: 1.25,
    minPixelRatio: 0.6,
    dynamicResolution: true,
    shadowMapSize: 1024,
    shadowExtent: 55,
    terrainSegments: 32,
    treeCount: 2600,
    plantCount: 2500,
    rockCount: 900,
    grassCount: 36000,
    grassRadius: 34,
    viewDistance: 420,
    fogDensity: 0.0028,
    ao: false,
    bloomStrength: 0.75,
    heightRes: 768,
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
    grassCount: 150000,
    grassRadius: 58,
    viewDistance: 700,
    fogDensity: 0.0021,
    ao: true,
    bloomStrength: 0.85,
    heightRes: 1024,
  },
};

const KEY = 'bs-quality';

/**
 * Priority: ?quality= URL flag > saved user choice > environment default
 * (Ultra on `npm run dev` / localhost, Web everywhere else e.g. GitHub Pages).
 */
export function detectQuality(): Quality {
  const url = new URLSearchParams(location.search).get('quality');
  if (url === 'web' || url === 'ultra') return PRESETS[url];
  const saved = localStorage.getItem(KEY);
  if (saved === 'web' || saved === 'ultra') return PRESETS[saved];
  const local = import.meta.env.DEV || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  return PRESETS[local ? 'ultra' : 'web'];
}

export function saveQualityChoice(q: QualityName) {
  localStorage.setItem(KEY, q);
}

export function qualityFromUrl(): boolean {
  return new URLSearchParams(location.search).has('quality');
}
