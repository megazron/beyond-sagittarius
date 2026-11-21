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
  id: string;
  /** 1: the first days (Episode One); 2: the rest of the Stone Age; 3 and on: later ages. */
  era: number;
  /** Raw materials, as inventory items. */
  materials: Record<string, number>;
  /** How it is made, in order: what the game teaches, one line each (text keys cb.inv.<id>.<n>). */
  steps: number;
  /** Other inventions it needs first. */
  needs: string[];
  weapon?: WeaponId;
  trap?: TrapId;
}

export const INVENTIONS: Invention[] = [
  { id: 'throwStone', era: 1, materials: { stone: 1 }, steps: 1, needs: [], weapon: 'rock' },
  { id: 'fire', era: 1, materials: { tinder: 1, branch: 2 }, steps: 3, needs: [] },
  { id: 'club', era: 1, materials: { branch: 1 }, steps: 2, needs: [], weapon: 'club' },
  { id: 'torch', era: 1, materials: { branch: 1, tinder: 1 }, steps: 2, needs: ['fire'], weapon: 'torch' },
  { id: 'flake', era: 1, materials: { stone: 2 }, steps: 3, needs: [], weapon: 'flake' },
  { id: 'fireSpear', era: 1, materials: { branch: 1 }, steps: 4, needs: ['flake', 'fire'], weapon: 'spear' },
  { id: 'stakes', era: 1, materials: { branch: 3 }, steps: 2, needs: ['flake', 'fire'], trap: 'stakes' },
  { id: 'cordage', era: 1, materials: { fibre: 2 }, steps: 3, needs: [] },
  { id: 'snare', era: 1, materials: { vine: 1, branch: 1 }, steps: 3, needs: ['cordage'], trap: 'snare' },
  { id: 'rattle', era: 1, materials: { vine: 1, stone: 2 }, steps: 2, needs: ['cordage'], trap: 'rattle' },
  { id: 'bait', era: 1, materials: { fruit: 1 }, steps: 1, needs: [], trap: 'bait' },
  { id: 'fireline', era: 1, materials: { tinder: 1, branch: 1 }, steps: 2, needs: ['fire'], trap: 'fireline' },
  { id: 'hafting', era: 2, materials: { branch: 1, stone: 1, fibre: 1, resin: 1 }, steps: 5, needs: ['flake', 'cordage', 'fire'], weapon: 'hafted' },
  { id: 'atlatl', era: 2, materials: { branch: 2, fibre: 1 }, steps: 4, needs: ['hafting'] },
  { id: 'sling', era: 2, materials: { fibre: 3, hide: 1 }, steps: 4, needs: ['cordage'], weapon: 'sling' },
  { id: 'bow', era: 2, materials: { branch: 1, sinew: 2, fibre: 1 }, steps: 6, needs: ['cordage', 'hafting'], weapon: 'bow' },
  { id: 'crossbow', era: 4, materials: { branch: 3, bronze: 1, sinew: 2 }, steps: 6, needs: ['bow'], weapon: 'crossbow' },
  { id: 'coil', era: 8, materials: { scrap: 4, cell: 1 }, steps: 6, needs: [], weapon: 'coil' },
];
const BY_WEAPON = new Map<WeaponId, Invention>(INVENTIONS.filter((i) => i.weapon).map((i) => [i.weapon!, i]));
const BY_TRAP = new Map<TrapId, Invention>(INVENTIONS.filter((i) => i.trap).map((i) => [i.trap!, i]));

/** What the first days know without being taught: a stone in the hand, a stick, food left out. */
export const KNOWN_AT_START = ['throwStone', 'club', 'bait'];

/** Everything known, from a save: `flags['inv.<id>']`, the `inventions` list, and the story's older `spear`/`fire` flags. */
export function knownFrom(save: { flags?: Record<string, unknown>; inventions?: string[] }): Set<string> {
  const k = new Set<string>(KNOWN_AT_START);
  for (const [f, v] of Object.entries(save.flags ?? {})) if (v && f.startsWith('inv.')) k.add(f.slice(4));
  for (const i of save.inventions ?? []) k.add(i);
  if (save.flags?.spear) { k.add('fireSpear'); k.add('flake'); }
  if (save.flags?.fire || save.flags?.pitBuilt) { k.add('fire'); k.add('torch'); k.add('fireline'); }
  return k;
}
export const weaponKnown = (w: WeaponId, known: Set<string>) => w === 'fists' || (BY_WEAPON.get(w) ? known.has(BY_WEAPON.get(w)!.id) : false);
export const trapKnown = (t: TrapId, known: Set<string>) => (BY_TRAP.get(t) ? known.has(BY_TRAP.get(t)!.id) : false);
/** Everything Episode One's fights may use (the set pieces' own kits stay inside it). */
export const EPISODE_ONE = new Set(INVENTIONS.filter((i) => i.era === 1).map((i) => i.id));
