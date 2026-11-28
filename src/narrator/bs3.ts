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
  candle: THREE.Group; candleGlow: THREE.Sprite; candleBase: THREE.Object3D[]; lamp: THREE.SpotLight; lampG: THREE.Group;
  pagePoint(px: number, py: number, lift?: number): THREE.Vector3;
  palmOn(px: number, py: number): { at: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3 };
}
const COL = { name: 1092, from: 1352 }, ROW6 = 470 + 5 * 96, BW2 = 0.95 / 2; // (BW2: half the Ledger's width, vault.ts BW)

/** How long each line's take runs (s, measured from public/audio/vo/<lang>/mz.v3.N.ogg): the film's clock is laid out
 *  from them, so every language gets the same held beats (owner: "slow and dramatic, no need to rush"). */
const DUR: Record<string, number[]> = { en: [1.75, 1.44, 3.84, 4.39, 4.36, 3.54, 3.36], hi: [2.34, 2.05, 4.21, 5.79, 4.81, 4.39, 3.89], ur: [2.19, 1.94, 3.97, 5.96, 4.53, 4.27, 5.72] };
/** The film's clock for a language: the lines' seconds and the beats of the action round them. */
export function bs3Plan(lang = 'en') {
  const D = DUR[lang] ?? DUR.en, T: Record<string, number> = {}, L: number[] = [0];
  T.walkEnd = 12.8;                        // ~13 s of the Vault and the black hole first; he walks in for the last 3
  L[1] = T.walkEnd + 2.4;                  // he stops and looks at us, held, before he speaks
  T.sit0 = L[1] + D[0] + 1.6; T.seated = T.sit0 + 4.7; T.write0 = T.seated + 1.0;
  T.name0 = T.write0 + 0.4; T.name1 = T.name0 + 3.2;     // he takes his time over the sixth name
  L[2] = T.name1 + 0.6;                    // the quill pauses over the page on "They haven't left yet."
  T.found = L[2] + D[1] * 0.7;             // "yet": he looks up and finds us
  T.home0 = L[2] + D[1] + 1.6; T.home1 = T.home0 + 2.6; T.look = T.home1 + 0.9;
  L[3] = T.look + 2.4; L[4] = L[3] + D[2] + 2.2;
  T.pull0 = L[4] + D[3] + 2.4; L[5] = T.pull0 + 2.8; T.stop = L[5] + D[4] + 1.5;
  L[6] = T.stop + 3.0; T.lean0 = L[6] + D[5] + 1.0; L[7] = T.lean0 + 2.2;
  T.lean1 = L[7] + D[6] + 2.4;             // a held beat after the last line before he shuts the book
  T.hook = T.lean1 + 0.9; T.up = T.hook + 1.1; T.over = T.up + 0.9; T.shut = T.over + 1.5; T.free = T.shut + 1.8; // (slower round the edge and over: at 0.5 + 0.8 s the cover swung 1.5 m/s and his hand lagged it in the air, w2)
  T.hand = T.shut + 8.0; T.len = T.hand + 1.6;
  return { T, L, D };
}
/** The lines at their seconds (English; bs3Lines for the others). */
export const bs3Lines = (lang = 'en'): [string, number][] => bs3Plan(lang).L.slice(1).map((t, i) => [`mz.v3.${i + 1}`, +t.toFixed(2)]);
export const BS3_LINES = bs3Lines('en');

export function bs3Film(v: Vault, lang = 'en'): Film {
  const cam = v.camera, host = v.host, snd = v.snd, P = v as unknown as Inner, page = P.page;
  const win = V(0, 24, -96);
  const { T, L: LL } = bs3Plan(lang);
  const L = Object.fromEntries(LL.map((t, i) => [String(i), t])) as Record<string, number>;
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
  const keep = { desk: [desk.position.clone(), desk.rotation.y] as const, candle: P.candle.position.clone(), base: P.candleBase.map((o) => o.position.clone()), glow: P.candleGlow.position.clone(), lamp: P.lamp.position.clone(), lampT: P.lamp.target.position.clone() };
  const rot = (p: THREE.Vector3, a: number) => V(p.x * Math.cos(a) + p.z * Math.sin(a), p.y, -p.x * Math.sin(a) + p.z * Math.cos(a));
  const nibAt = (px: number, py: number, lift = 0) => P.pagePoint(px, py, lift);
  const INK = page.ink.filter((k) => k.t0 >= 0);
  const eye = () => v.eyesAt();
  let trk: THREE.Vector3 | null = null, reach0: THREE.Vector3 | null = null, lFrom: THREE.Vector3 | null = null;
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
    // (out at the desk's corner, clear of his writing hand; its stick and wax go with the flame: take v3c showed a flame
    // floating over the desk on nothing)
    const c = desk.localToWorld(V(-0.68, 1.2, 0.26)); P.candle.position.set(c.x, c.y + 0.172, c.z); P.candleGlow.position.set(c.x, c.y + 0.195, c.z);
    P.candleBase.forEach((o, i) => o.position.copy(keep.base[i]).sub(keep.candle).add(P.candle.position));
    P.lamp.position.set(S.x + 0.7, seatY + 1.4, S.z + 0.2); P.lamp.target.position.copy(nibAt(1024, 600));
    const face = V(S.x, seatY + 0.95, S.z), cdl = P.candle.position.clone();
    // (pacing, owner 2026-11-28: "Make it more slow and dramatic, no need to rush, let the users connect with the
    // game": fewer cuts, each shot held long enough to read, slow pushes, a cut only when the action or a line asks)
    const walk0 = T.walkEnd - 2.0, homeAt = nibAt(COL.from + 150, ROW6 - 50);
    shots = [
      // 1. the Vault in the dark and the black hole through the window, a long slow push down the room (no one yet)
      { t0: 0, t1: 6.8, a: V(S.x + 0.9, 1.25, S.z + 7.2), b: V(S.x + 0.55, 1.35, S.z + 5.9), la: V(0, 3.2, -9), lb: V(0, 2.9, -9), fov: [40, 37], breath: 0.4 },
      // 1a. the room he works in: the desk, the stool, the candle, the window behind (held, almost still)
      { t0: 6.8, t1: walk0, a: V(S.x + 2.6, 1.1, S.z + 4.6), b: V(S.x + 2.35, 1.13, S.z + 4.45), la: V(0, 1.5, 0), lb: V(-0.08, 1.46, 0.15), fov: [36, 35], breath: 0.5 },
      // 1b. he comes in past us, stops and looks at us, held ("Sit. You're early."): a longer lens that pans with him
      // and pushes in slowly on the held look
      { t0: walk0, t1: T.sit0 + 3.2, a: V(S.x + 1.9, 1.55, S.z + 3.9), b: V(S.x + 1.55, 1.5, S.z + 3.45), la: V(S.x, 1.4, S.z), fov: [25, 20], breath: 0.4 },
      // (the long lens stays on his face while he turns to the stool and goes down: from above, the turn showed his back
      // at a tilt beside the lectern, take v3c)
      // 2. he sits at the desk: full body, the black hole over his shoulder (from above the lectern, level: the
      // lens is not rolled, and it looks along him and not down across him)
      { t0: T.sit0 + 3.2, t1: T.write0, a: V(S.x + 1.9, 1.85, S.z + 3.7), b: V(S.x + 1.6, 1.8, S.z + 3.35), la: V(S.x - 0.05, 1.4, S.z), lb: V(S.x - 0.05, 1.25, S.z), fov: [38, 35], breath: 0.5 },
      // 3. from his front left over the desk: he writes the sixth name, the quill pauses, he looks up on "yet"
      { t0: T.write0, t1: T.home0 - 0.4, a: V(S.x + 0.95, seatY + 1.0, S.z + 1.45), b: V(S.x + 0.78, seatY + 0.98, S.z + 1.32), la: nibAt(1250, ROW6 - 40), lb: nibAt(1250, ROW6 - 40).lerp(face, 0.35), fov: [30, 28], f: [1.5, 1.35], ap: 0.008, breath: 0.4 },
      // 4. straight down on the Ledger: six names and homes, the sixth home being written (the frame is centred on the
      // home column and his hand lies off to the right of the line: take v3c, the hand covered "Eu..." as it was written)
      { t0: T.home0 - 0.4, t1: T.look, up: V(0, 0, 1), a: homeAt.clone().add(V(0, 0.6, 0)), b: homeAt.clone().add(V(0, 0.55, 0)), la: homeAt, fov: [34, 33], ap: 0.006, breath: 0.3 },
      // 5. across the desk, his hands in frame: he lays the quill down, looks up slowly and tells us who they are
      { t0: T.look, t1: L['3'] + 2.0, a: V(S.x + 0.34, seatY + 0.66, S.z + 2.7), b: V(S.x + 0.28, seatY + 0.67, S.z + 2.42), la: face.clone().setY(seatY + 0.62), fov: [28, 27], f: [2.6, 2.32], ap: 0.006, breath: 0.4 },
      // 5b. "One holiday past a black hole": low across the desk, looking up past him to the black hole in the window
      { t0: L['3'] + 2.0, t1: L['4'] - 0.3, a: V(S.x + 0.95, seatY + 0.36, S.z + 2.75), b: V(S.x + 0.82, seatY + 0.38, S.z + 2.55), la: V(S.x - 0.25, seatY + 1.45, S.z - 1.0), lb: V(S.x - 0.2, seatY + 1.5, S.z - 1.0), fov: [38, 37], breath: 0.4 },
      // 5c. "I've read how this ends": closer, from his other side, a slow drift round to the front, held through the
      // silence after the line
      { t0: L['4'] - 0.3, t1: T.pull0, a: V(S.x - 0.42, seatY + 0.72, S.z + 2.1), b: V(S.x - 0.08, seatY + 0.74, S.z + 1.9), la: face.clone().setY(seatY + 0.66), fov: [26, 24], f: [2.1, 1.92], ap: 0.007, breath: 0.4 },
      // 6. the pull: low behind his left shoulder towards the window, the slips skating away across the floor under the
      // black hole
      { t0: T.pull0, t1: T.pull0 + 2.3, a: V(S.x - 1.3, 0.55, S.z + 0.9), b: V(S.x - 1.2, 0.6, S.z + 0.66), la: V(-0.3, 0.6, -3.5), lb: V(-0.25, 0.85, -4.5), fov: [44, 43], breath: 0.8 },
      // 6b. the candle on his desk from the side, close: its flame lies over towards the window
      { t0: T.pull0 + 2.3, t1: T.pull0 + 4.0, a: cdl.clone().add(V(-0.3, 0.1, 0.2)), b: cdl.clone().add(V(-0.27, 0.1, 0.18)), la: cdl.clone().add(V(0, 0.02, -0.02)), fov: [32, 31], f: [0.38, 0.35], ap: 0.01, breath: 0.3 },
      // 7. back to him, closer: hair and coat leaning to the window, his palm holding the page down
      { t0: T.pull0 + 4.0, t1: T.stop, a: V(S.x + 0.3, seatY + 0.8, S.z + 1.95), b: V(S.x + 0.22, seatY + 0.82, S.z + 1.72), la: face.clone().setY(seatY + 0.78), fov: [27, 26], f: [1.9, 1.7], ap: 0.01, breath: 0.9 },
      // 8. it stops dead: close, held where his eyes are at the cut, through the silence and the next line
      { t0: T.stop, t1: T.lean0, origin: eyeHeld, a: V(0.14, -0.04, 1.2), b: V(0.1, -0.03, 1.08), la: V(0, -0.035, 0), fov: [21, 20], f: [1.2, 1.08], ap: 0.012, breath: 0.5 },
      // 9. he leans in: the lens holds its place and he comes to it; held after the last line
      { t0: T.lean0, t1: T.lean1, origin: eyeHeld, a: V(0.1, -0.03, 1.06), b: V(0.08, -0.03, 1.0), la: V(0, -0.04, 0), fov: [20, 19], f: [1.05, 0.82], ap: 0.014, breath: 0.5 },
      // 10. he shuts the Ledger: from his left, the cover and his hand in the frame with his face (the whole arc of the
      // cover reads, his fingers on its edge, then his palm on its back)
      { t0: T.lean1, t1: T.shut + 1.2, a: V(S.x + 0.95, seatY + 1.05, S.z + 2.3), b: V(S.x + 0.85, seatY + 1.08, S.z + 2.15), la: V(S.x + 0.05, seatY + 0.62, S.z + 0.45), lb: V(S.x, seatY + 0.66, S.z + 0.4), fov: [36, 35], breath: 0.4 },
      // 11. over him into the window: the photon ring, the shadow, the hand-over to the title (slow)
      { t0: T.shut + 1.2, t1: T.len, a: V(S.x + 0.85, seatY + 1.08, S.z + 2.15), via: V(S.x, 3.0, S.z - 0.6), b: V(0.08, 3.5, -6.2), la: face.clone().setY(seatY + 0.8), lb: win, look: [0, 0.35], fov: [35, 3.2], ease: 'in' },
    ];
  };
  let bed = false, hold = -1, sub = -1, rise = -1, low = -1, back = -1, cut = false, shut = false, grow = false, swell = false, fade = false;
  const beat = (t: number, t0: number, t1: number, inn = 0.22, out = 0.5) => sm(t0 - inn, t0, t) * (1 - sm(t1, t1 + out, t));
  return {
    len: T.len, handover: T.hand, lines: [],
    start: () => {
      v.scene.add(set); void v.loadActing(); laid = false; eye0 = null; trk = null; reach0 = null; lFrom = null;
      P.lampG.visible = false; // (its hood and bulb flared over the right of every medium shot, take r7; its light stays)
      host.root.position.set(0, -50, 0);
      key.intensity = 34; fill.intensity = 5;
      P.drift = 0; P.pullK = 0; P.lampK = 1; P.glowK = 0; P.leaf.rotation.z = 0;
      // the sixth name and its home, on this film's clock
      if (INK[0]) { INK[0].t0 = T.name0; INK[0].t1 = T.name1; } if (INK[1]) { INK[1].t0 = T.home0; INK[1].t1 = T.home1; }
      sceneSound({ music: null, beds: {} });
      bed = cut = shut = grow = swell = fade = false; hold = sub = rise = low = back = -1;
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
        const left = Math.max(0, T.walkEnd - ft), slow = 0.55, rate = 0.8; // (he stops at the stool at walkEnd and stands, held, until he sits)
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
      shoot(shots, ft, cam, (t) => (t >= T.walkEnd - 2.0 && t < T.sit0 + 3.2 && trk ? trk.clone().add(V(0, -0.28, 0)) : null));
      page.draw(ft);
      // --- the Ledger's leaf: the page lifts in the pull under his palm; he lifts the cover by its edge, brings it up
      // over and lays it shut with his palm on its back (set before the hands: they ride it) ---
      const lift = ft < T.stop ? sm(T.pull0 + 2, T.pull0 + 4.5, ft) * (0.08 + 0.05 * Math.sin(ft * 13) + 0.03 * Math.sin(ft * 29)) : 0;
      const LID = Math.PI * 0.985;
      // (up to about 100 degrees by its edge, a still beat at the top while his hand comes round, then laid shut)
      // (lifted by the edge only to ~30 degrees, held near 40 while the hand slides under it onto its back: at 100 the edge of this 0.95 m Ledger is half a metre up and his hand
      // fell 19 cm short of it, probe p3; then his hand goes round the edge onto the back and carries it over from there)
      const theta = ft < T.up ? 0.55 * sm(T.hook, T.up, ft) : ft < T.over ? 0.55 + 0.2 * sm(T.up, T.over, ft) : 0.75 + (LID - 0.75) * sm(T.over, T.shut, ft);
      P.leaf.rotation.z = lift + Math.min(LID, theta);
      P.leaf.updateWorldMatrix(true, false);
      if (!shut && ft >= T.shut) { shut = true; snd.thump(0.7, 80); audio.sample('leather', 0.8, { at: { x: S.x, y: 1.2, z: S.z + 0.6 }, near: 2, tag: 'mz' }); }
      P.pullK = ft < T.stop ? sm(T.pull0, T.pull0 + 3, ft) * (0.85 + 0.15 * Math.sin(ft * 3.3)) : 0;
      // --- hands ---
      const nibP = page.nib(ft);
      const seated = ft > T.write0 - 0.3;
      const rest = nibAt(1880, 900, 0.012);
      // the right hand: the nib on the name, lifted and paused over the page on line 2, the home, then the quill laid
      // down at his right; a finger's lift on "decide". The hand lies off to the right of the line it writes.
      if (ft < T.look + 0.5) v.hand.pose(V(0.3, -0.55, 1), V(0.7, -0.68, 0.05)); // (the hand more on its side: the curled fingers stay off the page)
      else v.hand.pose(V(0, -0.5, 1), V(0.35, -0.9, 0.1));
      const nameEnd = page.nib(T.name1 - 0.02) ?? [COL.name + 200, ROW6 - 28], homeEnd = page.nib(T.home1 - 0.02) ?? [COL.from + 300, ROW6 - 20];
      let right: THREE.Vector3 | null = null;
      // (the reach to the page starts from where the quill is in his hand as he settles, not in one frame: the probe
      // measured the hand jump 34 cm a frame onto the page on main)
      if (!seated) reach0 = null; else if (!reach0) { v.quill.updateWorldMatrix(true, false); reach0 = v.quill.localToWorld(V(0, -0.022, 0)); }
      if (seated && ft < T.home1 + 0.15) {
        if (nibP) right = nibAt(nibP[0], nibP[1]);
        else if (ft < T.name0) right = nibAt(COL.name - 10, ROW6 - 28, 0.02 * (1 - sm(T.write0 - 0.3, T.name0, ft)) + 0.004);
        else if (ft >= T.home1 - 0.05) right = nibAt(homeEnd[0], homeEnd[1], 0.01 * sm(T.home1 - 0.05, T.home1 + 0.15, ft)); // (the home written: it stays at its end and lifts; it went back to the home's start for 0.15 s, 9 cm a frame, probe p7)
        else { // between the name and the home: the quill lifts, holds still over the page, then goes to the home column
          const k = sm(T.home0 - 1.1, T.home0 - 0.05, ft), hop = Math.sin(Math.PI * k) * 0.02;
          right = nibAt(nameEnd[0] + (COL.from - 10 - nameEnd[0]) * k, nameEnd[1] + (ROW6 - 28 - nameEnd[1]) * k, 0.03 * sm(T.name1, T.name1 + 0.5, ft) * (1 - sm(T.home0 - 0.4, T.home0, ft)) + hop + 0.003);
        }
        if (reach0 && ft < T.write0 + 1.0) right = reach0.clone().lerp(right!, sm(T.write0 - 0.3, T.write0 + 1.0, ft));
      } else if (seated) { // (and the quill stays laid down in his hand to the end: let go at T.free the arm jumped back to the clip, probe p7)
        const lift7 = 0.025 * beat(ft, L['7'] + 0.1, L['7'] + 0.5, 0.15, 0.3), k = sm(T.home1 + 0.15, T.look + 0.6, ft);
        right = nibAt(homeEnd[0], homeEnd[1], 0.01).lerp(rest, k).add(V(0, Math.sin(k * Math.PI) * 0.04 + lift7, 0));
      }
      // the left hand: flat on the left page while he talks; held down on the lifting page in the pull; a small
      // open-handed shrug on "I don't decide which"; then he takes the cover's edge, lifts it, comes round over its top
      // edge onto its back and lays it shut, and rests there a moment before he lets go
      const shrug = beat(ft, L['6'] + 0.2, L['6'] + 1.3, 0.35, 1.0);
      type Hold = { at: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3; rigid?: boolean };
      let left: Hold | null = null;
      const lq = P.leaf.getWorldQuaternion(new THREE.Quaternion());
      const onLeaf = (x: number, y: number, z: number) => P.leaf.localToWorld(V(x, y, z));
      const leafDir = (x: number, y: number, z: number) => V(x, y, z).normalize().applyQuaternion(lq);
      const E = BW2 + 0.02, zc = -0.07;
      // leaf-local: the palm on the open page; fingertips hooked over the outer edge; the palm on the cover's back
      const pageHold = (): Hold => { const p = P.palmOn(640, 740); p.at.addScaledVector(leafDir(0, 1, 0), 0.016); // (the palm a little higher: its fingertips went 3 cm into the Ledger's block, probe p3)
         p.at.y += 0.06 * shrug; p.palm.lerp(V(0, 1, 0.4).normalize(), shrug * 0.7).normalize(); return p; };
      const hookHold = (): Hold => ({ at: onLeaf(E - 0.085, 0.05, zc), fingers: leafDir(1, -0.6, 0.12), palm: leafDir(0.35, -1, 0), rigid: true });
      const backHold = (press = 0): Hold => ({ at: onLeaf(0.26, -0.038 + press, zc), fingers: leafDir(0.25, 0, 1), palm: leafDir(0, 1, 0), rigid: true });
      const mixH = (a: Hold, b: Hold, k: number): Hold => ({ at: a.at.lerp(b.at, k), fingers: a.fingers.lerp(b.fingers, k).normalize(), palm: a.palm.lerp(b.palm, k).normalize(), rigid: true });
      if (ft < T.look - 0.3) lFrom = null;
      if (seated && ft > T.look - 0.3 && ft < T.lean1) {
        // (it comes onto the page over 2 s from where his hand is: picked up by the hold's own spring it crossed 60 cm
        // in half a second, the fingers 10 cm a frame, probe p6)
        left = pageHold();
        if (!lFrom) { const hl = host.root.getObjectByName('handL'); lFrom = hl ? hl.getWorldPosition(V(0, 0, 0)) : left.at.clone(); }
        const k = sm(T.look - 0.3, T.look + 1.7, ft); if (k < 1) left.at = lFrom.clone().lerp(left.at, k);
      } else if (ft >= T.lean1 && ft < T.hook) left = mixH(pageHold(), hookHold(), sm(T.lean1, T.hook, ft));
      else if (ft >= T.hook && ft < T.up) left = hookHold();
      else if (ft >= T.up && ft < T.over) {
        // round the top edge: out past the edge, then onto the back
        const k = sm(T.up, T.over, ft), h = hookHold(), b2 = backHold(), out = { at: onLeaf(E - 0.03, -0.075, zc), fingers: leafDir(-0.3, 0.2, 1), palm: leafDir(-0.2, 1, 0), rigid: true }; // (under the lifted edge, not round its top: there the hand fell 19 cm short, probe p4)
        // (one smooth curve through the three, not two eased halves: at the joint the fingers moved 9 cm a frame, probe p7)
        const bz = (a: THREE.Vector3, m: THREE.Vector3, c: THREE.Vector3) => a.clone().multiplyScalar((1 - k) * (1 - k)).addScaledVector(m, 2 * k * (1 - k)).addScaledVector(c, k * k);
        left = { at: bz(h.at, out.at, b2.at), fingers: bz(h.fingers, out.fingers, b2.fingers).normalize(), palm: bz(h.palm, out.palm, b2.palm).normalize(), rigid: true };
      } else if (ft >= T.over) left = backHold(-0.006 * beat(ft, T.shut, T.shut + 0.2, 0.15, 0.6)); // (and it stays on the shut book: let go at T.free the arm swung back to the clip's pose, 13 cm a frame, probe p6)
      v.hand.set(right, left);
      // (flat on the page: at 0.55 the fingertips curled 3 cm into the Ledger, probe on main; the curl round the cover's
      // edge comes and goes over 0.4 s: switched in a frame, the fingers jumped 12 cm, probe p3)
      host.setGrip('L', !seated ? null : { shape: 'relaxed', amount: 0.1 + 0.85 * sm(T.hook - 0.45, T.hook, ft) * (1 - sm(T.up, T.up + 0.9, ft)) + 0.15 * sm(T.up, T.over, ft) });
      // --- eyes: ahead as he walks; us, held, once he stops; down to the stool as he sits; us; the nib, then us on
      // "yet", the nib for the home; us (looked up to slowly); the slips in the pull; his hand on the cover; the window ---
      const fwd = V(Math.sin(th), 0, Math.cos(th));
      const ahead = host.root.position.clone().add(V(0, 1.9, 0)).addScaledVector(fwd, 3);
      const onNib = nibP ? nibAt(nibP[0], nibP[1]) : right ?? nibAt(COL.from + 120, ROW6);
      const gaze = ft < T.walkEnd - 0.3 ? ahead : ft < T.sit0 + 0.3 ? cam.position : ft < T.seated - 0.9 ? V(S.x, 0.2, S.z + 0.4)
        : ft < T.write0 - 0.2 ? cam.position : ft < T.found ? onNib : ft < T.home0 - 0.6 ? cam.position : ft < T.look ? onNib
        : ft > T.pull0 + 1.2 && ft < T.pull0 + 4.0 ? V(S.x - 0.9, 0.1, S.z - 1.2) // (on the slips until the cut back to him: in the candle insert he must not look into its lens)
        : ft > T.lean1 && ft < T.shut + 0.5 ? (left?.at ?? cam.position) : ft >= T.shut + 0.5 ? V(S.x - 7, 2.6, S.z + 0.5) : cam.position;
      host.setLookTarget(gaze);
      // looks up slowly (the eyes lead, the head follows); the snap only where it stops dead
      host.setGazeRate(ft > T.walkEnd - 0.3 && ft < T.walkEnd + 0.9 ? 1.6 : ft > T.found - 0.1 && ft < T.found + 1.2 ? 1.5 : ft > T.look - 0.1 && ft < T.look + 1.6 ? 1.2 : ft > T.stop && ft < T.stop + 0.5 ? 6 : null);
      // --- the face and the head on the words (word times from tools/tts/visemes.py, en) ---
      const w3 = L['3'], w4 = L['4'], w5 = L['5'], w6 = L['6'], w7 = L['7'];
      const found = beat(ft, T.found, T.found + 0.5, 0.35, 1.0);                         // "yet": he finds us, brows up
      const six = beat(ft, w3 + 0.05, w3 + 0.2, 0.16, 0.35);                             // "Six": the smallest nod
      const hole = beat(ft, w3 + 2.6, w3 + 3.6, 0.3, 0.9);                               // "black hole": head a touch to one side, one brow
      const read = beat(ft, w4 + 0.1, w4 + 1.6, 0.3, 0.6);                               // "I've read how this ends": chin down, eyes up
      const more = beat(ft, w4 + 2.6, w4 + 4.6, 0.25, 1.2);                              // "more than one way": the half smile, held into the silence
      const pull = P.pullK;
      const most = beat(ft, w5 + 1.4, w5 + 2.6, 0.3, 0.5);                               // "somebody you like": one brow
      const home = beat(ft, w5 + 3.0, w5 + 4.6, 0.2, 1.0);                               // "doesn't come home": still, a slow blink
      const which = beat(ft, w6 + 0.2, w6 + 1.4, 0.3, 0.5);                              // "I don't decide which": a shrug, a turn of the head
      const write = beat(ft, w6 + 2.0, w6 + 3.0, 0.2, 0.6);                              // "I only write it down": a nod down at the book
      const lean = sm(T.lean0, T.lean0 + 1.6, ft) * (1 - sm(T.lean1, T.lean1 + 1.2, ft));
      const smile = beat(ft, w7 + 2.0, w7 + 4.4, 0.5, 1.2);                              // "Try not to enjoy it.": the smallest smile, held
      const look0 = beat(ft, T.walkEnd + 0.4, L['1'] - 0.1, 0.8, 0.3);                  // the held look before he speaks: eyes narrow a touch
      const early = beat(ft, L['1'] + 0.5, L['1'] + 1.3, 0.2, 0.8);                   // "You're early.": one brow, a dry look
      const threat = beat(ft, w5 + 1.6, w5 + 4.0, 0.4, 1.0);                             // "somebody you like doesn't come home": the eyes narrow
      // (owner list: more head acting on the key lines: the nods and turns about 1.5 times what they were, a dry tilt on
      // "You're early." and the head lowered a little into the threat on "doesn't come home")
      host.setAct({
        nod: 0.08 * six + 0.11 * read + 0.09 * write + 0.07 * lean - 0.06 * found + 0.05 * threat,
        turn: 0.09 * which - 0.045 * smile + 0.03 * early,
        tilt: 0.1 * hole - 0.07 * more + 0.06 * which - 0.05 * smile + 0.03 * look0 + 0.045 * early,
        chestNod: 0.02 * six + 0.02 * write,
        chestTilt: 0.02 * hole,
        shoulderL: 0.08 * shrug + 0.02 * hole, shoulderR: 0.06 * shrug,
      });
      host.setFace({
        brow_up: 0.6 * found + 0.25 * six + 0.3 * which,
        brow_upR: 0.55 * early,
        cheek: 0.3 * threat + 0.25 * smile + 0.18 * more,
        brow_upL: 0.55 * hole + 0.45 * most + 0.3 * more,
        brow_down: 0.3 * read + 0.22 * lean * (1 - smile) + 0.25 * pull + 0.25 * threat + 0.15 * look0,
        squint: 0.14 * read + 0.16 * lean + 0.26 * smile + 0.38 * threat + 0.14 * early + 0.16 * look0,
        blink: ft > w5 + 3.75 && ft < w5 + 4.0 ? 0.95 : undefined,
        smileL: 0.5 * more + 0.48 * smile + 0.3 * early + 0.12 * look0,
        smile: 0.1 * smile,
        frown: 0.12 * pull + 0.12 * home,
      });
      host.setLean(0.2 * lean + 0.06 * sm(T.write0, T.write0 + 0.8, ft) * (1 - sm(T.look - 0.4, T.look + 0.4, ft)) + 0.08 * sm(T.lean1, T.hook, ft) * (1 - sm(T.shut, T.free + 0.6, ft)));
      // --- sound ---
      snd.scratch(page.writing(ft), ft, 0.08);
      // (room tone first; the bowed chord comes in under it slowly and grows as he talks to us, owner: "let the users
      // connect": 0 to 0.14 over ~12 s from 3 s, to 0.2 from the look)
      if (!bed && ft > 0.2) { bed = true; sceneSound({ music: null, beds: { amb_room: 0.5 } }); }
      if (hold < 0 && ft > 3) hold = snd.hold([73.42, 110.0, 146.83], 0.14, 12);
      if (!grow && ft > T.look) { grow = true; snd.fade(hold, 0.2, 8); }
      if (back < 0 && ft > L['6'] + 0.4) back = snd.hold([55.0, 82.41, 110.0], 0.09, 6); // (after the dead stop: a thread of the chord back under line 6)
      if (sub < 0 && ft > T.pull0) { sub = snd.hold([36.7, 55.0], 0.0, 1, 'sine', 200); snd.fade(sub, 0.55, 6); audio.sample('rumble', 0.55, { tag: 'mz', dur: T.stop - T.pull0 }); rise = snd.hold([220, 233.08], 0.0, 1, 'sawtooth', 900); snd.fade(rise, 0.06, 6); snd.bend(rise, 1.5, 8); }
      if (ft > T.pull0 + 1.5 && ft < T.stop) { if (Math.random() < pull * 0.18) snd.burst(1800 + Math.random() * 2400, 6, 0.04, 0.06 * pull); if (lift > 0.05 && Math.random() < 0.3) snd.burst(500 + Math.random() * 400, 1.2, 0.08, 0.05); }
      if (!cut && ft >= T.stop) { cut = true; for (const id of [hold, sub, rise]) snd.fade(id, 0, 0); audio.stopTag('mz', 0.05); audio.bedLevel('amb_room', 0, 0.05); }
      if (low < 0 && ft >= T.shut) { low = snd.hold([36.71, 55.0, 73.42], 0.26, 2.5); snd.fade(back, 0, 2); audio.bedLevel('amb_room', 0.4, 1.2); }
      // the swell into the title as the lens goes over him into the shadow, then it gives way to the title
      if (!swell && ft >= T.shut + 1.2) { swell = true; snd.fade(low, 0.44, 6); }
      if (!fade && ft >= T.hand) { fade = true; snd.fade(low, 0, 3.4); audio.bedLevel('amb_room', 0, 3); }
    },
    stop: () => {
      v.scene.remove(set); P.lampG.visible = true; P.pullK = 0; host.perform(null); host.setLean(0); host.setFace(null); host.setAct(null); host.setGrip('L', null); v.hand.set(null); v.hand.pose(V(0, -0.5, 1), V(0.35, -0.9, 0.1));
      desk.position.copy(keep.desk[0]); desk.rotation.y = keep.desk[1];
      const [, leg, foot] = desk.children as THREE.Mesh[]; if (leg && foot) { leg.scale.y = 1; leg.position.y = 0.52; foot.position.y = 0.03; }
      P.candle.position.copy(keep.candle); P.candleBase.forEach((o, i) => o.position.copy(keep.base[i])); P.candleGlow.position.copy(keep.glow); P.lamp.position.copy(keep.lamp); P.lamp.target.position.copy(keep.lampT);
    },
  };
}
