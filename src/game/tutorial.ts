import * as THREE from 'three';
import { has, t } from '../i18n';
import type { SaveData } from '../core/save';
import type { Input } from './input';
import type { Player } from './player';
import type { World } from '../world/world';

export type TutorialStep = 'look' | 'move' | 'sprint' | 'jump' | 'interact' | 'menu';
export const TUTORIAL_STEPS: TutorialStep[] = ['look', 'move', 'sprint', 'jump', 'interact', 'menu'];
/** Game seconds before an ignored hint quietly moves on. */
const PATIENCE = 40;

/**
 * First-play hints at the start of level 1: one short line low on the screen with
 * the right glyph for the device in use. Each goes away when the player does the
 * thing, or by itself if they ignore it, so nothing ever blocks play. The hint for
 * picking something up waits until there is something in reach.
 */
export class Tutorial {
  active = false;
  index = 0;
  private stepT = 0;
  private startPos = new THREE.Vector3();
  private startLook = 0;
  private sprintT = 0;
  private startCarried = 0;
  private panels = new Set<string>();
  private doneT = -1;
  private lastDevice = '';
  /** Item the interact step points the compass at. */
  target: THREE.Vector3 | null = null;
  onFinish: (() => void) | null = null;

  constructor(
    private input: Input,
    private player: Player,
    private world: World,
    private getSave: () => SaveData,
    private highlightTouch: (id: string | null) => void,
    private hint: (text: string | null) => void,
  ) {}

  get step(): TutorialStep | null { return this.active ? TUTORIAL_STEPS[this.index] : null; }

  start() {
    this.active = true;
    this.index = 0;
    this.panels.clear();
    this.begin();
  }

  /** The game reports panels being opened (inventory / crew / objectives). */
  notePanel(kind: string) { if (this.active) this.panels.add(kind); }

  private carried() {
    const inv = this.getSave().inventory;
    return Object.values(inv).reduce((a, b) => a + b, 0);
  }

  private begin() {
    this.stepT = 0;
    this.doneT = -1;
    this.startPos.copy(this.player.pos);
    this.startLook = this.input.lookTotal;
    this.sprintT = 0;
    this.startCarried = this.carried();
    this.target = null;
    if (this.step === 'interact') this.target = this.nearestPickable();
    this.render();
  }

  private nearestPickable(): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bd = Infinity;
    for (const it of this.world.items.items) {
      if (!it.active || (it.type !== 'stone' && it.type !== 'branch')) continue;
      const d = it.pos.distanceTo(this.player.pos);
      if (d < bd) { bd = d; best = it.pos; }
    }
    return best ? best.clone() : null;
  }

  private done(): boolean {
    const p = this.player;
    switch (this.step) {
      case 'look': return this.input.lookTotal - this.startLook > 500;
      case 'move': return Math.hypot(p.pos.x - this.startPos.x, p.pos.z - this.startPos.z) > 5;
      case 'sprint': return this.sprintT > 1.2;
      case 'jump': return !p.onGround && p.vel.y > 0.5;
      case 'interact': return this.carried() > this.startCarried;
      case 'menu': return this.panels.size > 0;
    }
    return true;
  }

  update(dt: number) {
    if (!this.active) return;
    this.stepT += dt;
    if (this.player.sprinting) this.sprintT += dt;
    if (this.input.device !== this.lastDevice) this.render();
    if (this.doneT < 0 && (this.done() || this.stepT > PATIENCE)) {
      this.doneT = 0;
      this.hint(null);
    }
    if (this.doneT >= 0) {
      this.doneT += dt;
      if (this.doneT > 0.8) {
        this.index++;
        if (this.index >= TUTORIAL_STEPS.length) this.finish(false);
        else this.begin();
      }
    }
  }

  private render() {
    const step = this.step;
    if (!step) return;
    this.lastDevice = this.input.device;
    const dev = this.input.device;
    this.hint(has(`tut.${step}.${dev}`) ? t(`tut.${step}.${dev}`) : t(`tut.${step}.kbm`));
    this.highlightTouch(step === 'move' && dev === 'touch' ? 'joy-zone' : null);
  }

  /** Re-render (language changed). */
  refresh() { if (this.active) this.render(); }

  finish(skipped: boolean) {
    if (!this.active) return;
    this.active = false;
    this.target = null;
    this.hint(null);
    this.highlightTouch(null);
    const s = this.getSave();
    s.flags.tutorialDone = true;
    if (skipped) s.flags.tutorialSkipped = true;
    this.onFinish?.();
  }
}
