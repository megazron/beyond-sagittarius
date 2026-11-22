import * as THREE from 'three';
import { nearFade } from './nearfade';
import { fitCanvasText } from './canvastext';

/**
 * Things that change all the time without a draw call or a texture upload of their own. A street of ad screens that
 * each redrew their canvas every few seconds, holograms that each turned and flickered by their own material, puffs of
 * steam that were a sprite and a material each: at the spaceport gate a hundred and more distinct materials a frame,
 * a program switch and a full uniform upload for each. Here every frame a thing can show is painted once into an
 * atlas, and what it shows when, how it turns and how bright it is comes from the vertex (its own phase and centre)
 * and one shared clock, in the shader. The meshes then never change: they merge and batch like any other.
 */

/** Seconds, shared by every material here: the stage sets it each frame (`tickCycles`). */
export const CLOCK = { value: 0 };
export function tickCycles(t: number) { CLOCK.value = t; }

/** `n` frames of `w` x `h`, painted once into one canvas texture of `cols` columns. */
export function cycleAtlas(n: number, w: number, h: number, paint: (g: CanvasRenderingContext2D, i: number) => void, maxW = 2048) {
  const cols = Math.max(1, Math.min(n, Math.floor(maxW / w))), rows = Math.ceil(n / cols);
  const c = document.createElement('canvas'); c.width = cols * w; c.height = rows * h;
  const g = c.getContext('2d')!;
  for (let i = 0; i < n; i++) {
    const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
    fitCanvasText(tmp.getContext('2d')!, (g2) => paint(g2, i)); // every text kept on its frame
    g.drawImage(tmp, (i % cols) * w, Math.floor(i / cols) * h);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { texture: t, cols, rows, n };
}

/** Constant per-vertex attributes on a copy of `g` (unindexed). */
export function stamp(g: THREE.BufferGeometry, attrs: Record<string, number[]>) {
  const h = g.index ? g.toNonIndexed() : g.clone();
  const n = h.attributes.position.count;
  for (const [name, v] of Object.entries(attrs)) { const a = new Float32Array(n * v.length); for (let i = 0; i < n; i++) a.set(v, i * v.length); h.setAttribute(name, new THREE.BufferAttribute(a, v.length)); }
  return h;
}

const KEY = (k: string) => () => `cycle|${k}|nearfade`;

/**
 * Screens that cycle through the atlas's frames: a vertex's `aCycle` = (first frame, seconds a frame). The mesh's uvs
 * are those of one whole frame (0..1).
 */
export function cycleMaterial(at: ReturnType<typeof cycleAtlas>, params: THREE.MeshBasicMaterialParameters) {
  const m = new THREE.MeshBasicMaterial({ ...params, map: at.texture });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uClock = CLOCK;
    sh.vertexShader = `attribute vec2 aCycle; uniform float uClock;\n` + sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      { float k = mod(floor(uClock / aCycle.y) + aCycle.x, ${at.n.toFixed(1)});
        vec2 cell = vec2(mod(k, ${at.cols.toFixed(1)}), ${(at.rows - 1).toFixed(1)} - floor(k / ${at.cols.toFixed(1)}));
        vMapUv = (uv + cell) / vec2(${at.cols.toFixed(1)}, ${at.rows.toFixed(1)}); }`);
    nearFade(m, sh);
  };
  m.customProgramCacheKey = KEY(`screen${at.n}x${at.cols}`);
  return m;
}

/**
 * Holograms: an additive face that turns about its own upright (`aHolo` = centre x, z, and a seed) and flickers, each
 * by its seed. Its uvs point at its own place in an atlas already.
 */
export function holoMaterial(map: THREE.Texture, k: number) {
  const m = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(k, k, k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uClock = CLOCK;
    sh.vertexShader = `attribute vec3 aHolo; uniform float uClock; varying float vFlick;\n` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { float t = uClock, i = aHolo.z, a = sin(t * 0.4 + i) * 0.5, c = cos(a), s = sin(a);
        vec2 d = transformed.xz - aHolo.xy;
        transformed.xz = aHolo.xy + vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
        vFlick = 0.75 + 0.25 * sin(t * 23.0 + i * 7.0) * (sin(t * 0.7 + i) > 0.9 ? 1.0 : 0.1); }`);
    sh.fragmentShader = `varying float vFlick;\n` + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vFlick;');
    nearFade(m, sh);
  };
  m.customProgramCacheKey = KEY('holo');
  return m;
}

/**
 * Puffs of steam rising from a few spots, one draw: each puff a camera-facing quad (`aPuff` = base x, y, z, phase),
 * rising, swelling and fading by the clock.
 */
export function steamPuffs(bases: THREE.Vector3[], perBase: number, map: THREE.Texture) {
  const n = bases.length * perBase, pos = new Float32Array(n * 12), puff = new Float32Array(n * 16), uv = new Float32Array(n * 8), idx: number[] = [];
  const C = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  let q = 0;
  for (const b of bases) for (let i = 0; i < perBase; i++, q++) {
    for (let v = 0; v < 4; v++) {
      pos.set([C[v][0], C[v][1], 0], (q * 4 + v) * 3); uv.set([C[v][0] + 0.5, C[v][1] + 0.5], (q * 4 + v) * 2);
      puff.set([b.x, b.y, b.z, i / perBase], (q * 4 + v) * 4);
    }
    idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aPuff', new THREE.BufferAttribute(puff, 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere().setFromPoints(bases); g.boundingSphere.radius += 3;
  const m = new THREE.ShaderMaterial({
    uniforms: { uClock: CLOCK, map: { value: map } }, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `attribute vec4 aPuff; uniform float uClock; varying vec2 vUv; varying float vA;
      void main() {
        float t = uClock, p = aPuff.w, k = fract(t * 0.25 + p);
        vec3 c = vec3(aPuff.x + sin(t + p * 9.0) * 0.15 * k, aPuff.y + k * 1.6, aPuff.z);
        vec4 mv = modelViewMatrix * vec4(c, 1.0);
        mv.xy += position.xy * (0.3 + k * 0.9);
        vUv = uv; vA = 0.45 * (1.0 - k);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `uniform sampler2D map; varying vec2 vUv; varying float vA;
      void main() { vec4 c = texture2D(map, vUv); gl_FragColor = vec4(c.rgb, c.a * vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.userData.ground = false;
  return mesh;
}
