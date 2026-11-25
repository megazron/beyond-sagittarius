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
    // the board 30 cm in front of his knees: kneeling back on his heels his hands reach 20 to 45 cm over it there
    // (studio probe); at 55 cm, as before, they stopped short and the drill was never in his hands (owner, L4 clip)
    const kneel = camp.clone().add(d.clone().setLength(1.25)); kneel.y = this.world.terrain.height(kneel.x, kneel.z);
    const at = camp.clone().add(d); at.y = this.world.terrain.height(at.x, at.z) + 0.02;
    // facing the pit (Player.facing points away from where he looks)
    return { kneel, at, facing: Math.atan2(d.x, d.z) };
  }

  private settle(kneel: THREE.Vector3, facing: number) {
    const p = this.player;
    p.pos.copy(kneel); p.vel.set(0, 0, 0); p.facing = facing;
    p.model.root.position.copy(kneel); p.model.root.rotation.y = facing + Math.PI; p.model.root.updateMatrixWorld(true);
    this.z.setKneel(true, true);
    this.z.setLimbs({ bend: 0.55 });
  }

  /** Towards the pit from where he kneels (from the board, not from the model's heading: that trap framed his back). */
  private dir(b: { kneel: THREE.Vector3; at: THREE.Vector3 }) { return b.at.clone().sub(b.kneel).setY(0).normalize(); }

  /**
   * Low and beside the board: the spindle, both palms on it and the notch fill the lower two thirds, his face (bent
   * over it) at the top. Built from the board and the kneel spot.
   */
  private drillShot(b: { kneel: THREE.Vector3; at: THREE.Vector3 }, dist = 0.85, side = 1): Shot {
    const f = this.dir(b), r = new THREE.Vector3(f.z, 0, -f.x).multiplyScalar(side);
    // far enough out that the board, the spindle, both palms and his face all fit (at 1 m it framed his coat)
    const to = b.at.clone().addScaledVector(f, -0.2).add(new THREE.Vector3(0, 0.42, 0));
    // GPU ep1B: from his side (r 1.5, f 0.35) his arm and coat hid both palms; now beyond the board, to one side, facing him
    return { from: b.at.clone().addScaledVector(r, dist * 0.8).addScaledVector(f, 0.8 * dist).add(new THREE.Vector3(0, 0.3 + dist * 0.1, 0)), to: b.at.clone().addScaledVector(f, -0.1).add(new THREE.Vector3(0, 0.28, 0)), push: 0.02 }; // low: from 0.7 m up his bowed head hid his hands
  }
  /** Extreme close on the notch in the board: the dust, the smoke, the ember. */
  private notchShot(b: { kneel: THREE.Vector3; at: THREE.Vector3 }): Shot {
    const f = this.dir(b), r = new THREE.Vector3(f.z, 0, -f.x);
    return { from: b.at.clone().addScaledVector(f, 0.24).addScaledVector(r, 0.16).add(new THREE.Vector3(0, 0.13, 0)), to: b.at.clone().add(new THREE.Vector3(0, 0.03, 0)), push: 0.01 };
  }
  /** His face from below and in front (he looks down at the board: a lens at head height framed his hair). */
  private faceShot(b: { kneel: THREE.Vector3; at: THREE.Vector3 }, side = 0.3): Shot {
    const f = this.dir(b), r = new THREE.Vector3(f.z, 0, -f.x), h = new THREE.Vector3().setFromMatrixPosition(this.z.head.matrixWorld);
    return { from: h.clone().addScaledVector(f, 0.75).addScaledVector(r, side).add(new THREE.Vector3(0, -0.34, 0)), to: h.clone().addScaledVector(f, 0.06).add(new THREE.Vector3(0, -0.1, 0)), push: 0.03 };
  }
  /** The same framing held by the follow camera while a tension moment is open. */
  private hold(b: { kneel: THREE.Vector3; at: THREE.Vector3 } | null, dist = 0.95) {
    if (!b) { this.player.workShot = null; return; }
    const sh = this.drillShot(b, dist); this.player.workShot = { from: sh.from.clone(), to: sh.to.clone() };
  }

  /** Palms flat either side of the spindle, rubbing in opposite directions, working down it and back to the top. */
  private rub(b: { kneel: THREE.Vector3; at: THREE.Vector3 }, sec: number, speed = 1) {
    const at = b.at, z = this.z, f = this.dir(b), r = new THREE.Vector3(f.z, 0, -f.x), t0 = performance.now();
    // the spindle stands upright in the board's notch, in the world, between his palms (parented to a hand it pointed
    // sideways out of his fist); it turns back and forth with the rub
    z.setProp(null);
    const sp = this.stick(at), run = ++this.rubN;
    const step = () => {
      const k = (performance.now() - t0) / 1000;
      if (k > sec || run !== this.rubN || !sp.parent) return;
      // it leans to run between his palms (the arms do not always reach the notch exactly): base in the notch, the
      // shaft through the middle of his two hands, turned back and forth by the rub
      const hb = this.handBones();
      if (hb) {
        const m = hb[0].getWorldPosition(new THREE.Vector3()).add(hb[1].getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5).addScaledVector(f, 0.05);
        const dir = m.sub(sp.position); if (dir.y < 0.1) dir.y = 0.1;
        sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        sp.rotateY(Math.cos(k * 22 * speed) * 7.5);
      } else sp.rotation.y = Math.cos(k * 22 * speed) * 7.5;
      // a pass: the palms rub hard and fast down the spindle (pressing down), then flick back to the top (the last
      // eighth of the cycle, no rub); about 3.5 rubs a second, 9 cm of travel each way between the palms
      const cyc = (k * 0.62 * speed) % 1, back = cyc > 0.88, down = back ? 1 - (cyc - 0.88) / 0.12 : cyc / 0.88;
      const h = 0.44 - down * 0.24, w = back ? 0 : Math.sin(k * 22 * speed) * 0.045;
      const c = at.clone().add(new THREE.Vector3(0, h, 0));
      z.setHold({
        // grasps: both palms closed on the spindle's line at c (wrist points 3.5 cm out left the stem between the wrists)
        R: { at: c.clone().addScaledVector(f, w), fingers: f.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize(), palm: r.clone().negate(), radius: 0.008, along: 0.5, grasp: true },
        L: { at: c.clone().addScaledVector(f, -w), fingers: f.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize(), palm: r.clone(), radius: 0.008, along: 0.5, grasp: true },
      });
      if (Math.random() < 0.08 * speed) audio.sample('wood', 0.12, { rate: 1.6 + Math.random() * 0.3 });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private rubN = 0;
  private hands: [THREE.Object3D, THREE.Object3D] | null = null;
  private handBones() {
    if (!this.hands) {
      let l: THREE.Object3D | undefined, r: THREE.Object3D | undefined;
      this.z.root.traverse((o) => { if ((o as THREE.Bone).isBone) { if (o.name === 'handL') l = o; else if (o.name === 'handR') r = o; } });
      if (l && r) this.hands = [l, r];
    }
    return this.hands;
  }
  private spindle: THREE.Mesh | null = null;
  /** The spindle upright in the notch at `at` (null takes it away). */
  private stick(at: THREE.Vector3 | null): THREE.Mesh {
    if (!this.spindle) {
      // bark left on in strips along it (pale wood between), so the back-and-forth turn reads on screen
      const g = new THREE.CylinderGeometry(0.0075, 0.0085, 0.5, 10, 1).toNonIndexed(); g.translate(0, 0.25, 0);
      const P = g.getAttribute('position'), C = new Float32Array(P.count * 3);
      for (let i = 0; i < P.count; i += 3) {
        const a = Math.atan2(P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2), P.getX(i) + P.getX(i + 1) + P.getX(i + 2));
        const bark = Math.sin(a * 3) > 0.2, c = bark ? [0.2, 0.13, 0.08] : [0.72, 0.58, 0.4];
        for (let j = 0; j < 3; j++) C.set(c, (i + j) * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(C, 3));
      this.spindle = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8 }));
      this.spindle.castShadow = true; this.spindle.name = 'e1-spindle';
    }
    if (!at) { this.spindle.removeFromParent(); this.rubN++; return this.spindle; }
    this.spindle.position.copy(at).add(new THREE.Vector3(0, 0.01, 0));
    if (!this.spindle.parent) this.world.scene.add(this.spindle);
    return this.spindle;
  }

  /** Smoke from the notch that builds while he drills: nothing for the first second, then wisps, then a thick grey
   * curl (`thick` 0..1 is how far it gets), soft round puffs (single pixels did not read on the GPU); and the black
   * dust collecting in the notch. */
  private puff(at: THREE.Vector3, thick: number, sec: number) {
    const N = 70, g = new THREE.BufferGeometry(), pos = new Float32Array(N * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const S = 32, px = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2), k = (y * S + x) * 4; px[k] = px[k + 1] = px[k + 2] = 255; px[k + 3] = Math.round(255 * Math.max(0, 1 - d) ** 2); }
    const tex = new THREE.DataTexture(px, S, S, THREE.RGBAFormat); tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    const m = new THREE.PointsMaterial({ color: 0xb4aea4, map: tex, size: 0.07, transparent: true, opacity: 0, depthWrite: false });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false;
    const dust = new THREE.Mesh(new THREE.CircleGeometry(0.022, 10), new THREE.MeshStandardMaterial({ color: 0x1c140e, roughness: 1 }));
    dust.rotation.x = -Math.PI / 2; dust.position.copy(at).add(new THREE.Vector3(0.012, 0.004, 0)); dust.scale.setScalar(0.01);
    const t0 = performance.now();
    pts.onBeforeRender = () => {
      const k = (performance.now() - t0) / 1000, grow = Math.min(1, Math.max(0, (k - 0.9) / Math.max(0.5, sec - 1.6)));
      const live = Math.round(N * (0.25 + 0.75 * grow));
      for (let i = 0; i < N; i++) {
        const a = ((k * 0.55 + i / N) % 1), sw = Math.sin(i * 7.1 + k * 1.3) * 0.05 * a + a * a * 0.12;
        if (i >= live) { pos[i * 3 + 1] = -1e4; continue; }
        pos[i * 3] = at.x + sw; pos[i * 3 + 1] = at.y + 0.01 + a * 0.5; pos[i * 3 + 2] = at.z + Math.cos(i * 3.3 + k) * 0.05 * a;
      }
      g.attributes.position.needsUpdate = true;
      m.size = 0.05 + 0.07 * grow;
      m.opacity = 0.55 * thick * grow * Math.max(0, Math.min(1, (sec - k) / 0.6));
      dust.scale.setScalar(0.2 + 0.8 * Math.min(1, k / sec));
    };
    this.world.scene.add(pts, dust);
    this.smoke = pts;
    this.after(sec + 1.5, () => { pts.removeFromParent(); dust.removeFromParent(); g.dispose(); m.dispose(); tex.dispose(); if (this.smoke === pts) this.smoke = null; });
  }

  /**
   * The light he works by at dusk: the sky's last glow from where the sun went down (swung a little towards the camera
   * so it reaches his hands and face, not only his back), warm like the horizon, fading as the glow goes out of the
   * sky; nothing by day. The ember adds its own (emberAt).
   */
  private dusk(b: { kneel: THREE.Vector3; at: THREE.Vector3 } | null) {
    const camp = this.world.camp;
    if (!b) { camp.workLight(null); return; }
    const sky = this.world.sky, e = sky.sunDir.y;
    const k = Math.max(0, Math.min(1, (e + 0.35) / 0.3)) * (1 - sky.day);
    const sun = new THREE.Vector3(sky.sunDir.x, 0, sky.sunDir.z).normalize();
    const sh = this.drillShot(b), cam = sh.from.clone().sub(b.at).setY(0).normalize();
    const d = sun.addScaledVector(cam, 0.9).normalize();
    // mostly a plain warm white: the magenta of the dusk horizon turned his white coat pink (owner, L4 clip)
    const col = new THREE.Color(0xffe2c8).lerp(sky.horizon, 0.15);
    camp.workLight({ sky: k, skyAt: b.at.clone().addScaledVector(d, 2.6).add(new THREE.Vector3(0, 1.7, 0)), color: col });
  }

  private emberAt(at: THREE.Vector3 | null) {
    this.world.camp.workLight({ ember: at ? 1 : 0, at: at ?? undefined });
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
      { hold: 1.8, shot: () => cover.mid(z, 0.85, 2.2), run: () => { this.settle(b.kneel, b.facing); this.dusk(b); z.setLookTarget(b.at); audio.sample('wood', 0.3); } },
      { key: 'e1.fi.sci', who: 'scientist', if: { not: { flag: 'inv.fireDrill' } }, shot: () => this.drillShot(b, 1.05), run: () => { if (first) this.rub(b, 4, 0.6); }, after: 0.3 },
    ], () => this.attempt(b, lit));
  }

  private async attempt(b: { kneel: THREE.Vector3; at: THREE.Vector3; facing: number }, lit: () => void) {
    const z = this.z, q = (window as unknown as { __e1drill?: Try[] }).__e1drill;
    if (this.fails === 0) this.ui.toast(t('e1.fi.hint'));
    this.rub(b, 4.5, 1.3); this.puff(b.at, 1, 5); this.hold(b);
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
    this.hold(null);
    if (res !== 'ok' && this.fails >= 3) res = 'ok';
    if (res !== 'ok') {
      this.fails++;
      this.playScene([
        { hold: 1.4, shot: () => this.drillShot(b, 0.8), run: () => { z.setHold(null); z.setProp(null); this.stick(null); this.emberAt(res === 'die' ? b.at.clone().add(new THREE.Vector3(0, 0.02, 0)) : null); this.after(0.9, () => this.emberAt(null)); } },
        { key: res === 'slow' ? 'e1.fi.slow' : 'e1.fi.die', who: 'scientist', shot: () => this.faceShot(b), run: () => { z.setFace({ frown: 0.4, squint: 0.3 }); audio.human('breath', 0.5); }, after: 0.3 },
      ], () => { z.setFace(null); this.after(0.5, () => this.attempt(b, lit)); });
      return;
    }
    // it catches: the ember into the nest, lifted and blown, his face lit from below; then he laughs and looks round
    const nest = () => new THREE.Vector3().setFromMatrixPosition(z.head.matrixWorld).addScaledVector(this.fwd(), 0.28).add(new THREE.Vector3(0, -0.22, 0));
    this.playScene([
      // the insert: the notch, black dust, the smoke thick now, and in it a red point that stays when he stops
      { hold: 1.8, shot: () => this.notchShot(b), run: () => {
        z.setHold(null); this.stick(null); this.puff(b.at, 1, 2.2);
        this.after(0.5, () => this.emberAt(b.at.clone().add(new THREE.Vector3(0, 0.012, 0))));
        z.setLookTarget(b.at); audio.human('breath', 0.3);
      } },
      { hold: 2.4, shot: () => cover.close(z, 0.3, 0.8, 0.25), run: () => {
        z.setProp(null); this.stick(null);
        const n = nest(), f = this.fwd();
        // grasps: the palms cupped under the nest's middle
        z.setHold({ R: { at: n.clone().addScaledVector(new THREE.Vector3(f.z, 0, -f.x), -0.035), fingers: f.clone(), palm: new THREE.Vector3(0, 1, 0), radius: 0.02, grasp: true }, L: { at: n.clone().addScaledVector(new THREE.Vector3(f.z, 0, -f.x), 0.035), fingers: f.clone(), palm: new THREE.Vector3(0, 1, 0), radius: 0.02, grasp: true } });
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
      this.stick(null);
      this.dusk(null);
      this.s.flags['inv.fireDrill'] = true;
      this.ui.toast(t('e1.learn.fire'));
      z.setFace(null); z.setLookTarget(null); z.setLimbs(null); z.setKneel(false);
    });
  }
}
