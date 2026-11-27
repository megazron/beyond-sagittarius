// Beyond Sagittarius: "The Entry", v3 (~/megazron/ENTRANCES_v3.md section 2): he talks to the player. Built on the
// acting reel's method (captured walk and sit, authored acting on the words, hands on the page, eyes on the lens):
// he walks in past us ("Sit. You're early."), sits at the Ledger's desk with the black hole in the window behind him,
// writes the sixth name, looks up and talks to us. The pull goes through the room behind him; it stops dead; he leans
// in; he shuts the Ledger and turns to the window, and the camera goes over him into the shadow and the title.
// The game's opening: Vault.entry plays it (the older entrance film is kept in vault.ts for reference only).
import * as THREE from 'three';
import type { Vault } from './vault';
import { Film, Shot, V, shoot, smooth as sm } from './entrance';
import { audio } from '../core/audio';
import { sceneSound } from '../core/soundscape';
import type { Page } from './entrance';

interface Inner {
  pullK: number; drift: number; lampK: number; glowK: number; leaf: THREE.Group; book: THREE.Group; page: Page;
  candle: THREE.Group; candleGlow: THREE.Sprite; lamp: THREE.SpotLight; lampG: THREE.Group;
  pagePoint(px: number, py: number, lift?: number): THREE.Vector3;
  palmOn(px: number, py: number): { at: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3 };
}
const COL = { name: 1092, from: 1352 }, ROW6 = 470 + 5 * 96;

/** The film's clock. Lines (plan): 1 at 2.2, 2 at 12.1, 3 at 15.0, 4 at 19.6, 5 at 27.0, 6 at 34.6, 7 at 40.6. */
export const BS3_LINES: [string, number][] = [['mz.v3.1', 2.2], ['mz.v3.2', 12.1], ['mz.v3.3', 15.0], ['mz.v3.4', 19.6], ['mz.v3.5', 27.0], ['mz.v3.6', 34.6], ['mz.v3.7', 40.6]];

export function bs3Film(v: Vault, lang = 'en'): Film {
  const cam = v.camera, host = v.host, snd = v.snd, P = v as unknown as Inner, page = P.page;
  const win = V(0, 24, -96);
  const T = { sit0: 4.8, write0: 9.9, look: 14.2, pull0: 24.4, stop: 33.0, lean0: 39.0, lean1: 44.6, shut: 45.4, hand: 49.0, len: 51.4 }; // (the ring's journey to the title is 2.9 s: a longer tail was 6 s of black, GPU take v3b)
  // the last line runs longer in Hindi (4.1 s) and Urdu (5.6 s) than in English (3.35 s): the end waits for it
  { const x = ({ hi: 0.9, ur: 2.4 } as Record<string, number>)[lang] ?? 0; T.lean1 += x; T.shut += x; T.hand += x; T.len += x; }
  const L = Object.fromEntries(BS3_LINES.map(([k, t]) => [k.slice(-1), t])) as Record<string, number>;
  // where the stool stands (he faces +z, towards the lens; the window and the black hole are behind him)
  const S = V(0.2, 0, 2.6);
  let W = V(0, 0, 2.6), th = 0, laid = false, seatY = 0.87;
  const set = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2016, roughness: 0.5 }), brass = new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.35, metalness: 0.9 });
  const stool = new THREE.Group(); set.add(stool);
  { const top = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.045, 24), wood); top.position.y = -0.022; stool.add(top);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.78; const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 1, 8), brass); leg.name = 'leg'; leg.position.set(Math.cos(a) * 0.15, -0.5, Math.sin(a) * 0.15); stool.add(leg); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.008, 6, 28).rotateX(Math.PI / 2), brass); ring.name = 'ring'; stool.add(ring); }
  // a soft key from beside the lens and a cool fill, so his face is read against the window (v2's close-ups were back-lit)
  const key = new THREE.SpotLight(0xffe2bc, 0, 14, 0.5, 0.8, 1.2); key.position.set(-1.6, 3.0, 6.2); key.target.position.copy(S).setY(1.5); set.add(key, key.target);
  const fill = new THREE.PointLight(0x9ab0ff, 0, 8, 2); fill.position.set(2.2, 1.6, 4.6); set.add(fill);
  // the Vault's lectern (the Ledger, its hinged leaf, the inkwell, the hooded lamp) is brought round to stand in front of
  // him as his writing desk: its local +z is away from the writer, here towards us
  const desk = P.book.parent as THREE.Object3D;
  const keep = { desk: [desk.position.clone(), desk.rotation.y] as const, candle: P.candle.position.clone(), glow: P.candleGlow.position.clone(), lamp: P.lamp.position.clone(), lampT: P.lamp.target.position.clone() };
  const rot = (p: THREE.Vector3, a: number) => V(p.x * Math.cos(a) + p.z * Math.sin(a), p.y, -p.x * Math.sin(a) + p.z * Math.cos(a));
  const nibAt = (px: number, py: number, lift = 0) => P.pagePoint(px, py, lift);
  const INK = page.ink.filter((k) => k.t0 >= 0);
  const eye = () => v.eyesAt();
  let trk: THREE.Vector3 | null = null;
  let eye0: THREE.Vector3 | null = null; const eyeHeld = () => eye0 ?? v.eyesAt();
  let shots: Shot[] = [];
  const lay = () => {
    const A = v.acting; if (!A || laid) return; laid = true;
    th = -A.seatYaw; const k = host.legScale;
    W = S.clone().sub(rot(V(A.seat[0] * k, 0, A.seat[2] * k), th));
    seatY = A.seat[1] * k - 0.125;
    stool.position.set(S.x, seatY, S.z);
    stool.traverse((c) => { if (c.name === 'leg') { c.scale.y = seatY; c.position.y = -seatY / 2; } if (c.name === 'ring') c.position.y = -seatY * 0.55; });
    // the desk's top (1.08 up on the lectern, tipped 0.24) at a seated writer's elbows
    const dy = seatY + 0.3 - 1.08;
    desk.position.set(S.x, dy, S.z + 0.62); desk.rotation.y = 0;
    const [, leg, foot] = desk.children as THREE.Mesh[];
    if (leg && foot) { leg.scale.y = (0.52 * 2 + dy) / 1.04; leg.position.y = (0.52 * 2 + dy) / 2 - dy; foot.position.y = 0.03 - dy; }
    // the candle on the desk's far corner, the lamp over his left shoulder onto the page
    desk.updateWorldMatrix(true, true);
    const c = desk.localToWorld(V(-0.55, 1.2, 0.2)); P.candle.position.set(c.x, c.y + 0.172, c.z); P.candleGlow.position.set(c.x, c.y + 0.195, c.z);
    P.lamp.position.set(S.x + 0.7, seatY + 1.4, S.z + 0.2); P.lamp.target.position.copy(nibAt(1024, 600));
    const face = V(S.x, seatY + 0.95, S.z);
    shots = [
      // 1. the room and the window, low, for a moment
      { t0: 0, t1: 1.5, a: V(S.x + 2.6, 1.1, S.z + 4.6), b: V(S.x + 2.3, 1.15, S.z + 4.45), la: V(0, 1.5, 0), lb: V(-0.1, 1.45, 0.2), fov: [36, 35], breath: 0.5 },
      // 1b. he comes in past us and looks at us once ("Sit. You're early."): a longer lens that pans with him, his head and
      // chest large enough to read on his first line (v3 take r8: he was small and far off when he spoke it)
      { t0: 1.5, t1: T.sit0, a: V(S.x + 1.9, 1.55, S.z + 3.9), b: V(S.x + 1.6, 1.5, S.z + 3.6), la: V(S.x, 1.4, S.z), fov: [23, 25], breath: 0.4 },
      // 2. he turns and sits at the desk: full body, the black hole over his shoulder
      { t0: T.sit0, t1: T.write0, a: V(S.x + 1.9, 2.0, S.z + 3.6), b: V(S.x + 1.5, 1.95, S.z + 3.2), la: V(S.x - 0.05, 1.45, S.z), lb: V(S.x - 0.05, 1.3, S.z), fov: [38, 34], breath: 0.5 }, // (from above the lectern: low, it hid him and cut off his head, GPU take v3b)
      // 3. from his front left over the desk: he writes the sixth name
      { t0: T.write0, t1: 11.9, a: V(S.x + 0.95, seatY + 1.0, S.z + 1.45), b: V(S.x + 0.8, seatY + 0.97, S.z + 1.3), la: nibAt(1250, ROW6 - 40), fov: [30, 28], f: [1.5, 1.3], ap: 0.008, breath: 0.4 },
      // 4. straight down on the Ledger, its top at the top of the frame: six names and homes, the sixth being written
      { t0: 11.9, t1: T.look, up: V(0, 0, 1), a: nibAt(1300, 760, 0.62), b: nibAt(1300, 760, 0.56), la: nibAt(1300, 760), fov: [34, 33], ap: 0.006, breath: 0.3 },
      // 5. across the desk, his hands in frame: he looks up and tells us who they are (a slow push)
      { t0: T.look, t1: T.pull0, a: V(S.x + 0.34, seatY + 0.66, S.z + 2.6), b: V(S.x + 0.2, seatY + 0.68, S.z + 2.15), la: face.clone().setY(seatY + 0.62), fov: [28, 26], f: [2.5, 2.05], ap: 0.006, breath: 0.4 },
      // 6. the pull: low over the floor from his side, the slips going past behind him to the window
      // (from his side it was a dark stool and his legs, take r7: now from low behind his left shoulder towards the window,
      // the slips skating away across the floor under the black hole)
      { t0: T.pull0, t1: 26.7, a: V(S.x - 1.3, 0.55, S.z + 0.9), b: V(S.x - 1.2, 0.6, S.z + 0.6), la: V(-0.3, 0.6, -3.5), lb: V(-0.2, 0.9, -5), fov: [44, 42], breath: 0.8 },
      // 7. back to him, closer: hair and coat leaning to the window, his palm holding the page down
      { t0: 26.7, t1: T.stop, a: V(S.x + 0.3, seatY + 0.8, S.z + 1.95), b: V(S.x + 0.24, seatY + 0.82, S.z + 1.75), la: face.clone().setY(seatY + 0.78), fov: [27, 26], f: [1.9, 1.7], ap: 0.01, breath: 0.9 },
      // 8. it stops dead: close, held where his eyes are at the cut
      { t0: T.stop, t1: T.lean0, origin: eyeHeld, a: V(0.14, -0.04, 1.2), b: V(0.1, -0.03, 1.08), la: V(0, -0.035, 0), fov: [21, 20], f: [1.2, 1.08], ap: 0.012, breath: 0.5 },
      // 9. he leans in: the lens holds its place and he comes to it
      { t0: T.lean0, t1: T.lean1, origin: eyeHeld, a: V(0.1, -0.03, 1.06), b: V(0.08, -0.03, 1.02), la: V(0, -0.04, 0), fov: [20, 19], f: [1.05, 0.82], ap: 0.014, breath: 0.5 },
      // 10. he shuts the Ledger with the flat of his hand
      { t0: T.lean1, t1: T.shut + 0.9, a: V(S.x - 0.5, seatY + 0.9, S.z + 2.5), b: V(S.x - 0.45, seatY + 0.95, S.z + 2.35), la: face.clone().setY(seatY + 0.6), fov: [32, 32], breath: 0.4 },
      // 11. over him into the window: the photon ring, the shadow, the hand-over to the title
      { t0: T.shut + 0.9, t1: T.len, a: V(S.x - 0.45, seatY + 0.95, S.z + 2.35), via: V(S.x, 3.0, S.z - 0.6), b: V(0.08, 3.5, -6.2), la: face.clone().setY(seatY + 0.8), lb: win, look: [0, 0.4], fov: [32, 3.2], ease: 'in' },
    ];
  };
  let bed = false, hold = -1, sub = -1, rise = -1, low = -1, cut = false, shut = false;
  const beat = (t: number, t0: number, t1: number, inn = 0.22, out = 0.5) => sm(t0 - inn, t0, t) * (1 - sm(t1, t1 + out, t));
  return {
    len: T.len, handover: T.hand, lines: [],
    start: () => {
      v.scene.add(set); void v.loadActing(); laid = false; eye0 = null; trk = null;
      P.lampG.visible = false; // (its hood and bulb flared over the right of every medium shot, take r7; its light stays)
      host.root.position.set(0, -50, 0);
      key.intensity = 34; fill.intensity = 5;
      P.drift = 0; P.pullK = 0; P.lampK = 1; P.glowK = 0; P.leaf.rotation.z = 0;
      // the sixth name and its home, on this film's clock
      if (INK[0]) { INK[0].t0 = T.write0 + 0.3; INK[0].t1 = T.write0 + 2.0; } if (INK[1]) { INK[1].t0 = T.write0 + 2.4; INK[1].t1 = T.write0 + 3.9; }
      sceneSound({ music: null, beds: {} });
      bed = cut = shut = false; hold = sub = rise = low = -1;
      host.setFace(null); page.draw(0);
    },
    frame: (ft) => {
      lay();
      if (!laid) { cam.position.set(S.x + 2, 1.3, S.z + 4.5); cam.lookAt(S.x, 1.1, S.z); return; }
      const A = v.acting!, dSit = A.clips.mz_sit_down.dur, tSit = ft - T.sit0, seated0 = T.sit0 + dSit;
      // --- the body: the captured walk in, the captured sit, the seated loops; the talk loop's hands under the lines ---
      const perf: { name: string; time: number; w: number; loop?: boolean }[] = [];
      const dWalk = A.clips.mz_walk_in?.dur ?? 0;
      host.root.position.copy(W); host.root.rotation.y = th;
      if (ft < T.sit0 + 0.45 && dWalk) {
        const left = Math.max(0, T.sit0 - ft), slow = 0.55, rate = 0.8;
        const tw = dWalk - rate * (left > slow ? left - slow / 2 : left * left / (2 * slow));
        if (tw < 0) host.root.position.y = -50;
        perf.push({ name: 'mz_walk_in', time: Math.max(0, Math.min(dWalk, tw)), w: 1 - sm(0, 0.45, tSit) });
        v.setPose('stand');
      }
      if (ft >= T.sit0) {
        const wIn = sm(0, 0.45, tSit);
        // his hands talk a little on the lines he says to us across the desk; still for the pull and the close-ups
        const talk = 0.5 * sm(T.look + 0.6, T.look + 1.4, ft) * (1 - sm(T.pull0 - 0.6, T.pull0 + 0.4, ft));
        if (ft < seated0 - 0.3) perf.push({ name: 'mz_sit_down', time: tSit, w: wIn });
        else {
          const u = sm(seated0 - 0.3, seated0 + 0.3, ft);
          perf.push({ name: 'mz_sit_down', time: tSit, w: 1 - u });
          perf.push({ name: 'mz_sit_idle', time: ft - seated0, w: u * (1 - talk * 0.85), loop: true });
          if (talk > 0) perf.push({ name: 'mz_sit_talk', time: ft - seated0, w: u * talk * 0.85, loop: true });
        }
        v.setPose(tSit > 2.6 ? 'sit' : 'stand');
      }
      host.perform(perf.length ? perf : null);
      if (ft < T.stop) eye0 = null; else if (!eye0) eye0 = v.eyesAt().clone();
      { const hp = v.eyesAt(); trk = trk && trk.distanceTo(hp) < 1.2 ? trk.lerp(hp, 0.12) : hp.clone(); } // (snaps when he first comes into the room)
      shoot(shots, ft, cam, (t) => (t >= 1.5 && t < T.sit0 && trk ? trk.clone().add(V(0, -0.28, 0)) : null));
      page.draw(ft);
      // --- hands ---
      const nibP = page.nib(ft);
      const seated = ft > T.write0 - 0.3;
      const rest = nibAt(1880, 900, 0.012);
      let right: THREE.Vector3 | null = null;
      if (seated && ft < T.write0 + 4.1) right = nibP ? nibAt(nibP[0], nibP[1]) : nibAt(ft < T.write0 + 2.2 ? COL.name - 10 : COL.from - 10, ROW6 - 28, 0.02);
      else if (seated && ft < T.shut + 1.5) {
        // the quill laid down at his right, then the hand rests there; it lifts a finger's height on "decide"
        const lift = 0.025 * beat(ft, L['7'] + 0.1, L['7'] + 0.5, 0.15, 0.3);
        right = nibAt(COL.from + 300, ROW6 - 20, 0.02).lerp(rest, sm(T.write0 + 4.1, T.look + 0.3, ft)).add(V(0, Math.sin(sm(T.write0 + 4.1, T.look + 0.3, ft) * Math.PI) * 0.04 + lift, 0));
      }
      // the left hand: flat on the left page while he writes and talks; held down on the lifting page in the pull;
      // a small open-handed shrug on "I don't decide which"; flat on the leaf to shut the book
      const shrug = beat(ft, L['6'] + 0.2, L['6'] + 1.3, 0.35, 0.6);
      let left: { at: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3 } | null = null;
      if (seated && ft > T.look - 0.3 && ft < T.shut + 0.8) { // (not while he writes: over the top-down insert his left hand hung as a splayed claw, take r7)
        const p = P.palmOn(ft > T.lean1 ? 520 : 700, ft > T.lean1 ? 700 : 760);
        p.at.y += 0.06 * shrug; p.palm.lerp(V(0, 1, 0.4).normalize(), shrug * 0.7).normalize();
        left = p;
      }
      v.hand.set(right, left);
      host.setGrip('L', seated ? { shape: 'relaxed', amount: 0.55 } : null);
      // the page lifts in the pull under his palm; he shuts the book at the end
      const lift = ft < T.stop ? sm(T.pull0 + 2, T.pull0 + 4.5, ft) * (0.08 + 0.05 * Math.sin(ft * 13) + 0.03 * Math.sin(ft * 29)) : 0;
      P.leaf.rotation.z = lift + sm(T.shut - 0.9, T.shut, ft) * Math.PI * 0.985;
      if (!shut && ft >= T.shut) { shut = true; snd.thump(0.7, 80); audio.sample('leather', 0.8, { at: { x: S.x, y: 1.2, z: S.z + 0.6 }, near: 2, tag: 'mz' }); }
      P.pullK = ft < T.stop ? sm(T.pull0, T.pull0 + 3, ft) * (0.85 + 0.15 * Math.sin(ft * 3.3)) : 0;
      // --- eyes: ahead as he walks, us once as he passes, us as he sits, the nib, then us; the slips at his feet for a
      // moment in the pull; the book as he shuts it; the window ---
      const fwd = V(Math.sin(th), 0, Math.cos(th));
      const ahead = host.root.position.clone().add(V(0, 1.9, 0)).addScaledVector(fwd, 3);
      const gaze = ft < L['1'] - 0.2 ? ahead : ft < L['1'] + 1.6 ? cam.position : ft < T.sit0 + 0.8 ? ahead
        : ft < T.write0 ? cam.position : ft < L['2'] + 0.9 ? (nibP ? nibAt(nibP[0], nibP[1]) : nibAt(COL.from + 120, ROW6))
        : ft > T.pull0 + 1.2 && ft < T.pull0 + 2.4 ? V(S.x - 0.9, 0.1, S.z - 1.2)
        : ft > T.lean1 && ft < T.shut + 0.4 ? nibAt(900, 650) : ft >= T.shut + 0.4 ? V(S.x - 7, 2.6, S.z + 0.5) : cam.position;
      host.setLookTarget(gaze);
      host.setGazeRate(ft > L['2'] + 0.8 && ft < L['2'] + 1.6 ? 3.2 : ft > T.stop && ft < T.stop + 0.5 ? 6 : null);
      // --- the face and the head on the words (word times from tools/tts/visemes.py, en) ---
      const w3 = L['3'], w4 = L['4'], w5 = L['5'], w6 = L['6'], w7 = L['7'];
      const found = beat(ft, L['2'] + 1.0, L['2'] + 1.4, 0.25, 0.8);                    // "yet": he finds us, brows up
      const six = beat(ft, w3 + 0.05, w3 + 0.2, 0.16, 0.35);                             // "Six": the smallest nod
      const hole = beat(ft, w3 + 2.6, w3 + 3.6, 0.3, 0.7);                               // "black hole": head a touch to one side, one brow
      const read = beat(ft, w4 + 0.1, w4 + 1.6, 0.3, 0.6);                               // "I've read how this ends": chin down, eyes up
      const more = beat(ft, w4 + 2.6, w4 + 4.0, 0.25, 0.7);                              // "more than one way": the half smile
      const pull = P.pullK;
      const most = beat(ft, w5 + 1.4, w5 + 2.6, 0.3, 0.5);                               // "somebody you like": one brow
      const home = beat(ft, w5 + 3.0, w5 + 4.2, 0.2, 0.8);                               // "doesn't come home": still, a slow blink
      const which = beat(ft, w6 + 0.2, w6 + 1.4, 0.3, 0.5);                              // "I don't decide which": a shrug, a turn of the head
      const write = beat(ft, w6 + 2.0, w6 + 3.0, 0.2, 0.6);                              // "I only write it down": a nod down at the book
      const lean = sm(T.lean0, T.lean0 + 1.2, ft) * (1 - sm(T.lean1, T.lean1 + 0.9, ft));
      const smile = beat(ft, w7 + 2.0, w7 + 3.4, 0.4, 0.9);                              // "Try not to enjoy it.": the smallest smile
      host.setAct({
        nod: 0.05 * six + 0.06 * read + 0.06 * write + 0.04 * lean - 0.03 * found,
        turn: 0.06 * which - 0.025 * smile,
        tilt: 0.06 * hole - 0.05 * more + 0.04 * which - 0.03 * smile,
        chestNod: 0.02 * six + 0.02 * write,
        chestTilt: 0.02 * hole,
        shoulderL: 0.08 * shrug + 0.02 * hole, shoulderR: 0.06 * shrug,
      });
      const early = beat(ft, L['1'] + 0.5, L['1'] + 1.3, 0.2, 0.6);                   // "You're early.": one brow, a dry look
      const threat = beat(ft, w5 + 1.6, w5 + 3.6, 0.4, 0.8);                             // "somebody you like doesn't come home": the eyes narrow
      host.setFace({
        brow_up: 0.5 * found + 0.25 * six + 0.3 * which,
        brow_upR: 0.5 * early,
        cheek: 0.25 * threat + 0.2 * smile + 0.15 * more,
        brow_upL: 0.55 * hole + 0.45 * most + 0.3 * more,
        brow_down: 0.25 * read + 0.2 * lean * (1 - smile) + 0.25 * pull + 0.2 * threat,
        squint: 0.12 * read + 0.14 * lean + 0.22 * smile + 0.3 * threat + 0.12 * early,
        blink: ft > w5 + 3.75 && ft < w5 + 4.0 ? 0.95 : undefined,
        smileL: 0.45 * more + 0.4 * smile + 0.25 * early,
        smile: 0.08 * smile,
        frown: 0.12 * pull + 0.1 * home,
      });
      host.setLean(0.2 * lean + 0.06 * sm(T.write0, T.write0 + 0.8, ft) * (1 - sm(T.look - 0.4, T.look + 0.4, ft)));
      // --- sound ---
      snd.scratch(page.writing(ft), ft, 0.08);
      if (!bed && ft > 0.2) { bed = true; sceneSound({ music: null, beds: { amb_room: 0.5 } }); hold = snd.hold([73.42, 110.0, 146.83], 0.2, 4); }
      if (sub < 0 && ft > T.pull0) { sub = snd.hold([36.7, 55.0], 0.0, 1, 'sine', 200); snd.fade(sub, 0.55, 6); audio.sample('rumble', 0.55, { tag: 'mz', dur: T.stop - T.pull0 }); rise = snd.hold([220, 233.08], 0.0, 1, 'sawtooth', 900); snd.fade(rise, 0.06, 6); snd.bend(rise, 1.5, 8); }
      if (ft > T.pull0 + 1.5 && ft < T.stop) { if (Math.random() < pull * 0.18) snd.burst(1800 + Math.random() * 2400, 6, 0.04, 0.06 * pull); if (lift > 0.05 && Math.random() < 0.3) snd.burst(500 + Math.random() * 400, 1.2, 0.08, 0.05); }
      if (!cut && ft >= T.stop) { cut = true; for (const id of [hold, sub, rise]) snd.fade(id, 0, 0); audio.stopTag('mz', 0.05); audio.bedLevel('amb_room', 0, 0.05); }
      if (low < 0 && ft >= T.shut) { low = snd.hold([36.71, 55.0, 73.42], 0.26, 2.5); audio.bedLevel('amb_room', 0.4, 1.2); }
      if (ft >= T.hand) { snd.fade(low, 0, 3); audio.bedLevel('amb_room', 0, 3); }
    },
    stop: () => {
      v.scene.remove(set); P.lampG.visible = true; P.pullK = 0; host.perform(null); host.setLean(0); host.setFace(null); host.setAct(null); host.setGrip('L', null); v.hand.set(null);
      desk.position.copy(keep.desk[0]); desk.rotation.y = keep.desk[1];
      const [, leg, foot] = desk.children as THREE.Mesh[]; if (leg && foot) { leg.scale.y = 1; leg.position.y = 0.52; foot.position.y = 0.03; }
      P.candle.position.copy(keep.candle); P.candleGlow.position.copy(keep.glow); P.lamp.position.copy(keep.lamp); P.lamp.target.position.copy(keep.lampT);
    },
  };
}
