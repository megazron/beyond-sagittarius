import * as THREE from 'three';
import { loadSet, meanColor, capSize } from '../core/assets';
import type { Quality } from '../core/quality';

/**
 * Shared helpers that put the CC0 photo textures onto the world's palette-
 * coloured materials. The albedo is always normalised by its mean so the
 * texture adds detail and a little chroma while the vertex/instance colours
 * keep the planet's alien palette.
 */

const LUM = 'vec3(0.2126, 0.7152, 0.0722)';

/** Chains an extra onBeforeCompile after any existing one (e.g. wind). */
export function chainCompile(mat: THREE.Material, tag: string, fn: (sh: THREE.WebGLProgramParametersWithUniforms) => void) {
  const prev = mat.onBeforeCompile;
  const key = mat.customProgramCacheKey() + '|' + tag;
  mat.onBeforeCompile = (sh, r) => { prev.call(mat, sh, r); fn(sh); };
  mat.customProgramCacheKey = () => key;
}

/**
 * Bark on tree trunks (geometry attribute aBark = 1); caps, fronds and fans keep
 * a faint version of the bark relief so they read as organic, not plastic.
 */
export function applyBark(mat: THREE.MeshStandardMaterial, q: Quality) {
  const u = { uMean: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, uChroma: { value: 0.9 } };
  chainCompile(mat, 'bark', (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float aBark; varying float vBark;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n  vBark = aBark;');
    sh.fragmentShader = `varying float vBark; uniform vec3 uMean; uniform float uChroma;\n` + sh.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
      #ifdef USE_MAP
        vec3 tx = texture2D(map, vMapUv).rgb;
        vec3 dd = mix(vec3(dot(tx, ${LUM}) / max(dot(uMean, ${LUM}), 1e-3)), tx / max(uMean, vec3(1e-3)), uChroma);
        diffuseColor.rgb *= mix(mix(vec3(1.0), dd, 0.25), dd * 0.95, vBark);
      #endif`,
    ).replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * mix(0.3, 1.0, vBark);')
      .replace('roughnessFactor *= texelRoughness.g;', 'roughnessFactor *= mix(1.0, texelRoughness.g * 1.1, vBark);');
  });
  loadSet('bark_fir', ['diff', 'nor'], q.texSize === '4k' ? '4k' : capSize(q.texSize, '1k')).then((s) => {
    if (!s.diff) return;
    const m = meanColor(s.diff);
    u.uMean.value.set(m.r, m.g, m.b);
    mat.map = s.diff;
    if (s.nor) { mat.normalMap = s.nor; mat.normalScale.setScalar(1.4); }
    mat.needsUpdate = true;
  });
}

/**
 * Object-space triplanar rock texture for instanced boulders (their geometry
 * has no usable UVs). Works for rotated, uniformly scaled instances.
 */
export function applyRock(mat: THREE.MeshStandardMaterial, q: Quality, scale = 0.45) {
  const u = {
    tRockD: { value: null as THREE.Texture | null },
    tRockN: { value: null as THREE.Texture | null },
    uMean: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    uRockOn: { value: 0 },
  };
  chainCompile(mat, 'rock', (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vOP; varying vec3 vON; varying vec3 vAX; varying vec3 vAY; varying vec3 vAZ;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vOP = position * ${scale.toFixed(3)};
      vON = normal;
      mat3 toView = normalMatrix;
      #ifdef USE_INSTANCING
        toView = normalMatrix * mat3(instanceMatrix);
      #endif
      vAX = toView * vec3(1.0, 0.0, 0.0); vAY = toView * vec3(0.0, 1.0, 0.0); vAZ = toView * vec3(0.0, 0.0, 1.0);`,
    );
    sh.fragmentShader = `varying vec3 vOP; varying vec3 vON; varying vec3 vAX; varying vec3 vAY; varying vec3 vAZ;
      uniform sampler2D tRockD; uniform sampler2D tRockN; uniform vec3 uMean; uniform float uRockOn;\n` + sh.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
      vec3 rbw = pow(abs(normalize(vON)), vec3(4.0)); rbw /= rbw.x + rbw.y + rbw.z;
      vec3 rockC = vec3(1.0); vec3 rockN = vec3(0.0);
      if (uRockOn > 0.5) {
        vec3 cx = texture2D(tRockD, vOP.zy).rgb, cy = texture2D(tRockD, vOP.xz).rgb, cz = texture2D(tRockD, vOP.xy).rgb;
        vec2 nx = texture2D(tRockN, vOP.zy).xy * 2.0 - 1.0, ny = texture2D(tRockN, vOP.xz).xy * 2.0 - 1.0, nz = texture2D(tRockN, vOP.xy).xy * 2.0 - 1.0;
        vec3 c = cx * rbw.x + cy * rbw.y + cz * rbw.z;
        rockC = mix(vec3(dot(c, ${LUM}) / max(dot(uMean, ${LUM}), 1e-3)), c / max(uMean, vec3(1e-3)), 0.3);
        rockN = vec3(0.0, nx.y, nx.x) * sign(vON.x) * rbw.x + vec3(ny.x, 0.0, ny.y) * rbw.y + vec3(nz.x, nz.y, 0.0) * sign(vON.z) * rbw.z;
      }
      diffuseColor.rgb *= rockC;`,
    ).replace(
      '#include <normal_fragment_maps>',
      `if (uRockOn > 0.5) {
        vec3 on = normalize(vON) + rockN * 1.3;
        vec3 vn = normalize(on.x * vAX + on.y * vAY + on.z * vAZ);
        normal = vn * faceDirection;
      }`,
    );
  });
  loadSet('rock', ['diff', 'nor'], capSize(q.texSize, '1k')).then((s) => {
    if (!s.diff || !s.nor) return;
    const m = meanColor(s.diff);
    u.uMean.value.set(m.r, m.g, m.b);
    u.tRockD.value = s.diff;
    u.tRockN.value = s.nor;
    u.uRockOn.value = 1;
  });
}

/** Painted-metal panel normals + roughness for the escape pods. */
export function applyMetal(mats: THREE.MeshStandardMaterial[], q: Quality, repeat = 2) {
  loadSet('metal', ['nor', 'arm'], capSize(q.texSize, '1k')).then((s) => {
    for (const mat of mats) {
      if (s.nor) {
        const n = s.nor.clone(); n.repeat.setScalar(repeat); n.needsUpdate = true;
        mat.normalMap = n; mat.normalScale.setScalar(1.0);
      }
      if (s.arm) {
        const a = s.arm.clone(); a.repeat.setScalar(repeat); a.needsUpdate = true;
        mat.roughnessMap = a; mat.metalnessMap = a;
      }
      mat.needsUpdate = true;
    }
  });
}
