// What lives on Verdaxis and fights back, as data. A new creature is a row here, a behaviour in ai.ts if none of the
// temperaments fits, and a body in view/creatures.ts. Original designs: nothing here is taken from any other game or show.

export type SpeciesId = 'skritch' | 'hound' | 'mossback' | 'lashbloom' | 'guardian' | 'nibbet';
/** How a creature decides: steals and runs, hunts from the dark, defends its ground, waits, is built, or is hunted. */
export type Temperament = 'skittish' | 'stalker' | 'territorial' | 'ambush' | 'machine' | 'prey';
export type AttackKind = 'nip' | 'lunge' | 'charge' | 'lash' | 'beam' | 'stomp';
export type EnemyState = 'idle' | 'investigate' | 'stalk' | 'windup' | 'strike' | 'recover' | 'flee' | 'call' | 'stagger' | 'dead'
  | 'feed' | 'warn' | 'dormant' | 'asleep';

export interface AttackDef {
  id: AttackKind;
  /** Distance to the target it is started from. */
  min: number; max: number;
  /** Telegraph, the hit itself, and the opening after it (seconds). */
  windup: number; active: number; recover: number;
  dmg: number; knock: number;
  /** Speed of the body during the hit (a lunge, a charge), and how far it can carry. */
  speed: number; reach: number;
  cooldown: number;
  /** Seconds the weak point shows after the attack. */
  open: number;
}

export interface SpeciesDef {
  id: SpeciesId;
  temperament: Temperament;
  hp: number; radius: number; height: number; mass: number;
  walk: number; run: number; turn: number;
  /** Sight in metres by day and by night, and the width of the cone in radians. */
  sightDay: number; sightNight: number; fov: number;
  /** Hearing multiplies how far a noise carries to it; smell is how far it follows food or you, downwind. */
  hear: number; smell: number;
  /** Metres it keeps from a fire (0: fire means nothing to it). */
  fireFear: number;
  /** Awake by day, by night, or both. */
  active: 'day' | 'night' | 'both';
  attacks: AttackDef[];
  /** Poise damage that staggers it; a hit on the weak point is worth this much more; damage from the front counts this much. */
  poise: number; weak: number; armor: number;
  /** Below this share of its health it gives up and runs (0: it never does). */
  fleeAt: number;
  /** Boss framework: at each health share a new phase starts, faster and with shorter telegraphs. */
  phases?: { at: number; speed: number; telegraph: number; id: string }[];
  boss?: boolean;
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  // Skritch: knee-high pack scavengers. They want your food, not you, and they are brave only in numbers.
  skritch: { id: 'skritch', temperament: 'skittish', hp: 18, radius: 0.35, height: 0.5, mass: 0.5, walk: 2.2, run: 7.4, turn: 9,
    sightDay: 22, sightNight: 16, fov: 3.6, hear: 1.2, smell: 26, fireFear: 4.5, active: 'both', poise: 10, weak: 1.6, armor: 1, fleeAt: 0.45,
    attacks: [{ id: 'nip', min: 0, max: 3.4, windup: 0.5, active: 0.28, recover: 0.7, dmg: 6, knock: 1.5, speed: 9, reach: 3.6, cooldown: 2.6, open: 0.5 }] },
  // Duskhound: the six-eyed night hunter. It circles outside the light, comes from behind, and hates fire.
  hound: { id: 'hound', temperament: 'stalker', hp: 90, radius: 0.6, height: 1.0, mass: 2.2, walk: 2.6, run: 7.6, turn: 6,
    sightDay: 14, sightNight: 30, fov: 2.6, hear: 1.5, smell: 18, fireFear: 4, active: 'night', poise: 46, weak: 1.8, armor: 0.6, fleeAt: 0.3,
    attacks: [{ id: 'lunge', min: 4, max: 13, windup: 0.95, active: 0.9, recover: 1.15, dmg: 16, knock: 5, speed: 14, reach: 12.5, cooldown: 3.4, open: 1.3 },
      // crowd it and it snaps: nobody boxes a predator
      { id: 'nip', min: 0, max: 3.3, windup: 0.5, active: 0.25, recover: 0.6, dmg: 12, knock: 3.5, speed: 9, reach: 3.2, cooldown: 1.5, open: 0.35 }] },
  // Mossback: a plated grazer the size of a small car. Leave it alone and it leaves you alone.
  mossback: { id: 'mossback', temperament: 'territorial', hp: 160, radius: 1.15, height: 1.7, mass: 9, walk: 1.5, run: 5, turn: 2.2,
    sightDay: 18, sightNight: 9, fov: 4.4, hear: 0.8, smell: 0, fireFear: 0, active: 'day', poise: 120, weak: 2.5, armor: 0.5, fleeAt: 0.3,
    attacks: [{ id: 'charge', min: 5, max: 26, windup: 1.15, active: 2.1, recover: 1.5, dmg: 30, knock: 9.5, speed: 13, reach: 26, cooldown: 1.2, open: 0 }] },
  // Lashbloom: a bud that is not a bud. It feels footsteps, whips a vine round your ankle and breathes spores.
  lashbloom: { id: 'lashbloom', temperament: 'ambush', hp: 40, radius: 0.5, height: 1.1, mass: 99, walk: 0, run: 0, turn: 0,
    sightDay: 0, sightNight: 0, fov: 0, hear: 1, smell: 0, fireFear: 0, active: 'both', poise: 999, weak: 2.2, armor: 0.2, fleeAt: 0,
    attacks: [{ id: 'lash', min: 0, max: 3.3, windup: 0.6, active: 0.2, recover: 1.9, dmg: 8, knock: 0, speed: 0, reach: 3.5, cooldown: 2.4, open: 1.9 }] },
  // A guardian: an old machine that was standing here before anything that lives here was born. Arena prototype.
  guardian: { id: 'guardian', temperament: 'machine', hp: 400, radius: 1.2, height: 3.2, mass: 30, walk: 2.2, run: 2.2, turn: 1.2,
    sightDay: 40, sightNight: 40, fov: 6.3, hear: 2, smell: 0, fireFear: 0, active: 'both', poise: 100, weak: 2.5, armor: 0.12, fleeAt: 0, boss: true,
    phases: [{ at: 0.5, speed: 1.3, telegraph: 0.8, id: 'overclock' }],
    attacks: [
      { id: 'stomp', min: 0, max: 5.5, windup: 1.0, active: 0.5, recover: 1.2, dmg: 18, knock: 7, speed: 0, reach: 6.5, cooldown: 4, open: 0 },
      { id: 'beam', min: 4, max: 24, windup: 1.25, active: 0.5, recover: 2.1, dmg: 24, knock: 4, speed: 0, reach: 24, cooldown: 3, open: 2.1 },
    ] },
  // Nibbet: a small grazer with ears like leaves. It is food, and it knows it.
  nibbet: { id: 'nibbet', temperament: 'prey', hp: 12, radius: 0.3, height: 0.45, mass: 0.4, walk: 1.2, run: 8.2, turn: 10,
    sightDay: 20, sightNight: 10, fov: 4.6, hear: 1.6, smell: 9, fireFear: 6, active: 'day', poise: 6, weak: 1, armor: 1, fleeAt: 0, attacks: [] },
};

/** A creature in a fight. Plain data: the picture reads it, the tests compare it. */
export interface Enemy {
  id: number; kind: SpeciesId; def: SpeciesDef;
  x: number; y: number; z: number; yaw: number; vx: number; vz: number;
  hp: number; maxHp: number;
  state: EnemyState; stateT: number;
  /** 0 calm, 1 it knows where you are. */
  alert: number; aware: boolean;
  /** Where it last sensed its target, and where it lives. */
  lkx: number; lkz: number; homeX: number; homeZ: number;
  pack: number;
  poise: number;
  atk: AttackDef | null; atkDx: number; atkDz: number; atkHit: boolean; atkGone: number;
  cd: number;
  /** Seconds the weak point is open, held in a snare, switched off by a shock. */
  weakT: number; heldT: number; stunT: number;
  provoked: number; warned: number;
  /** Angle on the circle it stalks on, and which way round. */
  angle: number; side: number;
  phase: number;
  /** What it is after: the player (-1), the companion (-2), or a scent id. */
  target: number;
  carrying: boolean;
  dead: boolean; deadT: number; gone: boolean;
  /** Routed for good: it leaves and does not come back. */
  routed: boolean;
  courage: number;
  noiseSeen: number;
  shock: number; shockT: number;
  escapes: number;
  /** A sleeper that an encounter keeps asleep until something wakes it. */
  sleeper: boolean;
  wander: number; wx: number; wz: number;
  /** Seconds since it last sensed its target. */
  lostT: number;
  /** Line of sight to the player, looked up a few times a second. */
  losAt: number; losOk: boolean;
  /** A practice target: it stands there and takes it. */
  inert: boolean;
  speed: number;
}
