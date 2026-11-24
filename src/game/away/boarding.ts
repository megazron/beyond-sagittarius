import * as THREE from 'three';
import { bakeStatic, createShip, LINER, LINER_SCALE, type Ship } from '../../cinematic/ship';
import type { Character } from '../../characters/character';
import { audio } from '../../core/audio';

/**
 * The end of the Zenvora prologue: the six board the liner and it lifts off.
 *
 * The liner is the films' ship (cinematic/ship.ts, the one the deck, the departure and the pull show), at LINER_SCALE,
 * standing on its tail on its landing legs on a pad on the spaceport's apron, its hatch open towards the terminal. A
 * boarding gantry runs from the apron up to the hatch: a ramp, a platform and an access arm that swings away before the
 * lift-off. Everything here is a function of the scene's own clock T, so a test can play it without drawing it.
 *
 * The scene, in shots (all on one side of the line the six walk along, except the one reverse, his eyes):
 *  A  wide, low on the apron: the liner on its pad, the six in single file on the gantry, the first one going in
 *  B  medium, side on to the ramp: them climbing, one after another through the hatch
 *  C  low, from the foot of the ramp: the last two climbing towards the lit hatch
 *  D1 his last look back: on the platform he stops and turns; close on his face
 *  D2 what he sees: the city, over his shoulder
 *  D3 medium: he turns back and goes in; the hatch slides shut
 *  E  wide: the access arm swings away, the lift jets light
 *  F  low and wide: the liner lifts straight up off its pad
 *  G  with it, below and behind, the city far beneath, as it noses over and climbs away
 */

/** The pad: where the liner stands and which way its hatch faces (yaw of its frame; the hatch looks down the frame's -z). */
export const PAD = { x: -44, z: -208, yaw: Math.PI };
const SC = LINER_SCALE;
/** heights and distances in the pad's frame (metres): the hatch's sill, the hull at the hatch, the gantry */
const SILL = (LINER.doorZ0 - LINER.groundZ) * SC;
const HULL_Z = -LINER.doorR * SC;
const ARM0 = -4.4, PLAT0 = -5.4, SLOPE = (28 * Math.PI) / 180, RUN = SILL / Math.tan(SLOPE), FOOT = PLAT0 - RUN;
const HALL_Z = -((LINER.vest.hallY0 + LINER.vest.hallY1) / 2) * SC;
const PASS_Z = -((LINER.vest.hallY0 + LINER.vest.passY1) / 2) * SC, PASS_X = (LINER.vest.passX - 0.1) * SC;
const DECK_W = 1.8;
/** walking speeds (m/s): on the apron, up the ramp, on the platform and inside; the gap kept to the one in front */
const V_GROUND = 1.3, V_RAMP = 1.3, V_FLAT = 1.1, GAP = 1.9;

export interface Boarder { id: string; fig: Character; pos: THREE.Vector3; yaw: number; phase: number }

type Seg = { a: THREE.Vector3; b: THREE.Vector3; s0: number; len: number; v: number; metal: boolean };
type Plan = { segs: Seg[]; len: number; s: Float32Array; stopS: number };
const DT = 1 / 60;
const smooth = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function buildBoarding(o: { add: <T extends THREE.Object3D>(x: T) => T; gateM: THREE.Material; glowM: THREE.Material; scene: THREE.Scene; hide?: THREE.Object3D[] }) {
  // ---- the liner: the films' ship, standing on its tail ----
  const ship: Ship = createShip({ landed: true });
  const liner = o.add(new THREE.Group()); liner.name = 'liner';
  liner.rotation.order = 'YXZ'; liner.position.set(PAD.x, 0, PAD.z); liner.rotation.y = PAD.yaw;
  const sg = ship.group; sg.rotation.x = -Math.PI / 2; sg.scale.setScalar(SC); sg.position.y = -LINER.groundZ * SC; liner.add(sg);
  ship.hatch.open(1);
  // its make-up as the films have it, then what never moves merged by material (40 draws down to about 12)
  const designList = designOf(sg);
  // the same panels as the films' hull, at the same size on the metal: three times as many over a ship three times as big
  const tiled = new Set<THREE.Texture>(); sg.traverse((x) => { const m = (x as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.map && !tiled.has(m.map)) { m.map = m.map.clone(); m.map.repeat.multiplyScalar(SC); m.map.needsUpdate = true; tiled.add(m.map); } });
  const vestMats = new Set<THREE.Material>(); sg.traverse((x) => { if (x.userData.vest) x.traverse((y) => { const m = y as THREE.Mesh; if (m.isMesh) vestMats.add(m.material as THREE.Material); }); });
  bakeStatic(sg, [ship.hatch.panel, ship.plume, ...(ship.legs ? [ship.legs.group] : [])]);

  // ---- the gantry: a ramp, a platform and the access arm to the hatch, on legs; the pad's frame ----
  const frame = new THREE.Object3D(); frame.position.copy(liner.position); frame.rotation.y = PAD.yaw; frame.updateMatrixWorld(true);
  const gantry = o.add(new THREE.Group()); gantry.name = 'gantry'; gantry.position.copy(frame.position); gantry.rotation.y = PAD.yaw;
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.7, roughness: 0.45 });
  const parts: THREE.BufferGeometry[] = [], darkParts: THREE.BufferGeometry[] = [], glowParts: THREE.BufferGeometry[] = [];
  const piece = (to: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => {
    const g = new THREE.BoxGeometry(w, h, d); g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1))); to.push(g);
  };
  const rampLen = Math.hypot(RUN, SILL), up = new THREE.Vector3(0, Math.cos(SLOPE), -Math.sin(SLOPE));
  { // the ramp's deck (its top face is the walking surface), its rails and glow strips
    const mid = new THREE.Vector3(0, SILL / 2, (FOOT + PLAT0) / 2).addScaledVector(up, -0.1);
    piece(parts, DECK_W, 0.2, rampLen, mid.x, mid.y, mid.z, -SLOPE);
    for (const sx of [-1, 1]) {
      const r = new THREE.Vector3(sx * (DECK_W / 2 - 0.04), SILL / 2, (FOOT + PLAT0) / 2).addScaledVector(up, 1.0);
      piece(darkParts, 0.06, 0.06, rampLen, r.x, r.y, r.z, -SLOPE);
      const gl = new THREE.Vector3(sx * (DECK_W / 2 - 0.02), SILL / 2, (FOOT + PLAT0) / 2).addScaledVector(up, 0.02);
      piece(glowParts, 0.05, 0.03, rampLen, gl.x, gl.y, gl.z, -SLOPE);
      for (let i = 0; i <= 6; i++) { const k = i / 6, p = new THREE.Vector3(sx * (DECK_W / 2 - 0.04), lerp(0, SILL, k), lerp(FOOT, PLAT0, k)); piece(darkParts, 0.05, 1.0, 0.05, p.x, p.y + 0.5, p.z); }
    }
    // the platform and its rails, the legs under it and under the ramp
    piece(parts, DECK_W + 0.4, 0.25, ARM0 - PLAT0, 0, SILL - 0.125, (ARM0 + PLAT0) / 2);
    for (const sx of [-1, 1]) { piece(darkParts, 0.06, 0.06, ARM0 - PLAT0, sx * (DECK_W / 2 + 0.16), SILL + 1.0, (ARM0 + PLAT0) / 2); piece(darkParts, 0.05, 1.0, 0.05, sx * (DECK_W / 2 + 0.16), SILL + 0.5, PLAT0); }
    for (const sx of [-1, 1]) for (const z of [PLAT0 + 0.2, ARM0 - 0.2]) piece(darkParts, 0.3, SILL - 0.25, 0.3, sx * (DECK_W / 2 + 0.05), (SILL - 0.25) / 2, z);
    for (const sx of [-1, 1]) { const z = (FOOT + PLAT0) / 2, h = SILL / 2 - 0.25; piece(darkParts, 0.25, h, 0.25, sx * (DECK_W / 2 - 0.1), h / 2, z); }
  }
  const merged = (list: THREE.BufferGeometry[], m: THREE.Material) => { const g = mergeBoxes(list); const mesh = new THREE.Mesh(g, m); mesh.castShadow = mesh.receiveShadow = true; gantry.add(mesh); return mesh; };
  merged(parts, o.gateM); merged(darkParts, dark); merged(glowParts, o.glowM).castShadow = false;
  // the access arm: from the platform to the hull, hinged at its east corner; it swings away before the lift-off
  const arm = new THREE.Group(); arm.userData.keep = true; arm.name = 'gantry-arm'; arm.position.set(DECK_W / 2 + 0.2, 0, ARM0); gantry.add(arm);
  {
    const a: THREE.BufferGeometry[] = [], ad: THREE.BufferGeometry[] = [], L = HULL_Z - ARM0 - 0.04;
    piece(a, DECK_W + 0.4, 0.25, L, -(DECK_W / 2 + 0.2), SILL - 0.125, L / 2);
    for (const sx of [-1, 1]) piece(ad, 0.06, 0.06, L, -(DECK_W / 2 + 0.2) + sx * (DECK_W / 2 + 0.16), SILL + 1.0, L / 2);
    const m1 = new THREE.Mesh(mergeBoxes(a), o.gateM), m2 = new THREE.Mesh(mergeBoxes(ad), dark);
    for (const m of [m1, m2]) { m.castShadow = m.receiveShadow = true; arm.add(m); }
  }

  // ---- the walk: one path for all six, in the pad's frame, then into the world ----
  const toW = (v: THREE.Vector3) => v.clone().applyMatrix4(frame.matrixWorld);
  const pathFor = (side: number) => {
    const pts: [THREE.Vector3, number, boolean][] = [
      [new THREE.Vector3(0, 0, FOOT - 16), V_GROUND, false], [new THREE.Vector3(0, 0, FOOT), V_RAMP, true], [new THREE.Vector3(0, SILL, PLAT0), V_FLAT, true],
      [new THREE.Vector3(0, SILL, HULL_Z), V_FLAT, true], [new THREE.Vector3(0, SILL, HALL_Z), V_FLAT, true], [new THREE.Vector3(side * PASS_X, SILL, PASS_Z), V_FLAT, true],
    ];
    const segs: Seg[] = []; let s0 = 0;
    for (let i = 0; i + 1 < pts.length; i++) { const a = toW(pts[i][0]), b = toW(pts[i + 1][0]), len = a.distanceTo(b); segs.push({ a, b, s0, len, v: pts[i][1], metal: pts[i][2] }); s0 += len; }
    return { segs, len: s0 };
  };
  const sFoot = 16, sTop = 16 + rampLen, sHull = sTop + (HULL_Z - PLAT0), sHall = sHull + (HALL_Z - HULL_Z);
  /** where he stops for his last look: the middle of the platform */
  const sStop = sTop + (ARM0 - PLAT0) * 0.5, STOP_Z = (ARM0 + PLAT0) / 2;
  const at = (p: { segs: Seg[] }, s: number, out: THREE.Vector3) => {
    const sg2 = p.segs.find((g) => s <= g.s0 + g.len) ?? p.segs[p.segs.length - 1];
    return out.lerpVectors(sg2.a, sg2.b, Math.min(1, Math.max(0, (s - sg2.s0) / sg2.len)));
  };
  const segAt = (p: { segs: Seg[] }, s: number) => p.segs.find((g) => s < g.s0 + g.len) ?? p.segs[p.segs.length - 1];

  // ---- the timeline: who is where when (worked out once, at the start) ----
  const N = 6, TMAX = 60, STEPS = Math.ceil(TMAX / DT);
  let plans: (Plan & { segs: Seg[] })[] = [];
  const ev = { stop: 0, go: 0, hall: 0, shut: 0, arm: 0, jets: 0, lift: 0, end: 0 };
  /** the last look: he turns round (towards the camera's side), looks at the city, turns back */
  const LOOK = { turn: 0.85, hold: 2.4 };
  function plan() {
    plans = [];
    for (let k = 0; k < N; k++) {
      // everyone turns along the hall towards the cameras' side: the hull's own wall then hides them from every shot
      const p = pathFor(1);
      const s = new Float32Array(STEPS + 1);
      // the last one (him) starts a step from the foot of the ramp; the others ahead of him, a gap apart
      let x = sFoot - 1.2 + (N - 1 - k) * GAP, v = segAt(p, x).v;
      const me = k === N - 1; let stopT = -1;
      for (let i = 0; i <= STEPS; i++) {
        s[i] = x;
        const t = i * DT;
        // easing to a stop (about 1.2 m/s/s) at the end of the path, and for him at his place on the platform
        let want = Math.min(segAt(p, x).v, Math.sqrt(2 * 1.2 * Math.max(0, p.len - x)));
        if (me) {
          if (stopT < 0) want = Math.min(want, Math.sqrt(2 * 1.2 * Math.max(0, sStop - x)) + 0.02);
          if (stopT < 0 && x >= sStop - 0.01) { stopT = t; ev.stop = t; ev.go = t + LOOK.turn * 2 + LOOK.hold; }
          if (stopT >= 0 && t < ev.go) want = 0;
        }
        // never closer than the gap to the one in front
        // (once the one in front has turned into the hall they are out of the way: each goes to their own end of it)
        if (k > 0 && plans[k - 1].s[i] < sHall + 0.6) { const ahead = plans[k - 1].s[i] - x; if (ahead < GAP) want = 0; else if (ahead < GAP + 0.6) want = Math.min(want, segAt(p, x).v * (ahead - GAP) / 0.6); }
        // anticipation and settle: a step speeds up and slows down over about a third of a second
        v += (want - v) * Math.min(1, DT * 6);
        x = Math.min(me && stopT < 0 ? sStop : p.len, x + v * DT);
      }
      plans.push({ ...p, s, stopS: me ? sStop : -1 });
    }
    const me = plans[N - 1];
    ev.hall = me.s.findIndex((x) => x >= sHall) * DT;
    ev.shut = ev.hall + 0.3; ev.arm = ev.shut + 1.3; ev.jets = ev.arm + 1.2; ev.lift = ev.jets + 1.5; ev.end = ev.lift + 8.8;
  }
  const sOf = (k: number, T: number) => { const p = plans[k].s, i = Math.min(p.length - 2, Math.max(0, T / DT)), j = Math.floor(i); return lerp(p[j], p[j + 1], i - j); };

  // ---- the liner's flight: straight up its empty column, well over the tallest tower, then nosing over and away ----
  /** pose of the liner (and how far its legs are down) at T */
  function linerPose(T: number, g: THREE.Object3D) {
    const t = Math.max(0, T - ev.lift);
    // the first seconds slow (it is heavy), then faster and faster: about 320 m in 6.5 s, then on and away
    const up = t < 6.5 ? 320 * Math.pow(t / 6.5, 2.2) : 320 + (t - 6.5) * 110;
    const over = smooth(4.5, 9, t);
    g.position.set(PAD.x, up, PAD.z - over * over * 60 * Math.max(0, t - 4.5));
    // (nose over towards the way it goes: south, away from the city)
    g.rotation.set(over * 0.7, PAD.yaw, 0, 'YXZ');
    return { legs: 1 - smooth(1.5, 3.2, t) };
  }

  // ---- the camera, shot by shot (in the pad's frame) ----
  type Shot = { t0: number; t1: number; fov: number; cam: (T: number, k: number, eye: THREE.Vector3, aim: THREE.Vector3) => void };
  const F = (x: number, y: number, z: number, out: THREE.Vector3) => out.set(x, y, z).applyMatrix4(frame.matrixWorld);
  const headOf = (k: number, T: number, out: THREE.Vector3) => { at(plans[k], sOf(k, T), out); out.y += 1.55; return out; };
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  let shots: Shot[] = [];
  function cut() {
    const s = ev.stop;
    shots = [
      { t0: 0, t1: 4.2, fov: 50, cam: (_T, k, e, a) => { F(lerp(30, 25, k), lerp(1.7, 2.3, k), lerp(-34, -29, k), e); F(0, 13, -6, a); } },
      { t0: 4.2, t1: 8.4, fov: 42, cam: (_T, k, e, a) => { F(8.2, 2.6, lerp(-13.5, -12, k), e); F(0, lerp(3.6, 4.6, k), lerp(-10, -8, k), a); } },
      // behind him and to the side as he climbs: his back, the ramp, the one in front, the lit hatch ahead
      { t0: 8.4, t1: s, fov: 48, cam: (T, _k, e, a) => { headOf(N - 1, T, tmpA); F(1.7, 0, -3.4, tmpB); e.copy(tmpA).add(tmpB.sub(frame.position)); e.y -= 0.15; F(0, SILL + 1.3, HULL_Z, a); a.lerp(tmpA, 0.35); } },
      { t0: s, t1: s + 2.2, fov: 34, cam: (_T, k, e, a) => { F(1.2, SILL + 1.55, PLAT0 - 3.1 + k * 0.3, e); at(plans[N - 1], sStop, a); a.y += 1.5; } },
      { t0: s + 2.2, t1: s + 3.9, fov: 44, cam: (_T, k, e, a) => { F(0.5, SILL + 1.68, STOP_Z + 0.6, e); F(lerp(-8, 8, k), 30, -420, a); } },
      { t0: s + 3.9, t1: ev.arm, fov: 40, cam: (_T, k, e, a) => { F(5.6, SILL + 0.9, PLAT0 - 5.2, e); F(0, SILL + 1.2 + k * 0.4, HULL_Z - 0.6, a); } },
      { t0: ev.arm, t1: ev.lift, fov: 48, cam: (_T, k, e, a) => { F(lerp(36, 33, k), 1.9, -40, e); F(0, 14, -4, a); } },
      // (from the far side, looking west: towards the east the towers and the sky's floating things stood behind it)
      { t0: ev.lift, t1: ev.lift + 5.2, fov: 52, cam: (T, _k, e, a) => { F(-42, 1.6, -46, e); a.copy(tmpLiner(T)); a.y += 16; } },
      { t0: ev.lift + 5.2, t1: ev.end + 1, fov: 55, cam: (T, k, e, a) => { const L = tmpLiner(T); e.set(L.x + 45 - k * 10, L.y - 60 + k * 10, L.z + 95 - k * 15); a.set(L.x, L.y + 8, L.z - 10); } },
    ];
  }
  const ghost = new THREE.Object3D();
  const tmpLiner = (T: number) => { linerPose(T, ghost); return ghost.position; };
  const shotAt = (T: number) => shots.find((x) => T < x.t1) ?? shots[shots.length - 1];
  function camAt(T: number, eye: THREE.Vector3, aim: THREE.Vector3) { const sh = shotAt(T); sh.cam(T, smooth(sh.t0, sh.t1, T), eye, aim); return sh; }

  // ---- who is hidden: someone who has gone in is let go only where the hull hides them from the camera ----
  const hullMeshes: THREE.Object3D[] = [];
  sg.traverse((x) => { const m = x as THREE.Mesh; let shown = true; for (let p: THREE.Object3D | null = x; p && p !== sg; p = p.parent) if (!p.visible) shown = false; if (m.isMesh && m !== ship.plume && shown && !vestMats.has(m.material as THREE.Material)) hullMeshes.push(m); });
  const vestMeshes = new Set<THREE.Object3D>();
  const rc = new THREE.Raycaster();
  /** Is a body at `p` (its feet) hidden from `eye` by the hull (feet, chest and head all behind it)? Measured on the hull's
   *  own shape (LINER.radius and the vestibule), not by rays on its meshes: points along each sight line, in the ship's
   *  frame, inside the solid hull. */
  const invS = new THREE.Matrix4(), sp = new THREE.Vector3();
  function hiddenFrom(eye: THREE.Vector3, p: THREE.Vector3) {
    liner.updateMatrixWorld(true); invS.copy(sg.matrixWorld).invert();
    for (const h of [0.15, 1.0, 1.6]) {
      tmpB.set(p.x, p.y + h, p.z); const d = tmpB.distanceTo(eye);
      let blocked = false;
      for (let u = 0; u < d - 0.2 && !blocked; u += 0.06) { sp.copy(eye).lerp(tmpB, u / d).applyMatrix4(invS); if (insideHull(sp)) blocked = true; }
      if (!blocked) return false;
    }
    return true;
  }
  /** Test: why a body counts as seen (the shot, the eye and the body in the pad's frame, what each ray hit). */
  function whyVisible(eye2: THREE.Vector3, p: THREE.Vector3, shot: number) {
    const inv = frame.matrixWorld.clone().invert(), f = (v: THREE.Vector3) => { const l = v.clone().applyMatrix4(inv); return `${l.x.toFixed(2)},${l.y.toFixed(2)},${l.z.toFixed(2)}`; };
    const rays = [0.15, 1.0, 1.6].map((h) => { tmpB.set(p.x, p.y + h, p.z); const d = tmpB.distanceTo(eye2); rc.set(eye2, tmpB.clone().sub(eye2).normalize()); rc.far = d - 0.05; const hs = rc.intersectObjects(hullMeshes, false); return `${h}:${hs.length ? hs[0].distance.toFixed(1) + ' ' + ((hs[0].object as THREE.Mesh).material as THREE.MeshStandardMaterial).color?.getHexString() : 'none'}`; });
    return `shot ${shot} eye ${f(eye2)} body ${f(p)} hull meshes ${hullMeshes.length} mesh rays ${rays.join(' ')}`;
  }

  // ---- running it ----
  let T = -1, done: (() => void) | null = null, who: Boarder[] = [], gone: boolean[] = [], keepFov = 0;
  const lastS: number[] = [], stepAcc: number[] = [];
  const eye = new THREE.Vector3(), aim = new THREE.Vector3(), cueDone = new Set<string>();
  const cue = (name: string, at2: number, fn: () => void) => { if (T >= at2 && !cueDone.has(name)) { cueDone.add(name); fn(); } };
  const ground = (x: number, z: number) => { tmpA.set(x, 0, z).applyMatrix4(frameInv); if (Math.abs(tmpA.x) < DECK_W / 2 + 0.3 && tmpA.z > FOOT && tmpA.z < PLAT0) return SILL * (tmpA.z - FOOT) / RUN; if (Math.abs(tmpA.x) < (tmpA.z > HULL_Z ? PASS_X + 0.3 : DECK_W / 2 + 0.3) && tmpA.z >= PLAT0 && tmpA.z < 0) return SILL; return 0; };
  const frameInv = frame.matrixWorld.clone().invert();

  function start(people: Boarder[], fin: () => void) {
    plan(); cut();
    T = 0; done = fin; who = people.slice(0, N); gone = who.map(() => false); cueDone.clear();
    // the sister ship over the spaceport sits out the scene (from below it shared the climb's frames: two of one ship)
    for (const h of o.hide ?? []) h.visible = false;
    who.forEach((q, k) => { q.fig.setGround(ground); q.fig.setLookTarget(null); q.fig.root.visible = true; lastS[k] = sOf(k, 0); stepAcc[k] = (k * 0.37) % 0.7; place(k, 0, 0); });
    ship.hatch.open(1); ship.legs?.deploy(1); arm.rotation.y = 0; linerPose(0, liner);
    (ship.plume.material as THREE.ShaderMaterial).uniforms.uPower.value = 0;
    // the take-off's sounds, ready before they are wanted (a first play only starts the load)
    audio.preloadSfx('launch', 'rumble', 'thruster', 'hatch_close', 'metal');
  }
  /** Put the k-th one where the timeline says, walking or standing, looking where they should. */
  function place(k: number, t: number, dt: number) {
    const q = who[k], p = plans[k], s = sOf(k, t), s2 = sOf(k, t + 0.1);
    at(p, s, q.pos); q.pos.y = Math.max(q.pos.y, ground(q.pos.x, q.pos.z));
    const v = (s2 - s) / 0.1, sgm = segAt(p, Math.min(s + 0.05, p.len - 0.01));
    let yaw = Math.atan2(sgm.b.x - sgm.a.x, sgm.b.z - sgm.a.z);
    if (k === N - 1 && t >= ev.stop && t < ev.go + 0.4) {
      // the last look: round towards the camera's side, held on the city, and back
      const u = t - ev.stop, back = yaw + Math.PI * 0.92;
      const w = u < LOOK.turn ? smooth(0, LOOK.turn, u) : u < LOOK.turn + LOOK.hold ? 1 : 1 - smooth(LOOK.turn + LOOK.hold, LOOK.turn * 2 + LOOK.hold, u);
      yaw = lerp(yaw, back, w);
      q.fig.setLookTarget(w > 0.6 ? F(0, 30, -400, tmpA).clone() : null);
    }
    // turn towards the way they walk, not in a snap at a corner
    const d = Math.atan2(Math.sin(yaw - q.yaw), Math.cos(yaw - q.yaw));
    q.yaw = dt > 0 && Math.abs(d) < 2.5 ? q.yaw + d * Math.min(1, dt * 7) : yaw;
    q.fig.root.rotation.y = q.yaw;
    q.phase += Math.max(0, s - lastS[k]) * 1.75; lastS[k] = s;
    return v;
  }
  function update(dt: number, time: number, cam?: THREE.PerspectiveCamera) {
    if (T < 0) return;
    T += dt;
    const sh = camAt(T, eye, aim);
    if (cam) {
      if (!keepFov) keepFov = cam.fov;
      if (cam.fov !== sh.fov) { cam.fov = sh.fov; cam.updateProjectionMatrix(); }
      cam.position.copy(eye); cam.lookAt(aim);
    }
    for (let k = 0; k < who.length; k++) {
      const q = who[k];
      if (gone[k]) continue;
      const s0 = lastS[k], v = place(k, T, dt), s = lastS[k];
      q.fig.animate(v > 0.12 ? 'walk' : 'idle', q.phase, Math.min(1, v / 3), time, dt);
      // steps on the gantry's metal, where they are
      const seg = segAt(plans[k], s);
      if ((stepAcc[k] += s - s0) >= 0.68) { stepAcc[k] -= 0.68; audio.step(seg.metal ? 'metal' : 'stone', seg.metal ? 0.42 : 0.25, { x: q.pos.x, y: q.pos.y, z: q.pos.z }); }
      // in, along the hall: let go once the hull hides them from the camera
      if (s > sHall + 0.3 && hiddenFrom(eye, q.pos)) { gone[k] = true; q.fig.root.visible = false; }
    }
    // the hatch, the arm, the jets, the lift
    ship.hatch.open(1 - smooth(ev.shut, ev.shut + 1.2, T));
    arm.rotation.y = smooth(ev.arm, ev.arm + 1.6, T) * 1.75;
    const lp = linerPose(T, liner); ship.legs?.deploy(lp.legs);
    const jets = smooth(ev.jets, ev.lift + 0.6, T) * (1 + Math.sin(time * 40) * 0.06);
    (ship.plume.material as THREE.ShaderMaterial).uniforms.uPower.value = jets * 1.6;
    (ship.plume.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    ship.engineGlow.color.setRGB(0.6 + jets * 3, 1.4 + jets * 4, 4 + jets * 8);
    const door = F(0, SILL + 1.4, HULL_Z, tmpA).clone();
    cue('shut', ev.shut, () => audio.sample('hatch_close', 0.8, { at: door, near: 4, far: 90 }));
    cue('arm', ev.arm, () => audio.sample('metal', 0.5, { at: door, near: 4, far: 90 }));
    cue('jets', ev.jets, () => audio.sample('thruster', 0.7, { at: liner.position, near: 30, far: 600 }));
    // the roar starts half a second into its file: it begins as the liner leaves the pad
    cue('lift', ev.lift - 0.45, () => audio.sample('launch', 0.95, { dur: 7.5, tag: 'takeoff' }));
    cue('climb', ev.lift + 4.5, () => audio.sample('rumble', 0.5, { dur: 9, tag: 'takeoff' }));
    if (T >= ev.end) finish();
  }
  function finish() {
    if (T < 0) return;
    for (const h of o.hide ?? []) h.visible = true;
    T = -1;
    const d = done; done = null; d?.();
  }
  function skip() { audio.stopTag('takeoff', 0.3); finish(); }
  function restoreFov(cam: THREE.PerspectiveCamera) { if (keepFov) { cam.fov = keepFov; cam.updateProjectionMatrix(); keepFov = 0; } }

  // ---- tests (headless) ----
  /** The design: what the liner is made of, mesh by mesh (the same function on the deck's ship gives the same list). */
  const design = () => designList;
  /**
   * Plays the scene on its own clock without drawing it and checks every 1/30 s: nobody inside the hull or the gantry
   * (feet on the walking surface, never below it), nobody inside anybody else, nobody moving faster than a person can
   * (no jumps), nobody let go where the camera can see them. Returns the problems found (empty: none).
   */
  function check() {
    plan(); cut();
    const bad: string[] = [], pos: THREE.Vector3[][] = [], sh: Shot[] = []; let dbg = '';
    const inv = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Vector3(), prev: (THREE.Vector3 | null)[] = Array(N).fill(null), out = Array(N).fill(false);
    const shipM = () => { liner.updateMatrixWorld(true); return inv.copy(sg.matrixWorld).invert(); };
    for (let T2 = 0; T2 <= ev.end; T2 += 1 / 30) {
      linerPose(T2, liner); shipM(); camAt(T2, eye, aim); const shot = shotAt(T2); sh.push(shot);
      const here: THREE.Vector3[] = [];
      for (let k = 0; k < N; k++) {
        at(plans[k], sOf(k, T2), p); here.push(p.clone());
        const s = sOf(k, T2);
        if (out[k]) continue;
        if (s > sHall + 0.3 && hiddenFrom(eye, p)) { out[k] = true; continue; }
        if (s > sHall + 0.3 && s >= plans[k].len - 0.05) { bad.push(`T ${T2.toFixed(2)}: ${k} stands at the end of the passage still in view`); if (!dbg) dbg = whyVisible(eye, p, shots.indexOf(shot)); }
        // the body: feet, knees, hips, chest, head, and the shoulders half a metre apart
        for (const [dx, dy] of [[0, 0.08], [0, 0.5], [0, 0.95], [0, 1.35], [0, 1.65], [-0.22, 1.35], [0.22, 1.35]]) {
          const yaw = Math.atan2(plans[k].segs[0].b.x - plans[k].segs[0].a.x, plans[k].segs[0].b.z - plans[k].segs[0].a.z);
          q.set(p.x + Math.cos(yaw) * dx, p.y + dy, p.z - Math.sin(yaw) * dx).applyMatrix4(inv);
          if (insideHull(q)) { bad.push(`T ${T2.toFixed(2)}: ${who[k]?.id ?? k} inside the hull at ${dy} m`); break; }
        }
        const gH = ground(p.x, p.z);
        if (Math.abs(p.y - gH) > 0.05) bad.push(`T ${T2.toFixed(2)}: ${k} feet ${(p.y - gH).toFixed(2)} m off the walking surface`);
        if (prev[k] && prev[k]!.distanceTo(p) > 2.6 / 30) bad.push(`T ${T2.toFixed(2)}: ${k} jumped ${prev[k]!.distanceTo(p).toFixed(2)} m in a frame`);
        prev[k] = p.clone();
      }
      for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) if (!out[a] && !out[b] && Math.hypot(here[a].x - here[b].x, here[a].z - here[b].z) < 0.6 && Math.abs(here[a].y - here[b].y) < 1.6) bad.push(`T ${T2.toFixed(2)}: ${a} and ${b} overlap`);
      pos.push(here);
    }
    linerPose(0, liner);
    const uniq = [...new Set(bad.map((b) => b.replace(/^T [\d.]+: /, '')))];
    return { problems: bad.length, first: bad.slice(0, 12), kinds: uniq.slice(0, 12), events: { ...ev }, shots: shots.map((x) => [+x.t0.toFixed(2), +x.t1.toFixed(2)]), seconds: +ev.end.toFixed(1), allIn: out.every(Boolean), dbg };
  }

  // ---- tests: the take-off's swept path and the camera against everything solid in the city ----
  /** Light, not matter: beams, glows and haze (see-through, drawn without depth) are never in the way. */
  const ghostMat = (m: THREE.Mesh) => { const mt = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material | undefined; return !mt || mt.visible === false || (mt.transparent && (!mt.depthWrite || mt.blending === THREE.AdditiveBlending)); };
  function solids() {
    const out: { o: THREE.Object3D; b: THREE.Box3 }[] = [];
    o.scene.updateMatrixWorld(true);
    o.scene.traverse((x) => {
      const m = x as THREE.Mesh;
      if (!(m.isMesh || (x as THREE.Line).isLine) || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
      for (let p: THREE.Object3D | null = x; p; p = p.parent) { if (!p.visible || p === liner || p === gantry || p.userData.isCharacter) return; }
      if (ghostMat(m)) return;
      const b = new THREE.Box3().setFromObject(x);
      if (b.isEmpty() || (b.max.x - b.min.x > 1800 && !(m as THREE.InstancedMesh).isInstancedMesh)) return; // the sky, the far ring
      out.push({ o: x, b });
    });
    return out;
  }
  /** points over the liner, in its own units: round the hull, the ring, the wings, the legs' feet, the bells */
  const SAMPLES: THREE.Vector3[] = [];
  for (let z = -6.4; z <= 5.9; z += 0.55) { const r = Math.max(LINER.radius(z), z < -5.5 ? LINER.bellAt + LINER.bellR : 0); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; SAMPLES.push(new THREE.Vector3(Math.sin(a) * r, Math.cos(a) * r, z)); } }
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, R = LINER.ringR + LINER.ringTube; SAMPLES.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, LINER.ringZ)); }
  for (const sx of [-1, 1]) for (const x of [LINER.wingX0, (LINER.wingX0 + LINER.wingX1) / 2, LINER.wingX1]) for (const dz of [-LINER.wingHalfZ, LINER.wingHalfZ]) SAMPLES.push(new THREE.Vector3(sx * x, 0, LINER.wingZ + dz));
  for (const a of [1, 3, 5, 7]) SAMPLES.push(new THREE.Vector3(Math.sin((a * Math.PI) / 4) * 2, Math.cos((a * Math.PI) / 4) * 2, LINER.groundZ));
  /**
   * Flies the take-off and, under and over a grid of points round the liner's hull, ring, wings, legs and bells, finds
   * how far it stays from anything solid in the city: anything at all above a point while it climbs is a hit (it would
   * fly into it); `worst` is the least gap to what is below once it is off the pad, negative if it passes through.
   * Then the camera: in every shot nothing may stand between it and what it looks at.
   */
  function clearance() {
    plan(); cut();
    const list = solids(), rc2 = new THREE.Raycaster(), w = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
    let worst = 999, atT = 0, what = '';
    const name = (x: THREE.Object3D, b: THREE.Box3) => { const c: string[] = []; for (let q: THREE.Object3D | null = x; q && c.length < 4; q = q.parent) c.push(q.name || q.type); return `${c.join(' < ')} x ${b.min.x.toFixed(0)}..${b.max.x.toFixed(0)} y ${b.min.y.toFixed(0)}..${b.max.y.toFixed(0)} z ${b.min.z.toFixed(0)}..${b.max.z.toFixed(0)}`; };
    for (let T2 = ev.lift; T2 <= ev.end; T2 += 0.2) {
      linerPose(T2, liner); liner.updateMatrixWorld(true);
      for (const p of SAMPLES) {
        w.copy(p).applyMatrix4(sg.matrixWorld);
        const col = list.filter((e) => w.x >= e.b.min.x && w.x <= e.b.max.x && w.z >= e.b.min.z && w.z <= e.b.max.z);
        if (!col.length) continue;
        rc2.set(new THREE.Vector3(w.x, 4000, w.z), down); rc2.far = 8000;
        const hits = rc2.intersectObjects(col.map((e) => e.o), false);
        const above = hits.find((h) => h.point.y > w.y + 0.02);
        if (above) { const m = w.y - above.point.y; if (m < worst) { worst = m; atT = T2; what = 'above: ' + name(above.object, new THREE.Box3().setFromObject(above.object)); } continue; }
        const below = hits.find((h) => h.point.y <= w.y + 0.02);
        if (below && T2 >= ev.lift + 1.5) { const m = w.y - below.point.y; if (m < worst) { worst = m; atT = T2; what = 'below: ' + name(below.object, new THREE.Box3().setFromObject(below.object)); } }
      }
    }
    // the camera: a clear line to what it looks at (stopping a few metres short), in every shot but his view of the city
    let camera = 'clear';
    const e = new THREE.Vector3(), a = new THREE.Vector3(), targets = list.map((x) => x.o);
    for (let T2 = 0; T2 <= ev.end && camera === 'clear'; T2 += 0.25) {
      linerPose(T2, liner); liner.updateMatrixWorld(true);
      const sh = camAt(T2, e, a); if (sh === shots[4]) continue;
      const d = e.distanceTo(a); rc2.set(e, a.clone().sub(e).normalize()); rc2.far = Math.max(0.1, d - 3);
      const hit = rc2.intersectObjects(targets, false)[0];
      if (hit) camera = `T ${T2.toFixed(2)} (shot ${shots.indexOf(sh)}): view blocked ${hit.distance.toFixed(1)} m out by ${name(hit.object, new THREE.Box3().setFromObject(hit.object))}`;
      sg.updateMatrixWorld(true); const inv = sg.matrixWorld.clone().invert();
      if (insideHull(e.clone().applyMatrix4(inv))) camera = `T ${T2.toFixed(2)}: the camera is inside the hull`;
    }
    // and what shares the frame with it in the open-sky shots: a solid thing whose screen box overlaps the liner's and
    // that is about as far away reads as the liner flying through it even when they never touch
    const frameHits = new Map<THREE.Object3D, string>(), cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 8000), lb = new THREE.Box3(), ob = new THREE.Box3();
    const sbox = (b: THREE.Box3) => { const r = new THREE.Box2(); let front = false; for (let i = 0; i < 8; i++) { const v = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(cam); if (v.z < 1) front = true; r.expandByPoint(new THREE.Vector2(v.x, v.y)); } return front ? r : null; };
    const view = new THREE.Box2(new THREE.Vector2(-1, -1), new THREE.Vector2(1, 1));
    for (let T2 = ev.lift + 1.5; T2 <= ev.end; T2 += 0.25) {
      linerPose(T2, liner); liner.updateMatrixWorld(true);
      const sh = camAt(T2, e, a); cam.fov = sh.fov; cam.updateProjectionMatrix(); cam.position.copy(e); cam.lookAt(a); cam.updateMatrixWorld(true);
      lb.setFromObject(sg); const ls = sbox(lb); if (!ls || !ls.intersectsBox(view)) continue;
      const dl = e.distanceTo(lb.getCenter(new THREE.Vector3()));
      for (const x of list) {
        if (frameHits.has(x.o) || (x.o as THREE.InstancedMesh).isInstancedMesh) continue;
        ob.copy(x.b); const c = ob.getCenter(new THREE.Vector3()), r = ob.getSize(new THREE.Vector3()).length() / 2;
        if (r < 3 || r > 400 || ob.min.y < 20) continue; // floating things only: what stands on the ground is the city behind it
        const d = e.distanceTo(c); if (d > dl * 2.5 || d < dl * 0.4) continue;
        const os = sbox(ob); if (!os || !os.intersectsBox(ls)) continue;
        frameHits.set(x.o, `T+${(T2 - ev.lift).toFixed(1)} shot ${shots.indexOf(sh)}: ${name(x.o, ob)}`);
      }
    }
    linerPose(0, liner); liner.updateMatrixWorld(true);
    return { worst: Math.round(worst * 10) / 10, at: Math.round((atT - ev.lift) * 10) / 10, what, camera, frame: [...frameHits.values()].slice(0, 12) };
  }
  /** The tallest solid thing every G metres over a square round (x, z) (for choosing a pad). */
  function heightMap(x0: number, z0: number, span = 120, G = 4) {
    const list = solids(), rc2 = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), n = Math.round((2 * span) / G) + 1, out: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = x0 - span + i * G, z = z0 - span + j * G;
      const col = list.filter((e) => x >= e.b.min.x && x <= e.b.max.x && z >= e.b.min.z && z <= e.b.max.z);
      rc2.set(new THREE.Vector3(x, 4000, z), down); rc2.far = 8000;
      const h = col.length ? rc2.intersectObjects(col.map((e) => e.o), false)[0] : undefined; out.push(h ? Math.round(h.point.y) : -99);
    }
    return { x0: x0 - span, z0: z0 - span, G, n, h: out.join(',') };
  }

  return {
    clearance, heightMap,
    /** Something that sits out the scene (hidden while it plays). */
    hideDuring(x: THREE.Object3D) { (o.hide ??= []).push(x); },
    liner, gantry, ship, frame, start, update, skip, restoreFov, design, check, linerPose, camAt,
    get active() { return T >= 0; },
    get remaining() { return T >= 0 ? ev.end - T : 0; },
    get t() { return T; },
    get events() { return { ...ev }; },
    /** the take-off's moving parts, for the clearance test: the liner's own meshes are not obstacles */
    owns(x: THREE.Object3D) { for (let p: THREE.Object3D | null = x; p; p = p.parent) if (p === liner || p === gantry) return true; return false; },
    ready() { plan(); cut(); },
  };
}

/** Inside the liner's solid hull (ship units)? The vestibule behind the hatch is open space. */
export function insideHull(p: THREE.Vector3) {
  const r = Math.hypot(p.x, p.y), R = LINER.radius(p.z);
  if (r >= R - 0.005) return false;
  const V = LINER.vest;
  if (p.z > LINER.doorZ0 - 0.01 && p.z < LINER.doorZ1) {
    const hw = LINER.doorR * Math.sin(LINER.doorHalf);
    if (Math.abs(p.x) < hw && p.y > V.hallY1 - 0.01) return false;
    if (Math.abs(p.x) < V.hallX && p.y > V.hallY0 && p.y < V.hallY1 + 0.01) return false;
    if (Math.abs(p.x) < V.passX && p.y > V.hallY0 && p.y < V.passY1) return false;
  }
  return true;
}

/** A ship's make-up: every mesh's kind of geometry, its vertex count and its material's colour, in order. */
export function designOf(g: THREE.Object3D) {
  const out: string[] = [];
  // (the landing legs are only on the ground: not part of the comparison)
  g.traverse((x) => { const m = x as THREE.Mesh; if (!m.isMesh) return; for (let p: THREE.Object3D | null = x; p && p !== g; p = p.parent) if (p.userData.landing) return; const mat = m.material as THREE.MeshStandardMaterial; // (lit materials by colour; glows and lamps change colour as they run, so only their kind)
    out.push(`${m.geometry.type}:${m.geometry.getAttribute('position').count}:${(mat as unknown as THREE.MeshBasicMaterial).isMeshBasicMaterial ? 'glow' : mat.color?.getHexString?.() ?? '-'}`); });
  return out;
}

function mergeBoxes(list: THREE.BufferGeometry[]) {
  // boxes only (same attributes): concatenated by hand, no index
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (const g of list) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...(ng.getAttribute('position').array as Float32Array)); nor.push(...(ng.getAttribute('normal').array as Float32Array)); uv.push(...(ng.getAttribute('uv').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
