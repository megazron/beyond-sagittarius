import * as THREE from 'three';
import { NOISE_GLSL } from '../core/glsl';
import { smoothstep, tileFbm } from '../core/noise';

const C = (h: number) => new THREE.Color(h);
const KEYS = {
  day: { zenith: C(0x1a5f96), horizon: C(0xa9c9d2), sun: C(0xfff0d8) },
  dusk: { zenith: C(0x30366e), horizon: C(0xf0895e), sun: C(0xffa060) },
  night: { zenith: C(0x03050d), horizon: C(0x101a30), sun: C(0x8090c0) },
};

/**
 * Tileable cloud noise, built once: R = billows, G = fine detail. Two texture
 * taps replace twenty hash evaluations per pixel, which pays for the lighting.
 */
function cloudNoise(): THREE.DataTexture {
  const S = 256, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x / S) * 8, v = (y / S) * 8, i = (y * S + x) * 4;
    const a = tileFbm(u, v, 8, 5, 21);
    const b = 1 - Math.abs(tileFbm(u * 4, v * 4, 32, 3, 22) * 2 - 1);
    d[i] = Math.min(255, Math.max(0, a * 255)); d[i + 1] = Math.min(255, Math.max(0, b * 255)); d[i + 2] = 0; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

/** Ring opacity at radius r in sky units; used by the rings and by the shadow they cast. */
const RING_GLSL = /* glsl */ `
  float ringDensity(float r){
    float b = vnoise2(vec2(r * 0.09, 0.5)) * 0.62 + vnoise2(vec2(r * 0.41, 3.0)) * 0.26 + vnoise2(vec2(r * 1.7, 7.0)) * 0.12;
    float gap = smoothstep(0.0, 5.0, abs(r - 385.0)) * mix(0.55, 1.0, smoothstep(0.0, 4.0, abs(r - 318.0)));
    return smoothstep(262.0, 292.0, r) * smoothstep(470.0, 438.0, r) * (0.12 + 0.88 * smoothstep(0.25, 0.75, b)) * gap;
  }`;

const fromAzEl = (az: number, el: number) =>
  new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();

/**
 * Alien sky: gradient + sun + clouds + stars + the galactic core glow at night,
 * a cratered moon and the giant ringed planet this world orbits (tidally locked,
 * so it hangs in the same place in the sky).
 */
export class Sky {
  group = new THREE.Group();
  sunDir = new THREE.Vector3();
  moonDir = fromAzEl(1.9, 0.78);
  giantDir = fromAzEl(-0.62, 0.42);
  zenith = new THREE.Color();
  horizon = new THREE.Color();
  sunColor = new THREE.Color();
  day = 1;
  private dome: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;
  private moon: THREE.Mesh;
  private giant: THREE.Group;
  private bodyUniforms: Record<string, THREE.IUniform>;

  constructor(cloudSteps = 0) {
    this.uniforms = {
      tCloud: { value: cloudNoise() },
      uSunDir: { value: this.sunDir },
      uZenith: { value: this.zenith },
      uHorizon: { value: this.horizon },
      uSunColor: { value: this.sunColor },
      uDay: { value: 1 },
      uTime: { value: 0 },
      uGiantDir: { value: this.giantDir },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        defines: { CLOUD_LAYERS: Math.max(2, cloudSteps) },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSunDir, uZenith, uHorizon, uSunColor, uGiantDir; uniform float uDay, uTime;
          uniform sampler2D tCloud;
          varying vec3 vDir;
          ${NOISE_GLSL}
          float cloudD(vec2 p, float cover){
            vec2 c = texture2D(tCloud, p * 0.11).rg;
            vec2 e = texture2D(tCloud, p * 0.47 + c.xy * 0.06).rg;
            float n = c.r * 0.72 + e.r * 0.22 + e.g * 0.1;
            return smoothstep(cover, cover + 0.2, n);
          }
          void main(){
            vec3 d = normalize(vDir);
            float y = d.y;
            vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.65, y), 0.65));
            col = mix(col, uHorizon * 0.75, smoothstep(0.0, -0.25, y));
            float sd = max(dot(d, uSunDir), 0.0);
            float sunUp = smoothstep(-0.12, 0.05, uSunDir.y);
            col += uSunColor * (pow(sd, 1400.0) * 60.0 * sunUp + pow(sd, 14.0) * 0.45 * sunUp + pow(sd, 3.0) * 0.18 * sunUp);
            // horizon glow around the sun at dusk
            float duskK = (1.0 - abs(uSunDir.y) * 3.0);
            col += vec3(1.0, 0.45, 0.25) * pow(sd, 5.0) * max(duskK, 0.0) * smoothstep(0.35, 0.0, y) * 0.8;
            float night = 1.0 - uDay;
            if (night > 0.01 && y > -0.05) {
              vec3 p = d * 300.0; vec3 id = floor(p); vec3 f = fract(p) - 0.5;
              float h = hash13(id);
              float s = step(0.965, h) * exp(-dot(f, f) * 40.0) * (0.6 + 0.4 * sin(uTime * 2.0 + h * 50.0));
              vec3 p2 = d * 700.0; vec3 id2 = floor(p2); vec3 f2 = fract(p2) - 0.5;
              s += step(0.975, hash13(id2)) * exp(-dot(f2, f2) * 50.0) * 0.6;
              // the galactic core: this world sits near the centre of a galaxy
              vec3 coreDir = normalize(vec3(0.5, 0.35, 0.8));
              float band = exp(-pow(abs(dot(d, normalize(vec3(-0.3, 0.8, 0.2)))) * 3.2, 1.5));
              float core = pow(max(dot(d, coreDir), 0.0), 8.0);
              float neb = fbm3(d * 3.0);
              vec3 gal = mix(vec3(0.35, 0.2, 0.6), vec3(1.0, 0.75, 0.5), core) * (band * 0.25 + core * 0.9) * smoothstep(0.3, 0.75, neb + core * 0.4);
              col += (vec3(s) * (1.0 + band * 2.0) + gal * 0.6) * night * smoothstep(-0.05, 0.25, y);
            }
            if (y > 0.0) {
              // a cloud deck: the view ray meets a plane high up, density from the noise,
              // light from how much cloud lies towards the sun
              vec2 wind = vec2(uTime * 0.0035, uTime * 0.0016);
              float nightK = 1.0 - uDay;
              float cover = 0.5;
              float T = 1.0; vec3 acc = vec3(0.0);
              vec3 shade = mix(uHorizon * 0.62 + uZenith * 0.25, vec3(0.02, 0.025, 0.04), nightK);
              vec3 lit = mix(uSunColor * 1.55 + uHorizon * 0.15, vec3(0.05, 0.06, 0.09), nightK);
              float phase = 0.75 + 1.6 * pow(sd, 6.0);
              for (int i = 0; i < CLOUD_LAYERS; i++) {
                float k = (float(i) + 0.5) / float(CLOUD_LAYERS);
                vec2 p = d.xz / (y + 0.09) * (1.5 + k * 0.28) + wind;
                float dens = cloudD(p, cover + abs(k - 0.42) * 0.22);
                if (dens > 0.003) {
                  float toSun = cloudD(p + uSunDir.xz * 0.22, cover + 0.02);
                  float light = exp(-toSun * 2.0) * (1.0 - exp(-dens * 3.0) * 0.45);
                  vec3 c = mix(shade, lit * phase, clamp(light, 0.0, 1.0));
                  float a = 1.0 - exp(-dens * 6.0 / float(CLOUD_LAYERS));
                  acc += T * a * c;
                  T *= 1.0 - a;
                }
              }
              float fade = smoothstep(0.0, 0.16, y);
              col = mix(col, acc + col * T, fade);
            }
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.dome.scale.setScalar(1500);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    this.bodyUniforms = {
      uSunDir: { value: this.sunDir }, uDay: { value: 1 }, uHorizon: { value: this.horizon }, uTime: { value: 0 },
      uRingN: { value: new THREE.Vector3(0, 1, 0) }, uGiantPos: { value: new THREE.Vector3() },
    };
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(55, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.bodyUniforms,
        fog: false,
        transparent: true,
        vertexShader: `varying vec3 vN; varying vec3 vWN; void main(){ vN = normalize(position); vWN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSunDir, uHorizon; uniform float uDay; varying vec3 vN; varying vec3 vWN;
          ${NOISE_GLSL}
          void main(){
            vec3 n = normalize(vN);
            float mare = smoothstep(0.42, 0.62, fbm3(n * 2.6));
            float cr = fbm3(n * 11.0);
            vec3 alb = mix(vec3(0.5, 0.48, 0.47), vec3(0.2, 0.19, 0.2), mare) * (0.72 + 0.56 * cr);
            float diff = max(dot(normalize(vWN), uSunDir), 0.0);
            vec3 col = alb * pow(diff, 0.8) * 1.9 + alb * 0.012;
            // in daylight the air in front of it is brighter than its dark side
            gl_FragColor = vec4(col, mix(1.0, 0.25 + 0.6 * diff, uDay));
          }`,
      }),
    );
    this.moon.renderOrder = -5;
    this.group.add(this.moon);

    this.giant = new THREE.Group();
    const giantBody = new THREE.Mesh(
      new THREE.SphereGeometry(210, 96, 48),
      new THREE.ShaderMaterial({
        uniforms: this.bodyUniforms,
        fog: false,
        transparent: true,
        vertexShader: `varying vec3 vN; varying vec3 vWN; varying vec3 vWP; void main(){ vN = normalize(position); vWN = normalize(mat3(modelMatrix)*normal); vWP=(modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSunDir, uHorizon, uRingN, uGiantPos; uniform float uDay, uTime; varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
          ${NOISE_GLSL}
          ${RING_GLSL}
          void main(){
            vec3 n = normalize(vN);
            // zonal jets: bands sheared by latitude, turbulence strongest on their edges
            float lat = n.y;
            float shear = sin(lat * 19.0) * 0.5;
            vec3 q = vec3(n.x + shear * n.z * 0.25, n.y * 5.5, n.z - shear * n.x * 0.25);
            float w = fbm3(q * 2.3 + vec3(uTime * 0.002, 0.0, 0.0));
            float w2 = fbm3(q * 6.0 + w * 2.0);
            float bands = sin(lat * 23.0 + (w - 0.5) * 3.2) * 0.5 + 0.5;
            float fine = sin(lat * 71.0 + (w2 - 0.5) * 5.0) * 0.5 + 0.5;
            vec3 alb = mix(vec3(0.42, 0.36, 0.3), vec3(0.78, 0.71, 0.6), bands);
            alb = mix(alb, vec3(0.56, 0.47, 0.38), fine * 0.32);
            alb = mix(alb, vec3(0.3, 0.36, 0.44), smoothstep(0.75, 0.97, abs(lat))); // cold poles
            float sd = length((n - normalize(vec3(0.4, -0.3, 0.86))) * vec3(0.8, 1.7, 0.8));
            float storm = smoothstep(0.16, 0.05, sd + (w2 - 0.5) * 0.05);
            alb = mix(alb, vec3(0.62, 0.34, 0.24), storm * 0.8);

            vec3 N = normalize(vWN);
            vec3 V = normalize(cameraPosition - vWP);
            float nl = dot(N, uSunDir), nv = max(dot(N, V), 0.0);
            // limb darkening of a thick atmosphere, and a soft terminator
            float diff = smoothstep(-0.06, 0.3, nl) * (0.3 + 0.7 * max(nl, 0.0)) * pow(nv, 0.28);
            // shadow of the rings on the cloud tops
            vec3 p = vWP - uGiantPos;
            float t = -dot(p, uRingN) / dot(uSunDir, uRingN);
            float ringS = 1.0;
            if (t > 0.0) ringS = 1.0 - 0.8 * ringDensity(length(p + uSunDir * t));
            vec3 col = alb * diff * ringS * 1.45;
            // thin blue haze at the limb, on the lit side only
            col += vec3(0.32, 0.42, 0.62) * pow(1.0 - nv, 4.0) * smoothstep(-0.1, 0.4, nl) * 0.42;
            col += alb * 0.008;
            // by day the sky is in front of it: the dark side vanishes into blue
            float a = mix(1.0, clamp(0.12 + diff * 1.15, 0.0, 0.92), uDay);
            gl_FragColor = vec4(col, a);
          }`,
      }),
    );
    giantBody.renderOrder = -5;
    this.giant.add(giantBody);
    const ringGeo = new THREE.RingGeometry(260, 470, 160, 1);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.ShaderMaterial({
        uniforms: this.bodyUniforms,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
        vertexShader: `varying vec2 vP; varying vec3 vWP; void main(){ vP = position.xy; vWP = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uDay; uniform vec3 uHorizon, uSunDir, uGiantPos; varying vec2 vP; varying vec3 vWP;
          ${NOISE_GLSL}
          ${RING_GLSL}
          void main(){
            float r = length(vP);
            float a = ringDensity(r);
            float b = vnoise2(vec2(r * 0.09, 0.5));
            vec3 col = mix(vec3(0.5, 0.44, 0.38), vec3(0.78, 0.72, 0.65), b) * 1.2;
            // the planet's shadow falls across the rings
            vec3 p = vWP - uGiantPos;
            float along = dot(p, uSunDir);
            float off = length(p - uSunDir * along);
            float sh = along < 0.0 ? smoothstep(205.0, 216.0, off) : 1.0;
            col *= sh * 0.96 + 0.04;
            gl_FragColor = vec4(col, a * mix(0.92, 0.5, uDay) * mix(0.3, 1.0, sh));
          }`,
      }),
    );
    ring.renderOrder = -4;
    ring.rotation.x = -Math.PI / 2 + 0.38;
    ring.rotation.y = 0.25;
    this.giant.add(ring);
    this.giant.rotation.z = 0.35;
    this.group.add(this.giant);
    this.giant.updateMatrix(); ring.updateMatrix();
    this.bodyUniforms.uRingN.value.set(0, 0, 1).transformDirection(ring.matrix).transformDirection(this.giant.matrix);
  }

  /** hours: 0-24. */
  update(hours: number, camPos: THREE.Vector3, time: number) {
    const a = ((hours - 6) / 24) * Math.PI * 2;
    this.sunDir.set(Math.cos(a) * 0.82, Math.sin(a), 0.42 + Math.cos(a) * 0.12).normalize();
    const e = this.sunDir.y;
    const dayK = smoothstep(-0.02, 0.32, e);
    const duskK = 1 - smoothstep(0.05, 0.38, Math.abs(e + 0.02));
    const nightK = smoothstep(0.02, -0.2, e);
    this.zenith.copy(KEYS.day.zenith).multiplyScalar(dayK).add(tmp.copy(KEYS.night.zenith).multiplyScalar(nightK));
    this.horizon.copy(KEYS.day.horizon).multiplyScalar(dayK).add(tmp.copy(KEYS.night.horizon).multiplyScalar(nightK));
    const wsum = dayK + nightK + 1e-4;
    this.zenith.multiplyScalar(1 / wsum);
    this.horizon.multiplyScalar(1 / wsum);
    this.zenith.lerp(KEYS.dusk.zenith, duskK * 0.6);
    this.horizon.lerp(KEYS.dusk.horizon, duskK * 0.8);
    this.sunColor.copy(KEYS.day.sun).lerp(KEYS.dusk.sun, duskK);
    this.day = smoothstep(-0.12, 0.2, e);
    this.uniforms.uDay.value = this.day;
    this.uniforms.uTime.value = time;
    this.bodyUniforms.uDay.value = this.day;
    this.bodyUniforms.uTime.value = time;

    this.group.position.copy(camPos);
    this.moon.position.copy(this.moonDir).multiplyScalar(1100);
    this.giant.position.copy(this.giantDir).multiplyScalar(1250);
    this.bodyUniforms.uGiantPos.value.copy(this.giant.position).add(camPos);
  }

  hiddenFromAO(): THREE.Object3D[] {
    return [this.group];
  }
}
const tmp = new THREE.Color();
