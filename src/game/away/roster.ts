/**
 * Where the six ended up. Edit this table to change the story's map: location, the lineage trait that keeps
 * them alive, when they unlock, and their own tasks. Text lives in i18n under the keys built here.
 */
import type { CrewId } from '../../characters/looks';

export interface RosterEntry {
  id: CrewId;
  /** The stage they play on; undefined means the green world. */
  location?: 'ring' | 'scree' | 'wreck' | 'moon' | 'clouds';
  /** First level they can be played. */
  unlock: number;
  lineage: string;
}

export const ROSTER: RosterEntry[] = [
  { id: 'scientist', unlock: 1, lineage: 'ulari' },
  { id: 'explorer', location: 'ring', unlock: 9, lineage: 'tarnkin' },
  { id: 'builder', location: 'scree', unlock: 14, lineage: 'ortek' },
  { id: 'medic', location: 'wreck', unlock: 19, lineage: 'vael' },
  { id: 'strong', location: 'moon', unlock: 22, lineage: 'korrath' },
  { id: 'social', location: 'clouds', unlock: 40, lineage: 'sirelle' },
];
