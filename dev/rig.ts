// Dev-only: plays every pose on every body and measures what a viewer would see go wrong. tools/rig_check.py drives it.
import * as THREE from 'three';
import { createCharacter, Character, CrewPose } from '../src/characters/character';
import { randomLook } from '../src/characters/custom';
import { flail, FALL } from '../src/cinematic/montage';

const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c') as HTMLCanvasElement }); r.setSize(64, 64);
const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
const ids = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social', 'megazron'] as const;
const bodies: { name: string; c: Character }[] = ids.map((id) => ({ name: id, c: createCharacter(id, 1) }));
bodies.push({ name: 'custom_m_heavy', c: createCharacter('scientist', 1, { ...randomLook({ name: 'x', gender: 'm' }), build: 1, outfit: 'strong' }) });
bodies.push({ name: 'custom_f_slim', c: createCharacter('scientist', 1, { ...randomLook({ name: 'y', gender: 'f' }), build: 0, outfit: 'social' }) });
bodies.push({ name: 'strong_suit', c: createCharacter('strong', 1, undefined, 'suit') });
bodies.forEach((b, i) => { b.c.root.position.x = i * 3; scene.add(b.c.root); });
const cam = new THREE.PerspectiveCamera(40, 1, .1, 100);

const V = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3();
const meshes = (c: Character, name: string) => { const out: THREE.SkinnedMesh[] = []; c.root.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && m.name.startsWith(name)) out.push(m); }); return out; };
const world = (m: THREE.SkinnedMesh) => { const n = m.geometry.attributes.position.count, f = new Float32Array(n * 3); for (let i = 0; i < n; i++) { m.getVertexPosition(i, V); V.applyMatrix4(m.matrixWorld); f[i * 3] = V.x; f[i * 3 + 1] = V.y; f[i * 3 + 2] = V.z; } return f; };
const bone = (c: Character, n: string) => c.root.getObjectByName(n)!.getWorldPosition(new THREE.Vector3());
function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) { const ab = B.copy(b).sub(a), t = Math.max(0, Math.min(1, P.copy(p).sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(A.copy(a).addScaledVector(ab, t)); }
const TORSO: [string, string][] = [['hips', 'spine1'], ['spine1', 'chest'], ['chest', 'neck']];

/** Radius of each torso segment from the body at rest: how far the skin sits from the bone line. */
function radii(c: Character) {
  const pos = [...meshes(c, 'skin_body'), ...meshes(c, 'cloth')].map(world); // the surface you see: a full suit leaves almost no body skin
  const segs = TORSO.map(([a, b]) => [bone(c, a), bone(c, b)] as const);
  const per: number[][] = segs.map(() => []);
  for (const f of pos) for (let i = 0; i < f.length; i += 3) {
    V.set(f[i], f[i + 1], f[i + 2]); let best = 9, k = -1;
    segs.forEach(([a, b], j) => { const d = segDist(V, a, b); if (d < best) { best = d; k = j; } });
    if (k >= 0 && best < .3) per[k].push(best);
  }
  return per.map((x) => { x.sort((a, b) => a - b); return x[Math.floor(x.length * .45)] ?? .1; });
}

/** Cloth vertex normals from the deformed cloth, for the inside/outside test. */
function clothNormals(m: THREE.SkinnedMesh, f: Float32Array) {
  const idx = m.geometry.index!.array, n = new Float32Array(f.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = f[b] - f[a], uy = f[b + 1] - f[a + 1], uz = f[b + 2] - f[a + 2], vx = f[c] - f[a], vy = f[c + 1] - f[a + 1], vz = f[c + 2] - f[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

const BONE_NAMES = ['hips', 'spine1', 'chest', 'neck', 'head', 'upperarmL', 'upperarmR', 'lowerarmL', 'lowerarmR', 'upperlegL', 'upperlegR', 'lowerlegL', 'lowerlegR', 'footL', 'footR', 'clavicleL', 'clavicleR'];
function nearestBone(c: Character, x: number, y: number, z: number) { let best = 9, n = ''; for (const b of BONE_NAMES) { const o = c.root.getObjectByName(b); if (!o) continue; const p = o.getWorldPosition(new THREE.Vector3()); const d = Math.hypot(p.x - x, p.y - y, p.z - z); if (d < best) { best = d; n = b; } } return n; }

/** Body skin against the deformed cloth: covered (inside at rest) and how far any covered vertex now sits outside. */
function poke(c: Character, covered: Uint8Array[] | null) {
  const bodyM = meshes(c, 'skin_body'), cl = meshes(c, 'cloth');
  const bp = bodyM.map(world), cp = cl.map(world), cn = cl.map((m, i) => clothNormals(m, cp[i]));
  // open edges of the clothes (cuffs, collars, hems): skin sliding out past them is not skin through cloth
  const edge = cl.map((m, mi) => {
    const idx = m.geometry.index!.array, cnt = new Map<string, number>();
    for (let i = 0; i < idx.length; i += 3) for (const [a, b] of [[idx[i], idx[i + 1]], [idx[i + 1], idx[i + 2]], [idx[i + 2], idx[i]]]) { const k = a < b ? `${a},${b}` : `${b},${a}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
    const f = cp[mi], pts: number[] = [];
    // the same cloth position appears on several uv seams: an edge only counts if no other face shares its positions
    for (const [k, n] of cnt) if (n === 1) { const [a] = k.split(',').map(Number); pts.push(f[a * 3], f[a * 3 + 1], f[a * 3 + 2]); }
    return pts;
  });
  const nearEdge = (x: number, y: number, z: number) => edge.some((pts) => { for (let i = 0; i < pts.length; i += 3) if (Math.hypot(pts[i] - x, pts[i + 1] - y, pts[i + 2] - z) < .035) return true; return false; });
  const cell = .05, grid = new Map<string, number[]>();
  cp.forEach((f, mi) => { for (let i = 0; i < f.length; i += 3) { const key = `${Math.floor(f[i] / cell)},${Math.floor(f[i + 1] / cell)},${Math.floor(f[i + 2] / cell)}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(mi * 1e6 + i); } });
  const cov = bp.map((f) => new Uint8Array(f.length / 3));
  let max = 0, count = 0, worstAt = '';
  bp.forEach((f, bi) => {
    for (let i = 0; i < f.length; i += 3) {
      if (covered && !covered[bi][i / 3]) continue;
      const gx = Math.floor(f[i] / cell), gy = Math.floor(f[i + 1] / cell), gz = Math.floor(f[i + 2] / cell);
      let best = 1, bid = -1;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const id of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
        const mi = Math.floor(id / 1e6), j = id % 1e6, q = cp[mi]; const d = Math.hypot(q[j] - f[i], q[j + 1] - f[i + 1], q[j + 2] - f[i + 2]); if (d < best) { best = d; bid = id; }
      }
      if (bid < 0) continue;
      const mi = Math.floor(bid / 1e6), j = bid % 1e6, q = cp[mi], nn = cn[mi];
      const out = (f[i] - q[j]) * nn[j] + (f[i + 1] - q[j + 1]) * nn[j + 1] + (f[i + 2] - q[j + 2]) * nn[j + 2];
      if (!covered) { if (best < .04 && out < -.001) cov[bi][i / 3] = 1; continue; }
      if (out > .006 && !nearEdge(q[j], q[j + 1], q[j + 2])) { count++; if (out > max) { max = out; worstAt = nearestBone(c, f[i], f[i + 1], f[i + 2]); } }
    }
  });
  return { covered: cov, max, count, worstAt };
}

let t = 0;
const W = window as unknown as Record<string, unknown>;
W.names = bodies.map((b) => b.name); W.bodies = bodies;
W.check = (bi: number, pose: CrewPose, opts: { amount?: number; flail?: number; frames?: number; seed?: number; trace?: boolean } = {}) => {
  const c = bodies[bi].c; bodies.forEach((b, j) => { b.c.root.visible = j === bi; });
  c.setLimbs(null); c.setFace(null);
  for (let k = 0; k < 20; k++) { t += 1 / 30; c.root.updateMatrixWorld(true); c.animate('stand', 0, 0, t, 1 / 30); }
  c.root.updateMatrixWorld(true);
  const rad = radii(c);
  const covered = poke(c, null).covered;
  let handPen = 0, clothPoke = 0, pokeCount = 0, pokeWhere = '', jump = 0, jumpWhere = '';
  const frames = opts.frames ?? 75, dt = 1 / 30;
  let prev: Float32Array[] | null = null; const prevSp: number[][] = [];
  for (let k = 0; k < frames; k++) {
    t += dt;
    if (opts.flail) c.setLimbs(flail({ ...FALL.spread, openHands: true }, t, opts.seed ?? 1, opts.flail));
    c.root.updateMatrixWorld(true); c.animate(pose, t * 7 * (opts.amount ?? 0), opts.amount ?? 0, t, dt); c.root.updateMatrixWorld(true);
    if (opts.trace) ((W.trace ??= []) as unknown[]).push([k, ...['upperarmR', 'lowerarmR', 'forearmtwR', 'handR'].map((n) => { const o = c.root.getObjectByName(n)!; const q = o.getWorldQuaternion(new THREE.Quaternion()); return [q.x, q.y, q.z, q.w].map((x) => +x.toFixed(3)); })]);
    // hands into the torso
    const segs = TORSO.map(([a, b]) => [bone(c, a), bone(c, b)] as const);
    for (const h of ['handL', 'handR', 'finger3_2L', 'finger3_2R']) {
      const p = bone(c, h);
      segs.forEach(([a, b], j) => { handPen = Math.max(handPen, rad[j] - segDist(p, a, b)); });
    }
    // body skin out through the clothes: only skin that the clothes really cover at rest
    const bodyM = meshes(c, 'skin_body'), cl = meshes(c, 'cloth');
    const bp = bodyM.map(world), cp = cl.map(world);
    if (k % 5 === 0) { const r2 = poke(c, covered); if (r2.max > clothPoke) { clothPoke = r2.max; pokeWhere = r2.worstAt; } pokeCount += r2.count; }
    // a vertex that leaps in one frame while its neighbours don't
    const all = [...bp, ...cp];
    if (prev) all.forEach((f, mi) => {
      const p = prev![mi]; if (!p || p.length !== f.length) return;
      const sp: number[] = []; for (let i = 0; i < f.length; i += 3) sp.push(Math.hypot(f[i] - p[i], f[i + 1] - p[i + 1], f[i + 2] - p[i + 2]));
      // a pop starts from nothing: a vertex already moving fast (a flailing hand) is motion, not a glitch
      const ps = prevSp[mi]; const pop = sp.map((x, i) => (ps && x > 2.5 * Math.max(ps[i], .01) ? x : 0));
      prevSp[mi] = sp;
      const s = [...sp].sort((a, b) => a - b), p99 = s[Math.floor(s.length * .99)], mx = Math.max(...pop);
      if (mx > .06 && mx > 3 * p99) { if (mx > jump) {
        jump = mx; const vi = pop.indexOf(mx), ms = [...bodyM, ...cl][mi], g = ms.geometry.attributes;
        const si = g.skinIndex ? [0, 1, 2, 3].map((q) => ms.skeleton.bones[g.skinIndex.getComponent(vi, q)]?.name + ':' + g.skinWeight.getComponent(vi, q).toFixed(2)).join(' ') : '';
        jumpWhere = `frame ${k} ${ms.name} v${vi} ${si}`; } }
    });
    prev = all;
  }
  c.setLimbs(null);
  return { body: bodies[bi].name, pose, handPenCm: +(handPen * 100).toFixed(1), clothPokeCm: +(clothPoke * 100).toFixed(1), pokeCount, pokeWhere, jumpCm: +(jump * 100).toFixed(1), jumpWhere };
};
Promise.all(bodies.map((b) => b.c.whenReady)).then(() => { W.ready = true; });
void cam;
