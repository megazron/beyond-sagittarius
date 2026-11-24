// The combat simulation's shared types and small maths. Nothing in src/combat/sim touches the DOM or three.js:
// the same code runs in the game and, with a fixed step and a seed, in tools/combat/sim_test.ts under Node.
// (Node's type stripping runs these files as they are: no enums, no constructor parameter properties.)

export interface V3 { x: number; y: number; z: number }
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
/** Shortest signed turn from angle a to angle b. */
export const turnTo = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the world tells the fight: the ground, what blocks a body or a line of sight, and deep water. */
export interface Env {
  height(x: number, z: number): number;
  blocked(x: number, z: number, r: number): boolean;
  /** The water's surface height over (x, z), or null where there is no water (fish, spears entering water). */
  water?(x: number, z: number): number | null;
}
export const FLAT: Env = { height: () => 0, blocked: () => false };

export type Difficulty = 'story' | 'normal' | 'hard';
export interface Tuning {
  /** Damage the player takes, enemy health, how long a telegraph lasts, how soon they commit. */
  enemyDmg: number; enemyHp: number; telegraph: number; aggression: number;
  staminaCost: number;
  /** Degrees of help at full aim assist. */
  assistCone: number;
  /** Tension minigame windows. */
  tension: number;
  /** How many creatures may be attacking you at the same moment; the rest hang back and wait their turn. */
  tokens: number;
}
export const TUNING: Record<Difficulty, Tuning> = {
  story: { enemyDmg: 0.5, enemyHp: 0.7, telegraph: 1.4, aggression: 0.7, staminaCost: 0.7, assistCone: 16, tension: 1.5, tokens: 1 },
  normal: { enemyDmg: 1, enemyHp: 1, telegraph: 1, aggression: 1, staminaCost: 1, assistCone: 10, tension: 1, tokens: 2 },
  hard: { enemyDmg: 1.4, enemyHp: 1.25, telegraph: 0.82, aggression: 1.3, staminaCost: 1.1, assistCone: 6, tension: 0.8, tokens: 3 },
};

/** Accessibility, set by the player. */
export interface Assist {
  /** 0 off, 1 normal, 2 strong. */
  aim: 0 | 1 | 2;
  /** Hold a button instead of timing or mashing it. */
  hold: boolean;
  /** Time slows while you aim and when an attack is about to land. */
  slowMo: boolean;
  /** Timed windows wait for the player. */
  noTimers: boolean;
  damageNumbers: boolean;
}
export const defaultAssist = (): Assist => ({ aim: 1, hold: false, slowMo: false, noTimers: false, damageNumbers: false });

export type EventType = 'swing' | 'hit' | 'miss' | 'telegraph' | 'state' | 'sound' | 'spawn' | 'death' | 'fled' | 'shot' | 'land'
  | 'trap' | 'player' | 'beat' | 'pickup' | 'fire' | 'phase' | 'ally';
/** Something that happened this step, for the picture, the sound and the tests. Fields are filled as they apply. */
export interface SimEvent {
  t: EventType;
  /** Enemy id, or -1 for the player, -2 for a companion. */
  id?: number;
  what?: string;
  x?: number; y?: number; z?: number;
  dx?: number; dz?: number;
  n?: number;
  dur?: number;
  len?: number;
  r?: number;
  weak?: boolean; blocked?: boolean; killed?: boolean; deflect?: boolean;
}

/** A sound in the world that things with ears can turn towards. */
export interface Noise { x: number; z: number; r: number; t: number; from: number }
/** Something that smells of food. */
export interface Scent { x: number; z: number; r: number; food: number; id: number }
/** A fire: light, warmth and the one thing the night is afraid of. */
export interface Fire { x: number; z: number; fuel: number; max: number; r: number; id: number; torch?: boolean; burnsOut?: boolean; /** Burn rate scale: a fire nobody is pressing on (the dusk before the night) burns slower. */ slow?: number; /** Branches stacked beside it for it alone (the night's wood pile): fed before the bag's. */ pile?: number }

/** Low ballistic launch from a to b at a given speed: the velocity, or a flat shot when b is out of reach. */
export function solveLaunch(a: V3, b: V3, speed: number, g: number): V3 {
  const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y, d = Math.hypot(dx, dz);
  if (d < 1e-4) return v3(0, speed * Math.sign(dy || 1), 0);
  if (g <= 1e-6) { const l = Math.hypot(d, dy); return v3((dx / l) * speed, (dy / l) * speed, (dz / l) * speed); }
  const s2 = speed * speed, disc = s2 * s2 - g * (g * d * d + 2 * dy * s2);
  // out of reach: 40 degrees up is as far as it goes
  const ang = disc < 0 ? 0.7 : Math.atan2(s2 - Math.sqrt(disc), g * d);
  const c = Math.cos(ang) * speed;
  return v3((dx / d) * c, Math.sin(ang) * speed, (dz / d) * c);
}

/** Refractive index of water (fresh, visible light). */
export const WATER_N = 1.333;
/**
 * Where a point under still water is SEEN from a point above it: light from it bends at the surface (Snell's law,
 * n1 sin a = n2 sin b), so the eye sees it along the bent ray's last leg. The image is put on the vertical through the
 * real point (the usual convention for a viewer in air): straight down it is at depth / 1.33, looking across the
 * water it is raised far more. Returns the seen height (y) of the point; x and z are its own.
 */
export function seenDepthY(ex: number, ey: number, ez: number, px: number, py: number, pz: number, surface: number): number {
  const hc = ey - surface, df = surface - py;
  if (df <= 0 || hc <= 0) return py;
  const D = Math.hypot(px - ex, pz - ez);
  if (D < 1e-3) return surface - df / WATER_N;
  // where the ray crosses the surface, x metres out from the eye: sin(in air) = n sin(in water)
  let lo = 0, hi = D;
  for (let i = 0; i < 40; i++) {
    const x = (lo + hi) / 2, si = x / Math.hypot(x, hc), st = (D - x) / Math.hypot(D - x, df);
    if (si > WATER_N * st) hi = x; else lo = x;
  }
  const x = Math.max(1e-4, (lo + hi) / 2);
  // the straight line from the eye through that point, carried on to the real point's vertical
  return surface - ((D - x) * hc) / x;
}
