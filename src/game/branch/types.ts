/**
 * The story data format. Everything a level needs to branch is plain data
 * written against these types: no level should reach into the save by hand.
 *
 *   Decision  a choice panel: timed dialogue if `seconds` is set, else it waits
 *   Qte       a quick-time moment: one press inside a short window
 *   Hidden    a small action nobody announces; its payoffs land levels later
 *   Cond      a test on the save, usable on any beat, option, payoff or comment
 *   Effect    what a choice changes: flags, trust, the record, who lives
 *
 * Strings are i18n keys. Spoken keys also go in src/i18n/voice.json.
 */
export type Axis = 'honesty' | 'mercy' | 'nerve' | 'humour';
export const AXES: Axis[] = ['honesty', 'mercy', 'nerve', 'humour'];

/** A crew id or any other named person ('trader', 'trav'...). */
export type Person = string;

export type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }
  | { flag: string }
  /** An option taken in a decision. */
  | { chose: [decision: string, option: string] }
  /** The decision has been answered at all. */
  | { decided: string }
  /** The timer ran out and the default was taken. */
  | { timedOut: string }
  /** A quick-time moment, passed. Use `not` plus `decided` for failed. */
  | { passed: string }
  /** A hidden action happened. */
  | { did: string }
  | { alive: Person }
  | { dead: Person }
  /** How far `from` trusts `to` (default: the player). */
  | { trust: Person; to?: Person; gte?: number; lte?: number }
  | { trait: Axis; gte?: number; lte?: number }
  /** This axis leads the record outright. */
  | { top: Axis }
  | { level: number };

export type Effect =
  | { flag: string; value?: boolean }
  /** `from` changes how far they trust `to` (default: the player). */
  | { trust: Person; to?: Person; by: number }
  | { trait: Axis; by: number }
  /** Permanent. Nothing brings a crewmate back. */
  | { kill: Person; cause: string }
  | { give: Record<string, number> }
  | { stat: 'health' | 'thirst' | 'hunger' | 'stamina'; by: number };

export interface Option {
  id: string;
  /** Button text. */
  label: string;
  /** Not offered unless this holds; shows as locked on the path tree. */
  requires?: Cond;
  /** Path tree text while `requires` was never met. */
  lockedHint?: string;
  effects: Effect[];
}

export interface Decision {
  id: string;
  /** Path tree title. */
  title: string;
  /** Line shown above the options. */
  prompt?: string;
  who?: string;
  /** Countdown in seconds; unset means it waits for the player. */
  seconds?: number;
  /** Option taken when the timer ends. Silence is usually the honest default. */
  fallback: string;
  options: Option[];
}

export interface Qte {
  id: string;
  title: string;
  /** Button text. */
  label: string;
  /** Length of the window. With timers off the prompt waits instead. */
  seconds: number;
  pass: Effect[];
  fail: Effect[];
}

/** A consequence that arrives later, once the level is reached. */
export interface Payoff {
  level: number;
  if?: Cond;
  effects: Effect[];
  /** Spoken in the world `delay` seconds later, as `who` (an i18n name key). */
  say?: { key: string; who: string };
  toast?: string;
  delay?: number;
}

export interface Hidden {
  id: string;
  effects: Effect[];
  payoffs?: Payoff[];
}

/** One row of the path tree. */
export interface PathBranch {
  id: string;
  label: string;
  when: Cond;
  /** Stay masked as "something you never noticed" until seen on this device. */
  secret?: boolean;
  /** Why it stayed locked. */
  hint?: string;
}
export interface PathNode { id: string; title: string; level: number; branches: PathBranch[] }

export interface Chapter {
  id: number;
  title: string;
  levels: [first: number, last: number];
  status: 'ready' | 'planned';
  /** Chapter select may run it again from its start. */
  replayable?: boolean;
  path: PathNode[];
}

/** A MegaZroN line for a Vault scene. Per scene and group, the first match plays. */
export interface Comment { scene: string; group: string; key: string; if?: Cond }

export interface Ending {
  id: string;
  title: string;
  desc: string;
  /** Every ending is a stub until Level 99 exists. */
  status: 'planned' | 'done';
  if: Cond;
}

/** A line that may not be spoken as written (dead speaker, changed story). */
export interface LineChoice {
  key?: string;
  who?: string;
  /** People who must be alive; the speaker always counts. */
  requires?: Person[];
  /** Line (and speaker) to use instead. Without it the line is skipped. */
  fallback?: string;
  fallbackWho?: string;
  /** First match replaces the line. */
  swap?: { if: Cond; key: string; who?: string }[];
}

/** One line of the decisions log. */
export interface LogEntry {
  id: string;
  kind: 'decision' | 'qte' | 'hidden';
  /** Option id, or 'pass'/'fail'. */
  pick: string;
  timedOut?: boolean;
  level: number;
  day: number;
  at: number;
}

/** Lives in the save as `branch`. */
export interface BranchState {
  /** Keyed 'from>to', absent means 0. Clamped to -10..10. */
  trust: Record<string, number>;
  record: Record<Axis, number>;
  log: LogEntry[];
  /** The dead. Everyone not listed is alive. */
  dead: Record<Person, { cause: string; level: number }>;
  /** Payoffs waiting for their level: hidden id and payoff index. */
  pending: { id: string; i: number }[];
  /** A panel on screen when the game was last saved; it comes back on load. */
  open: { kind: 'decision' | 'qte'; id: string } | null;
  /** Times of story moments, in game hours since day 0. */
  marks: Record<string, number>;
}
