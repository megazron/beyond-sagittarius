import { AXES, Axis, BranchState, Chapter, Comment, Cond, Effect, Ending, Hidden, LineChoice, Payoff, Person } from './types';
import { HIDDEN } from './registry';

/** The part of the save the system reads and writes. */
export interface StoryState {
  branch: BranchState;
  flags: Record<string, boolean>;
  level: number;
  day: number;
  timeOfDay: number;
  inventory: Record<string, number>;
  stats: { health: number; thirst: number; hunger: number; stamina: number };
}

const PLAYER = 'scientist';
const TRUST_MAX = 10;

export function emptyBranch(): BranchState {
  return { trust: {}, record: { honesty: 0, mercy: 0, nerve: 0, humour: 0 }, log: [], dead: {}, pending: [], open: null, marks: {} };
}

/** Saves from before this system, or missing newer fields. */
export function normaliseBranch(b: Partial<BranchState> | undefined): BranchState {
  const e = emptyBranch();
  return { ...e, ...(b ?? {}), record: { ...e.record, ...(b?.record ?? {}) } };
}

export const trustOf = (b: BranchState, from: Person, to: Person = PLAYER) => b.trust[`${from}>${to}`] ?? 0;
/** Trust as a word, for the crew panel and the path tree. */
export const trustBand = (v: number) => (v >= 3 ? 'firm' : v >= 1 ? 'warm' : v <= -3 ? 'broken' : v <= -1 ? 'shaken' : 'even');
export const isAlive = (b: BranchState, id: Person) => !b.dead[id];
const entry = (b: BranchState, id: string) => b.log.find((e) => e.id === id);
const within = (v: number, c: { gte?: number; lte?: number }) => (c.gte === undefined || v >= c.gte) && (c.lte === undefined || v <= c.lte);

/** Evaluates a condition; no condition always holds. */
export function test(s: StoryState, c?: Cond): boolean {
  if (!c) return true;
  const b = s.branch;
  if ('all' in c) return c.all.every((x) => test(s, x));
  if ('any' in c) return c.any.some((x) => test(s, x));
  if ('not' in c) return !test(s, c.not);
  if ('flag' in c) return !!s.flags[c.flag];
  if ('chose' in c) return entry(b, c.chose[0])?.pick === c.chose[1];
  if ('decided' in c) return !!entry(b, c.decided);
  if ('timedOut' in c) return !!entry(b, c.timedOut)?.timedOut;
  if ('passed' in c) return entry(b, c.passed)?.pick === 'pass';
  if ('did' in c) return !!entry(b, c.did);
  if ('alive' in c) return isAlive(b, c.alive);
  if ('dead' in c) return !isAlive(b, c.dead);
  if ('trust' in c) return within(trustOf(b, c.trust, c.to), c);
  if ('trait' in c) return within(b.record[c.trait], c);
  if ('top' in c) return AXES.every((a) => a === c.top ? b.record[a] > 0 : b.record[a] < b.record[c.top]);
  return s.level >= c.level;
}

export function apply(s: StoryState, effects: Effect[]) {
  const b = s.branch;
  for (const e of effects) {
    if ('flag' in e) s.flags[e.flag] = e.value ?? true;
    else if ('trust' in e) {
      const k = `${e.trust}>${e.to ?? PLAYER}`;
      b.trust[k] = Math.max(-TRUST_MAX, Math.min(TRUST_MAX, (b.trust[k] ?? 0) + e.by));
    } else if ('trait' in e) b.record[e.trait] += e.by;
    else if ('kill' in e) { if (e.kill !== PLAYER && !b.dead[e.kill]) b.dead[e.kill] = { cause: e.cause, level: s.level }; }
    else if ('give' in e) for (const k in e.give) s.inventory[k] = Math.max(0, (s.inventory[k] ?? 0) + e.give[k]);
    else s.stats[e.stat] = Math.max(0, Math.min(100, s.stats[e.stat] + e.by));
  }
}

/** Writes one line in the log. A decision, once written, is never asked again. */
export function record(s: StoryState, id: string, kind: 'decision' | 'qte' | 'hidden', pick: string, timedOut = false) {
  s.branch.log.push({ id, kind, pick, ...(timedOut ? { timedOut } : {}), level: s.level, day: s.day, at: Date.now() });
}

/** Does a hidden action and queues its payoffs. Returns false if already done. */
export function doHidden(s: StoryState, id: string): boolean {
  const h: Hidden | undefined = HIDDEN[id];
  if (!h || entry(s.branch, id)) return false;
  record(s, id, 'hidden', 'done');
  apply(s, h.effects);
  h.payoffs?.forEach((_, i) => s.branch.pending.push({ id, i }));
  return true;
}

/**
 * Takes every payoff whose level has arrived, applies it and returns it so the
 * caller can show it. One whose condition fails is dropped: its moment passed.
 */
export function collectPayoffs(s: StoryState): Payoff[] {
  const out: Payoff[] = [];
  s.branch.pending = s.branch.pending.filter(({ id, i }) => {
    const p = HIDDEN[id]?.payoffs?.[i];
    if (!p) return false;
    if (s.level < p.level) return true;
    if (test(s, p.if)) { apply(s, p.effects); out.push(p); }
    return false;
  });
  return out;
}

/** Game hours since day 0. */
export const storyHours = (s: StoryState) => s.day * 24 + s.timeOfDay;

/** Decides what a line becomes: itself, a swap, a fallback, or null to skip it. */
export function resolveLine(s: StoryState, l: LineChoice): { key?: string; who?: string } | null {
  const needed = [...(l.requires ?? []), ...(l.who && l.who !== 'megazron' ? [l.who] : [])];
  if (needed.some((id) => !isAlive(s.branch, id))) return l.fallback ? { key: l.fallback, who: l.fallbackWho } : null;
  const sw = l.swap?.find((x) => test(s, x.if));
  return sw ? { key: sw.key, who: sw.who ?? l.who } : { key: l.key, who: l.who };
}

/** The Vault lines this save has earned, first match per group. */
/** The ending this record reaches if the last choice were made now. */
export function endingFor(s: StoryState, choice: 'stay' | 'home', list: Ending[]): Ending {
  const t: StoryState = { ...s, flags: { ...s.flags, [`end.${choice}`]: true } };
  return list.find((e) => test(t, e.if))!;
}

export function pickComments(s: StoryState, list: Comment[], scene: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const c of list) {
    if (c.scene !== scene || seen.has(c.group) || !test(s, c.if)) continue;
    seen.add(c.group);
    out.push(c.key);
  }
  return out;
}

export interface PathView {
  nodes: { id: string; title: string; level: number; branches: { id: string; label: string; state: 'taken' | 'locked' | 'secret'; hint?: string }[] }[];
  trust: { id: Person; value: number }[];
  record: { axis: Axis; value: number }[];
  dead: Person[];
}

/** What the path tree shows. `seen` holds branches taken in any run on this device. */
export function pathView(s: StoryState, ch: Chapter, seen: string[], crew: readonly string[]): PathView {
  return {
    nodes: ch.path.map((n) => ({
      id: n.id, title: n.title, level: n.level,
      branches: n.branches.map((p) => {
        const taken = test(s, p.when), known = seen.includes(`${n.id}:${p.id}`);
        return { id: p.id, label: p.label, hint: p.hint, state: taken ? 'taken' as const : p.secret && !known ? 'secret' as const : 'locked' as const };
      }),
    })),
    trust: crew.filter((id) => id !== PLAYER).map((id) => ({ id, value: trustOf(s.branch, id) })),
    record: AXES.map((axis) => ({ axis, value: s.branch.record[axis] })),
    dead: Object.keys(s.branch.dead),
  };
}

/** Path branches taken in this save, for the device-wide `seen` list. */
export function takenBranches(s: StoryState, ch: Chapter): string[] {
  return ch.path.flatMap((n) => n.branches.filter((p) => test(s, p.when)).map((p) => `${n.id}:${p.id}`));
}
