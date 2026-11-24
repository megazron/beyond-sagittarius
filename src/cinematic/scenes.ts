import * as THREE from 'three';
import { cover, Beat, Shot } from './cutscene';
import type { Character, CrewId } from '../characters/character';

type Cast = Record<CrewId, Character>;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Places the six around the deck for the opening. */
export function stageDeck(a: Cast, y: number, marks = DECK) {
  for (const id in marks) {
    const m = marks[id as keyof typeof marks], c = a[id as CrewId];
    c.root.position.set(m[0], y, m[1]);
    c.root.rotation.set(0, Math.atan2(0.1 - m[0], 0.8 - m[1]), 0);
  }
}
const DECK = { social: [-1.5, 1.4], strong: [-0.25, 2.0], medic: [1.15, 1.75], explorer: [1.95, 0.75], builder: [-2.5, 0.5], scientist: [0.3, -0.45] } as const;

/** Flashback, day 39: the fight nobody posted. */
export function fightScene(a: Cast, origin: THREE.Vector3): Beat[] {
  const o = (x: number, y: number, z: number) => origin.clone().add(V(x, y, z));
  return [
    { key: 'fb.1', who: 'megazron', hold: 1, shot: () => ({ from: o(4.6, -0.5, 3), to: o(0, -1.1, 0.4), push: 0.12 }), poses: { scientist: 'stand', strong: 'stand', social: 'stand', medic: 'stand', explorer: 'stand', builder: 'stand' }, faces: { scientist: 'strong', strong: 'scientist' } },
    { key: 'fb.2', who: 'strong', shot: () => cover.ots(a.strong, a.scientist) },
    { key: 'fb.3', who: 'scientist', shot: () => cover.close(a.scientist, 0.4, 0.95), after: 0.5 },
    { key: 'fb.4', who: 'social', shot: () => cover.mid(a.social, 0.4, 1.8), faces: { social: 'scientist' } },
    { key: 'fb.5', who: 'medic', shot: () => cover.close(a.medic, -0.45), faces: { medic: 'strong' } },
    { key: 'fb.6', who: 'strong', shot: () => cover.close(a.strong, 0.5, 1.1), after: 0.5 },
    { hold: 1.2, shot: () => cover.close(a.scientist, -0.2, 0.9) },
    { key: 'fb.7', who: 'scientist', shot: () => cover.close(a.scientist, -0.2, 0.85), after: 0.5 },
    { key: 'fb.8', who: 'explorer', shot: () => cover.mid(a.explorer, 0.4, 2.1), faces: { explorer: 'strong' } },
    { key: 'fb.9', who: 'builder', shot: () => cover.mid(a.builder, 0.3, 1.8), poses: { explorer: 'stand' }, after: 0.6 },
  ];
}

type Seat = { x: number; z: number; yaw: number };
/** Lenses as vertical fields of view (full-frame equivalents): 24 mm wide, 35, 50 medium, 85 close. */
const LENS = { w24: 53, m35: 38, m50: 27, c85: 16 } as const;

/**
 * Scene 1, Departure (the owner's design doc, section 3; ~/bs-story/SHOTLIST_departure_lounge.md, L1 to L18): the
 * lounge while the liner is still docked at Earth's orbital ring. Sitting together, a video, someone asleep, the
 * forgotten charger, how they got the route, the mission display, his two lines, and the laugh. The camera stays on
 * the room side (+z), looking towards the window: Earth is behind the group in every set-up.
 */
export function departScene(a: Cast, origin: THREE.Vector3, seats: Record<string, Seat>, fx: { display: (on: boolean) => void; laugh: () => void }): Beat[] {
  const o = (x: number, y: number, z: number) => origin.clone().add(V(x, y, z));
  const head = (c: Character) => new THREE.Vector3().setFromMatrixPosition(c.head.matrixWorld);
  /** A set-up on c's head: the camera `dist` out along the room-side bearing `az` (0 = straight towards +z, + towards +x), `dy` over the eyes. */
  const aim = (c: Character, az: number, dist: number, fov: number, dy = -0.02, drop = 0.06, push = 0.04): Shot => {
    const h = head(c);
    return { from: h.clone().add(V(Math.sin(az) * dist, dy, Math.cos(az) * dist)), to: h.clone().add(V(0, -drop, 0)), push, fov };
  };
  const look = (c: Character, at: Character | THREE.Vector3 | null) => c.setLookTarget(at === null ? null : at instanceof THREE.Vector3 ? at : head(at));
  const phone = () => head(a.social).add(V(0.12, -0.05, 0.38)); // her phone, up at arm's length in front of her
  const pane = o(-1.6, -2.4, -4.4); // Earth, below and ahead, through the window
  const bag = o(-0.6, -1.95, 0.85);
  const lap = (c: Character) => new THREE.Vector3().setFromMatrixPosition(c.root.matrixWorld).add(V(0, 0.6, 0)).addScaledVector(V(Math.sin(c.root.rotation.y), 0, Math.cos(c.root.rotation.y)), 0.6);
  const stand = (id: CrewId, s: Seat) => { const c = a[id]; c.root.position.copy(o(s.x, -2.2, s.z)); c.root.rotation.set(0, s.yaw, 0); c.root.updateMatrixWorld(true); };
  const all = { scientist: 'sit', strong: 'sit', medic: 'sit', builder: 'sit', explorer: 'stand', social: 'selfie' } as const;
  return [
    // L1 establish: the lounge, still docked, Earth in the window behind them
    { hold: 3.4, poses: { ...all }, shot: () => ({ from: o(3.2, -0.55, 3.1), to: o(-0.7, -1.45, -0.9), push: 0.08, fov: LENS.w24 }),
      run: () => {
        for (const id in seats) stand(id as CrewId, seats[id]);
        look(a.builder, o(-3.4, 0.4, 0.6)); a.builder.setFace({ blink: 1 });
        look(a.medic, lap(a.medic)); a.medic.doTask('use', { seconds: 40, prop: 'paper', hands: 'both' });
        look(a.explorer, bag); look(a.strong, phone()); look(a.scientist, o(0, -1.0, -1.4)); look(a.social, phone());
      } },
    // L2 the video
    { key: 'dep.1', who: 'social', shot: () => aim(a.social, 0.25, 1.75, LENS.m35, -0.05, 0.18) },
    // L3 the deadpan answer, into her lens
    { key: 'dep.2', who: 'strong', shot: () => aim(a.strong, 0.32, 1.6, LENS.c85), run: () => look(a.strong, phone()), after: 0.5 },
    // L4 the sleeper: she leans to Bolzar and whispers to her phone
    { key: 'dep.3', who: 'social', shot: () => { const m = head(a.social).add(head(a.builder)).multiplyScalar(0.5); return { from: m.clone().add(V(0.35, 0.1, 2.7)), to: m.clone().add(V(0, -0.15, 0)), push: 0.03, fov: LENS.m35 }; },
      run: () => look(a.social, a.builder), tick: (t) => { if (t > 0.9) look(a.social, phone()); }, after: 0.4 },
    // L5 the argument: Skyvra at her bag, then up at Zenvik
    { key: 'dep.4', who: 'explorer', shot: () => aim(a.explorer, 1.2, 2.0, LENS.m50, 0.05, 0.25), poses: { social: 'stand' },
      run: () => { look(a.explorer, bag); look(a.social, a.explorer); }, tick: (t) => { if (t > 0.5) look(a.explorer, a.scientist); } },
    // L6 reverse: Zenvik, calm, a little smug
    { key: 'dep.5', who: 'scientist', shot: () => aim(a.scientist, -0.55, 1.6, LENS.c85), run: () => look(a.scientist, a.explorer) },
    // L7 reverse: her excuse, with a grin she cannot hold back
    { key: 'dep.6', who: 'explorer', shot: () => aim(a.explorer, 1.25, 1.6, LENS.c85), run: () => { look(a.explorer, a.scientist); a.explorer.setFace({ smile: 0.6 }); }, after: 0.4 },
    // L8 Lyrra, not looking up from her list
    { key: 'dep.7', who: 'medic', shot: () => aim(a.medic, -0.55, 1.6, LENS.c85, -0.02, 0.08), run: () => { a.explorer.setFace(null); look(a.medic, lap(a.medic)); }, after: 0.6 },
    // L9 back to the trip: Nuvexa turns her phone on Zenvik
    { key: 'dep.8', who: 'social', shot: () => aim(a.social, 1.15, 1.75, LENS.m35, -0.05, 0.18), poses: { social: 'selfie' }, faces: { social: 'scientist' },
      run: () => { look(a.social, a.scientist); look(a.scientist, phone()); look(a.strong, a.scientist); } },
    // L10 his answer: the first hint, said as a boast; his eyes slide off her lens on "closer"
    { key: 'op.13', who: 'scientist', shot: () => ({ ...aim(a.scientist, -0.5, 1.6, LENS.c85), push: 0.1 }),
      run: () => look(a.scientist, phone()), tick: (t) => { if (t > 2.6) look(a.scientist, o(0.2, -0.9, -1.6)); } },
    // L11 Draxum sits up to tease him
    { key: 'op.14', who: 'strong', shot: () => aim(a.strong, 0.35, 2.1, LENS.m50, 0.05, 0.2), run: () => look(a.strong, a.scientist) },
    // L12 Zenvik closes the subject, too quick
    { key: 'op.15', who: 'scientist', shot: () => aim(a.scientist, -0.5, 1.6, LENS.c85), run: () => look(a.scientist, a.strong) },
    // L13 Lyrra: the pen stops, she looks up at him
    { key: 'op.16', who: 'medic', shot: () => aim(a.medic, -0.55, 1.6, LENS.c85, -0.02, 0.08),
      run: () => look(a.medic, lap(a.medic)), tick: (t) => { if (t > 0.35) look(a.medic, a.scientist); }, after: 0.8 },
    // L14 the mission display; the ship's voice. Skyvra goes to the window under the insert
    { key: 'dep.9', who: undefined, shot: () => ({ from: o(0.15, -0.62, 0.75), to: o(0, -0.58, -1.43), push: 0.12, fov: LENS.m50 }),
      run: () => {
        fx.display(true); a.medic.doTask('use', { seconds: 0.2, prop: null });
        stand('explorer', { x: 2.9, z: -2.05, yaw: -2.2 }); look(a.explorer, pane);
        for (const id of ['strong', 'scientist', 'social'] as CrewId[]) look(a[id], o(0, -0.55, -1.43));
      }, after: 0.6 },
    // L15 Skyvra at the window, Earth below her: the owner's first line
    { key: 'cine.line1', who: 'explorer', shot: () => { const h = head(a.explorer), f = pane.clone().sub(h).setY(0).normalize(), r = V(-f.z, 0, f.x); return { from: h.clone().addScaledVector(f, -0.95).addScaledVector(r, 0.38).add(V(0, 0.08, 0)), to: h.clone().addScaledVector(f, 3).add(V(0, -0.75, 0)), push: 0.04, fov: LENS.m35 }; }, poses: { social: 'selfie' },
      run: () => { fx.display(false); look(a.explorer, pane); }, tick: (t) => { if (t > 1.3) look(a.explorer, o(1.2, -1.0, 0.0)); } },
    // L16 the reply, word for word, into Nuvexa's phone
    { key: 'dep.10', who: 'strong', shot: () => aim(a.strong, 0.35, 2.1, LENS.m50, 0.05, 0.2), run: () => { look(a.strong, phone()); look(a.social, a.strong); }, after: 0.3 },
    // L17 you laugh
    { hold: 1.7, shot: () => aim(a.scientist, -0.5, 1.6, LENS.c85), run: () => { a.scientist.setFace({ smile: 1, squint: 0.6, open: 0.35 }); look(a.scientist, a.strong); fx.laugh(); } },
    // L18 all six laughing: the last time; Bolzar stirs
    { hold: 2.8, shot: () => ({ from: o(2.6, -0.6, 2.9), to: o(-0.8, -1.4, -0.9), push: -0.05, fov: LENS.w24 }),
      run: () => {
        for (const id of ['strong', 'medic', 'social', 'explorer'] as CrewId[]) a[id].setFace({ smile: 0.9, squint: 0.4 });
        look(a.medic, a.scientist); look(a.explorer, a.strong);
      }, tick: (t) => { if (t > 1.2) { a.builder.setFace({ smile: 0.4 }); look(a.builder, a.strong); } } },
  ];
}

/** The journey's end on the deck: the window, then the reading (the last beats of the old deck scene, as they were). */
export function readingScene(a: Cast, origin: THREE.Vector3): Beat[] {
  const o = (x: number, y: number, z: number) => origin.clone().add(V(x, y, z));
  return [
    { hold: 1.6, poses: { social: 'stand', strong: 'stand', explorer: 'stand', builder: 'stand', medic: 'stand', scientist: 'stand' }, faces: {}, shot: () => ({ from: o(0.3, -0.9, 3.4), to: o(0, -0.7, -3), push: 0.14 }) },
    { key: 'op.17', who: 'explorer', shot: () => cover.close(a.explorer, 0.3, 1.2), after: 0.5 },
    { key: 'op.18', who: 'builder', shot: () => cover.mid(a.builder, -0.4, 1.8) },
  ];
}
