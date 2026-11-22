import * as THREE from 'three';
import { audio } from '../core/audio';
import { t } from '../i18n';
import type { SaveData } from '../core/save';
import type { World } from '../world/world';
import type { UI } from '../ui/ui';
import type { Player } from './player';
import { cover, type Beat, type Shot } from '../cinematic/cutscene';
import type { TensionResult, TensionSpec } from '../combat/sim/tension';

type Try = 'slow' | 'die' | 'ok';

/**
 * Episode One 1.6, fire by friction: the hand drill (INVENTION_TREE.md Age 1 row 5). He kneels at the pit with a split
 * dry board, a notch cut in it with the flake, a straight spindle and a nest of tinder. Palms run down the spindle,
 * back to the top, again (hold the speed in the band: a `steady` moment); the dust in the notch smokes and holds an
 * ember, which goes into the tinder and is blown up (a `breath` moment). Real fails: too slow (smoke and nothing,
 * `e1.fi.slow`) and the ember dying on the way (`e1.fi.die`). After three fails the next try catches. Then the
 * fire, his face lit from below, a laugh with nobody to hear it, and how big to keep it (decision e1.fire).
 * Sets `inv.fireDrill`. The old three-strike path stays for the level tests (Story calls this only for a real press).
 */
export class FireDrill {
  private fails = 0;
  private told = false;
  private smoke: THREE.Points | null = null;
  private ember: THREE.Mesh | null = null;

  constructor(
    private world: World,
    private player: Player,
    private ui: UI,
    private getSave: () => SaveData,
    private playScene: (beats: Beat[], then?: () => void) => void,
    private after: (sec: number, fn: () => void) => void,
    private tension: (spec: TensionSpec) => Promise<TensionResult> | null,
  ) {}

  private get s() { return this.getSave(); }
  private get z() { return this.player.model; }
  private fwd() { const r = this.z.root.rotation.y; return new THREE.Vector3(Math.sin(r), 0, Math.cos(r)); }

  /** Where the board lies: beside the pit, at his knees. */
  private board() {
    const camp = this.world.layout!.camp as THREE.Vector3, p = this.player.pos;
    const d = new THREE.Vector3(p.x - camp.x, 0, p.z - camp.z);
    if (d.lengthSq() < 0.01) d.set(0, 0, 1);
    d.setLength(0.95);
    const kneel = camp.clone().add(d.clone().setLength(1.5)); kneel.y = this.world.terrain.height(kneel.x, kneel.z);
    const at = camp.clone().add(d); at.y = this.world.terrain.height(at.x, at.z) + 0.02;
    // facing the pit (Player.facing points away from where he looks)
    return { kneel, at, facing: Math.atan2(d.x, d.z) };
  }

  private settle(kneel: THREE.Vector3, facing: number) {
    const p = this.player;
    p.pos.copy(kneel); p.vel.set(0, 0, 0); p.facing = facing;
    p.model.root.position.copy(kneel); p.model.root.rotation.y = facing + Math.PI; p.model.root.updateMatrixWorld(true);
    this.z.setKneel(true);
  }

  /** Low on the board and his hands from the side, his face above. */
  private drillShot(at: THREE.Vector3, dist = 1.0): Shot {
    const f = this.fwd(), r = new THREE.Vector3(f.z, 0, -f.x);
    const head = new THREE.Vector3().setFromMatrixPosition(this.z.head.matrixWorld);
    const to = at.clone().lerp(head, 0.45);
    return { from: at.clone().addScaledVector(r, dist).addScaledVector(f, 0.25).add(new THREE.Vector3(0, 0.45 + dist * 0.15, 0)), to, push: 0.03 };
  }

  /** Palms flat either side of the spindle, rubbing in opposite directions, working down it and back to the top. */
  private rub(at: THREE.Vector3, sec: number, speed = 1) {
    const z = this.z, f = this.fwd(), r = new THREE.Vector3(f.z, 0, -f.x), t0 = performance.now();
    z.setProp('spindle');
    const step = () => {
      const k = (performance.now() - t0) / 1000;
      if (k > sec) return;
      const down = (k * 0.55 * speed) % 1, h = 0.48 - down * 0.3, w = Math.sin(k * 14 * speed) * 0.05;
      const c = at.clone().add(new THREE.Vector3(0, h, 0));
      z.setHold({
        R: { at: c.clone().addScaledVector(r, 0.035).addScaledVector(f, w), fingers: f.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize(), palm: r.clone().negate(), radius: 0.012 },
        L: { at: c.clone().addScaledVector(r, -0.035).addScaledVector(f, -w), fingers: f.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize(), palm: r.clone() },
      });
      if (Math.random() < 0.08 * speed) audio.sample('wood', 0.12, { rate: 1.6 + Math.random() * 0.3 });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Grey smoke from the notch, thin or thick. */
  private puff(at: THREE.Vector3, thick: number, sec: number) {
    const N = 60, g = new THREE.BufferGeometry(), pos = new Float32Array(N * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0x9c9890, size: 0.018, transparent: true, opacity: 0.35 * thick, depthWrite: false });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false;
    const t0 = performance.now();
    pts.onBeforeRender = () => {
      const k = (performance.now() - t0) / 1000;
      for (let i = 0; i < N; i++) {
        const a = ((k * 0.8 + i / N) % 1), sw = Math.sin(i * 7.1 + k * 2) * 0.06 * a;
        pos[i * 3] = at.x + sw; pos[i * 3 + 1] = at.y + a * 0.55; pos[i * 3 + 2] = at.z + Math.cos(i * 3.3 + k) * 0.06 * a;
      }
      g.attributes.position.needsUpdate = true;
      m.opacity = 0.35 * thick * Math.min(1, k / 0.8) * Math.max(0, Math.min(1, (sec - k) / 0.6));
    };
    this.world.scene.add(pts);
    this.smoke = pts;
    this.after(sec, () => { pts.removeFromParent(); g.dispose(); m.dispose(); if (this.smoke === pts) this.smoke = null; });
  }

  private emberAt(at: THREE.Vector3 | null) {
    if (!at) { this.ember?.removeFromParent(); this.ember = null; return; }
    if (!this.ember) this.ember = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff7a24 }));
    this.ember.position.copy(at);
    this.world.scene.add(this.ember);
  }

  /** The whole thing, from kneeling at the pit to the fire. `lit` runs the game's own fire (flags, the flames). */
  start(lit: () => void) {
    const z = this.z, b = this.board();
    const first = !this.told; this.told = true;
    this.playScene([
      { hold: 1.8, shot: () => cover.mid(z, 0.85, 2.2), run: () => { this.settle(b.kneel, b.facing); z.setLookTarget(b.at); z.setLimbs({ bend: 0.4 }); audio.sample('wood', 0.3); } },
      { key: 'e1.fi.sci', who: 'scientist', if: { not: { flag: 'inv.fireDrill' } }, shot: () => this.drillShot(b.at, 1.2), run: () => { if (first) this.rub(b.at, 4, 0.6); }, after: 0.3 },
    ], () => this.attempt(b, lit));
  }

  private async attempt(b: { kneel: THREE.Vector3; at: THREE.Vector3; facing: number }, lit: () => void) {
    const z = this.z, q = (window as unknown as { __e1drill?: Try[] }).__e1drill;
    if (this.fails === 0) this.ui.toast(t('e1.fi.hint'));
    this.rub(b.at, 4.5, 1.3); this.puff(b.at, 0.4, 5);
    let res: Try;
    if (q && q.length) { res = q.shift()!; await new Promise((r) => setTimeout(r, 2500)); }
    else {
      const spin = await this.tension({ kind: 'steady', seconds: 4, strain: this.s.flags.poisoned ? 1.2 : 1 });
      if (spin && !spin.passed) res = 'slow';
      else {
        this.emberAt(b.at.clone().add(new THREE.Vector3(0, 0.02, 0)));
        const blow = await this.tension({ kind: 'breath', count: 4 });
        res = !blow || blow.passed ? 'ok' : 'die';
      }
    }
    if (res !== 'ok' && this.fails >= 3) res = 'ok';
    if (res !== 'ok') {
      this.fails++;
      this.playScene([
        { hold: 1.4, shot: () => this.drillShot(b.at, 0.9), run: () => { z.setHold(null); z.setProp(null); this.emberAt(res === 'die' ? b.at.clone().add(new THREE.Vector3(0, 0.02, 0)) : null); this.after(0.9, () => this.emberAt(null)); } },
        { key: res === 'slow' ? 'e1.fi.slow' : 'e1.fi.die', who: 'scientist', shot: () => cover.close(z, 0.4, 0.95), run: () => { z.setFace({ frown: 0.4, squint: 0.3 }); audio.human('breath', 0.5); }, after: 0.3 },
      ], () => { z.setFace(null); this.after(0.5, () => this.attempt(b, lit)); });
      return;
    }
    // it catches: the ember into the nest, lifted and blown, his face lit from below; then he laughs and looks round
    const nest = () => new THREE.Vector3().setFromMatrixPosition(z.head.matrixWorld).addScaledVector(this.fwd(), 0.28).add(new THREE.Vector3(0, -0.22, 0));
    this.playScene([
      { hold: 2.4, shot: () => cover.close(z, 0.3, 0.8, 0.25), run: () => {
        z.setProp(null);
        const n = nest(), f = this.fwd();
        z.setHold({ R: { at: n.clone().addScaledVector(new THREE.Vector3(f.z, 0, -f.x), -0.04), fingers: f.clone(), palm: new THREE.Vector3(0, 1, 0) }, L: { at: n.clone().addScaledVector(new THREE.Vector3(f.z, 0, -f.x), 0.04), fingers: f.clone(), palm: new THREE.Vector3(0, 1, 0) } });
        z.setLookTarget(n); z.setFace({ open: 0.3, squint: 0.2 });
        this.emberAt(n.clone().add(new THREE.Vector3(0, 0.02, 0)));
        for (let i = 0; i < 3; i++) this.after(0.4 + i * 0.6, () => audio.human('breath', 0.6));
      } },
      { hold: 2.2, shot: () => cover.close(z, -0.3, 0.9, 0.2), run: () => {
        this.emberAt(null); z.setHold(null); lit();
        audio.tone(90, 1.4, 'sawtooth', 0.1, 0, 40);
        z.setFace({ smile: 0.8, open: 0.4 }); this.after(0.3, () => audio.human('laugh', 0.6));
        // and then he looks round, as if someone heard
        this.after(1.4, () => { const f = this.fwd(); z.setLookTarget(new THREE.Vector3().setFromMatrixPosition(z.head.matrixWorld).addScaledVector(new THREE.Vector3(f.z, 0, -f.x), 3).addScaledVector(f, 1)); z.setFace({ smile: 0.3 }); });
      } },
      { choice: 'e1.fire', shot: () => cover.mid(z, 0.7, 2.4) },
    ], () => {
      this.s.flags['inv.fireDrill'] = true;
      this.ui.toast(t('e1.learn.fire'));
      z.setFace(null); z.setLookTarget(null); z.setLimbs(null); z.setKneel(false);
    });
  }
}
