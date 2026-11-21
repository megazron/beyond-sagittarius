import * as THREE from 'three';
import { NOISE_GLSL } from '../core/glsl';
import { LAKE } from './heightfield';
import type { Terrain } from './terrain';

/**
 * Episode One 1.1: the two waters on the way down from the wake. A stream that runs downhill into the lake (moving,
 * cold, safe) and, twenty metres before it beside the path, a still pool with a green skin (the wrong one).
 * The stream is a ribbon laid on the ground by following the slope down; it shares the lake's sky and ripple
 * uniforms so it lights the same way.
 */
export interface StreamWater {
  group: THREE.Group;
  /** Centre line, top to mouth, one point a metre. */
  line: THREE.Vector3[];
  pool: { x: number; z: number; r: number; y: number };
  /** Distance on the ground from p to the stream's centre line, and the nearest point on it. */
  nearest(p: THREE.Vector3, out?: THREE.Vector3): number;
  inPool(x: number, z: number, pad?: number): boolean;
  /** Points along the stream for looping water sound. */
  soundAt: THREE.Vector3[];
}

const WIDTH = 1.5;
const rnd = (s: number) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export function createStream(T: Terrain, lakeUniforms: Record<string, THREE.IUniform>): StreamWater {
  const group = new THREE.Group(); group.name = 'e1-stream';
  // spawn at the origin; the walk down to the lake runs along this bearing
  const toLake = new THREE.Vector2(LAKE.x, LAKE.z).normalize();
  const side = new THREE.Vector2(-toLake.y, toLake.x);
  // the source: up the slope to the side of the path, halfway down
  const src = toLake.clone().multiplyScalar(48).addScaledVector(side, 38);
  const line: THREE.Vector3[] = [];
  let x = src.x, z = src.y, dx = toLake.x, dz = toLake.y;
  for (let i = 0; i < 260; i++) {
    const h = T.height(x, z);
    line.push(new THREE.Vector3(x, h, z));
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r - 9 || h < -0.6) break;
    // downhill, with a pull to the lake so a hollow cannot hold it, and a slow meander
    const e = 1.2;
    const gx = T.height(x + e, z) - T.height(x - e, z), gz = T.height(x, z + e) - T.height(x, z - e);
    const gl = Math.hypot(gx, gz) || 1;
    const lx = LAKE.x - x, lz = LAKE.z - z, ll = Math.hypot(lx, lz) || 1;
    const m = Math.sin(i * 0.13) * 0.35;
    let nx = -gx / gl * 0.9 + lx / ll * 0.75 + side.x * m, nz = -gz / gl * 0.9 + lz / ll * 0.75 + side.y * m;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    // water does not turn on a coin: keep most of the old heading
    dx = dx * 0.7 + nx * 0.3; dz = dz * 0.7 + nz * 0.3;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    x += dx; z += dz;
  }
  // a stream bed does not climb: each point is no higher than the one above it
  for (let i = 1; i < line.length; i++) line[i].y = Math.min(line[i].y, line[i - 1].y - 0.004);

  // ---- the ribbon ----
  const n = line.length, across = 7;
  const pos = new Float32Array(n * across * 3), uv = new Float32Array(n * across * 2), fast = new Float32Array(n * across);
  let along = 0;
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
    const rx = -tz / tl, rz = tx / tl;
    if (i > 0) along += line[i].distanceTo(line[i - 1]);
    const drop = i > 0 ? Math.max(0, line[i - 1].y - line[i].y) : 0;
    // wider near the mouth, narrow at the source
    const w = WIDTH * (0.45 + 0.55 * Math.min(1, i / 30)) * (1 + 0.18 * Math.sin(i * 0.31));
    for (let j = 0; j < across; j++) {
      const u = j / (across - 1), o = (u - 0.5) * w;
      const px = line[i].x + rx * o, pz = line[i].z + rz * o;
      // the surface is flat across, a little below the banks, never under the ground beneath it
      const y = Math.max(line[i].y - 0.05, T.height(px, pz) + 0.02);
      const k = (i * across + j) * 3;
      pos[k] = px; pos[k + 1] = y + 0.03; pos[k + 2] = pz;
      uv[(i * across + j) * 2] = (u - 0.5) * 2; uv[(i * across + j) * 2 + 1] = along;
      fast[i * across + j] = Math.min(1, drop * 6);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < across - 1; j++) {
    const a = i * across + j, b = a + 1, c = a + across, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aFast', new THREE.BufferAttribute(fast, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const U = lakeUniforms;
  const shared = { uTime: U.uTime, uSunDir: U.uSunDir, uSunColor: U.uSunColor, uZenith: U.uZenith, uHorizon: U.uHorizon, uDay: U.uDay, tWaterN: U.tWaterN, uHasN: U.uHasN, uEnv: U.uEnv, uHasEnv: U.uHasEnv };
  const skyFn = /* glsl */ `
    uniform vec3 uSunDir, uSunColor, uZenith, uHorizon;
    uniform float uTime, uDay, uHasN, uHasEnv;
    uniform sampler2D tWaterN;
    uniform samplerCube uEnv;
    vec3 skyCol(vec3 d){
      float y = max(d.y, 0.0);
      vec3 c = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.65, y), 0.65));
      c += uSunColor * pow(max(dot(d, uSunDir), 0.0), 10.0) * 0.4 * smoothstep(-0.1, 0.1, uSunDir.y);
      return c;
    }
    vec3 envCol(vec3 R){ R.y = abs(R.y); vec3 c = uHasEnv > 0.5 ? textureLod(uEnv, R, 1.0).rgb : skyCol(R); return c * mix(0.5, 1.0, smoothstep(0.0, 0.25, R.y)); }`;
  const vert = /* glsl */ `
    #include <fog_pars_vertex>
    attribute float aFast;
    varying vec3 vWP; varying vec2 vUv; varying float vFast;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWP = wp.xyz; vUv = uv; vFast = aFast;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    transparent: true, fog: true, depthWrite: false,
    vertexShader: vert,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      ${skyFn}
      ${NOISE_GLSL}
      varying vec3 vWP; varying vec2 vUv; varying float vFast;
      void main(){
        // flow runs along v: ripples are carried down at about 0.9 m/s, faster where it drops
        float sp = 0.9 + vFast * 1.4;
        vec2 q = vec2(vUv.x, vUv.y - uTime * sp);
        vec2 gN = vec2(vnoise2(q * vec2(2.2, 1.1)) - 0.5, vnoise2(q * vec2(1.3, 2.6) + 7.0) - 0.5) * 0.5;
        if (uHasN > 0.5) {
          vec2 n1 = texture2D(tWaterN, q * vec2(0.55, 0.32)).xy * 2.0 - 1.0;
          vec2 n2 = texture2D(tWaterN, vec2(vUv.x * 1.1 + 0.3, vUv.y * 0.7 - uTime * sp * 1.3)).xy * 2.0 - 1.0;
          gN = gN * 0.4 + n1 * 0.28 + n2 * 0.18;
        }
        float edge = 1.0 - abs(vUv.x);
        vec3 V = normalize(cameraPosition - vWP);
        vec3 N = normalize(vec3(gN.x, 1.0, gN.y));
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 refl = envCol(reflect(-V, N));
        // clear, shallow: the bed shows through, darker in the middle where it is deeper
        vec3 body = mix(vec3(0.16, 0.13, 0.09), vec3(0.05, 0.08, 0.07), smoothstep(0.1, 0.9, edge)) * (0.2 + 0.8 * uDay);
        vec3 col = mix(body, refl, fres);
        vec3 H = normalize(uSunDir + V);
        col += uSunColor * pow(max(dot(N, H), 0.0), 300.0) * 6.0 * smoothstep(-0.05, 0.1, uSunDir.y);
        // white water where it drops and along the stones at the edges
        float fn = vnoise2(vec2(vUv.x * 4.0, vUv.y * 2.0 - uTime * sp * 1.6));
        float foam = smoothstep(0.62, 0.8, fn) * (vFast * 0.9 + smoothstep(0.35, 0.0, edge) * 0.5);
        col = mix(col, vec3(0.82, 0.86, 0.88) * (0.25 + 0.75 * uDay), clamp(foam, 0.0, 0.7));
        float alpha = clamp(0.55 + fres * 0.4 + foam * 0.4, 0.0, 0.95) * smoothstep(0.0, 0.25, edge);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, shared);
  const ribbon = new THREE.Mesh(geo, mat);
  ribbon.name = 'stream'; ribbon.renderOrder = 2; ribbon.receiveShadow = false;
  group.add(ribbon);

  // ---- the pool: still water with a green skin, beside the path before the stream ----
  const pc = toLake.clone().multiplyScalar(58).addScaledVector(side, -7);
  const R = 2.6;
  let rim = Infinity;
  for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; rim = Math.min(rim, T.height(pc.x + Math.cos(a) * R, pc.y + Math.sin(a) * R)); }
  const pool = { x: pc.x, z: pc.y, r: R, y: rim - 0.04 };
  const pg = new THREE.CircleGeometry(R * 1.12, 40, 0, Math.PI * 2);
  pg.rotateX(-Math.PI / 2);
  const pp = pg.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pp.count; i++) {
    const vx = pp.getX(i), vz = pp.getZ(i);
    // a ragged edge, and the skin rides up the mud where the ground is above the water
    const a = Math.atan2(vz, vx), rr = 1 + 0.16 * Math.sin(a * 3 + 1) + 0.1 * Math.sin(a * 7);
    pp.setX(i, vx * rr); pp.setZ(i, vz * rr);
    pp.setY(i, Math.max(pool.y, T.height(pool.x + vx * rr, pool.z + vz * rr) + 0.015) - pool.y);
  }
  pg.computeVertexNormals();
  const pmat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    transparent: true, fog: true, depthWrite: false,
    vertexShader: vert.replace('attribute float aFast;', '').replace('vFast = aFast;', 'vFast = 0.0;').replace('vUv = uv;', 'vUv = position.xz;'),
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      ${skyFn}
      ${NOISE_GLSL}
      varying vec3 vWP; varying vec2 vUv; varying float vFast;
      void main(){
        float d = length(vUv) / ${R.toFixed(2)};
        // duckweed and scum: big green rafts with a few dark open patches between them
        float s = vnoise2(vWP.xz * 1.3) * 0.6 + vnoise2(vWP.xz * 4.0) * 0.3 + vnoise2(vWP.xz * 13.0) * 0.1;
        float skin = smoothstep(0.32, 0.48, s + smoothstep(0.55, 1.05, d) * 0.4);
        vec3 V = normalize(cameraPosition - vWP);
        float fres = 0.02 + 0.98 * pow(1.0 - max(V.y, 0.0), 5.0);
        vec3 water = mix(vec3(0.03, 0.04, 0.025), envCol(reflect(-V, vec3(0.0, 1.0, 0.0))), fres);
        float sun = max(dot(vec3(0.0, 1.0, 0.0), uSunDir), 0.0);
        vec3 green = mix(vec3(0.16, 0.22, 0.05), vec3(0.3, 0.36, 0.08), vnoise2(vWP.xz * 7.0)) * (0.25 + 0.75 * sun) * (0.3 + 0.7 * uDay);
        vec3 col = mix(water, green, skin);
        // bubbles of rot
        col += vec3(0.25) * pow(vnoise2(vWP.xz * 30.0 + 3.0), 18.0) * skin;
        float alpha = (0.9) * (1.0 - smoothstep(0.98, 1.12, d));
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });
  Object.assign(pmat.uniforms, shared);
  const pm = new THREE.Mesh(pg, pmat);
  pm.position.set(pool.x, pool.y, pool.z); pm.name = 'pool'; pm.renderOrder = 2;
  group.add(pm);

  // ---- reeds: thicker towards the water, so following them is following the water ----
  const blade = new THREE.PlaneGeometry(0.05, 1, 1, 3);
  blade.translate(0, 0.5, 0);
  const bp = blade.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < bp.count; i++) { const y = bp.getY(i); bp.setX(i, bp.getX(i) * (1 - y * 0.85)); bp.setZ(i, y * y * 0.12); }
  blade.computeVertexNormals();
  const reedMat = new THREE.MeshStandardMaterial({ color: 0x6f7d3a, roughness: 0.85, side: THREE.DoubleSide });
  const COUNT = 900;
  const reeds = new THREE.InstancedMesh(blade, reedMat, COUNT);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e3 = new THREE.Euler(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  const col = new THREE.Color();
  let c = 0;
  for (let k = 0; c < COUNT && k < COUNT * 3; k++) {
    let px: number, pz: number;
    if (k % 6 === 5) {
      // round the pool too
      const a = rnd(k) * Math.PI * 2, d = R * (1.0 + rnd(k + 9) * 0.5);
      px = pool.x + Math.cos(a) * d; pz = pool.z + Math.sin(a) * d;
    } else {
      const i = Math.floor(rnd(k) * (n - 1)), L = line[i];
      const b = line[Math.min(n - 1, i + 1)], tx = b.x - L.x, tz = b.z - L.z, tl = Math.hypot(tx, tz) || 1;
      const sgn = rnd(k + 3) < 0.5 ? -1 : 1, off = WIDTH * 0.45 + Math.pow(rnd(k + 5), 2) * 3.2;
      px = L.x - tz / tl * off * sgn; pz = L.z + tx / tl * off * sgn;
    }
    const h = T.height(px, pz);
    if (h < -0.1) continue;
    const tall = 0.6 + rnd(k + 11) * 0.9;
    e3.set((rnd(k + 13) - 0.5) * 0.4, rnd(k + 17) * Math.PI * 2, (rnd(k + 19) - 0.5) * 0.4);
    m4.compose(p3.set(px, h - 0.02, pz), q4.setFromEuler(e3), s3.set(1, tall, 1));
    reeds.setMatrixAt(c, m4);
    reeds.setColorAt(c, col.setHSL(0.17 + rnd(k + 23) * 0.06, 0.4, 0.22 + rnd(k + 29) * 0.12));
    c++;
  }
  reeds.count = c;
  reeds.castShadow = false; reeds.receiveShadow = true;
  reeds.name = 'reeds';
  group.add(reeds);

  const soundAt = [0.15, 0.5, 0.85].map((f) => line[Math.floor(f * (n - 1))].clone());
  const tmp = new THREE.Vector3();
  return {
    group, line, pool, soundAt,
    nearest(p, out = tmp) {
      let best = Infinity;
      for (let i = 0; i < n - 1; i++) {
        const a = line[i], b = line[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / l2));
        const qx = a.x + ex * t, qz = a.z + ez * t, d = Math.hypot(p.x - qx, p.z - qz);
        if (d < best) { best = d; out.set(qx, a.y + (b.y - a.y) * t, qz); }
      }
      return best;
    },
    inPool(x, z, pad = 0) { return Math.hypot(x - pool.x, z - pool.z) < pool.r + pad; },
  };
}
