import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { Quality } from './quality';
import { setMaxAnisotropy } from './assets';

/** Final grade: vignette, film grain, chromatic aberration and screen shake tint. */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uAberration; uniform vec3 uTint;
    varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 61.7) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      vec3 col;
      if (uAberration > 0.0) {
        vec2 o = d * uAberration;
        col = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
      } else col = texture2D(tDiffuse, vUv).rgb;
      float v = smoothstep(0.85, 0.2, length(d * vec2(1.15, 1.0)));
      col *= mix(1.0 - uVignette, 1.0, v);
      col *= uTint;
      // film-like grade: filmic contrast, slightly cool shadows, warm highlights
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, 1.1);
      col = clamp(col, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.42);
      col *= mix(vec3(0.97, 0.99, 1.04), vec3(1.03, 1.0, 0.96), smoothstep(0.1, 0.8, lum));
      col += (rnd(vUv * 731.0) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/** Replaces NaN/Inf pixels so a single bad sample can't be smeared over the frame by bloom. */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(min(c.rgb, vec3(64.0)), c.a); }`,
};

export class Renderer {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: UnrealBloomPass;
  ao: GTAOPass | null = null;
  final: ShaderPass;
  pixelRatio: number;
  aoHidden: THREE.Object3D[] = [];
  private frameTimes: number[] = [];
  private lastAdjust = 0;

  constructor(canvas: HTMLCanvasElement, public quality: Quality) {
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
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // soft via shadow.radius (Vogel disk)
    setMaxAnisotropy(Math.min(quality.name === 'mobile' ? 4 : 16, this.renderer.capabilities.getMaxAnisotropy()));

    const dummyScene = new THREE.Scene();
    const dummyCam = new THREE.PerspectiveCamera();
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(dummyScene, dummyCam);
    this.composer.addPass(this.renderPass);

    if (quality.ao) {
      this.ao = new GTAOPass(dummyScene, dummyCam, window.innerWidth, window.innerHeight);
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.blendIntensity = 0.9;
      const full = quality.aoScale >= 1;
      this.ao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: full ? 12 : 8 });
      if (!full) {
        // Web: AO buffers at reduced resolution, bilinearly upsampled in the blend.
        const k = Math.max(0.25, quality.aoScale);
        this.ao.updatePdMaterial({ samples: 8, rings: 2 });
        const setSize = this.ao.setSize.bind(this.ao);
        this.ao.setSize = (w: number, h: number) => setSize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
        this.ao.setSize(window.innerWidth, window.innerHeight);
      }
      // The AO pass re-renders the scene with a normal override material. Objects
      // with custom vertex animation (grass, sky) are hidden from that pass.
      const orig = this.ao.render.bind(this.ao);
      this.ao.render = (...args: Parameters<GTAOPass['render']>) => {
        const vis = this.aoHidden.map((o) => o.visible);
        this.aoHidden.forEach((o) => (o.visible = false));
        orig(...args);
        this.aoHidden.forEach((o, i) => (o.visible = vis[i]));
      };
      this.composer.addPass(this.ao);
    }

    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), quality.bloomStrength, 0.55, 1.7);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.final = new ShaderPass(FinalShader);
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
      this.ao.enabled = aoEnabled;
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const cam = this.renderPass.camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
  }

  render(dt: number, time: number) {
    this.final.uniforms.uTime.value = time;
    this.composer.render(dt);
    if (this.quality.dynamicResolution) this.adaptResolution(dt, time);
  }

  /** Web preset: nudge the pixel ratio to hold ~60 fps. */
  private adaptResolution(dt: number, time: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 45) this.frameTimes.shift();
    if (time - this.lastAdjust < 1.5 || this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const maxPr = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    let pr = this.pixelRatio;
    if (avg > 1 / 50) pr = Math.max(this.quality.minPixelRatio, pr - 0.1);
    else if (avg < 1 / 58 && pr < maxPr) pr = Math.min(maxPr, pr + 0.05);
    if (Math.abs(pr - this.pixelRatio) > 0.01) {
      this.pixelRatio = pr;
      this.renderer.setPixelRatio(pr);
      this.composer.setPixelRatio(pr);
      this.lastAdjust = time;
      this.frameTimes.length = 0;
    }
  }
}
