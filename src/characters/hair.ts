import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sweep, smoothPath } from './shapes';
import { applySway, swayByStrand, SwayUniforms } from './sway';
import { mulberry32 } from '../core/noise';

/** Head space: skull centre and radius, shared with head.ts. */
export const SKULL = new THREE.Vector3(0, 0.122, -0.004);
export const SKULL_R = 0.112;

/** The real head: centre and measured radius by direction (head-bone space), from the character build. */
export interface Skull { c: THREE.Vector3; radius: (d: THREE.Vector3) => number; }
export const roundSkull: Skull = { c: SKULL, radius: () => SKULL_R };
export function skullFrom(c: number[], grid: number[][]): Skull {
  const NE = grid.length, NA = grid[0].length;
  return {
    c: new THREE.Vector3(c[0], c[1], c[2]),
    radius(d) {
      const az = Math.atan2(d.x, d.z), el = Math.asin(Math.max(-1, Math.min(1, d.y / (d.length() || 1))));
      const fa = ((az + Math.PI) / (Math.PI * 2)) * NA - 0.5, fe = Math.max(0, Math.min(NE - 1.001, ((el + Math.PI / 2) / Math.PI) * NE - 0.5));
      const a0 = Math.floor(fa), e0 = Math.floor(fe), ta = fa - a0, te = fe - e0;
      const g = (e: number, a: number) => grid[e][((a % NA) + NA) % NA];
      return (g(e0, a0) * (1 - ta) + g(e0, a0 + 1) * ta) * (1 - te) + (g(e0 + 1, a0) * (1 - ta) + g(e0 + 1, a0 + 1) * ta) * te;
    },
  };
}

export interface Lock {
  /** Root on the skull: azimuth (0 = front, + = character's left) and elevation, radians. */
  az: number; el: number;
  len: number;
  /** Gravity per metre: + falls, - stands up (spikes). */
  droop?: number;
  /** How far the root direction leans out of the skull (0 tangent, 1 straight out). */
  out?: number;
  /** Sideways sweep along the skull (+ towards increasing az). */
  sweep?: number;
  /** Tip curl strength, curling away (+) or inwards (-). */
  curl?: number;
  w?: number;
  thick?: number;
  /** Secondary-motion weight. */
  sway?: number;
  /** Start direction override in head space. */
  dir?: [number, number, number];
  /** Sideways wave along the lock: metres, and full waves over its length. */
  wave?: [number, number];
  /** Keep the lock this far off the skull (radius multiple), for hair with body. */
  lift?: number;
  /** Keep width to a rounded end instead of a point: thick wavy hair, not spikes. */
  soft?: boolean;
}

function dirOf(az: number, el: number, o = new THREE.Vector3()) {
  return o.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/** Grow one lock from the skull, keeping it outside the head. */
function grow(l: Lock, steps: number, S: Skull): { path: THREE.Vector3[]; side: THREE.Vector3 } {
  const d = dirOf(l.az, l.el);
  const p = S.c.clone().addScaledVector(d, S.radius(d) * 0.97);
  const east = new THREE.Vector3(Math.cos(l.az), 0, -Math.sin(l.az));
  const south = new THREE.Vector3().crossVectors(d, east).normalize(); // points down the skull
  if (south.y > 0) south.negate();
  const droop = l.droop ?? 3, out = l.out ?? 0.1, sw = l.sweep ?? 0, curl = l.curl ?? 0;
  const dir = l.dir
    ? new THREE.Vector3(...l.dir).normalize()
    : south.clone().multiplyScalar(droop >= 0 ? 1 : 0.2).addScaledVector(d, out + (droop < 0 ? 0.9 : 0)).addScaledVector(east, sw).normalize();
  const ds = l.len / steps;
  const pts = [p.clone()];
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const hug = (!l.dir || !!l.lift) && droop >= 0;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    dir.y -= droop * ds;
    dir.addScaledVector(east, sw * ds * 2);
    if (curl) dir.addScaledVector(v.copy(p).sub(S.c).setY(0).normalize(), curl * t * t * ds * 12);
    n.copy(p).sub(S.c);
    const rr = n.length(); n.normalize();
    // wrap the skull first: only fall free below the widest part of the head
    if (hug && p.y > S.c.y - 0.11 && rr < S.radius(n) * 1.6) { const o = dir.dot(n); if (o > 0) dir.addScaledVector(n, -o * 0.9); }
    dir.normalize();
    p.addScaledVector(dir, ds);
    v.copy(p).sub(S.c);
    const r = v.length(), min = S.radius(v) * (l.lift ?? 1.035);
    if (r < min) p.copy(S.c).addScaledVector(v.normalize(), min);
    else if (l.lift && r > min + 0.026) p.copy(S.c).addScaledVector(v.normalize(), min + 0.026); // body, never spikes
    pts.push(p.clone());
  }
  if (l.wave) {
    const [amp, n] = l.wave, ph = (l.az * 7.3 + l.el * 3.1) % 6.28;
    pts.forEach((q, i) => { const t = i / steps; q.addScaledVector(east, amp * Math.sin(t * n * 6.283 + ph) * Math.min(1, t * 2.2)); q.y += amp * 0.5 * Math.cos(t * n * 6.283 + ph) * t; });
  }
  return { path: pts, side: east };
}

/** Smooth under-shell: the mass the locks lie on, cut along the hairline. */
function capShell(lowDeg: number, frontDeg: number, S: Skull, volume = 0) {
  const sp = new THREE.SphereGeometry(1, 30, 22);
  const p = sp.attributes.position, idx = sp.index!;
  const keep = (i: number) => {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, y, z);
    const az = Math.atan2(x, z), back = (1 - Math.cos(az)) / 2;
    return y / r > Math.sin(((frontDeg + (lowDeg - frontDeg) * Math.pow(back, 0.7)) * Math.PI) / 180);
  };
  const out: number[] = [];
  for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2); if (keep(a) && keep(b) && keep(c)) out.push(a, b, c); }
  sp.setIndex(out);
  { const q = new THREE.Vector3();
    // `volume`: hair with body swells off the scalp, most at the top and front-top, nothing at the hairline
    const line = (az: number) => Math.sin(((frontDeg + (lowDeg - frontDeg) * Math.pow((1 - Math.cos(az)) / 2, 0.7)) * Math.PI) / 180);
    for (let i = 0; i < p.count; i++) {
      q.fromBufferAttribute(p, i); const n = q.clone().normalize(), az = Math.atan2(n.x, n.z), l0 = line(az);
      const k = Math.max(0, Math.min(1, (n.y - l0) / Math.max(0.05, 1 - l0))), swell = k * k * (3 - 2 * k) * (0.75 + 0.25 * Math.max(0, Math.cos(az)));
      q.multiplyScalar(S.radius(q) * (1.012 + volume * swell)); p.setXYZ(i, q.x, q.y, q.z);
    } }
  sp.computeVertexNormals();
  sp.translate(S.c.x, S.c.y, S.c.z);
  const n = p.count, at = new Float32Array(n).fill(0.16), z = new Float32Array(n), ph = new Float32Array(n).fill(0.5), tan = new Float32Array(n * 3);
  const v = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
  for (let i = 0; i < n; i++) {
    v.set(p.getX(i) - S.c.x, p.getY(i) - S.c.y, p.getZ(i) - S.c.z).normalize();
    const tn = down.clone().addScaledVector(v, -down.dot(v)).normalize();
    tan[i * 3] = tn.x; tan[i * 3 + 1] = tn.y; tan[i * 3 + 2] = tn.z;
  }
  sp.setAttribute('aT', new THREE.BufferAttribute(at, 1));
  sp.setAttribute('aTan', new THREE.BufferAttribute(tan, 3));
  sp.setAttribute('aSway', new THREE.BufferAttribute(z, 1));
  sp.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  return sp;
}

export interface HairColors { root: number; mid: number; tip: number; shine: number }

/** Sculpted anime hair: every lock is a tapered ribbon with its own phase. */
export function buildHair(locks: Lock[], colors: HairColors, sway: SwayUniforms, detail = 1, capLow = -20, capFront = 50, skull: Skull = roundSkull, volume = 0, rough = 0.46): THREE.Mesh {
  const rnd = mulberry32(locks.length * 37 + 5);
  const steps = detail < 0.8 ? 5 : 7;
  // on a real head one anime lock is a bundle of finer strands around the same path
  const fine: Lock[] = locks.flatMap((l) => {
    const n = l.soft ? (detail < 0.8 ? 3 : 5) : detail < 0.8 ? 2 : detail > 1.2 ? 5 : 3;
    return Array.from({ length: n }, (_, i) => {
      const k = i - (n - 1) / 2;
      return { ...l, az: l.az + k * (n > 3 ? 0.055 : 0.085) + (rnd() - 0.5) * 0.04, el: l.el + (rnd() - 0.5) * 0.06, len: l.len * (0.86 + rnd() * 0.22), w: (l.w ?? 0.03) * (n > 3 ? 0.32 : 0.46), thick: (l.thick ?? (l.w ?? 0.03) * 0.42) * 0.7 };
    });
  });
  const parts = fine.map((l) => {
    const { path, side } = grow(l, steps, skull);
    const w = l.w ?? 0.03, th = l.thick ?? w * 0.42;
    const g = sweep(smoothPath(path, steps + (detail < 0.8 ? 0 : 3)), {
      side,
      // soft locks keep their width to a rounded end: waves, not spikes
      width: (t) => w * Math.min(1, 0.7 + t * 2.5) * (l.soft ? 0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - t * t)) : Math.pow(1 - t, l.lift ? 0.42 : 0.62)),
      thick: (t) => th * Math.pow(1 - t, 0.5) + 0.0006,
      sides: detail < 0.8 ? 4 : 6,
    });
    return swayByStrand(g, 0.12, l.sway ?? 1, rnd());
  });
  parts.push(capShell(capLow, capFront, skull, volume));
  const geo = mergeGeometries(parts)!;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0.0, side: THREE.DoubleSide });
  mat.userData.film = { kind: 'hair', ...colors };
  const u = {
    uRoot: { value: new THREE.Color(colors.root) },
    uMid: { value: new THREE.Color(colors.mid) },
    uTip: { value: new THREE.Color(colors.tip) },
    uShine: { value: new THREE.Color(colors.shine) },
  };
  applySway(mat, sway, (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = `attribute float aT; attribute vec3 aTan; varying float vT; varying float vPh; varying vec3 vTan;\n` + sh.vertexShader.replace(
      '#include <begin_vertex>', `#include <begin_vertex>\n  vT = aT; vPh = aPhase; vTan = normalMatrix * aTan;`);
    sh.fragmentShader = `varying float vT; varying float vPh; varying vec3 vTan; uniform vec3 uRoot, uMid, uTip, uShine;\n` + sh.fragmentShader
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        diffuseColor.rgb = mix(mix(uRoot, uMid, smoothstep(0.0, 0.35, vT)), uTip, smoothstep(0.45, 1.0, vT));`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 Tn = normalize(vTan), Vv = normalize(vViewPosition);
          #if NUM_DIR_LIGHTS > 0
            vec3 Lv = directionalLights[0].direction; float Li = min(length(directionalLights[0].color) * 0.22, 1.2);
          #else
            vec3 Lv = normalize(vec3(0.3, 0.8, 0.5)); float Li = 0.6;
          #endif
          vec3 Hh = normalize(Lv + Vv);
          // Kajiya-Kay strand highlight, shifted per lock and along its length
          float th = dot(Tn, Hh) + (vPh - 0.5) * 0.28 + (vT - 0.35) * 0.55;
          float s = sqrt(max(0.0, 1.0 - th * th));
          float band = pow(s, 90.0) * 0.55 + pow(s, 16.0) * 0.06;
          totalEmissiveRadiance += uShine * band * Li;
          // soft self-shadow towards the roots keeps the locks separated
          diffuseColor.rgb *= 0.72 + 0.28 * smoothstep(0.0, 0.3, vT);
        }`);
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- style helpers ----------
const fan = (from: number, to: number, n: number, f: (az: number, i: number, k: number) => Lock): Lock[] =>
  Array.from({ length: n }, (_, i) => { const k = n > 1 ? i / (n - 1) : 0.5; return f(from + (to - from) * k, i, k); });
const D = Math.PI / 180;

/** Layer of long locks from the crown that cover the shell, leaving the face open. */
const layer = (el: number, from: number, to: number, n: number, len: number, droop: number, w: number, o: Partial<Lock> = {}): Lock[] =>
  fan(from * D, to * D, n, (az, i) => ({ az, el: el * D, len: len * (1 + ((i * 7) % 3 - 1) * 0.1), droop, w, ...o }));

export type HairStyleId = 'scientist' | 'strong' | 'medic' | 'explorer' | 'builder' | 'social' | 'megazron' | 'suit';

/** Per-style shell cut: back and front hairline elevation in degrees. */
/** Per-style body: how far the hair mass swells off the scalp at the top (fraction of skull radius). */
export const HAIR_VOLUME: Partial<Record<HairStyleId, number>> = { suit: 0.27 };
/** Per-style surface: thick dry hair is matte. */
export const HAIR_ROUGH: Partial<Record<HairStyleId, number>> = { suit: 0.78 };

export const HAIR_CAP: Record<HairStyleId, [number, number]> = {
  scientist: [-18, 54], strong: [44, 62], medic: [-28, 54], explorer: [-16, 52], builder: [30, 52], social: [-14, 54], megazron: [-22, 58], suit: [40, 58],
};

/** Six original hairstyles. Each returns its list of locks. */
export const HAIRSTYLES: Record<HairStyleId, () => Lock[]> = {
  // Asymmetric sweep: one long fringe across a lens, messy crown tufts, tapered nape.
  scientist: () => [
    ...layer(70, 60, 300, 15, 0.21, 2.2, 0.034),
    ...layer(30, 70, 290, 13, 0.14, 2.5, 0.03, { out: 0.3 }),
    ...fan(-62 * D, 56 * D, 9, (az, i) => ({ az, el: 72 * D, len: 0.11 + (i % 3) * 0.012 + (az > 0 ? 0.03 : 0), droop: 3.4, sweep: 0.75, w: 0.026, curl: 0.3 })),
    { az: 20 * D, el: 76 * D, len: 0.19, droop: 3, sweep: 0.5, w: 0.03, curl: 0.3 },
    { az: 46 * D, el: 58 * D, len: 0.18, droop: 3.6, sweep: 0.15, w: 0.026, out: 0.2 },
    { az: -80 * D, el: 34 * D, len: 0.13, droop: 3, w: 0.024 },
    ...fan(150 * D, 215 * D, 3, (az, i) => ({ az, el: 80 * D, len: 0.075 + (i % 2) * 0.03, droop: 1.2, dir: [Math.sin(az) * 0.4, 1, Math.cos(az) * 1.2], w: 0.024, sway: 0.5 })),
  ],
  // Flame crest: tall swept-back spikes down the centre, shaved sides.
  strong: () => [
    ...fan(0, 1, 10, (_, i, k) => ({ az: (i % 2 ? 1 : -1) * 0.5 + Math.PI * (k > 0.5 ? 1 : 0), el: (88 - k * 58) * D, len: 0.12 + Math.sin(k * Math.PI) * 0.17, droop: -0.9, dir: [(i % 2 ? 0.16 : -0.16), 1, 0.45 - k * 2.0], w: 0.042, sway: 0.28 })),
    ...fan(0, 1, 8, (_, i, k) => ({ az: (i % 2 ? 1 : -1) * 0.9 + Math.PI * (k > 0.5 ? 1 : 0), el: (78 - k * 40) * D, len: 0.1 + Math.sin(k * Math.PI) * 0.08, droop: -0.9, dir: [(i % 2 ? 0.55 : -0.55), 1, 0.2 - k * 1.5], w: 0.03, sway: 0.28 })),
    ...fan(-28 * D, 28 * D, 4, (az) => ({ az, el: 66 * D, len: 0.15, droop: -1.1, dir: [az * 0.7, 1, 0.72], w: 0.04, sway: 0.28 })),
  ],
  // Silver curtain with a long plait over one shoulder.
  medic: () => [
    ...layer(76, 40, 320, 18, 0.44, 2.3, 0.05),
    ...layer(40, 90, 270, 14, 0.42, 2.2, 0.05, { out: 0.12 }),
    ...fan(-50 * D, 50 * D, 11, (az, i) => ({ az, el: 74 * D, len: 0.1 + (i % 2) * 0.012, droop: 4.5, w: 0.023, sway: 0.5 })),
    { az: 78 * D, el: 44 * D, len: 0.3, droop: 3, w: 0.024 }, { az: -78 * D, el: 44 * D, len: 0.3, droop: 3, w: 0.024 },
    ...[-1, 0, 1].map((k) => ({ az: 112 * D, el: -4 * D, len: 0.46, droop: 1.8, dir: [0.25 + k * 0.05, -1, 0.5 + k * 0.05] as [number, number, number], w: 0.02, sway: 1.2 })),
  ],
  // Wind-tossed layers and a high tail that whips around.
  explorer: () => [
    ...layer(74, 50, 310, 14, 0.2, 2, 0.036),
    ...layer(30, 70, 290, 13, 0.14, 1.9, 0.032, { out: 0.35, curl: 1.0 }),
    ...fan(-60 * D, 60 * D, 10, (az, i) => ({ az, el: 74 * D, len: 0.1 + (i % 3) * 0.018, droop: 3.2, sweep: Math.sin(i * 1.7) * 0.55, w: 0.027, curl: 0.5 })),
    { az: 68 * D, el: 44 * D, len: 0.15, droop: 3, w: 0.022, curl: 1 }, { az: -68 * D, el: 44 * D, len: 0.15, droop: 3, w: 0.022, curl: 1 },
    ...fan(-1, 1, 11, (k, i) => ({ az: Math.PI + k * 0.25, el: 58 * D, len: 0.44 + (i % 3) * 0.05, droop: 2.6, dir: [k * 0.32, 0.62, -1], w: 0.036, sway: 1.5, curl: 0.2 })),
  ],
  // Spiky tufts bursting over a headband.
  builder: () => [
    ...fan(0, 335 * D, 12, (az, i) => ({ az, el: 60 * D, len: 0.09 + (i % 3) * 0.03, droop: -2, dir: [Math.sin(az) * 0.55, 1, Math.cos(az) * 0.55], w: 0.036, sway: 0.32 })),
    ...fan(0, 310 * D, 7, (az, i) => ({ az, el: 82 * D, len: 0.13 + (i % 2) * 0.05, droop: -2, dir: [Math.sin(az) * 0.22, 1, Math.cos(az) * 0.22], w: 0.04, sway: 0.32 })),
    ...fan(-44 * D, 44 * D, 5, (az, i) => ({ az, el: 58 * D, len: 0.075 + (i % 2) * 0.02, droop: 2.4, w: 0.022, sway: 0.4, dir: [Math.sin(az) * 0.7, 0.2, 1] })),
    ...fan(115 * D, 245 * D, 8, (az) => ({ az, el: 26 * D, len: 0.07, droop: 2.4, w: 0.03, sway: 0.2 })),
  ],
  // Short sides are fur shells on the skin. Above them: thick loose waves pushed up off the forehead,
  // messy at the crown, a couple of locks falling forward.
  // Thick, dark, wavy: swept up and back off the forehead with real volume, short at the sides and back,
  // and a few loose waves that tumble forward at the top front without reaching the brows.
  suit: () => {
    const r = mulberry32(77), j = (a: number) => (r() - 0.5) * 2 * a;
    return [
      // the front of the mass: rises off the hairline, then rolls back
      ...fan(-48 * D, 48 * D, 17, (az): Lock => ({ az: az + j(0.04), el: (55 + j(3)) * D, len: 0.17 + j(0.025), droop: 0.45, dir: [Math.sin(az) * 0.15 + j(0.08), 1, -0.85 + j(0.12)], w: 0.034, thick: 0.019, lift: 1.28, wave: [0.011 + j(0.003), 1.4 + j(0.3)], sway: 0.35, soft: true })),
      // the middle: longer waves running back over the top
      ...fan(-50 * D, 50 * D, 15, (az): Lock => ({ az: az + j(0.06), el: (68 + j(4)) * D, len: 0.18 + j(0.03), droop: 0.7, dir: [Math.sin(az) * 0.3 + j(0.12), 0.7, -1 + j(0.15)], w: 0.036, thick: 0.019, lift: 1.33, wave: [0.013 + j(0.004), 1.6 + j(0.4)], sway: 0.4, soft: true })),
      // the crown, lying back and down
      ...fan(120 * D, 240 * D, 13, (az): Lock => ({ az: az + j(0.08), el: (74 + j(6)) * D, len: 0.11 + j(0.02), droop: 2.2, dir: [Math.sin(az) * 0.5, 0.1, Math.cos(az) * 0.8 + j(0.2)], w: 0.034, thick: 0.016, lift: 1.25, wave: [0.009, 1.3], sway: 0.3, soft: true })),
      ...fan(92 * D, 268 * D, 13, (az): Lock => ({ az: az + j(0.06), el: (58 + j(5)) * D, len: 0.09 + j(0.015), droop: 1.8, dir: [Math.sin(az) * 0.7, 0.3, Math.cos(az) * 0.8], w: 0.032, thick: 0.014, lift: 1.14, wave: [0.006, 1.1], sway: 0.25, soft: true })),
      // the top blends into the close-cut sides and back: short, lying flat, no ledge
      ...fan(96 * D, 264 * D, 15, (az): Lock => ({ az: az + j(0.05), el: (44 + j(4)) * D, len: 0.06 + j(0.012), droop: 2.4, dir: [Math.sin(az) * 0.5, -0.3, Math.cos(az) * 0.5], w: 0.03, thick: 0.01, lift: 1.05, wave: [0.003, 1], sway: 0.15 })),
      // the loose waves that fall forward at the top front, stopping above the brows
      ...fan(-28 * D, 30 * D, 5, (az, i): Lock => ({ az: az + j(0.04), el: (70 + j(3)) * D, len: 0.11 + (i % 2) * 0.02, droop: 2.6, dir: [Math.sin(az) * 0.6 + j(0.2), 0.75, 0.55], w: 0.026, thick: 0.012, lift: 1.3, wave: [0.014, 1.8], curl: 0.35, sway: 0.6, soft: true })),
    ];
  },
  // Long pale hair that floats upward at the ends, as if gravity is a suggestion.
  megazron: () => [
    ...layer(78, 70, 290, 18, 0.46, 5, 0.05, { out: 0, sway: 1 }),
    ...layer(40, 96, 264, 14, 0.42, 5, 0.05, { out: 0, sway: 1.1 }),
    // centre parting: the fringe opens on the face and falls behind the ears
    ...[-1, 1].flatMap((s) => fan(26 * D, 64 * D, 4, (az, i) => ({ az: az * s, el: 74 * D, len: 0.2 + i * 0.02, droop: 5, sweep: s * 0.8, w: 0.024, out: 0, sway: 0.5 }))),
  ],
  // Two huge spiral tails with an airy fringe: the loudest silhouette in the crew.
  social: () => [
    ...layer(74, 50, 310, 13, 0.18, 2.4, 0.038),
    ...layer(30, 80, 280, 11, 0.12, 2.6, 0.032),
    ...fan(-58 * D, 58 * D, 9, (az, i) => ({ az, el: 74 * D, len: 0.105 + (i % 2) * 0.014, droop: 4, sweep: az < 0 ? -0.3 : 0.3, w: 0.025, curl: -0.3, sway: 0.5 })),
    { az: 72 * D, el: 36 * D, len: 0.25, droop: 3.6, w: 0.02, curl: -1.2 }, { az: -72 * D, el: 36 * D, len: 0.25, droop: 3.6, w: 0.02, curl: -1.2 },
    ...[-1, 1].flatMap((s) => fan(0, 1, 11, (_, i) => ({
      az: s * 118 * D, el: 56 * D, len: 0.72 + (i % 3) * 0.05, droop: 5.2, dir: [s * (0.8 + (i % 4) * 0.08), 0.9 + (i % 3) * 0.1, -0.45 + (i % 5) * 0.07] as [number, number, number],
      w: 0.045, sway: 1.35, curl: 1.1,
    }))),
  ],
};
