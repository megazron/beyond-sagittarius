// glmem.js: injected before the page loads (gpu_tour.py plan "inject": "glmem.js"). Counts what WebGL holds on the GPU:
// every texture, buffer and renderbuffer allocation by the calls that size it, freed on delete. window.__glmem.census()
// then walks the page's objects from window.__bs (breadth first) and names the big allocations by the path that holds
// the three.js texture, render target or geometry. Bytes are estimates from the formats (what the driver really
// reserves can be more: padding, mip tails, D3D shadow copies under ANGLE).
(() => {
  const P = WebGL2RenderingContext.prototype, G = WebGL2RenderingContext;
  const tex = new Map(), buf = new Map(), rb = new Map(); // object -> record
  const srcOf = new WeakMap(); // uploaded data (typed array, image, canvas) -> record
  let unit = 0; const bound = {}; let vao = null; const vaoEl = new WeakMap(); const bbuf = {}; let brb = null;
  const BPP = { [G.RGBA8]: 4, [G.SRGB8_ALPHA8]: 4, [G.RGB8]: 4, [G.RGBA16F]: 8, [G.RGBA32F]: 16, [G.RGB16F]: 8, [G.RGB32F]: 16, [G.R8]: 1, [G.RG8]: 2, [G.R16F]: 2, [G.RG16F]: 4, [G.R32F]: 4, [G.RG32F]: 8, [G.R11F_G11F_B10F]: 4, [G.RGB10_A2]: 4, [G.DEPTH_COMPONENT16]: 2, [G.DEPTH_COMPONENT24]: 4, [G.DEPTH_COMPONENT32F]: 4, [G.DEPTH24_STENCIL8]: 4, [G.DEPTH32F_STENCIL8]: 8, [G.RGBA]: 4, [G.RGB]: 4, [G.LUMINANCE]: 1, [G.ALPHA]: 1, [G.LUMINANCE_ALPHA]: 2, [G.DEPTH_COMPONENT]: 4, [G.DEPTH_STENCIL]: 4, [G.R8UI]: 1, [G.RGBA8UI]: 4, [G.R32UI]: 4, [G.RGBA32UI]: 16, [G.R16UI]: 2, [G.RG16UI]: 4, [G.R32I]: 4 };
  const TYPEB = { [G.UNSIGNED_BYTE]: 1, [G.HALF_FLOAT]: 2, [G.FLOAT]: 4 };
  const FMTN = {}; for (const k in G) if (typeof G[k] === 'number' && /^(RGBA?|SRGB|R\d|RG\d|R11|DEPTH|LUMIN|ALPHA|COMPRESSED)/.test(k)) FMTN[G[k]] = k;
  const cubeFace = (t) => t >= G.TEXTURE_CUBE_MAP_POSITIVE_X && t <= G.TEXTURE_CUBE_MAP_NEGATIVE_Z;
  const curTex = (target) => (bound[unit] || {})[cubeFace(target) ? G.TEXTURE_CUBE_MAP : target];
  const rec = (t) => { let r = tex.get(t); if (!r) tex.set(t, r = { lv: new Map(), w: 0, h: 0, d: 1, f: 0, cube: false, stor: false }); return r; };
  const bpp = (ifmt, type) => BPP[ifmt] !== undefined ? (ifmt === G.RGBA || ifmt === G.RGB ? 4 * (TYPEB[type] || 1) : BPP[ifmt]) : 4;
  const dims = (a) => { const s = a; return [s.videoWidth || s.displayWidth || s.width || 0, s.videoHeight || s.displayHeight || s.height || 0]; };
  const wrap = (name, fn) => { const o = P[name]; P[name] = function (...a) { try { fn.call(this, a); } catch (e) { /* never break the page */ } return o.apply(this, a); }; };
  wrap('activeTexture', (a) => { unit = a[0] - G.TEXTURE0; });
  wrap('bindTexture', (a) => { (bound[unit] || (bound[unit] = {}))[a[0]] = a[1]; });
  wrap('deleteTexture', (a) => { tex.delete(a[0]); });
  wrap('texStorage2D', (a) => { const [target, levels, ifmt, w, h] = a; const r = rec(curTex(target)); r.stor = true; r.w = w; r.h = h; r.f = ifmt; r.cube = target === G.TEXTURE_CUBE_MAP; r.lv.clear(); for (let l = 0; l < levels; l++) r.lv.set(l, bpp(ifmt) * Math.max(1, w >> l) * Math.max(1, h >> l) * (r.cube ? 6 : 1)); });
  wrap('texStorage3D', (a) => { const [target, levels, ifmt, w, h, d] = a; const r = rec(curTex(target)); r.stor = true; r.w = w; r.h = h; r.d = d; r.f = ifmt; r.lv.clear(); for (let l = 0; l < levels; l++) r.lv.set(l, bpp(ifmt) * Math.max(1, w >> l) * Math.max(1, h >> l) * (target === G.TEXTURE_3D ? Math.max(1, d >> l) : d)); });
  wrap('texImage2D', (a) => {
    const [target, level, ifmt] = a; const t = curTex(target); if (!t) return; const r = rec(t);
    let w, h, type, src;
    if (a.length >= 8) { w = a[3]; h = a[4]; type = a[7]; src = a[8]; } else { [w, h] = dims(a[5]); type = a[4]; src = a[5]; }
    const k = cubeFace(target) ? level * 8 + (target - G.TEXTURE_CUBE_MAP_POSITIVE_X) : level * 8;
    r.lv.set(k, bpp(ifmt, type) * w * h); if (level === 0) { r.w = w; r.h = h; r.f = ifmt; r.cube = cubeFace(target); }
    if (src && typeof src === 'object') srcOf.set(src, r);
  });
  wrap('texSubImage2D', (a) => { const src = a.length >= 9 ? a[8] : a[6]; const t = curTex(a[0]); if (t && src && typeof src === 'object') srcOf.set(src, rec(t)); });
  wrap('texImage3D', (a) => { const [target, level, ifmt, w, h, d] = a; const t = curTex(target); if (!t) return; const r = rec(t); r.lv.set(level * 8, bpp(ifmt, a[8]) * w * h * d); if (level === 0) { r.w = w; r.h = h; r.d = d; r.f = ifmt; } });
  wrap('compressedTexImage2D', (a) => { const [target, level, ifmt, w, h] = a; const t = curTex(target); if (!t) return; const r = rec(t); const d = a[6]; const n = typeof d === 'number' ? d : d ? d.byteLength : 0; const k = cubeFace(target) ? level * 8 + (target - G.TEXTURE_CUBE_MAP_POSITIVE_X) : level * 8; if (!r.stor) r.lv.set(k, n); if (level === 0) { r.w = w; r.h = h; r.f = ifmt; r.comp = true; } if (d && typeof d === 'object') srcOf.set(d, r); });
  wrap('compressedTexSubImage2D', (a) => { const t = curTex(a[0]); if (t) { const r = rec(t); r.comp = true; const d = a[8]; if (d && typeof d === 'object') srcOf.set(d, r); } });
  wrap('generateMipmap', (a) => { const t = curTex(a[0]); const r = t && tex.get(t); if (r && !r.stor) { const b0 = r.lv.get(0) || 0; r.lv.set(1, Math.round(b0 / 3)); } });
  wrap('bindVertexArray', (a) => { vao = a[0]; bbuf[G.ELEMENT_ARRAY_BUFFER] = vao ? vaoEl.get(vao) : bbuf.__el0; });
  wrap('bindBuffer', (a) => { bbuf[a[0]] = a[1]; if (a[0] === G.ELEMENT_ARRAY_BUFFER) { if (vao) vaoEl.set(vao, a[1]); else bbuf.__el0 = a[1]; } });
  wrap('deleteBuffer', (a) => { buf.delete(a[0]); });
  wrap('bufferData', (a) => { const b = bbuf[a[0]]; if (!b) return; const n = typeof a[1] === 'number' ? a[1] : a[1] ? a[1].byteLength : 0; const r = { n, t: a[0] }; buf.set(b, r); if (a[1] && typeof a[1] === 'object') srcOf.set(a[1], r); });
  wrap('bindRenderbuffer', (a) => { brb = a[1]; });
  wrap('deleteRenderbuffer', (a) => { rb.delete(a[0]); });
  wrap('renderbufferStorage', (a) => { if (brb) rb.set(brb, { n: bpp(a[1]) * a[2] * a[3], w: a[2], h: a[3], f: a[1], s: 1 }); });
  wrap('renderbufferStorageMultisample', (a) => { if (brb) rb.set(brb, { n: bpp(a[2]) * a[3] * a[4] * Math.max(1, a[1]), w: a[3], h: a[4], f: a[2], s: a[1] }); });
  const texBytes = (r) => { let n = 0; for (const v of r.lv.values()) n += v; return n; };
  const MB = (n) => +(n / 1e6).toFixed(1);

  function totals() {
    let t = 0, b = 0, r = 0; for (const v of tex.values()) t += texBytes(v); for (const v of buf.values()) b += v.n; for (const v of rb.values()) r += v.n;
    return { texMB: MB(t), bufMB: MB(b), rbMB: MB(r), allMB: MB(t + b + r), nTex: tex.size, nBuf: buf.size, nRb: rb.size };
  }

  // breadth-first walk of everything reachable from window.__bs (and the extra roots), naming textures, render targets
  // and geometry by the first path that reaches them
  function census(opts = {}) {
    const maxNodes = opts.maxNodes || 3000000;
    const bs = window.__bs; const gl = bs.gl; const props = gl.properties;
    const named = new Map(); // gl texture -> path
    const geoSeen = new Set(); const geoBy = new Map(); const imgBy = new Map(); const seenImg = new Set();
    const q = [], seen = new WeakSet(); let n = 0, qi = 0;
    const push = (o, p) => { if (o && (typeof o === 'object' || typeof o === 'function') && !seen.has(o)) { seen.add(o); q.push([o, p]); } };
    // the stage on screen first (opts.stageFirst, the default): a texture both it and the planet use (a body's maps from
    // the asset cache) is named by the stage, so what is still named world.* is the planet's alone
    const roots = {};
    if (opts.stageFirst !== false) { try { roots.stage = bs.rnd.stageInfo && bs.rnd.stageInfo(); } catch (e) { } }
    roots.__bs = bs;
    for (const k of ['world', 'rnd', 'gl', 'combat']) { try { roots[k] = bs[k]; } catch (e) { } }
    if (opts.stageFirst === false) { try { roots.stage = bs.rnd.stageInfo && bs.rnd.stageInfo(); } catch (e) { } }
    for (const k in roots) push(roots[k], k);
    const group = (p) => p.split('.').slice(0, opts.depth || 4).join('.').replace(/\[\d+\]/g, '[]');
    while (qi < q.length && n < maxNodes) {
      const [o, p] = q[qi]; q[qi++] = null; n++;
      if (o instanceof Node && !(o instanceof HTMLCanvasElement || o instanceof HTMLImageElement || o instanceof HTMLVideoElement)) continue;
      if (o instanceof WebGL2RenderingContext || o instanceof CanvasRenderingContext2D) continue;
      if (ArrayBuffer.isView(o)) { continue; }
      try {
        if (o.isTexture) { const pr = props.get(o); const wt = pr && pr.__webglTexture; if (wt && !named.has(wt)) named.set(wt, (o.name ? o.name + ' ' : '') + p); const im = o.image; if (im && !seenImg.has(im) && (im.width || im.data)) { seenImg.add(im); const b = im.data ? im.data.byteLength || 0 : (im.width || 0) * (im.height || 0) * 4; const k = (im instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && im instanceof OffscreenCanvas) ? 'canvas ' : im instanceof ImageBitmap ? 'bitmap ' : im instanceof HTMLImageElement ? 'img ' : im.data ? 'data ' : 'other ') + group(p); imgBy.set(k, (imgBy.get(k) || 0) + b); } }
        if (o.isRenderTarget) { for (const t of (o.textures || [o.texture])) { const pr = props.get(t); if (pr && pr.__webglTexture && !named.has(pr.__webglTexture)) named.set(pr.__webglTexture, 'RT ' + p); } if (o.depthTexture) { const pr = props.get(o.depthTexture); if (pr && pr.__webglTexture) named.set(pr.__webglTexture, 'RTdepth ' + p); } }
        if (o.isBufferGeometry && !geoSeen.has(o)) {
          geoSeen.add(o); let cpu = 0, gpu = 0; const arrs = []; for (const k in o.attributes) arrs.push(o.attributes[k]); if (o.index) arrs.push(o.index); for (const k in o.morphAttributes) arrs.push(...o.morphAttributes[k]);
          for (const at of arrs) { const arr = at && (at.data ? at.data.array : at.array); if (!arr || seenImg.has(arr)) continue; seenImg.add(arr); cpu += arr.byteLength || 0; const r = srcOf.get(arr); if (r) gpu += r.n || 0; }
          const k = group(p); const e = geoBy.get(k) || [0, 0, 0]; e[0] += cpu; e[1] += gpu; e[2]++; geoBy.set(k, e);
        }
      } catch (e) { }
      let keys; try { keys = o instanceof Map ? null : Object.keys(o); } catch (e) { continue; }
      if (o instanceof Map) { let i = 0; for (const [, v] of o) push(v, p + '[' + (i++) + ']'); continue; }
      if (o instanceof Set) { let i = 0; for (const v of o) push(v, p + '[' + (i++) + ']'); continue; }
      if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) push(o[i], p + '[' + i + ']'); continue; }
      for (const k of keys) { if (k === 'parent' || k === '_listeners') continue; let v; try { v = o[k]; } catch (e) { continue; } push(v, p + '.' + k); }
    }
    // textures, render-target textures, renderbuffers: grouped by what holds them
    const T = new Map(); const add = (k, b, c) => { const e = T.get(k) || [0, 0]; e[0] += b; e[1] += c; T.set(k, e); };
    const fmt = (r) => (FMTN[r.f] || r.f) + (r.cube ? ' cube' : '') + (r.d > 1 ? ' x' + r.d : '');
    for (const [t, r] of tex) { const b = texBytes(r); const p = named.get(t); add((p ? group(p) : 'UNNAMED ' + r.w + 'x' + r.h + ' ' + fmt(r)), b, 1); }
    for (const [, r] of rb) add('renderbuffer ' + r.w + 'x' + r.h + ' ' + (FMTN[r.f] || r.f) + ' s' + r.s, r.n, 1);
    const texTop = [...T.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, opts.top || 50).map(([k, [b, c]]) => `${MB(b)} MB x${c} ${k}`);
    const geoTop = [...geoBy.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, opts.top || 50).map(([k, [c, g, m]]) => `gpu ${MB(g)} cpu ${MB(c)} MB x${m} ${k}`);
    let geoGpu = 0, geoCpu = 0; for (const [, [c, g]] of geoBy) { geoGpu += g; geoCpu += c; }
    const imgTop = [...imgBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, b]) => `${MB(b)} MB ${k}`);
    let imgAll = 0; for (const v of imgBy.values()) imgAll += v;
    // the largest single textures, named or not
    const big = [...tex.entries()].map(([t, r]) => [texBytes(r), r, named.get(t)]).sort((a, b) => b[0] - a[0]).slice(0, 40).map(([b, r, p]) => `${MB(b)} ${r.w}x${r.h} ${fmt(r)}${r.comp ? ' compressed' : ''} ${p || '?'}`);
    const info = gl.info;
    return { totals: totals(), walked: n, three: { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs ? info.programs.length : 0 }, geoReachedMB: { gpu: MB(geoGpu), cpu: MB(geoCpu) }, imagesHeldMB: MB(imgAll), texTop, big, geoTop, imgTop, canvas: [gl.domElement.width, gl.domElement.height] };
  }
  window.__glmem = { totals, census };
})();
