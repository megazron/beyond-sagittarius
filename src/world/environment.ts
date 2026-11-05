import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { Quality } from '../core/quality';
import type { Sky } from './sky';

/**
 * Image-based lighting that follows the alien day–night cycle.
 *
 * A tiny capture scene holds one sphere whose shader combines the live sky
 * colours (zenith, horizon, sun, the giant planet) with the *structure* of a
 * CC0 Poly Haven HDRI (misty forest: bright canopy gaps, dark trunks, ground
 * bounce). Only the HDRI's normalised luminance (plus a hint of its chroma) is
 * used, so reflections and ambient light stay in the planet's palette. The
 * capture is re-filtered into a PMREM whenever the sky has changed enough.
 * Mobile skips the HDRI download and uses the gradient alone.
 */
export class Environment {
  texture: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private target: THREE.WebGLRenderTarget | null = null;
  private scene = new THREE.Scene();
  private uniforms = {
    uHdr: { value: null as THREE.Texture | null },
    uHasHdr: { value: 0 },
    uHdrMeanUp: { value: 1 },
    uHdrMeanDown: { value: 1 },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color() },
    uGiantDir: { value: new THREE.Vector3() },
    uGround: { value: new THREE.Color() },
    uDay: { value: 1 },
  };
  private dirty = true;
  private lastCapture = -1e9;
  private lastSun = new THREE.Vector3(0, -2, 0);

  constructor(private q: Quality, private sky: Sky) {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uHdr; uniform float uHasHdr, uHdrMeanUp, uHdrMeanDown, uDay;
        uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uGiantDir, uGround;
        varying vec3 vDir;
        const float PI = 3.14159265;
        void main(){
          vec3 d = normalize(vDir);
          float y = d.y;
          vec3 sky = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.65, max(y, 0.0)), 0.65));
          float sd = max(dot(d, uSunDir), 0.0);
          float sunUp = smoothstep(-0.12, 0.05, uSunDir.y);
          sky += uSunColor * (pow(sd, 24.0) * 2.5 + pow(sd, 4.0) * 0.25) * sunUp;
          // the giant ringed planet: a broad lilac reflection source
          float gd = dot(d, normalize(uGiantDir));
          sky += vec3(0.5, 0.45, 0.7) * smoothstep(0.975, 0.99, gd) * (0.25 + 0.5 * uDay);
          vec3 col = mix(uGround, sky, smoothstep(-0.08, 0.06, y));
          if (uHasHdr > 0.5) {
            vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(y, -1.0, 1.0)) / PI + 0.5);
            vec3 h = texture2D(uHdr, uv).rgb;
            float l = dot(h, vec3(0.2126, 0.7152, 0.0722));
            float mean = y > 0.0 ? uHdrMeanUp : uHdrMeanDown;
            float k = clamp(l / mean, 0.0, 4.0);
            vec3 chroma = h / max(l, 1e-4);
            // structure from the photo, colour from the alien sky
            col *= mix(vec3(1.0), k * mix(vec3(1.0), chroma, 0.15), 0.75);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat);
    sphere.frustumCulled = false;
    this.scene.add(sphere);

    if (q.hdri) {
      new HDRLoader().load(`${import.meta.env.BASE_URL}hdri/sky_1k.hdr`, (tex) => {
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        const [up, down] = hemiMeans(tex);
        this.uniforms.uHdrMeanUp.value = up;
        this.uniforms.uHdrMeanDown.value = down;
        this.uniforms.uHdr.value = tex;
        this.uniforms.uHasHdr.value = 1;
        this.dirty = true;
      }, undefined, () => console.warn('[env] HDRI failed to load; using the sky gradient'));
    }
  }

  /** Re-captures the environment when the sky has changed enough; returns the PMREM texture. */
  update(renderer: THREE.WebGLRenderer, time: number, ground: THREE.Color): THREE.Texture | null {
    const s = this.sky;
    const moved = this.lastSun.distanceToSquared(s.sunDir) > 0.0004;
    const interval = this.q.name === 'mobile' ? 4 : this.q.name === 'web' ? 1 : 0.5;
    if (!this.dirty && !(moved && time - this.lastCapture > interval)) return this.texture;
    const u = this.uniforms;
    u.uZenith.value.copy(s.zenith);
    u.uHorizon.value.copy(s.horizon);
    u.uSunDir.value.copy(s.sunDir);
    u.uSunColor.value.copy(s.sunColor);
    u.uGiantDir.value.copy(s.giantDir);
    u.uGround.value.copy(ground);
    u.uDay.value = s.day;
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(renderer);
    const next = this.pmrem.fromScene(this.scene, 0, 0.1, 100, { size: 256 });
    this.target?.dispose();
    this.target = next;
    this.texture = next.texture;
    this.lastSun.copy(s.sunDir);
    this.lastCapture = time;
    this.dirty = false;
    return this.texture;
  }
}

/** Mean luminance of the upper and lower halves of an equirectangular HDR (half-float RGBA). */
function hemiMeans(tex: THREE.DataTexture): [number, number] {
  const { data, width, height } = tex.image as { data: Uint16Array | Float32Array; width: number; height: number };
  const half = data instanceof Uint16Array;
  const f = (v: number) => (half ? THREE.DataUtils.fromHalfFloat(v) : v);
  let up = 0, nu = 0, down = 0, nd = 0;
  for (let y = 0; y < height; y += 4) {
    // equirect rows run top (north) to bottom; weight by cos(latitude)
    const lat = (0.5 - (y + 0.5) / height) * Math.PI;
    const w = Math.cos(lat);
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * 4;
      const l = 0.2126 * f(data[i]) + 0.7152 * f(data[i + 1]) + 0.0722 * f(data[i + 2]);
      if (lat > 0) { up += l * w; nu += w; } else { down += l * w; nd += w; }
    }
  }
  return [Math.max(up / Math.max(nu, 1e-6), 1e-4), Math.max(down / Math.max(nd, 1e-6), 1e-4)];
}
