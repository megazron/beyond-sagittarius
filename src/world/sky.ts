import * as THREE from 'three';
import { NOISE_GLSL } from '../core/glsl';
import { smoothstep } from '../core/noise';

const C = (h: number) => new THREE.Color(h);
const KEYS = {
  day: { zenith: C(0x1f78a8), horizon: C(0x9fd0d0), sun: C(0xfff1d6) },
  dusk: { zenith: C(0x30366e), horizon: C(0xf0895e), sun: C(0xffa060) },
  night: { zenith: C(0x03050d), horizon: C(0x101a30), sun: C(0x8090c0) },
};

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

  constructor() {
    this.uniforms = {
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
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSunDir, uZenith, uHorizon, uSunColor, uGiantDir; uniform float uDay, uTime;
          varying vec3 vDir;
          ${NOISE_GLSL}
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
            // high wispy clouds
            if (y > 0.0) {
              vec2 uv = d.xz / (y + 0.08) * 0.9 + vec2(uTime * 0.004, uTime * 0.002);
              float c = fbm2(uv * 1.3);
              float cl = smoothstep(0.58, 0.85, c) * smoothstep(0.0, 0.25, y);
              vec3 cc = mix(uHorizon * 1.15, uSunColor * 1.1, 0.35 + 0.35 * sd) * (0.25 + 0.85 * uDay);
              cc = mix(cc, vec3(0.06, 0.07, 0.12), night * 0.85);
              col = mix(col, cc, cl * 0.75);
            }
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.dome.scale.setScalar(1500);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    this.bodyUniforms = { uSunDir: { value: this.sunDir }, uDay: { value: 1 }, uHorizon: { value: this.horizon }, uTime: { value: 0 } };
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(55, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.bodyUniforms,
        fog: false,
        vertexShader: `varying vec3 vN; varying vec3 vWN; void main(){ vN = normalize(position); vWN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSunDir, uHorizon; uniform float uDay; varying vec3 vN; varying vec3 vWN;
          ${NOISE_GLSL}
          void main(){
            float cr = fbm3(vN * 4.0); float cr2 = vnoise(vN * 18.0);
            vec3 alb = mix(vec3(0.42, 0.4, 0.45), vec3(0.75, 0.72, 0.7), smoothstep(0.35, 0.65, cr));
            alb *= 0.8 + 0.35 * smoothstep(0.55, 0.75, cr2);
            alb = mix(alb, vec3(0.55, 0.65, 0.8), 0.15);
            float diff = smoothstep(-0.05, 0.5, dot(normalize(vWN), uSunDir));
            vec3 col = alb * (diff * 1.5 + 0.035);
            col = mix(col, uHorizon * 1.05, uDay * 0.22);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.group.add(this.moon);

    this.giant = new THREE.Group();
    const giantBody = new THREE.Mesh(
      new THREE.SphereGeometry(210, 96, 48),
      new THREE.ShaderMaterial({
        uniforms: this.bodyUniforms,
        fog: false,
        vertexShader: `varying vec3 vN; varying vec3 vWN; varying vec3 vWP; void main(){ vN = normalize(position); vWN = normalize(mat3(modelMatrix)*normal); vWP=(modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSunDir, uHorizon; uniform float uDay, uTime; varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
          ${NOISE_GLSL}
          void main(){
            vec3 n = normalize(vN);
            float w = fbm3(n * vec3(3.0, 1.0, 3.0) + vec3(uTime * 0.003, 0.0, 0.0)) * 2.2;
            float bands = sin(n.y * 26.0 + w * 2.8) * 0.5 + 0.5;
            vec3 alb = mix(vec3(0.24, 0.32, 0.55), vec3(0.72, 0.62, 0.8), bands);
            alb = mix(alb, vec3(0.85, 0.55, 0.45), smoothstep(0.55, 0.85, fbm3(n * 7.0 + w)) * 0.45);
            float storm = smoothstep(0.12, 0.0, length(n - normalize(vec3(0.4, -0.3, 0.86))));
            alb = mix(alb, vec3(0.9, 0.5, 0.35), storm * 0.8);
            vec3 N = normalize(vWN);
            float diff = smoothstep(-0.1, 0.55, dot(N, uSunDir));
            vec3 V = normalize(cameraPosition - vWP);
            vec3 col = alb * (diff * 1.35 + 0.03);
            col += vec3(0.5, 0.6, 1.0) * pow(1.0 - max(dot(N, V), 0.0), 3.0) * (0.25 + diff * 0.6);
            col = mix(col, uHorizon * 1.1, uDay * 0.3);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
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
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uDay; uniform vec3 uHorizon; varying vec2 vP;
          ${NOISE_GLSL}
          void main(){
            float r = length(vP);
            float b = vnoise2(vec2(r * 0.09, 0.5)) * 0.7 + vnoise2(vec2(r * 0.4, 3.0)) * 0.3;
            float gap = smoothstep(0.0, 6.0, abs(r - 385.0));
            float a = smoothstep(260.0, 285.0, r) * smoothstep(470.0, 440.0, r) * (0.2 + 0.75 * b) * gap;
            vec3 col = mix(vec3(0.75, 0.65, 0.55), vec3(0.95, 0.9, 0.85), b) * 1.1;
            col = mix(col, uHorizon * 1.2, uDay * 0.35);
            gl_FragColor = vec4(col, a * mix(0.95, 0.6, uDay));
          }`,
      }),
    );
    ring.rotation.x = -Math.PI / 2 + 0.38;
    ring.rotation.y = 0.25;
    this.giant.add(ring);
    this.giant.rotation.z = 0.35;
    this.group.add(this.giant);
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
  }

  hiddenFromAO(): THREE.Object3D[] {
    return [this.group];
  }
}
const tmp = new THREE.Color();
