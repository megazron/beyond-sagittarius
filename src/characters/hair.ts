import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sweep, smoothPath } from './shapes';
import { applySway, swayByStrand, SwayUniforms } from './sway';
import { mulberry32 } from '../core/noise';

/** Head space: skull centre and radius, shared with head.ts. */
export const SKULL = new THREE.Vector3(0, 0.122, -0.004);
export const SKULL_R = 0.112;

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
}

function dirOf(az: number, el: number, o = new THREE.Vector3()) {
  return o.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/** Grow one lock from the skull, keeping it outside the head. */
function grow(l: Lock, steps: number): { path: THREE.Vector3[]; side: THREE.Vector3 } {
  const d = dirOf(l.az, l.el);
  const p = SKULL.clone().addScaledVector(d, SKULL_R * 0.94);
  const east = new THREE.Vector3(Math.cos(l.az), 0, -Math.sin(l.az));
  const south = new THREE.Vector3().crossVectors(d, east).normalize(); // points down the skull
  if (south.y > 0) south.negate();
  const droop = l.droop ?? 3, out = l.out ?? 0.35, sw = l.sweep ?? 0, curl = l.curl ?? 0;
  const dir = l.dir
    ? new THREE.Vector3(...l.dir).normalize()
    : south.clone().multiplyScalar(droop >= 0 ? 1 : 0.2).addScaledVector(d, out + (droop < 0 ? 0.9 : 0)).addScaledVector(east, sw).normalize();
  const ds = l.len / steps;
  const pts = [p.clone()];
  const v = new THREE.Vector3();
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    dir.y -= droop * ds;
    dir.addScaledVector(east, sw * ds * 2);
    if (curl) dir.addScaledVector(v.copy(p).sub(SKULL).setY(0).normalize(), curl * t * t * ds * 12);
    dir.normalize();
    p.addScaledVector(dir, ds);
    // stay outside the skull
    v.copy(p).sub(SKULL);
    const r = v.length(), min = SKULL_R * 1.1;
    if (r < min) p.copy(SKULL).addScaledVector(v.normalize(), min);
    pts.push(p.clone());
  }
  return { path: pts, side: east };
}

export interface HairColors { root: number; mid: number; tip: number; shine: number }

/** Sculpted anime hair: every lock is a tapered ribbon with its own phase. */
export function buildHair(locks: Lock[], colors: HairColors, sway: SwayUniforms, detail = 1): THREE.Mesh {
  const rnd = mulberry32(locks.length * 37 + 5);
  const steps = detail < 0.8 ? 5 : 7;
  const parts = locks.map((l) => {
    const { path, side } = grow(l, steps);
    const w = l.w ?? 0.03, th = l.thick ?? w * 0.42;
    const g = sweep(smoothPath(path, steps + (detail < 0.8 ? 0 : 3)), {
      side,
      width: (t) => w * Math.min(1, 0.45 + t * 3) * Math.pow(1 - t, 0.75),
      thick: (t) => th * Math.min(1, 0.6 + t * 2) * Math.pow(1 - t, 0.6) + 0.0006,
      sides: detail < 0.8 ? 4 : 6,
    });
    return swayByStrand(g, 0.12, l.sway ?? 1, rnd());
  });
  const geo = mergeGeometries(parts)!;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.46, metalness: 0.0, side: THREE.DoubleSide });
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
          float band = pow(s, 90.0) * 0.8 + pow(s, 16.0) * 0.1;
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

/** Under-layer that hides the scalp, in the hair's main direction. */
const crown = (len: number, droop: number, w = 0.045, n = 14): Lock[] => [
  ...fan(-180 * D, 170 * D, n, (az) => ({ az, el: 62 * D, len, droop, w, out: 0.2, sway: 0.5 })),
  ...fan(-175 * D, 165 * D, n, (az) => ({ az, el: 25 * D, len: len * 0.9, droop, w, out: 0.2, sway: 0.7 })),
  ...fan(0, 330 * D, 7, (az) => ({ az, el: 86 * D, len: len * 0.7, droop, w, out: 0.1, sway: 0.4 })),
];

export type HairStyleId = 'scientist' | 'strong' | 'medic' | 'explorer' | 'builder' | 'social';

/** Six original hairstyles. Each returns its list of locks. */
export const HAIRSTYLES: Record<HairStyleId, () => Lock[]> = {
  // Asymmetric sweep: a long fringe falling over one lens, messy crown tufts.
  scientist: () => [
    ...crown(0.13, 2.6),
    ...fan(-58 * D, 62 * D, 9, (az, i) => ({ az, el: 58 * D, len: 0.15 + (i % 3) * 0.02 + (az > 0 ? 0.07 : 0), droop: 3.6, sweep: 1.15, out: 0.55, w: 0.03, curl: 0.2 })),
    { az: 28 * D, el: 66 * D, len: 0.25, droop: 3.8, sweep: 0.5, out: 0.6, w: 0.036, curl: 0.25 },
    { az: 46 * D, el: 50 * D, len: 0.23, droop: 4.2, sweep: 0.2, out: 0.5, w: 0.03 },
    ...fan(120 * D, 240 * D, 7, (az, i) => ({ az, el: 66 * D, len: 0.1 + (i % 2) * 0.03, droop: -3, out: 0.3, w: 0.028 })),
    ...fan(-60 * D, 60 * D, 5, (az) => ({ az: az + Math.PI, el: 8 * D, len: 0.12, droop: 2, out: 0.5, w: 0.03, curl: 0.5 })),
    { az: 95 * D, el: 22 * D, len: 0.13, droop: 2.6, w: 0.03, out: 0.5 }, { az: -95 * D, el: 22 * D, len: 0.14, droop: 2.6, w: 0.03, out: 0.5 },
  ],
  // Flame crest: tall swept-back spikes, shaved sides.
  strong: () => [
    ...fan(-12 * D, 192 * D, 9, (az, i) => ({ az: az * 0 + (i % 2 ? 0.25 : -0.25), el: (84 - i * 7) * D, len: 0.15 + Math.sin(i / 8 * Math.PI) * 0.15, droop: -1.2, dir: [(i % 2 ? 0.14 : -0.14), 1, -0.25 - i * 0.2], w: 0.04, sway: 0.3, curl: 0 })),
    ...fan(0, 200 * D, 8, (az, i) => ({ az: (i % 2 ? 0.55 : -0.55), el: (78 - i * 8) * D, len: 0.17 + (i % 3) * 0.04, droop: -0.6, dir: [(i % 2 ? 0.45 : -0.45), 1, -0.5 - i * 0.2], w: 0.034, sway: 0.3 })),
    ...fan(-30 * D, 30 * D, 4, (az) => ({ az, el: 62 * D, len: 0.14, droop: -1, dir: [az * 0.6, 1, 0.35], w: 0.036, sway: 0.3 })),
    ...fan(-180 * D, 170 * D, 12, (az) => ({ az, el: 44 * D, len: 0.05, droop: 1, w: 0.03, out: 0.2, sway: 0.1 })),
  ],
  // Silver curtain with a long plait over one shoulder.
  medic: () => [
    ...crown(0.3, 3.2, 0.05, 16),
    ...fan(-52 * D, 52 * D, 11, (az, i) => ({ az, el: 60 * D, len: 0.125 + (i % 2) * 0.012, droop: 4.5, out: 0.5, w: 0.024, sway: 0.5 })),
    { az: 60 * D, el: 40 * D, len: 0.28, droop: 3.5, out: 0.42, w: 0.03 },
    { az: -60 * D, el: 40 * D, len: 0.28, droop: 3.5, out: 0.42, w: 0.03 },
    ...fan(110 * D, 250 * D, 11, (az) => ({ az, el: 10 * D, len: 0.48, droop: 2.2, out: 0.3, w: 0.05, curl: 0.12 })),
    // plait: three strands crossing down the left side
    ...[-1, 0, 1].map((k) => ({ az: 112 * D, el: -6 * D, len: 0.46, droop: 1.8, dir: [0.25 + k * 0.05, -1, 0.5 + k * 0.05] as [number, number, number], w: 0.02, sway: 1.2 })),
  ],
  // Wind-tossed layers and a high tail that whips around.
  explorer: () => [
    ...crown(0.15, 2.2, 0.04, 14),
    ...fan(-62 * D, 62 * D, 10, (az, i) => ({ az, el: 56 * D, len: 0.13 + (i % 3) * 0.03, droop: 3.4, out: 0.6, sweep: Math.sin(i * 1.7) * 0.5, w: 0.028, curl: 0.5 })),
    ...fan(70 * D, 290 * D, 12, (az, i) => ({ az, el: 16 * D, len: 0.15 + (i % 2) * 0.05, droop: 1.8, out: 0.6, w: 0.034, curl: 1.1 })),
    ...fan(-4, 4, 11, (k, i) => ({ az: Math.PI, el: 58 * D, len: 0.42 + (i % 3) * 0.05, droop: 2.6, dir: [k * 0.08, 0.75, -1], w: 0.034, sway: 1.5, curl: 0.25 })),
  ],
  // Spiky tufts bursting over a headband.
  builder: () => [
    ...fan(-180 * D, 170 * D, 12, (az) => ({ az, el: 40 * D, len: 0.06, droop: 2, w: 0.032, out: 0.5, sway: 0.2 })),
    ...fan(0, 335 * D, 11, (az, i) => ({ az, el: 58 * D, len: 0.11 + (i % 3) * 0.03, droop: -2.2, out: 0.2, w: 0.034, sway: 0.35 })),
    ...fan(0, 310 * D, 6, (az, i) => ({ az, el: 80 * D, len: 0.12 + (i % 2) * 0.04, droop: -2.6, w: 0.036, sway: 0.35 })),
    ...fan(-48 * D, 48 * D, 6, (az, i) => ({ az, el: 50 * D, len: 0.1 + (i % 2) * 0.04, droop: 2.6, out: 1.0, w: 0.026, sway: 0.4 })),
  ],
  // Two huge spiral tails with an airy fringe: the loudest silhouette in the crew.
  social: () => [
    ...crown(0.12, 2.8, 0.042, 12),
    ...fan(-60 * D, 60 * D, 9, (az, i) => ({ az, el: 58 * D, len: 0.12 + (i % 2) * 0.02, droop: 4, out: 0.55, sweep: az < 0 ? -0.3 : 0.3, w: 0.026, curl: -0.3, sway: 0.5 })),
    { az: 72 * D, el: 30 * D, len: 0.24, droop: 4, out: 0.4, w: 0.022, curl: -1.2 }, { az: -72 * D, el: 30 * D, len: 0.24, droop: 4, out: 0.4, w: 0.022, curl: -1.2 },
    ...[-1, 1].flatMap((s) => fan(0, 1, 11, (_, i) => ({
      az: s * 118 * D, el: 56 * D, len: 0.62 + (i % 3) * 0.05, droop: 1.9, dir: [s * (1 + (i % 4) * 0.1), 0.45 + (i % 3) * 0.12, -0.28 + (i % 5) * 0.06] as [number, number, number],
      w: 0.042, sway: 1.35, curl: 1.3,
    }))),
  ],
};
