import * as THREE from 'three';

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

function mats() {
  if (flameMat) return;
  flameMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime },
    // each quad: its foot at aC (object space), its corner aQ (x -0.5..0.5, y 0..1), its seed, width, height, rate
    vertexShader: `attribute vec3 aC; attribute vec2 aQ; attribute vec4 aS; uniform float uTime; varying vec2 vQ; varying float vSeed;
      void main() {
        vQ = aQ; vSeed = aS.x;
        vec3 c = (modelMatrix * vec4(aC, 1.0)).xyz;
        float sx = length(modelMatrix[0].xyz), sy = length(modelMatrix[1].xyz);
        vec3 d = cameraPosition - c; d.y = 0.0; d = length(d) > 1e-4 ? normalize(d) : vec3(0.0, 0.0, 1.0);
        vec3 r = vec3(d.z, 0.0, -d.x);
        // the tongue sways more at its tip, at its own rate
        float sway = (sin(uTime * (2.3 + aS.w) + aS.x * 17.0) * 0.6 + sin(uTime * 5.1 + aS.x * 5.0) * 0.4) * 0.07 * aQ.y * aQ.y;
        vec3 p = c + r * (aQ.x * aS.y + sway) * sx + vec3(0.0, aQ.y * aS.z * sy, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform float uTime; varying vec2 vQ; varying float vSeed; ${NOISE}
      void main() {
        float y = vQ.y, x = vQ.x;
        // noise rising through the tongue, faster higher up; a second, slower layer bends it sideways
        float n = fbm(vec2(x * 3.2 + vSeed * 7.0, y * 2.6 - uTime * 2.4 - vSeed * 3.0));
        float bend = (fbm(vec2(vSeed * 3.0, y * 1.3 - uTime * 0.9)) - 0.5) * 0.35 * y;
        float hw = 0.34 * pow(max(1.0 - y, 0.0), 0.6) * (0.75 + 0.5 * n) + 0.015;
        float body = 1.0 - abs(x - bend) / hw;
        // ragged at the top: the noise eats the upper tongue and leaves flecks that break away
        body -= smoothstep(0.3, 1.0, y) * (1.0 - n) * 1.35;
        float a = smoothstep(0.0, 0.3, body) * smoothstep(0.0, 0.06, y);
        if (a < 0.003) discard;
        // hot near the base and in the middle, dull red at the edges and the tips (lit linear values, the output pass tone maps; s5 GPU take: at 3.4 and 0.9 the layered tongues, and the camp's two fires on one spot, added up to one flat white-yellow mass)
        float heat = clamp(body * 1.3 - y * 0.7 + (n - 0.5) * 0.4, 0.0, 1.0);
        vec3 col = mix(vec3(0.45, 0.04, 0.01), vec3(1.5, 0.4, 0.06), smoothstep(0.0, 0.4, heat));
        col = mix(col, vec3(2.1, 1.25, 0.5), smoothstep(0.55, 0.95, heat));
        gl_FragColor = vec4(col, a * 0.6);
      }`,
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

/** size 1 is a camp fire about 0.9 m tall; tongues: how many flame quads; light: [colour, distance, decay] or null. */
export function makeFire(o: { size?: number; tongues?: number; embers?: number; light?: [number, number, number] | null; seed?: number } = {}): Fire {
  mats();
  const size = o.size ?? 1, nT = o.tongues ?? 7, nE = o.embers ?? 36;
  let s = (o.seed ?? 1) * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const group = new THREE.Group();
  // the tongues: one tall core, the rest round it, shorter towards the edge
  const C: number[] = [], Q: number[] = [], S: number[] = [], I: number[] = [];
  for (let i = 0; i < nT; i++) {
    const a = i * 2.39996 + rnd(), r = i === 0 ? 0 : 0.07 + rnd() * 0.13;
    const w = (i === 0 ? 0.5 : 0.26 + rnd() * 0.16) * size, h = (i === 0 ? 0.95 : 0.45 + rnd() * 0.35) * size;
    const cx = Math.cos(a) * r * size, cz = Math.sin(a) * r * size, seed = rnd(), rate = rnd() * 2;
    const b = i * 4;
    for (const [qx, qy] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) { C.push(cx, 0.04, cz); Q.push(qx, qy); S.push(seed, w, h, rate); }
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aC', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aQ', new THREE.Float32BufferAttribute(Q, 2));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(S, 4));
  g.setIndex(I);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5 * size, 0), 1.2 * size);
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
      const on = k > 0.001;
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
