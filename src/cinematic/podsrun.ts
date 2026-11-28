import { PASSAGE } from './passage';

/**
 * The run to the pods as plain numbers: who goes where and when, for the answers given. No scene, no bodies: the film
 * (cinematic.ts `run`) poses the six on these routes, and tools/pods_routes.ts reads the same routes to measure how
 * near anyone comes to anyone else before a frame is drawn.
 *
 * Staging rule in the passage: three pairs, one behind the other, never abreast of another pair. In each pair one goes
 * hand over hand along the far wall's rail (left hand on the rail) and tows the other, who rides beside and behind
 * them towards the middle, by the hand on the camera's side. Whoever is alone takes the rail. The near wall's side of
 * the passage stays empty: the cameras are there, so nobody passes under a lens or stands in front of someone else.
 */
export type RunId = 'scientist' | 'explorer' | 'medic' | 'social' | 'strong' | 'builder';
export type Key = [number, number, number, number]; // t, then where the chest is (deck units)
export type P3 = [number, number, number];
export interface RunAnswers { hand: boolean; core: boolean; hurtN: boolean; hurtD: boolean; bothHands: boolean }
export interface Role {
  /** In the passage: on the rail, or towed beside it. */
  lane: 'rail' | 'tow';
  /** Who they are joined to by the hand (the one who tows has the rail), and from when. */
  partner?: RunId; leads?: boolean; join?: number;
  /** When they pass the hatch, and how far aft they get. */
  door: number; end: number;
}
export const RUN_TEAR = 20.2, RUN_END = 24.6;
/** With the core chosen: when Zenvik is back at the console with his hands on it; he has it out 1.2 s later. */
export const CORE_AT = 5.8;

const PA = PASSAGE;
/** The chest's place in a lane at x along the passage. */
export const lane = (x: number, kind: 'rail' | 'tow'): P3 => kind === 'rail' ? [x, PA.railY - 0.1, PA.doorZ + PA.laneRail] : [x, PA.railY + 0.1, PA.doorZ + PA.laneTow];
/** Where whoever is towed rides from the one who tows them, in the passage: behind, a little higher, towards the middle. */
export const TOW_OFF: P3 = [-0.55, 0.2, PA.laneTow - PA.laneRail];
/** The rail the leaders pull themselves along (the far wall's). */
export const RAIL_Z = PA.doorZ - (PA.half - PA.railOff);

/** A route at time t: a smooth curve through its keys (no stop at a key unless its neighbours hold it there). */
export function routeAt<T extends { x: number; y: number; z: number }>(keys: Key[], t: number, out: T): T {
  const n = keys.length;
  const set = (k: Key) => { out.x = k[1]; out.y = k[2]; out.z = k[3]; return out; };
  if (t <= keys[0][0]) return set(keys[0]);
  if (t >= keys[n - 1][0]) return set(keys[n - 1]);
  let i = 0; while (i < n - 2 && t >= keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1], h = b[0] - a[0], u = (t - a[0]) / h, u2 = u * u, u3 = u2 * u;
  const slope = (j: number, c: number) => { if (j <= 0 || j >= n - 1) return 0; const p = keys[j - 1], q = keys[j + 1]; return (q[c] - p[c]) / (q[0] - p[0]); };
  const v = [0, 0, 0];
  for (let c = 1; c <= 3; c++) {
    const m0 = slope(i, c) * h, m1 = slope(i + 1, c) * h;
    v[c - 1] = (2 * u3 - 3 * u2 + 1) * a[c] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * b[c] + (u3 - u2) * m1;
  }
  out.x = v[0]; out.y = v[1]; out.z = v[2];
  return out;
}

/** The choice (hand, core or nothing) is open from 2.75 s and the film waits for it inside G6c, which ends at 4.6 s: up
 *  to there nobody's route may depend on its answer, or the six jump when it is given. */
export const RUN_SHARED = 4.7;
/** The routes and the pairs for the answers given so far. Every branch has the same keys up to RUN_SHARED (two keys
 *  close together end the shared part, so the curve before them does not lean on what comes after). */
export function buildRun(start: Record<RunId, P3>, a: RunAnswers): { R: Record<RunId, Key[]>; roles: Record<RunId, Role> } {
  const z0 = start.scientist, s0 = start.explorer, l0 = start.medic, n0 = start.social, d0 = start.strong, b0 = start.builder;
  const silence = !a.hand && !a.core;
  const D0: P3 = [5.2, -1.15, PA.doorZ], D1: P3 = [PA.doorX + 0.1, -1.15, PA.doorZ];
  const add = (p: P3, dx: number, dy = 0, dz = 0): P3 => [p[0] + dx, p[1] + dy, p[2] + dz];
  /** Through the hatch at `door`, then along the lane to `end`: quick off the frame, hand over hand, stopped by the break. */
  const pass = (door: number, kind: 'rail' | 'tow', end: number): Key[] => {
    // (the first metres off the frame in proportion to how far they will get: all of them to 1.5 m in, the pair behind
    // caught up with the towed one of the pair ahead at the hatch, 1.1 m apart)
    // (quickest in the first metres, slower as they close on whoever is ahead and the hull starts to groan)
    const arr = Math.max(door + 3.2, 19.6), x0 = Math.min(end - 0.4, PA.doorX + 0.5 + Math.min(1.8, 0.35 * (end - PA.doorX))), e = Math.max(x0 + 0.15, end - 0.35), t1 = door + 1.3;
    return [[door, ...D1], [t1, ...lane(x0, kind)], [t1 + 0.4 * (arr - t1), ...lane(x0 + 0.62 * (e - x0), kind)], [arr, ...lane(e, kind)], [Math.max(arr + 0.6, RUN_TEAR + 0.6), ...lane(Math.max(e + 0.2, end), kind)], [RUN_END, ...lane(Math.max(e + 0.2, end) + 0.12, kind)]];
  };
  /** The one who tows goes through at `door`; the one towed follows them 0.55 s behind, on the same line. */
  const lead = (keys: Key[], via: P3, tVia: number, door: number, kind: 'rail' | 'tow', end: number): Key[] => [...keys, [tVia, ...via], [door - 0.7, ...D0], ...pass(door, kind, end)];
  /** Whoever is towed goes where the one who tows them goes: from `from` on their route IS the other's, held off it
   *  by an arm's reach (behind and to the right of the travel in the room; behind, higher and towards the middle in
   *  the passage). Two routes of their own drifted 1.3 to 1.5 m apart at the hatch, and the hands with them. */
  const follow = (pre: Key[], L: Key[], from: number): Key[] => {
    const out = [...pre], p = { x: 0, y: 0, z: 0 }, f = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
    for (let t = from; t < RUN_END + 0.3; t += 0.3) {
      routeAt(L, t, p); routeAt(L, t + 0.5, f); routeAt(L, t - 0.3, b);
      let tx = f.x - b.x, tz = f.z - b.z; const n = Math.hypot(tx, tz); if (n < 0.05) { tx = 1; tz = 0; } else { tx /= n; tz /= n; }
      const u = Math.min(1, Math.max(0, (p.x - PA.doorX - 0.2) / 1.2)), k = u * u * (3 - 2 * u);
      out.push([t, p.x + (-0.6 * tx - 0.3 * tz) * (1 - k) + TOW_OFF[0] * k, p.y + 0.08 * (1 - k) + TOW_OFF[1] * k, p.z + (-0.6 * tz + 0.3 * tx) * (1 - k) + TOW_OFF[2] * k]);
    }
    return out;
  };
  const R = {} as Record<RunId, Key[]>, roles = {} as Record<RunId, Role>;

  // ---- Skyvra and Zenvik. She pushes off the window's frame towards him, her hand out, in every branch, and she is
  // first to the hatch. HAND: he takes it and she tows him. CORE: he turns back to the console for it and comes last,
  // alone, the core under his arm. SILENCE: he hangs a second and follows her alone.
// (she comes to him round the window's side of Lyrra and Nuvexa, who meet between her and him: straight across, she
  // went through them. She reaches him on his window side)
  const reachZ: P3 = add(z0, 0.7, -0.05, -0.45), round: P3 = [reachZ[0] + 0.45, (s0[1] + reachZ[1]) / 2, Math.min(s0[2], reachZ[2] - 0.7)];
  // (the three pairs 2.5 s and about 2.5 m apart, one pair through the hatch per beat: 1.9 s and 1.8 m apart, from P1's
  // and P2's angles the six read as one cluster coming through, a12)
  const sDoor = 8.0, sEnd = 13.2;
  R.explorer = lead([[0, ...s0], [2.8, ...s0], [3.45, ...round], [3.9, ...reachZ], [RUN_SHARED - 0.1, ...add(reachZ, 0.08, 0, 0.08)], [RUN_SHARED, ...add(reachZ, 0.1, 0, 0.1)], [5.5, reachZ[0] + 0.5, -1.15, reachZ[2] + 0.9]], [3.6, -1.1, 0.55], 6.2, sDoor, 'rail', sEnd);
  roles.explorer = { lane: 'rail', door: sDoor, end: sEnd };
  const zPre: Key[] = [[0, ...z0], [3.2, ...z0], [RUN_SHARED - 0.1, ...z0], [RUN_SHARED, ...z0]];
  if (a.hand) {
    R.scientist = follow(zPre, R.explorer, RUN_SHARED + 0.9); // she swings round his front; he turns and follows her hand
    roles.scientist = { lane: 'tow', partner: 'explorer', join: 3.9, door: sDoor + 0.55, end: sEnd - 0.6 };
    roles.explorer.partner = 'scientist'; roles.explorer.leads = true; roles.explorer.join = 3.9;
  } else if (a.core) {
    const zd = 15.6 + (a.hurtD ? 0.6 : 0) + (a.hurtN ? 0.5 : 0); // behind the last pair, however late they are
    R.scientist = lead([...zPre, [CORE_AT, 0.55, -1.0, -0.72], [CORE_AT + 1.6, 0.6, -1.0, -0.7]], [2.6, -1.0, 0.3], zd - 3.1, zd, 'rail', 6.6);
    roles.scientist = { lane: 'rail', door: zd, end: 6.6 };
  } else {
    R.scientist = lead([...zPre, [5.5, ...add(z0, 0.05)]], [3.2, -1.1, 0.5], 7.9, 10.0, 'rail', 11.3);
    roles.scientist = { lane: 'rail', door: 10.0, end: 11.3 };
  }

  // ---- Lyrra goes to Nuvexa and takes her wrist; she tows her (a hurt Nuvexa makes the pair half a second later)
  const late = (a.hurtN ? 0.5 : 0), lb = late + (silence ? 1.6 : 0), lDoor = 10.5 + lb, lEnd = silence ? 9.5 : 10.6;
  // (they meet a little to the room's side of the line between them, and Lyrra sets off that way: straight along it
  // she brushed past Skyvra at the window)
  // (and near Nuvexa's place, not half way: half way is where Skyvra hangs from the window's rail)
  const meet: P3 = [n0[0] + 0.2, (n0[1] + l0[1]) / 2, n0[2] + 0.35];
  R.medic = lead([[0, ...l0], [0.9, ...add(l0, -0.2, 0.3, 1.0)], [1.7, ...add(meet, 0.45, 0, -0.1)], [2.9 + late, ...add(meet, 0.55)], [RUN_SHARED - 0.1, ...add(meet, 0.66, 0.07, 0.05)], [RUN_SHARED, ...add(meet, 0.68, 0.08, 0.06)]], [3.7, -0.5, -0.15], 7.5 + lb, lDoor, 'rail', lEnd);
  R.social = follow([[0, ...n0], [1.7, n0[0] + (meet[0] - n0[0]) * 0.4, meet[1], n0[2] + (meet[2] - n0[2]) * 0.4], [2.9 + late, ...add(meet, -0.1, 0, 0.05)], [RUN_SHARED - 0.1, ...add(meet, 0.01, 0.07, 0.1)], [RUN_SHARED, ...add(meet, 0.03, 0.08, 0.11)]], R.medic, RUN_SHARED + 0.9);
  roles.medic = { lane: 'rail', partner: 'social', leads: true, join: 1.6, door: lDoor, end: lEnd };
  roles.social = { lane: 'tow', partner: 'medic', join: 1.6, door: lDoor + 0.55, end: lEnd - 0.6 };

  // ---- Draxum comes off the ceiling for Bolzar, who has hold of the sofa's back, and tows him out. With his arm
  // hurt (the hold lost) he cannot work a rail: Bolzar has to take it and pull him
  const sofa: P3 = [3.38, -1.2, -0.86];
  const c = (a.hurtD ? 0.6 : 0) + (silence ? 2.0 : 0) + late, dDoor = 13.0 + c, dEnd = silence ? 7.7 : a.core ? 8.5 : 8.1; // (with the core, room behind them for Zenvik)
  // (beside and a little over him, an arm's length off: straight over him, the hand he gave Bolzar had to go through his own body)
  const dx = a.hurtD ? -0.35 : 0.5, dy = 0.28, dz = a.hurtD ? -0.6 : -0.5; // hurt, he comes down behind Bolzar and is the one pulled
  const dAt: Key[] = [[0, ...d0], [1.0, ...add(d0, 0.1, -0.25, 0.1)], [4.4, ...add(sofa, dx, dy, dz)], [5.3, ...add(sofa, dx + 0.02, dy - 0.03, dz + 0.02)], [8.8 + c, ...add(sofa, dx + 0.06, dy - 0.05, dz + 0.08)]];
  const bAt: Key[] = [[0, ...b0], [2.6, ...b0], [3.9, ...sofa], [5.3, ...sofa], [8.8 + c, ...add(sofa, 0.04, 0, 0.05)]];
  const first: P3 = [4.3, -1.1, 0.15];
  if (!a.hurtD) {
    R.strong = lead(dAt, first, 11.1 + c, dDoor, 'rail', dEnd); R.builder = follow(bAt, R.strong, 9.7 + c);
    roles.strong = { lane: 'rail', partner: 'builder', leads: true, join: 5.5, door: dDoor, end: dEnd };
    roles.builder = { lane: 'tow', partner: 'strong', join: 5.5, door: dDoor + 0.55, end: dEnd - 0.6 };
  } else {
    R.builder = lead(bAt, first, 11.1 + c, dDoor, 'rail', dEnd); R.strong = follow(dAt, R.builder, 9.7 + c);
    roles.builder = { lane: 'rail', partner: 'strong', leads: true, join: 5.5, door: dDoor, end: dEnd };
    roles.strong = { lane: 'tow', partner: 'builder', join: 5.5, door: dDoor + 0.55, end: dEnd - 0.6 };
  }
  return { R, roles };
}

/** One pull on a rail, from motion capture: how far ahead of an even pace the body is through one hand-over-hand cycle,
 *  in cycles (0 at the hand's closing). The average of five pulls of a climb up playground bars, CMU motion capture
 *  subject 1, take 2 (3.9 to 6.5 s and 15.7 to 17.6 s): the body hangs back while the hand goes ahead for the next hold,
 *  then surges as the arm pulls, and is carried past the even pace as the hand lets go. (It was a sine.) */
export const PULL = [0, -0.064, -0.098, -0.115, -0.126, -0.112, -0.083, -0.044, -0.007, 0.029, 0.057, 0.083, 0.098, 0.101, 0.085, 0.057];
/** PULL at a phase 0..1 of the cycle, smooth and periodic. */
export function pullAt(ph: number) {
  const n = PULL.length, x = (((ph % 1) + 1) % 1) * n, i = Math.floor(x), u = x - i;
  const p0 = PULL[(i - 1 + n) % n], p1 = PULL[i % n], p2 = PULL[(i + 1) % n], p3 = PULL[(i + 2) % n];
  return p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)));
}

/** How near two chests may come before the bodies are inside each other (m). Joined pairs ride closer than strangers. */
export const CROWD = { pair: 0.42, other: 0.55 };
/** The least distance between every two of the six over the run, from the routes alone. */
export function crowding(R: Record<RunId, Key[]>, roles: Record<RunId, Role>, from = 0, to = RUN_END, step = 0.05) {
  const ids = Object.keys(R) as RunId[], out: { a: RunId; b: RunId; d: number; t: number; bad: boolean }[] = [];
  const pa = { x: 0, y: 0, z: 0 }, pb = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    let best = Infinity, at = 0;
    for (let t = from; t <= to; t += step) { routeAt(R[ids[i]], t, pa); routeAt(R[ids[j]], t, pb); const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z); if (d < best) { best = d; at = t; } }
    const pair = roles[ids[i]].partner === ids[j];
    out.push({ a: ids[i], b: ids[j], d: best, t: at, bad: best < (pair ? CROWD.pair : CROWD.other) });
  }
  return out;
}

/** How far apart two who are joined by the hand get, from when they join: over about 1.05 m the hands cannot meet. */
export function reach(R: Record<RunId, Key[]>, roles: Record<RunId, Role>, step = 0.05) {
  const out: { a: RunId; b: RunId; d: number; t: number }[] = [], pa = { x: 0, y: 0, z: 0 }, pb = { x: 0, y: 0, z: 0 };
  for (const id of Object.keys(R) as RunId[]) {
    const r = roles[id]; if (!r.leads || !r.partner) continue;
    let worst = 0, at = 0;
    for (let t = (r.join ?? 0) + 0.6; t <= RUN_END; t += step) { routeAt(R[id], t, pa); routeAt(R[r.partner], t, pb); const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z); if (d > worst) { worst = d; at = t; } }
    out.push({ a: id, b: r.partner, d: worst, t: at });
  }
  return out;
}
