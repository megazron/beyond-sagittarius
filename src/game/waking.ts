import * as THREE from 'three';
import { audio } from '../core/audio';
import { t } from '../i18n';
import type { SaveData } from '../core/save';
import type { World } from '../world/world';
import type { UI } from '../ui/ui';
import type { Player } from './player';
import { cover, type Beat, type Shot } from '../cinematic/cutscene';
import { createStream, type StreamWater } from '../world/stream';
import type { Cond } from './branch';

const ATE: Cond = { chose: ['e1.fruit', 'eat'] };
const TESTED: Cond = { chose: ['e1.fruit', 'test'] };
const HUNGRY: Cond = { chose: ['e1.fruit', 'hungry'] };

/**
 * Episode One 1.1, Zenvik's first hours awake: his body before the view, thirst, listening for water, the wrong
 * water and the right one, a leaf that will not hold it, and the red fruit (decision e1.fruit).
 * The world parts (the stream, the pool, the reeds) are in world/stream.ts.
 */
export class Waking {
  stream: StreamWater;
  private sounds: { set(v: number): void }[] = [];
  private v = new THREE.Vector3();

  constructor(
    private world: World,
    private player: Player,
    private ui: UI,
    private getSave: () => SaveData,
    private playScene: (beats: Beat[], then?: () => void) => void,
    private after: (sec: number, fn: () => void) => void,
  ) {
    const mat = world.water.mesh.material as THREE.ShaderMaterial;
    this.stream = createStream(world.terrain, mat.uniforms, world.streamPlan);
    world.scene.add(this.stream.group);
    world.grass.setRibbon(this.stream.mask);
  }

  private get s() { return this.getSave(); }
  private get z() { return this.player.model; }

  /** The water sound starts with play (the audio context exists by then). */
  startSound() {
    if (this.sounds.length) return;
    this.sounds = this.stream.soundAt.map((p) => audio.emitter('amb_lake', p, 0.55, 2.5, 38));
  }
  /** Off when the game is somewhere else (another world, a film). */
  setAudible(on: boolean) { for (const e of this.sounds) e.set(on ? 0.55 : 0); }

  /** A point in front of his chest, for his hands and his eyes. */
  private chest(fwd: number, right: number, down: number) {
    const m = this.z, f = new THREE.Vector3(Math.sin(m.root.rotation.y), 0, Math.cos(m.root.rotation.y));
    const r = new THREE.Vector3(f.z, 0, -f.x);
    // from where his head is (kneeling lowers it), down: standing, the head sits about 1.62 m up
    const head = new THREE.Vector3().setFromMatrixPosition(m.head.matrixWorld);
    const base = this.player.pos.clone(); base.y = Math.min(head.y, base.y + 1.62);
    return base.add(new THREE.Vector3(0, -down, 0)).addScaledVector(f, fwd).addScaledVector(r, right);
  }

  /** Hands in front of him, palms up (or down): he looks at them. */
  private hands(palmsUp: boolean) {
    const m = this.z, f = new THREE.Vector3(Math.sin(m.root.rotation.y), 0, Math.cos(m.root.rotation.y));
    const up = new THREE.Vector3(0, palmsUp ? 1 : -1, 0);
    const fingers = f.clone().multiplyScalar(0.9).add(new THREE.Vector3(0, 0.25, 0)).normalize();
    m.setHold({
      L: { at: this.chest(0.34, 0.1, 0.42), fingers, palm: up.clone() },
      R: { at: this.chest(0.34, -0.1, 0.42), fingers, palm: up.clone() },
    });
    m.setLookTarget(this.chest(0.34, 0, 0.46));
  }

  private release() {
    this.z.setHold(null);
    this.z.setLookTarget(null);
    this.z.setFace(null);
    this.z.setLimbs(null);
  }

  /** Step 1-2: the first thing he checks is himself, then thirst. Played as play begins on a fresh game when the
   * wake ran to its end; after a skip only his line plays. */
  thirst(acted: boolean, then: () => void) {
    const s = this.s;
    if (s.flags['e1.thirst']) { then(); return; }
    s.flags['e1.thirst'] = true;
    // the player skipped the wake: no more film, the beat is a line in play
    if (!acted) { then(); this.after(1.6, () => this.ui.say('e1.w.1', 'crew.scientist.name', 3)); return; }
    const z = this.z;
    this.playScene([
      { hold: 1.5, shot: () => cover.mid(z, 0.55, 1.5), poses: { scientist: 'stand' }, run: () => { this.hands(true); z.setFace({ squint: 0.35 }); audio.human('breath', 0.5); } },
      { hold: 1.4, run: () => this.hands(false) },
      { hold: 1.2, shot: () => cover.close(z, 0.35, 0.9), run: () => {
        this.release();
        z.setFace({ squint: 0.2, open: 0.1 });
        // the swallow: a dry click in the throat, no line
        audio.tone(1900, 0.025, 'square', 0.05); audio.tone(240, 0.06, 'sine', 0.08, 0.02, -80);
      } },
      { key: 'e1.w.1', who: 'scientist', shot: () => cover.close(z, 0.3, 0.95), after: 0.5, run: () => z.setFace(null) },
    ], () => { this.release(); then(); });
  }

  /** Step 3: he stops and listens. Once, as he first comes within earshot of the stream. */
  update() {
    const s = this.s;
    if (s.level !== 1 || s.flags['e1.listen'] || s.flags.drank) return;
    // once he has left the wake spot and the water is near enough to hear, not yet in sight at his feet
    // (he stops while walking: a player standing still is busy with something else)
    if (Math.hypot(this.player.pos.x, this.player.pos.z) < 9 || this.player.speedNow < 0.8) return;
    const d = this.stream.nearest(this.player.pos, this.v);
    if (d > 30 || d < 8) return;
    s.flags['e1.listen'] = true;
    const z = this.z, at = this.v.clone();
    const lakeward = this.player.pos.clone().lerp(at, 0.6).add(new THREE.Vector3(0, -1.5, 0));
    this.playScene([
      // the music drops out; he turns his head to the sound and holds still
      { hold: 2.2, shot: () => cover.close(z, -0.45, 1.0), run: () => { audio.duck(true); z.setLookTarget(at.clone().add(new THREE.Vector3(0, 1.4, 0))); z.setGazeRate(5); } },
      // then he leans to see which way the ground falls
      { key: 'e1.w.2', who: 'scientist', shot: () => cover.mid(z, 0.5, 2.3), run: () => { z.setLimbs({ bend: 0.45 }); z.setLookTarget(lakeward); }, after: 0.4 },
    ], () => { audio.duck(false); z.setGazeRate(null); this.release(); });
  }

  /** Which water is at his feet: the stream, the pool, or neither. */
  source(p: THREE.Vector3): 'stream' | 'pool' | null {
    if (this.stream.inPool(p.x, p.z, 1.3)) return 'pool';
    if (this.stream.nearest(p, this.v) < 1.7) return 'stream';
    return null;
  }

  /** Steps 4-5. Returns true when it took the drink (and the level). */
  drink(src: 'stream' | 'pool') {
    const s = this.s, st = s.stats;
    if (src === 'pool') {
      st.thirst = Math.min(100, st.thirst + 12);
      st.health = Math.max(1, st.health - 4);
      const first = !s.flags['sick.water'];
      s.flags['sick.water'] = true;
      this.ui.say('e1.w.fail', 'crew.scientist.name', 3.4);
      if (first) this.after(3.8, () => this.ui.toast(t('e1.w.failHint')));
      audio.human('grunt', 0.5);
      return;
    }
    st.thirst = Math.min(100, st.thirst + 40);
    if (s.flags.drankStream) return;
    s.flags.drankStream = true;
    this.ui.toast(t('msg.drink'));
    // the first real drink is acted, close enough to see it: he goes down on his knees on the bank, drinks from
    // cupped hands, then folds a leaf into a cup that leaks
    const z = this.z, spot = this.stream.bankSpot(this.player.pos);
    const fwd = new THREE.Vector3(-Math.sin(spot.facing), 0, -Math.cos(spot.facing));
    // the water just off the bank, where his hands go in
    const dip = spot.at.clone().addScaledVector(fwd, 0.62).setY(Math.max(spot.water.y - 0.02, spot.at.y - 0.45));
    s.flags['e1.leaf'] = true;
    // he kneels in the reeds and flattens them; the camera stands beside him on the bank, clear of them
    this.stream.clearReeds(spot.at, 1.1);
    this.after(0.9, () => this.playScene([
      // he kneels at the edge, looking at the water (a cut hides the step onto the bank)
      { hold: 1.7, shot: () => cover.mid(z, 0.9, 2.3), run: () => {
        this.place(spot.at, spot.facing);
        z.setKneel(true); z.setLookTarget(dip.clone());
        audio.sample('leather', 0.18, { rate: 0.7 });
      } },
      // cupped hands in, up to his mouth; it runs down his chin
      { hold: 3.0, shot: () => this.bankShot(dip, 1.75, 0.95), run: () => {
        z.setLimbs({ bend: 0.5 });
        z.doTask('drink', { at: dip.clone(), seconds: 2.8, hands: 'both', prop: null });
        this.after(0.7, () => audio.sample('splash', 0.22, { rate: 1.3 }));
        this.after(1.7, () => audio.sample('drink', 0.55));
        this.after(2.3, () => audio.sample('splash', 0.06, { rate: 2.4 }));
      } },
      // a laugh that is half a sob, still on his knees
      { key: 'e1.w.ok', who: 'scientist', shot: () => cover.close(z, 0.45, 0.95), run: () => { z.stopTask(); z.setLimbs({ bend: 0.12 }); z.setLookTarget(null); z.setFace({ smile: 0.45, frown: 0.3 }); audio.human('laugh', 0.35); }, after: 0.5 },
      { key: 'e1.w.ammi', who: 'scientist', if: { flag: 'ammi.called' }, shot: () => cover.close(z, -0.35, 1.0), run: () => z.setFace({ smile: 0.25 }), after: 0.4 },
      // a broad leaf, rolled into a cone in his hands
      { hold: 1.6, shot: () => this.handsShot(this.chest(0.3, 0, 0.5), 0.85), run: () => {
        z.setFace(null); z.setLimbs({ bend: 0.15 });
        z.setProp('leaf'); this.cupHands(0.3);
        audio.sample('leather', 0.25);
      } },
      // dipped full: framed on its own, the leaf going into the water
      { hold: 1.9, shot: () => this.dipShot(dip), run: () => {
        z.setHold(null);
        z.doTask('pickup', { at: dip.clone(), seconds: 1.4, hands: 'R', prop: 'leaf' });
        this.after(0.6, () => audio.sample('splash', 0.14, { rate: 1.8 }));
      } },
      // and it runs out through his fingers while he watches
      { hold: 2.8, shot: () => this.handsShot(this.chest(0.3, 0, 0.62), 0.78), run: () => {
        z.setProp('leaf'); this.cupHands(0.3);
        this.leak(2.6);
        this.after(0.5, () => audio.sample('splash', 0.08, { rate: 2.6 }));
        this.after(1.2, () => audio.sample('splash', 0.06, { rate: 2.9 }));
      } },
      { key: 'e1.w.leaf', who: 'scientist', shot: () => cover.close(z, 0.35, 0.95), run: () => { z.setFace({ squint: 0.3 }); }, after: 0.5 },
    ], () => { this.release(); z.setProp(null); z.setKneel(false); s.flags.drank = true; }));
  }

  /** Stand him at a spot facing a way, now (a cut hides it). */
  private place(at: THREE.Vector3, facing: number) {
    const p = this.player;
    p.pos.copy(at); p.vel.set(0, 0, 0); p.facing = facing;
    p.model.root.position.copy(at); p.model.root.rotation.y = facing + Math.PI; p.model.root.updateMatrixWorld(true);
  }

  /** From the bank beside him, above, looking down past his hands at the water: the surface, the stones under it.
   * `side` metres out along the bank, `up` above the water, `lead` towards the water from his line. */
  private bankShot(at: THREE.Vector3, side: number, up: number, lead = -0.15): Shot {
    const f = this.fwd(), r = new THREE.Vector3(f.z, 0, -f.x);
    const head = new THREE.Vector3().setFromMatrixPosition(this.z.head.matrixWorld);
    const to = at.clone().lerp(head, 0.3);
    const from = at.clone().addScaledVector(r, side).addScaledVector(f, lead).setY(at.y + up);
    this.stream.clearReeds(from, 0.9);
    return { from, to, push: 0.03 };
  }

  /** The leaf going into the water: from the bank behind his shoulder, high enough to look down on the surface (low
   * over the stream the current threads smear across the lens). */
  private dipShot(dip: THREE.Vector3): Shot {
    const f = this.fwd(), r = new THREE.Vector3(f.z, 0, -f.x);
    const from = dip.clone().addScaledVector(r, 0.75).addScaledVector(f, -0.85).setY(dip.y + 1.05);
    this.stream.clearReeds(from, 0.9);
    return { from, to: dip.clone().add(new THREE.Vector3(0, 0.08, 0)), push: 0.02 };
  }

  /** Close on his hands and what they do, from his side, his face in the top of frame. */
  private handsShot(at: THREE.Vector3, dist: number): Shot {
    const m = this.z, f = new THREE.Vector3(Math.sin(m.root.rotation.y), 0, Math.cos(m.root.rotation.y));
    const r = new THREE.Vector3(f.z, 0, -f.x);
    const head = new THREE.Vector3().setFromMatrixPosition(m.head.matrixWorld);
    const to = at.clone().lerp(head, 0.35);
    return { from: to.clone().addScaledVector(f, dist * 0.75).addScaledVector(r, dist * 0.7).add(new THREE.Vector3(0, 0.12 + dist * 0.15, 0)), to, push: 0.04 };
  }

  /** Both hands together in front of his chest, palms up round what the right one holds. */
  private cupHands(fwd: number) {
    const m = this.z, f = new THREE.Vector3(Math.sin(m.root.rotation.y), 0, Math.cos(m.root.rotation.y));
    const fingers = f.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.4, 0)).normalize();
    m.setHold({ L: { at: this.chest(fwd, 0.045, 0.5), fingers, palm: new THREE.Vector3(0.3, 1, 0).normalize(), radius: 0.04 }, R: { at: this.chest(fwd, -0.045, 0.5), fingers, palm: new THREE.Vector3(-0.3, 1, 0).normalize(), radius: 0.04 } });
    m.setLookTarget(this.chest(fwd, 0, 0.52));
  }

  /** Water dripping and trickling out from under his hands for `sec` seconds, then gone. */
  private leak(sec: number) {
    // big enough to read at a game frame rate: drops about a centimetre, lit a little from inside so they catch light
    const N = 22, g = new THREE.SphereGeometry(0.012, 8, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd6eef4, emissive: 0x6d8f99, emissiveIntensity: 0.55, roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.92 });
    const drops = new THREE.InstancedMesh(g, mat, N);
    drops.frustumCulled = false; drops.castShadow = false; drops.name = 'e1-leak';
    const born = performance.now() / 1000, m4 = new THREE.Matrix4(), hand = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const ground = this.world.terrain.height(this.player.pos.x, this.player.pos.z);
    drops.onBeforeRender = () => {
      const now = performance.now() / 1000, age = now - born;
      this.z.handR.getWorldPosition(hand);
      for (let i = 0; i < N; i++) {
        // each drop leaves the hand on its own beat and falls; a trickle at first, slower drips at the end
        const per = 0.22 + (i % 5) * 0.08 + age * 0.1, ph = ((age + i * 0.137) % per) / per;
        const fall = 0.5 * 9.8 * (ph * per) * (ph * per);
        const y = Math.max(ground + 0.01, hand.y - 0.05 - fall);
        sc.set(1, 1 + Math.min(4, fall * 9), 1);
        m4.compose(new THREE.Vector3(hand.x + Math.sin(i * 2.4) * 0.03, y, hand.z + Math.cos(i * 1.7) * 0.03), q, sc);
        drops.setMatrixAt(i, m4);
      }
      drops.instanceMatrix.needsUpdate = true;
      mat.opacity = 0.92 * Math.max(0, Math.min(1, (sec - age) / 0.4));
    };
    this.world.scene.add(drops);
    this.after(sec + 0.1, () => { drops.removeFromParent(); g.dispose(); mat.dispose(); drops.dispose(); });
  }

  /** Step 6: the red fruit, the first time he comes up to one. Returns true if it took the moment. */
  fruit(pos: THREE.Vector3, take: () => void): boolean {
    const s = this.s;
    if (s.flags['e1.fruitSeen']) return false;
    s.flags['e1.fruitSeen'] = true;
    const z = this.z, at = pos.clone();
    const st = s.stats;
    // he turns to the bush; the fruit and his face in one frame
    const face = Math.atan2(-(at.x - this.player.pos.x), -(at.z - this.player.pos.z));
    // he steps up to the bush (the cut hides it): an arm's length from the fruit, so both are in one frame
    const near = at.clone().setY(this.player.pos.y);
    const stand = near.clone().add(this.player.pos.clone().sub(near).setY(0).setLength(0.8));
    stand.y = this.world.terrain.height(stand.x, stand.z);
    const mouth = () => new THREE.Vector3().setFromMatrixPosition(z.head.matrixWorld).addScaledVector(this.fwd(), 0.1).add(new THREE.Vector3(0, -0.075, 0));
    const wrist = () => this.chest(0.3, 0.06, 0.52);
    let rub: (() => void) | null = null;
    this.playScene([
      { key: 'e1.fr.see', who: 'scientist', shot: () => this.twoShot(at), run: () => {
        this.place(stand, face);
        z.setLookTarget(at); z.setLimbs({ bend: 0.3 });
      } },
      { choice: 'e1.fruit', shot: () => this.twoShot(at, 1.25) },
      { key: 'e1.fr.eat', who: 'scientist', if: ATE, shot: () => cover.close(z, 0.35, 0.95), run: () => {
        this.release(); this.player.act('eat', null, undefined, 'berry'); take();
        st.hunger = Math.min(100, st.hunger + 16); st.health = Math.max(1, st.health - 8);
      }, after: 0.6 },
      // TEST IT FIRST. He picks one berry and holds it up to look at it, and Lyrra's voice comes back to him
      { hold: 1.5, if: TESTED, shot: () => this.twoShot(at, 1.1), run: () => {
        this.release();
        z.doTask('pickup', { at: at.clone(), seconds: 1.3, hands: 'R', prop: 'berry' });
        this.after(1.25, () => z.setProp('berry'));
      } },
      { hold: 3.2, if: TESTED, shot: () => this.handsShot(this.chest(0.3, 0, 0.5), 0.8), run: () => {
        z.setProp('berry');
        this.ui.memory('e1.fr.lyrra', 9);
        // skin first: rubbed on the inside of his left wrist
        const w = wrist(), r = w.clone().add(new THREE.Vector3(0, 0.035, 0));
        const f = this.fwd(), side = new THREE.Vector3(f.z, 0, -f.x);
        z.setHold({
          L: { at: w, fingers: f.clone().add(side.clone().multiplyScalar(-0.6)).normalize(), palm: new THREE.Vector3(0, 1, 0) },
          R: { at: r, fingers: f.clone().add(side.clone().multiplyScalar(0.5)).normalize(), palm: new THREE.Vector3(0, -1, 0) },
        });
        z.setLookTarget(w.clone());
        const r0 = r.clone(), t0 = performance.now();
        rub = () => { const k = (performance.now() - t0) / 1000; r.copy(r0).addScaledVector(side, Math.sin(k * 9) * 0.02); };
        this.ticker(3.0, () => rub?.());
      } },
      // then the lip: he touches it to his lower lip and holds it there
      { hold: 2.4, if: TESTED, shot: () => cover.close(z, 0.25, 0.75, 0.0), run: () => {
        rub = null;
        const m = mouth(), f = this.fwd();
        z.setHold({ R: { at: m.clone().addScaledVector(f, 0.03).add(new THREE.Vector3(0, -0.02, 0)), fingers: f.clone().negate().add(new THREE.Vector3(0, 0.3, 0)).normalize(), palm: new THREE.Vector3(0, 0, 0).sub(f).normalize() } });
        z.setLookTarget(m.clone().addScaledVector(f, 0.4).add(new THREE.Vector3(0, -0.25, 0)));
        z.setFace({ squint: 0.15 });
      } },
      // and waits: the hand comes down, he is very still
      { hold: 2.6, if: TESTED, shot: () => cover.close(z, -0.4, 0.85), run: () => {
        z.setHold({ R: { at: this.chest(0.28, -0.08, 0.55), fingers: this.fwd(), palm: new THREE.Vector3(0, 1, 0) } });
        z.setLookTarget(null); z.setFace({ open: 0.05 });
        audio.human('breath', 0.35);
        // the lip starts to tingle
        this.after(1.6, () => z.setFace({ squint: 0.55, frown: 0.5, open: 0.15 }));
      } },
      // he spits, wipes his mouth with the back of his hand, and throws the berry away
      { hold: 1.9, if: TESTED, shot: () => this.profile(0.95), run: () => {
        z.setProp(null);
        z.setHold(null);
        const f = this.fwd(), side = new THREE.Vector3(f.z, 0, -f.x);
        z.setLookTarget(mouth().addScaledVector(f, 1.0).addScaledVector(side, -0.3).add(new THREE.Vector3(0, -0.45, 0)));
        z.setFace({ frown: 0.7, squint: 0.6, open: 0.3 });
        this.after(0.25, () => { audio.sample('splash', 0.07, { rate: 3.1 }); audio.human('breath', 0.5); this.spit(mouth(), f.clone().addScaledVector(side, -0.3).normalize()); });
        // the back of his hand across his mouth
        this.after(0.85, () => z.setHold({ R: { at: mouth().addScaledVector(f, 0.05), fingers: side.clone().negate(), palm: f.clone() } }));
        this.after(1.45, () => z.setHold(null));
      } },
      { key: 'e1.fr.test', who: 'scientist', if: TESTED, shot: () => cover.close(z, 0.3, 0.95), run: () => { z.setLookTarget(null); z.setFace({ smile: 0.4 }); }, after: 0.5 },
      { key: 'e1.fr.no', who: 'scientist', if: HUNGRY, shot: () => cover.close(z, 0.3, 0.95), run: () => this.release(), after: 0.5 },
    ], () => { rub = null; z.setProp(null); this.release(); });
    return true;
  }

  /** His face in profile from his right, with room in front of it (for what leaves his mouth). */
  private profile(dist: number): Shot {
    const f = this.fwd(), r = new THREE.Vector3(f.z, 0, -f.x);
    const head = new THREE.Vector3().setFromMatrixPosition(this.z.head.matrixWorld);
    const to = head.clone().addScaledVector(f, 0.32).add(new THREE.Vector3(0, -0.14, 0));
    return { from: to.clone().addScaledVector(r, dist).addScaledVector(f, 0.45).add(new THREE.Vector3(0, -0.12, 0)), to, push: 0.02 };
  }

  private fwd() { const r = this.z.root.rotation.y; return new THREE.Vector3(Math.sin(r), 0, Math.cos(r)); }

  /** He and the fruit in one frame: from beyond the bush, to the side, his face over it. */
  private twoShot(fruit: THREE.Vector3, dist = 1.5): Shot {
    const head = new THREE.Vector3().setFromMatrixPosition(this.z.head.matrixWorld);
    const d = fruit.clone().sub(head).setY(0).normalize(), r = new THREE.Vector3(d.z, 0, -d.x);
    const to = head.clone().lerp(fruit, 0.45).add(new THREE.Vector3(0, -0.1, 0));
    return { from: to.clone().addScaledVector(d, dist * 0.55).addScaledVector(r, dist * 0.95).add(new THREE.Vector3(0, 0.1, 0)), to, push: 0.05 };
  }

  /** Calls fn every frame for `sec` seconds of real time. */
  private ticker(sec: number, fn: () => void) {
    const end = performance.now() + sec * 1000;
    const f = () => { fn(); if (performance.now() < end) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }

  /** A little spray from his mouth that arcs to the ground. */
  private spit(from: THREE.Vector3, dir: THREE.Vector3) {
    // spittle and bits of the red skin: a fan of drops, the bits bigger, slow enough to see at a game frame rate
    const N = 18, g = new THREE.SphereGeometry(0.0075, 8, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, transparent: true, opacity: 0.9 });
    const drops = new THREE.InstancedMesh(g, mat, N);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) drops.setColorAt(i, i % 3 === 0 ? c.set(0xb01a28) : c.set(0xe9dcd8));
    drops.frustumCulled = false; drops.name = 'e1-spit';
    const t0 = performance.now() / 1000, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const ground = this.world.terrain.height(from.x, from.z);
    drops.onBeforeRender = () => {
      const k = performance.now() / 1000 - t0;
      for (let i = 0; i < N; i++) {
        const sp = 1.1 + (i % 4) * 0.3, tt = Math.max(0, k - i * 0.02);
        p.copy(from).addScaledVector(dir, sp * tt).add(new THREE.Vector3(Math.sin(i * 3.1) * 0.35 * tt, 1.3 * tt - 4.9 * tt * tt, Math.cos(i * 2.3) * 0.35 * tt));
        p.y = Math.max(p.y, ground + 0.005);
        drops.setMatrixAt(i, m4.compose(p, q, one.setScalar(i % 3 === 0 ? 1.5 : 1)));
      }
      drops.instanceMatrix.needsUpdate = true;
    };
    this.world.scene.add(drops);
    this.after(1.6, () => { drops.removeFromParent(); g.dispose(); mat.dispose(); drops.dispose(); });
  }
}
