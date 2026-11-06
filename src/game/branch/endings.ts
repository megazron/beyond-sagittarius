import type { Ending } from './types';

/**
 * How the story can close at Level 99. Stubs: the conditions are drafts and
 * nothing plays yet. The two families are the owner's stay-or-go-home choice.
 */
export const ENDINGS: Ending[] = [
  { id: 'stay.together', title: 'br.end.stay.together', desc: 'br.end.planned', status: 'planned', if: { all: [{ flag: 'end.stay' }, { alive: 'explorer' }, { alive: 'strong' }, { alive: 'medic' }, { alive: 'builder' }, { alive: 'social' }] } },
  { id: 'stay.alone', title: 'br.end.stay.alone', desc: 'br.end.planned', status: 'planned', if: { flag: 'end.stay' } },
  { id: 'home.everyone', title: 'br.end.home.everyone', desc: 'br.end.planned', status: 'planned', if: { all: [{ flag: 'end.home' }, { alive: 'explorer' }, { alive: 'strong' }, { alive: 'medic' }, { alive: 'builder' }, { alive: 'social' }] } },
  { id: 'home.without', title: 'br.end.home.without', desc: 'br.end.planned', status: 'planned', if: { flag: 'end.home' } },
];
