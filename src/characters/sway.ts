import * as THREE from 'three';

/** Shared per-character uniforms for hair and cloth secondary motion. */
export interface SwayUniforms {
  uTime: { value: number };
  uSwing: { value: THREE.Vector3 };
  uFlutter: { value: number };
}

export function swayUniforms(): SwayUniforms {
  return { uTime: { value: 0 }, uSwing: { value: new THREE.Vector3() }, uFlutter: { value: 0.012 } };
}

const VERT_HEAD = /* glsl */ `
  attribute float aSway; attribute float aPhase;
  uniform float uTime, uFlutter; uniform vec3 uSwing;
`;
const VERT_BODY = /* glsl */ `
  { float sw = aSway * aSway;
    float ph = aPhase * 6.2832;
    vec3 flut = vec3(sin(uTime * 2.1 + ph + position.y * 7.0), sin(uTime * 1.3 + ph) * 0.4, cos(uTime * 1.7 + ph * 1.3 + position.x * 6.0));
    transformed += (uSwing + flut * uFlutter) * sw; }
`;

/** Bends vertices by aSway^2: strands and hems follow the body with a delay. */
export function applySway(mat: THREE.Material, u: SwayUniforms, extra?: (sh: THREE.WebGLProgramParametersWithUniforms) => void) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
    extra?.(sh);
  };
  mat.customProgramCacheKey = () => (extra ? 'sway-hair' : 'sway');
  return mat;
}

/** Fill aSway/aPhase on a geometry from its height (hems: free at the bottom). */
export function swayByHeight(g: THREE.BufferGeometry, yTop: number, yBottom: number, amount = 1) {
  const p = g.getAttribute('position');
  const s = new Float32Array(p.count), ph = new Float32Array(p.count);
  const seed = Math.random();
  for (let i = 0; i < p.count; i++) {
    s[i] = Math.max(0, Math.min(1, (yTop - p.getY(i)) / (yTop - yBottom))) * amount;
    ph[i] = seed + Math.atan2(p.getX(i), p.getZ(i)) * 0.08;
  }
  g.setAttribute('aSway', new THREE.BufferAttribute(s, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  return g;
}

/** Fill aSway/aPhase on a strand (uses aT from sweep()). */
export function swayByStrand(g: THREE.BufferGeometry, stiffRoot = 0, amount = 1, phase = Math.random()) {
  const t = g.getAttribute('aT');
  const s = new Float32Array(t.count), ph = new Float32Array(t.count);
  for (let i = 0; i < t.count; i++) { s[i] = Math.max(0, t.getX(i) - stiffRoot) / (1 - stiffRoot) * amount; ph[i] = phase; }
  g.setAttribute('aSway', new THREE.BufferAttribute(s, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  return g;
}
