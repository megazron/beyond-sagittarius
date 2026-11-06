import * as THREE from 'three';
import { NOISE_GLSL } from '../core/glsl';

/**
 * Camera-centred space dome: procedural stars, nebulae, the galactic band,
 * hyperspace streaks, an "other universe" palette and a ray-marched
 * Schwarzschild black hole with an accretion disk (Sagittarius A*).
 */
export function createSpaceDome() {
  const uniforms = {
    uTime: { value: 0 },
    uNebula: { value: 0.6 },
    uWarp: { value: 0 },
    uOther: { value: 0 },
    uBH: { value: 0 },
    uBHPos: { value: new THREE.Vector3(0, 0, -400) },
    uBHRot: { value: new THREE.Matrix3() },
    uWarpDir: { value: new THREE.Vector3(0, 0, -1) },
    uStar: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = (modelMatrix * vec4(position, 0.0)).xyz;
        vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position,1.0)).xyz, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime, uNebula, uWarp, uOther, uBH, uStar;
      uniform vec3 uBHPos, uWarpDir;
      uniform mat3 uBHRot;
      varying vec3 vDir;
      ${NOISE_GLSL}

      vec3 starLayer(vec3 d, float scale, float thresh, float bright){
        vec3 p = d * scale; vec3 id = floor(p); vec3 f = fract(p) - 0.5;
        float h = hash13(id);
        if (h < thresh) return vec3(0.0);
        vec3 off = (hash33(id) - 0.5) * 0.6;
        float dist = length(f - off);
        float tw = 0.75 + 0.25 * sin(uTime * (1.0 + h * 4.0) + h * 40.0);
        float s = exp(-dist * dist * 260.0) * bright * tw * (h - thresh) / (1.0 - thresh) * 3.0;
        vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.82, 0.6), hash13(id + 7.0));
        return tint * s;
      }

      vec3 background(vec3 d){
        vec3 col = vec3(0.0);
        // galactic band
        vec3 bandN = normalize(vec3(0.25, 1.0, 0.35));
        float band = exp(-pow(abs(dot(d, bandN)) * 4.0, 1.6));
        float neb = fbm3(d * 2.4 + vec3(0.0, 0.0, uTime * 0.004));
        float neb2 = fbm3(d * 5.5 - 3.0);
        vec3 c1 = mix(vec3(0.35, 0.10, 0.55), vec3(1.0, 0.45, 0.25), smoothstep(0.35, 0.7, neb2));
        vec3 c2 = vec3(0.08, 0.35, 0.6);
        vec3 nebCol = mix(c2, c1, smoothstep(0.3, 0.75, neb));
        // other-universe palette: gold/teal filaments
        vec3 o1 = mix(vec3(0.1, 0.9, 0.7), vec3(1.0, 0.8, 0.3), neb2);
        nebCol = mix(nebCol, o1 * 1.6, uOther);
        float dens = smoothstep(0.42, 0.85, neb) * (0.35 + band * 0.9) * uNebula;
        dens += uOther * pow(smoothstep(0.45, 0.8, neb2), 2.0) * 1.2;
        col += nebCol * dens * 0.55;
        // dust lanes
        col *= mix(1.0, smoothstep(0.25, 0.6, fbm3(d * 9.0)), band * 0.6);
        col += vec3(0.9, 0.85, 0.75) * band * 0.06 * uNebula;
        float sd = uStar * (1.0 + band * 1.5);
        col += starLayer(d, 160.0, 0.93, 1.6) * sd;
        col += starLayer(d, 340.0, 0.94, 1.0) * sd;
        col += starLayer(d, 700.0, 0.955, 0.7) * sd;
        // hyperspace streaks
        if (uWarp > 0.0) {
          float c = dot(d, uWarpDir);
          vec3 perp = normalize(d - c * uWarpDir + 1e-5);
          vec3 ax = normalize(cross(uWarpDir, vec3(0.0, 1.0, 0.01)));
          vec3 ay = cross(uWarpDir, ax);
          float ang = atan(dot(perp, ay), dot(perp, ax));
          float cell = floor(ang * 120.0);
          float h = hash11(cell);
          float run = fract(h * 7.0 + uTime * (0.6 + h) * uWarp + c * 2.0);
          float streak = smoothstep(0.0, 0.03, run) * smoothstep(0.3, 0.0, run) * step(0.72, h);
          float edge = smoothstep(0.98, 0.3, abs(c));
          vec3 sc = mix(vec3(0.5, 0.75, 1.0), vec3(1.0, 0.7, 0.4), hash11(cell + 3.0));
          sc = mix(sc, vec3(0.3, 1.0, 0.8), uOther);
          col += sc * streak * edge * uWarp * 1.6;
          col += vec3(0.3, 0.5, 1.0) * pow(max(c, 0.0), 80.0) * uWarp * 1.2;
        }
        return col;
      }

      vec3 diskColor(float r){
        float tt = clamp((r - 2.6) / 9.0, 0.0, 1.0);
        vec3 hot = vec3(1.4, 1.25, 1.1);
        vec3 mid = vec3(1.3, 0.62, 0.22);
        vec3 cool = vec3(0.55, 0.12, 0.06);
        return tt < 0.35 ? mix(hot, mid, tt / 0.35) : mix(mid, cool, (tt - 0.35) / 0.65);
      }

      void main(){
        vec3 dir = normalize(vDir);
        vec3 col;
        if (uBH > 0.001) {
          // work in the BH frame where r_s = 1 and the disk lies in y = 0
          vec3 ro = uBHRot * (-uBHPos);
          vec3 rd = normalize(uBHRot * dir);
          float R = 22.0;
          float b = dot(ro, rd);
          float c = dot(ro, ro) - R * R;
          float disc = b * b - c;
          bool inside = c < 0.0;
          if (disc > 0.0 && (inside || b < 0.0)) {
            float t0 = inside ? 0.0 : (-b - sqrt(disc));
            vec3 p = ro + rd * t0;
            vec3 v = rd;
            vec3 hv = cross(p, v);
            float h2 = dot(hv, hv);
            vec3 acc = vec3(0.0); float alpha = 0.0; bool captured = false;
            for (int i = 0; i < 200; i++) {
              float r = length(p);
              if (r < 1.0) { captured = true; break; }
              if (r > R + 0.5 && dot(p, v) > 0.0) break;
              float dt = clamp(0.06 * r, 0.02, 1.2);
              vec3 prev = p;
              v += -1.5 * h2 * p / pow(r, 5.0) * dt * uBH;
              p += v * dt;
              if (prev.y * p.y < 0.0) {
                vec3 q = mix(prev, p, prev.y / (prev.y - p.y));
                float rq = length(q.xz);
                if (rq > 2.6 && rq < 12.0) {
                  float ang = atan(q.z, q.x);
                  float swirl = ang + uTime * 2.2 / pow(rq, 1.5) * 3.0;
                  float rings = vnoise(vec3(rq * 2.2, cos(swirl) * 2.5, sin(swirl) * 2.5));
                  rings = 0.45 + 0.9 * rings * vnoise(vec3(rq * 7.0, cos(swirl) * 6.0, sin(swirl) * 6.0));
                  vec3 tang = normalize(vec3(-q.z, 0.0, q.x));
                  float dop = 1.0 + 0.75 * dot(tang, normalize(v));
                  float dens = smoothstep(2.6, 3.3, rq) * smoothstep(12.0, 6.5, rq) * rings;
                  vec3 dc = diskColor(rq) * dop * dop * 2.2;
                  acc += (1.0 - alpha) * dc * dens;
                  alpha += (1.0 - alpha) * clamp(dens * 0.85, 0.0, 1.0);
                }
              }
            }
            vec3 bg = captured ? vec3(0.0) : background(normalize(transpose(uBHRot) * v));
            col = acc + (1.0 - alpha) * bg;
          } else {
            col = background(dir);
          }
        } else {
          col = background(dir);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
  mesh.scale.setScalar(9000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, uniforms };
}

/** Earth with procedural continents, ocean glint, ice, city lights, clouds and atmosphere. */
export function createEarth(radius: number, sunDir: THREE.Vector3) {
  const group = new THREE.Group();
  const common = { uSun: { value: sunDir }, uTime: { value: 0 } };
  const surf = new THREE.ShaderMaterial({
    uniforms: common,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
      void main(){
        vN = normalize(position);
        vWN = normalize(mat3(modelMatrix) * normal);
        vWP = (modelMatrix * vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWP, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform float uTime;
      varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
      ${NOISE_GLSL}
      void main(){
        vec3 n = normalize(vN);
        float land = fbm3(n * 2.1 + 3.0) + 0.22 * fbm3(n * 9.0);
        float lm = smoothstep(0.6, 0.63, land);
        float lat = abs(n.y);
        vec3 ocean = mix(vec3(0.005, 0.03, 0.09), vec3(0.02, 0.12, 0.22), smoothstep(0.5, 0.6, land));
        float veg = fbm3(n * 6.0 + 11.0);
        vec3 ground = mix(vec3(0.05, 0.12, 0.03), vec3(0.32, 0.24, 0.12), smoothstep(0.45, 0.65, veg) * (1.0 - lat));
        ground = mix(ground, vec3(0.45, 0.36, 0.22), smoothstep(0.62, 0.8, veg) * smoothstep(0.5, 0.1, lat));
        vec3 albedo = mix(ocean, ground, lm);
        float ice = smoothstep(0.78, 0.86, lat + 0.06 * fbm3(n * 10.0));
        albedo = mix(albedo, vec3(0.85, 0.9, 0.95), ice);
        vec3 N = normalize(vWN);
        vec3 V = normalize(cameraPosition - vWP);
        float ndl = dot(N, uSun);
        float diff = smoothstep(-0.05, 0.4, ndl);
        vec3 col = albedo * diff * 1.6;
        vec3 H = normalize(uSun + V);
        col += vec3(1.0, 0.9, 0.75) * pow(max(dot(N, H), 0.0), 260.0) * (1.0 - lm) * (1.0 - ice) * 0.3 * step(0.0, ndl);
        // city lights on the night side: 2189: dense
        float night = smoothstep(0.1, -0.15, ndl);
        float city = pow(vnoise(n * 160.0), 6.0) * 2.4 + pow(vnoise(n * 45.0), 4.0) * 0.5;
        city *= smoothstep(0.62, 0.78, fbm3(n * 5.0 + 5.0) + 0.2) * smoothstep(0.62, 0.7, land) * (1.0 - ice);
        col += vec3(1.0, 0.62, 0.3) * city * night * 1.4;
        // atmosphere scattering rim
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col += vec3(0.25, 0.5, 1.0) * fres * smoothstep(-0.3, 0.6, ndl) * 1.2;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(radius, 128, 64), surf);
  group.add(earth);

  const cloudMat = new THREE.ShaderMaterial({
    uniforms: common,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
      void main(){ vN = normalize(position); vWN = normalize(mat3(modelMatrix)*normal); vWP = (modelMatrix*vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWP,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform float uTime;
      varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
      ${NOISE_GLSL}
      void main(){
        vec3 n = normalize(vN);
        float c = fbm3(n * 3.5 + vec3(uTime * 0.01, 0.0, 0.0) + fbm3(n * 1.5) * 1.5);
        float a = smoothstep(0.5, 0.75, c);
        float diff = smoothstep(-0.1, 0.5, dot(normalize(vWN), uSun));
        gl_FragColor = vec4(vec3(1.0) * diff * 1.3, a * 0.85);
      }`,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.012, 96, 48), cloudMat);
  group.add(clouds);

  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.07, 96, 48),
    new THREE.ShaderMaterial({
      uniforms: common,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vWN; varying vec3 vWP;
        void main(){ vWN = normalize(mat3(modelMatrix)*normal); vWP = (modelMatrix*vec4(position,1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWP,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun;
        varying vec3 vWN; varying vec3 vWP;
        void main(){
          vec3 V = normalize(cameraPosition - vWP);
          float rim = pow(clamp(1.0 + dot(normalize(vWN), V) * 1.0, 0.0, 1.0), 0.5);
          float k = dot(-normalize(vWN), V);
          float glow = pow(clamp(0.66 - k, 0.0, 1.0) * 1.8, 3.0);
          float sun = smoothstep(-0.4, 0.5, dot(-normalize(vWN), uSun));
          gl_FragColor = vec4(vec3(0.3, 0.6, 1.0) * glow * sun * 1.6, 1.0);
        }`,
    }),
  );
  group.add(atmo);

  return { group, earth, clouds, uniforms: common };
}

/** Orbital ring with docks and stations around Earth. */
export function createOrbitalRing(radius: number) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.8, roughness: 0.35 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.25, 8, 400), metal);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.9, 0.08, 6, 400), metal);
  ring2.rotation.x = Math.PI / 2;
  group.add(ring2);
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.2) });
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 4), lightMat, 300);
  const stations = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.8, 1.2), metal, 60);
  const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const s = new THREE.Vector3();
  for (let i = 0; i < 300; i++) {
    const a = (i / 300) * Math.PI * 2;
    m.makeTranslation(Math.cos(a) * (radius + 0.4), 0.25, Math.sin(a) * (radius + 0.4));
    lights.setMatrixAt(i, m);
  }
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 + 0.03;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    s.set(1 + (i % 3) * 0.6, 1 + (i % 2), 1);
    m.compose(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius), q, s);
    stations.setMatrixAt(i, m);
  }
  group.add(lights, stations);
  // space elevator tethers
  const tetherMat = new THREE.MeshBasicMaterial({ color: 0x8899aa, transparent: true, opacity: 0.5 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const len = radius * 0.24;
    const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 4), tetherMat);
    tether.position.set(Math.cos(a) * (radius - len / 2), 0, Math.sin(a) * (radius - len / 2));
    tether.rotation.z = Math.PI / 2; tether.rotation.y = -a;
    group.add(tether);
  }
  return group;
}

/** Generic planet (Mars-like or banded gas giant) for the journey montage. */
export function createPlanet(radius: number, kind: 'mars' | 'giant' | 'home', sunDir: THREE.Vector3) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir }, uKind: { value: kind === 'mars' ? 0 : kind === 'giant' ? 1 : 2 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
      void main(){ vN = normalize(position); vWN = normalize(mat3(modelMatrix)*normal); vWP = (modelMatrix*vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWP,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform float uKind; uniform float uTime;
      varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
      ${NOISE_GLSL}
      void main(){
        vec3 n = normalize(vN);
        vec3 albedo;
        if (uKind < 0.5) {
          float f = fbm3(n * 3.0); float g = fbm3(n * 12.0);
          albedo = mix(vec3(0.35, 0.12, 0.05), vec3(0.75, 0.38, 0.18), f);
          albedo *= 0.75 + 0.5 * g;
          albedo = mix(albedo, vec3(0.9), smoothstep(0.9, 0.95, abs(n.y)));
        } else if (uKind > 1.5) {
          // the world they fall on: dark seas, forest continents, weather
          float land = smoothstep(0.47, 0.53, fbm3(n * 2.3 + 4.0) + 0.14 * fbm3(n * 9.0));
          float hill = fbm3(n * 11.0);
          albedo = mix(vec3(0.01, 0.06, 0.1), mix(vec3(0.06, 0.16, 0.09), vec3(0.3, 0.26, 0.2), smoothstep(0.5, 0.72, hill)), land);
          float cloud = smoothstep(0.5, 0.74, fbm3(n * 3.6 + vec3(uTime * 0.01, 0.0, 0.0)) + 0.25 * fbm3(n * 13.0));
          albedo = mix(albedo, vec3(0.62, 0.65, 0.7), cloud * 0.85);
          vec3 Nn = normalize(vWN);
          float dd = dot(Nn, uSun);
          // night side: the forests glow faintly, as they do from the ground
          vec3 glow = vec3(0.02, 0.1, 0.095) * land * (1.0 - cloud) * smoothstep(0.45, 0.8, fbm3(n * 34.0)) * smoothstep(0.1, -0.2, dd);
          vec3 Vv = normalize(cameraPosition - vWP);
          float rim = pow(1.0 - max(dot(Nn, Vv), 0.0), 3.5);
          float lit = smoothstep(-0.12, 0.5, dd);
          vec3 c = albedo * lit * 1.1 + glow * 0.8 + vec3(0.25, 0.55, 1.2) * rim * smoothstep(-0.25, 0.3, dd) * 1.4 + vec3(1.1, 0.45, 0.2) * rim * smoothstep(0.25, 0.0, abs(dd)) * 0.9;
          gl_FragColor = vec4(c, 1.0);
          return;
        } else {
          float w = fbm3(n * vec3(2.0, 0.5, 2.0) + uTime * 0.01) * 2.0;
          float bands = sin(n.y * 22.0 + w * 2.5) * 0.5 + 0.5;
          albedo = mix(vec3(0.55, 0.42, 0.3), vec3(0.92, 0.82, 0.66), bands);
          albedo = mix(albedo, vec3(0.7, 0.3, 0.15), smoothstep(0.6, 0.9, fbm3(n * 6.0 + w)) * 0.5);
        }
        vec3 N = normalize(vWN); vec3 V = normalize(cameraPosition - vWP);
        float diff = smoothstep(-0.05, 0.6, dot(N, uSun));
        vec3 col = albedo * diff * 1.4;
        col += (uKind < 0.5 ? vec3(1.0, 0.5, 0.3) : vec3(0.8, 0.7, 0.5)) * pow(1.0 - max(dot(N, V), 0.0), 4.0) * diff * 0.8;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), mat);
  return mesh;
}
