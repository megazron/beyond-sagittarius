import * as THREE from 'three';
import { nearFade } from '../../core/nearfade';

/**
 * Procedural facades: a building is a box (or a stack of them), and its windows, frames, floor slabs, shopfronts and
 * roof are drawn by the shader from where a pixel is on the wall. One material per wall finish draws every building of
 * a district in one call, at any size, with PBR glass that reflects the sky (the scene's image-based light) and
 * windows that light up as the evening comes on (`FACADE.night`).
 *
 * Per building (vertex attributes, so many buildings merge into one mesh):
 *   aFac  = (floor height m, bay width m, seed, style)   style 0 plaster/brick walls with punched windows,
 *                                                         1 a glass curtain wall with mullions, 2 ribbon windows
 *   aBase = ground height under the building, so floor 0 is the street floor (shopfronts) wherever it stands
 *   color = the wall's tint
 */
export const FACADE = {
  /** 0 day, 1 night: how many windows are lit and how bright. */
  night: { value: 0.6 },
  /** 0 dry, 1 soaked: walls darken, glass and sills shine. */
  wet: { value: 0 },
};

const GLSL_HASH = /* glsl */ `
  float fHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
`;

export interface FacadeOpts {
  /** Diffuse and normal maps of the wall finish (tiled in metres by `tile`), arriving later is fine. */
  tile?: number;
  roughness?: number;
  /** The street floor is shopfronts (lit glass and a sign band) where the hash says so. */
  shops?: number;
}

export function facadeMaterial(o: FacadeOpts = {}) {
  const tile = o.tile ?? 3;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.roughness ?? 0.88, metalness: 0 });
  m.userData.noMerge = true; // its look comes from the attributes: never merged into another material
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = FACADE.night; sh.uniforms.uWet = FACADE.wet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aFac; attribute vec4 aOrg;
        varying vec3 vWp; varying vec3 vWn; varying vec4 vFac; varying vec4 vOrg;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        {
          vec4 wp4 = modelMatrix * vec4(position, 1.0);
          vec3 wn = normalize(mat3(modelMatrix) * normal);
          vWp = wp4.xyz; vWn = wn; vFac = aFac; vOrg = aOrg;
          #ifdef USE_MAP
          vec3 tg = normalize(vec3(-wn.z, 0.0, wn.x) + vec3(1e-5, 0.0, 0.0));
          vMapUv = abs(wn.y) > 0.5 ? wp4.xz / ${tile.toFixed(2)} : vec2(dot(wp4.xyz, tg), wp4.y) / ${tile.toFixed(2)};
          #endif
          #ifdef USE_NORMALMAP
          vNormalMapUv = abs(wn.y) > 0.5 ? wp4.xz / ${tile.toFixed(2)} : vec2(dot(wp4.xyz, tg), wp4.y) / ${tile.toFixed(2)};
          #endif
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; uniform float uWet;
        varying vec3 vWp; varying vec3 vWn; varying vec4 vFac; varying vec4 vOrg;
        ${GLSL_HASH}
        float fWin; float fFrame; vec3 fGlow; float fLedge;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        fWin = 0.0; fFrame = 0.0; fGlow = vec3(0.0); fLedge = 0.0;
        if (abs(vWn.y) < 0.5) {
          // along the wall from the building's corner, in bays that fit its width exactly
          bool alongX = abs(vWn.z) > abs(vWn.x);
          float fh = vFac.x, bw = alongX ? vFac.y : vOrg.w, seed = vFac.z, style = vFac.w;
          float u = alongX ? vWp.x - vOrg.x : vWp.z - vOrg.z, v = vWp.y - vOrg.y;
          float fl = floor(v / fh), fy = fract(v / fh), bay = floor(u / bw), fx = fract(u / bw);
          float h = fHash(vec3(bay, fl, seed));
          bool street = fl < 0.5;
          // a soft line at every floor slab (a band of the wall a shade darker)
          fLedge = smoothstep(0.04, 0.0, fy) + smoothstep(0.955, 1.0, fy);
          vec2 lo, hi;
          float shop = 0.0;
          if (street) {
            shop = step(${(1 - (o.shops ?? 0.75)).toFixed(2)}, fHash(vec3(bay, 7.0, seed)));
            lo = vec2(0.05, 0.03); hi = vec2(0.95, mix(0.0, 0.72, shop));
            // the fascia over the glass: dark, a thin lit edge in the shop's colour
            float band = step(0.76, fy) * step(fy, 0.95) * shop;
            vec3 sc = 0.5 + 0.5 * cos(6.2831 * (fHash(vec3(bay, 3.0, seed)) + vec3(0.0, 0.33, 0.67)));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.05, 0.06), band);
            fGlow += sc * (smoothstep(0.77, 0.765, fy) + smoothstep(0.94, 0.945, fy)) * shop * (0.4 + 2.0 * uNight) * step(0.74, fy) * step(fy, 0.96);
          } else if (style > 1.5) { lo = vec2(-0.1, 0.3); hi = vec2(1.1, 0.84); }
          else if (style > 0.5) { lo = vec2(0.03, 0.05); hi = vec2(0.97, 0.97); }
          else { lo = vec2(0.2 + 0.07 * step(0.5, h), 0.25); hi = vec2(0.8 - 0.07 * step(0.5, h), 0.86); }
          float aa = fwidth(fx) + fwidth(fy);
          float inX = smoothstep(lo.x - aa, lo.x + aa, fx) * smoothstep(hi.x + aa, hi.x - aa, fx);
          float inY = smoothstep(lo.y - aa, lo.y + aa, fy) * smoothstep(hi.y + aa, hi.y - aa, fy);
          fWin = inX * inY;
          float fx2 = smoothstep(lo.x - 0.05 - aa, lo.x - 0.05 + aa, fx) * smoothstep(hi.x + 0.05 + aa, hi.x + 0.05 - aa, fx);
          float fy2 = smoothstep(lo.y - 0.04 - aa, lo.y - 0.04 + aa, fy) * smoothstep(hi.y + 0.04 + aa, hi.y + 0.04 - aa, fy);
          fFrame = clamp(fx2 * fy2 - fWin, 0.0, 1.0) * (style > 0.5 ? 0.6 : 1.0);
          // a mullion down the middle of the punched windows
          float mull = (style < 0.5 && !street) ? (1.0 - smoothstep(0.012, 0.012 + aa, abs(fx - 0.5))) * fWin : 0.0;
          // ---- the room behind the glass (interior mapping): a box as deep as the bay is wide, seen through the pane ----
          vec3 inside = vec3(0.0), glow = vec3(0.0);
          if (fWin > 0.001) {
          vec3 V = normalize(vWp - cameraPosition);
          vec3 T = alongX ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
          vec3 dir = vec3(dot(V, T), V.y, -dot(V, vWn)); // x along the wall, y up, z into the room
          float W = bw, Hh = fh, Dp = street ? bw * 1.6 : bw * 0.9;
          vec3 p0 = vec3(fx * W, fy * Hh, 0.0);
          float tx = dir.x > 0.0 ? (W - p0.x) / dir.x : -p0.x / min(dir.x, -1e-4);
          float ty = dir.y > 0.0 ? (Hh - p0.y) / dir.y : -p0.y / min(dir.y, -1e-4);
          float tz = Dp / max(dir.z, 1e-4);
          float t = min(tx, min(ty, tz));
          vec3 q = p0 + dir * t;
          float lit = street ? shop : step(h, mix(0.08, 0.38, uNight)) * step(0.5, fl);
          vec3 tone = mix(vec3(1.0, 0.74, 0.46), vec3(0.78, 0.9, 1.0), step(0.7, fHash(vec3(bay, fl, seed + 9.0))));
          vec3 wallC = mix(vec3(0.62, 0.56, 0.5), 0.45 + 0.4 * cos(6.2831 * (h + vec3(0.0, 0.3, 0.6))), 0.15);
          vec3 room;
          if (t == tz) {
            // the back wall: a picture, a shelf or the shop's racks
            float shelf = street ? step(0.5, fract(q.y * 1.6)) * 0.5 + 0.5 : 1.0;
            vec3 goods = 0.35 + 0.3 * cos(6.2831 * (fHash(vec3(floor(q.x * 3.0), floor(q.y * 1.6), seed)) + vec3(0.0, 0.33, 0.67)));
            room = street ? mix(wallC * 0.6, goods, 0.5 * step(0.35, fract(q.y * 1.6))) * shelf : wallC * (0.85 + 0.3 * step(0.8, fHash(vec3(floor(q.x * 2.0), fl, seed))));
          } else if (t == ty) room = dir.y > 0.0 ? vec3(0.95, 0.92, 0.86) * (1.2 - 0.6 * q.z / Dp) : vec3(0.32, 0.22, 0.16) * (0.6 + 0.4 * fract(q.x * 1.3));
          else room = wallC * 0.8;
          float depthK = 1.0 - 0.5 * clamp(q.z / Dp, 0.0, 1.0);
          float curtain = step(0.65, fHash(vec3(bay, fl, seed + 3.0))) * smoothstep(0.3, 0.42, abs(fx - 0.5)) * (street ? 0.0 : 1.0);
          room = mix(room, vec3(0.75, 0.6, 0.45), curtain);
          // daylight inside the room is dim; a lit room glows
          inside = room * depthK * (0.05 + 0.04 * (1.0 - uNight));
          glow = room * depthK * tone * lit * (street ? (0.25 + 0.9 * uNight) : (0.3 + 1.0 * uNight)) * (0.75 + 0.5 * fHash(vec3(bay, fl, seed + 5.0)));
          }
          float reveal = fWin * smoothstep(hi.y - 0.1, hi.y, fy);
          diffuseColor.rgb = mix(diffuseColor.rgb, inside + vec3(0.02, 0.025, 0.03), fWin);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.5 + vec3(0.07), max(fFrame, mull));
          diffuseColor.rgb *= 1.0 - 0.22 * fLedge;
          diffuseColor.rgb *= 1.0 - 0.45 * reveal;
          fGlow += fWin * (1.0 - mull) * glow;
        } else {
          diffuseColor.rgb *= 0.55; // roofs: tar and gravel
        }
        diffuseColor.rgb *= 1.0 - 0.35 * uWet * (1.0 - fWin);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.04, fWin);
        roughnessFactor = mix(roughnessFactor, 0.45, fFrame);
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.45, uWet);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        // glass: a mirror at a grazing angle, see-through head on (the room shows)
        { float fres = pow(1.0 - abs(dot(normalize(cameraPosition - vWp), vWn)), 3.0);
          metalnessFactor = mix(metalnessFactor, mix(0.25, 0.95, fres), fWin * (1.0 - min(1.0, length(fGlow) * 0.6))); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += fGlow;`);
    nearFade(m, sh);
  };
  m.customProgramCacheKey = () => `facade|${tile}|${o.shops ?? 0.75}|nearfade`;
  return m;
}

/**
 * A box building's geometry with its facade attributes: x, z centre, w (x) by d (z), from y0 up h metres. `bay` is the
 * wanted window spacing (fitted to each wall so no window is cut at a corner), `floor` the storey height; `base` is the
 * street under it (floor 0 starts there, so an upper block of a tower carries on the count).
 */
export function facadeBox(x: number, z: number, w: number, d: number, y0: number, h: number, floor: number, bay: number, seed: number, style: number, tint: THREE.Color, base = y0, org?: [number, number]) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y0 + h / 2, z);
  g.deleteAttribute('uv');
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const n = g.attributes.position.count;
  const bx = w / Math.max(1, Math.round(w / bay)), bz = d / Math.max(1, Math.round(d / bay));
  const [ox, oz] = org ?? [x - w / 2, z - d / 2];
  const af = new Float32Array(n * 4), ao = new Float32Array(n * 4), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { af.set([floor, bx, seed, style], i * 4); ao.set([ox, base, oz, bz], i * 4); col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b; }
  g.setAttribute('aFac', new THREE.BufferAttribute(af, 4)); g.setAttribute('aOrg', new THREE.BufferAttribute(ao, 4)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
