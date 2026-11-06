import { CHAPTER_ONE, CHAPTER_TWO, COMMENTS as C1_COMMENTS, DECISIONS as C1_DECISIONS, HIDDEN_ACTIONS, LINE_RULES as C1_LINES, QTES as C1_QTES } from './chapter1';
import type { Chapter, Comment, Decision, Hidden, LineChoice, Qte } from './types';

const byId = <T extends { id: string }>(list: T[]) => Object.fromEntries(list.map((x) => [x.id, x])) as Record<string, T>;

/** Exists only for the smoke tests; never on a path tree. */
const TEST_DECISION: Decision = {
  id: 'debug.timed', title: 'br.acc.title', prompt: 'dlg.10.8', seconds: 6, fallback: 'silent',
  options: [
    { id: 'truth', label: 'br.acc.o.truth', effects: [] },
    { id: 'joke', label: 'br.acc.o.joke', effects: [] },
    { id: 'silent', label: 'br.acc.o.silent', effects: [] },
  ],
};
const TEST_QTE: Qte = { id: 'debug.qte', title: 'br.splint.title', label: 'br.splint.qte', seconds: 2, pass: [], fail: [] };

/** Add each new chapter's data here. */
export const DECISIONS = byId([...C1_DECISIONS, TEST_DECISION]);
export const QTES = byId([...C1_QTES, TEST_QTE]);
export const HIDDEN: Record<string, Hidden> = byId(HIDDEN_ACTIONS);
export const COMMENTS: Comment[] = [...C1_COMMENTS];
export const LINE_RULES: Record<string, LineChoice> = { ...C1_LINES };
export const CHAPTERS: Chapter[] = [CHAPTER_ONE, CHAPTER_TWO];
