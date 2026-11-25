import sealedText from './episode2.sealed?raw';
import { unseal } from './sealed';
import { COMMENTS, DECISIONS } from './registry';
import type { Comment, Decision } from './types';

/**
 * Episode Two's choice data (its decisions and what MegaZroN reads back) is sealed, like Episode One's: the plain
 * master copy is private. It is read once at start-up and joined to the registry; `ep2Ready` resolves when it is in.
 */
let loaded = false;
export const ep2Ready: Promise<void> = unseal<{ decisions: Decision[]; comments: Comment[] }>(sealedText).then((d) => {
  for (const x of d.decisions) DECISIONS[x.id] = x;
  for (const c of d.comments) COMMENTS.push(c);
  loaded = true;
}).catch((e) => { console.warn('episode two data did not load', e); });
export const ep2Loaded = () => loaded;
