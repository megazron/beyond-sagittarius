import type { CrewId, Limbs } from '../characters/character';
import { HURT } from '../core/hurtfx';
import { audio } from '../core/audio';

/**
 * What the arrival did to each of the six, carried into play (~/bs-story/LANDINGS.md): wounds that slow them, take
 * their sprint and their jump, bend them over a hand or hold an arm, blur the picture and let the heart be heard; and
 * that heal with time (faster resting, faster again once first aid is done).
 *
 * Severity is 0..1. One in-game hour is 50 s of play (game.ts), so healing rates are per game hour.
 */
export type Part = 'head' | 'ribsL' | 'ribsR' | 'shoulderL' | 'armR' | 'ankleR' | 'legL' | 'eyes';
export interface Wound { part: Part; sev: number; treated?: boolean }

/** How each arrives (defaulted, owner to confirm: DECISIONS.md L1 to L8). */
export const START: Record<CrewId, Wound[]> = {
  scientist: [{ part: 'head', sev: 0.8 }, { part: 'ribsL', sev: 0.7 }, { part: 'ankleR', sev: 0.8 }],
  explorer: [{ part: 'legL', sev: 1 }, { part: 'head', sev: 0.3 }],
  strong: [{ part: 'shoulderL', sev: 1 }, { part: 'head', sev: 0.4 }],
  medic: [{ part: 'armR', sev: 0.8 }, { part: 'head', sev: 0.3 }],
  builder: [{ part: 'ankleR', sev: 0.9 }, { part: 'head', sev: 0.35 }],
  social: [{ part: 'ribsR', sev: 0.8 }, { part: 'head', sev: 0.45 }, { part: 'eyes', sev: 0.5 }],
  megazron: [],
} as Record<CrewId, Wound[]>;

/** The first-aid task on each one's own stage and the wound it treats (kit.ts `first`). */
export const FIRST_AID: Record<string, { who: CrewId; part: Part }> = {
  splint: { who: 'explorer', part: 'legL' }, shoulder: { who: 'strong', part: 'shoulderL' }, bind: { who: 'medic', part: 'armR' },
  strap: { who: 'builder', part: 'ankleR' }, ribs: { who: 'social', part: 'ribsR' },
};

/** Healing per game hour: untreated, treated; resting doubles it. */
const HEAL: Record<Part, [number, number]> = {
  head: [0.18, 0.18], eyes: [0.5, 0.5], ribsL: [0.05, 0.12], ribsR: [0.05, 0.12], shoulderL: [0.02, 0.15], armR: [0.04, 0.14],
  ankleR: [0.07, 0.16], legL: [0.0, 0.05],
};

// arms that hold the hurt, in the body's own space (+x left, +y up, +z forward)
const HOLD: Partial<Record<Part, Limbs>> = {
  ribsL: { armR: [0.05, -0.75, 0.66], foreR: [0.95, 0.15, 0.25] },
  ribsR: { armL: [-0.05, -0.75, 0.66], foreL: [-0.95, 0.15, 0.25] },
  shoulderL: { armL: [0.05, -0.95, 0.3], foreL: [-0.55, 0.05, 0.84], armR: [0, -0.7, 0.72], foreR: [0.92, 0.1, 0.38] },
  armR: { armR: [-0.1, -0.85, 0.5], foreR: [0.5, 0.15, 0.85] },
};

export class Injuries {
  wounds: Wound[];
  private t = 0;
  private pulse = 0;
  private heardHeart = 0;
  constructor(public who: CrewId, saved?: Record<string, number>) {
    const fresh = START[who] ?? [];
    this.wounds = fresh.map((w) => {
      const s = saved?.[`${who}.${w.part}`];
      const tr = saved?.[`${who}.${w.part}.t`];
      return { part: w.part, sev: s === undefined ? w.sev : s, treated: !!tr };
    });
  }
  /** For the save. */
  write(into: Record<string, number>) { for (const w of this.wounds) { into[`${this.who}.${w.part}`] = Math.round(w.sev * 1000) / 1000; if (w.treated) into[`${this.who}.${w.part}.t`] = 1; } }
  sev(p: Part) { return this.wounds.find((w) => w.part === p)?.sev ?? 0; }
  treated(p: Part) { return !!this.wounds.find((w) => w.part === p)?.treated; }
  treat(p: Part) { const w = this.wounds.find((x) => x.part === p); if (w) { w.treated = true; w.sev = Math.min(w.sev, 0.6); } this.pulse = 1; }
  get any() { return this.wounds.some((w) => w.sev > 0.05); }

  /** How the body moves now. */
  effects() {
    const s = (p: Part) => this.sev(p);
    const leg = Math.max(s('ankleR'), s('legL') * (this.treated('legL') ? 0.75 : 1.25));
    const ribs = Math.max(s('ribsL'), s('ribsR'));
    // a leg that bears no weight is a crawl; splinted it is a slow hop
    const speed = Math.max(0.28, 1 - 0.62 * Math.min(1, leg) - 0.22 * ribs - 0.25 * s('shoulderL') * (this.treated('shoulderL') ? 0.4 : 1) - 0.1 * s('armR'));
    const jump = Math.max(0.35, 1 - 0.6 * Math.min(1, leg) - 0.3 * ribs);
    const sprint = ribs < 0.4 && leg < 0.45 && s('shoulderL') < 0.6;
    const limp = leg > 0.22;
    // which hurt the arms hold, most painful first
    const holds = (['shoulderL', 'ribsL', 'ribsR', 'armR'] as Part[]).filter((p) => s(p) > 0.25).sort((a, b) => s(b) - s(a));
    let limbs: Limbs | null = null;
    for (const p of holds) { const h = HOLD[p]; if (!h) continue; limbs = { ...h, ...(limbs ?? {}) }; }
    if (limbs) limbs.bend = 0.12 * Math.min(1, ribs + s('shoulderL'));
    return { speed, jump, sprint, limp, limbs };
  }

  /** Time passes: heal, and show what hurts. `hours` of game time; `resting` when standing still. */
  update(dt: number, hours: number, o: { resting: boolean; health?: number; hearHeart?: boolean }) {
    this.t += dt;
    for (const w of this.wounds) { const [u, tr] = HEAL[w.part]; w.sev = Math.max(0, w.sev - hours * (w.treated ? tr : u) * (o.resting ? 2 : 1)); }
    const H = HURT.play;
    // a concussion comes in waves: every so often the picture swims for a moment
    const head = this.sev('head'), eyes = this.sev('eyes');
    const wave = Math.max(0, Math.sin(this.t * 0.31) * Math.sin(this.t * 0.17 + 1)) ** 3;
    const low = o.health === undefined ? 0 : Math.max(0, (35 - o.health) / 35);
    this.pulse = Math.max(0, this.pulse - dt * 0.8);
    const beat = 0.5 + 0.5 * Math.sin(this.t * (6 + low * 4));
    H.blur = Math.min(1, head * wave * 0.55 + eyes * 0.18 + low * (0.2 + 0.25 * beat) + this.pulse * 0.4);
    H.double = head * wave * 0.008;
    H.tunnel = Math.min(1, low * (0.35 + 0.2 * beat) + this.pulse * 0.45);
    H.desat = low * 0.45;
    H.red = this.pulse * 0.3;
    // the heart is heard when health is low (and once first aid is done, for a moment)
    const want = (o.hearHeart ?? true) && (low > 0 || this.pulse > 0.1) ? Math.round(96 + low * 60 + this.pulse * 30) : 0;
    if (want !== this.heardHeart) { this.heardHeart = want; audio.heart(want, 0.25 + low * 0.3); }
  }
  /** Leaving play (a scene, another body): picture and heart back to normal. */
  quiet() { Object.assign(HURT.play, { blur: 0, double: 0, tunnel: 0, desat: 0, red: 0, flash: 0, black: 0 }); if (this.heardHeart) { this.heardHeart = 0; audio.heart(0); } }
}
