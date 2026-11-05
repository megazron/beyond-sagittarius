import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import type { Quality } from '../core/quality';
import { Terrain, WORLD_SIZE } from './terrain';
import { windUniforms } from './forest';

/**
 * GPU grass field that wraps around the player (toroidal offset), sampling
 * the terrain heightmap texture in the vertex shader. Blades never move in
 * world space, the field just follows you.
 */
export function createGrass(terrain: Terrain, q: Quality) {
  const R = q.grassRadius;
  const blade = new THREE.BufferGeometry();
  // 2-segment tapered blade, 5 vertices
  const w = 0.045, h = 0.8;
  blade.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -w, 0, 0, w, 0, 0, -w * 0.6, h * 0.5, 0, w * 0.6, h * 0.5, 0, 0, h, 0,
  ]), 3));
  blade.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0.3, 0, 1, 0.3, 0, 1, 0.3, 0, 1, 0.3, 0, 1, 0.3]), 3));
  blade.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 0.5, 1, 0.5, 0.5, 1]), 2));
  blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);

  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.attributes.position = blade.attributes.position;
  geo.attributes.normal = blade.attributes.normal;
  geo.attributes.uv = blade.attributes.uv;
  const N = q.grassCount;
  const off = new Float32Array(N * 4);
  const rnd = mulberry32(5);
  for (let i = 0; i < N; i++) {
    off[i * 4] = (rnd() * 2 - 1) * R;
    off[i * 4 + 1] = (rnd() * 2 - 1) * R;
    off[i * 4 + 2] = rnd() * Math.PI * 2;
    off[i * 4 + 3] = rnd();
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 4));
  geo.instanceCount = N;

  const uniforms = {
    uCenter: { value: new THREE.Vector2() },
    uHeight: { value: terrain.heightTex },
    uWorld: { value: WORLD_SIZE },
    uRadius: { value: R },
    uRes: { value: terrain.res },
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, side: THREE.DoubleSide, vertexColors: false });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, { uTime: windUniforms.uTime, uWind: windUniforms.uWind });
    sh.vertexShader = /* glsl */ `
      attribute vec4 aOffset;
      uniform vec2 uCenter; uniform sampler2D uHeight; uniform float uWorld, uRadius, uTime, uWind, uRes;
      varying float vTip; varying float vVar;
      float th(vec2 p){ return texture2D(uHeight, ((p + uWorld * 0.5) / uWorld * (uRes - 1.0) + 0.5) / uRes).r; }
      float gh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    ` + sh.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
      vec2 span = vec2(uRadius * 2.0);
      vec2 local = aOffset.xy;
      vec2 wp = local + floor((uCenter - local) / span + 0.5) * span;
      float hgt = th(wp);
      float hx = th(wp + vec2(1.5, 0.0)) - th(wp - vec2(1.5, 0.0));
      float hz = th(wp + vec2(0.0, 1.5)) - th(wp - vec2(0.0, 1.5));
      float slope = length(vec2(hx, hz)) / 3.0;
      float patchK = gh(floor(wp * 0.12)) * 0.4 + 0.6 * (0.5 + 0.5 * sin(wp.x * 0.07 + sin(wp.y * 0.05) * 2.0));
      float dist = length(wp - uCenter) / uRadius;
      float s = (0.55 + aOffset.w * 0.9) * smoothstep(0.6, 1.4, hgt) * (1.0 - smoothstep(0.35, 0.6, slope)) * smoothstep(1.0, 0.75, dist) * smoothstep(0.15, 0.45, patchK);
      vec3 transformed = vec3(position);
      transformed.y *= s;
      transformed.x *= 0.6 + s * 0.6;
      float ca = cos(aOffset.z), sa = sin(aOffset.z);
      transformed.xz = mat2(ca, -sa, sa, ca) * transformed.xz;
      float bendK = position.y * position.y;
      float gust = sin(uTime * 1.7 + wp.x * 0.15 + wp.y * 0.11) * 0.5 + sin(uTime * 3.1 + wp.x * 0.4) * 0.15;
      transformed.x += (gust * 0.35 + 0.12) * bendK * uWind * s;
      transformed.z += cos(uTime * 1.3 + wp.y * 0.13) * 0.18 * bendK * uWind * s;
      transformed.xz += wp;
      transformed.y += hgt - 0.05;
      vTip = position.y;
      vVar = aOffset.w;
      `,
    );
    sh.fragmentShader = 'varying float vTip; varying float vVar;\n' + sh.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n      normal = normalize(vNormal);',
    ).replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
      vec3 base = mix(vec3(0.035, 0.12, 0.1), vec3(0.08, 0.06, 0.15), smoothstep(0.55, 0.9, vVar));
      vec3 tip = mix(vec3(0.2, 0.46, 0.36), vec3(0.36, 0.28, 0.55), smoothstep(0.55, 0.9, vVar));
      diffuseColor.rgb = mix(base, tip, vTip);`,
    ).replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(0.05, 0.35, 0.3) * pow(vTip, 6.0) * step(0.8, vVar) * 0.8;`,
    );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return {
    mesh,
    update(center: THREE.Vector3) { uniforms.uCenter.value.set(center.x, center.z); },
  };
}
