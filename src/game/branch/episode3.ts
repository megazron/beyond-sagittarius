import sealedText from './episode3.sealed?raw';
import { unseal } from './sealed';
import { COMMENTS, DECISIONS, LINE_RULES } from './registry';
import { addStrings, type Lang } from '../../i18n';
import type { Comment, Cond, Decision, Effect, LineChoice } from './types';

/** One beat of a sealed outcome's scene: a line, a named shot and a named action, for `sec` seconds. */
export interface OutcomeBeat { key?: string; who?: string; shot?: string; act?: string; card?: string; sec: number }
/** What a moment comes to, when its condition holds: kept in the sealed data with its lines, so it is not plain text. */
export interface Outcome {
  id: string;
  /** The decision or moment it follows. */
  at: string;
  if: Cond;
  /** Lines that warn of it beforehand, when `warn.if` holds: one early in the moment, one before the panel. */
  warn?: { if: Cond; first?: string; panel?: string };
  effects: Effect[];
  beats: OutcomeBeat[];
  /** A quiet beat back home afterwards. */
  after?: OutcomeBeat[];
}

/**
 * Episode Three's choice data (its decisions, what MegaZroN reads back, and what some moments come to, with their own
 * lines) is sealed, like Episode One's: the plain master copy is private. It is read once at start-up and joined to the
 * registry; `ep3Ready` resolves when it is in.
 */
export const OUTCOMES: Record<string, Outcome> = {};
let loaded = false;
interface Sealed { decisions: Decision[]; comments: Comment[]; outcomes?: Outcome[]; lines?: Record<string, LineChoice>; strings?: Partial<Record<Lang, Record<string, string>>> }
export const ep3Ready: Promise<void> = unseal<Sealed>(sealedText).then((d) => {
  for (const x of d.decisions) DECISIONS[x.id] = x;
  for (const c of d.comments) COMMENTS.push(c);
  for (const o of d.outcomes ?? []) OUTCOMES[o.at] = o;
  for (const k in d.lines ?? {}) LINE_RULES[k] = { ...LINE_RULES[k], ...d.lines![k] };
  if (d.strings) addStrings(d.strings);
  loaded = true;
}).catch((e) => { console.warn('episode three data did not load', e); });
export const ep3Loaded = () => loaded;
