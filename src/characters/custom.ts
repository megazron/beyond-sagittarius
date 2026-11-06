import type { HairStyleId } from './hair';

export type Lineage = 'ulari' | 'korrath' | 'vael' | 'tarnkin' | 'ortek' | 'sirelle';
export type Ears = 'round' | 'fin' | 'long' | 'tuft';
export type Marks = 'dots' | 'cracks' | 'veins' | 'stripes' | 'plates' | 'stars';
export type EyeShape = 'tired' | 'narrow' | 'calm' | 'bright' | 'squint' | 'doll';
export type OutfitId = 'scientist' | 'strong' | 'medic' | 'explorer' | 'builder' | 'social';

/** Everything the player chooses on the character creator. Saved with the game. */
export interface PlayerLook {
  name: string;
  gender: 'm' | 'f';
  height: number; // 0.92 .. 1.08
  build: number; // 0 slim .. 1 heavy
  lineage: Lineage;
  skin: number;
  ears: Ears;
  horns: boolean;
  tail: boolean;
  marks: Marks;
  glow: number;
  eye: EyeShape;
  iris: number;
  eyeGlow: boolean;
  hair: HairStyleId;
  hairRoot: number;
  hairTip: number;
  outfit: OutfitId;
  accent: number;
}

/** Each lineage sets sensible species features; everything stays editable. */
export const LINEAGES: Record<Lineage, Pick<PlayerLook, 'skin' | 'ears' | 'horns' | 'tail' | 'marks' | 'glow' | 'iris'>> = {
  ulari: { skin: 0x57b3ad, ears: 'fin', horns: false, tail: false, marks: 'dots', glow: 0x6ff6e6, iris: 0x7ffcff },
  korrath: { skin: 0xc77d33, ears: 'round', horns: true, tail: false, marks: 'cracks', glow: 0xff7a1e, iris: 0xffc23a },
  vael: { skin: 0xc3a8ee, ears: 'long', horns: false, tail: false, marks: 'veins', glow: 0xc8a8ff, iris: 0xe4d6ff },
  tarnkin: { skin: 0xe68a78, ears: 'tuft', horns: false, tail: true, marks: 'stripes', glow: 0xff5e6e, iris: 0x4cf08c },
  ortek: { skin: 0x6fa867, ears: 'round', horns: false, tail: false, marks: 'plates', glow: 0xffa030, iris: 0xff9a32 },
  sirelle: { skin: 0x4d70e0, ears: 'round', horns: false, tail: false, marks: 'stars', glow: 0xffe07a, iris: 0xffd84a },
};

export const LINEAGE_IDS = Object.keys(LINEAGES) as Lineage[];
export const SKINS = [0x57b3ad, 0xc77d33, 0xc3a8ee, 0xe68a78, 0x6fa867, 0x4d70e0, 0xb98463, 0x8f5b3f, 0xe6c3a0, 0xd9607a, 0x7a54c8, 0x2f8f8f];
export const GLOWS = [0x6ff6e6, 0xff7a1e, 0xc8a8ff, 0xff5e6e, 0xffa030, 0xffe07a, 0x7fff8a, 0x6fb6ff];
export const IRISES = [0x7ffcff, 0xffc23a, 0xe4d6ff, 0x4cf08c, 0xff9a32, 0xffd84a, 0xff5ea8, 0x8a5a34];
export const HAIR_COLOURS = [0x142c66, 0xc4201e, 0xb6b8dc, 0xf07a18, 0x12a48c, 0xff3f9e, 0x2a1a14, 0x6a2bd0, 0xf2e6b0, 0x0e0e12];
export const HAIR_TIPS = [0x24c6d8, 0xffb02e, 0xe9e6f8, 0xffd24a, 0xb6ff5a, 0xffb0e6, 0x6a4a34, 0xc8a0ff];
export const ACCENTS = [0xff8a3d, 0xe0453a, 0x3fd3a0, 0xffb13a, 0xffd23a, 0xff3f9e, 0x6fe3ff, 0x8f6bff];
export const HAIRS: HairStyleId[] = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social'];
export const OUTFITS: OutfitId[] = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social'];
export const EYES: EyeShape[] = ['tired', 'narrow', 'calm', 'bright', 'squint', 'doll'];
export const EARS: Ears[] = ['round', 'fin', 'long', 'tuft'];
export const MARKS: Marks[] = ['dots', 'cracks', 'veins', 'stripes', 'plates', 'stars'];

export function defaultLook(): PlayerLook {
  return {
    name: '', gender: 'm', height: 1, build: 0.25, lineage: 'ulari', ...LINEAGES.ulari, eye: 'tired', eyeGlow: true,
    hair: 'scientist', hairRoot: 0x142c66, hairTip: 0x24c6d8, outfit: 'scientist', accent: 0xff8a3d,
  };
}

export function randomLook(keep: Pick<PlayerLook, 'name' | 'gender'>): PlayerLook {
  const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
  const lineage = pick(LINEAGE_IDS);
  return {
    ...defaultLook(), ...keep, lineage, ...LINEAGES[lineage],
    height: 0.93 + Math.random() * 0.14, build: Math.random(),
    eye: pick(EYES), eyeGlow: Math.random() > 0.3, hair: pick(HAIRS), hairRoot: pick(HAIR_COLOURS), hairTip: pick(HAIR_TIPS),
    outfit: pick(OUTFITS), accent: pick(ACCENTS),
  };
}

/** Skins other crew can wear (cosmetic, chosen in the skins menu). */
export type CrewSkins = { strong?: 'default' | 'suit' };
