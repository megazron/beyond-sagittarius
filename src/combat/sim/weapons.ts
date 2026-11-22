// Every weapon and trap is a row of data. A later age adds rows (and a model in view/gear.ts); nothing else changes.

export type WeaponId = 'fists' | 'rock' | 'flake' | 'handaxe' | 'club' | 'spear' | 'hafted' | 'atlatl' | 'torch' | 'sling' | 'bow' | 'crossbow' | 'coil';
export type DamageKind = 'blunt' | 'pierce' | 'fire' | 'energy';

export interface ProjDef {
  /** Inventory item one shot uses (null: the weapon itself is thrown, or it runs on charge). */
  ammo: string | null;
  speed: number; gravity: number; dmg: number; kind: DamageKind;
  /** Seconds to hold for a full shot; 0 fires on the press. */
  charge: number;
  /** Speed and damage at no charge, as a fraction. */
  weak: number;
  radius: number; knock: number; poise: number;
  /** Chance the shot can be picked up again. */
  recover: number;
  /** Seconds a hit stops a machine. */
  stun?: number;
  /** Energy weapons: shots in a full cell and seconds to refill one. */
  cell?: number; recharge?: number;
  /** How far the landing is heard. */
  noise: number;
  /** Degrees a shot can stray at no draw and at full draw: a novice's hands, not a marksman's. */
  spread: [number, number];
  /** Seconds to make the weapon ready again after a shot (a crossbow is spanned by hand). */
  reload?: number;
}

export interface WeaponDef {
  id: WeaponId;
  /** The age that makes it (0 is the first day). The slice ships 0 and 1; the others work in the test arena. */
  age: number;
  /** What it takes to make one, in inventory items: the crafting hook. */
  craft: Record<string, number> | null;
  melee?: { dmg: number; reach: number; arc: number; windup: number; active: number; recover: number; stamina: number; knock: number; poise: number; kind: DamageKind; noise: number };
  /** Fired with attack while aiming (bow, sling), or with the alternate attack (a thrown spear). */
  proj?: ProjDef;
  /** Blocking with it in hand takes this share of a hit off. */
  block: number;
  /** Lit: night creatures keep their distance. */
  fire?: boolean;
  /** Only ranged: attack always shoots. */
  ranged?: boolean;
  /** Kilograms in the hand: heavier costs more breath to swing and carry. */
  mass: number;
  /** Blows or shots before it breaks (0: it does not wear). A torch counts seconds alight. */
  dur: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: { id: 'fists', mass: 0, dur: 0, age: 0, craft: null, block: 0.35,
    melee: { dmg: 5, reach: 1.25, arc: 1.2, windup: 0.14, active: 0.1, recover: 0.26, stamina: 6, knock: 1.2, poise: 8, kind: 'blunt', noise: 4 } },
  // a stone in the fist, or thrown: the first day's only answer at a distance
  rock: { id: 'rock', mass: 0.6, dur: 0, age: 0, craft: { stone: 1 }, block: 0.35,
    melee: { dmg: 9, reach: 1.3, arc: 1.1, windup: 0.22, active: 0.1, recover: 0.36, stamina: 9, knock: 2, poise: 16, kind: 'blunt', noise: 6 },
    proj: { ammo: 'stone', speed: 17, gravity: 9.81, dmg: 10, kind: 'blunt', charge: 0.45, weak: 0.6, radius: 0.09, knock: 2.2, poise: 18, recover: 1, noise: 9, spread: [5, 2.4] } },
  // a sharp flake knocked off a core with a hammerstone: a knife first, a weapon only at arm's length of nothing
  flake: { id: 'flake', mass: 0.15, dur: 25, age: 0, craft: { stone: 2 }, block: 0.2,
    melee: { dmg: 8, reach: 1.15, arc: 0.9, windup: 0.16, active: 0.08, recover: 0.3, stamina: 6, knock: 0.8, poise: 8, kind: 'pierce', noise: 3 } },
  // an Acheulean hand axe: a big flint nodule shaped on both faces into a heavy teardrop with an edge all round, held
  // in the fist without a handle (Kenya, about 1.76 million years ago). A tool for chopping and butchering first; as a
  // weapon it is a short, heavy chop that bites and lasts
  handaxe: { id: 'handaxe', mass: 0.9, dur: 90, age: 1, craft: { stone: 3 }, block: 0.3,
    melee: { dmg: 13, reach: 1.25, arc: 1.1, windup: 0.27, active: 0.1, recover: 0.42, stamina: 10, knock: 2.2, poise: 22, kind: 'pierce', noise: 5 } },
  // a heavy branch, trimmed: the first thing anyone picks up
  club: { id: 'club', mass: 1.6, dur: 70, age: 0, craft: { branch: 1 }, block: 0.55,
    melee: { dmg: 14, reach: 1.7, arc: 1.5, windup: 0.34, active: 0.14, recover: 0.5, stamina: 14, knock: 4, poise: 30, kind: 'blunt', noise: 7 } },
  // a straight sapling, its point shaped with a flake and hardened in the coals (Schoeningen, Clacton): the point
  // dulls and splits with use, so it wears quicker than a club
  spear: { id: 'spear', mass: 1.3, dur: 35, age: 0, craft: { branch: 1 }, block: 0.6,
    melee: { dmg: 16, reach: 2.6, arc: 0.5, windup: 0.3, active: 0.12, recover: 0.46, stamina: 12, knock: 2.5, poise: 22, kind: 'pierce', noise: 5 },
    proj: { ammo: null, speed: 21, gravity: 9.81, dmg: 26, kind: 'pierce', charge: 0.6, weak: 0.55, radius: 0.1, knock: 3, poise: 34, recover: 1, noise: 7, spread: [5, 2.2] } },
  // a knapped point set in a split shaft, bound with cordage and glued with resin or birch tar: deeper wounds, and
  // the binding is what gives first
  hafted: { id: 'hafted', mass: 1.4, dur: 40, age: 1, craft: { branch: 1, stone: 1, fibre: 1, resin: 1 }, block: 0.6,
    melee: { dmg: 21, reach: 2.6, arc: 0.5, windup: 0.3, active: 0.12, recover: 0.46, stamina: 12, knock: 2.5, poise: 24, kind: 'pierce', noise: 5 },
    proj: { ammo: null, speed: 21, gravity: 9.81, dmg: 33, kind: 'pierce', charge: 0.6, weak: 0.55, radius: 0.1, knock: 3, poise: 36, recover: 0.9, noise: 7, spread: [5, 2.2] } },
  // the spear-thrower: a stick with a hook at the far end that the dart's butt sits in. The longer lever throws a
  // light dart much faster than an arm alone (darts of 1.5 to 2 m; launch speeds measured around 25 to 40 m/s)
  atlatl: { id: 'atlatl', mass: 0.3, dur: 120, age: 1, craft: { branch: 2, fibre: 1 }, block: 0.2, ranged: true,
    proj: { ammo: 'dart', speed: 30, gravity: 9.81, dmg: 24, kind: 'pierce', charge: 0.75, weak: 0.5, radius: 0.08, knock: 2.6, poise: 30, recover: 0.85, noise: 6, spread: [5.5, 2] } },
  torch: { id: 'torch', mass: 0.9, dur: 240, age: 0, craft: { branch: 1, tinder: 1 }, block: 0.4, fire: true,
    melee: { dmg: 8, reach: 1.8, arc: 1.9, windup: 0.26, active: 0.2, recover: 0.4, stamina: 9, knock: 1.5, poise: 14, kind: 'fire', noise: 5 } },
  sling: { id: 'sling', mass: 0.1, dur: 140, age: 1, craft: { fibre: 3, hide: 1 }, block: 0.2, ranged: true,
    proj: { ammo: 'stone', speed: 30, gravity: 9.81, dmg: 15, kind: 'blunt', charge: 0.8, weak: 0.45, radius: 0.08, knock: 2.6, poise: 26, recover: 1, noise: 10, spread: [4.5, 1.6] } },
  bow: { id: 'bow', mass: 0.7, dur: 90, age: 1, craft: { branch: 1, sinew: 2, fibre: 1 }, block: 0.25, ranged: true,
    proj: { ammo: 'arrow', speed: 40, gravity: 9.81, dmg: 20, kind: 'pierce', charge: 0.95, weak: 0.4, radius: 0.06, knock: 1.6, poise: 20, recover: 0.6, noise: 5, spread: [3.2, 0.8] } },
  crossbow: { id: 'crossbow', mass: 3.2, dur: 220, age: 4, craft: { branch: 3, vine: 2, bronze: 1 }, block: 0.3, ranged: true,
    proj: { ammo: 'bolt', speed: 58, gravity: 9.81, dmg: 34, kind: 'pierce', charge: 0, weak: 1, radius: 0.06, knock: 2.4, poise: 36, recover: 0.5, noise: 6, spread: [0.7, 0.7], reload: 2.6 } },
  // the Scientist's salvage shooter: a coil that throws a charged slug. It stops machines; it runs on a cell that refills.
  coil: { id: 'coil', mass: 2.4, dur: 0, age: 7, craft: { scrap: 4, cell: 1 }, block: 0.3, ranged: true,
    proj: { ammo: null, speed: 95, gravity: 9.81, dmg: 22, kind: 'energy', charge: 0, weak: 1, radius: 0.1, knock: 1.4, poise: 30, recover: 0, stun: 0.9, cell: 8, recharge: 1.6, noise: 14, spread: [0.4, 0.4] } },
};
/** Seconds between shots for weapons that fire on the press. */
export const REFIRE: Partial<Record<WeaponId, number>> = { crossbow: 0.3, coil: 0.28 };
/** Arrows and bolts are made, not found. */
export const AMMO_CRAFT: Record<string, { cost: Record<string, number>; makes: number }> = {
  // a shaft, a knapped head bound and glued on, and fletching: four from a good branch
  arrow: { cost: { branch: 1, stone: 1, fibre: 1 }, makes: 4 },
  bolt: { cost: { branch: 1, bronze: 1 }, makes: 4 },
  // a long light shaft with a knapped head: two from a good branch
  dart: { cost: { branch: 1, stone: 1, fibre: 1 }, makes: 2 },
};

export type TrapId = 'snare' | 'stakes' | 'fireline' | 'rattle' | 'bait' | 'deadfall';
export interface TrapDef {
  id: TrapId; cost: Record<string, number>;
  /** Trigger radius, and how many times it works. */
  r: number; uses: number;
  /** Seconds it holds what it catches; damage; poise damage. */
  hold: number; dmg: number; poise: number;
  /** Seconds to set, standing still. */
  setTime: number;
}
export const TRAPS: Record<TrapId, TrapDef> = {
  // a loop of vine on a bent branch: holds something small, slows something big
  snare: { id: 'snare', cost: { vine: 1, branch: 1 }, r: 0.9, uses: 1, hold: 4.5, dmg: 0, poise: 0, setTime: 1.6 },
  // sharpened branches set in the ground: whatever runs on to them stops
  stakes: { id: 'stakes', cost: { branch: 3 }, r: 1.3, uses: 3, hold: 0.8, dmg: 22, poise: 60, setTime: 2.2 },
  // tinder along the ground, lit: a wall the night will not cross while it burns
  fireline: { id: 'fireline', cost: { tinder: 1, branch: 1 }, r: 2.2, uses: 1, hold: 0, dmg: 6, poise: 20, setTime: 1.8 },
  // stones on a vine: it rattles where you are not
  rattle: { id: 'rattle', cost: { vine: 1, stone: 2 }, r: 2.5, uses: 3, hold: 0, dmg: 0, poise: 0, setTime: 1.2 },
  // food left out: it brings them where you want them
  bait: { id: 'bait', cost: { fruit: 1 }, r: 0.8, uses: 1, hold: 0, dmg: 0, poise: 0, setTime: 0.6 },
  // a figure-four deadfall: a flat stone propped on three notched sticks, the bait on the trigger stick. Something
  // small that pulls at the bait brings the stone down on itself; something big only knocks it over
  deadfall: { id: 'deadfall', cost: { stone: 1, branch: 1, fruit: 1 }, r: 0.85, uses: 1, hold: 0, dmg: 40, poise: 50, setTime: 2.6 },
};
