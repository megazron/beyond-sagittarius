import * as THREE from 'three';
import { audio } from '../core/audio';
import { t } from '../i18n';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Simplex } from '../core/noise';
import type { SaveData } from '../core/save';
import type { World } from '../world/world';
import type { UI } from '../ui/ui';
import type { Player } from './player';
import type { StreamWater } from '../world/stream';
import { cover, type Beat, type Shot } from '../cinematic/cutscene';
import type { TensionResult, TensionSpec } from '../combat/sim/tension';
import type { Cond } from './branch';

type Kind = 'granite' | 'flint' | 'sand';
const KINDS: Kind[] = ['granite', 'flint', 'sand'];
const CHOSE = (k: Kind): Cond => ({ chose: ['e1.stone', k] });
const WRONG: Cond = { any: [CHOSE('granite'), CHOSE('sand')] };
/** Knapping results the capture tools can queue (window.__e1knap = ['mid', 'ok']): no timing by hand in a recording. */
type Strike = 'mid' | 'steep' | 'snap' | 'ok';

/**
 * Episode One 1.3, the first tools (INVENTION_TREE.md Age 1 rows 2 and 3): on the stream bank three cobbles, grey
 * granite, dark flint and brown sandstone. He taps each with a hammerstone (Draxum remembered: flint sings, rubbish
 * rock goes thunk), picks one (decision e1.stone), and a wrong one falls apart on the first strike. Then he knaps the
 * flint: where to strike (near the edge, not the middle) and the strike itself (a low angle, followed through); each
 * real way to fail has its own line, and the flake he gets cuts his thumb. Sets `inv.goodStone` and `inv.flake`.
 * The digging stick (`inv.woodBone`) comes with the branches at the end of level 3 (game.ts).
 */
export class Stones {
  private site: { kneel: THREE.Vector3; facing: number; at: Record<Kind, THREE.Vector3>; group: THREE.Group } | null = null;
  private meshes = new Map<Kind, THREE.Mesh>();
  private fails = 0;

  constructor(
    private world: World,
    private player: Player,
    private ui: UI,
    private stream: StreamWater,
    private getSave: () => SaveData,
    private playScene: (beats: Beat[], then?: () => void) => void,
    private after: (sec: number, fn: () => void) => void,
    private tension: (spec: TensionSpec) => Promise<TensionResult> | null,
  ) {}

  private get s() { return this.getSave(); }
  private get z() { return this.player.model; }

  /** Where the cobbles lie: a gravel bank of the stream, well away from the loose stones and branches of level 3 (the
   * level tests walk to those; they must not walk into this scene). Placed once, the first time it is asked for. */
  place() {
    if (this.site) return this.site;
    const L = this.stream.line, n = L.length, items = this.world.items.items.filter((i) => i.type === 'stone' || i.type === 'branch');
    let best = -1, bestD = -1;
    for (let k = 0; k < 24; k++) {
      // from about a third of the way down, outwards both ways
      const i = Math.floor(n * 0.34) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2;
      if (i < 4 || i > n - 10) continue;
      const d = items.reduce((m, it) => Math.min(m, Math.hypot(it.pos.x - L[i].x, it.pos.z - L[i].z)), Infinity);
      if (d > 8) { best = i; break; }
      if (d > bestD) { bestD = d; best = i; }
    }
    // the bank on the side the wake is on (he comes from there)
    const toWake = new THREE.Vector3(-L[best].x, 0, -L[best].z).normalize().multiplyScalar(2.5);
    const spot = this.stream.bankSpot(L[best].clone().add(toWake));
    const f = new THREE.Vector3(-Math.sin(spot.facing), 0, -Math.cos(spot.facing)); // towards the water
    const r = new THREE.Vector3(f.z, 0, -f.x);
    const kneel = spot.at.clone().addScaledVector(f, -0.3);
    kneel.y = this.world.terrain.height(kneel.x, kneel.z);
    const group = new THREE.Group(); group.name = 'e1-cobbles';
    const at = {} as Record<Kind, THREE.Vector3>;
    KINDS.forEach((k, i) => {
      const p = kneel.clone().addScaledVector(f, 0.5).addScaledVector(r, (i - 1) * 0.3);
      p.y = this.world.terrain.height(p.x, p.z);
      const m = cobble(k, 31 + i * 7, 1.35);
      m.position.copy(p).add(new THREE.Vector3(0, 0.045, 0));
      m.rotation.y = i * 1.9;
      group.add(m); this.meshes.set(k, m); at[k] = m.position.clone();
    });
    // a few plain river stones round them, so the three are a choice from a bank, not three props on show
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39, d = 0.55 + (i % 3) * 0.35;
      const p = kneel.clone().addScaledVector(f, 0.45 + Math.cos(a) * d * 0.5).addScaledVector(r, Math.sin(a) * d);
      p.y = this.world.terrain.height(p.x, p.z) + 0.02;
      const m = cobble(i % 3 === 0 ? 'granite' : 'sand', 90 + i, 0.6 + (i % 4) * 0.12);
      m.position.copy(p); m.rotation.set(i, i * 0.7, 0); group.add(m);
    }
    this.world.scene.add(group);
    this.stream.clearReeds(kneel, 1.6);
    this.site = { kneel, facing: spot.facing, at, group };
    return this.site;
  }

  /** Is he at the cobbles (level 3, not yet seen)? */
  near(p: THREE.Vector3) {
    const s = this.s;
    if (s.level !== 3 || s.flags['e1.stoneSeen']) return false;
    const site = this.place();
    return Math.hypot(p.x - site.kneel.x, p.z - site.kneel.z) < 2.6;
  }

  /** Stand him at the spot facing the water, kneeling (a cut hides it). */
  private settle() {
    const site = this.site!, p = this.player;
    p.pos.copy(site.kneel); p.vel.set(0, 0, 0); p.facing = site.facing;
    p.model.root.position.copy(site.kneel); p.model.root.rotation.y = site.facing + Math.PI; p.model.root.updateMatrixWorld(true);
    this.z.setKneel(true);
  }

  private fwd() { const r = this.z.root.rotation.y; return new THREE.Vector3(Math.sin(r), 0, Math.cos(r)); }

  /** Low and close on the stones and his hands, from his right, his face at the top of frame. */
  private stoneShot(at: THREE.Vector3, dist = 0.95): Shot {
    // from the water's side of the stones, looking back up the bank at them and at his face (built from the site, not
    // from the model's heading: the first cut of this framed his back)
    const site = this.site!, w = at.clone().sub(site.kneel).setY(0).normalize(), r = new THREE.Vector3(w.z, 0, -w.x);
    const head = new THREE.Vector3().setFromMatrixPosition(this.z.head.matrixWorld);
    // far and high enough that the stones sit low in frame and his face (looking down at them) at the top
    const to = at.clone().lerp(head, 0.5);
    return { from: at.clone().addScaledVector(w, dist * 1.15).addScaledVector(r, dist * 0.55).add(new THREE.Vector3(0, 0.55 + dist * 0.2, 0)), to, push: 0.03 };
  }

  /** The hammerstone in his right hand comes down on `at` twice (a tap) with the sound of what it hits. */
  private tap(at: THREE.Vector3, k: Kind | 'strike', hard = false) {
    const z = this.z, f = this.fwd();
    const up = at.clone().add(new THREE.Vector3(0, 0.12, 0)).addScaledVector(f, -0.04), hit = at.clone().add(new THREE.Vector3(0, 0.045, 0));
    const pose = (p: THREE.Vector3) => z.setHold({ R: { at: p, fingers: f.clone().add(new THREE.Vector3(0, -0.6, 0)).normalize(), palm: new THREE.Vector3(0, -1, 0), radius: 0.035 }, L: { at: at.clone().add(new THREE.Vector3(0, 0.06, 0)).addScaledVector(f, -0.07).addScaledVector(new THREE.Vector3(f.z, 0, -f.x), 0.08), fingers: f.clone(), palm: new THREE.Vector3(0, -1, 0) } });
    pose(up);
    const sound = () => {
      if (k === 'flint') { audio.sample('flint', 0.5); audio.tone(2350, 0.4, 'sine', 0.07); audio.tone(3520, 0.28, 'sine', 0.035, 0.01); }
      else if (k === 'granite') { audio.sample('stone', 0.6, { rate: 1.05 }); }
      else if (k === 'sand') { audio.sample('stone', 0.45, { rate: 0.62 }); audio.tone(110, 0.14, 'sine', 0.12); }
      else { audio.sample(hard ? 'cb_crack' : 'flint', hard ? 0.5 : 0.6); }
    };
    const n = k === 'strike' ? 1 : 2;
    for (let i = 0; i < n; i++) {
      this.after(0.25 + i * 0.45, () => pose(hit));
      this.after(0.3 + i * 0.45, sound);
      this.after(0.42 + i * 0.45, () => pose(up));
    }
  }

  /** The scene at the cobbles. */
  start() {
    const s = this.s, z = this.z, site = this.place();
    s.flags['e1.stoneSeen'] = true;
    const mid = () => site.at.granite.clone().lerp(site.at.sand, 0.5);
    this.playScene([
      // he kneels at the bank and looks over the stones; Draxum's voice comes back to him
      { hold: 2.0, shot: () => cover.mid(z, 0.8, 2.2), run: () => {
        this.settle(); z.setLookTarget(mid()); z.setLimbs({ bend: 0.35 });
        z.setProp('stone');
        this.ui.memory('e1.st.drax', 8);
      } },
      // he taps each one with the stone in his hand: the grey one clacks, the dark one rings, the brown one thunks
      ...KINDS.map((k): Beat => ({ hold: 1.4, shot: () => this.stoneShot(site.at[k]), run: () => { z.setLookTarget(site.at[k]); this.tap(site.at[k], k); } })),
      { choice: 'e1.stone', shot: () => this.stoneShot(mid(), 1.2) },
      // a wrong stone: the first real strike and it falls apart (granite crumbles at a crack, sandstone into grit)
      { hold: 1.5, if: WRONG, shot: () => this.stoneShot(this.chosenAt(), 0.85), run: () => {
        const k = this.chosen(), at = site.at[k];
        z.setLookTarget(at); this.tap(at, 'strike', true);
        this.after(0.32, () => this.crumble(k));
      } },
      { key: 'e1.st.fail', who: 'scientist', if: WRONG, shot: () => cover.close(z, 0.4, 0.95), run: () => z.setFace({ squint: 0.3, frown: 0.25 }), after: 0.3 },
      // the dark one: he takes it in his left hand and turns it, the glassy edge to the light
      { hold: 1.6, shot: () => this.stoneShot(site.at.flint, 0.9), run: () => {
        z.setFace(null); z.setLookTarget(site.at.flint);
        this.tap(site.at.flint, 'flint');
      } },
    ], () => {
      s.flags['inv.goodStone'] = true;
      this.ui.toast(t('e1.learn.goodStone'));
      this.fails = 0;
      this.after(0.6, () => this.knap());
    });
  }

  private chosen(): Kind {
    const e = this.s.branch?.log?.find((x) => x.id === 'e1.stone');
    return (e?.pick as Kind) ?? 'flint';
  }
  private chosenAt() { return this.site!.at[this.chosen()]; }

  /** A wrong stone breaks: it goes, three pieces roll off it, a puff of grit. */
  private crumble(k: Kind) {
    const m = this.meshes.get(k); if (!m) return;
    m.visible = false;
    const bits: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const b = cobble(k, 200 + i, 0.45);
      b.position.copy(m.position); this.site!.group.add(b); bits.push(b);
    }
    const t0 = performance.now(), ground = m.position.y - 0.03;
    const tick = () => {
      const s = (performance.now() - t0) / 1000;
      bits.forEach((b, i) => {
        const a = i * 1.7 + 0.4, v = 0.35 + (i % 2) * 0.2, tt = Math.min(s, 0.5);
        b.position.set(m.position.x + Math.cos(a) * v * tt, Math.max(ground, m.position.y + 0.9 * tt - 4.9 * tt * tt), m.position.z + Math.sin(a) * v * tt);
        b.rotation.set(s * 4 + i, s * 3, 0);
      });
      if (s < 0.6) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    audio.sample('stone', 0.35, { rate: 0.5, delay: 0.15 });
  }

  /** One knapping attempt: where on the core (near the edge), then the strike (low angle, followed through). */
  private async knap() {
    const z = this.z, site = this.site!, f = this.fwd();
    // the core lies at his knees now, the edge towards him
    const core = site.at.flint, edge = core.clone().addScaledVector(f, -0.03);
    if (this.fails === 0) this.ui.toast(t('e1.fl.hint'));
    z.setLookTarget(core);
    const q = (window as unknown as { __e1knap?: Strike[] }).__e1knap;
    let res: Strike;
    if (q && q.length) res = q.shift()!;
    else {
      const where = await this.tension({ kind: 'aim', seconds: 3.2 });
      if (!where) res = 'ok';
      else if (!where.passed) res = 'mid';
      else {
        const hit = await this.tension({ kind: 'quick', seconds: 1.3 });
        res = !hit || hit.passed ? 'ok' : this.fails % 2 === 0 ? 'steep' : 'snap';
      }
    }
    // after three misses the fourth strike lands: the lesson is taught, the player is not held here
    if (res !== 'ok' && this.fails >= 3) res = 'ok';
    const line: Record<Strike, string> = { mid: 'e1.fl.mid', steep: 'e1.fl.steep', snap: 'e1.fl.snap', ok: 'e1.fl.ok' };
    if (res !== 'ok') {
      this.fails++;
      this.playScene([
        { hold: 1.1, shot: () => this.stoneShot(core, 0.8), run: () => {
          this.tap(res === 'mid' ? core.clone().addScaledVector(f, 0.02) : edge, 'strike', res === 'snap');
          if (res === 'steep') this.after(0.32, () => this.grit(edge));
          if (res === 'mid') this.after(0.4, () => { audio.human('grunt', 0.4); z.setFace({ squint: 0.6, frown: 0.5 }); });
        } },
        { key: line[res], who: 'scientist', shot: () => cover.close(z, 0.4, 0.95), run: () => z.setFace({ squint: 0.3, frown: 0.3 }), after: 0.2 },
      ], () => { z.setFace(null); this.after(0.4, () => this.knap()); });
      return;
    }
    // it works: a long thin flake peels off the edge; he picks it up, tests it on his thumb, it cuts him
    let flake: THREE.Mesh | null = null;
    this.playScene([
      { hold: 1.4, shot: () => this.stoneShot(core, 0.75), run: () => {
        this.tap(edge, 'strike');
        this.after(0.33, () => { flake = flakeMesh(); flake.position.copy(edge).addScaledVector(f, -0.1).add(new THREE.Vector3(0, 0.012, 0)); flake.rotation.y = z.root.rotation.y; site.group.add(flake); });
      } },
      { hold: 2.2, shot: () => cover.close(z, 0.5, 0.8, 0.12), run: () => {
        flake?.removeFromParent(); z.setProp('flake');
        const m = new THREE.Vector3().setFromMatrixPosition(z.head.matrixWorld);
        const hand = m.clone().addScaledVector(f, 0.3).add(new THREE.Vector3(0, -0.3, 0));
        z.setHold({ R: { at: hand, fingers: f.clone(), palm: new THREE.Vector3(0, 1, 0) }, L: { at: hand.clone().add(new THREE.Vector3(0, -0.02, 0)).addScaledVector(new THREE.Vector3(f.z, 0, -f.x), 0.05), fingers: f.clone(), palm: new THREE.Vector3(0, 1, 0) } });
        z.setLookTarget(hand);
        this.after(1.3, () => { audio.human('breath', 0.5); z.setFace({ squint: 0.5, open: 0.2 }); });
      } },
      // the thumb to his mouth (no line), then the line
      { hold: 1.4, shot: () => cover.close(z, 0.35, 0.85), run: () => {
        const mouth = new THREE.Vector3().setFromMatrixPosition(z.head.matrixWorld).addScaledVector(f, 0.11).add(new THREE.Vector3(0, -0.08, 0));
        z.setHold({ L: { at: mouth, fingers: new THREE.Vector3(0, 1, 0).addScaledVector(f, -0.5).normalize(), palm: f.clone().negate() } });
        z.setLookTarget(null); z.setFace({ squint: 0.2 });
      } },
      { key: line.ok, who: 'scientist', shot: () => cover.close(z, 0.3, 0.95), run: () => { z.setHold(null); z.setFace({ smile: 0.35 }); }, after: 0.5 },
    ], () => {
      this.s.flags['inv.flake'] = true;
      this.ui.toast(t('e1.learn.flake'));
      z.setProp(null); z.setHold(null); z.setFace(null); z.setLimbs(null); z.setLookTarget(null); z.setKneel(false);
    });
  }

  /** Crumbs off a strike that came down too steep. */
  private grit(at: THREE.Vector3) {
    const N = 10, g = new THREE.TetrahedronGeometry(0.008), mat = new THREE.MeshStandardMaterial({ color: 0x3a3b40, roughness: 0.4 });
    const bits = new THREE.InstancedMesh(g, mat, N); bits.frustumCulled = false;
    const t0 = performance.now(), m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    bits.onBeforeRender = () => {
      const s = Math.min(0.5, (performance.now() - t0) / 1000);
      for (let i = 0; i < N; i++) {
        p.set(at.x + Math.cos(i * 2.1) * 0.3 * s, Math.max(at.y - 0.03, at.y + 0.02 + 1.0 * s - 4.9 * s * s), at.z + Math.sin(i * 2.1) * 0.3 * s);
        bits.setMatrixAt(i, m4.compose(p, q.setFromAxisAngle(one, s * 9 + i), one));
      }
      bits.instanceMatrix.needsUpdate = true;
    };
    this.site!.group.add(bits);
    this.after(2.5, () => { bits.removeFromParent(); g.dispose(); mat.dispose(); bits.dispose(); });
  }
}

/** A river cobble of a kind: a rounded, slightly flattened stone about 13 cm long (`k` scales it). */
function cobble(kind: Kind, seed: number, k = 1): THREE.Mesh {
  const raw = new THREE.IcosahedronGeometry(1, 3); raw.deleteAttribute('normal'); raw.deleteAttribute('uv');
  const g = mergeVertices(raw), p = g.getAttribute('position'), n = new Simplex(seed);
  const col = new Float32Array(p.count * 3), c = new THREE.Color();
  const base = kind === 'flint' ? 0x24262c : kind === 'granite' ? 0x6f7073 : 0x7a5f45;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const m = 1 + 0.12 * n.noise2(x * 1.6 + y, z * 1.6) + (kind === 'flint' ? 0.06 * Math.abs(n.noise2(x * 4, y * 4 + z)) : 0);
    p.setXYZ(i, x * 0.065 * m * k, y * 0.04 * m * k, z * 0.05 * m * k);
    c.set(base);
    // granite: black and white specks; sandstone: bands; flint: a pale chalky skin on part of it
    if (kind === 'granite') { const h = n.noise2(x * 18, z * 18 + y * 9); c.multiplyScalar(h > 0.55 ? 0.35 : h < -0.6 ? 1.3 : 1); }
    else if (kind === 'sand') c.multiplyScalar(0.85 + 0.2 * Math.sin(y * 14 + n.noise2(x * 3, z * 3) * 2));
    else if (x + 0.3 * n.noise2(y * 2, z * 2) > 0.55) c.set(0xc9c2b0);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: kind === 'flint' ? 0.22 : kind === 'granite' ? 0.75 : 0.95, metalness: kind === 'flint' ? 0.08 : 0 });
  const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

/** A flint flake: long, thin, sharp-edged, dark and glassy, a little curved. */
export function flakeMesh(): THREE.Mesh {
  const g = new THREE.CylinderGeometry(0.0, 0.022, 0.07, 5, 1);
  g.scale(1, 1, 0.22); g.rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.15, metalness: 0.1 }));
  mesh.castShadow = true;
  return mesh;
}
