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
  // one instance = a tuft of thin, curved 3-segment blades
  const blades = q.grassBlades, pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const rb = mulberry32(11);
  for (let k = 0; k < blades; k++) {
    const a = rb() * Math.PI * 2, ox = (rb() - 0.5) * 0.26, oz = (rb() - 0.5) * 0.26;
    const h = 0.34 + rb() * 0.34, w = 0.012 + rb() * 0.012, lean = 0.12 + rb() * 0.3;
    const ca = Math.cos(a), sa = Math.sin(a), base = pos.length / 3;
    // three segments with one shared tip vertex: 7 vertices, 5 triangles a blade
    for (let r = 0; r <= 3; r++) {
      const t = r / 3, ww = w * (1 - t * 0.7);
      const fw = lean * t * t * h; // curve outwards
      const cx = ox + ca * fw, cz = oz + sa * fw, y = h * (t - lean * 0.2 * t * t);
      if (r === 3) { pos.push(cx, y, cz); nor.push(0, 1, 0); uv.push(0.5, t); continue; }
      pos.push(cx - sa * ww, y, cz + ca * ww, cx + sa * ww, y, cz - ca * ww);
      nor.push(0, 1, 0, 0, 1, 0);
      uv.push(0, t, 1, t);
    }
    for (let r = 0; r < 2; r++) { const i = base + r * 2; idx.push(i, i + 1, i + 2, i + 2, i + 1, i + 3); }
    idx.push(base + 4, base + 5, base + 6);
  }
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  blade.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  blade.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  blade.setIndex(idx);

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
    // trampled clearings (camp, crash sites): xz centre, radius
    uClear: { value: [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1)] },
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide, vertexColors: false });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, { uTime: windUniforms.uTime, uWind: windUniforms.uWind });
    sh.vertexShader = /* glsl */ `
      attribute vec4 aOffset;
      uniform vec2 uCenter; uniform sampler2D uHeight; uniform float uWorld, uRadius, uTime, uWind, uRes; uniform vec3 uClear[4];
      varying float vTip; varying float vVar; varying float vPatch;
      float th(vec2 p){ return texture2D(uHeight, ((p + uWorld * 0.5) / uWorld * (uRes - 1.0) + 0.5) / uRes).r; }
      float gh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    ` + sh.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
      vec2 span = vec2(uRadius * 2.0);
      vec2 local = aOffset.xy;
      vec2 wp = local + floor((uCenter - local) / span + 0.5) * span;
      float hgt = th(wp);
      float hx = th(wp + vec2(2.0, 0.0)) - hgt;
      float hz = th(wp + vec2(0.0, 2.0)) - hgt;
      float slope = length(vec2(hx, hz)) * 0.5;
      float patchK = gh(floor(wp * 0.12)) * 0.4 + 0.6 * (0.5 + 0.5 * sin(wp.x * 0.07 + sin(wp.y * 0.05) * 2.0));
      float dist = length(wp - uCenter) / uRadius;
      float s = (0.7 + aOffset.w * 0.75) * smoothstep(0.6, 1.4, hgt) * (1.0 - smoothstep(0.35, 0.6, slope)) * smoothstep(1.0, 0.75, dist) * smoothstep(0.15, 0.45, patchK);
      for (int i = 0; i < 4; i++) { float cr = uClear[i].z; if (cr > 0.0) s *= mix(0.15, 1.0, smoothstep(cr * 0.55, cr, length(wp - uClear[i].xy))); }
      vec3 transformed = vec3(position);
      transformed.y *= s;
      transformed.xz *= 0.8 + dist * 2.2; // far tufts widen so the field stays solid
      float ca = cos(aOffset.z), sa = sin(aOffset.z);
      transformed.xz = mat2(ca, -sa, sa, ca) * transformed.xz;
      float bendK = position.y * position.y * 2.4;
      float gust = sin(uTime * 1.7 + wp.x * 0.15 + wp.y * 0.11) * 0.5 + sin(uTime * 3.1 + wp.x * 0.4) * 0.15;
      transformed.x += (gust * 0.35 + 0.12) * bendK * uWind * s;
      transformed.z += cos(uTime * 1.3 + wp.y * 0.13) * 0.18 * bendK * uWind * s;
      transformed.xz += wp;
      transformed.y += hgt - 0.05;
      vTip = clamp(position.y / 0.6, 0.0, 1.0);
      vVar = aOffset.w;
      vPatch = patchK;
      `,
    );
    sh.fragmentShader = 'varying float vTip; varying float vVar; varying float vPatch;\n' + sh.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n      normal = normalize(mix(vNormal, vec3(viewMatrix[1].xyz), 0.6));',
    ).replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
      vec3 base = vec3(0.012, 0.03, 0.022);
      vec3 tip = mix(vec3(0.07, 0.15, 0.06), vec3(0.16, 0.19, 0.075), vPatch);
      tip = mix(tip, vec3(0.05, 0.14, 0.12), smoothstep(0.7, 0.95, vVar)); // blue-green alien strain
      diffuseColor.rgb = mix(base, tip, vTip);`,
    ).replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(0.03, 0.22, 0.2) * pow(vTip, 8.0) * step(0.93, vVar) * 0.5;`,
    );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return {
    mesh,
    update(center: THREE.Vector3) { uniforms.uCenter.value.set(center.x, center.z); },
    /** Up to four circles (x, z, radius) where the grass is trampled short. */
    setClearings(list: [number, number, number][]) {
      uniforms.uClear.value.forEach((v, i) => { const c = list[i]; if (c) v.set(c[0], c[1], c[2]); else v.set(0, 0, -1); });
    },
  };
}
