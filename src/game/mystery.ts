import type { SaveData } from '../core/save';
import { test, type StoryState } from './branch/engine';
import { MYSTERY, type From, type MyBeat, type MyClue, type MyHook } from './branch/mysterydata';

/**
 * The Ledger's questions, worked out from the save (no state of their own beyond save.flags, so a save carries them):
 *   flags['hook-N']     the beat at the end of level N has played (or was skipped): it never plays twice
 *   flags['find-Fn']    a small thing off the path was picked up
 *   flags['my.seen.ID'] the board has shown that entry (the soft dot goes)
 * A level's own entry counts as found once the level is complete, whether or not its beat was seen (a quit in between
 * must not cost the player the entry).
 */

const done = (s: SaveData, n: number) => s.completed.includes(n);
export function reached(s: SaveData, f: From): boolean {
  if ('hook' in f) return f.hook === 0 ? !s.flags.openingLive : done(s, f.hook);
  if ('find' in f) return !!s.flags[`find-${f.find}`];
  return done(s, f.level);
}

export interface BoardClue { c: MyClue; found: boolean; paid: boolean; fresh: boolean }
export interface BoardQuestion { id: string; key: string; history: { key: string; answer?: string }[]; found: number; total: number; fresh: boolean; order: number }
export interface Board { questions: BoardQuestion[]; clues: BoardClue[]; past: number[]; fresh: number }

/** Where a stage came in, for ordering (a level number; a find counts at its level). */
function when(f: From): number {
  if ('hook' in f) return f.hook;
  if ('level' in f) return f.level;
  return MYSTERY?.finds.find((x) => x.id === f.find)?.level ?? 99;
}

export function board(s: SaveData): Board {
  const d = MYSTERY;
  if (!d) return { questions: [], clues: [], past: [], fresh: 0 };
  const clues: BoardClue[] = d.clues.map((c) => {
    const found = reached(s, c.from);
    return { c, found, paid: found && !!c.pay && done(s, c.pay.level), fresh: found && !s.flags[`my.seen.${c.id}`] };
  });
  const questions: BoardQuestion[] = [];
  for (const q of d.questions) {
    const on = q.stages.filter((st) => reached(s, st.from));
    if (!on.length) continue;
    const cur = on[on.length - 1];
    const history = on.slice(0, -1).map((st, i) => ({ key: st.key, answer: on[i + 1].answers }));
    const mine = clues.filter((x) => x.c.q.includes(q.id));
    const seenKey = `my.seen.q.${q.id}.${on.length}`;
    questions.push({ id: q.id, key: cur.key, history, found: mine.filter((x) => x.found).length, total: mine.length, fresh: !s.flags[seenKey], order: when(cur.from) });
  }
  // the small things off the path in levels already played and not picked up: the level is named, never the place
  const past = d.finds.filter((f) => done(s, f.level) && !s.flags[`find-${f.id}`]).map((f) => f.level);
  const fresh = clues.filter((x) => x.fresh).length + questions.filter((q) => q.fresh).length;
  return { questions, clues, past, fresh };
}

/** The board has been looked at: every entry on it now is not new. */
export function markSeen(s: SaveData) {
  const b = board(s);
  for (const c of b.clues) if (c.found) s.flags[`my.seen.${c.c.id}`] = true;
  for (const q of b.questions) s.flags[`my.seen.q.${q.id}.${q.history.length + 1}`] = true;
}

/** The question asked most recently (the sharpest open one). */
export function newestQuestion(s: SaveData): string | null {
  const q = board(s).questions.slice().sort((a, b) => b.order - a.order)[0];
  return q?.key ?? null;
}

/** "Previously": what just happened, one thing the player did, the newest open question. */
export function recapLines(s: SaveData): { lines: string[]; days: number } | null {
  const d = MYSTERY;
  if (!d) return null;
  const last = s.completed.length ? Math.max(...s.completed) : 0;
  const one = d.recaps.levels[String(last)];
  const st = s as unknown as StoryState;
  const two = d.recaps.flags.find((x) => { try { return test(st, x.if); } catch { return false; } })?.key ?? d.recaps.fallback;
  const three = newestQuestion(s);
  const lines = [one, two, three].filter((k): k is string => !!k);
  return lines.length ? { lines, days: s.day } : null;
}

/** When the recap shows on Continue: always, never, or after 20 minutes away (the default). */
export function recapDue(s: SaveData, mode: 'always' | 'break' | 'never' = 'break', now = Date.now()): boolean {
  if (mode === 'never' || s.replay || s.flags.openingLive || !MYSTERY) return false;
  if (mode === 'always') return true;
  // a save without a real time stamp (written by hand, tests) has no break to recap
  return s.savedAt > 1.6e12 && now - s.savedAt > 20 * 60 * 1000;
}

/** The beat for the end of level n, if it has not played on this save (never on a replay). */
export function hookFor(n: number, s: SaveData): MyHook | null {
  if (s.replay || s.flags[`hook-${n}`]) return null;
  return MYSTERY?.hooks.find((h) => h.level === n) ?? null;
}

/** The beats that play for this save: the first variant whose condition holds, else the hook's own; per-beat `if`. */
export function hookBeats(h: MyHook, s: SaveData): MyBeat[] {
  const st = s as unknown as StoryState;
  const v = h.variants?.find((x) => test(st, x.if));
  return (v ? v.beats : h.beats).filter((b) => !b.if || test(st, b.if));
}

/** Mark a hook as played (once only: the flag is in the save). */
export function hookPlayed(n: number, s: SaveData) { s.flags[`hook-${n}`] = true; }

/** The small things off the path that can be picked up now (the level is under way or done, not yet found). */
export function findsOpen(s: SaveData) {
  return (MYSTERY?.finds ?? []).filter((f) => s.level >= f.level && !s.flags[`find-${f.id}`] && !s.replay);
}
export function pickFind(id: string, s: SaveData) { s.flags[`find-${id}`] = true; }
