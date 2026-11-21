import * as THREE from 'three';
import { audio } from '../core/audio';
import { t } from '../i18n';
import type { SaveData } from '../core/save';
import type { World } from '../world/world';
import type { UI } from '../ui/ui';
import type { Player } from './player';
import { cover, type Beat } from '../cinematic/cutscene';
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
    this.stream = createStream(world.terrain, mat.uniforms);
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
    return this.player.pos.clone().add(new THREE.Vector3(0, 1.62 - down, 0)).addScaledVector(f, fwd).addScaledVector(r, right);
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
    // the first real drink is acted, close enough to see it: on his knees, cupped hands, then the leaf that leaks
    const z = this.z, water = new THREE.Vector3();
    this.stream.nearest(this.player.pos, water);
    s.flags['e1.leaf'] = true;
    this.after(0.9, () => this.playScene([
      { hold: 2.6, shot: () => cover.mid(z, 0.75, 1.7), run: () => {
        z.setLookTarget(water.clone());
        z.doTask('drink', { at: water.clone().add(new THREE.Vector3(0, 0.15, 0)), seconds: 2.4, hands: 'both' });
        this.after(0.6, () => audio.sample('splash', 0.2, { rate: 1.3 }));
        this.after(1.6, () => audio.sample('drink', 0.5));
      } },
      // a laugh that is half a sob
      { key: 'e1.w.ok', who: 'scientist', shot: () => cover.close(z, 0.4, 0.95), run: () => { z.stopTask(); z.setLookTarget(null); z.setFace({ smile: 0.45, frown: 0.25 }); audio.human('laugh', 0.35); }, after: 0.5 },
      { key: 'e1.w.ammi', who: 'scientist', if: { flag: 'ammi.called' }, shot: () => cover.close(z, -0.35, 1.0), run: () => z.setFace({ smile: 0.25 }), after: 0.4 },
      // the leaf: folded into a cone in his cupped hands, and it runs out through his fingers
      { hold: 2.2, shot: () => cover.mid(z, -0.6, 1.4), run: () => {
        z.setFace(null);
        const m = z, f = new THREE.Vector3(Math.sin(m.root.rotation.y), 0, Math.cos(m.root.rotation.y));
        const fingers = f.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.4, 0)).normalize();
        m.setHold({ L: { at: this.chest(0.32, 0.035, 0.5), fingers, palm: new THREE.Vector3(0, 1, 0), radius: 0.03 }, R: { at: this.chest(0.32, -0.035, 0.5), fingers, palm: new THREE.Vector3(0, 1, 0), radius: 0.03 } });
        m.setLookTarget(this.chest(0.32, 0, 0.52));
        audio.sample('leather', 0.25);
        this.after(0.8, () => audio.sample('splash', 0.12, { rate: 2.2 }));
        this.after(1.4, () => audio.sample('splash', 0.08, { rate: 2.6 }));
      } },
      { key: 'e1.w.leaf', who: 'scientist', shot: () => cover.close(z, 0.35, 0.95), run: () => { z.setHold(null); z.setFace({ squint: 0.3 }); }, after: 0.5 },
    ], () => { this.release(); s.flags.drank = true; }));
  }

  /** Step 6: the red fruit, the first time he comes up to one. Returns true if it took the moment. */
  fruit(pos: THREE.Vector3, take: () => void): boolean {
    const s = this.s;
    if (s.flags['e1.fruitSeen']) return false;
    s.flags['e1.fruitSeen'] = true;
    const z = this.z, at = pos.clone();
    const st = s.stats;
    this.playScene([
      { key: 'e1.fr.see', who: 'scientist', shot: () => cover.mid(z, 0.55, 1.8), run: () => { z.setLookTarget(at); z.setLimbs({ bend: 0.35 }); } },
      { choice: 'e1.fruit', shot: () => cover.mid(z, 0.45, 2.2) },
      { key: 'e1.fr.eat', who: 'scientist', if: ATE, shot: () => cover.close(z, 0.35, 0.95), run: () => {
        this.release(); this.player.act('eat'); take();
        st.hunger = Math.min(100, st.hunger + 16); st.health = Math.max(1, st.health - 8);
      }, after: 0.6 },
      { hold: 6.5, if: TESTED, shot: () => cover.mid(z, -0.5, 1.6), run: () => {
        this.release();
        this.ui.memory('e1.fr.lyrra', 7);
        // skin first: the inside of the wrist
        z.setHold({ R: { at: this.chest(0.3, -0.02, 0.55), fingers: new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), z.root.rotation.y), palm: new THREE.Vector3(0, -1, 0) } });
        z.setLookTarget(this.chest(0.3, 0, 0.58));
        this.after(3.4, () => { z.setHold(null); this.player.act('eat'); });
        this.after(5.0, () => { z.setFace({ squint: 0.6, frown: 0.5 }); audio.human('breath', 0.6); });
      } },
      { key: 'e1.fr.test', who: 'scientist', if: TESTED, shot: () => cover.close(z, 0.3, 0.95), run: () => z.setFace({ smile: 0.4 }), after: 0.5 },
      { key: 'e1.fr.no', who: 'scientist', if: HUNGRY, shot: () => cover.close(z, 0.3, 0.95), run: () => this.release(), after: 0.5 },
    ], () => this.release());
    return true;
  }
}
