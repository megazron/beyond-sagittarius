import type { Cond, Ending } from './types';
import { SPOKE_PLAINLY } from './chapter1';

const EVERYONE: Cond = { all: [{ alive: 'explorer' }, { alive: 'strong' }, { alive: 'medic' }, { alive: 'builder' }, { alive: 'social' }] };
/** Skyvra believed you about the course change, or trusts you enough to let it go. */
const BELIEVED: Cond = { any: [SPOKE_PLAINLY, { trust: 'explorer', gte: 2 }] };
/** Someone will vouch for you: a friend healed well, a stranger you fed, a rescue in time. */
const VOUCHED: Cond = { any: [{ passed: 'c1.splint' }, { did: 'c1.pello.share' }, { did: 'c1.rescue.early' }] };

/**
 * How the story closes at Level 99. The player's last choice sets end.stay or
 * end.home; what they did before decides who is with them. First match wins.
 * The conditions are live and read the Chapter One record; the endings
 * themselves are not written until Level 99 exists.
 */
export const ENDINGS: Ending[] = [
  { id: 'stay.together', title: 'br.end.stay.together', desc: 'br.end.d.stay.together', status: 'planned', if: { all: [{ flag: 'end.stay' }, EVERYONE, BELIEVED, VOUCHED] } },
  { id: 'stay.alone', title: 'br.end.stay.alone', desc: 'br.end.d.stay.alone', status: 'planned', if: { flag: 'end.stay' } },
  { id: 'home.everyone', title: 'br.end.home.everyone', desc: 'br.end.d.home.everyone', status: 'planned', if: { all: [{ flag: 'end.home' }, EVERYONE, BELIEVED, { not: { flag: 'c1.tovikShort' } }] } },
  { id: 'home.without', title: 'br.end.home.without', desc: 'br.end.d.home.without', status: 'planned', if: { flag: 'end.home' } },
];
