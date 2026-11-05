import * as THREE from 'three';
import { NOISE_GLSL } from '../core/glsl';
import { Terrain, WORLD_SIZE, LAKE } from './terrain';
import type { Sky } from './sky';

/**
 * Animated water: procedural ripple normals, Fresnel sky reflection, sun glint,
 * depth-based absorption from the terrain heightmap and shoreline foam.
 */
export function createWater(terrain: Terrain, sky: Sky) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uHeight: { value: null },
      uWorld: { value: WORLD_SIZE },
      uRes: { value: terrain.res },
      uSunDir: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uDay: { value: 1 },
      tWaterN: { value: null as THREE.Texture | null },
      uHasN: { value: 0 },
      uEnv: { value: null as THREE.Texture | null },
      uHasEnv: { value: 0 },
    },
  ]);
  uniforms.uHeight.value = terrain.heightTex;
  uniforms.uSunDir.value = sky.sunDir;
  uniforms.uSunColor.value = sky.sunColor;
  uniforms.uZenith.value = sky.zenith;
  uniforms.uHorizon.value = sky.horizon;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    fog: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWP;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWP = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime, uWorld, uRes, uDay, uHasN, uHasEnv;
      uniform sampler2D uHeight, tWaterN;
      uniform samplerCube uEnv;
      uniform vec3 uSunDir, uSunColor, uZenith, uHorizon;
      varying vec3 vWP;
      ${NOISE_GLSL}
      float th(vec2 p){ return texture2D(uHeight, ((p + uWorld * 0.5) / uWorld * (uRes - 1.0) + 0.5) / uRes).r; }
      float waves(vec2 p){
        float t = uTime;
        return vnoise2(p * 0.35 + vec2(t * 0.12, t * 0.05)) * 0.5
             + vnoise2(p * 0.9 - vec2(t * 0.2, -t * 0.15)) * 0.3
             + vnoise2(p * 2.3 + vec2(-t * 0.35, t * 0.3)) * 0.2;
      }
      vec3 skyCol(vec3 d){
        float y = max(d.y, 0.0);
        vec3 c = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.65, y), 0.65));
        float sd = max(dot(d, uSunDir), 0.0);
        c += uSunColor * pow(sd, 10.0) * 0.4 * smoothstep(-0.1, 0.1, uSunDir.y);
        return c;
      }
      void main(){
        vec2 p = vWP.xz;
        float e = 0.08;
        float h0 = waves(p);
        vec2 gN = vec2(h0 - waves(p + vec2(e, 0.0)), h0 - waves(p + vec2(0.0, e))) * 1.6 / e * 0.1;
        if (uHasN > 0.5) {
          // two scrolling layers of the baked ripple map + the slow procedural swell
          vec2 n1 = texture2D(tWaterN, p * 0.16 + vec2(uTime * 0.021, uTime * 0.013)).xy * 2.0 - 1.0;
          vec2 n2 = texture2D(tWaterN, p * 0.43 * mat2(0.8, -0.6, 0.6, 0.8) - vec2(uTime * 0.034, -uTime * 0.027)).xy * 2.0 - 1.0;
          gN = gN * 0.5 + (n1 * 0.55 + n2 * 0.35);
        }
        vec3 V = normalize(cameraPosition - vWP);
        float camD = length(cameraPosition - vWP);
        gN *= mix(1.0, 0.35, smoothstep(20.0, 160.0, camD)); // calmer (and less aliased) far away
        vec3 N = normalize(vec3(gN.x, 1.0, -gN.y));
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 refl = uHasEnv > 0.5 ? textureLod(uEnv, R, 1.0).rgb : skyCol(R);
        // the far shore and forest occlude the low sky in the reflection
        refl *= mix(0.55, 1.0, smoothstep(0.0, 0.22, R.y));
        float depth = max(-th(p), 0.0);
        // Beer-Lambert along the refracted view path: red goes first, then green
        float path = depth / max(V.y, 0.2);
        vec3 T = exp(-path * vec3(0.55, 0.16, 0.11));
        vec3 scatter = vec3(0.04, 0.2, 0.22) * (0.15 + 0.85 * uDay);
        vec3 body = scatter * (1.0 - T);
        // bioluminescent plankton at night
        float plank = pow(vnoise2(p * 4.0 + uTime * 0.1), 16.0) * (1.0 - uDay) * 1.1 * smoothstep(0.2, 1.5, depth);
        body += vec3(0.1, 0.9, 0.8) * plank;
        vec3 col = mix(body, refl, fres);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 420.0) * 9.0 * smoothstep(-0.05, 0.1, uSunDir.y);
        spec += pow(max(dot(N, H), 0.0), 60.0) * 0.25 * smoothstep(-0.05, 0.1, uSunDir.y);
        col += uSunColor * spec;
        float fn = vnoise2(p * 3.0 + uTime * 0.4) * 0.6 + vnoise2(p * 9.0 - uTime * 0.7) * 0.4;
        float foam = smoothstep(0.3, 0.0, depth) * smoothstep(0.4, 0.62, fn + (1.0 - smoothstep(0.0, 0.12, depth)) * 0.3);
        col = mix(col, vec3(0.8, 0.86, 0.9) * (0.25 + 0.75 * uDay), foam * 0.55);
        float tr = dot(T, vec3(0.333));
        float alpha = clamp(1.0 - tr * 0.85 + fres * 0.6 + foam * 0.4, 0.0, 0.98);
        alpha *= smoothstep(0.0, 0.06, depth);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });
  // Only cover the area around the lake (plus anywhere else below sea level would
  // show through, so we keep a generous plane around the play area).
  const geo = new THREE.PlaneGeometry(700, 700, 1, 1);
  geo.rotateX(-Math.PI / 2);
  new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/water/nor_512.webp`, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    uniforms.tWaterN.value = t;
    uniforms.uHasN.value = 1;
  }, undefined, () => console.warn('[water] normal map missing; procedural ripples only'));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(LAKE.x * 0.5, 0, LAKE.z * 0.5);
  mesh.renderOrder = 1;
  return {
    mesh,
    update(time: number, day: number, env?: THREE.Texture | null) {
      uniforms.uTime.value = time;
      uniforms.uDay.value = day;
      if (env) { uniforms.uEnv.value = env; uniforms.uHasEnv.value = 1; }
    },
  };
}
