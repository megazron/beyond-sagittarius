import type { CrewSkins } from '../../characters/custom';
import * as THREE from 'three';
import { Player } from '../player';
import type { CrewId } from '../../characters/character';
import type { Input } from '../input';
import type { UI } from '../../ui/ui';
import { t } from '../../i18n';
import { audio } from '../../core/audio';
import type { AwayStage, AwayTask } from './stage';
import { buildStage, STAGES } from './kit';
import { disposeTree } from '../../core/disposeTree';
import { buildCity } from './city';
import type { TaskKind } from '../../characters/character';
import { Arrival } from '../arrival';
import { ARRIVALS } from '../arrivals';
import { Injuries, FIRST_AID } from '../injury';

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
  /** A stage built ahead (under a title card), so arriving is not a long freeze. */
  private prepared: { loc: string; stage: ReturnType<typeof make> } | null = null;
  prepare(location: string) {
    if (this.prepared?.loc !== location) { if (this.prepared) dropStage(this.prepared.stage); this.prepared = { loc: location, stage: make(location, t, 0, this.detail) }; }
    return this.prepared.stage;
  }

  /** The first time someone is played on their own world, their arrival plays first (game/arrival.ts). */
  arrival: Arrival | null = null;
  /** Their wounds on this stage (game/injury.ts); saved into `wounds` when they leave. */
  injuries: Injuries | null = null;
  /** The save's wounds (game.ts hands its own record in). */
  wounds: Record<string, number> = {};
  /** Main letterboxes the arrival and shows its Skip. */
  onIntro: ((on: boolean) => void) | null = null;
  private stamina = 100;
  private breathAt = 0;
  private lope = 0;

  enter(id: CrewId, location: string, done: () => void, job = 0, arrive = false) {
    const pre = this.prepared;
    this.prepared = null;
    const stage = pre && pre.loc === location && !job ? pre.stage : make(location, t, job, this.detail);
    if (pre && pre.stage !== stage) dropStage(pre.stage); // built ahead for another place (or for their story, not a job): freed, not left behind
    this.pace = 1;
    this.stage = stage; this.who = id; this.onDone = done; this.location = location; this.done.clear(); this.busy = false; this.seen.clear(); this.vista = null;
    // the body you play is drawn with its full build, phones too (see PLAYER_DETAIL in main.ts)
    const p = new Player({ height: (x, z) => stage.height(x, z) }, { collide: (v, r) => stage.collide(v, r), blocks: () => false, clearance: (fx, fz, cx, cz) => stage.clearance?.(fx, fz, cx, cz) ?? 1, ceiling: stage.ceiling ? (fx, fz, fy, cx, cz) => stage.ceiling!(fx, fz, fy, cx, cz) : undefined, keepOff: stage.keepOff ? (v) => stage.keepOff!(v) : undefined }, this.camera, Math.max(this.detail, 0.8), id, id === 'strong' && this.skins.strong === 'suit' ? 'suit' : undefined); // the crew's chosen skin, on their own stage too
    p.physics = { gravity: stage.gravity, jump: stage.jump, gaps: true };
    p.model.mergeParts(); // skin, clothes and eyes in one draw (bodymerge.ts)
    // the camera comes in a little closer in a thick crowd (?crowdcam=0 turns it off, ?crowdcam=rise: it rises and looks
    // down on the heads, the old way). It was off for a while because CI's perf_gate saw
    // the phone bazaar at 836k triangles with it; the same 836430 hit a branch without it, so that was the city's state
    if (stage.crowdNear && new URLSearchParams(window.location.search).get('crowdcam') !== '0') p.crowdNear = () => stage.crowdNear!();
    p.crowdRise = new URLSearchParams(window.location.search).get('crowdcam') === 'rise';
    // what the feet hear: Zenvora's paving and the flat's floorboards, ice on the ring, rock and metal elsewhere
    p.surface = location === 'city' ? (x, z) => (x > 9.4 && z > 61 && z < 77 ? 'wood' : 'stone') : location === 'ring' ? () => 'snow' : location === 'clouds' ? () => 'wood' : location === 'wreck' ? () => 'metal' : () => 'stone';
    p.model.castAll(); // casts where a body does: not in the phones' city (CHAR_BUDGET.shadowFar 0 there)
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
    this.stamina = 100;
    this.injuries = location === 'city' ? null : new Injuries(id, this.wounds);
    // why they are alive at all, in their own words, the moment you arrive (after the arrival, when there is one)
    // (not after Skyvra's arrival: her line is about two days on the rock, and you have just seen her land)
    const intro = () => { if (!job && !(arrive && location === 'ring')) window.setTimeout(() => { if (this.who === id) this.ui.say(`away.${location}.intro`, `crew.${id}.name`, 6); }, 900); };
    const def = arrive && location !== 'city' ? ARRIVALS[id] : undefined;
    if (def) {
      this.input.enabled = false;
      this.onIntro?.(true);
      this.arrival = new Arrival(id, { scene: stage.scene, camera: this.camera, body: p.model, ground: (x, z) => stage.height(x, z), say: (k, sp, sec) => this.ui.say(k, sp, sec) }, () => {
        // control from where the body got up, facing the way it faced
        const last = def.body[def.body.length - 1], Y = def.yaw, [sx, sz] = def.spot, f = last.at;
        const x = sx + Math.cos(Y) * f[0] - Math.sin(Y) * f[2], z = sz - Math.sin(Y) * f[0] - Math.cos(Y) * f[2];
        p.spawn(x, z, Y);
        this.arrival = null; this.input.enabled = true; this.onIntro?.(false);
        intro();
      });
    } else intro();
    this.entered?.();
  }
  get arrivalOn() { return !!this.arrival?.active; }

  /** Breath on their world: what sprinting costs and what gives it back (LANDINGS.md, "Gravity, air and pace"). */
  private air(dt: number, p: Player) {
    const R: Record<string, [number, number, boolean]> = { ring: [10, 10, false], moon: [22, 9, true], wreck: [16, 5, true], scree: [20, 8, true], clouds: [18, 6, true] };
    const r = R[this.location]; if (!r) { this.stamina = 100; return; }
    this.stamina = p.sprinting ? Math.max(0, this.stamina - dt * r[0]) : Math.min(100, this.stamina + dt * r[1]);
    // a body out of breath is heard: but Skyvra holds hers, and there is no air to hear it in
    if (r[2] && this.stamina < 35 && (this.breathAt -= dt) <= 0) { this.breathAt = 1.8 + Math.random(); audio.humanInner('breath', 0.35 + (35 - this.stamina) / 100); }
  }
  /** Called at the end of enter() (tools/perf_gate.py holds the clock from this moment: main.ts holdAtArrival). */
  entered: (() => void) | null = null;
  /** What the stage is still loading (an empty list once everything it builds is in). */
  get pending() { return this.stage?.pending?.() ?? []; }

  private open(k: AwayTask) { return (k.repeat || !this.done.has(k.id)) && (k.need ?? []).every((n) => this.done.has(n)); }

  /** The next thing to do: what the quest line and marker point at. */
  get next() { return this.stage?.tasks.find((k) => !k.optional && this.open(k)) ?? null; }
  get position() { return this.player?.pos ?? null; }
  get grounded() { return !!this.player?.onGround; }
  /** Test hook: the camera's aim and any hero view in progress. */
  get camState() { const p = this.player, c = this.camera.position; return p ? { yaw: p.yaw, pitch: p.pitch, x: p.pos.x, y: p.pos.y, z: p.pos.z, cam: [c.x, c.y, c.z], vista: this.vista, seen: [...this.seen] } : null; }

  /** The skins chosen in the skins menu (set by main whenever they change). */
  skins: CrewSkins = {};

  /** Test hook (recording clips): the camera circles a point instead of following the player. */
  orbit: { x: number; y: number; z: number; r: number; a: number; h: number } | null = null;
  /** A held shot over the play camera for a few seconds (a story's moment on someone's stage: Episode Three's copier). */
  cut: { from: THREE.Vector3; to: THREE.Vector3; t: number; fov?: number; fov0?: number } | null = null;
  /** The story poses the body for a moment (set it to null to give it back): called after each frame's own update. */
  pose: ((model: Player['model'], dt: number) => void) | null = null;
  /** Where the body stands (the story's scripted moments start from it). */
  get bodyAt() { return this.player?.pos.clone() ?? null; }

  /** Test hook: stand beside a task. */
  teleport(x: number, z: number, yaw = 0) { if (!this.arrival?.active) this.player?.spawn(x, z, yaw); }

  /** The level the HUD returns to. */
  level = 1;
  private location = '';
  /** Which stage is playing (the soundscape picks its music and beds by it). */
  get where() { return this.active ? this.location : null; }
  /** In the friends' flat in Zenvora: behind the street wall on the east side, between its two party walls. */
  get indoors() { const p = this.player?.pos; return this.location === 'city' && !!p && p.x > 9.4 && p.z > 61 && p.z < 77; }

  update(dt: number, time: number, canMove: boolean) {
    const s = this.stage, p = this.player;
    if (!s || !p) return;
    if (s.outro?.active) {
      this.ui.setPrompt(null); s.update(dt, time, this.camera);
      if (s.outro.active && s.outro.remaining < 0.9 && !this.outroFade) { this.outroFade = true; this.ui.fade('black', 1, 0.8); } // it ends in black
      return;
    }
    if (this.arrival?.active) {
      // the arrival poses the body and holds the camera; the stage lives on round it
      this.ui.setPrompt(null);
      p.skipAnimate = true; p.update(dt, this.input, false, 100, 1); p.skipAnimate = false;
      this.arrival.update(dt);
      s.update(dt, time, this.camera);
      return;
    }
    this.ui.setStageObjective(t(`away.${this.location}.place`), this.next?.label ?? null);
    const inj = this.injuries, eff = inj?.effects();
    p.hurt = eff ? { speed: eff.speed, jump: eff.jump, sprint: eff.sprint } : null;
    if (eff) { p.model.setLimp(eff.limp); p.model.setLimbs(this.busy ? null : eff.limbs); }
    this.air(dt, p);
    p.update(dt, this.input, canMove && !this.busy, this.stamina, this.pace);
    // a scripted moment holds the body itself (a climb, a fall): after the player's own update, every frame
    if (this.pose) { p.skipAnimate = true; this.pose(p.model, dt); p.model.root.updateMatrixWorld(true); } else p.skipAnimate = false;
    inj?.update(dt, dt / 50, { resting: p.speedNow < 0.2 });
    // low gravity: every step leaves the ground for a moment and comes down slowly (a lope, the way Apollo crews moved);
    // on Verdaxis' 14 there is none
    if (p.onGround && p.speedNow > 0.4 && s.gravity < 6) {
      this.lope += p.speedNow * dt / (1.1 + 2.4 * (1 - s.gravity / 14));
      p.model.root.position.y += Math.abs(Math.sin(this.lope * Math.PI)) * 0.09 * (1 - s.gravity / 14) * Math.min(1, p.speedNow / 2.5);
    }
    // a hero view: the camera turns to it once, eases back, and the player can always look away; one with `after` waits
    // until that task is done (the square's fired on the walk past the tram, before you had held its door)
    const v = s.vistas?.find((b, i) => !this.seen.has(i) && (!b.after || this.done.has(b.after)) && p.pos.x > b.x0 && p.pos.x < b.x1 && p.pos.z > b.z0 && p.pos.z < b.z1);
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
    if (this.cut) {
      const c = this.cut, cam = this.camera as THREE.PerspectiveCamera;
      if (c.fov && c.fov0 === undefined) { c.fov0 = cam.fov; cam.fov = c.fov; cam.updateProjectionMatrix(); }
      cam.position.copy(c.from); cam.lookAt(c.to);
      if ((c.t -= dt) <= 0) { if (c.fov0 !== undefined) { cam.fov = c.fov0; cam.updateProjectionMatrix(); } this.cut = null; }
    }
    s.update(dt, time, this.camera);
    this.crowdSteps(dt);
    // falling off the ice costs nothing but the walk back
    if (p.pos.y < -30) { p.spawn(s.spawn.x, s.spawn.z, 0); this.ui.toast(t('away.fell')); }
    // the nearest one, not the first in the list: beside Mir, E talks to Mir even with a friend a step further off
    const dist = (k: { pos: THREE.Vector3 }) => Math.hypot(k.pos.x - p.pos.x, k.pos.z - p.pos.z);
    const near = s.tasks.filter((k) => this.open(k) && dist(k) < k.radius && Math.abs(k.pos.y - p.pos.y) < 3).sort((x, y) => dist(x) - dist(y))[0];
    this.ui.setPrompt(near && !this.busy ? near.label : null);
    if (near && !this.busy && canMove && this.input.act('interact')) this.finish(near);
  }

  private stepAcc = new Map<object, number>();
  /** Passers-by near the camera are heard walking: their own steps, placed where they are. */
  private crowdSteps(dt: number) {
    const people = (this.stage as { people?: { pos: THREE.Vector3; walk?: { speed: number }; fig: { root: THREE.Object3D } }[] } | null)?.people;
    if (!people || this.location !== 'city') return;
    const c = this.camera.position;
    for (const q of people) {
      if (!q.walk || !q.fig.root.visible) continue;
      const d = Math.hypot(q.pos.x - c.x, q.pos.z - c.z);
      if (d > 10) { this.stepAcc.delete(q); continue; }
      const acc = (this.stepAcc.get(q) ?? Math.random()) + q.walk.speed * dt, stride = 0.6 + 0.22 * q.walk.speed;
      if (acc >= stride) { audio.step('stone', 0.22, { x: q.pos.x, y: q.pos.y + 0.05, z: q.pos.z }); this.stepAcc.set(q, acc - stride); } else this.stepAcc.set(q, acc);
    }
  }

  private finish(k: AwayTask) {
    this.busy = true;
    // the hands do the job: eat, pack, take the phone, open the locker, drink the chai, hold the tram door...
    const base = k.id.startsWith('talk.') ? 'talk' : k.id.replace(/[_\-.]?\d+$/, '');
    const job: Record<string, TaskKind> = { paratha: 'eat', pack: 'carry', phone: 'phone', parcel: 'open', chai: 'drink', tram: 'open', ring: 'pickup',
      splint: 'fix', shoulder: 'use', bind: 'fix', strap: 'fix', ribs: 'use', ice: 'fix', cracker: 'use', dish: 'use', plate: 'pickup', weld: 'fix', lichen: 'plant', suture: 'fix', burst: 'use', break: 'fix', ember: 'use', patch: 'fix', relay: 'use' };
    const kind = job[base];
    if (kind && this.player) {
      const at = kind === 'eat' || kind === 'carry' ? null : k.pos.clone().setY(Math.max(k.pos.y, this.player.pos.y) + (kind === 'open' ? 1.15 : kind === 'use' ? 0.95 : 0));
      this.player.act(kind, at);
      // and they are heard: a chew, a zip, a door, a locker
      const fx: Record<string, [string, number, number]> = { paratha: ['eat', 0.55, 0.6], pack: ['zip', 0.5, 0.4], phone: ['type', 0.35, 0.3], parcel: ['door_open', 0.45, 0.3], chai: ['drink', 0.5, 0.6], tram: ['hatch_close', 0.4, 0.5], ring: ['splash', 0.3, 0.3], weld: ['field', 0.4, 0.2], ice: ['stone', 0.5, 0.3], break: ['stone', 0.6, 0.3], plate: ['metal', 0.45, 0.4], patch: ['cloth', 0.45, 0.3] };
      const f = fx[base]; if (f) audio.sample(f[0], f[1], { delay: f[2] });
    }
    k.run?.();
    // first aid on their own body: it hurts, and then it is better
    const aid = FIRST_AID[k.id];
    if (aid && aid.who === this.who && this.injuries) { this.injuries.treat(aid.part); audio.humanInner('grunt', 0.55, aid.who === 'strong' || aid.who === 'builder' ? 0.85 : 1.15); }
    const go = () => {
      this.done.add(k.id); this.busy = false;
      if (this.stage!.tasks.every((x) => x.optional || this.done.has(x.id))) this.closing();
    };
    if (this.onTask) this.onTask(k.id, go); else go();
  }

  /** A person on the stage answers the player: they face the player and talk for as long as the line lasts. */
  talk(id: string, seconds: number) {
    if (this.stage && this.player) this.stage.talk?.(id, seconds, this.player.model.root.position);
  }

  /** Every task done: the stage's closing scene if it has one (letterboxed, skippable), then away. */
  private closing() {
    const s = this.stage;
    if (!s?.outro || !this.player) { this.leave(); return; }
    this.busy = true; this.outroFade = false;
    this.input.enabled = false;
    // the closing scene opens on a new place: a short dip through black, never a jump cut out of play
    this.ui.fade('black', 1, 0.35);
    setTimeout(() => {
      if (this.stage !== s || !this.player) return;
      this.onOutro?.(true);
      // whoever takes over after it fades in on their own (the prologue keeps the black for the orbit card)
      s.outro!.start(this.player.model, () => { this.onOutro?.(false); this.input.enabled = true; this.busy = false; if (!this.keepBlack) this.ui.fade('black', 0, 0.6); this.leave(); });
      this.ui.fade('black', 0, 0.7);
    }, 400);
  }
  /** Main shows the letterbox and the Skip button while a closing scene plays. */
  onOutro: ((on: boolean) => void) | null = null;
  private outroFade = false;
  get outroOn() { return !!this.stage?.outro?.active || !!this.arrival?.active; }
  /** The prologue keeps the black after the closing scene: the orbit card comes next, not this world. */
  keepBlack = false;
  /** Skip: a quick fade to black first, so the cut never shows the world behind the stage. */
  skipOutro() {
    if (this.arrival?.active) {
      if (this.skipping) return;
      this.skipping = true; this.ui.fade('black', 1, 0.25);
      setTimeout(() => { this.skipping = false; this.arrival?.skip(); this.ui.fade('black', 0, 0.5); }, 280);
      return;
    }
    const o = this.stage?.outro;
    if (!o?.active || this.skipping) return;
    this.skipping = true; this.outroFade = true;
    this.ui.fade('black', 1, 0.3);
    setTimeout(() => { this.skipping = false; o.skip(); }, 340);
  }
  private skipping = false;
  /** Test hook (cutscene_qa, recordings): every task done at once, so the closing scene plays now. */
  debugOutro() { if (this.stage) { for (const k of this.stage.tasks) if (!k.optional) this.done.add(k.id); this.closing(); } }

  leave() {
    this.pose = null;
    if (this.arrival?.active) this.arrival.skip();
    if (this.injuries) { this.injuries.write(this.wounds); this.injuries.quiet(); this.injuries = null; }
    const s = this.stage;
    if (s && this.player) { s.scene.remove(this.player.model.root); disposeTree(this.player.model.root); }
    if (s) dropStage(s);
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

/** A stage's own teardown, then everything its scene still holds on the GPU (only the city had a teardown, and it
 *  freed only its geometries: every visit to a place left the last one behind). */
function dropStage(s: { scene: THREE.Scene; dispose?: () => void }) {
  s.dispose?.();
  disposeTree(s.scene);
}
