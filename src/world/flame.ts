import * as THREE from 'three';
import { heatAt } from '../core/heat';

/**
 * A fire that reads as fire up close (owner: "pale blocky cones"): flame tongues drawn by a noise shader on quads that
 * turn round the vertical to face the camera, each with its own seed so the tongues lick and break off at the top; a
 * bed of glowing coals that breathes; embers that rise, drift and wink out (all moved on the GPU, no per-frame upload);
 * and a light that flickers by a sum of unrelated rates and moves a few centimetres so the shadows round it dance.
 * One shader program each for the flames, the coals and the embers, shared by every fire (the story's camp fire, the
 * fight's fires), made once. The light is made with the fire and never added later (a light added mid-game recompiles
 * every material).
 */

const NOISE = `
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }`;

const uTime = { value: 0 };
let flameMat: THREE.ShaderMaterial | null = null, coalMat: THREE.ShaderMaterial | null = null, emberMat: THREE.ShaderMaterial | null = null;
let lite = false;
/** Phones: one octave less of noise in the flames (the flames are the costliest pixels of a fire). */
export function setFireLite(on: boolean) {
  lite = on;
  if (flameMat) { if (on) flameMat.defines.LITE = 1; else delete flameMat.defines.LITE; flameMat.needsUpdate = true; }
}

// The s5 GPU take (owner): "the core reads as a bright triangle inside the teepee, the flames do not rise above the
// sticks". Why: one wide core quad in the middle plus seven tongues round it added up to one flat white-yellow wedge
// at the base, and the noise ate every tongue's upper half, so nothing showed above 0.55 m. Now three kinds of layer,
// all soft and additive, none of them white: a low wide glow that gives the fire a body (dim, no edges), tongues on a
// ring round the middle (none in the very middle) that rise and fall at their own rates, and thin licks that reach
// past the sticks and tear off at the top. The heat colour follows the noise, so the base is broken up, not a block.
const FLAME_VS = `attribute vec3 aC; attribute vec2 aQ; attribute vec4 aS; attribute vec2 aK; uniform float uTime;
  varying vec2 vQ; varying float vSeed; varying vec2 vK;
  void main() {
    vQ = aQ; vSeed = aS.x; vK = aK;
    vec3 c = (modelMatrix * vec4(aC, 1.0)).xyz;
    float sx = length(modelMatrix[0].xyz), sy = length(modelMatrix[1].xyz);
    vec3 d = cameraPosition - c; d.y = 0.0; d = length(d) > 1e-4 ? normalize(d) : vec3(0.0, 0.0, 1.0);
    vec3 r = vec3(d.z, 0.0, -d.x);
    // each tongue leaps and sinks at its own rate (a fire's tongues never stand at one height)
    float leap = 0.78 + 0.22 * sin(uTime * (3.1 + aS.w * 2.0) + aS.x * 23.0) + 0.1 * sin(uTime * (7.3 + aS.w) + aS.x * 9.0);
    float h = aS.z * mix(1.0, leap, aK.y);
    // and sways more at its tip
    float sway = (sin(uTime * (2.3 + aS.w) + aS.x * 17.0) * 0.6 + sin(uTime * 5.1 + aS.x * 5.0) * 0.4) * 0.06 * aQ.y * aQ.y * aK.y;
    vec3 p = c + r * (aQ.x * aS.y + sway) * sx + vec3(0.0, aQ.y * h * sy, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const FLAME_FS = `uniform float uTime; varying vec2 vQ; varying float vSeed; varying vec2 vK;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fb(vec2 p) { float s = 0.5 * vn(p); p = p * 2.03 + vec2(1.7, 9.2); s += 0.25 * vn(p);
  #ifndef LITE
    p = p * 2.03 + vec2(1.7, 9.2); s += 0.125 * vn(p); s *= 1.14;
  #else
    s *= 1.33;
  #endif
    return s; }
  void main() {
    float y = vQ.y, x = vQ.x, t = uTime, kind = vK.x;
    // turbulence rising through the flame, faster higher up; it bends the tongue more the higher it goes
    float n1 = fb(vec2(x * 2.4 + vSeed * 11.0, y * 1.9 - t * 2.7 - vSeed * 3.0));
    float n2 = vn(vec2(x * 6.0 - vSeed * 5.0, y * 5.0 - t * 5.6));
    float xw = x + ((n1 - 0.5) * 0.5 + (n2 - 0.5) * 0.14) * y;
    // the profile: round at the foot, drawn to a point; the glow layer is a soft round body
    float foot = sqrt(clamp(y / 0.14, 0.0, 1.0));
    float hw = kind < 0.5 ? 0.46 * foot * pow(max(1.0 - y, 0.0), 0.5) : 0.42 * foot * pow(max(1.0 - y, 0.0), 0.62) + 0.004;
    float body = 1.0 - abs(xw) / max(hw, 1e-3);
    // the top tears into separate licks and flecks that break away (less on the glow, which has no edge)
    float tear = n2 * 0.55 + n1 * 0.45;
    body -= smoothstep(0.35, 1.0, y) * (1.0 - tear) * (kind < 0.5 ? 0.5 : 1.25);
    float a = kind < 0.5 ? smoothstep(0.0, 0.9, body) : smoothstep(0.0, 0.3, body);
    a *= smoothstep(0.0, 0.08, y);
    // (low down every tongue overlaps every other: there they are thinner, so the overlap is not one bright mass; s6 take)
    if (kind > 0.5) a *= 0.55 + 0.45 * smoothstep(0.08, 0.4, y);
    // inside the sticks (about the lower 40 % of a tongue, the teepee's 0.6 m) the fire is a bed of embers: dim, deep
    // orange and red; the flame is brightest above the wood (s6c take, release review: the foot was still a
    // white-yellow mass, every tongue's hottest part overlapping there)
    float low = 1.0 - smoothstep(0.1, 0.42, y);
    if (kind > 0.5) a *= 1.0 - 0.55 * low;
    if (a < 0.004) discard;
    // heat: hottest low in the middle of a tongue, broken by the noise (no even block of colour), cooling to red at
    // the edges and the tips. Never white: the brightest is a deep yellow (the tone map and the bloom do the rest)
    // (the foot, among the fuel, is a little cooler than a hand's breadth up: the brightest is low but not on the coals;
    // the glow layer never gets past orange. s6 first take: still a yellow-white wedge inside the teepee)
    float heat = clamp(body * 1.1 - y * 0.62 + (n1 - 0.5) * 0.75 + 0.08 - 0.25 * (1.0 - smoothstep(0.0, 0.16, y)), 0.0, 1.0) * (kind < 0.5 ? 0.38 : 1.0);
    heat *= 1.0 - 0.7 * low; // the ember bed: never past orange in among the wood
    vec3 col = mix(vec3(0.38, 0.03, 0.005), vec3(1.35, 0.36, 0.05), smoothstep(0.05, 0.45, heat));
    col = mix(col, vec3(1.7, 0.95, 0.26), smoothstep(0.6, 1.0, heat) * (1.0 - low));
    gl_FragColor = vec4(col, a * vK.y);
  }`;

function mats() {
  if (flameMat) return;
  flameMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime }, defines: lite ? { LITE: 1 } : {},
    // each quad: its foot at aC (object space), its corner aQ (x -0.5..0.5, y 0..1), its seed, width, height, rate;
    // aK: kind (0 glow, 1 tongue or lick) and its strength
    vertexShader: FLAME_VS, fragmentShader: FLAME_FS,
  });
  coalMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2,
    uniforms: { uTime, uK: { value: 1 } },
    vertexShader: `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime, uK; varying vec2 vP; ${NOISE}
      void main() {
        float r = length(vP) / 0.42; if (r > 1.0) discard;
        // cracked coals: bright seams that breathe, dark crust between
        float n = fbm(vP * 9.0 + vec2(uTime * 0.15, -uTime * 0.11));
        float seam = smoothstep(0.42, 0.62, n) * (0.6 + 0.4 * sin(uTime * 2.1 + n * 12.0));
        float a = (1.0 - smoothstep(0.55, 1.0, r)) * uK;
        vec3 col = vec3(1.6, 0.32, 0.04) * (0.25 + seam * 1.6);
        gl_FragColor = vec4(col, a);
      }`,
  });
  emberMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime, uScale: { value: 600 }, uK: { value: 1 } },
    vertexShader: `attribute vec4 aS; uniform float uTime, uScale, uK; varying float vA; varying float vHot;
      void main() {
        float life = fract(uTime * (0.22 + aS.y * 0.25) + aS.x);
        float a = aS.x * 40.0 + uTime * (0.4 + aS.z);
        float up = life * (1.6 + aS.w * 2.4);
        // rising in the fire's draught, swirling wider as they climb, a little blown
        vec3 p = vec3(cos(a) * (0.08 + life * 0.45), 0.25 + up, sin(a) * (0.08 + life * 0.45));
        p.x += sin(uTime * 1.7 + aS.x * 9.0) * 0.12 * life;
        vec4 mv = modelViewMatrix * vec4(p * vec3(1.0, uK, 1.0), 1.0);
        gl_Position = projectionMatrix * mv;
        // they wink: each brightens and dims at its own rate, and fades as it cools
        vA = (1.0 - life) * smoothstep(0.0, 0.05, life) * (0.55 + 0.45 * sin(uTime * (7.0 + aS.w * 9.0) + aS.x * 30.0)) * step(0.05, uK);
        vHot = 1.0 - life;
        gl_PointSize = clamp(0.035 * uScale / max(0.3, -mv.z), 1.0, 6.0);
      }`,
    fragmentShader: `varying float vA; varying float vHot;
      void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d) * vA; if (a < 0.01) discard;
        gl_FragColor = vec4(mix(vec3(2.0, 0.35, 0.05), vec3(5.0, 2.6, 0.8), vHot), a); }`,
  });
}

export interface Fire {
  group: THREE.Group;
  light: THREE.PointLight | null;
  /** k: how much is burning, 0 (out) to 1; base: the light's intensity at k 1. (Every fire runs on one wall clock: the
   * story and the fight keep different clocks, and the tongues share one time uniform.) */
  update(k: number, base: number): void;
}

/** Where the fires that do not give way burned last (the camp's own fire gives way to the fight's camp fire on the same
 * spot: the two added up to one white mass, s5 take). */
const leading: { pos: THREE.Vector3; at: number }[] = [];
const wp = new THREE.Vector3();

/** size 1 is a camp fire about 0.9 m tall; tongues: how many flame quads; light: [colour, distance, decay] or null;
 * defer: draw nothing while another fire burns within 0.6 m of it. */
export function makeFire(o: { size?: number; tongues?: number; embers?: number; light?: [number, number, number] | null; seed?: number; defer?: boolean } = {}): Fire {
  mats();
  const size = o.size ?? 1, nT = o.tongues ?? 7, nE = o.embers ?? 36;
  let s = (o.seed ?? 1) * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const group = new THREE.Group();
  // the layers (see FLAME_FS): two low glows, the tongues on a ring round the middle, thin licks that reach highest
  const C: number[] = [], Q: number[] = [], S: number[] = [], K: number[] = [], I: number[] = [];
  const quad = (cx: number, cz: number, w: number, h: number, kind: number, k: number) => {
    const b = C.length / 3, seed = rnd(), rate = rnd() * 2;
    for (const [qx, qy] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) { C.push(cx, 0.04, cz); Q.push(qx, qy); S.push(seed, w, h, rate); K.push(kind, k); }
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  for (let i = 0; i < 2; i++) quad((rnd() - 0.5) * 0.06 * size, (rnd() - 0.5) * 0.06 * size, (0.75 + 0.15 * i) * size, (0.6 + 0.15 * i) * size, 0, 0.17);
  for (let i = 0; i < nT; i++) {
    const a = i * 2.39996 + rnd(), r = (0.06 + rnd() * 0.12) * size;
    quad(Math.cos(a) * r, Math.sin(a) * r, (0.3 + rnd() * 0.12) * size, (0.85 + rnd() * 0.4) * size, 1, 0.38);
  }
  for (let i = 0, n = Math.ceil(nT * 0.6); i < n; i++) {
    const a = i * 2.39996 + 1.1 + rnd(), r = (0.02 + rnd() * 0.1) * size;
    quad(Math.cos(a) * r, Math.sin(a) * r, (0.16 + rnd() * 0.06) * size, (1.15 + rnd() * 0.45) * size, 1, 0.55);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aC', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aQ', new THREE.Float32BufferAttribute(Q, 2));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(S, 4));
  g.setAttribute('aK', new THREE.Float32BufferAttribute(K, 2));
  g.setIndex(I);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7 * size, 0), 1.3 * size);
  const flames = new THREE.Group();
  const tongues = new THREE.Mesh(g, flameMat!); tongues.renderOrder = 5; flames.add(tongues);
  group.add(flames);
  // the coal bed (its own material instance: its glow follows the fuel; the program is shared)
  const cm = coalMat!.clone(); cm.uniforms.uTime = uTime;
  const coals = new THREE.Mesh(new THREE.CircleGeometry(0.42 * size, 20), cm);
  coals.rotation.x = -Math.PI / 2; coals.position.y = 0.035; coals.renderOrder = 4;
  group.add(coals);
  // embers
  let embers: THREE.Points | null = null; let em: THREE.ShaderMaterial | null = null;
  if (nE > 0) {
    const eg = new THREE.BufferGeometry(), es: number[] = [], ep: number[] = [];
    for (let i = 0; i < nE; i++) { es.push(rnd(), rnd(), rnd(), rnd()); ep.push(0, 0.5, 0); }
    eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
    eg.setAttribute('aS', new THREE.Float32BufferAttribute(es, 4));
    eg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), 3);
    em = emberMat!.clone(); em.uniforms.uTime = uTime;
    embers = new THREE.Points(eg, em); embers.renderOrder = 5; embers.scale.setScalar(size);
    group.add(embers);
  }
  let light: THREE.PointLight | null = null;
  if (o.light) { light = new THREE.PointLight(o.light[0], 0, o.light[1], o.light[2]); light.position.y = 0.9 * size; group.add(light); }
  const ly = 0.9 * size;
  return {
    group, light,
    update(k, base) {
      const t = (performance.now() / 1000) % 3600;
      uTime.value = t;
      let on = k > 0.001;
      group.getWorldPosition(wp);
      const now = performance.now();
      if (o.defer) { if (leading.some((q) => now - q.at < 300 && q.pos.distanceToSquared(wp) < 0.36)) { on = false; k = 0; } }
      else if (on) { const q = leading.find((q) => q.pos.distanceToSquared(wp) < 0.36); if (q) { q.at = now; q.pos.copy(wp); } else { for (let i = leading.length - 1; i >= 0; i--) if (now - leading[i].at > 2000) leading.splice(i, 1); leading.push({ pos: wp.clone(), at: now }); } }
      // the hot air over it (the renderer bends the picture there; core/heat.ts)
      if (on && group.visible) heatAt(wp, size, k);
      flames.visible = on; coals.visible = on || k > 0;
      // the flames grow with the fuel; they never shrink to nothing while it burns
      flames.scale.set(0.55 + 0.45 * k, 0.4 + 0.6 * k, 0.55 + 0.45 * k);
      (cm.uniforms.uK as { value: number }).value = Math.min(1, 0.35 + k);
      if (embers && em) { embers.visible = on; (em.uniforms.uK as { value: number }).value = k; }
      if (light) {
        // flicker: three unrelated rates and a slow breath, never a clean sine; the source moves a little with the tongues
        const f = 0.82 + 0.08 * Math.sin(t * 11.3) + 0.06 * Math.sin(t * 23.7 + 1.3) + 0.05 * Math.sin(t * 4.1 + 0.4) + 0.04 * Math.sin(t * 37.1);
        light.intensity = on ? base * Math.sqrt(k) * f : 0;
        light.position.set(Math.sin(t * 5.3) * 0.04 * size, ly * (0.6 + 0.4 * k) + Math.sin(t * 7.9) * 0.05 * size, Math.cos(t * 4.7) * 0.04 * size);
      }
    },
  };
}
