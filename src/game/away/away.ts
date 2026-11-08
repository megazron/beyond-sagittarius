import * as THREE from 'three';
import { Player } from '../player';
import type { CrewId } from '../../characters/character';
import type { Input } from '../input';
import type { UI } from '../../ui/ui';
import { t } from '../../i18n';
import type { AwayStage, AwayTask } from './stage';
import { createRing } from './ring';
import { buildStage, STAGES } from './kit';

const make = (loc: string, label: (k: string) => string): AwayStage => (loc === 'ring' ? createRing(label) : buildStage(loc, STAGES[loc], label));

/** Playing someone else, somewhere else: their stage, their tasks, the same controls on every device. */
export class Away {
  active = false;
  who: CrewId | null = null;
  stage: AwayStage | null = null;
  done = new Set<string>();
  private player: Player | null = null;
  private onDone: (() => void) | null = null;
  /** Runs a task's story beat (a quick-time, a line). Call `go` when it is over. */
  onTask: ((id: string, go: () => void) => void) | null = null;
  private busy = false;
  /** Seconds after coming back during which interact is ignored. */
  quiet = 0;

  constructor(private camera: THREE.PerspectiveCamera, private input: Input, private ui: UI, private detail: number, private show: (s: THREE.Scene | null) => void) {}

  enter(id: CrewId, location: string, done: () => void) {
    const stage = make(location, t);
    this.stage = stage; this.who = id; this.onDone = done; this.location = location; this.done.clear(); this.busy = false;
    const p = new Player({ height: (x, z) => stage.height(x, z) }, { collide: (v, r) => stage.collide(v, r), blocks: () => false, clearance: () => 1 }, this.camera, this.detail, id);
    p.physics = { gravity: stage.gravity, jump: stage.jump, gaps: true };
    stage.scene.add(p.model.root);
    p.spawn(stage.spawn.x, stage.spawn.z, 0);
    this.player = p; this.active = true;
    this.show(stage.scene);
    this.ui.setPrompt(null);
    // why they are alive at all, in their own words, the moment you arrive
    window.setTimeout(() => { if (this.who === id) this.ui.say(`away.${location}.intro`, `crew.${id}.name`, 6); }, 900);
  }

  private open(k: AwayTask) { return !this.done.has(k.id) && (k.need ?? []).every((n) => this.done.has(n)); }

  /** The next thing to do: what the quest line and marker point at. */
  get next() { return this.stage?.tasks.find((k) => this.open(k)) ?? null; }
  get position() { return this.player?.pos ?? null; }

  /** Test hook: stand beside a task. */
  teleport(x: number, z: number) { this.player?.spawn(x, z, 0); }

  /** The level the HUD returns to. */
  level = 1;
  private location = '';

  update(dt: number, time: number, canMove: boolean) {
    const s = this.stage, p = this.player;
    if (!s || !p) return;
    this.ui.setStageObjective(t(`away.${this.location}.place`), this.next?.label ?? null);
    p.update(dt, this.input, canMove && !this.busy, 100, 1);
    s.update(dt, time);
    // falling off the ice costs nothing but the walk back
    if (p.pos.y < -30) { p.spawn(s.spawn.x, s.spawn.z, 0); this.ui.toast(t('away.fell')); }
    const near = s.tasks.filter((k) => this.open(k) && Math.hypot(k.pos.x - p.pos.x, k.pos.z - p.pos.z) < k.radius && Math.abs(k.pos.y - p.pos.y) < 3)[0];
    this.ui.setPrompt(near && !this.busy ? near.label : null);
    if (near && !this.busy && canMove && this.input.act('interact')) this.finish(near);
  }

  private finish(k: AwayTask) {
    this.busy = true;
    k.run?.();
    const go = () => {
      this.done.add(k.id); this.busy = false;
      if (this.stage!.tasks.every((x) => this.done.has(x.id))) this.leave();
    };
    if (this.onTask) this.onTask(k.id, go); else go();
  }

  leave() {
    const s = this.stage;
    if (s && this.player) s.scene.remove(this.player.model.root);
    s?.dispose?.();
    this.stage = null; this.player = null; this.active = false; this.who = null;
    this.ui.setPrompt(null);
    this.show(null);
    // the press that finished the last task belongs to this stage, not to whoever stands near Zenvik
    this.input.endFrame();
    this.input.capture = null;
    this.quiet = 0.6;
    const d = this.onDone; this.onDone = null; d?.();
  }
}
