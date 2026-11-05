import { setOverrides, tDefault } from '../i18n';

export const CREW_IDS = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social'] as const;
export type CrewId = (typeof CREW_IDS)[number];

/** Custom names keyed by crew id. Missing / empty entries use the localised default. */
export type CrewNames = Partial<Record<CrewId, string>>;

export const NAME_MAX = 24;

/** Trim, collapse whitespace, strip control characters, cap the length. */
export function cleanName(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

/** Keep only names that differ from the default, so defaults stay localised. */
export function normaliseNames(input: Record<string, string | undefined>): CrewNames {
  const out: CrewNames = {};
  for (const id of CREW_IDS) {
    const v = cleanName(input[id] ?? '');
    if (v && v !== tDefault(`crew.${id}.name`)) out[id] = v;
  }
  return out;
}

/** Install custom names into the translation layer. */
export function applyCrewNames(names: CrewNames | undefined) {
  const o: Record<string, string> = {};
  for (const id of CREW_IDS) {
    const v = names?.[id];
    if (v) o[`crew.${id}.name`] = v;
  }
  setOverrides(o);
}

/**
 * Builds before 0.2 used different default names. Saves only keep names that
 * differ from the default of the language they were typed in, so a save made
 * in one language can hold another language's old default. Those are dropped
 * so the crew falls back to the current defaults. Stored as FNV-1a hashes of
 * the lower-cased name (en/hi/ur spellings per crewmate).
 */
const LEGACY_DEFAULTS: Record<CrewId, number[]> = {
  scientist: [4048694782, 1751798852, 1639425083],
  strong: [1700455585, 2069723501, 2510399336],
  medic: [3640549380, 2675166801, 2871246698],
  explorer: [3752826550, 43926958, 429275271],
  builder: [1688677309, 3290705356, 1680436732],
  social: [2603557398, 3798086610, 3955141750],
};

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Map names saved by older builds: old default names become the new defaults. */
export function migrateNames(names: Partial<Record<string, string>> | undefined): CrewNames {
  const out: CrewNames = {};
  for (const id of CREW_IDS) {
    const v = names?.[id];
    if (!v) continue;
    if (LEGACY_DEFAULTS[id].includes(fnv1a(v.replace(/\s+/g, ' ').trim().toLowerCase()))) continue;
    out[id] = v;
  }
  return out;
}
