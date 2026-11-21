import * as THREE from 'three';
import { FACADE } from './facade';
import { nearFade } from '../../core/nearfade';

/**
 * Zenvora's time of day and weather. The prologue starts as the sun touches the horizon (17:51), the neon already on,
 * and the evening comes on while you play (an hour every seven minutes): the sun goes down the street, the sky goes through pink and violet to night, the
 * windows and street lamps come on, the haze thickens. Rain (`?weather=rain`, or now and then) brings an overcast sky,
 * streaks round the camera, and wet ground: darker, glossier, with puddles that hold the sky and the neon.
 *
 * `?tod=HH.H` freezes the clock at an hour (pictures, tests), `?weather=clear|rain` sets the weather.
 */
export interface DayState { hour: number; night: number; rain: number; sunDir: THREE.Vector3; elev: number; exposure: number; bloom: number; threshold: number }

const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const FIXED = q.has('tod') ? Number(q.get('tod')) : null;
const WEATHER = q.get('weather');

/** Sky dome: gradient by sun height, sun disk and glow, clouds in bands, stars at night. */
export function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sun: { value: new THREE.Vector3(0, 0.2, -1).normalize() }, uNight: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: /* glsl */ `varying vec3 d; uniform vec3 sun; uniform float uNight, uRain, uTime;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        float e = sun.y, h = d.y;
        // day: deep blue over a pale horizon; golden hour: warm low sky; dusk: pink and violet; night: navy
        vec3 dayTop = vec3(.16, .34, .72), dayHor = vec3(.62, .74, .88);
        vec3 goldTop = vec3(.22, .3, .58), goldHor = vec3(1.0, .62, .36);
        vec3 duskTop = vec3(.1, .1, .3), duskHor = vec3(.95, .42, .45);
        vec3 nightTop = vec3(.008, .012, .035), nightHor = vec3(.06, .06, .12);
        float kd = smoothstep(.05, .35, e), kg = smoothstep(-.04, .1, e), kn = smoothstep(-.02, -.16, e);
        vec3 top = mix(mix(duskTop, goldTop, kg), dayTop, kd), hor = mix(mix(duskHor, goldHor, kg), dayHor, kd);
        top = mix(top, nightTop, kn); hor = mix(hor, nightHor, kn);
        // the warm side of the sky is towards the sun
        float toward = max(dot(normalize(d.xz + 1e-4), normalize(sun.xz + 1e-4)), 0.);
        hor = mix(hor, hor * vec3(1.15, .9, .8), toward * (1. - kd) * (1. - kn));
        vec3 c = mix(hor, top, pow(smoothstep(-.02, .6, h), .7));
        c = mix(vec3(.2, .17, .2) * (1. - kn * .8), c, smoothstep(-.12, .02, h)); // below the horizon: the haze of the far city
        float s = max(dot(d, sun), 0.);
        c += vec3(1., .78, .5) * (pow(s, 900.) * 18. + pow(s, 12.) * .35 * (1. - kn)) * (1. - uRain * .85);
        // stars, and a moon opposite the sun
        if (kn > 0.) { vec2 sp = d.xz / (d.y + 1.2) * 300.; float st = step(.9965, h21(floor(sp))) * smoothstep(.0, .3, h); c += vec3(.9, .95, 1.) * st * kn * (1. - uRain);
          float m = max(dot(d, normalize(vec3(-sun.x, .5, -sun.z))), 0.); c += vec3(.8, .85, 1.) * (pow(m, 2400.) * 6. + pow(m, 30.) * .08) * kn * (1. - uRain); }
        // clouds: soft bands, lit by the sun from below at dusk
        vec2 cp = d.xz / (d.y + .15) * 1.4 + vec2(uTime * .004, 0.);
        float cl = smoothstep(.45, .85, n2(cp * 2.) * .65 + n2(cp * 5.3) * .35) * smoothstep(.02, .25, h);
        vec3 cc = mix(vec3(1., .93, .88), vec3(1., .55, .45), (1. - kd) * (1. - kn)) * mix(1., .08, kn);
        c = mix(c, cc * (0.55 + 0.45 * toward), cl * (.55 + uRain * .4));
        // rain: a flat grey lid over everything
        c = mix(c, vec3(.32, .34, .38) * mix(1., .1, kn), uRain * .75 * smoothstep(-.05, .2, h));
        gl_FragColor = vec4(c, 1.);
      }`,
  });
}

export function dayCycle(o: { sky: THREE.ShaderMaterial; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; fog: THREE.Fog; rich: boolean; scene: THREE.Scene }) {
  const st: DayState = { exposure: 1, bloom: 1, threshold: 1.15, hour: FIXED ?? 17.85, night: 0, rain: WEATHER === 'rain' ? 1 : 0, sunDir: new THREE.Vector3(), elev: 0 };
  const RATE = 1 / 420; // game hours a second
  const C = (h: number) => new THREE.Color(h);
  // the rain: streaks in a box that follows the camera, one draw
  const N = o.rich ? 5000 : 1600, R = 26, TOP = 22;
  const pos = new Float32Array(N * 6), seed = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { seed[i * 3] = Math.random() * 2 * R - R; seed[i * 3 + 1] = Math.random() * TOP; seed[i * 3 + 2] = Math.random() * 2 * R - R; }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9fb0c4, transparent: true, opacity: 0.32, depthWrite: false }));
  rain.frustumCulled = false; rain.visible = false; rain.userData.ground = false; o.scene.add(rain);
  let envAt = -99;
  const sunCol = new THREE.Color(), hemiSky = new THREE.Color(), hemiGnd = new THREE.Color(), fogC = new THREE.Color();
  return {
    state: st,
    /** Advance the clock and set the sky, the lights and the wet; returns true when the image-based light is due a refresh. */
    update(dt: number, time: number, cam: THREE.Camera | null) {
      if (FIXED === null) st.hour = (st.hour + dt * RATE) % 24;
      // the sun: up in the east (+x) at 6, down in the west at 18, a little south of overhead; the street runs north-south
      const a = ((st.hour - 6) / 12) * Math.PI, elev = Math.sin(a) * 1.05;
      st.sunDir.set(-Math.cos(a) * 0.75, Math.sin(elev) , -0.55).normalize();
      st.elev = st.sunDir.y;
      const e = st.elev;
      st.night = THREE.MathUtils.smoothstep(-e, -0.1, 0.12); // 0 above 6 degrees, 1 well below the horizon
      FACADE.night.value = st.night; FACADE.wet.value = Math.max(st.rain, 0.3); // the streets were washed this evening: damp, with puddles, even when dry
      const u = o.sky.uniforms; u.sun.value.copy(st.sunDir); u.uNight.value = st.night; u.uRain.value = st.rain; u.uTime.value = time;
      // sunlight: white high up, gold and then red near the horizon, gone below it (the moon takes over, cool and dim)
      const day = THREE.MathUtils.smoothstep(e, -0.03, 0.08), gold = 1 - THREE.MathUtils.smoothstep(e, 0.05, 0.4);
      sunCol.copy(C(0xfff4e6)).lerp(C(0xffa060), gold).lerp(C(0xff6a40), gold * gold * 0.6);
      if (day > 0.02) {
        o.sun.color.copy(sunCol); o.sun.intensity = (0.6 + 2.6 * THREE.MathUtils.smoothstep(e, 0, 0.5)) * day * (1 - st.rain * 0.75);
        o.sun.userData.dir = st.sunDir;
      } else {
        o.sun.color.set(0x8fa8ff); o.sun.intensity = 0.28 * (1 - st.rain * 0.6);
        o.sun.userData.dir = new THREE.Vector3(-st.sunDir.x, 0.55, -st.sunDir.z).normalize();
      }
      hemiSky.copy(C(0x9ab6e8)).lerp(C(0x8a86c8), gold).lerp(C(0x283252), st.night); // a city night: the sky glows with its own light
      hemiGnd.copy(C(0xb09070)).lerp(C(0x7a5a48), gold).lerp(C(0x4a3828), st.night); // the street's own light bouncing off the paving
      o.hemi.color.copy(hemiSky); o.hemi.groundColor.copy(hemiGnd);
      o.hemi.intensity = (1.1 + 0.72 * (1 - st.night)) * (1 - st.rain * 0.25);
      o.scene.environmentIntensity = 0.5 + 0.85 * (1 - st.night);
      // the lens: by day the light is strong and the exposure low, so lit signs and shop windows sit under the sunlit
      // walls and nothing whites out; as night comes the exposure opens and the neon becomes the light, with its bloom
      st.exposure = THREE.MathUtils.lerp(0.62, 1.12, st.night) * (1 - 0.1 * gold * (1 - st.night));
      st.bloom = 0.3 + 0.7 * st.night; st.threshold = THREE.MathUtils.lerp(3.2, 1.0, st.night);
      fogC.copy(C(0xb8c4d8)).lerp(C(0xc89a88), gold).lerp(C(0x1c1a2c), st.night).lerp(C(0x6a7078).multiplyScalar(1 - 0.75 * st.night), st.rain * 0.7);
      o.fog.color.copy(fogC);
      o.fog.near = 40 - st.rain * 20; o.fog.far = (o.rich ? 520 : 320) * (1 - st.rain * 0.45) * (1 - st.night * 0.25);
      rain.visible = st.rain > 0.05 && !!cam;
      if (rain.visible && cam) {
        const p = cam.position, fall = 15;
        for (let i = 0; i < N; i++) {
          let y = seed[i * 3 + 1] - ((time * fall + i * 0.37) % TOP);
          if (y < 0) y += TOP;
          const x = p.x + ((seed[i * 3] - p.x) % R + R) % R * 2 - R, z = p.z + ((seed[i * 3 + 2] - p.z) % R + R) % R * 2 - R;
          pos.set([x, p.y - 4 + y, z, x + 0.05, p.y - 4 + y - 0.7, z], i * 6);
        }
        rg.attributes.position.needsUpdate = true;
      }
      // the sky as light for everything else: refreshed every few game minutes
      const due = Math.abs(st.hour - envAt) > 0.08 || envAt < 0;
      if (due) envAt = st.hour;
      return due;
    },
  };
}

/**
 * Wet ground: with FACADE.wet up, the material darkens and turns glossy, most of all in puddles (a noise in world
 * space, so they stay put), where it is nearly a mirror of the sky and the lights.
 */
export function wetify(m: THREE.MeshStandardMaterial, puddles = 1) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWet = FACADE.wet;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWetP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vWetP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uWet; varying vec3 vWetP; float wPud;
      float wH(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float wN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(wH(i), wH(i + vec2(1, 0)), f.x), mix(wH(i + vec2(0, 1)), wH(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // wear: the ground is never one tone (patches the size of a lorry, and finer mottling)
        diffuseColor.rgb *= 0.8 + 0.38 * (wN(vWetP.xz * 0.045) * 0.6 + wN(vWetP.xz * 0.37) * 0.4);
        wPud = uWet * smoothstep(0.52, 0.62, wN(vWetP.xz * 0.16) * 0.7 + wN(vWetP.xz * 0.7) * 0.3) * ${puddles.toFixed(2)};
        diffuseColor.rgb *= mix(1.0, 0.55, uWet) * (1.0 - 0.35 * wPud);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35, uWet);
        roughnessFactor = mix(roughnessFactor, 0.02, wPud);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, wPud * 0.9));`);
    nearFade(m, sh);
  };
  m.customProgramCacheKey = () => `wet|${puddles}|nearfade`;
  return m;
}
