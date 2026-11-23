import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { installGpuTimer } from './gputime';
const GPU_TIMER_ON = new URLSearchParams(location.search).has('gputime');
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import type { Quality } from './quality';
import { setMaxAnisotropy } from './assets';
import { installSoftShadows } from './softShadows';
import { heatSources } from './heat';

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
    // phones draw below the screen's own resolution: a light contrast-adaptive sharpen before the upscale
    uSharpen: { value: 0 },
  },
  vertexShader: QUAD_VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uAberration, uZoom, uInk, uLines, uSharpen; uniform vec3 uTint, uFlash, uInkDark, uInkLight; uniform vec2 uZoomAt;
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
      if (uSharpen > 0.0) {
        // four neighbours; the gain backs off where they already differ a lot, so edges do not ring
        vec2 px = 1.0 / vec2(textureSize(tDiffuse, 0));
        vec3 a = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb, b = texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb;
        vec3 c = texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb, e = texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
        vec3 mn = min(min(min(a, b), min(c, e)), col), mx = max(max(max(a, b), max(c, e)), col);
        float k = uSharpen * clamp(1.0 - (mx.g - mn.g) / max(mx.g, 1e-3), 0.0, 1.0);
        col = max(col + (col * 4.0 - a - b - c - e) * k * 0.25, 0.0);
      }
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
        float ray = fract(sin(floor(ang * 240.0) * 12.9898 + floor(uTime * 24.0) * 4.1) * 43758.5453);
        float ln = step(1.0 - 0.1 * uLines, ray) * smoothstep(0.3, 0.62, sqrt(r2) * (0.75 + ray * 0.45));
        col = mix(col, vec3(1.0), ln * 0.3);
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
  // (and the heat over a fire: the picture bends in a column of hot air over the nearest two fires, core/heat.ts; Web
  // and up, never on phones. uHeatA: the column's foot and top in uv; uHeatB: its half width (uv, by height) and how far
  // it bends. Nothing is done while no fire is near: one uniform test per pixel)
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uHeatN: { value: 0 }, uHeatT: { value: 0 }, uAspect: { value: 1 },
    uHeatA: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uHeatB: { value: [new THREE.Vector2(), new THREE.Vector2()] } },
  vertexShader: QUAD_VS,
  fragmentShader: `uniform sampler2D tDiffuse; uniform int uHeatN; uniform float uHeatT, uAspect; uniform vec4 uHeatA[2]; uniform vec2 uHeatB[2]; varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      for (int i = 0; i < 2; i++) {
        if (i >= uHeatN) break;
        vec2 ax = uHeatA[i].zw - uHeatA[i].xy, q = vUv - uHeatA[i].xy;
        ax.x *= uAspect; q.x *= uAspect;
        float al = dot(q, ax) / max(dot(ax, ax), 1e-8), hw = uHeatB[i].x * (0.75 + 0.9 * max(al, 0.0));
        vec2 s = vec2(length(q - ax * al), al * length(ax)) / hw;
        float m = smoothstep(0.0, 0.1, al) * (1.0 - smoothstep(0.5, 1.0, al)) * (1.0 - smoothstep(0.3, 1.0, s.x));
        if (m > 0.0) {
          // rising ripples, finer than the fire, that wander as they climb
          float t = uHeatT;
          vec2 w = vec2(sin(s.y * 11.0 - t * 8.5 + sin(q.x / hw * 5.0 + t * 1.7) * 1.6), 0.6 * sin(s.y * 8.0 - t * 6.3 + q.x / hw * 4.0));
          uv += vec2(w.x / uAspect, w.y) * m * uHeatB[i].y;
        }
      }
      vec4 c = texture2D(tDiffuse, uv);
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
 * Screen-space reflections on wet ground (a stage turns it on with scene.userData.ssr = strength 0..1). For a pixel of
 * ground (its normal, from the depth of its neighbours, points up) the reflected ray is marched through the depth
 * buffer; where it meets something on screen, that pixel's colour is laid over the ground by a Fresnel term, strongest
 * in the puddles (the same world-space noise as the wet material, so the mirror sits where the puddle is). Lit signs,
 * shop windows and car lamps then show in the street; what is off screen falls back to the material's own sky mirror.
 */
class SsrPass extends Pass {
  private mat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  camera: THREE.Camera | null = null;
  strength = 0;

  constructor(depth: THREE.Texture, steps: number) {
    super();
    this.mat = fullscreen({
      tDiffuse: { value: null }, tDepth: { value: depth }, uTexel: { value: new THREE.Vector2() },
      uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uStrength: { value: 0 },
    }, /* glsl */ `
      uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform mat4 uProj; uniform float uStrength;
      ${RECONSTRUCT}
      varying vec2 vUv;
      float wH(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float wN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(wH(i), wH(i + vec2(1, 0)), f.x), mix(wH(i + vec2(0, 1)), wH(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        vec3 col = texture2D(tDiffuse, vUv).rgb;
        float z = texture2D(tDepth, vUv).r;
        gl_FragColor = vec4(col, 1.0);
        if (z >= 1.0) return;
        vec3 P = viewAt(vUv, z);
        if (-P.z > 90.0) return;
        // the normal from the nearer neighbour on each axis (no smearing across an edge)
        vec3 Px1 = viewAt(vUv + vec2(uTexel.x, 0.0), texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).r) - P;
        vec3 Px2 = P - viewAt(vUv - vec2(uTexel.x, 0.0), texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).r);
        vec3 Py1 = viewAt(vUv + vec2(0.0, uTexel.y), texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).r) - P;
        vec3 Py2 = P - viewAt(vUv - vec2(0.0, uTexel.y), texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).r);
        vec3 N = normalize(cross(abs(Px1.z) < abs(Px2.z) ? Px1 : Px2, abs(Py1.z) < abs(Py2.z) ? Py1 : Py2));
        vec3 Nw = (uCamWorld * vec4(N, 0.0)).xyz;
        if (Nw.y < 0.0) { N = -N; Nw = -Nw; }
        if (Nw.y < 0.94) return;
        vec3 W = (uCamWorld * vec4(P, 1.0)).xyz;
        float pud = smoothstep(0.52, 0.62, wN(W.xz * 0.16) * 0.7 + wN(W.xz * 0.7) * 0.3);
        vec3 V = normalize(P), R = reflect(V, N);
        float cosT = clamp(dot(-V, N), 0.0, 1.0), fres = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
        float k = uStrength * mix(0.15, 1.0, pud) * mix(0.3, 1.0, fres);
        if (k < 0.01 || R.z > 0.6) return;
        // march: steps that grow with distance, jittered per pixel, then one refinement
        float stp = 0.35 + 0.02 * -P.z, jit = wH(vUv * 913.0 + 0.37);
        vec3 Q = P + R * stp * jit; vec2 hit = vec2(-1.0); float travelled = 0.0;
        for (int i = 0; i < STEPS; i++) {
          Q += R * stp; travelled += stp; stp *= 1.18;
          vec4 c = uProj * vec4(Q, 1.0); vec2 uv = c.xy / c.w * 0.5 + 0.5;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
          float sz = viewAt(uv, texture2D(tDepth, uv).r).z;
          float dz = sz - Q.z; // > 0: the ray is behind the surface seen there
          if (dz > 0.0 && dz < stp * 2.0 + 0.4) { hit = uv; break; }
        }
        if (hit.x < 0.0) return;
        vec2 edge = smoothstep(0.0, 0.08, hit) * smoothstep(1.0, 0.92, hit);
        float fade = edge.x * edge.y * (1.0 - smoothstep(30.0, 60.0, travelled));
        vec3 refl = min(texture2D(tDiffuse, hit).rgb, vec3(8.0));
        // mostly added: what the ground shows of its own light (the lamp pools, the wet sheen) stays, the mirror comes on top
        gl_FragColor = vec4(col * (1.0 - 0.15 * k * fade) + refl * k * fade * 0.5, 1.0);
      }`, { STEPS: steps });
    this.quad = new FullScreenQuad(this.mat);
  }

  setSize(w: number, h: number) { this.mat.uniforms.uTexel.value.set(1 / w, 1 / h); }

  render(r: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const cam = this.camera as THREE.PerspectiveCamera, u = this.mat.uniforms;
    u.tDiffuse.value = read.texture; u.uStrength.value = this.strength;
    u.uProj.value.copy(cam.projectionMatrix); u.uInvProj.value.copy(cam.projectionMatrixInverse); u.uCamWorld.value.copy(cam.matrixWorld);
    r.setRenderTarget(this.renderToScreen ? null : write);
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
  private sanitize: ShaderPass;
  pixelRatio: number;
  aoHidden: THREE.Object3D[] = [];
  private volumetric: VolumetricPass | null = null;
  private dof: DofPass | null = null;
  private ssr: SsrPass | null = null;
  private temporal: TemporalPass | null = null;
  private frameTimes: number[] = [];
  private lastAdjust = 0;
  private frame = 0;
  private shed = 0;
  private gpuTimed = false;
  private aoWanted = false;
  private triedAt = -99;
  private holdUntil = 0;

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
    // three.js reads every program's and shader's info log on first use to report errors: each read waits for that
    // program to finish linking on the main thread, so a cold start's first draws froze while the background compile
    // was still running (getProgramInfoLog was the top self time of the cold load). ?shadercheck=1 turns it back on
    this.renderer.debug.checkShaderErrors = new URLSearchParams(location.search).get('shadercheck') === '1' || !!import.meta.env.DEV;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // opaque draws grouped by shader program first (three sorts by material id, so materials that share a program
    // interleave with others and every switch re-binds the program and uploads its uniforms); ?psort=0 is three's order
    if (new URLSearchParams(location.search).get('psort') !== '0') {
      const props = this.renderer.properties;
      type Item = { groupOrder: number; renderOrder: number; material: THREE.Material; materialVariant: number; z: number; id: number };
      const pid = (m: THREE.Material) => (props.get(m) as { currentProgram?: { id: number } }).currentProgram?.id ?? 1e9;
      this.renderer.setOpaqueSort(((a: Item, b: Item) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || pid(a.material) - pid(b.material)
        || a.material.id - b.material.id || a.materialVariant - b.materialVariant || a.z - b.z || a.id - b.id) as unknown as Parameters<THREE.WebGLRenderer['setOpaqueSort']>[0]);
    }
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
    if (depth && (quality.name === 'ultra' || quality.name === 'cinematic')) {
      this.ssr = new SsrPass(depth, quality.name === 'cinematic' ? 32 : 20);
      this.ssr.enabled = false;
      this.composer.addPass(this.ssr);
    }
    if (depth && quality.volumetricScale > 0) {
      this.volumetric = new VolumetricPass(depth, quality.volumetricScale, quality.volumetricSteps, quality.pcss);
      this.composer.addPass(this.volumetric);
    }
    this.sanitize = new ShaderPass(SanitizeShader);
    this.composer.addPass(this.sanitize);
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
    this.setSharpen();

    window.addEventListener('resize', () => this.resize());
  }

  setScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera, aoEnabled: boolean) {
    // a stage can ask for image-based light from its own sky: shade then reads as sky-lit, not black
    this.ensureEnv(scene);
    if (scene.userData.ao) aoEnabled = true;
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
    if (this.ssr) this.ssr.camera = camera;
  }

  /** What is on stage and through which lens: the offline film renderer reads this. */
  stageInfo() { return { scene: this.renderPass.scene, camera: this.renderPass.camera as THREE.PerspectiveCamera, focus: this.dof?.focus ?? 0, aperture: this.dof?.enabled ? this.dof.aperture : 0 }; }

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
  setFilm(f: { zoom?: number; at?: [number, number]; flash?: [number, number, number]; ink?: number; dark?: THREE.Color; light?: THREE.Color; lines?: number; exposure?: number } = {}) {
    const u = this.final.uniforms;
    u.uZoom.value = f.zoom ?? 0;
    u.uZoomAt.value.set(...(f.at ?? [0.5, 0.5]));
    u.uFlash.value.set(...(f.flash ?? [0, 0, 0]));
    u.uInk.value = f.ink ?? 0;
    if (f.dark) u.uInkDark.value.set(f.dark.r, f.dark.g, f.dark.b);
    if (f.light) u.uInkLight.value.set(f.light.r, f.light.g, f.light.b);
    u.uLines.value = f.lines ?? 0;
    if (f.exposure !== undefined) this.renderer.toneMappingExposure = f.exposure;
  }

  /**
   * A stage's own exposure and bloom (Zenvora by the hour: bright light and a low exposure by day, so lit signs do not
   * white out; a high exposure at night, when they are the light). No arguments puts the defaults back.
   */
  setLook(exposure = 1, bloomK = 1, threshold = 1.15) {
    this.renderer.toneMappingExposure = exposure;
    this.bloom.strength = this.quality.bloomStrength * 0.32 * bloomK;
    this.bloom.threshold = threshold;
  }

  /**
   * Gets a scene ready before it is shown: its shaders compile in the background (the browser's parallel compile where
   * it has one), then its textures go to the GPU a few a frame. Arriving in it is then not seconds of compiling and
   * uploading in its first frame.
   */
  private ensureEnv(scene: THREE.Scene) {
    const sky = scene.userData.skyForEnv as THREE.Object3D | undefined;
    if (sky && !scene.environment) {
      const env = new THREE.Scene(); env.add(sky.clone());
      const pm = new THREE.PMREMGenerator(this.renderer);
      scene.environment = pm.fromScene(env, 0.02).texture; pm.dispose();
      scene.environmentIntensity = (scene.userData.envIntensity as number | undefined) ?? 1;
    }
  }

  /**
   * Every material of a scene compiled for the target it will draw into, without blocking: the browser compiles in the
   * background (in parallel where it can) while the page keeps drawing. A first visit on a cold shader cache spent
   * 70 s of the main thread linking programs one by one on the A500 (ANGLE on D3D11), the title frozen meanwhile.
   */
  async compileFor(scene: THREE.Scene, camera: THREE.Camera) {
    const prev = this.renderer.getRenderTarget(), into = this.quality.post && this.renderPass instanceof ScenePass ? this.renderPass.rt : null;
    try { this.renderer.setRenderTarget(into); await this.renderer.compileAsync(scene, camera); } catch { /* compiled on first draw instead */ } finally { this.renderer.setRenderTarget(prev); }
  }

  async precompile(scene: THREE.Scene, camera: THREE.Camera) {
    // its maps first (a material compiled without its map is compiled again when the map arrives), six seconds at most
    const loads = (scene.userData.loads as Promise<unknown>[] | undefined) ?? [];
    await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, 6000))]);
    this.ensureEnv(scene); // the shaders differ with and without the image-based light: compile the ones that will be used
    // and with the target they will draw into: the post chain's scene buffer (linear, no tone mapping) or the screen
    await this.compileFor(scene, camera);
    // one frame of everything through the real post chain, culling off, at a tiny size: the passes' own variants
    // (shadow depth, the AO pass's normals) compile and every geometry and texture goes to the GPU now, under the black,
    // instead of in the first frames of play (a cold shader cache froze the first second of play for 4-6 s)
    // once the scene is on screen the rest would be done in play, all at once: then it is left to the first frames
    if (this.renderPass.scene === scene) return;
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const culled: THREE.Object3D[] = [];
      scene.traverse((o) => { if (o.frustumCulled && o.visible) { o.frustumCulled = false; culled.push(o); } });
      const was = { scene: this.renderPass.scene, camera: this.renderPass.camera as THREE.PerspectiveCamera, ao: this.aoWanted };
      const shadows = this.renderer.shadowMap.autoUpdate, prevT = this.renderer.getRenderTarget();
      this.warmBegin();
      try { this.renderer.shadowMap.needsUpdate = true; this.warm(scene, camera as THREE.PerspectiveCamera, true); } catch { /* best effort */ }
      finally {
        this.warmEnd(); this.setScene(was.scene, was.camera, was.ao); this.renderer.setRenderTarget(prevT);
        this.renderer.shadowMap.autoUpdate = shadows; for (const o of culled) o.frustumCulled = true;
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    // a stage's own work that belongs under the black too (Zenvora bakes its far people here)
    if (this.renderPass.scene === scene) return;
    try { await (scene.userData.prebake as (() => Promise<void>) | undefined)?.(); } catch { /* done in play instead */ }
    const texs = new Set<THREE.Texture>();
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const mm of Array.isArray(m) ? m : m ? [m] : []) for (const v of Object.values(mm)) if ((v as THREE.Texture)?.isTexture) texs.add(v as THREE.Texture);
    });
    const list = [...texs];
    for (let i = 0; i < list.length; i += 4) {
      for (const tx of list.slice(i, i + 4)) { try { this.renderer.initTexture(tx); } catch { /* uploaded on first draw */ } }
      await new Promise((r) => requestAnimationFrame(r));
    }
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
  /**
   * The programs a draw of `scene` would build, compiled without blocking: every visible material (hidden ones are left
   * for when they are shown; three's own compile takes them all, a third more programs) for the target it draws into,
   * then the browser links them in the background (KHR_parallel_shader_compile; ANGLE spreads them over threads) while
   * the page keeps running. Resolves when all are linked, or after `maxMs`. `progress` gets the share linked so far.
   * Linking them one at a time in the first draw froze the title for 70 s on a cold shader cache (A500, ANGLE D3D11).
   */
  async prewarm(scene: THREE.Scene, cam: THREE.Camera, progress?: (k: number) => void, maxMs = 90000) {
    const r = this.renderer, prev = r.getRenderTarget(), into = this.quality.post && this.renderPass instanceof ScenePass ? this.renderPass.rt : null;
    this.ensureEnv(scene);
    let mats: Set<THREE.Material> | undefined;
    const own = Object.prototype.hasOwnProperty.call(scene, 'traverse'), was = scene.traverse;
    scene.traverse = scene.traverseVisible;
    try { r.setRenderTarget(into); mats = r.compile(scene, cam) as unknown as Set<THREE.Material>; } catch { /* compiled on first draw instead */ } finally {
      if (own) scene.traverse = was; else delete (scene as Partial<THREE.Scene>).traverse;
      r.setRenderTarget(prev);
    }
    if (!mats?.size) return;
    const list = [...mats], t0 = performance.now();
    type Prog = { isReady(): boolean } | undefined;
    await new Promise<void>((done) => {
      const tick = () => {
        let left = 0;
        for (const m of list) { const p = (r.properties.get(m) as { currentProgram?: Prog }).currentProgram; if (p && !p.isReady()) left++; }
        progress?.(1 - left / list.length);
        if (!left || performance.now() - t0 > maxMs) done(); else setTimeout(tick, 30);
      };
      tick();
    });
  }
  /**
   * The post chain's own programs (bloom's blurs, the grade, the sanitize, AO and the rest), compiled the same way as
   * prewarm: started now, linked by the browser in the background. The title's first frame linked them one by one on
   * the main thread with the title's own (a 20 s freeze on a cold shader cache on the A500).
   */
  async prewarmPost(maxMs = 60000) {
    const r = this.renderer, found = new Set<THREE.Material>();
    const look = (v: unknown, depth: number) => {
      if (!v || typeof v !== 'object' || depth > 3) return;
      if ((v as THREE.Material).isMaterial) { found.add(v as THREE.Material); return; }
      if ((v as THREE.Object3D).isObject3D || (v as THREE.Texture).isTexture || (v as THREE.WebGLRenderTarget).isWebGLRenderTarget || ArrayBuffer.isView(v)) return;
      for (const x of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>)) look(x, depth + 1);
    };
    for (const pass of this.composer.passes) look(pass, 0);
    if (!found.size) return;
    const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), g = new THREE.PlaneGeometry(2, 2);
    for (const m of found) { const q = new THREE.Mesh(g, m); q.frustumCulled = false; sc.add(q); }
    const prev = r.getRenderTarget(), rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    let mats: Set<THREE.Material> | undefined;
    try { r.setRenderTarget(rt); mats = r.compile(sc, cam) as unknown as Set<THREE.Material>; } catch { /* compiled on first draw instead */ } finally { r.setRenderTarget(prev); }
    if (mats?.size) await this.linked([...mats], maxMs);
    rt.dispose(); g.dispose();
  }
  /** Resolves when every one of these materials' programs is linked (or after `maxMs`). */
  private linked(list: THREE.Material[], maxMs: number, progress?: (k: number) => void) {
    const r = this.renderer, t0 = performance.now();
    type Prog = { isReady(): boolean } | undefined;
    return new Promise<void>((done) => {
      const tick = () => {
        let left = 0;
        for (const m of list) { const p = (r.properties.get(m) as { currentProgram?: Prog }).currentProgram; if (p && !p.isReady()) left++; }
        progress?.(1 - left / list.length);
        if (!left || performance.now() - t0 > maxMs) done(); else setTimeout(tick, 30);
      };
      tick();
    });
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
    if (!this.gpuTimed && GPU_TIMER_ON) {
      this.gpuTimed = true;
      const named = new Map<object, string>([[this.renderPass, 'scene'], [this.bloom, 'bloom'], [this.final, 'final'], ...([['ao', this.ao], ['ssr', this.ssr], ['volumetric', this.volumetric], ['temporal', this.temporal], ['dof', this.dof]] as [string, object | null][]).filter(([, p]) => p).map(([n, p]) => [p!, n] as [object, string])]);
      installGpuTimer(this.renderer, this.composer.passes.map((p, i) => ({ pass: p as unknown as { render: (...a: unknown[]) => void }, name: named.get(p) ?? `pass${i}` })));
    }
    this.final.uniforms.uTime.value = time;
    if (this.volumetric) this.volumetric.source = (this.renderPass.scene.userData.post as PostSource | undefined) ?? null;
    if (this.ssr) { const k = (this.renderPass.scene.userData.ssr as number | undefined) ?? 0; this.ssr.strength = k; this.ssr.enabled = k > 0.01 && this.shed < 2; }
    const cam = this.renderPass.camera as THREE.PerspectiveCamera;
    this.heat(cam, time);
    const jittered = !!this.temporal && this.quality.taa && cam.isPerspectiveCamera;
    if (jittered) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.temporal!.jitter(cam, size.x, size.y, this.frame++);
    }
    // phones in a scene that asks for it (Zenvora): straight to the screen, no post chain at all. Bloom and the grade
    // are a dozen full-screen passes; on a phone they cost more than the street. The title lens still gets the chain.
    const u = this.final.uniforms, fv = u.uFlash.value as THREE.Vector3;
    if (!this.quality.post && this.renderPass.scene.userData.direct && !u.uZoom.value && !u.uInk.value && !u.uLines.value && fv.x + fv.y + fv.z === 0) {
      this.renderer.setRenderTarget(null); this.renderer.render(this.renderPass.scene, cam);
    } else this.composer.render(dt);
    if (jittered) cam.clearViewOffset();
    if (this.quality.dynamicResolution) this.adaptResolution(dt, time);
  }

  /** The hot air over the nearest two fires that burn on screen (core/heat.ts). */
  private heatTmp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private heat(cam: THREE.PerspectiveCamera, time: number) {
    const u = this.sanitize.uniforms;
    let n = 0;
    if (this.quality.name !== 'mobile' && cam.isPerspectiveCamera && heatSources.length) {
      const now = performance.now(), [a, b, d] = this.heatTmp, A = u.uHeatA.value as THREE.Vector4[], B = u.uHeatB.value as THREE.Vector2[];
      const live = heatSources.filter((h) => now - h.at < 250).map((h) => ({ h, dist: h.pos.distanceTo(cam.position) })).filter((o) => o.dist < 30 && o.dist > 0.4).sort((p, q) => p.dist - q.dist);
      for (const { h, dist } of live) {
        if (n >= 2) break;
        // the column runs from just over the flames' foot to about two and a half fire heights up
        a.copy(h.pos).setY(h.pos.y + 0.25 * h.size).project(cam); b.copy(h.pos).setY(h.pos.y + 2.4 * h.size).project(cam);
        d.copy(h.pos).applyMatrix4(cam.matrixWorldInverse);
        if (d.z > -0.3 || Math.abs(a.x) > 1.6 || a.y > 1.6 || b.y < -1.6) continue;
        const hw = (0.5 * h.size) / (2 * -d.z * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
        const fade = Math.sqrt(Math.max(0, h.k)) * (1 - THREE.MathUtils.smoothstep(dist, 16, 30));
        A[n].set(a.x * 0.5 + 0.5, a.y * 0.5 + 0.5, b.x * 0.5 + 0.5, b.y * 0.5 + 0.5);
        B[n].set(hw, hw * 0.04 * fade);
        n++;
      }
      u.uAspect.value = cam.aspect; u.uHeatT.value = time;
    }
    u.uHeatN.value = n;
  }

  private lastDrop: { pr: number; avg: number } | null = null;
  private noDropUntil = 0;
  private dropFails = 0;
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
    // a drop that bought nothing: the frame is bound by the main thread (draw calls, the game's own work), not by
    // pixels. Put the sharpness back and stop dropping for a while (Zenvora and the planet on a laptop sat at the
    // floor, 0.6, blurred, at the same frame rate as at full sharpness)
    const drop = this.lastDrop;
    this.lastDrop = null;
    if (drop && avg > drop.avg * 0.96 && avg > budget * 1.04) {
      // each drop that fails waits longer before the next try (a resize reallocates every buffer of the post chain)
      pr = drop.pr; this.dropFails = Math.min(this.dropFails + 1, 6); this.noDropUntil = time + 20 * this.dropFails;
    } else if (avg > budget * 1.04 && time > this.noDropUntil) {
      const over = avg / budget;
      const floor = q.minPixelRatio + (maxPr - q.minPixelRatio) * 0.45;
      if (pr <= floor && this.shed < 2) this.setShed(this.shed + 1);
      else { const was = pr; pr = Math.max(q.minPixelRatio, pr - (over > 1.3 ? 0.12 : 0.06)); if (pr < was) this.lastDrop = { pr: was, avg }; }
    } else if (drop) {
      this.dropFails = 0; // it helped
    } else if (avg > budget * 1.04) {
      // waiting out a drop that did not help
    } else if (avg < budget * 0.85 || (avg < budget * 1.02 && time > this.holdUntil)) {
      // headroom, or holding the target (a display that caps the frame rate never shows headroom): try a step sharper.
      // If that step then misses the target, the drop above takes it back and it is not tried again for a while.
      if (pr < maxPr) { pr = Math.min(maxPr, pr + 0.04); this.triedAt = time; }
      else if (this.shed > 0) this.setShed(this.shed - 1);
    }
    if (avg > budget * 1.04 && time - this.triedAt < 2.5) this.holdUntil = time + 20;
    this.lastAdjust = time;
    this.frameTimes.length = 0;
    if (Math.abs(pr - this.pixelRatio) > 0.005) {
      this.pixelRatio = pr;
      this.renderer.setPixelRatio(pr);
      this.composer.setPixelRatio(pr);
      this.setSharpen();
    }
  }

  /** Phones: the further below the screen's own pixel ratio the frame is drawn, the more it is sharpened. */
  private setSharpen() {
    const dpr = window.devicePixelRatio || 1;
    this.final.uniforms.uSharpen.value = this.quality.name === 'mobile' ? THREE.MathUtils.clamp((dpr / this.pixelRatio - 1) * 0.3, 0, 0.4) : 0;
  }

  /** 0 = everything on, 1 = AO off, 2 = AO and volumetrics off. */
  private setShed(n: number) {
    this.shed = n;
    if (this.ao) this.ao.enabled = this.aoWanted && n < 1;
    if (this.volumetric) this.volumetric.enabled = n < 2;
  }
}
