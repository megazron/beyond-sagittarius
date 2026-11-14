import * as THREE from 'three';

/**
 * Whatever comes within half a metre of the camera dissolves (an ordered dither, so it costs no sorting). The follow
 * camera and the cutscene cameras keep clear of walls, trunks and people, but thin things (sign blades, posts,
 * awnings, a beacon leg) can still pass right by the lens, and then a single prop filled the screen. Applies to the
 * built-in mesh materials; a material with its own shader hook (terrain, grass, trees, skin) is left as it is, and
 * `material.userData.noNearFade` opts one out.
 */
const KINDS = ['isMeshStandardMaterial', 'isMeshPhysicalMaterial', 'isMeshBasicMaterial', 'isMeshLambertMaterial', 'isMeshPhongMaterial', 'isMeshToonMaterial'] as const;
const wants = (m: THREE.Material) => KINDS.some((k) => (m as unknown as Record<string, boolean>)[k]) && !m.userData.noNearFade;

/** View depth (m) where the fade starts, and where nothing is left. */
const FULL = 0.6, GONE = 0.22;

const VERT_DECL = '#include <common>\nvarying float vNearD;';
const VERT_SET = '#include <project_vertex>\nvNearD = -mvPosition.z;';
const FRAG_DECL = '#include <common>\nvarying float vNearD;\nuniform float uNearFade;';
const FRAG_CUT = `#include <clipping_planes_fragment>
{ float nearK = smoothstep(${GONE.toFixed(2)}, ${FULL.toFixed(2)}, vNearD);
  if (uNearFade > 0.5 && nearK < 1.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= nearK) discard; }`;

const proto = THREE.Material.prototype as THREE.Material & { onBeforeCompile: (s: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => void };
const baseKey = proto.customProgramCacheKey;

/** On only behind the player (the follow camera): set each frame. Cutscene framing is composed and left alone. */
export const NEAR_FADE = { value: 0 };

proto.onBeforeCompile = function (this: THREE.Material, sh: THREE.WebGLProgramParametersWithUniforms) { nearFade(this, sh); };

/** For a material with a shader hook of its own (the trees' leaves): call at the end of that hook. */
export function nearFade(m: THREE.Material, sh: THREE.WebGLProgramParametersWithUniforms) {
  // skinned bodies are never faded: an over-the-shoulder shot is meant to have a shoulder in it
  if (!wants(m) || (sh as unknown as { skinning?: boolean }).skinning || !sh.vertexShader.includes('#include <project_vertex>') || !sh.fragmentShader.includes('#include <clipping_planes_fragment>')) return;
  sh.uniforms.uNearFade = NEAR_FADE;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_DECL).replace('#include <project_vertex>', VERT_SET);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', FRAG_DECL).replace('#include <clipping_planes_fragment>', FRAG_CUT);
}
proto.customProgramCacheKey = function (this: THREE.Material) { return baseKey.call(this) + (wants(this) ? '|nearfade' : ''); };

