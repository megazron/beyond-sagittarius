/**
 * Where the six ended up. Edit this table to change the story's map: location, the lineage trait that keeps
 * them alive, when they unlock, and their own tasks. Text lives in i18n under the keys built here.
 */
import type { CrewId } from '../../characters/looks';

export interface RosterEntry {
  id: CrewId;
  /** The stage they play on; undefined means Verdaxis. */
  location?: 'ring' | 'scree' | 'wreck' | 'moon' | 'clouds';
  /** First level they can be played. */
  unlock: number;
  lineage: string;
}

export const ROSTER: RosterEntry[] = [
  { id: 'scientist', unlock: 1, lineage: 'ulari' },
  { id: 'explorer', location: 'ring', unlock: 9, lineage: 'tarnkin' },
  { id: 'builder', location: 'scree', unlock: 16, lineage: 'ortek' }, // after Episode Three's first level: at 15 it cut into the flood scene (GPU take ep3A)
  { id: 'medic', location: 'wreck', unlock: 21, lineage: 'vael' }, // between levels 20 and 21 (19 is Draxum's wall, Episode Three's interlude on his own stage; two away stories in a row read as one)
  { id: 'strong', location: 'moon', unlock: 22, lineage: 'korrath' },
  { id: 'social', location: 'clouds', unlock: 40, lineage: 'sirelle' },
];
