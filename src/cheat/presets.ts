import type { BranchState, Decision, Effect, Qte } from '../game/branch/types';
import { apply, record, trustBand, trustOf, type StoryState } from '../game/branch/engine';

/**
 * Story choice presets for the cheat menu's jumps (src/cheat/cheat.ts). A checkpoint's save was written by an automated
 * playthrough that answered every choice one way; a preset answers them again another way on a copy of that save:
 * the old answer's effects are taken back (trust, the record, flags, who it cost), the new answer's are put on, and the
 * log line is rewritten. Moments the playthrough never met (the opening's, which it plays as one film) are written in
 * as if answered at their place. What a scene did by its own code because of an answer (not through an effect) is not
 * redone: the survivors, bonds, record and flags are the answers' own.
 *
 * 'a' is the first option shown and a reflex passed; 'b' the second option and a reflex failed; 'ask' leaves the save
 * as it was recorded and asks what has not been answered yet.
 */
export type Preset = 'a' | 'b' | 'ask';
export type Picks = Record<string, string>;

const shownOptions = (d: Decision) => d.options.filter((o) => o.tone !== 'silent');

/** The option or result a preset takes for a decision or reflex. */
export function presetPick(preset: Preset, d: Decision | undefined, q: Qte | undefined, picks: Picks, id: string): string | null {
  if (picks[id]) return picks[id];
  if (preset === 'ask') return null;
  if (q) return preset === 'a' ? 'pass' : 'fail';
  if (!d) return null;
  const o = shownOptions(d);
  return (preset === 'a' ? o[0] : o[1] ?? o[0])?.id ?? d.options[0]?.id ?? null;
}

function effectsOf(d: Decision | undefined, q: Qte | undefined, pick: string): Effect[] {
  if (q) return pick === 'pass' ? q.pass : q.fail;
  return d?.options.find((o) => o.id === pick)?.effects ?? [];
}

/** Takes an answer's effects back (inventory and stats are left as recorded). */
function undo(s: StoryState, effects: Effect[], keepFlags: Set<string>) {
  const b = s.branch;
  for (const e of effects) {
    if ('flag' in e) { if (!keepFlags.has(e.flag)) delete s.flags[e.flag]; }
    else if ('trust' in e) { const k = `${e.trust}>${e.to ?? 'scientist'}`; b.trust[k] = (b.trust[k] ?? 0) - e.by; }
    else if ('trait' in e) b.record[e.trait] -= e.by;
    else if ('kill' in e) { if (b.dead[e.kill]?.cause === e.cause) delete b.dead[e.kill]; }
  }
}

/**
 * Re-answers `ids` (in order) on `s` with the preset. `known` is the moments to write in when the log has no line for
 * them (the opening's): they are answered as if met. Returns what changed, for the menu.
 */
export function applyPreset(s: StoryState, preset: Preset, picks: Picks, decisions: Record<string, Decision>, qtes: Record<string, Qte>, known: string[] = []): string[] {
  const changed: string[] = [];
  const b = s.branch;
  // effects that stay: flags set by an answer the preset keeps are not taken away by another's undo
  for (const id of known) {
    if (b.log.some((x) => x.id === id)) continue;
    const d = decisions[id], q = qtes[id];
    const pick = presetPick(preset, d, q, picks, id);
    if (!pick) continue;
    record(s, id, q ? 'qte' : 'decision', pick);
    apply(s, effectsOf(d, q, pick).filter((e) => !('give' in e) && !('stat' in e)));
    changed.push(`${id}=${pick}`);
  }
  for (const line of b.log) {
    if (line.kind === 'hidden') continue;
    const d = decisions[line.id], q = qtes[line.id];
    if (!d && !q) continue;
    const pick = presetPick(preset, d, q, picks, line.id);
    if (!pick || pick === line.pick) continue;
    const keep = new Set<string>();
    for (const e of effectsOf(d, q, pick)) if ('flag' in e) keep.add(e.flag);
    undo(s, effectsOf(d, q, line.pick), keep);
    apply(s, effectsOf(d, q, pick).filter((e) => !('give' in e) && !('stat' in e)));
    line.pick = pick;
    delete line.timedOut;
    changed.push(`${line.id}=${pick}`);
  }
  for (const k in b.trust) b.trust[k] = Math.max(-10, Math.min(10, b.trust[k]));
  b.open = null;
  return changed;
}

/** Who is alive and how each bond stands, as the menu shows it after a preset. */
export function summary(b: BranchState, crew: readonly string[]) {
  return crew.filter((c) => c !== 'scientist').map((c) => ({ id: c, alive: !b.dead[c], trust: trustOf(b, c), band: trustBand(trustOf(b, c)) }));
}
