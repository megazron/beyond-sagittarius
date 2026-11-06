import { CH2_FIRST, CH2_LAST } from '../tech/data';
import type { Chapter, Comment, Cond, Decision, Hidden, LineChoice, Qte } from './types';

/**
 * Chapter One's branches. Nobody can die here: the worst a player can do is
 * lose someone's trust, and that follows them into Chapter Two.
 */
const chose = (d: string, o: string): Cond => ({ chose: [d, o] });

/** Arriving at Skyvra within this many game hours of the signal counts as early. */
export const RESCUE_EARLY_HOURS = 3.5;

export const SPOKE_PLAINLY: Cond = { any: [chose('c1.accuse', 'truth'), chose('c1.accuse', 'proof')] };
export const JOKED: Cond = chose('c1.accuse', 'joke');
export const SAID_NOTHING: Cond = chose('c1.accuse', 'silent');
/** Truth alone isn't enough if everything before it went badly. */
export const HARD_TO_BELIEVE: Cond = { trust: 'explorer', lte: 2 };

export const DECISIONS: Decision[] = [
  {
    id: 'c1.fire', title: 'br.fire.title', prompt: 'br.fire.ask', who: 'explorer', fallback: 'small',
    options: [
      { id: 'big', label: 'br.fire.o.big', effects: [{ trait: 'nerve', by: 1 }, { trust: 'explorer', by: 1 }, { flag: 'c1.bigFire' }] },
      { id: 'small', label: 'br.fire.o.small', effects: [{ trait: 'nerve', by: -1 }, { trait: 'mercy', by: 1 }] },
    ],
  },
  {
    id: 'c1.accuse', title: 'br.acc.title', prompt: 'dlg.10.8', who: 'explorer', seconds: 10, fallback: 'silent',
    options: [
      { id: 'truth', label: 'br.acc.o.truth', effects: [{ trait: 'honesty', by: 2 }, { trust: 'explorer', by: 2 }, { trust: 'medic', by: 1 }, { trust: 'strong', by: 1 }] },
      { id: 'joke', label: 'br.acc.o.joke', effects: [{ trait: 'humour', by: 2 }, { trust: 'explorer', by: -2 }, { trust: 'medic', by: -1 }, { trust: 'strong', by: 1 }, { flag: 'c1.skyvraDoubts' }] },
      { id: 'silent', label: 'br.acc.o.silent', effects: [{ trait: 'honesty', by: -1 }, { trust: 'explorer', by: -1 }, { trust: 'medic', by: -1 }, { trust: 'strong', by: -1 }, { flag: 'c1.skyvraDoubts' }] },
      // earned, never promised: only someone she already trusts can do this
      { id: 'proof', label: 'br.acc.o.proof', requires: { trust: 'explorer', gte: 3 }, lockedHint: 'br.acc.lock.proof', effects: [{ trait: 'honesty', by: 3 }, { trust: 'explorer', by: 3 }, { trust: 'medic', by: 1 }, { trust: 'strong', by: 1 }, { flag: 'c1.logShared' }] },
    ],
  },
];

export const QTES: Qte[] = [
  {
    id: 'c1.splint', title: 'br.splint.title', label: 'br.splint.qte', seconds: 2.6,
    pass: [{ trait: 'nerve', by: 1 }, { trust: 'explorer', by: 1 }],
    fail: [{ trust: 'explorer', by: -1 }],
  },
];

export const HIDDEN_ACTIONS: Hidden[] = [
  // reaching Skyvra: never announced, she just notices
  { id: 'c1.rescue.early', effects: [{ trust: 'explorer', by: 1 }] },
  { id: 'c1.rescue.late', effects: [{ trust: 'explorer', by: -1 }, { flag: 'c1.rescueLate' }] },
  // half your food to a stranger; he remembers at the beacon
  {
    id: 'c1.pello.share', effects: [{ trait: 'mercy', by: 2 }, { trust: 'trav', by: 3 }, { stat: 'hunger', by: -20 }],
    payoffs: [{ level: 10, effects: [{ give: { scrap: 1 } }], say: { key: 'npc.trav.pay', who: 'npc.trav.name' }, toast: 'br.pello.toast', delay: 18 }],
  },
  // Tovik miscounts in your favour; the payoff depends on what you do about it
  {
    id: 'c1.tovik.over', effects: [],
    payoffs: [{ level: 9, if: { not: { did: 'c1.tovik.return' } }, effects: [{ trait: 'honesty', by: -1 }, { trust: 'trader', by: -2 }, { flag: 'c1.tovikShort' }] }],
  },
  {
    id: 'c1.tovik.return', effects: [{ trait: 'honesty', by: 1 }, { trust: 'trader', by: 2 }, { give: { flint: -1 } }],
    payoffs: [{ level: 9, effects: [{ give: { vine: 1 } }], say: { key: 'npc.trader.pay', who: 'npc.trader.name' }, toast: 'br.tovik.pay', delay: 9 }],
  },
];

/** Lines of a crewmate outside staged scenes that have a stand-in if they die. */
export const LINE_RULES: Record<string, LineChoice> = {};

const did = (id: string): Cond => ({ did: id });
const fromDecision = (id: string, title: string, level: number, list: [string, string, string?][]) => ({
  id, title, level,
  branches: list.map(([o, label, hint]) => ({ id: o, label, when: chose(id, o), hint })),
});

export const CHAPTER_ONE: Chapter = {
  id: 1, title: 'wake.chapter', levels: [1, 10], status: 'ready', replayable: true,
  path: [
    { id: 'pello', title: 'br.path.pello', level: 8, branches: [{ id: 'share', label: 'br.path.pello.share', when: did('c1.pello.share'), secret: true }] },
    {
      id: 'tovik', title: 'br.path.tovik', level: 8,
      branches: [
        { id: 'return', label: 'br.path.tovik.return', when: did('c1.tovik.return'), secret: true },
        { id: 'keep', label: 'br.path.tovik.keep', when: { flag: 'c1.tovikShort' }, secret: true },
      ],
    },
    {
      id: 'rescue', title: 'br.path.rescue', level: 9,
      branches: [
        { id: 'early', label: 'br.path.rescue.early', when: did('c1.rescue.early') },
        { id: 'late', label: 'br.path.rescue.late', when: did('c1.rescue.late') },
      ],
    },
    {
      id: 'splint', title: 'br.splint.title', level: 9,
      branches: [
        { id: 'pass', label: 'br.path.splint.pass', when: { passed: 'c1.splint' } },
        { id: 'fail', label: 'br.path.splint.fail', when: { all: [{ decided: 'c1.splint' }, { not: { passed: 'c1.splint' } }] } },
      ],
    },
    fromDecision('c1.fire', 'br.fire.title', 9, [['big', 'br.fire.o.big'], ['small', 'br.fire.o.small']]),
    fromDecision('c1.accuse', 'br.acc.title', 10, [['truth', 'br.acc.o.truth'], ['joke', 'br.acc.o.joke'], ['silent', 'br.acc.o.silent'], ['proof', 'br.acc.o.proof', 'br.acc.lock.proof']]),
  ],
};

/** Playable, with no branches of its own yet. */
export const CHAPTER_TWO: Chapter = { id: 2, title: 'objectives.ch2', levels: [CH2_FIRST, CH2_LAST], status: 'ready', path: [] };

/** MegaZroN reads the record back: `ch1` closes the chapter, `l7` is the half-way hint. */
export const COMMENTS: Comment[] = [
  { scene: 'l7', group: 'hint', key: 'mz.br.hint.tovik', if: { all: [{ did: 'c1.tovik.over' }, { not: { did: 'c1.tovik.return' } }] } },
  { scene: 'l7', group: 'hint', key: 'mz.br.hint.pello', if: { not: { did: 'c1.pello.share' } } },

  { scene: 'ch1', group: 'accuse', key: 'mz.br.timeout', if: { timedOut: 'c1.accuse' } },
  { scene: 'ch1', group: 'accuse', key: 'mz.br.proof', if: chose('c1.accuse', 'proof') },
  { scene: 'ch1', group: 'accuse', key: 'mz.br.truth', if: chose('c1.accuse', 'truth') },
  { scene: 'ch1', group: 'accuse', key: 'mz.br.joke', if: JOKED },
  { scene: 'ch1', group: 'accuse', key: 'mz.br.silent', if: SAID_NOTHING },

  { scene: 'ch1', group: 'small', key: 'mz.br.kind', if: did('c1.pello.share') },
  { scene: 'ch1', group: 'small', key: 'mz.br.fair', if: did('c1.tovik.return') },
  { scene: 'ch1', group: 'small', key: 'mz.br.kept', if: { flag: 'c1.tovikShort' } },
  { scene: 'ch1', group: 'small', key: 'mz.br.late', if: did('c1.rescue.late') },

  { scene: 'ch1', group: 'record', key: 'mz.br.rec.honesty', if: { top: 'honesty' } },
  { scene: 'ch1', group: 'record', key: 'mz.br.rec.mercy', if: { top: 'mercy' } },
  { scene: 'ch1', group: 'record', key: 'mz.br.rec.nerve', if: { top: 'nerve' } },
  { scene: 'ch1', group: 'record', key: 'mz.br.rec.humour', if: { top: 'humour' } },
  { scene: 'ch1', group: 'record', key: 'mz.br.rec.none' },
];
