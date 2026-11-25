import * as THREE from 'three';
import { t } from '../i18n';
import { audio } from '../core/audio';
import type { SaveData } from '../core/save';
import type { World } from '../world/world';
import type { Player } from './player';
import type { UI } from '../ui/ui';
import type { Action, Story } from './story';
import { CH2_FIRST, CH2_LAST, CH2_ORDER, PRODUCTS, TECH, TECH_BY_ID, TechNode } from './tech/data';
import { isDiscovered, prereqsMet } from './tech/tech';
import type { DlgChoice, DlgTree } from './dialogue';
import type { Episode2 } from './episode2';
import type { Episode3 } from './episode3';

/** Beacon lines triggered by a discovery. */
const BEACON: Record<string, string> = { fire: 'ch2.beacon.fire', pottery: 'ch2.beacon.pottery', glass: 'ch2.beacon.glass' };
const RADIO = ['strong', 'medic', 'builder', 'social'];

/**
 * Chapter Two, levels 11-21: one discovery per level, gathered from the world
 * and worked at camp. Skyvra teaches and reacts, the rest of the crew heckle
 * by radio, and the beacon has started to comment.
 */
export class Chapter2 {
  private introT = 7;
  private respawnT = 0;
  private radioIdx = 0;
  /** Episode Two owns levels 11 to 14: its scenes come round these levels' discoveries (game.ts sets it). */
  ep2: Episode2 | null = null;
  /** Episode Three owns levels 15 to 21 the same way. */
  ep3: Episode3 | null = null;
  /** The episode that owns level n (Two or Three), if any. */
  private ep(n = this.s.level): Episode2 | null { return this.ep2?.owns(n) ? this.ep2 : this.ep3?.owns(n) ? this.ep3 : null; }
  private ep2Level(n = this.s.level) { return !!this.ep(n); }

  constructor(private story: Story, private world: World, private player: Player, private ui: UI, private getSave: () => SaveData, private after: (s: number, fn: () => void) => void) {}

  private get s() { return this.getSave(); }
  private inv(k: string) { return this.s.inventory[k] ?? 0; }

  /** The discovery a level is about. */
  node(n: number): TechNode | null {
    return n >= CH2_FIRST && n <= CH2_LAST ? TECH_BY_ID[CH2_ORDER[n - CH2_FIRST]] : null;
  }

  done(n: number): boolean {
    if (this.ep2Level(n)) return this.ep(n)!.done(n);
    if (n === CH2_LAST) return !!this.s.flags.ch2End;
    const node = this.node(n);
    return !!node && isDiscovered(this.s, node.id);
  }

  private short(node: TechNode) { return Object.keys(node.ingredients).filter((k) => this.inv(k) < node.ingredients[k]); }

  progress(n: number): string | null {
    if (this.ep2Level(n)) { const e = this.ep(n)!, p = e.progress(n); if (p) return p; if (!e.craftOpen(n)) return null; }
    const node = this.node(n);
    if (!node || isDiscovered(this.s, node.id)) return null;
    const short = this.short(node);
    if (!short.length) return t('progress.ch2Ready');
    const made = short.filter((k) => PRODUCTS.has(k));
    if (made.length) return t('progress.remake', { list: made.map((k) => t(`item.${k}`)).join(', ') });
    return this.story.progressOf(node.ingredients);
  }

  marker(n: number): THREE.Vector3 | null {
    if (this.ep2Level(n)) { const e = this.ep(n)!, m = e.marker(n); if (m) return m; if (!e.craftOpen(n)) return this.world.layout.campSeat; }
    const node = this.node(n);
    if (!node || isDiscovered(this.s, node.id)) return this.world.layout.campSeat;
    const raw = this.short(node).filter((k) => !PRODUCTS.has(k));
    if (raw.length) { const p = this.story.nearest(raw); if (p) return p; }
    return this.short(node).length ? this.world.layout.campSeat : this.world.layout.camp;
  }

  actions(): Action[] {
    const s = this.s, L = this.world.layout, out: Action[] = [];
    if (s.level < CH2_FIRST) return out;
    const node = this.node(s.level);
    if (this.ep2Level()) {
      const e = this.ep()!;
      out.push(...e.actions());
      const cn = e.craftNode(s.level) ?? node;
      if (cn && cn.status === 'playable' && !isDiscovered(s, cn.id) && prereqsMet(s, cn) && e.craftOpen(s.level)) {
        out.push({ id: `craft-${cn.id}`, pos: e.craftAt(s.level) ?? L.camp, radius: 2.6, label: t('action.craft', { name: t(`tech.${cn.id}`) }), missing: this.story.missing(cn.ingredients), run: () => this.story.hooks.craft(cn) });
      }
      return out;
    }
    if (node && !isDiscovered(s, node.id) && prereqsMet(s, node)) {
      out.push({ id: `craft-${node.id}`, pos: L.camp, radius: 2.6, label: t('action.craft', { name: t(`tech.${node.id}`) }), missing: this.story.missing(node.ingredients), run: () => this.story.hooks.craft(node) });
    }
    out.push({ id: 'skyvra', pos: this.story.crewPos, radius: 2.2, label: t('action.talk', { name: t('{f:explorer}') }), run: () => this.story.hooks.talk(this.skyvra()) });
    return out;
  }

  update(dt: number) {
    const s = this.s;
    if (s.level < CH2_FIRST) return;
    if (this.ep2Level()) this.ep()!.update(dt);
    else if (this.ep3 && s.level > 21) this.ep3.update(dt);
    if (!s.flags.ch2Intro && !this.ep2Level()) {
      this.introT -= dt;
      if (this.introT <= 0 && !this.story.busy) {
        s.flags.ch2Intro = true;
        this.ui.banner(t('chapter2.c1'), t('chapter2.c2'));
        this.story.dialogue([['ch2.intro.1', 'explorer'], ['ch2.intro.2', 'explorer'], ['ch2.intro.3', 'builder']], 5, () => {
          if (!s.flags.safetyJoke) { s.flags.safetyJoke = true; this.ui.say('safety.joke', 'mz.name', 4); }
        });
      }
    }
    // nothing you can trade away or lose may block the chapter
    this.respawnT -= dt;
    if (this.respawnT <= 0) { this.respawnT = 2; this.restock(); }
  }

  private restock() {
    const node = this.node(this.s.level);
    if (!node) return;
    for (const k of this.short(node)) {
      if (PRODUCTS.has(k)) continue;
      const all = this.world.items.items.filter((it) => it.type === k && it.gate);
      if (all.some((it) => it.active)) continue;
      for (const it of all) {
        it.active = true; it.obj.visible = true;
        this.s.collected = this.s.collected.filter((c) => c !== it.id);
      }
    }
  }

  /** After the discovery card closes: Skyvra reacts, the beacon may listen in. */
  afterDiscovery(node: TechNode) {
    this.world.setCampWork(this.s.discoveries ?? []);
    // Episode Two's discoveries have their own scenes (no voice from the beacon, nobody at camp to react)
    if (this.ep2Level()) return;
    if (node.id === 'acids') { this.after(0.6, () => this.ui.say(`after.${node.id}`, 'crew.explorer.name', 4)); this.after(5, () => this.story.ch2Finale()); return; }
    this.after(0.6, () => this.ui.say(`after.${node.id}`, 'crew.explorer.name', 4));
    const b = BEACON[node.id];
    if (b) {
      this.after(5.5, () => {
        this.ui.deviceLines([t('beacon.voice'), t(b)], true, true);
        audio.tone(40, 1.6, 'sawtooth', 0.2, 0, 10);
        this.ui.say(b, undefined, 3.5);
      });
      this.after(9.5, () => {
        this.ui.deviceLines(null);
        if (!this.s.flags.beaconHeard) { this.s.flags.beaconHeard = true; this.ui.say('ch2.beacon.react', 'crew.explorer.name', 4); }
      });
    }
  }

  /** Skyvra at the fire: teaches the next step, reacts, re-makes what ran out. */
  private skyvra(): DlgTree {
    const s = this.s, who = 'crew.explorer.name';
    const node = this.node(s.level);
    const once = (k: string) => { if (s.flags[k]) return false; s.flags[k] = true; return true; };
    const back: DlgChoice = { label: 'ch.back', go: 'top' };
    const bye: DlgChoice = { label: 'ch.bye' };
    const made = TECH.filter((n) => isDiscovered(s, n.id) && Object.keys(n.yields).length);
    const radioWho = RADIO[this.radioIdx % RADIO.length];
    return {
      start: 'top',
      nodes: {
        top: {
          who,
          say: () => ((s.deaths ?? 0) >= 3 && once('sk-dead') ? 'sk.dead' : (s.crafts?.failed ?? 0) >= 3 && once('sk-fails') ? 'sk.fails' : 'sk.hi'),
          choices: () => [
            { label: 'ch.next', go: 'next' },
            { label: 'ch.more', go: 'more', show: () => made.length > 0 },
            { label: 'ch.radio', go: 'radio', run: () => { this.radioIdx++; } },
            { label: 'ch.leg', go: 'leg' },
            bye,
          ],
        },
        next: { who, say: node && !isDiscovered(s, node.id) ? `teach.${node.id}` : 'sk.done', choices: [back, bye] },
        leg: { who, say: 'sk.leg', choices: [back, bye] },
        radio: { who: `crew.${radioWho}.name`, say: `rad.ch2.${radioWho}`, choices: [back, bye] },
        more: {
          who, say: 'sk.hi',
          choices: () => [...made.map((n): DlgChoice => ({
            label: 'action.craft', params: { name: t(`tech.${n.id}`) },
            blocked: () => { const m = this.story.missing(n.ingredients); return m.length ? t('dlg.need', { list: m.join(', ') }) : null; },
            then: () => this.story.hooks.craft(n),
          })), back],
        },
      },
    };
  }
}
