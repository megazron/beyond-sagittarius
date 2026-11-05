import * as THREE from 'three';
import { t } from '../i18n';
import { audio } from '../core/audio';
import type { SaveData } from '../core/save';
import type { Input } from './input';
import type { Player } from './player';
import type { World } from '../world/world';

export type TutorialStep = 'look' | 'move' | 'sprint' | 'jump' | 'interact' | 'inventory' | 'crew' | 'objectives' | 'compass';
export const TUTORIAL_STEPS: TutorialStep[] = ['look', 'move', 'sprint', 'jump', 'interact', 'inventory', 'crew', 'objectives', 'compass'];

/** HUD element (and touch button) each step points at. */
const FOCUS: Partial<Record<TutorialStep, { hud?: string; touch?: string }>> = {
  move: { touch: 'joy-zone' },
  sprint: { hud: '.stat[data-stat="stamina"]', touch: 'tb-sprint' },
  jump: { touch: 'tb-jump' },
  interact: { hud: '#prompt', touch: 'tb-act' },
  inventory: { hud: '#inventory', touch: 'tb-inv' },
  crew: { touch: 'tb-crew' },
  objectives: { hud: '#objective', touch: 'tb-obj' },
  compass: { hud: '.compass' },
};

/**
 * First-play tutorial at the start of level 1. Each step waits for the player
 * to actually do the thing (look, walk, sprint, jump, pick up, open the
 * panels, read the compass). Text adapts to keyboard/mouse or touch.
 * Skippable; finishing or skipping sets save.flags.tutorialDone.
 */
export class Tutorial {
  active = false;
  index = 0;
  private el = document.getElementById('tutorial')!;
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
  ) {
    document.getElementById('tut-skip')!.addEventListener('click', () => { audio.uiClick(); this.finish(true); });
  }

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
    audio.blip();
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
      case 'inventory': return this.panels.has('inventory');
      case 'crew': return this.panels.has('crew');
      case 'objectives': return this.panels.has('objectives');
      case 'compass': return this.stepT > 7;
    }
    return true;
  }

  update(dt: number) {
    if (!this.active) return;
    this.stepT += dt;
    if (this.player.sprinting) this.sprintT += dt;
    if (this.input.device !== this.lastDevice) this.render();
    if (this.doneT < 0 && this.done()) {
      this.doneT = 0;
      this.el.classList.add('ok');
      audio.chime();
    }
    if (this.doneT >= 0) {
      this.doneT += dt;
      if (this.doneT > 1.1) {
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
    const dev = this.input.device === 'touch' ? 'touch' : 'kbm';
    this.el.classList.remove('hidden', 'ok');
    this.el.querySelector('.tut-head')!.textContent = t('tut.head', { k: this.index + 1, n: TUTORIAL_STEPS.length });
    this.el.querySelector('.tut-title')!.textContent = t(`tut.${step}.title`);
    this.el.querySelector('.tut-text')!.textContent = t(`tut.${step}.${dev}`);
    (this.el.querySelector('.tut-bar i') as HTMLElement).style.width = `${(this.index / TUTORIAL_STEPS.length) * 100}%`;
    document.getElementById('tut-skip')!.textContent = t('tut.skip');
    document.querySelectorAll('.tut-focus').forEach((e) => e.classList.remove('tut-focus'));
    const f = FOCUS[step];
    if (f?.hud) document.querySelector(f.hud)?.classList.add('tut-focus');
    this.highlightTouch(f?.touch ?? null);
  }

  /** Re-render (language changed). */
  refresh() { if (this.active) this.render(); }

  finish(skipped: boolean) {
    if (!this.active) return;
    this.active = false;
    this.target = null;
    this.el.classList.add('hidden');
    document.querySelectorAll('.tut-focus').forEach((e) => e.classList.remove('tut-focus'));
    this.highlightTouch(null);
    const s = this.getSave();
    s.flags.tutorialDone = true;
    if (skipped) s.flags.tutorialSkipped = true;
    this.onFinish?.();
  }
}
