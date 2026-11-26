import sealedText from './moments.sealed?raw';
import { unseal } from './sealed';
import { DECISIONS, LINE_RULES, QTES } from './registry';
import { addStrings, type Lang } from '../../i18n';
import type { Decision, LineChoice, Qte } from './types';

/**
 * The moments added to Episodes One to Three's scenes (2026-11-26: a decision or a reflex where the player only
 * watched): their decisions and reflexes (asked on the choice layer), the lines their answers change, and the new
 * lines' text. Sealed like the episodes' data; the plain master copy is private. `momentsReady` resolves when it is in.
 */
interface Sealed { decisions: Decision[]; qtes: Qte[]; lines?: Record<string, LineChoice>; strings?: Partial<Record<Lang, Record<string, string>>> }
let loaded = false;
export const momentsReady: Promise<void> = unseal<Sealed>(sealedText).then((d) => {
  for (const x of d.decisions) DECISIONS[x.id] = { ...x, layer: 'moment' };
  for (const q of d.qtes) QTES[q.id] = { ...q, layer: 'moment' };
  for (const k in d.lines ?? {}) LINE_RULES[k] = { ...LINE_RULES[k], ...d.lines![k], swap: [...(d.lines![k].swap ?? []), ...(LINE_RULES[k]?.swap ?? [])] };
  if (d.strings) addStrings(d.strings);
  loaded = true;
}).catch((e) => { console.warn('episode moments did not load', e); });
export const momentsLoaded = () => loaded;
