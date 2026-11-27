import sealedText from './opening.sealed?raw';
import { unseal } from './sealed';
import { DECISIONS, LINE_RULES, QTES } from './registry';
import { addStrings, type Lang } from '../../i18n';
import type { Decision, LineChoice, Qte } from './types';

/**
 * The opening's choice data (the city, the lounge, the pull and the pods: what each answer sets, the Ledger's lines, the
 * lines it changes later) is sealed like the episodes': the plain master copy is private. Read once at start-up and
 * joined to the registry; `openingReady` resolves when it is in.
 */
interface Sealed { decisions: Decision[]; qtes: Qte[]; lines?: Record<string, LineChoice>; strings?: Partial<Record<Lang, Record<string, string>>> }
let loaded = false;
/** The opening's decisions and reflexes in the order the sealed data has them (the cheat menu's presets). */
export const openingIds: string[] = [];
export const openingReady: Promise<void> = unseal<Sealed>(sealedText).then((d) => {
  for (const x of d.decisions) DECISIONS[x.id] = x;
  for (const q of d.qtes) QTES[q.id] = q;
  openingIds.push(...d.decisions.map((x) => x.id), ...d.qtes.map((x) => x.id));
  for (const k in d.lines ?? {}) LINE_RULES[k] = { ...LINE_RULES[k], ...d.lines![k], swap: [...(d.lines![k].swap ?? []), ...(LINE_RULES[k]?.swap ?? [])] };
  if (d.strings) addStrings(d.strings);
  loaded = true;
}).catch((e) => { console.warn('opening data did not load', e); });
export const openingLoaded = () => loaded;
