import type { Lang } from '../../i18n';
import type { Cond } from './types';

/** The Ledger questions' data (types and the loaded copy), apart from the sealed file so tests can set it under Node. */
export type From = { hook: number } | { find: string } | { level: number };
export interface MyStage { key: string; from: From; answers?: string }
export interface MyQuestion { id: string; stages: MyStage[] }
export interface MyClue { id: string; title: string; text: string; icon: string; q: string[]; level: number; from: From; dream?: boolean; pay?: { level: number; key: string } }
export interface MyBeat { key?: string; who?: string; shot?: string; prop?: string; hold?: number; after?: number; on?: string; run?: string; pose?: string; if?: Cond }
export interface MyHook { level: number; kind: string; beats: MyBeat[]; variants?: { if: Cond; beats: MyBeat[] }[] }
export interface MyFind { id: string; level: number; at: { near: string; a?: number; r?: number }; prop: string; line: string; clue: string }
export interface MyData {
  questions: MyQuestion[]; clues: MyClue[]; hooks: MyHook[]; finds: MyFind[];
  recaps: { levels: Record<string, string>; flags: { if: Cond; key: string }[]; fallback: string };
  premonitions: { id: string; hook: number; clue: string; trueAt: number | null }[];
  goals: Record<string, string>; footer: { zero: string; some: string; all: string };
  strings?: Partial<Record<Lang, Record<string, string>>>;
}

export let MYSTERY: MyData | null = null;
export function setMystery(d: MyData) { MYSTERY = d; }
