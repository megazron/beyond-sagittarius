/**
 * The spine of the game: humanity's real path from rocks to a ship home, as
 * data. Text lives in the i18n files under `tech.<id>` (name) and
 * `codex.<id>.text` / `codex.<id>.joke`. Nothing here is a recipe: minigame
 * steps are qualitative on purpose, with no quantities a player could copy.
 * Dangerous chains (explosives, toxic gases, strong acids) are left out.
 */
export const AGES = ['stone', 'tools', 'agri', 'bronze', 'iron', 'classical', 'industrial', 'space', 'civ'] as const;
export type AgeId = (typeof AGES)[number];

export type WarnCat = 'fire' | 'heat' | 'chemical' | 'electric' | 'sharp' | 'pressure';
export type ProcessType = 'knap' | 'twist' | 'friction' | 'firing' | 'smoulder' | 'calcine' | 'evaporate' | 'melt' | 'saponify' | 'ferment' | 'neutralise' | 'cultivate' | 'smelt' | 'forge' | 'build' | 'study' | 'assemble';

/** One minigame step. All numbers are on a 0..1 gauge, never real units. */
export type Step =
  | { kind: 'tap'; hits: number; zone: number; speed: number }
  | { kind: 'heat'; band: [number, number]; secs: number; rise: number; fall: number }
  | { kind: 'rhythm'; band: [number, number]; secs: number }
  | { kind: 'mix'; band: [number, number]; litmus?: boolean };

export interface TechNode {
  id: string;
  age: AgeId;
  /** Tech ids that must be discovered first. */
  requires: string[];
  /** Item id -> count consumed. Empty on planned entries: not designed yet. */
  ingredients: Record<string, number>;
  /** Item id -> count produced. */
  yields: Record<string, number>;
  process: ProcessType;
  /** Playable entries only. */
  steps: Step[];
  /** i18n prefix: `<codex>.text`, `<codex>.joke`. */
  codex: string;
  /** Who tells the joke line (voice speaker id, `crew.<id>.name` or MegaZroN). */
  joker: string;
  /** Plain safety warnings shown on the discovery and in the codex. */
  warn: WarnCat[];
  status: 'playable' | 'planned';
}

const playable = (id: string, age: AgeId, requires: string[], ingredients: Record<string, number>, yields: Record<string, number>, process: ProcessType, steps: Step[], joker: string, warn: WarnCat[]): TechNode =>
  ({ id, age, requires, ingredients, yields, process, steps, codex: `codex.${id}`, joker, warn, status: 'playable' });
const planned = (id: string, age: AgeId, requires: string[], process: ProcessType, warn: WarnCat[]): TechNode =>
  ({ id, age, requires, ingredients: {}, yields: {}, process, steps: [], codex: `codex.${id}`, joker: 'megazron', warn, status: 'planned' });

export const TECH: TechNode[] = [
  // ---- Stone Age ----
  playable('knapping', 'stone', [], { nodule: 2, stone: 1 }, { blade: 2 }, 'knap',
    [{ kind: 'tap', hits: 4, zone: 0.16, speed: 0.75 }], 'strong', ['sharp']),
  playable('cordage', 'stone', ['knapping'], { fibre: 3 }, { cord: 2 }, 'twist',
    [{ kind: 'rhythm', band: [0.4, 0.75], secs: 5 }], 'social', []),
  playable('fire', 'stone', ['cordage'], { branch: 2, tinder: 1, cord: 1 }, {}, 'friction',
    [{ kind: 'rhythm', band: [0.5, 0.8], secs: 5 }, { kind: 'heat', band: [0.4, 0.62], secs: 3.5, rise: 0.4, fall: 0.28 }], 'medic', ['fire']),
  playable('pottery', 'stone', ['fire'], { clay: 3, sand: 1 }, { pot: 3 }, 'firing',
    [{ kind: 'mix', band: [0.42, 0.6] }, { kind: 'heat', band: [0.55, 0.75], secs: 5, rise: 0.3, fall: 0.2 }], 'builder', ['heat']),
  // ---- Fire and Tools ----
  playable('charcoal', 'tools', ['pottery'], { branch: 4, clay: 1 }, { charcoal: 3 }, 'smoulder',
    [{ kind: 'heat', band: [0.3, 0.5], secs: 6, rise: 0.3, fall: 0.2 }], 'megazron', ['fire']),
  playable('lime', 'tools', ['charcoal'], { limestone: 2, charcoal: 1 }, { lime: 3 }, 'calcine',
    [{ kind: 'heat', band: [0.7, 0.86], secs: 6, rise: 0.34, fall: 0.2 }, { kind: 'mix', band: [0.5, 0.66] }], 'builder', ['heat', 'chemical']),
  playable('salt', 'tools', ['pottery'], { brine: 3 }, { salt: 3 }, 'evaporate',
    [{ kind: 'heat', band: [0.45, 0.62], secs: 4, rise: 0.3, fall: 0.2 }, { kind: 'rhythm', band: [0.35, 0.65], secs: 4 }], 'social', ['heat']),
  playable('glass', 'tools', ['lime'], { sand: 2, ash: 2, lime: 1, charcoal: 1 }, { glass: 2 }, 'melt',
    [{ kind: 'mix', band: [0.5, 0.64] }, { kind: 'heat', band: [0.8, 0.9], secs: 5, rise: 0.32, fall: 0.2 }], 'medic', ['heat']),
  playable('soap', 'tools', ['pottery'], { ash: 2, oilnut: 2 }, { soap: 3 }, 'saponify',
    [{ kind: 'mix', band: [0.45, 0.6] }, { kind: 'rhythm', band: [0.4, 0.7], secs: 5 }], 'medic', ['chemical']),
  // ---- Agriculture ----
  playable('fermentation', 'agri', ['pottery'], { sugarpod: 3, pot: 1 }, { brew: 2 }, 'ferment',
    [{ kind: 'mix', band: [0.4, 0.58] }, { kind: 'heat', band: [0.28, 0.44], secs: 5, rise: 0.26, fall: 0.18 }], 'strong', ['pressure']),
  playable('acids', 'agri', ['fermentation', 'lime'], { brew: 1, lime: 1, lichen: 1 }, { vinegar: 2 }, 'neutralise',
    [{ kind: 'rhythm', band: [0.4, 0.7], secs: 4 }, { kind: 'mix', band: [0.44, 0.56], litmus: true }], 'megazron', ['chemical']),
  planned('farming', 'agri', ['pottery', 'knapping'], 'cultivate', []),
  planned('irrigation', 'agri', ['farming'], 'build', []),
  // ---- Bronze Age ----
  planned('copper', 'bronze', ['charcoal', 'pottery'], 'smelt', ['heat']),
  planned('bronze', 'bronze', ['copper'], 'smelt', ['heat']),
  planned('wheel', 'bronze', ['pottery'], 'build', []),
  planned('lever', 'bronze', ['knapping'], 'build', []),
  // ---- Iron Age ----
  planned('iron', 'iron', ['bronze', 'charcoal'], 'smelt', ['heat']),
  planned('steel', 'iron', ['iron'], 'forge', ['heat']),
  // ---- Classical ----
  planned('writing', 'classical', ['pottery'], 'study', []),
  planned('pulley', 'classical', ['wheel', 'cordage'], 'build', []),
  planned('waterwheel', 'classical', ['wheel'], 'build', []),
  // ---- Industrial ----
  planned('magnets', 'industrial', ['iron'], 'study', []),
  planned('batteries', 'industrial', ['copper', 'acids'], 'assemble', ['chemical', 'electric']),
  planned('wire', 'industrial', ['copper'], 'forge', ['electric']),
  planned('generators', 'industrial', ['magnets', 'wire', 'waterwheel'], 'assemble', ['electric']),
  planned('engines', 'industrial', ['steel'], 'assemble', ['heat', 'pressure']),
  planned('medicine', 'industrial', ['soap', 'glass', 'fermentation'], 'study', ['chemical']),
  planned('radio', 'industrial', ['generators', 'batteries'], 'assemble', ['electric']),
  // ---- Space ----
  planned('computing', 'space', ['radio', 'writing', 'glass'], 'assemble', ['electric']),
  planned('rocketry', 'space', ['engines', 'computing'], 'assemble', ['fire', 'pressure']),
  planned('orbital', 'space', ['computing'], 'study', []),
  // ---- Civilisation ----
  planned('shiphome', 'civ', ['rocketry', 'orbital', 'medicine'], 'assemble', ['fire', 'pressure', 'electric']),
];

export const TECH_BY_ID: Record<string, TechNode> = Object.fromEntries(TECH.map((n) => [n.id, n]));

/** Chapter Two: level number -> discovery, in story order. */
export const CH2_FIRST = 11;
export const CH2_ORDER = ['knapping', 'cordage', 'fire', 'pottery', 'charcoal', 'lime', 'salt', 'glass', 'soap', 'fermentation', 'acids'];
export const CH2_LAST = CH2_FIRST + CH2_ORDER.length - 1;

/** Things you make rather than gather; the world never respawns these. */
export const PRODUCTS = new Set(TECH.flatMap((n) => Object.keys(n.yields)));
