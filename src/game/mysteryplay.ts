import * as THREE from 'three';
import { t } from '../i18n';
import { audio } from '../core/audio';
import { cover, type Beat, type Shot, type Who } from '../cinematic/cutscene';
import type { Character, CrewPose } from '../characters/character';
import type { SaveData } from '../core/save';
import type { Action } from './story';
import { LAKE } from '../world/heightfield';
import { buildGlint, buildProp } from '../world/finds';
import { MYSTERY, mysteryLoaded, type MyBeat, type MyFind } from './branch/mystery';
import { findsOpen, hookBeats, hookFor, hookPlayed, pickFind } from './mystery';

/**
 * Plays the short beat at the end of each level (and the one after the wake), and keeps the small things off the path in
 * the world. Order at a level's end: banner and save, the Vault or a memory if the level has one, then this beat, then
 * the next person's story if one is due, then the next level's first scene. While a beat is due the game holds the
 * episodes' scenes and the roster (`holding`), and the next level's own start (`queue(n, then)`).
 * A beat is due only for a level completed in this session; on a later Continue its entry is on the board, unplayed.
 */
export interface MysteryHost {
  world: { scene: THREE.Scene; layout: { camp: THREE.Vector3; ridge: THREE.Vector3 }; terrain: { height(x: number, z: number): number }; forest: { blocks(x: number, z: number, r: number, y?: number): boolean } };
  player: { pos: THREE.Vector3; model: Character; yaw?: number };
  ui: { toast(s: string): void; say(key: string, who: string | undefined, sec?: number): void; modalOpen(): boolean; deviceLines(lines: string[] | null, small?: boolean): void };
  save: SaveData;
  mode: string;
  playScene(beats: Beat[], then?: () => void): void;
  persist(): void;
  actorsNow(): Record<string, Character>;
  storyBusy(): boolean;
  fighting(): boolean;
}

const VAULT_LEVELS = [3, 5, 7, 10, 14, 21];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class MysteryPlay {
  private due: { n: number; wait: number; age: number; then?: () => void; force?: boolean } | null = null;
  private props = new THREE.Group();
  private placed: Record<string, THREE.Group> = {};
  private finds: Record<string, { g: THREE.Group; glint: THREE.Sprite; f: MyFind }> = {};
  private wakeFrom: THREE.Vector3 | null = null;
  private findsKey = '';
  /** Set by main.ts: something outside the game holds the beat (the Vault or a memory still to come, a pause, the title). */
  blocked: (n: number) => boolean = () => false;
  playing = false;

  constructor(private h: MysteryHost) { this.props.name = 'mystery'; }

  /** A beat is due for the level just completed: the next level's first scene and the roster wait for it. */
  get holding() { return !!this.due || this.playing; }

  /** Level n is complete (game.checkLevel): queue its beat; `then` (the next level's start) runs after it. */
  queue(n: number, then?: () => void): boolean {
    const s = this.h.save;
    if (!mysteryLoaded() || !hookFor(n, s)) return false;
    this.due = { n, wait: 5.6, age: 0, then };
    return true;
  }
  /** Cheat checkpoints and tests: play level n's beat now, whether or not it has played. */
  force(n: number) { if (n === 19) { console.warn('level 19 closes on its own stage: play the wall to its end'); delete this.h.save.flags['hook-19']; return; } delete this.h.save.flags[`hook-${n}`]; this.due = { n, wait: 1.5, age: 0, force: true }; }

  update(dt: number) {
    const s = this.h.save;
    if (!s || !mysteryLoaded()) return;
    this.syncFinds();
    this.tickGlints(dt);
    // after the wake: on his first steps once he has control and the first prompts are done
    if (!this.due && !this.playing && !s.flags['hook-0'] && !s.replay && s.level === 1 && !s.completed.length && this.h.mode === 'play' && s.flags.tutorialDone) {
      const p = this.h.player.pos;
      this.wakeFrom ??= p.clone();
      if (p.distanceTo(this.wakeFrom) > 2.5) this.due = { n: 0, wait: 0.8, age: 0 };
    }
    const d = this.due;
    if (!d || this.playing) return;
    d.age += dt;
    const free = this.h.mode === 'play' && !this.h.ui.modalOpen() && !this.h.storyBusy() && !this.h.fighting() && !this.blocked(d.n);
    if (!free) {
      // the Vault and a memory are waited for however long; anything else that never lets go gives up the beat (its entry
      // stays on the board) rather than hold the story
      if (d.age > 75 && !(VAULT_LEVELS.includes(d.n) && this.blocked(d.n))) this.drop();
      d.wait = Math.max(d.wait, 1.2);
      return;
    }
    d.wait -= dt;
    if (d.wait <= 0) this.play(d.n);
  }

  private drop() {
    const d = this.due!; this.due = null;
    if (!d.force) hookPlayed(d.n, this.h.save);
    this.h.persist();
    d.then?.();
  }

  private play(n: number) {
    const s = this.h.save, hook = MYSTERY?.hooks.find((x) => x.level === n);
    const d = this.due!;
    if (!hook) { this.drop(); return; }
    this.playing = true; this.lastProp = undefined;
    // empty hands for the beat: a carried spear crossed every close-up of his face (GPU take r1)
    const held = this.h.player.model.handR.children.filter((c) => c.visible); held.forEach((c) => { c.visible = false; });
    const beats = hookBeats(hook, s).map((b) => this.beat(b));
    // marked as it starts: a skip, a quit or a reload never brings it back
    hookPlayed(n, s); this.h.persist();
    this.h.playScene(beats, () => {
      this.playing = false; this.due = null;
      held.forEach((c) => { c.visible = true; });
      this.cleanup();
      document.body.classList.remove('my-dream');
      const clue = MYSTERY?.clues.find((c) => 'hook' in c.from && c.from.hook === n);
      if (clue) window.setTimeout(() => this.h.ui.toast(n === 0 ? t('my.ui.ledger') : t('my.ui.found', { t: t(clue.title) })), 600);
      d.then?.();
    });
  }

  // ------------------------------------------------------------------ shots and props
  private fwd() { const m = this.h.player.model.root; return V(Math.sin(m.rotation.y), 0, Math.cos(m.rotation.y)); }
  private head() { return this.h.player.model.root.position.clone().add(V(0, 1.6, 0)); }
  private ground(x: number, z: number) { return V(x, this.h.world.terrain.height(x, z), z); }
  /** A spot on open ground near p (not inside a trunk). */
  private open(p: THREE.Vector3) {
    const F = this.h.world.forest;
    for (let r = 0; r < 6; r += 0.5) for (let a = 0; a < 6.28; a += 0.8) { const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r; if (!F.blocks(x, z, 0.6)) return this.ground(x, z); if (r === 0) break; }
    return this.ground(p.x, p.z);
  }

  private place(kind: string): THREE.Group {
    if (this.placed[kind]) return this.placed[kind];
    const g = buildProp(kind), p = this.h.player.model.root.position, f = this.fwd(), r = V(f.z, 0, -f.x);
    const at = (v: THREE.Vector3) => { g.position.copy(v); };
    switch (kind) {
      case 'tallform': {
        const c = V(LAKE.x, 0, LAKE.z), d = c.clone().sub(p).setY(0), far = d.length() < 160;
        at(far ? this.open(c.clone().addScaledVector(d.normalize(), LAKE.r + 4)) : this.open(p.clone().addScaledVector(f, 45)));
        g.lookAt(p.x, g.position.y, p.z);
        break;
      }
      case 'glowpoint': { const R = this.h.world.layout.ridge; at(R.clone().add(V(0, 4, 0))); break; }
      case 'glowfield': {
        const c = V(LAKE.x, 0, LAKE.z), d = c.clone().sub(p).setY(0).normalize(), side = V(d.z, 0, -d.x);
        g.children.forEach((o, i) => {
          if (i === 11) { const R = this.h.world.layout.ridge; o.position.copy(R).sub(V(0, 0, 0)).add(V(0, 5, 0)); return; }
          const q = p.clone().addScaledVector(d, 42 + (i % 3) * 7).addScaledVector(side, (i - 5) * 3.2);
          o.position.set(q.x, this.h.world.terrain.height(q.x, q.z) + 0.4, q.z);
        });
        break;
      }
      case 'dotrings': { const c = this.h.world.layout.camp; at(c.distanceTo(p) < 20 ? this.ground(c.x, c.z) : this.ground(p.x, p.z)); break; }
      case 'trunkmarks': at(this.open(p.clone().addScaledVector(f, 2.4).addScaledVector(r, 0.8))); g.lookAt(p.x, g.position.y, p.z); break;
      case 'skyform': at(p.clone().addScaledVector(f, 150).add(V(0, 75, 0))); g.lookAt(p.x, g.position.y, p.z); g.rotateY(Math.PI / 2); break;
      case 'groundline': at(this.ground(p.x + r.x * 3, p.z + r.z * 3)); g.lookAt(g.position.clone().add(f)); g.position.y -= 0.02; break;
      case 'rockmark': case 'bankcut': at(this.ground(p.x + f.x * 1.3, p.z + f.z * 1.3)); g.lookAt(p.x, g.position.y, p.z); break;
      case 'cardB': at(p.clone().addScaledVector(f, 0.32).add(V(0, 1.05, 0))); g.lookAt(this.head()); g.rotateX(-Math.PI / 2); break;
      default: at(this.ground(p.x + f.x * 1.0, p.z + f.z * 1.0)); g.rotation.y = Math.atan2(f.x, f.z);
    }
    if (!this.props.parent) this.h.world.scene.add(this.props);
    this.props.add(g); g.updateMatrixWorld(true);
    return (this.placed[kind] = g);
  }
  private cleanup() { for (const k in this.placed) { this.props.remove(this.placed[k]); } this.placed = {}; }
  private propAt(kind?: string) { const g = kind ? this.placed[kind] : Object.values(this.placed)[0]; return g ? g.getWorldPosition(V()) : null; }

  private shot(b: MyBeat, lastProp: string | undefined): Shot {
    const m = this.h.player.model, H = this.head(), f = this.fwd(), r = V(f.z, 0, -f.x), P = this.propAt(b.prop ?? lastProp);
    switch (b.shot) {
      case 'face2': return cover.close(m, -0.55, 1.05);
      case 'mid': return cover.mid(m);
      case 'hands': { const to = m.root.position.clone().addScaledVector(f, 0.32).add(V(0, 1.02, 0)); return { from: H.clone().addScaledVector(f, 0.85).addScaledVector(r, 0.35).add(V(0, -0.25, 0)), to, push: 0.05, fov: 40 }; }
      case 'sky': return { from: H.clone().addScaledVector(f, 1.3).add(V(0, -0.55, 0)), to: H.clone().addScaledVector(f, -3).add(V(0, 3.2, 0)), push: 0.04 };
      case 'over': case 'ridge': {
        const to = P ?? H.clone().addScaledVector(f, 30);
        const d = to.clone().sub(H).setY(0).normalize(), s = V(d.z, 0, -d.x);
        return { from: H.clone().addScaledVector(d, -1.15).addScaledVector(s, 0.42).add(V(0, 0.12, 0)), to, push: 0.03, fov: b.shot === 'ridge' ? 30 : 38 };
      }
      case 'insert': {
        if (!P) return cover.close(m);
        const d = H.clone().sub(P).setY(0).normalize(), big = b.prop === 'trunkmarks' || b.prop === 'rockmark' || b.prop === 'bankcut' || (lastProp === 'trunkmarks' && !b.prop);
        const to = P.clone().add(V(0, big ? (lastProp === 'trunkmarks' || b.prop === 'trunkmarks' ? 2.2 : 0.55) : 0.06, 0));
        return { from: to.clone().addScaledVector(d, big ? 1.5 : 0.62).add(V(0, big ? 0.15 : 0.42, 0)), to, push: 0.06, fov: big ? 42 : 34, lightAt: to, lightScale: 0.5 };
      }
      case 'top': { const c = m.root.position; return { from: c.clone().addScaledVector(f, -6).addScaledVector(r, 3).add(V(0, 8.5, 0)), to: c.clone().add(V(0, 0.4, 0)), push: 0.03, fov: 46 }; }
      case 'dream': { const to = P ?? H.clone().add(V(0, 60, 0)); return { from: H.clone().addScaledVector(f, -0.6).add(V(0, 0.2, 0)), to, push: 0.02, fov: 52 }; }
      case 'actor': {
        const a = b.on ? this.h.actorsNow()[b.on] : undefined;
        if (a && a.root.visible && a.root.position.distanceTo(m.root.position) < 25) return cover.close(a, 0.45, 1.2);
        return cover.close(m);
      }
      default: return cover.close(m);
    }
  }

  private lastProp: string | undefined;
  private beat(b: MyBeat): Beat {
    const out: Beat = {};
    if (b.key) { out.key = b.key; out.who = (b.who ?? 'scientist') as Who; }
    if (b.hold) out.hold = b.hold;
    if (b.after) out.after = b.after;
    if (b.pose) out.poses = { scientist: (b.pose === 'sleep' ? 'sit' : b.pose) as CrewPose };
    const prop = b.prop;
    out.run = () => {
      document.body.classList.toggle('my-dream', b.shot === 'dream');
      if (prop) this.place(prop);
      if (b.run === 'hideProp') { for (const k in this.placed) if (k === 'tallform') this.placed[k].visible = false; }
      if (b.run === 'cough') { audio.human('grunt', 0.5); window.setTimeout(() => audio.human('breath', 0.4), 500); }
      if (b.run === 'echo') window.setTimeout(() => audio.human('grunt', 0.16), 900);
      if (b.run === 'pulse') { let k = 0; const beat = () => { if (!this.playing || k++ > 5) { this.h.ui.deviceLines(null); return; } this.h.ui.deviceLines(['▁▁▂▅▂▁▁▁▁▁▂▅▂▁▁'.slice(k % 3), '. . .'], true); audio.beep(); window.setTimeout(beat, 1100); }; beat(); }
      if (prop === 'glowpoint' || prop === 'glowfield') this.blinkIn(prop);
    };
    const last = prop ?? this.lastProp;
    this.lastProp = last;
    out.shot = () => this.shot(b, last);
    return out;
  }
  /** A glow that comes up a moment after the cut (glowpoint: and goes out again). */
  private blinkIn(kind: string) {
    const g = this.placed[kind]; if (!g) return;
    const o = kind === 'glowpoint' ? g.children[0] : g.children[11];
    o.visible = false;
    window.setTimeout(() => { o.visible = true; }, 900);
    if (kind === 'glowpoint') window.setTimeout(() => { o.visible = false; }, 2900);
  }

  // ------------------------------------------------------------------ level 19 (on Draxum's stage)
  /** A level whose closing beat is on an away stage (19): played there before the stage is left (episode3.ts calls this in place of `go`). */
  away(n: number, stage: { scene: THREE.Scene; height(x: number, z: number): number } | null, body: THREE.Vector3 | null, cut: (from: THREE.Vector3, to: THREE.Vector3, secs: number, fov?: number) => void, go: () => void) {
    const s = this.h.save, hook = hookFor(n, s);
    if (!hook || !stage || !body) { go(); return; }
    hookPlayed(n, s); this.h.persist();
    const beats = hookBeats(hook, s);
    const plate = buildProp('panelB');
    const at = body.clone().add(V(1.1, 0, -0.6)); at.y = stage.height(at.x, at.z) - 0.05;
    plate.position.copy(at); plate.rotation.y = 0.6; stage.scene.add(plate);
    let k = 0;
    const next = () => {
      if (k >= beats.length) { stage.scene.remove(plate); go(); return; }
      const b = beats[k++], to = at.clone().add(V(0, 0.15, 0));
      cut(b.shot === 'top' ? to.clone().add(V(-2.5, 3.2, 2.5)) : to.clone().add(V(-0.5, 0.55, 0.55)), to, 0.1, b.shot === 'top' ? 40 : 30);
      if (b.key) this.h.ui.say(b.key, 'crew.strong.name', 3.6);
      window.setTimeout(next, (b.hold ?? 3.8) * 1000);
    };
    next();
  }

  // ------------------------------------------------------------------ the small things off the path
  private anchor(f: MyFind): THREE.Vector3 {
    const L = this.h.world.layout, a = f.at.a ?? 0, r = f.at.r ?? 14;
    if (f.at.near === 'lakeFar' || f.at.near === 'lakeShore') {
      const c = V(LAKE.x, 0, LAKE.z), d = (f.at.near === 'lakeFar' ? c.clone().sub(L.camp) : L.camp.clone().sub(c)).setY(0).normalize();
      d.applyAxisAngle(V(0, 1, 0), a);
      return this.open(c.clone().addScaledVector(d, LAKE.r + 3));
    }
    const base = f.at.near === 'ridge' ? L.ridge : L.camp;
    return this.open(base.clone().add(V(Math.cos(a) * r, 0, Math.sin(a) * r)));
  }
  private syncFinds() {
    const s = this.h.save, open = findsOpen(s), key = open.map((f) => f.id).join(',');
    if (key === this.findsKey) return;
    this.findsKey = key;
    for (const id in this.finds) if (!open.some((f) => f.id === id)) { this.props.remove(this.finds[id].g); delete this.finds[id]; }
    for (const f of open) {
      if (this.finds[f.id]) continue;
      const g = buildProp(f.prop), glint = buildGlint();
      g.position.copy(this.anchor(f)); g.rotation.y = (f.id.charCodeAt(1) * 1.7) % 6.28;
      glint.position.set(0, 0.25, 0); g.add(glint);
      if (!this.props.parent) this.h.world.scene.add(this.props);
      this.props.add(g);
      this.finds[f.id] = { g, glint, f };
    }
  }
  private glintT = 0;
  private tickGlints(dt: number) {
    this.glintT += dt;
    const p = this.h.player.pos;
    for (const id in this.finds) {
      const x = this.finds[id], d = x.g.position.distanceTo(p);
      (x.glint.material as THREE.SpriteMaterial).opacity = d < 6 ? (0.35 + 0.35 * Math.sin(this.glintT * 2.4)) * Math.min(1, (6 - d) / 2) : 0;
    }
  }
  /** Use-key actions for a find in reach (game.findInteraction offers them with the story's). */
  actions(): Action[] {
    if (this.playing || this.h.mode !== 'play') return [];
    return Object.values(this.finds).map((x) => ({ id: `find-${x.f.id}`, pos: x.g.position, radius: 1.6, label: t('my.ui.pick'), run: () => this.pick(x.f) }));
  }
  private pick(f: MyFind) {
    const x = this.finds[f.id]; if (!x) return;
    const s = this.h.save, at = x.g.position.clone();
    const m = this.h.player.model, d = this.head().sub(at).setY(0).normalize();
    this.playing = true;
    this.h.playScene([{ hold: 1.2, shot: () => ({ from: at.clone().addScaledVector(d, 0.7).add(V(0, 0.55, 0)), to: at.clone().add(V(0, 0.08, 0)), push: 0.08, fov: 32, lightAt: at, lightScale: 0.5 }) },
      { key: f.line, who: 'scientist', shot: () => ({ from: at.clone().addScaledVector(d, 0.6).add(V(0, 0.5, 0)), to: at.clone().add(V(0, 0.08, 0)), push: 0.05, fov: 32, lightAt: at, lightScale: 0.5 }) },
      { hold: 0.3, shot: () => cover.close(m) }], () => {
      this.playing = false;
      pickFind(f.id, s); this.h.persist();
      this.findsKey = ''; this.props.remove(x.g); delete this.finds[f.id];
      const c = MYSTERY?.clues.find((k) => k.id === f.clue);
      if (c) this.h.ui.toast(t('my.ui.found', { t: t(c.title) }));
    });
  }
}
