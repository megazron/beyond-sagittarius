import * as THREE from 'three';
import { chainCompile } from './pbr';

/**
 * Atmosphere: replaces three's distance fog on the world's materials with
 * distance haze + exponential height fog (mist pooling in the valleys and over
 * the lake) + sun in-scattering (the haze glows toward the sun). Uses the
 * scene's FogExp2 colour/density, so the existing day–night fog logic keeps
 * working; the extra terms come from the shared uniforms below.
 */
export const atmosphere = {
  uFogBase: { value: 0 },
  uFogFall: { value: 0.07 },
  uFogHeight: { value: 1.0 },
  uFogSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uFogSun: { value: new THREE.Color(0, 0, 0) },
};

const VERT_PARS = /* glsl */ `
#include <fog_pars_vertex>
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif`;
const VERT = /* glsl */ `
#include <fog_vertex>
#ifdef USE_FOG
  vFogWorld = cameraPosition + (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
#endif`;
const FRAG_PARS = /* glsl */ `
#include <fog_pars_fragment>
#ifdef USE_FOG
  varying vec3 vFogWorld;
  uniform float uFogBase, uFogFall, uFogHeight;
  uniform vec3 uFogSunDir, uFogSun;
#endif`;
const FRAG = /* glsl */ `
#ifdef USE_FOG
  {
    vec3 rd = vFogWorld - cameraPosition;
    float dist = length(rd);
    #ifdef FOG_EXP2
      float dens = fogDensity;
    #else
      float dens = 2.0 / max(fogFar, 1.0);
    #endif
    float haze = 1.0 - exp(-dens * dens * dist * dist);
    // analytic integral of density exp(-(y - base) * fall) along the view ray
    float b = uFogFall;
    float h0 = cameraPosition.y - uFogBase;
    float dy = rd.y;
    float integ = abs(dy) > 0.01 ? (exp(-h0 * b) - exp(-(h0 + dy) * b)) / (b * dy) : exp(-h0 * b);
    float mist = 1.0 - exp(-dens * uFogHeight * dist * clamp(integ, 0.0, 8.0));
    float f = 1.0 - (1.0 - haze) * (1.0 - mist);
    float sd = max(dot(rd / max(dist, 1e-3), uFogSunDir), 0.0);
    vec3 fc = fogColor + uFogSun * (pow(sd, 6.0) * 0.6 + pow(sd, 32.0) * 0.8);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, clamp(f, 0.0, 1.0));
  }
#endif`;

const patched = new WeakSet<THREE.Material>();

/** Patches one material (idempotent). Materials without fog chunks are skipped. */
export function patchFog(mat: THREE.Material) {
  if (patched.has(mat)) return;
  patched.add(mat);
  if (!(mat as THREE.MeshStandardMaterial).fog) return;
  if ((mat as THREE.ShaderMaterial).isShaderMaterial) {
    const sm = mat as THREE.ShaderMaterial;
    if (!sm.fragmentShader.includes('#include <fog_fragment>') || !sm.vertexShader.includes('#include <fog_vertex>')) return;
  }
  chainCompile(mat, 'atmo', (sh) => {
    Object.assign(sh.uniforms, atmosphere);
    sh.vertexShader = sh.vertexShader.replace('#include <fog_pars_vertex>', VERT_PARS).replace('#include <fog_vertex>', VERT);
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_pars_fragment>', FRAG_PARS).replace('#include <fog_fragment>', FRAG);
  });
  mat.needsUpdate = true;
}

/** Walks a scene and patches every material not seen yet (cheap after the first call). */
export function patchSceneFog(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    if (Array.isArray(m)) m.forEach(patchFog); else patchFog(m);
  });
}
