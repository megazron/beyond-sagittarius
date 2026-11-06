import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import type { Quality } from './quality';
import { setMaxAnisotropy } from './assets';
import { installSoftShadows } from './softShadows';

const QUAD_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Display-referred grade: film curve, split tone, vignette, aberration, grain. */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.26 },
    uGrain: { value: 0.02 },
    uAberration: { value: 0.0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    // title-sequence lens: all zero outside it, and each costs nothing while zero
    uZoom: { value: 0 },
    uZoomAt: { value: new THREE.Vector2(0.5, 0.5) },
    uFlash: { value: new THREE.Vector3(0, 0, 0) },
    uInk: { value: 0 },
    uInkDark: { value: new THREE.Vector3(0.02, 0.02, 0.05) },
    uInkLight: { value: new THREE.Vector3(1, 1, 1) },
    uLines: { value: 0 },
  },
  vertexShader: QUAD_VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uAberration, uZoom, uInk, uLines; uniform vec3 uTint, uFlash, uInkDark, uInkLight; uniform vec2 uZoomAt;
    varying vec2 vUv;
    float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    // Print-film response, per channel: lifted toe, soft shoulder (what a 3D LUT would bake in).
    vec3 filmCurve(vec3 x){
      vec3 t = x * x * (3.0 - 2.0 * x);
      vec3 toe = pow(max(x, 0.0), vec3(1.12));
      return mix(toe, t, 0.34) * 0.985 + 0.012;
    }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec3 col;
      if (uAberration > 0.0) {
        vec2 o = d * r2 * uAberration * 3.0;   // only towards the corners, like a real lens
        col = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
      } else col = texture2D(tDiffuse, vUv).rgb;
      if (uZoom > 0.0) {
        // cheap motion blur for fast moves: everything smears away from one point
        vec2 dz = (vUv - uZoomAt) * uZoom;
        float j = ign(gl_FragCoord.xy);
        vec3 acc = col;
        for (int i = 1; i <= 9; i++) acc += texture2D(tDiffuse, vUv - dz * ((float(i) - j) / 9.0)).rgb;
        col = acc / 10.0;
      }
      col *= uTint;
      col = clamp(col, 0.0, 1.0);
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // saturation falls off in deep shadow and bright highlights, as on film stock
      float satK = 1.06 - 0.22 * smoothstep(0.55, 1.0, lum) - 0.14 * smoothstep(0.16, 0.0, lum);
      col = mix(vec3(lum), col, satK);
      col = filmCurve(col);
      // split tone: faint teal in the shadows, faint warmth in the highlights
      col *= mix(vec3(0.965, 1.0, 1.03), vec3(1.022, 1.0, 0.968), smoothstep(0.08, 0.7, lum));
      float v = smoothstep(0.95, 0.25, length(d * vec2(1.1, 1.0)));
      col *= mix(1.0 - uVignette, 1.0, v);
      // luminance grain, strongest in the midtones
      float g = ign(gl_FragCoord.xy + fract(uTime * 7.31) * 97.0) - 0.5;
      col += g * uGrain * (1.0 - 0.75 * abs(lum * 2.0 - 1.0));
      if (uLines > 0.0) {
        // speed lines: thin rays that come and go, heavier towards the edges
        float ang = atan(d.y, d.x * 1.78);
        float ray = fract(sin(floor(ang * 70.0) * 12.9898 + floor(uTime * 24.0) * 4.1) * 43758.5453);
        float ln = step(1.0 - 0.28 * uLines, ray) * smoothstep(0.12, 0.42, sqrt(r2) * (0.8 + ray * 0.5));
        col = mix(col, vec3(1.0), ln * 0.55);
      }
      if (uInk > 0.0) {
        // impact frame: two flat tones for a few frames on the big hits
        float ink = smoothstep(0.26, 0.34, dot(col, vec3(0.2126, 0.7152, 0.0722)));
        col = mix(col, mix(uInkDark, uInkLight, ink), uInk);
      }
      col += uFlash;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/** Replaces NaN/Inf pixels so a single bad sample can't be smeared over the frame by bloom. */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: QUAD_VS,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(min(c.rgb, vec3(64.0)), c.a); }`,
};

const fullscreen = (uniforms: Record<string, THREE.IUniform>, fragmentShader: string, defines: Record<string, unknown> = {}) =>
  new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VS, fragmentShader, defines, depthTest: false, depthWrite: false, blending: THREE.NoBlending });

const RECONSTRUCT = /* glsl */ `
  uniform sampler2D tDepth; uniform mat4 uInvProj, uCamWorld;
  vec3 viewAt(vec2 uv, float z){ vec4 c = uInvProj * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); return c.xyz / c.w; }
  vec3 worldAt(vec2 uv, float z){ return (uCamWorld * vec4(viewAt(uv, z), 1.0)).xyz; }
`;

/**
 * Renders the scene into a buffer that keeps its depth texture (optionally
 * multisampled) so later passes can read depth without drawing the scene twice.
 */
class ScenePass extends Pass {
  rt: THREE.WebGLRenderTarget;
  scene: THREE.Scene = new THREE.Scene();
  camera: THREE.Camera = new THREE.PerspectiveCamera();
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;

  constructor(w: number, h: number, samples: number) {
    super();
    const depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthTexture, depthBuffer: true });
    this.mat = fullscreen({ tDiffuse: { value: null } }, `uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }`);
    this.quad = new FullScreenQuad(this.mat);
  }

  setSize(w: number, h: number) { this.rt.setSize(w, h); }

  render(r: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget) {
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, this.camera);
    this.mat.uniforms.tDiffuse.value = this.rt.texture;
    r.setRenderTarget(write);
    this.quad.render(r);
  }
}

/** What the world hands to the renderer (via scene.userData.post) to light the air. */
export interface PostSource {
  sun: SunLight;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  /** Sunlit-air density per metre at ground level, and its falloff with height. */
  density: number;
  fall: number;
  base: number;
  /** Multiplies the sunlit air, 0 hides it (e.g. sun below the horizon). */
  strength: number;
}

/**
 * Volumetric light. A short raymarch at reduced resolution through the air
 * between the camera and the first surface, testing the real sun shadow map at
 * every step: canopy gaps become actual shafts. Dithered per pixel and resolved
 * by the depth-aware composite below.
 */
class VolumetricPass extends Pass {
  private rt: THREE.WebGLRenderTarget;
  private march: THREE.ShaderMaterial;
  private comp: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  source: PostSource | null = null;
  camera: THREE.Camera | null = null;

  constructor(private depth: THREE.Texture, private scale: number, steps: number, pcss: boolean) {
    super();
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.march = fullscreen({
      tDepth: { value: depth }, tShadow: { value: null },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uShadow0: { value: new THREE.Matrix4() }, uShadow1: { value: new THREE.Matrix4() },
      uCam: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
      uDensity: { value: 0 }, uFall: { value: 0.05 }, uBase: { value: 0 }, uSplit: { value: 60 }, uMax: { value: 200 }, uTime: { value: 0 },
    }, /* glsl */ `
      ${RECONSTRUCT}
      #ifdef RAW_SHADOW
        uniform sampler2D tShadow;
      #else
        uniform highp sampler2DShadow tShadow;
      #endif
      uniform mat4 uShadow0, uShadow1; uniform vec3 uCam, uSunDir, uSunCol;
      uniform float uDensity, uFall, uBase, uSplit, uMax, uTime;
      varying vec2 vUv;
      float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      float lit(vec3 p, float t){
        vec4 c = (t < uSplit ? uShadow0 : uShadow1) * vec4(p, 1.0);
        c.xyz /= c.w;
        if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
        #ifdef RAW_SHADOW
          return step(c.z, texture2D(tShadow, c.xy).r);
        #else
          return texture(tShadow, c.xyz);
        #endif
      }
      float hg(float c, float g){ float k = 1.0 + g * g - 2.0 * g * c; return (1.0 - g * g) / (12.566 * k * sqrt(k)); }
      void main(){
        float z = texture2D(tDepth, vUv).r;
        vec3 wp = worldAt(vUv, z);
        vec3 rd = wp - uCam; float dist = length(rd); rd /= max(dist, 1e-3);
        float end = z >= 1.0 ? uMax : min(dist, uMax);
        float dt = end / float(STEPS);
        float t = dt * ign(gl_FragCoord.xy + fract(uTime) * 61.0);
        float T = 1.0, acc = 0.0;
        for (int i = 0; i < STEPS; i++) {
          vec3 p = uCam + rd * t;
          float d = uDensity * exp(-max(p.y - uBase, -8.0) * uFall);
          acc += T * lit(p, t) * d * dt;
          T *= exp(-d * dt * 0.35);
          t += dt;
        }
        float c = dot(rd, uSunDir);
        float phase = hg(c, 0.72) * 0.75 + hg(c, -0.2) * 0.25;
        gl_FragColor = vec4(uSunCol * acc * phase * 12.566, T);
      }`, { STEPS: steps, ...(pcss ? { RAW_SHADOW: '' } : {}) });
    this.comp = fullscreen({
      tDiffuse: { value: null }, tVol: { value: this.rt.texture }, tDepth: { value: depth },
      uNear: { value: 0.1 }, uFar: { value: 1000 }, uTexel: { value: new THREE.Vector2() },
    }, /* glsl */ `
      uniform sampler2D tDiffuse, tVol, tDepth; uniform float uNear, uFar; uniform vec2 uTexel;
      varying vec2 vUv;
      float lin(float z){ return uNear * uFar / (uFar - z * (uFar - uNear)); }
      void main(){
        float z0 = lin(texture2D(tDepth, vUv).r);
        vec4 acc = vec4(0.0); float w = 0.0;
        // joint bilateral: taps across a depth edge don't count, so shafts stay behind the trees
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 uv = vUv + vec2(float(x), float(y)) * uTexel * 1.25;
          float zi = lin(texture2D(tDepth, uv).r);
          float k = exp(-abs(zi - z0) / (0.12 * z0 + 0.1)) * (x == 0 && y == 0 ? 2.0 : 1.0) + 1e-4;
          acc += texture2D(tVol, uv) * k; w += k;
        }
        acc /= w;
        vec4 c = texture2D(tDiffuse, vUv);
        gl_FragColor = vec4(c.rgb * acc.a + acc.rgb, c.a);
      }`);
  }

  setSize(w: number, h: number) {
    const lw = Math.max(1, Math.round(w * this.scale)), lh = Math.max(1, Math.round(h * this.scale));
    this.rt.setSize(lw, lh);
    this.comp.uniforms.uTexel.value.set(1 / lw, 1 / lh);
  }

  render(r: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const s = this.source, cam = this.camera as THREE.PerspectiveCamera;
    const u = this.comp.uniforms, m = this.march.uniforms;
    const map = s?.sun.shadow.map;
    if (!s || !cam || !map?.depthTexture || s.strength <= 0.001) {
      // nothing to light: keep the frame unchanged
      this.needsSwap = false;
      return;
    }
    this.needsSwap = true;
    const sh = s.sun.shadow as unknown as { getMatrix(i: number): THREE.Matrix4; camera: THREE.Camera; _cascadeSplits: number[] };
    m.tShadow.value = map.depthTexture;
    m.uInvProj.value.copy(cam.projectionMatrixInverse);
    m.uCamWorld.value.copy(cam.matrixWorld);
    m.uShadow0.value.copy(sh.getMatrix(0));
    m.uShadow1.value.copy(sh.getMatrix(1));
    m.uCam.value.setFromMatrixPosition(cam.matrixWorld);
    m.uSunDir.value.copy(s.sunDir);
    m.uSunCol.value.copy(s.sunColor).multiplyScalar(s.strength);
    m.uDensity.value = s.density;
    m.uFall.value = s.fall;
    m.uBase.value = s.base;
    m.uSplit.value = sh._cascadeSplits[1];
    m.uMax.value = sh._cascadeSplits[2];
    m.uTime.value = (m.uTime.value + 0.37) % 1;
    this.quad.material = this.march;
    r.setRenderTarget(this.rt);
    this.quad.render(r);
    u.tDiffuse.value = read.texture;
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    this.quad.material = this.comp;
    r.setRenderTarget(write);
    this.quad.render(r);
  }
}

/** Thin-lens depth of field, one spiral gather in linear HDR so highlights bloom into bokeh discs. */
class DofPass extends Pass {
  private mat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  camera: THREE.Camera | null = null;
  focus = 0;
  aperture = 0;

  constructor(depth: THREE.Texture, step: number) {
    super();
    this.mat = fullscreen({
      tDiffuse: { value: null }, tDepth: { value: depth }, uTexel: { value: new THREE.Vector2() },
      uNear: { value: 0.1 }, uFar: { value: 1000 }, uFocus: { value: 5 }, uAperture: { value: 0 }, uMaxPx: { value: 16 },
    }, /* glsl */ `
      uniform sampler2D tDiffuse, tDepth; uniform vec2 uTexel; uniform float uNear, uFar, uFocus, uAperture, uMaxPx;
      varying vec2 vUv;
      float lin(float z){ return uNear * uFar / (uFar - z * (uFar - uNear)); }
      float cocPx(float d){ return min(uAperture * abs(1.0 - uFocus / d) / uTexel.y, uMaxPx); }
      void main(){
        float d0 = lin(texture2D(tDepth, vUv).r);
        float c0 = cocPx(d0);
        vec3 col = texture2D(tDiffuse, vUv).rgb; float tot = 1.0;
        float rad = STEP, ang = 0.0;
        for (int i = 0; i < 160; i++) {
          if (rad >= uMaxPx) break;
          ang += 2.39996;
          vec2 uv = vUv + vec2(cos(ang), sin(ang)) * uTexel * rad;
          float d = lin(texture2D(tDepth, uv).r);
          float c = cocPx(d);
          if (d > d0) c = clamp(c, 0.0, c0 * 2.0);   // the sharp subject must not smear onto its background
          float m = smoothstep(rad - 0.5, rad + 0.5, c);
          col += mix(col / tot, texture2D(tDiffuse, uv).rgb, m);
          tot += 1.0;
          rad += STEP / rad;
        }
        gl_FragColor = vec4(col / tot, 1.0);
      }`, { STEP: step.toFixed(2) });
    this.quad = new FullScreenQuad(this.mat);
  }

  setSize(w: number, h: number) {
    this.mat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.mat.uniforms.uMaxPx.value = Math.max(6, h * 0.02);
  }

  render(r: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const cam = this.camera as THREE.PerspectiveCamera, u = this.mat.uniforms;
    u.tDiffuse.value = read.texture;
    u.uNear.value = cam.near; u.uFar.value = cam.far;
    u.uFocus.value = this.focus; u.uAperture.value = this.aperture;
    r.setRenderTarget(write);
    this.quad.render(r);
  }
}

/**
 * Temporal anti-aliasing and camera motion blur (Cinematic preset). Both
 * reproject pixels through depth and last frame's view-projection.
 */
class TemporalPass extends Pass {
  private hist: THREE.WebGLRenderTarget[];
  private cur = 0;
  private taa: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  private copy: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private prevVP = new THREE.Matrix4();
  private vp = new THREE.Matrix4();
  private valid = false;
  private prevCam = new THREE.Vector3();
  camera: THREE.Camera | null = null;

  constructor(depth: THREE.Texture, private useTaa: boolean, private useBlur: boolean) {
    super();
    const mk = () => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.hist = [mk(), mk()];
    const common = () => ({
      tDiffuse: { value: null }, tDepth: { value: depth }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uPrevVP: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() },
    });
    const PREV = /* glsl */ `
      uniform mat4 uPrevVP; uniform vec2 uTexel; uniform sampler2D tDiffuse;
      varying vec2 vUv;
      vec2 prevUv(vec2 uv){ float z = texture2D(tDepth, uv).r; vec4 c = uPrevVP * vec4(worldAt(uv, z), 1.0); return c.xy / c.w * 0.5 + 0.5; }`;
    this.taa = fullscreen({ ...common(), tHist: { value: null }, uBlend: { value: 0.9 } }, /* glsl */ `
      ${RECONSTRUCT} ${PREV}
      uniform sampler2D tHist; uniform float uBlend;
      vec3 tm(vec3 c){ return c / (1.0 + max(c.r, max(c.g, c.b))); }
      vec3 itm(vec3 c){ return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
      void main(){
        vec3 c = tm(texture2D(tDiffuse, vUv).rgb);
        vec3 lo = c, hi = c;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec3 s = tm(texture2D(tDiffuse, vUv + vec2(float(x), float(y)) * uTexel).rgb);
          lo = min(lo, s); hi = max(hi, s);
        }
        vec2 p = prevUv(vUv);
        float k = uBlend;
        if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) k = 0.0;
        vec3 h = clamp(tm(texture2D(tHist, p).rgb), lo, hi);
        gl_FragColor = vec4(itm(mix(c, h, k)), 1.0);
      }`);
    this.blur = fullscreen({ ...common(), uShutter: { value: 0.45 } }, /* glsl */ `
      ${RECONSTRUCT} ${PREV}
      uniform float uShutter;
      void main(){
        vec2 v = (vUv - prevUv(vUv)) * uShutter;
        float l = length(v);
        v *= min(1.0, 0.04 / max(l, 1e-5));
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        if (l > uTexel.y * 0.75) {
          float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
          for (int i = 0; i < 8; i++) c += texture2D(tDiffuse, vUv + v * ((float(i) + j) / 8.0 - 0.5)).rgb;
          c /= 9.0;
        }
        gl_FragColor = vec4(c, 1.0);
      }`);
    this.copy = fullscreen({ tDiffuse: { value: null } }, `uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }`);
  }

  setSize(w: number, h: number) {
    this.hist.forEach((t) => t.setSize(w, h));
    this.taa.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.blur.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.valid = false;
  }

  /** Sub-pixel camera offset for this frame (Halton 2,3). */
  jitter(cam: THREE.PerspectiveCamera, w: number, h: number, frame: number) {
    if (!this.useTaa) return;
    const hal = (i: number, b: number) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
    const i = (frame % 8) + 1;
    cam.setViewOffset(w, h, hal(i, 2) - 0.5, hal(i, 3) - 0.5, w, h);
  }

  render(r: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const cam = this.camera as THREE.PerspectiveCamera;
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const pos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    // a cut: forget the past instead of smearing it over the new shot
    const cut = !this.valid || pos.distanceTo(this.prevCam) > 3;
    for (const m of [this.taa, this.blur]) {
      m.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
      m.uniforms.uCamWorld.value.copy(cam.matrixWorld);
      m.uniforms.uPrevVP.value.copy(cut ? this.vp : this.prevVP);
    }
    let src = read.texture;
    if (this.useTaa) {
      const next = this.hist[this.cur ^ 1];
      this.taa.uniforms.tDiffuse.value = src;
      this.taa.uniforms.tHist.value = this.hist[this.cur].texture;
      this.taa.uniforms.uBlend.value = cut ? 0 : 0.9;
      this.quad.material = this.taa;
      r.setRenderTarget(next);
      this.quad.render(r);
      this.cur ^= 1;
      src = next.texture;
    }
    if (this.useBlur && !cut) {
      this.blur.uniforms.tDiffuse.value = src;
      this.quad.material = this.blur;
    } else {
      this.copy.uniforms.tDiffuse.value = src;
      this.quad.material = this.copy;
    }
    r.setRenderTarget(write);
    this.quad.render(r);
    this.prevVP.copy(this.vp);
    this.prevCam.copy(pos);
    this.valid = true;
  }
}

export class Renderer {
  /** The one renderer of the page; lets cutscenes drive the lens without wiring. */
  static current: Renderer | null = null;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  renderPass: RenderPass | ScenePass;
  bloom: UnrealBloomPass;
  ao: GTAOPass | null = null;
  final: ShaderPass;
  pixelRatio: number;
  aoHidden: THREE.Object3D[] = [];
  private volumetric: VolumetricPass | null = null;
  private dof: DofPass | null = null;
  private temporal: TemporalPass | null = null;
  private frameTimes: number[] = [];
  private lastAdjust = 0;
  private frame = 0;
  private shed = 0;
  private aoWanted = false;

  constructor(canvas: HTMLCanvasElement, public quality: Quality) {
    Renderer.current = this;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // PCSS reads raw depth (Basic maps + a custom filter); otherwise hardware PCF with a Vogel disk
    this.renderer.shadowMap.type = quality.pcss ? THREE.BasicShadowMap : THREE.PCFShadowMap;
    if (quality.pcss) installSoftShadows();
    setMaxAnisotropy(Math.min(quality.name === 'mobile' ? 4 : 16, this.renderer.capabilities.getMaxAnisotropy()));

    const dummyScene = new THREE.Scene();
    const dummyCam = new THREE.PerspectiveCamera();
    const W = window.innerWidth, H = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);

    let depth: THREE.Texture | null = null;
    if (quality.post) {
      const sp = new ScenePass(W, H, quality.msaa);
      depth = sp.rt.depthTexture;
      this.renderPass = sp;
    } else {
      this.renderPass = new RenderPass(dummyScene, dummyCam);
    }
    this.composer.addPass(this.renderPass);

    if (quality.ao && depth) {
      // GTAO runs on the scene's own depth: no second geometry pass, and grass and wind count too
      this.ao = new GTAOPass(dummyScene, dummyCam, W, H, { depthTexture: depth as THREE.DepthTexture });
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.blendIntensity = 0.95;
      const full = quality.aoScale >= 1;
      this.ao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: quality.aoSamples });
      // Depth is too coarse for horizons far away, and AO is invisible there anyway: skip those pixels.
      const gm = this.ao.gtaoMaterial;
      gm.fragmentShader = gm.fragmentShader
        .replace('vec3 viewNormal = getViewNormal(vUv);', 'if (-viewPos.z > 130.0) { float ao = 1.0; gl_FragColor = FRAGMENT_OUTPUT; return; }\n vec3 viewNormal = getViewNormal(vUv);')
        .replace('ao = pow(ao, scale);', 'ao = mix(pow(ao, scale), 1.0, smoothstep(70.0, 130.0, -viewPos.z));');
      gm.needsUpdate = true;
      if (!full) {
        // Web: AO buffers at reduced resolution, bilinearly upsampled in the blend.
        const k = Math.max(0.25, quality.aoScale);
        this.ao.updatePdMaterial({ samples: 6, rings: 2 });
        const setSize = this.ao.setSize.bind(this.ao);
        this.ao.setSize = (w: number, h: number) => setSize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
        this.ao.setSize(W, H);
      }
      this.composer.addPass(this.ao);
    }
    if (depth && quality.volumetricScale > 0) {
      this.volumetric = new VolumetricPass(depth, quality.volumetricScale, quality.volumetricSteps, quality.pcss);
      this.composer.addPass(this.volumetric);
    }
    this.composer.addPass(new ShaderPass(SanitizeShader));
    if (depth && (quality.taa || quality.motionBlur)) {
      this.temporal = new TemporalPass(depth, quality.taa, quality.motionBlur);
      this.composer.addPass(this.temporal);
    }
    if (depth && quality.dofStep > 0) {
      this.dof = new DofPass(depth, quality.dofStep);
      this.dof.enabled = false;
      this.composer.addPass(this.dof);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), quality.bloomStrength * 0.32, 0.5, 1.15);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    if (quality.fxaa) this.composer.addPass(new FXAAPass());
    this.final = new ShaderPass(FinalShader);
    this.final.uniforms.uGrain.value = quality.grain;
    this.final.uniforms.uAberration.value = quality.aberration;
    this.composer.addPass(this.final);
    this.composer.setPixelRatio(this.pixelRatio);

    window.addEventListener('resize', () => this.resize());
  }

  setScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera, aoEnabled: boolean) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    if (this.ao) {
      this.ao.scene = scene;
      this.ao.camera = camera;
      this.aoWanted = aoEnabled;
      this.ao.enabled = aoEnabled && this.shed < 1;
    }
    if (this.volumetric) this.volumetric.camera = camera;
    if (this.dof) this.dof.camera = camera;
    if (this.temporal) this.temporal.camera = camera;
  }

  /**
   * Lens for the next frames: focus distance in metres and aperture as the blur
   * diameter (fraction of screen height) of something infinitely far. 0 = off.
   */
  setDof(focusDistance: number, aperture: number) {
    if (!this.dof) return;
    this.dof.focus = focusDistance;
    this.dof.aperture = aperture;
    this.dof.enabled = aperture > 0;
  }

  /** Title-sequence lens: zoom blur (with its centre), additive flash, two-tone ink, speed lines. */
  setFilm(f: { zoom?: number; at?: [number, number]; flash?: [number, number, number]; ink?: number; dark?: THREE.Color; light?: THREE.Color; lines?: number } = {}) {
    const u = this.final.uniforms;
    u.uZoom.value = f.zoom ?? 0;
    u.uZoomAt.value.set(...(f.at ?? [0.5, 0.5]));
    u.uFlash.value.set(...(f.flash ?? [0, 0, 0]));
    u.uInk.value = f.ink ?? 0;
    if (f.dark) u.uInkDark.value.set(f.dark.r, f.dark.g, f.dark.b);
    if (f.light) u.uInkLight.value.set(f.light.r, f.light.g, f.light.b);
    u.uLines.value = f.lines ?? 0;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const cam = this.renderPass.camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
  }

  /**
   * Warm-up runs the real post chain, off screen at a tiny size. Only that compiles
   * the exact shader variants (render-target output, depth and normal overrides)
   * and uploads the buffers and textures a scene needs; compile() alone does not.
   */
  warmBegin() {
    this.composer.renderToScreen = false;
    this.composer.setPixelRatio(1);
    this.composer.setSize(96, 54);
  }
  warm(scene: THREE.Scene, cam: THREE.PerspectiveCamera, ao: boolean) {
    this.setScene(scene, cam, ao);
    if (this.volumetric) this.volumetric.source = (scene.userData.post as PostSource | undefined) ?? null;
    this.composer.render(0.016);
  }
  warmEnd() {
    this.composer.renderToScreen = true;
    this.composer.setPixelRatio(this.pixelRatio);
    this.resize();
  }

  render(dt: number, time: number) {
    this.final.uniforms.uTime.value = time;
    if (this.volumetric) this.volumetric.source = (this.renderPass.scene.userData.post as PostSource | undefined) ?? null;
    const cam = this.renderPass.camera as THREE.PerspectiveCamera;
    const jittered = !!this.temporal && this.quality.taa && cam.isPerspectiveCamera;
    if (jittered) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.temporal!.jitter(cam, size.x, size.y, this.frame++);
    }
    this.composer.render(dt);
    if (jittered) cam.clearViewOffset();
    if (this.quality.dynamicResolution) this.adaptResolution(dt, time);
  }

  private softwareCached: boolean | null = null;
  private get softwareGL() {
    if (this.softwareCached === null) {
      const gl = this.renderer.getContext();
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      this.softwareCached = /swiftshader|llvmpipe|software/i.test(String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''));
    }
    return this.softwareCached;
  }

  /**
   * Holds the preset's frame rate: reacts within about a second by lowering the
   * pixel ratio; if that is near the floor it sheds the optional passes first
   * lost in a blind test (AO, then volumetrics), and restores all of it with headroom.
   */
  private adaptResolution(dt: number, time: number) {
    // software GL measures nothing useful, so its test shots stay sharp; a real GPU
    // always adapts, even when automated, so GPU benchmarks see what players get
    if (this.softwareGL) return;
    const q = this.quality;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 24) this.frameTimes.shift();
    if (time - this.lastAdjust < 0.8 || this.frameTimes.length < 24) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const budget = 1 / q.fpsTarget;
    const maxPr = Math.min(window.devicePixelRatio || 1, q.maxPixelRatio);
    let pr = this.pixelRatio;
    if (avg > budget * 1.04) {
      const over = avg / budget;
      const floor = q.minPixelRatio + (maxPr - q.minPixelRatio) * 0.45;
      if (pr <= floor && this.shed < 2) this.setShed(this.shed + 1);
      else pr = Math.max(q.minPixelRatio, pr - (over > 1.3 ? 0.12 : 0.06));
    } else if (avg < budget * 0.85) {
      if (pr < maxPr) pr = Math.min(maxPr, pr + 0.04);
      else if (this.shed > 0) this.setShed(this.shed - 1);
    }
    this.lastAdjust = time;
    this.frameTimes.length = 0;
    if (Math.abs(pr - this.pixelRatio) > 0.005) {
      this.pixelRatio = pr;
      this.renderer.setPixelRatio(pr);
      this.composer.setPixelRatio(pr);
    }
  }

  /** 0 = everything on, 1 = AO off, 2 = AO and volumetrics off. */
  private setShed(n: number) {
    this.shed = n;
    if (this.ao) this.ao.enabled = this.aoWanted && n < 1;
    if (this.volumetric) this.volumetric.enabled = n < 2;
  }
}
