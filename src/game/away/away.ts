import type { CrewSkins } from '../../characters/custom';
import * as THREE from 'three';
import { Player } from '../player';
import type { CrewId } from '../../characters/character';
import type { Input } from '../input';
import type { UI } from '../../ui/ui';
import { t } from '../../i18n';
import type { AwayStage, AwayTask } from './stage';
import { buildStage, STAGES } from './kit';
import { buildCity } from './city';

const make = (loc: string, label: (k: string) => string, job: number, detail: number) => (loc === 'city' ? buildCity(label, detail) : buildStage(loc, STAGES[loc], label, job, detail));

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
  private seen = new Set<number>();
  private vista: { yaw: number; pitch: number; t: number } | null = null;
  private settle = 0;

  constructor(private camera: THREE.PerspectiveCamera, private input: Input, private ui: UI, private detail: number, private show: (s: THREE.Scene | null) => void) {}

  /** `job`: 0 for their story, a level number for that level's work. */
  enter(id: CrewId, location: string, done: () => void, job = 0) {
    const stage = make(location, t, job, this.detail);
    this.pace = 1;
    this.stage = stage; this.who = id; this.onDone = done; this.location = location; this.done.clear(); this.busy = false; this.seen.clear(); this.vista = null;
    const p = new Player({ height: (x, z) => stage.height(x, z) }, { collide: (v, r) => stage.collide(v, r), blocks: () => false, clearance: (fx, fz, cx, cz) => stage.clearance?.(fx, fz, cx, cz) ?? 1 }, this.camera, this.detail, id, id === 'strong' && this.skins.strong === 'suit' ? 'suit' : undefined); // the crew's chosen skin, on their own stage too
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

  private open(k: AwayTask) { return (k.repeat || !this.done.has(k.id)) && (k.need ?? []).every((n) => this.done.has(n)); }

  /** The next thing to do: what the quest line and marker point at. */
  get next() { return this.stage?.tasks.find((k) => !k.optional && this.open(k)) ?? null; }
  get position() { return this.player?.pos ?? null; }
  get grounded() { return !!this.player?.onGround; }
  /** Test hook: the camera's aim and any hero view in progress. */
  get camState() { const p = this.player; return p ? { yaw: p.yaw, pitch: p.pitch, x: p.pos.x, z: p.pos.z, vista: this.vista, seen: [...this.seen] } : null; }

  /** The skins chosen in the skins menu (set by main whenever they change). */
  skins: CrewSkins = {};

  /** Test hook (recording clips): the camera circles a point instead of following the player. */
  orbit: { x: number; y: number; z: number; r: number; a: number; h: number } | null = null;

  /** Test hook: stand beside a task. */
  teleport(x: number, z: number, yaw = 0) { this.player?.spawn(x, z, yaw); }

  /** The level the HUD returns to. */
  level = 1;
  private location = '';

  update(dt: number, time: number, canMove: boolean) {
    const s = this.stage, p = this.player;
    if (!s || !p) return;
    this.ui.setStageObjective(t(`away.${this.location}.place`), this.next?.label ?? null);
    p.update(dt, this.input, canMove && !this.busy, 100, this.pace);
    // a hero view: the camera turns to it once, eases back, and the player can always look away
    const v = s.vistas?.find((b, i) => !this.seen.has(i) && p.pos.x > b.x0 && p.pos.x < b.x1 && p.pos.z > b.z0 && p.pos.z < b.z1);
    if (v) { this.seen.add(s.vistas!.indexOf(v)); this.vista = { ...v, t: v.secs }; }
    if (this.vista) {
      const k = 1 - Math.exp(-Math.min(dt, 0.25) * 4), V = this.vista;
      p.yaw += Math.atan2(Math.sin(V.yaw - p.yaw), Math.cos(V.yaw - p.yaw)) * k; p.pitch += (V.pitch - p.pitch) * k;
      if ((V.t -= dt) <= 0 || this.input.lookDX || this.input.lookDY) { this.vista = null; this.settle = this.input.lookDX || this.input.lookDY ? 0 : 1.5; }
    } else if (this.settle > 0) { // then back to the usual eye line
      this.settle -= dt; p.pitch += (-0.18 - p.pitch) * (1 - Math.exp(-Math.min(dt, 0.25) * 3));
      if (this.input.lookDX || this.input.lookDY) this.settle = 0;
      else if (this.settle <= 0) p.pitch = -0.18; // whatever the frame rate, it ends at the usual eye line
    }
    if (this.orbit) { const o = this.orbit; this.camera.position.set(o.x + Math.sin(o.a) * o.r, o.y + o.h, o.z + Math.cos(o.a) * o.r); this.camera.lookAt(o.x, o.y + o.h * 0.55, o.z); }
    s.update(dt, time, this.camera);
    // falling off the ice costs nothing but the walk back
    if (p.pos.y < -30) { p.spawn(s.spawn.x, s.spawn.z, 0); this.ui.toast(t('away.fell')); }
    // the nearest one, not the first in the list: beside Mir, E talks to Mir even with a friend a step further off
    const dist = (k: { pos: THREE.Vector3 }) => Math.hypot(k.pos.x - p.pos.x, k.pos.z - p.pos.z);
    const near = s.tasks.filter((k) => this.open(k) && dist(k) < k.radius && Math.abs(k.pos.y - p.pos.y) < 3).sort((x, y) => dist(x) - dist(y))[0];
    this.ui.setPrompt(near && !this.busy ? near.label : null);
    if (near && !this.busy && canMove && this.input.act('interact')) this.finish(near);
  }

  private finish(k: AwayTask) {
    this.busy = true;
    k.run?.();
    const go = () => {
      this.done.add(k.id); this.busy = false;
      if (this.stage!.tasks.every((x) => x.optional || this.done.has(x.id))) this.leave();
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
