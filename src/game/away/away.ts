import * as THREE from 'three';
import { Player } from '../player';
import type { CrewId } from '../../characters/character';
import type { Input } from '../input';
import type { UI } from '../../ui/ui';
import { t } from '../../i18n';
import type { AwayStage, AwayTask } from './stage';
import { buildStage, STAGES } from './kit';

const make = (loc: string, label: (k: string) => string, job: number) => buildStage(loc, STAGES[loc], label, job);

/** Playing someone else, somewhere else: their stage, their tasks, the same controls on every device. */
export class Away {
  active = false;
  who: CrewId | null = null;
  stage: ReturnType<typeof buildStage> | null = null;
  done = new Set<string>();
  private player: Player | null = null;
  private onDone: (() => void) | null = null;
  /** Runs a task's story beat (a quick-time, a line). Call `go` when it is over. */
  onTask: ((id: string, go: () => void) => void) | null = null;
  private busy = false;
  /** Movement scale the stage sets: Lyrra is slow in the dark. */
  private pace = 1;
  /** Seconds after coming back during which interact is ignored. */
  quiet = 0;

  constructor(private camera: THREE.PerspectiveCamera, private input: Input, private ui: UI, private detail: number, private show: (s: THREE.Scene | null) => void) {}

  /** `job`: 0 for their story, a level number for that level's work. */
  enter(id: CrewId, location: string, done: () => void, job = 0) {
    const stage = make(location, t, job);
    this.pace = 1;
    this.stage = stage; this.who = id; this.onDone = done; this.location = location; this.done.clear(); this.busy = false;
    const p = new Player({ height: (x, z) => stage.height(x, z) }, { collide: (v, r) => stage.collide(v, r), blocks: () => false, clearance: () => 1 }, this.camera, this.detail, id);
    p.physics = { gravity: stage.gravity, jump: stage.jump, gaps: true };
    p.model.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; } });
    // the lineage, in play: the stage lights their marks and sets their pace
    stage.bind({
      root: p.model.root,
      glow: (k) => p.model.root.traverse((o) => { const u = ((o as THREE.Mesh).material as THREE.Material | undefined)?.userData?.u; if (u?.uGlowK) u.uGlowK.value = k; }),
      slow: (k) => { this.pace = k; },
    });
    stage.scene.add(p.model.root);
    p.spawn(stage.spawn.x, stage.spawn.z, 0);
    this.player = p; this.active = true;
    this.show(stage.scene);
    this.ui.setPrompt(null);
    // why they are alive at all, in their own words, the moment you arrive
    if (!job) window.setTimeout(() => { if (this.who === id) this.ui.say(`away.${location}.intro`, `crew.${id}.name`, 6); }, 900);
  }

  private open(k: AwayTask) { return !this.done.has(k.id) && (k.need ?? []).every((n) => this.done.has(n)); }

  /** The next thing to do: what the quest line and marker point at. */
  get next() { return this.stage?.tasks.find((k) => this.open(k)) ?? null; }
  get position() { return this.player?.pos ?? null; }
  get grounded() { return !!this.player?.onGround; }

  /** Test hook: stand beside a task. */
  teleport(x: number, z: number) { this.player?.spawn(x, z, 0); }

  /** The level the HUD returns to. */
  level = 1;
  private location = '';

  update(dt: number, time: number, canMove: boolean) {
    const s = this.stage, p = this.player;
    if (!s || !p) return;
    this.ui.setStageObjective(t(`away.${this.location}.place`), this.next?.label ?? null);
    p.update(dt, this.input, canMove && !this.busy, 100, this.pace);
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
