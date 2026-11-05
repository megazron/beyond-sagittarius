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
