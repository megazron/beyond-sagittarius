// Dev-only: plays every pose on every body and measures what a viewer would see go wrong. tools/rig_check.py drives it.
import * as THREE from 'three';
import { createCharacter, Character, CrewPose, CHAR_BUDGET } from '../src/characters/character';
CHAR_BUDGET.throttle = false; CHAR_BUDGET.lodFar = Infinity;
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

import { V, A, B, P, meshes, world, bone, segDist, TORSO, radii, poke } from './qa_lib';
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
