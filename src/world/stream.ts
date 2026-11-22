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
  /** A place to kneel on the dry bank nearest p, on p's side, and the heading (Player.facing) that looks at the water. */
  bankSpot(p: THREE.Vector3): { at: THREE.Vector3; facing: number; water: THREE.Vector3 };
  /** Points along the stream for looping water sound. */
  soundAt: THREE.Vector3[];
  /** Where the grass must not grow (grass.setRibbon): the stream's line, then the pool. */
  mask: [number, number, number][];
}

const WIDTH = 2.2;
const rnd = (s: number) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Where the stream runs and where the pool lies: from the ground alone, so the forest can keep its trees off them
 * before it grows (world.ts reserves along the line). */
export interface StreamPlan { line: THREE.Vector3[]; pool: { x: number; z: number; r: number; y: number } }

export function planStream(T: Terrain): StreamPlan {
  // spawn at the origin. The lake's shore is ragged (bays reach far in), so everything is placed from the ground
  // itself: walk from the spawn towards the lake until the ground goes under the water (y 0): that is the shore
  const toLake = new THREE.Vector2(LAKE.x, LAKE.z).normalize();
  const side = new THREE.Vector2(-toLake.y, toLake.x);
  let ds = 8;
  while (ds < 200 && T.height(toLake.x * ds, toLake.y * ds) > 0.05) ds += 1;
  const shore = toLake.clone().multiplyScalar(ds);
  const trace = (sx: number, sz: number, sgn: number) => {
    const out: THREE.Vector3[] = [];
    let x = sx, z = sz, dx = shore.x - sx, dz = shore.y - sz, wet = 0;
    { const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
    for (let i = 0; i < 220; i++) {
      const h = T.height(x, z);
      out.push(new THREE.Vector3(x, h, z));
      // into the water and a few metres on, so it meets the lake under its surface
      if (h < -0.05 && ++wet > 3) break;
      const e = 1.2;
      const gx = T.height(x + e, z) - T.height(x - e, z), gz = T.height(x, z + e) - T.height(x, z - e);
      const gl = Math.hypot(gx, gz) || 1;
      // downhill, with a pull to the shore so a hollow cannot hold it, and a slow meander
      const lx = shore.x - x, lz = shore.y - z, ll = Math.hypot(lx, lz) || 1;
      const m = (Math.sin(i * 0.11) * 0.3 + Math.sin(i * 0.37 + 1) * 0.15) * sgn;
      let nx = -gx / gl * 0.9 + lx / ll * 0.85 + side.x * m, nz = -gz / gl * 0.9 + lz / ll * 0.85 + side.y * m;
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      // water does not turn on a coin: keep most of the old heading
      dx = dx * 0.7 + nx * 0.3; dz = dz * 0.7 + nz * 0.3;
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      x += dx; z += dz;
    }
    return out;
  };
  // try sources up the slope on both sides of the walk; keep a stream that reaches the water, is a good length,
  // stays off the spawn and climbs least on the way
  let line: THREE.Vector3[] = [], best = -Infinity;
  for (const sgn of [1, -1]) for (const off of [24, 34, 46, 60, 74, 88]) for (const k of [0.2, 0.45, 0.7, 0.95]) {
    const sx = toLake.x * ds * k + side.x * off * sgn, sz = toLake.y * ds * k + side.y * off * sgn;
    if (T.height(sx, sz) < 1.5) continue;
    const L = trace(sx, sz, sgn);
    if (L[L.length - 1].y > -0.05) continue;
    let climb = 0, near = Infinity;
    for (let i = 1; i < L.length; i++) { climb += Math.max(0, L[i].y - L[i - 1].y); near = Math.min(near, Math.hypot(L[i].x, L[i].z)); }
    if (near < 10 || L.length < 25) continue;
    // a stream that winds back on itself was caught in a hollow: it reads as a channel, not water finding its way
    const straight = Math.hypot(L[L.length - 1].x - L[0].x, L[L.length - 1].z - L[0].z) || 1;
    // long enough to follow by ear and by eye (the bay comes close to the wake, so it comes in from the side)
    const score = -Math.abs(L.length - 78) * 0.4 - climb * 6 - Math.max(0, L.length / straight - 1.35) * 60;
    if (score > best) { best = score; line = L; }
  }
  if (line.length < 2) line = trace(shore.x * 0.5 + side.x * 30, shore.y * 0.5 + side.y * 30, 1);
  // a stream bed does not climb: each point is no higher than the one above it
  for (let i = 1; i < line.length; i++) line[i].y = Math.min(line[i].y, line[i - 1].y - 0.004);
  return { line, pool: placePool(T, line, toLake, ds) };
}

/** The pool: on dry, flat ground beside the walk, short of the stream and away from it. */
function placePool(T: Terrain, line: THREE.Vector3[], toLake: THREE.Vector2, ds: number) {
  const side = new THREE.Vector2(-toLake.y, toLake.x);
  const R = 2.6;
  let pc = toLake.clone().multiplyScalar(ds * 0.55).addScaledVector(side, -7), pbest = Infinity, rim = 0;
  const lineD = (x: number, z: number) => line.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.z - z)), Infinity);
  for (const k of [0.4, 0.5, 0.6, 0.7]) for (const off of [-9, -6, 6, 9]) {
    const cx = toLake.x * ds * k + side.x * off, cz = toLake.y * ds * k + side.y * off;
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < 16; j++) { const a = j / 16 * Math.PI * 2, h = T.height(cx + Math.cos(a) * R, cz + Math.sin(a) * R); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (lo < 0.9 || lineD(cx, cz) < 12) continue;
    const cost = (hi - lo) * 4 + Math.abs(k - 0.55) * 3;
    if (cost < pbest) { pbest = cost; pc = new THREE.Vector2(cx, cz); rim = lo; }
  }
  if (pbest === Infinity) for (let j = 0; j < 16; j++) { const a = j / 16 * Math.PI * 2; rim = Math.min(rim || Infinity, T.height(pc.x + Math.cos(a) * R, pc.y + Math.sin(a) * R)); }
  return { x: pc.x, z: pc.y, r: R, y: rim - 0.04 };
}

export function createStream(T: Terrain, lakeUniforms: Record<string, THREE.IUniform>, plan: StreamPlan = planStream(T)): StreamWater {
  const group = new THREE.Group(); group.name = 'e1-stream';
  const line = plan.line, pool = plan.pool, R = pool.r;

  // ---- the ribbon ----
  const n = line.length, across = 7;
  const pos = new Float32Array(n * across * 3), uv = new Float32Array(n * across * 2), fast = new Float32Array(n * across);
  let along = 0;
  const widths: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
    const rx = -tz / tl, rz = tx / tl;
    if (i > 0) along += line[i].distanceTo(line[i - 1]);
    const drop = i > 0 ? Math.max(0, line[i - 1].y - line[i].y) : 0;
    // wider near the mouth, narrow at the source
    const w = WIDTH * (0.6 + 0.4 * Math.min(1, i / 20)) * (1 + 0.22 * Math.sin(i * 0.31) + 0.12 * Math.sin(i * 0.83 + 2));
    widths.push(w);
    for (let j = 0; j < across; j++) {
      const u = j / (across - 1), o = (u - 0.5) * w;
      const px = line[i].x + rx * o, pz = line[i].z + rz * o;
      // the surface is flat across, a little below the banks, never under the ground beneath it
      const y = Math.max(line[i].y - 0.05, T.height(px, pz) + 0.02);
      const k = (i * across + j) * 3;
      pos[k] = px; pos[k + 1] = y + 0.03; pos[k + 2] = pz;
      uv[(i * across + j) * 2] = (u - 0.5) * 2; uv[(i * across + j) * 2 + 1] = along;
      fast[i * across + j] = Math.min(1, Math.max(0, drop - 0.12) * 5);
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
    transparent: true, fog: true, depthWrite: false, side: THREE.DoubleSide,
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
        // clear, shallow: the pebbly bed shows through, a little deeper and greener in the middle
        float bed = vnoise2(vWP.xz * 3.1) * 0.6 + vnoise2(vWP.xz * 11.0) * 0.4;
        vec3 body = mix(vec3(0.21, 0.19, 0.13), vec3(0.07, 0.11, 0.105), smoothstep(0.1, 0.75, edge)) * (0.8 + 0.4 * bed) * (0.2 + 0.8 * uDay);
        vec3 col = mix(body, refl, fres);
        vec3 H = normalize(uSunDir + V);
        col += uSunColor * pow(max(dot(N, H), 0.0), 300.0) * 6.0 * smoothstep(-0.05, 0.1, uSunDir.y);
        // the current shows as long bright threads drawn downstream, and white water where it drops and at the edges
        float th = smoothstep(0.62, 0.9, vnoise2(vec2(vUv.x * 7.0, vUv.y * 0.55 - uTime * sp * 0.9)));
        col += (refl * 0.35 + vec3(0.05)) * th * (0.3 + 0.7 * uDay);
        float fn = vnoise2(vec2(vUv.x * 4.0, vUv.y * 2.0 - uTime * sp * 1.6));
        float foam = smoothstep(0.74, 0.95, fn) * (0.08 + vFast * 0.7) * (0.5 + 0.5 * smoothstep(0.75, 0.2, edge));
        col = mix(col, vec3(0.78, 0.82, 0.84) * (0.25 + 0.75 * uDay), clamp(foam, 0.0, 0.5));
        float alpha = clamp(0.62 + fres * 0.3 + foam * 0.3 + th * 0.1, 0.0, 0.96) * smoothstep(0.0, 0.3, edge);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, shared);
  const ribbon = new THREE.Mesh(geo, mat);
  ribbon.name = 'stream'; ribbon.renderOrder = 2; ribbon.receiveShadow = false;
  group.add(ribbon);
  {
    const bank = geo.clone();
    const bp = bank.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      const c = line[i];
      for (let j = 0; j < across; j++) {
        const k = i * across + j, ox = bp.getX(k) - c.x, oz = bp.getZ(k) - c.z;
        const x = c.x + ox * 2.3, z = c.z + oz * 2.3;
        bp.setXYZ(k, x, T.height(x, z) + 0.03, z);
      }
    }
    bank.computeBoundingSphere();
    const bm = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      transparent: true, fog: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: vert,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        ${NOISE_GLSL}
        varying vec3 vWP; varying vec2 vUv; varying float vFast;
        void main(){
          // wet mud and pebbles along the water, drying out away from it
          float e = abs(vUv.x), n = vnoise2(vWP.xz * 2.5) * 0.6 + vnoise2(vWP.xz * 9.0) * 0.4;
          vec3 col = mix(vec3(0.05, 0.045, 0.035), vec3(0.11, 0.1, 0.08), smoothstep(0.3, 0.7, n));
          float a = (1.0 - smoothstep(0.35, 1.0, e + (n - 0.5) * 0.35)) * 0.85;
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }`,
    });
    const bk = new THREE.Mesh(bank, bm);
    bk.name = 'stream-bank'; bk.renderOrder = 1;
    group.add(bk);
  }

  // ---- stones: rounded cobbles in the bed, breaking the surface, and drier ones along the banks ----
  {
    const sg = new THREE.IcosahedronGeometry(1, 1);
    const sp = sg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
      // water-worn: flattened, a little lumpy
      const k = 1 + 0.12 * Math.sin(x * 5.1 + z * 3.3) + 0.08 * Math.sin(y * 7.7 + x * 2.1);
      sp.setXYZ(i, x * k * 1.15, y * k * 0.55, z * k);
    }
    sg.computeVertexNormals();
    const STONES = 340;
    const stones = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62 }), STONES);
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e3 = new THREE.Euler(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), c3 = new THREE.Color();
    let c = 0;
    for (let k = 0; c < STONES && k < STONES * 3; k++) {
      const i = Math.floor(rnd(k * 1.7 + 0.3) * (n - 1)), L = line[i], b = line[i + 1];
      const tx = b.x - L.x, tz = b.z - L.z, tl = Math.hypot(tx, tz) || 1, w = widths[i];
      // two in three in the bed, the rest on the banks; bigger ones near the edges
      const inBed = rnd(k + 41) < 0.66;
      const u = inBed ? (rnd(k + 43) - 0.5) * 0.95 : (rnd(k + 43) < 0.5 ? -1 : 1) * (0.5 + rnd(k + 47) * 0.7);
      const px = L.x - tz / tl * u * w, pz = L.z + tx / tl * u * w, h = T.height(px, pz);
      if (h < -0.35) continue;
      const r = (inBed ? 0.07 + Math.pow(rnd(k + 53), 2) * 0.2 : 0.06 + Math.pow(rnd(k + 53), 3) * 0.32) * (Math.abs(u) > 0.35 ? 1.25 : 1);
      e3.set((rnd(k + 59) - 0.5) * 0.3, rnd(k + 61) * Math.PI * 2, (rnd(k + 67) - 0.5) * 0.3);
      m4.compose(p3.set(px, Math.min(h, L.y - 0.05) + r * 0.12, pz), q4.setFromEuler(e3), s3.setScalar(r));
      stones.setMatrixAt(c, m4);
      // grey granite and brown sandstone, darker where wet
      const g = rnd(k + 71);
      c3.setHSL(g < 0.7 ? 0.1 : 0.07, g < 0.7 ? 0.05 : 0.28, (0.16 + rnd(k + 73) * 0.12) * (inBed ? 0.6 : 1));
      stones.setColorAt(c, c3);
      c++;
    }
    stones.count = c; stones.name = 'stream-stones';
    stones.castShadow = false; stones.receiveShadow = true;
    group.add(stones);
  }

  // ---- the pool: still water with a green skin, beside the path before the stream ----
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
        float skin = smoothstep(0.42, 0.56, s + smoothstep(0.6, 1.05, d) * 0.35);
        vec3 V = normalize(cameraPosition - vWP);
        float fres = 0.02 + 0.98 * pow(1.0 - max(V.y, 0.0), 5.0);
        vec3 water = mix(vec3(0.03, 0.04, 0.025), envCol(reflect(-V, vec3(0.0, 1.0, 0.0))), fres);
        float sun = max(dot(vec3(0.0, 1.0, 0.0), uSunDir), 0.0);
        vec3 green = mix(vec3(0.07, 0.1, 0.025), vec3(0.15, 0.18, 0.045), vnoise2(vWP.xz * 7.0)) * (0.25 + 0.75 * sun) * (0.3 + 0.7 * uDay);
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

  const mask: [number, number, number][] = [];
  const step = Math.max(1, Math.ceil(n / 34));
  for (let i = 0; i < n; i += step) mask.push([line[i].x, line[i].z, WIDTH * 1.05]);
  mask.push([line[n - 1].x, line[n - 1].z, WIDTH * 1.05], [0, 0, -1], [pool.x, pool.z, R * 1.25], [pool.x + 0.01, pool.z, R * 1.25]);
  const soundAt = [0.15, 0.5, 0.85].map((f) => line[Math.floor(f * (n - 1))].clone());
  const tmp = new THREE.Vector3();
  return {
    group, line, pool, soundAt, mask,
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
    bankSpot(p) {
      let bi = 0, bt = 0, best = Infinity;
      for (let i = 0; i < n - 1; i++) {
        const a = line[i], b = line[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / l2));
        const d = Math.hypot(p.x - (a.x + ex * t), p.z - (a.z + ez * t));
        if (d < best) { best = d; bi = i; bt = t; }
      }
      // not right at the mouth, where the bank is the lake's
      bi = Math.min(bi, n - 8); if (bi < 0) bi = 0;
      const a = line[bi], b = line[bi + 1], tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
      const water = new THREE.Vector3(a.x + tx * bt, a.y + (b.y - a.y) * bt, a.z + tz * bt);
      let rx = -tz / tl, rz = tx / tl;
      if ((p.x - water.x) * rx + (p.z - water.z) * rz < 0) { rx = -rx; rz = -rz; }
      const off = widths[bi] * 0.5 + 0.45;
      const x = water.x + rx * off, z = water.z + rz * off;
      const at = new THREE.Vector3(x, T.height(x, z), z);
      return { at, facing: Math.atan2(rx, rz), water };
    },
  };
}
