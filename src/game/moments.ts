import type { SceneBranch } from '../cinematic/cutscene';
import type { MomentLayer } from '../ui/moment';
import type { Effect } from './branch/types';
import { DECISIONS, QTES } from './branch/registry';
import { apply, record, resolveLine, test, trustOf, type StoryState } from './branch/engine';

const PLAYER = 'scientist';

/**
 * The story's choices over a film or a scene, on the choice layer (ui/moment.ts): decisions in a tone or an act, reflexes
 * (a press, a hold, a heartbeat), each answer written to the save at once (`persist`), the Ledger's line and the bond
 * meters that moved. The opening uses it over its own save (main.ts), before the planet; it works on any save.
 */
export class MomentBranch implements SceneBranch {
  constructor(private save: () => StoryState, private layer: MomentLayer, private persist: () => void, private timersOff: () => boolean = () => false) {}

  test(c: Parameters<typeof test>[1]) { return test(this.save(), c); }
  line(b: Parameters<typeof resolveLine>[1]) { return resolveLine(this.save(), b); }
  apply(e: Effect[]) { this.applyShown(e); }
  answered(id: string) { return this.save().branch.log.some((x) => x.id === id); }

  /** Applies effects and shows the bonds they moved. */
  private applyShown(effects: Effect[]) {
    const s = this.save();
    const pairs = effects.filter((e): e is Extract<Effect, { trust: string }> => 'trust' in e).map((e) => ({ from: e.trust, to: e.to ?? PLAYER }));
    const before = pairs.map((p) => trustOf(s.branch, p.from, p.to));
    apply(s, effects);
    const moved = pairs.map((p, i) => ({ ...p, before: before[i], after: trustOf(s.branch, p.from, p.to) })).filter((c) => c.after !== c.before);
    this.layer.bond(moved);
  }

  private settle(note?: string) {
    this.save().branch.open = null;
    this.layer.ledger(note ?? 'br.written');
    this.persist();
  }

  ask(id: string, done: () => void) {
    const s = this.save(), d = DECISIONS[id];
    if (!d) { done(); return; }
    // a silent option is never a button: it is what the timer running out says
    const shown = d.options.filter((o) => o.tone !== 'silent' && test(s, o.requires));
    s.branch.open = { kind: 'decision', id };
    this.persist();
    this.layer.choose({
      who: d.who ? `crew.${d.who}.name` : undefined, prompt: d.prompt, as: d.as && d.as !== PLAYER ? `crew.${d.as}.name` : undefined,
      style: d.style ?? 'talk', options: shown.map((o) => ({ label: o.label, tone: o.tone })),
      seconds: d.seconds && !this.timersOff() ? d.seconds : null,
      fallback: Math.max(-1, shown.findIndex((o) => o.id === d.fallback)),
      onDone: (i, timedOut) => {
        const o = (timedOut ? d.options.find((x) => x.id === d.fallback) : shown[i]) ?? d.options[0];
        record(s, id, 'decision', o.id, timedOut);
        this.applyShown(o.effects);
        this.settle(o.note);
        done();
      },
    });
  }

  quick(id: string, done: () => void) {
    const s = this.save(), q = QTES[id];
    if (!q) { done(); return; }
    s.branch.open = { kind: 'qte', id };
    this.persist();
    this.layer.quick({
      kind: q.kind ?? 'press', label: q.label, as: q.as && q.as !== PLAYER ? `crew.${q.as}.name` : undefined,
      seconds: this.timersOff() && (q.kind ?? 'press') === 'press' ? null : q.seconds, count: q.count,
      onDone: (passed) => {
        record(s, id, 'qte', passed ? 'pass' : 'fail');
        this.applyShown(passed ? q.pass : q.fail);
        this.settle(passed ? q.note?.pass : q.note?.fail);
        done();
      },
    });
  }
}
