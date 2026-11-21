// What the people of the crash learn to make, in the order people on Earth learned it. A weapon or a trap can be
// used only once its invention is known; the story decides when an invention is learned (it teaches it in the
// world) and writes it to the save as `flags['inv.<id>']` or the `inventions` list. The proving ground (a dev
// arena) ignores all of this.
//
// Order and methods, roughly as in the record: thrown stones and sticks; a sharp flake knocked off a core with a
// hammerstone (Oldowan, about 2.6 million years ago); clubs; wooden spears with the point hardened in the fire
// (Schoeningen, about 300 thousand years ago, and the Clacton point); stone points hafted on shafts with cordage and
// birch-bark tar or resin (from about 500 to 300 thousand years ago); the spear-thrower (late Upper Palaeolithic,
// about 20 thousand years ago or a little before); snares and pits for small game; the sling and the bow late in the
// Stone Age (the oldest bow finds are about 11 to 10 thousand years old; arrowheads are older, perhaps 64
// thousand). Metal, the crossbow and anything from the ship come ages later. Sources in MECHANICS_NOTES.md.
import type { WeaponId, TrapId } from './weapons.ts';

export interface Invention {
  /** The story's own name for it: write `flags['inv.<id>']` (or add it to `save.inventions`) once it is learned. */
  id: string;
  /** Its row in the story's invention tree (~/bs-story/INVENTION_TREE.md, Age 1 table), or null for the fight's own
   *  inventions the Scientist works out (stakes, a fire line, bait). */
  row: number | null;
  /** The tree's age: 1 is the Stone Age; 4 the Mechanical; 7 the Advanced Science. */
  age: number;
  /** Part of Episode One's fights (stones, club, fire, the fire-hardened spear, the Scientist's traps). */
  episodeOne: boolean;
  /** Raw materials, as inventory items. */
  materials: Record<string, number>;
  /** How it is made, in order: one line each (text keys cb.inv.<id>.<n>). */
  steps: number;
  /** Other inventions it needs first. */
  needs: string[];
  weapon?: WeaponId;
  traps?: TrapId[];
}

export const INVENTIONS: Invention[] = [
  { id: 'throwStone', row: null, age: 1, episodeOne: true, materials: { stone: 1 }, steps: 1, needs: [], weapon: 'rock' },
  { id: 'goodStone', row: 2, age: 1, episodeOne: true, materials: { stone: 2 }, steps: 2, needs: [] },
  { id: 'flake', row: 3, age: 1, episodeOne: true, materials: { stone: 2 }, steps: 3, needs: ['goodStone'], weapon: 'flake' },
  { id: 'woodBone', row: 4, age: 1, episodeOne: true, materials: { branch: 1 }, steps: 2, needs: [], weapon: 'club' },
  { id: 'fireDrill', row: 5, age: 1, episodeOne: true, materials: { tinder: 1, branch: 2 }, steps: 3, needs: [] },
  { id: 'torch', row: null, age: 1, episodeOne: true, materials: { branch: 1, tinder: 1 }, steps: 2, needs: ['fireDrill'], weapon: 'torch' },
  { id: 'fireSpear', row: 9, age: 1, episodeOne: true, materials: { branch: 1 }, steps: 4, needs: ['flake', 'fireDrill'], weapon: 'spear' },
  { id: 'stakes', row: null, age: 1, episodeOne: true, materials: { branch: 3 }, steps: 2, needs: ['fireSpear'], traps: ['stakes'] },
  { id: 'fireline', row: null, age: 1, episodeOne: true, materials: { tinder: 1, branch: 1 }, steps: 2, needs: ['fireDrill'], traps: ['fireline'] },
  { id: 'bait', row: null, age: 1, episodeOne: true, materials: { fruit: 1 }, steps: 1, needs: [], traps: ['bait'] },
  { id: 'cordage', row: 10, age: 1, episodeOne: false, materials: { fibre: 2 }, steps: 3, needs: [] },
  { id: 'hafting', row: 12, age: 1, episodeOne: false, materials: { branch: 1, stone: 1, fibre: 1, resin: 1 }, steps: 5, needs: ['flake', 'cordage', 'fireDrill'], weapon: 'hafted' },
  { id: 'atlatl', row: 13, age: 1, episodeOne: false, materials: { branch: 2, fibre: 1 }, steps: 4, needs: ['hafting'], weapon: 'atlatl' },
  { id: 'traps', row: 14, age: 1, episodeOne: false, materials: { fibre: 1, branch: 1 }, steps: 3, needs: ['cordage'], traps: ['snare', 'rattle'] },
  // not in the story's tree yet: a sling needs only cordage and a pouch, so it sits beside the traps (asked of the story)
  { id: 'sling', row: null, age: 1, episodeOne: false, materials: { fibre: 3, hide: 1 }, steps: 4, needs: ['cordage'], weapon: 'sling' },
  { id: 'bow', row: 19, age: 1, episodeOne: false, materials: { branch: 1, sinew: 2, fibre: 1 }, steps: 6, needs: ['cordage', 'hafting'], weapon: 'bow' },
  { id: 'crossbow', row: null, age: 3, episodeOne: false, materials: { branch: 3, bronze: 1, sinew: 2 }, steps: 6, needs: ['bow'], weapon: 'crossbow' },
  { id: 'coil', row: null, age: 7, episodeOne: false, materials: { scrap: 4, cell: 1 }, steps: 6, needs: [], weapon: 'coil' },
];
const BY_WEAPON = new Map<WeaponId, Invention>(INVENTIONS.filter((i) => i.weapon).map((i) => [i.weapon!, i]));
const BY_TRAP = new Map<TrapId, Invention>(INVENTIONS.flatMap((i) => (i.traps ?? []).map((t) => [t, i] as [TrapId, Invention])));

/** What the first hours know without being taught: a stone in the hand, a stick, food left out. */
export const KNOWN_AT_START = ['throwStone', 'woodBone', 'bait'];

/** Everything known, from a save: `flags['inv.<id>']`, the `inventions` list, and the story's older `spear`/`fire` flags. */
export function knownFrom(save: { flags?: Record<string, unknown>; inventions?: string[] }): Set<string> {
  const k = new Set<string>(KNOWN_AT_START);
  for (const [f, v] of Object.entries(save.flags ?? {})) if (v && f.startsWith('inv.')) k.add(f.slice(4));
  for (const i of save.inventions ?? []) k.add(i);
  if (save.flags?.spear) { k.add('fireSpear'); k.add('flake'); k.add('goodStone'); }
  if (save.flags?.fire || save.flags?.pitBuilt) { k.add('fireDrill'); k.add('torch'); k.add('fireline'); }
  return k;
}
export const weaponKnown = (w: WeaponId, known: Set<string>) => w === 'fists' || (BY_WEAPON.get(w) ? known.has(BY_WEAPON.get(w)!.id) : false);
export const trapKnown = (t: TrapId, known: Set<string>) => (BY_TRAP.get(t) ? known.has(BY_TRAP.get(t)!.id) : false);
/** Everything Episode One's fights may use. */
export const EPISODE_ONE = new Set(INVENTIONS.filter((i) => i.episodeOne).map((i) => i.id));
