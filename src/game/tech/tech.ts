import type { SaveData } from '../../core/save';
import { TECH, TECH_BY_ID, TechNode } from './data';

export type TechState = 'done' | 'open' | 'locked' | 'planned';

export const isDiscovered = (s: SaveData, id: string) => (s.discoveries ?? []).includes(id);
export const prereqsMet = (s: SaveData, n: TechNode) => n.requires.every((r) => isDiscovered(s, r));

/** Planned entries stay locked no matter what the save says. */
export function techState(s: SaveData, n: TechNode): TechState {
  if (n.status === 'planned') return 'planned';
  if (isDiscovered(s, n.id)) return 'done';
  return prereqsMet(s, n) ? 'open' : 'locked';
}

/** Returns true the first time. */
export function recordDiscovery(s: SaveData, id: string): boolean {
  const n = TECH_BY_ID[id];
  if (!n || n.status !== 'playable' || isDiscovered(s, id)) return false;
  (s.discoveries ??= []).push(id);
  return true;
}

export const playableCount = () => TECH.filter((n) => n.status === 'playable').length;
