import * as THREE from 'three';
import type { CrewId } from '../characters/character';
import type { ArrivalDef, BodyKey, V3, LimbName, ArrivalCtx } from './arrival';
import { audio } from '../core/audio';

/*
 * The six arrivals, as data. Physics and acting: ~/bs-story/LANDINGS.md. Landing frame: x right, y up, z forward
 * (forward is where they face once up). Poses below are bodies, not gestures: the hips somewhere, the spine and chest
 * pointed, each limb pointed, so a lying body is crumpled and a hand stays where it was put.
 */

type K = Omit<BodyKey, 't'>;
type L = Partial<Record<LimbName, V3>>;
const key = (t: number, b: K, o: Partial<K> = {}): BodyKey => ({ ...b, ...o, limbs: { ...b.limbs, ...o.limbs }, t });
const mir = (l: L): L => Object.fromEntries(Object.entries(l).map(([n, v]) => [n.endsWith('L') ? n.slice(0, -1) + 'R' : n.slice(0, -1) + 'L', [-v![0], v![1], v![2]]])) as L;

// ---- the body library (right-handed versions; mir() swaps sides) ----
/** Out cold on the back, feet the way they will face; one knee up, one arm flung out. */
const BACK: K = {
  clip: 'lie', at: [0.05, 0.12, -0.35], head: [0.04, 0.06, -1], chest: [0.16, 1, 0.04],
  limbs: { armL: [-0.82, -0.12, -0.55], foreL: [-0.45, -0.12, -0.88], armR: [0.42, -0.14, 0.9], foreR: [0.22, -0.1, 0.97],
    legL: [-0.2, -0.08, 1], shinL: [-0.13, -0.1, 1], legR: [0.26, 0.42, 0.87], shinR: [0.12, -0.5, 0.86] },
  face: { blink: 1, open: 0.18 }, look: [0.55, 0],
};
/** Face down, head the way they will face, cheek on the ground; one arm up by the head, one along the side. */
const PRONE: K = {
  clip: 'lie', at: [0, 0.13, -0.7], head: [0, -0.04, 1], chest: [0, -1, 0],
  limbs: { armL: [-0.92, -0.1, 0.38], foreL: [-0.28, -0.12, 0.95], armR: [0.35, -0.16, -0.92], foreR: [0.26, -0.12, -0.96],
    legL: [-0.12, -0.1, -1], shinL: [-0.1, -0.12, -1], legR: [0.5, -0.12, -0.86], shinR: [-0.05, -0.1, -1] },
  face: { blink: 1, open: 0.15 }, look: [0.95, 0],
};
/** On the right side, curled: knees drawn up, arms in (what a hurt body does by itself). */
const SIDE_R: K = {
  clip: 'lie', at: [0.1, 0.17, -0.4], head: [0, 0.08, -1], chest: [1, 0, 0.05],
  limbs: { armR: [0.55, -0.25, -0.8], foreR: [0.85, -0.2, 0.45], armL: [0.6, 0.1, 0.25], foreL: [0.85, -0.15, -0.1],
    legL: [0.55, 0.05, 0.83], shinL: [-0.2, -0.05, 0.97], legR: [0.5, -0.15, 0.85], shinR: [-0.35, -0.12, 0.93] },
  face: { blink: 1, frown: 0.2 }, look: [0, 0.1],
};
/** Up on the right elbow from the side: the first try. */
const ELBOW_R: K = {
  clip: 'lie', at: [0.05, 0.2, -0.3], head: [0.06, 0.38, -0.92], chest: [0.9, 0.1, 0.05],
  limbs: { armR: [0.12, -0.96, 0.2], foreR: [0.35, -0.08, 0.93], armL: [0.45, -0.55, 0.7], foreL: [0.85, 0.1, 0.5],
    legL: [0.45, 0.05, 0.89], shinL: [-0.1, -0.05, 1], legR: [0.3, -0.15, 0.94], shinR: [-0.25, -0.12, 0.96] },
  face: { squint: 0.8, frown: 0.7, open: 0.25 }, look: [0, -0.15],
};
/** Sitting up, weight on the right hand behind, legs out: the world swims. */
const SITUP: K = {
  clip: 'lie', at: [0, 0.14, -0.15], head: [0.08, 0.86, -0.5], chest: [0.1, 0.5, 0.86],
  limbs: { armR: [0.35, -0.75, -0.55], foreR: [0.25, -0.85, -0.45], armL: [-0.2, -0.75, 0.6], foreL: [0.35, 0.05, 0.94],
    legL: [-0.12, -0.12, 1], shinL: [-0.05, -0.15, 1], legR: [0.12, 0.45, 0.88], shinR: [0.05, -0.6, 0.8] },
  bend: 0.25, face: { squint: 0.7, frown: 0.6 }, look: [0, 0.25],
};
/** Push-up from face down: chest off the ground on straight arms. */
const PUSH: K = {
  clip: 'lie', at: [0, 0.22, -0.62], head: [0, 0.42, 0.91], chest: [0, -0.9, 0.42],
  limbs: { armL: [-0.24, -0.93, 0.18], foreL: [-0.18, -0.95, 0.2], armR: [0.24, -0.93, 0.18], foreR: [0.18, -0.95, 0.2],
    legL: [-0.1, -0.24, -1], shinL: [-0.08, -0.1, -1], legR: [0.16, -0.24, -0.97], shinR: [0.05, -0.1, -1] },
  face: { squint: 0.9, frown: 0.8, open: 0.3 }, look: [0, -0.35],
};
/** Hands and knees. */
const FOURS: K = {
  clip: 'lie', at: [0, 0.5, -0.55], head: [0, 0.08, 1], chest: [0, -1, 0.06],
  limbs: { armL: [-0.16, -0.8, 0.48], foreL: [-0.1, -0.85, 0.45], armR: [0.16, -0.8, 0.48], foreR: [0.1, -0.85, 0.45],
    legL: [-0.1, -1, 0.06], shinL: [0, -0.07, -1], legR: [0.12, -1, 0.06], shinR: [0, -0.07, -1] },
  bend: 0.15, face: { squint: 0.6, frown: 0.6, open: 0.2 }, look: [0, -0.2],
};
/** On the left knee, right foot planted, right hand on the right knee: the last breath before standing. */
const KNEEL: K = {
  clip: 'lie', at: [0, 0.52, -0.38], head: [0, 1, 0.3], chest: [0, -0.3, 1],
  limbs: { legL: [-0.07, -1, 0.06], shinL: [0, -0.07, -1], legR: [0.12, 0.02, 1], shinR: [0, -1, 0.05],
    armR: [0.12, -0.62, 0.78], foreR: [0.02, -0.55, 0.84], armL: [-0.16, -0.95, 0.15], foreL: [-0.1, -0.9, 0.35] },
  bend: 0.4, face: { squint: 0.5, frown: 0.6, open: 0.15 }, look: [0, -0.2],
};
/** Up, bent over the hurt, weight on the good leg (the standing clip plants the feet). */
const UP: K = {
  clip: 'stand', feet: true, at: [0, 0, 0], head: [0, 1, 0], chest: [0, 0, 1],
  limbs: { armL: [-0.15, -0.98, 0.1], foreL: [-0.1, -0.95, 0.25] }, bend: 0.38,
  face: { squint: 0.45, frown: 0.5 }, look: [0, 0.1],
};
// the hurt, held: a hand on the ribs, a held arm, a hand at the brow
const RIBS_L: L = { armR: [-0.05, -0.75, 0.66], foreR: [-0.95, 0.15, 0.25] };
const RIBS_R: L = mir(RIBS_L);
const HOLD_ARM_L: L = { armL: [-0.05, -0.95, 0.3], foreL: [0.55, 0.05, 0.84], armR: [0.0, -0.7, 0.72], foreR: [-0.92, 0.1, 0.38] };
const BROW_L: L = { armL: [-0.35, 0.1, 0.93], foreL: [0.5, 0.85, -0.15] };

const ROT: V3 = [0, 0, 0];
const sound = (name: 'breath' | 'gasp' | 'grunt' | 'yelp', vol = 0.6, rate = 1) => () => audio.humanInner(name, vol, rate);
const sfx = (name: string, vol = 0.6, rate = 1) => () => { audio.sample(name, vol, { rate }); };
const hot = (color: number, rough = 0.5, metal = 0.6) => { const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: 0xff6a20, emissiveIntensity: 0 }); m.userData.hot = true; return m; };
/** A torn piece of the liner's hull: bent plate, ribs underneath, ragged edge (the films' livery: white over grey). */
function hullPiece(w: number, h: number, seed: number) {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(w, h, 10, 8); const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, Math.sin(x * 1.3 + seed) * 0.08 + (x / w) * (x / w) * 0.35 + Math.sin(y * 2.1 + seed) * 0.03); }
  geo.computeVertexNormals();
  const skin = new THREE.Mesh(geo, hot(0xd9dce1, 0.45, 0.55)); skin.material.side = THREE.DoubleSide; skin.castShadow = skin.receiveShadow = true; g.add(skin);
  const ribM = new THREE.MeshStandardMaterial({ color: 0x5c6168, roughness: 0.55, metalness: 0.8 });
  for (let i = -2; i <= 2; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, h * 0.96, 0.09), ribM); r.position.set(i * w / 5.2, 0, -0.07); r.castShadow = true; g.add(r); }
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.98, 0.16), new THREE.MeshStandardMaterial({ color: 0x2a7fa8, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide })); stripe.position.set(0, h * 0.28, 0.06); g.add(stripe);
  g.rotation.x = -Math.PI / 2; const o = new THREE.Group(); o.add(g); return o;
}
function slab(ctx: ArrivalCtx) {
  const geo = new THREE.IcosahedronGeometry(0.34, 1); const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) { p.setY(i, p.getY(i) * 0.45); p.setX(i, p.getX(i) * 1.35); }
  const f = geo.toNonIndexed(); f.computeVertexNormals();
  const m = new THREE.Mesh(f, new THREE.MeshStandardMaterial({ color: 0x6a645c, roughness: 1, flatShading: true })); m.castShadow = m.receiveShadow = true;
  void ctx; return m;
}

// ----------------------------------------------------------------------------------------------------------------
/** Skyvra: out of the white hole, a few m/s, onto a rock with almost no gravity. No air: no breath, no sound but her own. */
const explorer: ArrivalDef = {
  id: 'explorer', dur: 27, g: 0.25, air: false, hit: 5.2, spot: [0, 2], yaw: 0.6,
  fallers: [
    // the plate she fell with, tumbling slowly, ending propped where the stage has it
    { mesh: () => hullPiece(2.6, 1.8, 1), stays: false, keys: [
      { t: 0, at: [-14, 9, 30], rot: [0.4, 0.2, 0.3] }, { t: 6.5, at: [-3.5, 1.2, 4], rot: [2.2, 1.1, 1.3] }, { t: 9.5, at: [-4.2, 0.35, 2.2], rot: [3.0, 1.4, 1.5], ease: 'out' }, { t: 27, at: [-4.2, 0.35, 2.2], rot: [3.0, 1.4, 1.5] }] },
    // the slab she knocks loose: weightless, all its mass; it drifts down onto her shin
    { mesh: slab, stays: false, keys: [
      { t: 0, at: [0.9, 0.5, -1.9], rot: [0.1, 0.4, 0.05] }, { t: 7.6, at: [0.9, 0.5, -1.9], rot: [0.1, 0.4, 0.05] }, { t: 8.4, at: [0.6, 1.5, -1.7], rot: [0.5, 0.6, 0.3], ease: 'out' },
      { t: 10.6, at: [-0.12, 0.2, -1.45], rot: [0.25, 0.9, 0.12], ease: 'io' }, { t: 21, at: [-0.12, 0.2, -1.45], rot: [0.25, 0.9, 0.12] },
      // she shoves it off: it rises, turning, and settles a body length away, slowly
      { t: 22.5, at: [-0.9, 0.9, -1.8], rot: [0.9, 1.4, 0.6], ease: 'out' }, { t: 27, at: [-1.5, 0.16, -1.8], rot: [0.3, 1.9, 0.15], ease: 'io' }] },
  ],
  dust: { n: 160, speed: 1.6, color: 0x8a847c, size: 0.05, up: 0.8 },
  body: [
    // tumbling in, arms reaching for anything; she turns over once in the slow fall
    key(0, PRONE, { at: [6, 7, 26], head: [0.4, 0.6, -0.7], chest: [0.6, -0.5, 0.6], face: { fear: 0.6, open: 0.3 }, limbs: { armL: [-0.7, 0.6, 0.4], armR: [0.8, 0.5, 0.3], foreL: [-0.6, 0.7, 0.3], foreR: [0.7, 0.6, 0.4], legL: [-0.2, -0.6, -0.8], legR: [0.3, -0.4, -0.85] } }),
    key(3.6, PRONE, { at: [2, 2.6, 8], head: [-0.6, 0.2, 0.75], chest: [0.3, -0.9, -0.2], face: { fear: 0.7, open: 0.4 }, limbs: { armL: [-0.6, 0.3, 0.75], armR: [0.7, 0.2, 0.68], foreL: [-0.4, 0.2, 0.9], foreR: [0.5, 0.2, 0.85] }, ease: 'lin' }),
    // first touch: she hits at about 4 m/s and bounces (escape speed is about 1 m/s: she nearly leaves)
    key(5.2, PRONE, { at: [0.4, 0.4, 2.4], head: [-0.3, 0.1, 0.95], chest: [0.1, -1, 0], face: { squint: 1, open: 0.5 }, ease: 'lin' }),
    key(6.6, PRONE, { at: [0.2, 1.3, 0.6], head: [0.2, 0.5, 0.85], chest: [-0.5, -0.7, 0.4], face: { squint: 0.8, open: 0.3 }, limbs: { armL: [-0.8, 0.2, 0.5], armR: [0.9, -0.1, 0.4] }, ease: 'out' }),
    // second touch, a slide, fingers digging in so as not to float off
    key(8.0, PRONE, { at: [0, 0.2, -0.4], head: [0, 0, 1], chest: [0, -1, 0], face: { squint: 0.9, open: 0.4 }, ease: 'fall' }),
    key(8.9, PRONE, { face: { squint: 0.7, frown: 0.5 }, limbs: { armL: [-0.85, -0.15, 0.5], foreL: [-0.2, -0.2, 0.96], armR: [0.85, -0.15, 0.5], foreR: [0.2, -0.2, 0.96], legL: [-0.06, -0.08, -1], shinL: [-0.04, -0.08, -1] } }),
    // the slab settles on her shin (left); still
    key(11.0, PRONE, { look: [0.9, 0], face: { blink: 0.9, frown: 0.3 }, limbs: { armL: [-0.85, -0.15, 0.5], foreL: [-0.2, -0.2, 0.96], armR: [0.85, -0.15, 0.5], foreR: [0.2, -0.2, 0.96], legL: [-0.06, -0.08, -1], shinL: [-0.04, -0.08, -1] } }),
    // eyes; no breath (her chest does not move): a Tarnkin holding the one she has
    key(13.2, PRONE, { look: [0.7, -0.1], face: { blink: 0.25, squint: 0.4 }, limbs: { armL: [-0.85, -0.15, 0.5], foreL: [-0.2, -0.2, 0.96], armR: [0.85, -0.15, 0.5], foreR: [0.2, -0.2, 0.96], legL: [-0.06, -0.08, -1], shinL: [-0.04, -0.08, -1] } }),
    // she pulls the leg: it does not come; the pain without a sound (mouth open, nothing out)
    key(15.4, PUSH, { at: [0, 0.2, -0.5], face: { squint: 1, frown: 1, open: 0.7 }, look: [0, -0.2], limbs: { legL: [-0.06, -0.12, -1], shinL: [-0.04, -0.1, -1] } }),
    key(16.6, PRONE, { at: [0, 0.14, -0.62], face: { squint: 0.9, frown: 0.8, open: 0.5 }, look: [-0.6, 0.15], limbs: { armL: [-0.6, -0.4, 0.7], foreL: [-0.1, -0.9, 0.4], armR: [0.6, -0.4, 0.7], foreR: [0.1, -0.9, 0.4], legL: [-0.06, -0.08, -1], shinL: [-0.04, -0.08, -1] } }),
    // she looks back at the slab, then at the sky: a laugh with no air in it, shoulders only
    key(18.4, PUSH, { at: [0, 0.18, -0.55], head: [-0.1, 0.35, 0.93], twist: -0.2, look: [-0.8, -0.2], face: { smile: 0.4, squint: 0.6 }, limbs: { legL: [-0.06, -0.12, -1], shinL: [-0.04, -0.1, -1] } }),
    key(19.4, PUSH, { at: [0, 0.2, -0.55], head: [-0.05, 0.42, 0.9], twist: -0.1, look: [-0.3, 0.35], face: { smile: 0.7, squint: 0.7, open: 0.2 }, limbs: { legL: [-0.06, -0.12, -1], shinL: [-0.04, -0.1, -1] } }),
    // the shove: her free foot and both hands on the slab; it lifts away, slowly
    key(21.2, SITUP, { at: [0, 0.14, -0.6], head: [-0.25, 0.8, -0.55], chest: [-0.4, 0.5, -0.75], twist: 0.2, face: { frown: 0.9, squint: 0.9, open: 0.3 }, gaze: [-0.4, 0.2, -1.6],
      limbs: { armL: [-0.25, -0.4, -0.88], foreL: [-0.2, -0.3, -0.93], armR: [-0.05, -0.45, -0.9], foreR: [-0.1, -0.3, -0.95], legL: [-0.05, -0.1, -1], shinL: [-0.04, -0.1, -1], legR: [0.15, 0.5, -0.85], shinR: [0, -0.4, -0.9] } }),
    key(22.6, SITUP, { at: [0, 0.14, -0.6], head: [-0.25, 0.8, -0.55], chest: [-0.4, 0.5, -0.75], twist: 0.2, face: { frown: 1, squint: 1, open: 0.5 }, gaze: [-0.9, 0.9, -1.8],
      limbs: { armL: [-0.3, 0.1, -0.95], foreL: [-0.3, 0.3, -0.9], armR: [-0.15, 0.1, -0.98], foreR: [-0.2, 0.3, -0.93], legL: [-0.05, -0.1, -1], shinL: [-0.04, -0.1, -1], legR: [0.1, -0.1, -1], shinR: [0, -0.1, -1] } }),
    // she draws the leg in and comes up onto the good knee, the broken one held out
    key(24.4, KNEEL, { at: [0, 0.5, -0.4], limbs: { legL: [-0.15, -0.3, 0.94], shinL: [-0.1, -0.1, 0.99], legR: [0.1, -1, 0.05], shinR: [0, -0.07, -1], armL: [-0.3, -0.9, 0.3], foreL: [-0.2, -0.9, 0.35] }, face: { frown: 0.7, squint: 0.7 } }),
    // and up on the good leg alone: here she weighs almost nothing, so one leg is enough; the broken one stays off the rock
    key(26.0, UP, { at: [0, 0.05, -0.1], limbs: { legL: [-0.08, -0.85, 0.5], shinL: [-0.05, -0.75, -0.65], armL: [-0.4, -0.85, 0.2], foreL: [-0.3, -0.9, 0.2], armR: [0.4, -0.85, 0.2], foreR: [0.3, -0.9, 0.2] }, bend: 0.2, face: { frown: 0.6, squint: 0.6 }, ease: 'out' }),
    key(27, UP, { at: [0, 0, 0], limbs: { legL: [-0.08, -0.85, 0.5], shinL: [-0.05, -0.75, -0.65] }, bend: 0.15, face: { frown: 0.5, squint: 0.5 }, gaze: [2, 1.5, 6] }),
  ],
  shots: [
    // the old sky first: a dim red sun, old stars, a speck tumbling in
    { t0: 0, t1: 4.2, from: [-10, 2.2, -9], to: [6, 6, 24], from2: [-9, 2.4, -8.4], fov: 38, ease: 'lin' },
    // low and wide on the rock as she comes down: the first touch, the bounce
    { t0: 4.2, t1: 8.6, from: [5.5, 0.5, -3], to: [0.5, 0.7, 1.5], to2: [0.1, 0.4, -0.2], fov: 42, hand: 0.02 },
    // the slab drifting onto her; locked
    { t0: 8.6, t1: 11.6, from: [2.6, 0.9, -3.4], to: [0, 0.25, -1.1], fov: 40 },
    // her eyes: a face on the rock, no breath fogging anything
    { t0: 11.6, t1: 14.4, onHead: true, from: [0.75, 0.12, 0.45], to: [0, -0.02, 0], fov: 32, hand: 0.006 },
    // she pulls; the leg stays: from behind the slab
    { t0: 14.4, t1: 17.4, from: [-2.0, 0.6, -0.9], to: [0, 0.25, -0.9], fov: 38, hand: 0.01 },
    // the look back, the airless laugh: close
    { t0: 17.4, t1: 20.6, onHead: true, from: [0.8, 0.15, 0.6], to: [0, -0.03, 0], fov: 32, hand: 0.008 },
    // the shove: wide enough to see the slab lift away in no gravity at all
    { t0: 20.6, t1: 24.2, from: [3.4, 1.0, 0.8], to: [-0.6, 0.5, -1.4], fov: 40, hand: 0.01 },
    // up on one knee: the camera comes round behind her into play
    { t0: 24.2, t1: 27, from: [1.8, 1.4, -2.4], to: [0, 0.9, 0.5], from2: [0.6, 1.9, -3.6], to2: [0, 1.0, 1.2], fov: 50 },
  ],
  fx: [
    { t: 0, muffle: 1 }, { t: 5.15, muffle: 1 }, { t: 5.22, muffle: 1, flash: 0.35, ring: 0.2 }, { t: 5.6, muffle: 1, ring: 0.2 },
    { t: 11.4, muffle: 1, blur: 0.2, ring: 0.15 }, { t: 11.8, muffle: 1, blur: 0.7, double: 0.012, black: 0.4 }, { t: 12.5, muffle: 1, blur: 0.5, double: 0.008 },
    { t: 13.6, muffle: 1, blur: 0.15, double: 0.002 }, { t: 15.6, muffle: 1, blur: 0, tunnel: 0.35, red: 0.25 }, { t: 17.0, muffle: 1, tunnel: 0.1 }, { t: 27, muffle: 1 },
  ],
  heart: [[0, 96, 0.4], [5.3, 140, 0.55], [11, 112, 0.5], [15.5, 150, 0.6], [19, 118, 0.5], [24, 100, 0.45]],
  cues: [
    { t: 0.1, run: () => audio.vacuum(true) },
    { t: 5.2, run: () => audio.thump(0.75) },
    { t: 8.0, run: () => audio.thump(0.35) },
    { t: 10.6, run: () => audio.thump(0.55) },
    { t: 22.2, run: () => audio.thump(0.3) },
  ],
};

// ----------------------------------------------------------------------------------------------------------------
/** Draxum: out of the wormhole's far mouth into thick cold air at 0.14 g: a long slow fall, a slushy hit, a shoulder out. */
const strong: ArrivalDef = {
  id: 'strong', dur: 26, g: 1.35, air: true, hit: 5.6, spot: [0, 2], yaw: -0.4,
  dust: { n: 140, speed: 4.5, color: 0x1a120c, size: 0.09, up: 1.3 },
  body: [
    // falling slowly through dense air, fighting it: spread out, turning
    key(0, PRONE, { at: [-3, 34, 10], head: [0.3, 0.2, 0.93], chest: [0, -0.95, 0.3], face: { frown: 0.9, open: 0.6 }, limbs: { armL: [-0.9, 0.3, 0.2], foreL: [-0.8, 0.5, 0.2], armR: [0.9, 0.3, 0.2], foreR: [0.8, 0.5, 0.25], legL: [-0.4, -0.2, -0.9], legR: [0.4, -0.2, -0.9], shinL: [-0.3, 0.2, -0.9], shinR: [0.3, 0.2, -0.9] } }),
    key(3.4, PRONE, { at: [-0.6, 9, 2], head: [-0.3, 0.6, 0.7], chest: [0.4, -0.4, 0.8], face: { frown: 1, open: 0.8 }, limbs: { armL: [-0.7, 0.6, -0.3], armR: [0.8, 0.5, 0.2], foreL: [-0.4, 0.9, 0], foreR: [0.6, 0.7, 0.3], legL: [-0.3, -0.7, -0.6], legR: [0.5, -0.5, -0.7] }, ease: 'lin' }),
    // feet first at the last, the hit throws him onto his back in the slush
    key(5.6, BACK, { at: [0, 0.4, -0.2], head: [0.1, 0.7, -0.7], chest: [0.1, 0.7, 0.7], face: { frown: 1, open: 0.9 }, ease: 'lin' }),
    key(6.1, BACK, { at: [0.05, 0.1, -0.35], face: { blink: 1, open: 0.3, frown: 0.4 },
      limbs: { armL: [-0.6, -0.3, 0.75], foreL: [-0.95, -0.1, 0.2] } }),
    // still; steaming; the left arm lies wrong
    key(8.6, BACK, { face: { blink: 1, open: 0.3, frown: 0.3 }, limbs: { armL: [-0.6, -0.3, 0.75], foreL: [-0.95, -0.1, 0.2] } }),
    // eyes; a breath (the chest heaves in the thick air)
    key(9.2, BACK, { face: { blink: 0.4, squint: 0.6, open: 0.4 }, bend: 0.08, limbs: { armL: [-0.6, -0.3, 0.75], foreL: [-0.95, -0.1, 0.2] } }),
    key(10.0, BACK, { face: { blink: 0.3, squint: 0.5, open: 0.3 }, bend: -0.02, limbs: { armL: [-0.6, -0.3, 0.75], foreL: [-0.95, -0.1, 0.2] } }),
    // he looks down at the arm: it is not where an arm should be. Jaw set
    key(12.4, BACK, { look: [-0.6, 0.45], face: { frown: 1, squint: 0.8, open: 0.1 }, gaze: [-0.6, 0.1, 0.2], limbs: { armL: [-0.6, -0.3, 0.75], foreL: [-0.95, -0.1, 0.2] } }),
    // he tries it: it will not come up; the good hand goes to it
    key(13.6, BACK, { look: [-0.6, 0.45], face: { frown: 1, squint: 1, open: 0.6 }, gaze: [-0.6, 0.1, 0.2], limbs: { armL: [-0.6, -0.25, 0.75], foreL: [-0.9, 0.2, 0.3], armR: [-0.35, 0.55, 0.75], foreR: [-0.95, 0.1, 0.2] } }),
    // rolls to the good side, onto his knees, the arm hanging
    key(15.4, SIDE_R, { at: [0.15, 0.2, -0.3], face: { frown: 1, squint: 0.9, open: 0.4 }, limbs: { armL: [0.3, -0.6, 0.75], foreL: [0.6, -0.7, 0.4] } }),
    key(16.8, FOURS, { at: [0, 0.5, -0.45], limbs: { armL: [-0.15, -0.98, 0.15], foreL: [-0.1, -0.99, 0.1], armR: [0.16, -0.8, 0.5], foreR: [0.1, -0.85, 0.45] }, face: { frown: 1, squint: 0.8, open: 0.5 } }),
    // he looks up into the haze for the others: head up, mouth open, breath fogging and falling
    key(18.2, KNEEL, { at: [0, 0.52, -0.36], head: [0, 1, -0.05], chest: [0, 0.1, 1], bend: 0.05, look: [0.3, -0.45], face: { frown: 0.8, open: 0.7 }, limbs: { armL: [-0.08, -0.98, 0.1], foreL: [-0.05, -0.98, 0.15] } }),
    key(19.6, KNEEL, { at: [0, 0.52, -0.36], head: [0, 1, -0.05], chest: [0, 0.1, 1], bend: 0.05, look: [-0.5, -0.4], face: { frown: 0.9, open: 0.7 }, limbs: { armL: [-0.08, -0.98, 0.1], foreL: [-0.05, -0.98, 0.15] } }),
    // he stands like a strong man on Titan would: far too hard. The push throws him up off the ground
    key(20.6, UP, { at: [0, 0.9, 0.35], clip: 'jump', face: { fear: 0.6, open: 0.5 }, bend: 0.1, limbs: { armL: [-0.1, -0.98, 0.1], foreL: [-0.05, -0.98, 0.15], armR: [0.7, -0.2, 0.3], foreR: [0.8, 0, 0.2] }, ease: 'out' }),
    key(21.7, UP, { at: [0, 0.0, 0.7], clip: 'crouch', face: { frown: 1, squint: 0.8, open: 0.5 }, bend: 0.3, limbs: { armL: [-0.1, -0.98, 0.1], foreL: [-0.05, -0.98, 0.15] }, ease: 'fall' }),
    // and learns: small, careful, holding the arm in
    key(23.4, UP, { at: [0, 0, 0.7], limbs: HOLD_ARM_L, bend: 0.32, face: { frown: 0.8, squint: 0.6 } }),
    key(26, UP, { at: [0, 0, 0.7], limbs: HOLD_ARM_L, bend: 0.25, face: { frown: 0.6, squint: 0.5 }, gaze: [-3, 3, 10] }),
  ],
  shots: [
    // orange haze, the black lake, the giant; a shimmer high up and a figure falling out of it
    { t0: 0, t1: 3.6, from: [14, 2.0, -16], to: [-2, 22, 8], to2: [-1, 12, 4], fov: 44, ease: 'lin' },
    // low, the last of the fall and the hit in the slush
    { t0: 3.6, t1: 7.4, from: [3.8, 0.6, 4.2], to: [-0.4, 6, 1], to2: [0, 0.35, -0.3], fov: 40, ease: 'out' },
    // steam off him in the cold; locked
    { t0: 7.4, t1: 10.4, from: [1.9, 1.15, 1.2], to: [0, 0.25, -0.5], fov: 40 },
    // his eyes: haze, the shimmer where he came through
    { t0: 10.4, t1: 12.2, pov: true, from: [0, 0, 0], to: [0.6, 14, 2], fov: 50 },
    // the arm: close on it and his face
    { t0: 12.2, t1: 15.0, onHead: true, from: [-0.7, 0.35, 0.9], to: [-0.15, -0.15, 0.25], fov: 36, hand: 0.01 },
    // onto his knees: wide, the lake behind
    { t0: 15.0, t1: 18.0, from: [3.0, 0.9, 1.6], to: [0, 0.45, -0.4], fov: 40, hand: 0.015 },
    // the call into the haze: low, his breath falling instead of rising
    { t0: 18.0, t1: 20.4, from: [0.8, 0.55, 1.5], to: [0, 1.1, -0.3], fov: 36, hand: 0.01 },
    // the stand that throws him into the air
    { t0: 20.4, t1: 23.0, from: [3.4, 1.0, 2.8], to: [0, 0.9, 0.5], fov: 42, hand: 0.02 },
    // into play
    { t0: 23.0, t1: 26, from: [1.6, 1.6, -1.6], to: [0, 1.2, 1.5], from2: [0.5, 2.1, -3.4], to2: [0, 1.1, 2.4], fov: 50 },
  ],
  fx: [
    { t: 0 }, { t: 5.55 }, { t: 5.62, flash: 0.45, muffle: 0.95, ring: 0.9 }, { t: 7.2, muffle: 0.95, ring: 0.8 },
    { t: 10.3, muffle: 0.8, ring: 0.6, black: 0.6 }, { t: 10.6, muffle: 0.8, ring: 0.6, blur: 0.8, double: 0.014 }, { t: 12.0, muffle: 0.6, ring: 0.4, blur: 0.4, double: 0.006 },
    { t: 13.4, muffle: 0.4, ring: 0.2, tunnel: 0.4, red: 0.3 }, { t: 15.0, muffle: 0.2, ring: 0.1, tunnel: 0.1 }, { t: 18, muffle: 0, ring: 0 }, { t: 26 },
  ],
  heart: [[5.6, 130, 0.5], [12.5, 150, 0.6], [16, 120, 0.45], [22, 104, 0.35]],
  cues: [
    { t: 0.2, run: () => audio.whoosh() },
    { t: 5.6, run: () => { audio.thump(0.9); audio.sample('splash', 0.7, { rate: 0.6 }); } },
    { t: 9.2, run: sound('breath', 0.7, 0.85) },
    { t: 13.6, run: sound('grunt', 0.8, 0.85) },
    { t: 16.0, run: sound('grunt', 0.6, 0.8) },
    { t: 18.4, run: sound('breath', 0.7, 0.85) },
    { t: 21.6, run: () => { audio.sample('splash', 0.4, { rate: 0.7 }); audio.humanInner('grunt', 0.6, 0.85); } },
  ],
};

// ----------------------------------------------------------------------------------------------------------------
/** Lyrra: thrown clear of her hull section as it ploughs a trench across a grey moon. Her pulse first, then the arm. */
const medic: ArrivalDef = {
  id: 'medic', dur: 26, g: 1.2, air: false, hit: 5.0, spot: [0, 2], yaw: 0.3,
  fallers: [
    { mesh: () => { const o = hullPiece(4.2, 2.6, 3); o.scale.set(1, 1, 1); return o; }, stays: false, heat: [[0, 0.6], [4.8, 0.3], [7, 0]], keys: [
      { t: 0, at: [30, 9, 70], rot: [0.3, -0.5, 0.25] }, { t: 4.8, at: [5, 0.8, 10], rot: [0.15, -0.3, 0.6] },
      { t: 6.6, at: [-4.5, 0.5, -6], rot: [-0.25, -0.1, 1.4], ease: 'out' }, { t: 26, at: [-4.5, 0.5, -6], rot: [-0.25, -0.1, 1.4] }] },
  ],
  dust: { n: 200, speed: 3.2, color: 0x9a9aa2, size: 0.06, up: 0.7 },
  body: [
    key(0, BACK, { at: [24, 7, 58], face: { blink: 0.6 } }),
    key(4.8, BACK, { at: [4, 1.1, 8], head: [0.4, 0.4, -0.8], chest: [0.4, 0.8, 0.4], ease: 'lin' }),
    // thrown out of the torn end as it slews: a long, low tumble in a tenth of a g
    key(5.8, SIDE_R, { at: [1.6, 1.3, 2.6], head: [-0.3, -0.5, 0.8], chest: [0.8, 0.2, 0.5], face: { blink: 1 }, ease: 'out' }),
    key(6.9, BACK, { at: [0.05, 0.12, -0.35], face: { blink: 1, open: 0.2 }, ease: 'fall' }),
    // still. Before her eyes open, two fingers to her own neck
    key(9.0, BACK, { face: { blink: 1, open: 0.15 } }),
    key(10.4, BACK, { face: { blink: 0.9 }, limbs: { armR: [-0.2, 0.7, -0.68], foreR: [-0.55, 0.3, -0.78] } }),
    key(12.0, BACK, { face: { blink: 0.5, squint: 0.3 }, look: [0.2, 0], limbs: { armR: [-0.2, 0.7, -0.68], foreR: [-0.55, 0.3, -0.78] } }),
    // the arm: she lifts the right forearm and looks at it the way she looks at anyone's
    key(14.0, BACK, { look: [0.3, 0.3], face: { squint: 0.5, frown: 0.4 }, gaze: [0.3, 0.6, -0.4],
      limbs: { armR: [0.35, 0.35, -0.85], foreR: [-0.2, 0.75, 0.6], armL: [-0.5, -0.3, -0.8], foreL: [-0.4, -0.2, -0.9] } }),
    // pressure: the left hand clamps over the cut
    key(15.4, BACK, { look: [0.3, 0.3], face: { squint: 0.8, frown: 0.7, open: 0.2 }, gaze: [0.3, 0.5, -0.4],
      limbs: { armR: [0.35, 0.35, -0.85], foreR: [-0.2, 0.75, 0.6], armL: [0.2, 0.5, -0.85], foreL: [0.6, 0.6, 0.5] } }),
    // sitting up still pressing it; counting her breaths
    key(18.0, SITUP, { at: [0, 0.14, -0.15], face: { squint: 0.6, frown: 0.6 }, limbs: { armR: [0.2, -0.6, 0.78], foreR: [-0.3, 0.3, 0.9], armL: [0.2, -0.55, 0.8], foreL: [0.85, 0.1, 0.5], legR: [0.12, 0.45, 0.88], shinR: [0.05, -0.6, 0.8] } }),
    // only then the sky through the tear: Sagittarius A* huge and close
    key(20.0, SITUP, { at: [0, 0.14, -0.15], look: [0.3, -0.5], face: { squint: 0.3, open: 0.25 }, gaze: [8, 20, 20], limbs: { armR: [0.2, -0.6, 0.78], foreR: [-0.3, 0.3, 0.9], armL: [0.2, -0.55, 0.8], foreL: [0.85, 0.1, 0.5] } }),
    key(22.2, KNEEL, { limbs: { armR: [0.1, -0.7, 0.7], foreR: [-0.4, 0.2, 0.9], armL: [0.2, -0.6, 0.78], foreL: [0.9, 0.1, 0.4] }, face: { frown: 0.5, squint: 0.5 } }),
    // up, and the first step floats: she corrects like someone who has seen what falls do
    key(24.2, UP, { at: [0, 0.14, 0.2], limbs: { armR: [0.1, -0.8, 0.6], foreR: [-0.3, 0.2, 0.93], armL: [0.25, -0.6, 0.76], foreL: [0.9, 0.15, 0.4] }, bend: 0.2, face: { frown: 0.4, squint: 0.4 }, ease: 'out' }),
    key(26, UP, { at: [0, 0, 0.45], limbs: { armR: [0.1, -0.8, 0.6], foreR: [-0.3, 0.2, 0.93], armL: [0.25, -0.6, 0.76], foreL: [0.9, 0.15, 0.4] }, bend: 0.15, face: { frown: 0.3, squint: 0.3 }, gaze: [6, 8, 20] }),
  ],
  shots: [
    // the grey horizon, the hard rim light, the black sky crowded with stars; the section coming in low
    { t0: 0, t1: 4.4, from: [-12, 1.4, -10], to: [14, 4, 40], to2: [8, 2, 20], fov: 40, ease: 'lin' },
    // it ploughs past us: a trench of dust thrown straight, falling slowly, no billow (no air)
    { t0: 4.4, t1: 8.4, from: [-6, 1.0, 3], to: [4, 0.8, 8], to2: [0, 0.3, -0.5], fov: 42, hand: 0.02, ease: 'out' },
    // still, on her back
    { t0: 8.4, t1: 11.2, from: [1.9, 1.05, 0.9], to: [0, 0.2, -0.6], fov: 38 },
    // close: the fingers at her neck before the eyes
    { t0: 11.2, t1: 13.4, onHead: true, from: [0.35, 0.85, 0.2], to: [0, 0, 0.05], fov: 34, hand: 0.005 },
    // the arm, as she sees it
    { t0: 13.4, t1: 16.4, onHead: true, from: [-0.9, 0.45, 0.6], to: [0.15, 0.0, 0.2], fov: 36, hand: 0.006 },
    // sitting up, wide: the trench, the section at its end
    { t0: 16.4, t1: 19.4, from: [3.2, 1.1, 2.2], to: [-1.6, 0.4, -2.6], fov: 42, hand: 0.01 },
    // her eyes on the sky
    { t0: 19.4, t1: 21.6, pov: true, from: [0, 0, 0], to: [8, 18, 22], fov: 54 },
    // up: one floating step, then into play
    { t0: 21.6, t1: 26, from: [2.4, 1.2, 2.6], to: [0, 0.9, 0], from2: [0.6, 2.0, -3.2], to2: [0, 1.1, 2], fov: 48 },
  ],
  fx: [
    { t: 0, muffle: 1 }, { t: 4.95, muffle: 1 }, { t: 5.05, muffle: 1, flash: 0.25 }, { t: 7.0, muffle: 1, flash: 0.2, ring: 0.6 }, { t: 7.4, muffle: 1, ring: 0.6 },
    { t: 11.0, muffle: 1, ring: 0.5, blur: 0.3 }, { t: 12.4, muffle: 1, ring: 0.4, blur: 0.5, double: 0.008 }, { t: 14, muffle: 1, ring: 0.2, blur: 0.15 },
    { t: 15.4, muffle: 1, tunnel: 0.3, red: 0.2 }, { t: 17, muffle: 1, tunnel: 0 }, { t: 26, muffle: 1 },
  ],
  heart: [[5, 118, 0.45], [7, 136, 0.55], [12, 104, 0.5], [15.4, 128, 0.55], [19, 92, 0.4]],
  cues: [
    { t: 0.1, run: () => audio.vacuum(true) },
    { t: 5.0, run: () => audio.thump(0.6) },
    { t: 6.9, run: () => audio.thump(0.7) },
    { t: 15.4, run: sound('gasp', 0.35, 1.05) },
  ],
};

// ----------------------------------------------------------------------------------------------------------------
/** Bolzar: on a hull plate that skids like a sled across the broken half of a moon; he pats the plate before himself. */
const builder: ArrivalDef = {
  id: 'builder', dur: 26, g: 0.5, air: false, hit: 4.2, spot: [0, 2], yaw: -0.2,
  fallers: [
    { mesh: () => hullPiece(2.4, 3.0, 5), stays: true, keys: [
      { t: 0, at: [10, 18, 40], rot: [0.2, 0.3, 0.2] }, { t: 4.2, at: [2.2, 0.35, 9], rot: [0.06, 0.25, 0.08], ease: 'lin' },
      { t: 6.2, at: [0.2, 0.12, -0.3], rot: [0.04, 0.42, 0.14], ease: 'out' }, { t: 6.7, at: [0.2, 0.12, -0.3], rot: [0.0, 0.44, 0.1], ease: 'io' }, { t: 26, at: [0.2, 0.12, -0.3], rot: [0.0, 0.44, 0.1] }] },
  ],
  dust: { n: 220, speed: 2.6, color: 0x6a5a4a, size: 0.06, up: 0.9 },
  body: [
    // riding it in, flat on his side, holding its rib
    key(0, SIDE_R, { at: [10.2, 18.4, 40], face: { fear: 0.6, open: 0.4 } }),
    key(4.2, SIDE_R, { at: [2.4, 0.62, 9], face: { fear: 0.9, open: 0.6, squint: 0.6 }, ease: 'lin' }),
    key(6.2, SIDE_R, { at: [0.3, 0.38, -0.3], face: { squint: 1, open: 0.5 }, ease: 'out' }),
    // the plate stops crooked; he lies on it, still, the plate still rocking
    key(6.8, SIDE_R, { at: [0.3, 0.35, -0.35], face: { blink: 1, open: 0.2 } }),
    key(9.2, SIDE_R, { at: [0.3, 0.35, -0.35], face: { blink: 1, open: 0.2 } }),
    // eyes; the hand finds the plate and pats it, before anything else
    key(10.4, SIDE_R, { at: [0.3, 0.35, -0.35], face: { blink: 0.4, squint: 0.4 }, limbs: { armL: [0.7, -0.1, 0.65], foreL: [0.85, -0.45, 0.25] } }),
    key(10.9, SIDE_R, { at: [0.3, 0.35, -0.35], face: { blink: 0.3, squint: 0.4, smile: 0.2 }, limbs: { armL: [0.7, -0.15, 0.65], foreL: [0.8, -0.55, 0.2] } }),
    key(11.3, SIDE_R, { at: [0.3, 0.35, -0.35], face: { blink: 0.3, squint: 0.4, smile: 0.25 }, limbs: { armL: [0.7, -0.1, 0.65], foreL: [0.85, -0.45, 0.25] } }),
    // sits up on the plate; the hole overhead
    key(14.2, SITUP, { at: [0.1, 0.36, -0.2], look: [0, -0.5], face: { squint: 0.4, open: 0.2 }, gaze: [0, 30, 4] }),
    // tries the ankle: draws the right foot in. It does not like it
    key(15.8, SITUP, { at: [0.1, 0.36, -0.2], look: [0.2, 0.35], face: { frown: 0.9, squint: 0.9, open: 0.4 }, limbs: { legR: [0.15, 0.6, 0.78], shinR: [0.05, -0.75, 0.66], armL: [0.3, -0.6, 0.75], foreL: [0.6, -0.4, 0.7] } }),
    key(16.6, SITUP, { at: [0.1, 0.36, -0.2], look: [0.2, 0.35], face: { frown: 0.6, squint: 0.6 }, limbs: { legR: [0.12, 0.3, 0.94], shinR: [0.05, -0.4, 0.92] } }),
    // overconfidence: again, harder; it gives, and he laughs it off
    key(17.6, SITUP, { at: [0.1, 0.36, -0.2], look: [0.2, 0.35], face: { frown: 1, squint: 1, open: 0.6 }, limbs: { legR: [0.15, 0.68, 0.72], shinR: [0.05, -0.8, 0.6], armL: [0.3, -0.6, 0.75], foreL: [0.6, -0.4, 0.7] } }),
    key(19.0, SITUP, { at: [0.1, 0.36, -0.2], look: [-0.2, 0.1], face: { smile: 0.55, squint: 0.6 }, limbs: { legR: [0.15, 0.1, 0.98], shinR: [0.1, -0.15, 0.98] } }),
    // up on the left knee and the good foot, off the plate, the right foot held clear
    key(21.4, KNEEL, { at: [0, 0.5 + 0.12, -0.3], limbs: { legL: [0.1, 0.02, 1], shinL: [0, -1, 0.05], legR: [0.07, -1, 0.06], shinR: [0, -0.07, -1], armL: [-0.12, -0.62, 0.78], foreL: [-0.02, -0.55, 0.84], armR: [0.16, -0.95, 0.15], foreR: [0.1, -0.9, 0.35] }, face: { frown: 0.6, squint: 0.6 } }),
    key(23.6, UP, { at: [0, 0, 0.3], limbs: { legR: [0.1, -0.95, 0.3], shinR: [0.05, -0.8, -0.6], armL: [-0.15, -0.98, 0.1], foreL: [-0.1, -0.95, 0.25] }, bend: 0.25, face: { frown: 0.5, squint: 0.5 } }),
    key(26, UP, { at: [0, 0, 0.45], limbs: { legR: [0.1, -0.97, 0.2], shinR: [0.05, -0.9, -0.4] }, bend: 0.15, face: { smile: 0.15, squint: 0.4 }, gaze: [-2, 2, 8] }),
  ],
  shots: [
    { t0: 0, t1: 3.4, from: [-9, 3.0, -12], to: [8, 14, 34], to2: [4, 6, 20], fov: 40, ease: 'lin' },
    // the sled: low, side on; grit flying straight out and falling slowly
    { t0: 3.4, t1: 7.4, from: [-5.5, 0.7, 2.5], to: [2.2, 0.6, 9], to2: [0.2, 0.4, -0.3], fov: 40, hand: 0.02, ease: 'out' },
    { t0: 7.4, t1: 10.0, from: [1.9, 1.3, 1.3], to: [0.2, 0.4, -0.4], fov: 38 },
    // the hand on the plate
    { t0: 10.0, t1: 12.2, from: [1.8, 0.9, 0.9], to: [0.5, 0.35, -0.3], fov: 34, hand: 0.006 },
    // his eyes: the black hole overhead, the stars bent round it
    { t0: 12.2, t1: 14.4, pov: true, from: [0, 0, 0], to: [8, 9, 30], fov: 56 },
    // the ankle
    { t0: 14.4, t1: 19.6, from: [1.3, 0.75, 1.6], to: [0.2, 0.45, 0], fov: 36, hand: 0.01 },
    // up and into play
    { t0: 19.6, t1: 26, from: [2.6, 1.0, 2.4], to: [0, 0.8, 0], from2: [0.6, 2.0, -3.2], to2: [0, 1.1, 2.2], fov: 46 },
  ],
  fx: [
    { t: 0, muffle: 1 }, { t: 4.15, muffle: 1 }, { t: 4.25, muffle: 1, flash: 0.3, ring: 0.7 }, { t: 6.4, muffle: 1, ring: 0.7 },
    { t: 12.0, muffle: 1, ring: 0.5, black: 0.5 }, { t: 12.3, muffle: 1, ring: 0.4, blur: 0.7, double: 0.012 }, { t: 14.2, muffle: 1, ring: 0.2, blur: 0.2 },
    { t: 15.8, muffle: 1, tunnel: 0.3, red: 0.2 }, { t: 17.6, muffle: 1, tunnel: 0.45, red: 0.3 }, { t: 19, muffle: 1, tunnel: 0 }, { t: 26, muffle: 1 },
  ],
  heart: [[4.2, 132, 0.5], [10, 110, 0.45], [15.8, 136, 0.55], [19.5, 104, 0.4]],
  cues: [
    { t: 0.1, run: () => audio.vacuum(true) },
    { t: 4.2, run: () => audio.thump(0.8) },
    { t: 6.2, run: () => audio.thump(0.5) },
    { t: 10.9, run: () => audio.thump(0.15) },
    { t: 17.6, run: sound('grunt', 0.5, 0.9) },
  ],
};

// ----------------------------------------------------------------------------------------------------------------
/** Nuvexa: her sealed piece of cabin falls through the hot cloud deck and floats; she was thrown against the frame. */
const social: ArrivalDef = {
  id: 'social', dur: 26, g: 8.9, air: true, hit: 4.6, spot: [0, 2], yaw: 0.25,
  fallers: [
    // the glow coming down through the gold cloud: entry heat on the section's face
    { mesh: () => hullPiece(3.2, 2.2, 7), stays: false, heat: [[0, 1], [3.2, 0.8], [4.4, 0.1]], keys: [
      { t: 0, at: [-40, 70, 160], rot: [0.5, 0.2, 0.3] }, { t: 4.3, at: [-16, 6, 40], rot: [0.3, 0.6, 0.5], ease: 'lin' }, { t: 4.4, at: [-16, -40, 40], rot: [0.3, 0.6, 0.5] }, { t: 26, at: [-16, -40, 40], rot: [0.3, 0.6, 0.5] }] },
    // her phone, thrown out of her hand, lit
    { mesh: () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.009, 0.155), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.25, metalness: 0.4, emissive: 0x7aa8ff, emissiveIntensity: 0.9 })); return m; }, stays: false, keys: [
      { t: 0, at: [0.9, -5, 0.1], rot: ROT }, { t: 4.55, at: [0.9, -5, 0.1], rot: ROT }, { t: 4.6, at: [0.2, 0.8, -0.3], rot: [0.5, 0.2, 0.1] },
      { t: 5.3, at: [0.95, 0.03, 0.15], rot: [0, 0.6, 0], ease: 'fall' }, { t: 11.2, at: [0.95, 0.03, 0.15], rot: [0, 0.6, 0] },
      { t: 12.4, at: [0.4, 0.55, -0.1], rot: [-1.0, 0.2, 0], ease: 'io' }, { t: 17, at: [0.45, 0.5, 0.0], rot: [-1.0, 0.2, 0] }, { t: 18, at: [0.9, -5, 0.1], rot: ROT }, { t: 26, at: [0.9, -5, 0.1], rot: ROT }] },
  ],
  dust: { n: 50, speed: 1.6, color: 0xd8c890, size: 0.1, up: 0.4 },
  streak: { t0: 0, t1: 4.4, color: 0xffa040 },
  body: [
    // the jolt as the section stops falling: she is thrown off the frame onto the deck, on her right side
    key(0, SIDE_R, { at: [0.9, 1.4, -0.9], head: [0.2, 0.7, -0.7], chest: [0.8, 0.3, 0.4], face: { fear: 0.8, open: 0.5 } }),
    key(4.6, SIDE_R, { at: [0.9, 1.2, -0.9], head: [0.2, 0.7, -0.7], chest: [0.8, 0.3, 0.4], face: { fear: 0.9, open: 0.7 } }),
    key(5.1, SIDE_R, { at: [0.1, 0.17, -0.4], face: { squint: 1, open: 0.6 }, ease: 'fall' }),
    key(5.6, SIDE_R, { face: { blink: 1, open: 0.2 } }),
    key(8.2, SIDE_R, { face: { blink: 1, open: 0.2 } }),
    // the phone's light on her face first; the eyes go to it, then the hand
    key(9.4, SIDE_R, { face: { blink: 0.4, squint: 0.4 }, gaze: [0.95, 0.03, 0.15] }),
    key(11.2, SIDE_R, { face: { blink: 0.2, squint: 0.3 }, gaze: [0.95, 0.03, 0.15], limbs: { armL: [0.75, -0.25, 0.6], foreL: [0.6, -0.5, 0.6] } }),
    key(12.6, SIDE_R, { face: { squint: 0.3, open: 0.15 }, gaze: [0.4, 0.55, -0.1], limbs: { armL: [0.55, 0.3, 0.78], foreL: [-0.2, 0.75, 0.6] } }),
    // one per cent. Then the side: she breathes in and it stops her
    key(14.6, ELBOW_R, { face: { frown: 0.9, squint: 1, open: 0.5 }, gaze: [0.4, 0.5, 0], limbs: { armL: [0.55, 0.3, 0.78], foreL: [-0.2, 0.75, 0.6] } }),
    // the heat, the stink of sulphur: she coughs and pulls the sweater up over her mouth
    key(16.2, SITUP, { at: [0, 0.14, -0.15], face: { squint: 1, frown: 0.7, open: 0.3 }, bend: 0.4, limbs: { ...RIBS_R, armL: [0.1, -0.4, 0.9], foreL: [0.4, 0.9, -0.1] } }),
    key(17.2, SITUP, { at: [0, 0.14, -0.15], face: { squint: 0.9, frown: 0.6 }, bend: 0.3, limbs: { ...RIBS_R, armL: [0.1, -0.4, 0.9], foreL: [0.4, 0.9, -0.1] } }),
    // she looks round the cloud for the others, once each way
    key(19.0, SITUP, { at: [0, 0.14, -0.15], face: { fear: 0.6, open: 0.5 }, look: [0.9, -0.15], limbs: RIBS_R, bend: 0.15 }),
    key(20.4, SITUP, { at: [0, 0.14, -0.15], face: { fear: 0.7, open: 0.5 }, look: [-0.9, -0.15], limbs: RIBS_R, bend: 0.15 }),
    key(22.4, KNEEL, { limbs: { ...RIBS_R, armR: [0.12, -0.62, 0.78], foreR: [0.02, -0.55, 0.84] }, face: { frown: 0.6, squint: 0.6 } }),
    key(24.4, UP, { at: [0, 0, 0.2], limbs: RIBS_R, bend: 0.32, face: { frown: 0.6, squint: 0.6 } }),
    key(26, UP, { at: [0, 0, 0.3], limbs: RIBS_R, bend: 0.25, face: { frown: 0.4, squint: 0.5 }, gaze: [4, 2, 12] }),
  ],
  shots: [
    // gold cloud to every horizon; a burning streak coming down through it
    { t0: 0, t1: 4.2, from: [6, 1.4, 6], to: [-40, 40, 160], to2: [-16, 6, 40], fov: 52, ease: 'lin' },
    // the deck jolts; she comes down on it
    { t0: 4.2, t1: 7.6, from: [2.6, 1.5, 1.8], to: [0.2, 0.6, -0.6], to2: [0.1, 0.25, -0.5], fov: 40, hand: 0.03 },
    // still; the deck bobbing under her
    { t0: 7.6, t1: 9.0, from: [-1.6, 0.9, 1.4], to: [0.1, 0.2, -0.4], fov: 38, hand: 0.015 },
    // the phone's light on her face
    { t0: 9.0, t1: 12.8, onHead: true, from: [0.75, 0.1, 0.5], to: [0.05, -0.05, 0.1], fov: 32, hand: 0.006 },
    // her eyes: one per cent
    { t0: 12.8, t1: 14.4, pov: true, from: [0, 0, 0], to: [0.45, 0.4, 0.05], fov: 46 },
    // the side, the cough, the sweater over the mouth
    { t0: 14.4, t1: 18.4, from: [1.4, 0.7, 1.4], to: [0, 0.45, -0.2], fov: 34, hand: 0.012 },
    // looking for the others: wide, nothing but cloud
    { t0: 18.4, t1: 21.8, from: [-4.5, 1.6, -3.5], to: [0, 0.5, 0], fov: 44, hand: 0.015 },
    // up and into play
    { t0: 21.8, t1: 26, from: [2.0, 1.2, 2.2], to: [0, 0.9, 0], from2: [0.6, 2.0, -3.2], to2: [0, 1.1, 2.2], fov: 48 },
  ],
  fx: [
    { t: 0 }, { t: 4.55 }, { t: 4.65, flash: 0.5, muffle: 0.9, ring: 0.8 }, { t: 5.2, muffle: 0.9, ring: 0.8, flash: 0.1 }, { t: 8.0, muffle: 0.85, ring: 0.7 },
    { t: 9.0, muffle: 0.75, ring: 0.6, blur: 0.5, double: 0.01 }, { t: 12.6, muffle: 0.5, ring: 0.4, blur: 0.25, double: 0.004 }, { t: 14.2, muffle: 0.3, ring: 0.2, blur: 0.4 },
    { t: 14.6, muffle: 0.3, tunnel: 0.45, red: 0.35 }, { t: 16.4, muffle: 0.15, tunnel: 0.15, blur: 0.2 }, { t: 19, muffle: 0, ring: 0 }, { t: 26 },
  ],
  heart: [[4.6, 136, 0.5], [9.4, 116, 0.45], [14.6, 146, 0.55], [18, 120, 0.45], [23, 104, 0.35]],
  cues: [
    { t: 0.1, run: () => audio.whoosh() },
    { t: 4.6, run: () => { audio.thump(0.85); audio.sample('metal', 0.6, { rate: 0.7 }); } },
    { t: 7.0, run: () => audio.sample('metal', 0.25, { rate: 0.5 }) },
    { t: 14.6, run: sound('gasp', 0.5, 1.15) },
    { t: 15.8, run: sound('grunt', 0.4, 1.25) },
    { t: 16.4, run: sound('breath', 0.5, 1.15) },
    { t: 20.0, run: () => audio.sample('metal', 0.2, { rate: 0.45 }) },
  ],
};

// ----------------------------------------------------------------------------------------------------------------
/** Zenvik's is the wake-up (game.ts drives its camera): out until midday, then the body finds its hurts and gets up.
 * Timed to the wake's lines (game.ts buildWake). */
const scientist: ArrivalDef = {
  id: 'scientist', dur: 22.2, g: 9.8, air: true, hit: -10, spot: [0, 2], yaw: 0.35,
  body: [
    key(0, BACK, { face: { blink: 1, open: 0.15 } }),
    // eyes open on the sky (the wake's first look)
    key(1.4, BACK, { face: { blink: 0.45, squint: 0.5 } }),
    key(6.0, BACK, { face: { blink: 0.3, squint: 0.4 }, look: [0.2, 0] }),
    // a breath in, and the ribs stop it: the hand goes to the left side
    key(8.2, BACK, { face: { squint: 0.9, frown: 0.8, open: 0.35 }, bend: 0.05, look: [0.1, 0.2], limbs: { armR: [-0.4, 0.45, -0.8], foreR: [-0.9, 0.1, 0.35] } }),
    // the other hand to the brow; he looks at the fingertips
    key(10.4, BACK, { face: { squint: 0.6, frown: 0.6 }, look: [0, 0.25], limbs: { armR: [-0.4, 0.45, -0.8], foreR: [-0.9, 0.1, 0.35], ...BROW_L } }),
    key(11.8, BACK, { face: { squint: 0.5, frown: 0.5 }, look: [-0.2, 0.3], limbs: { armR: [-0.4, 0.45, -0.8], foreR: [-0.9, 0.1, 0.35], armL: [-0.35, 0.55, -0.75], foreL: [0.2, 0.95, 0.25] } }),
    // over onto the right side, away from the ribs; up on the elbow (13.5 to 15.2)...
    key(13.5, SIDE_R, { face: { squint: 0.9, frown: 0.9, open: 0.3 }, limbs: { armL: [0.25, -0.6, 0.75], foreL: [-0.3, 0.2, 0.93] } }),
    key(15.2, ELBOW_R, { face: { squint: 1, frown: 0.9, open: 0.4 }, limbs: { armL: [0.25, -0.6, 0.75], foreL: [-0.3, 0.2, 0.93] } }),
    // ...the world tilts and he goes back down onto it (15.2 to 15.7)
    key(15.7, SIDE_R, { at: [0.1, 0.19, -0.4], face: { squint: 1, frown: 0.8, open: 0.3 }, limbs: { armL: [0.25, -0.6, 0.75], foreL: [-0.3, 0.2, 0.93] }, ease: 'fall' }),
    // and only then gets up (16.1 to 18.6): sit, knee, stand, weight off the right ankle
    key(16.1, SIDE_R, { at: [0.1, 0.19, -0.4], face: { squint: 0.8, frown: 0.7 }, limbs: { armL: [0.25, -0.6, 0.75], foreL: [-0.3, 0.2, 0.93] } }),
    key(16.9, SITUP, { limbs: { ...RIBS_L } }),
    key(17.8, KNEEL, { limbs: { ...RIBS_L, armR: [-0.05, -0.75, 0.66], foreR: [-0.95, 0.15, 0.25], armL: [-0.12, -0.62, 0.78], foreL: [-0.02, -0.55, 0.84], legL: [-0.12, 0.02, 1], shinL: [0, -1, 0.05], legR: [0.07, -1, 0.06], shinR: [0, -0.07, -1] } }),
    key(19.0, UP, { limbs: RIBS_L, bend: 0.35 }),
    key(22.2, UP, { limbs: RIBS_L, bend: 0.22, face: { squint: 0.4, frown: 0.4 } }),
  ],
  shots: [{ t0: 0, t1: 99, from: [0, 1.5, -3], to: [0, 0.5, 0], fov: 50 }],
  fx: [
    { t: 0, blur: 1, double: 0.02, muffle: 1, ring: 1, black: 0.3 }, { t: 1.6, blur: 0.8, double: 0.015, muffle: 0.95, ring: 0.9 }, { t: 4, blur: 0.45, double: 0.008, muffle: 0.8, ring: 0.7 },
    { t: 7.6, blur: 0.3, double: 0.004, muffle: 0.6, ring: 0.5 }, { t: 8.2, blur: 0.35, tunnel: 0.35, red: 0.25, muffle: 0.55, ring: 0.5 }, { t: 9.4, blur: 0.15, tunnel: 0.1, muffle: 0.45, ring: 0.4 },
    { t: 13.5, blur: 0.2, muffle: 0.35, ring: 0.3 }, { t: 15.2, blur: 0.7, double: 0.012, tunnel: 0.4, muffle: 0.4, ring: 0.4 }, { t: 16.2, blur: 0.25, tunnel: 0.15, muffle: 0.25, ring: 0.2 },
    { t: 19, blur: 0.05, muffle: 0.1, ring: 0.05 }, { t: 22.2 },
  ],
  heart: [[0, 88, 0.45], [8.2, 118, 0.5], [13.4, 128, 0.5], [17, 112, 0.4], [20.5, 0, 0]],
  cues: [
    { t: 1.0, run: sound('breath', 0.45) },
    { t: 8.2, run: sound('gasp', 0.5) },
    { t: 15.25, run: sound('grunt', 0.5) },
    { t: 17.9, run: sound('breath', 0.45) },
  ],
};

export const ARRIVALS: Partial<Record<CrewId, ArrivalDef>> = { scientist, explorer, strong, medic, builder, social };
/** The stage each of the five arrives on (away/roster.ts). */
export const ARRIVAL_STAGE: Partial<Record<CrewId, string>> = { explorer: 'ring', strong: 'moon', medic: 'wreck', builder: 'scree', social: 'clouds' };

/** The title sequence's short shot of each of the five where they came down (montage.ts arrive): the body as the hit
 * left it, never sitting or standing. The full arrival plays when you first take control of them. */
export const TITLE_STILL: Partial<Record<CrewId, BodyKey>> = {
  strong: key(0, BACK, { limbs: { armL: [-0.6, -0.3, 0.75], foreL: [-0.95, -0.1, 0.2] } }),
  medic: key(0, BACK, { look: [-0.4, 0], limbs: { armR: [0.75, -0.1, 0.65], foreR: [0.55, -0.15, 0.82] } }),
  explorer: key(0, PRONE),
  builder: key(0, SIDE_R),
  social: key(0, SIDE_R, { limbs: { armL: [0.75, -0.25, 0.6], foreL: [0.6, -0.5, 0.6] } }),
};
