import type * as THREE from 'three';

/**
 * ?gputime=1: GPU time of each post-chain pass (EXT_disjoint_timer_query_webgl2), averaged, in `window.__gpuTime`
 * ({ supported, ms: { scene, ao, ssr, ... }, frames }). "scene" includes the shadow maps (they render inside it). For
 * finding what an Ultra frame spends on the GPU; off unless asked for (a query per pass per frame).
 */
type Pass = { render: (...a: unknown[]) => void; enabled?: boolean };
export const GPU_TIME = { supported: false, ms: {} as Record<string, number>, frames: 0 };

export function installGpuTimer(r: THREE.WebGLRenderer, passes: { pass: Pass; name: string }[]) {
  const gl = r.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  (window as unknown as { __gpuTime: typeof GPU_TIME }).__gpuTime = GPU_TIME;
  if (!ext) return;
  GPU_TIME.supported = true;
  const pending: { q: WebGLQuery; name: string }[] = [];
  const sum: Record<string, number> = {}, cnt: Record<string, number> = {};
  let open = false;
  for (const { pass, name } of passes) {
    const orig = pass.render.bind(pass);
    pass.render = (...a: unknown[]) => {
      if (open) { orig(...a); return; }
      const q = gl.createQuery()!; gl.beginQuery(ext.TIME_ELAPSED_EXT, q); open = true;
      try { orig(...a); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); open = false; pending.push({ q, name }); }
    };
  }
  const poll = () => {
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
      const { q, name } = pending.shift()!;
      if (!disjoint) { sum[name] = (sum[name] ?? 0) + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; cnt[name] = (cnt[name] ?? 0) + 1; }
      gl.deleteQuery(q);
    }
    GPU_TIME.frames++;
    for (const k in sum) GPU_TIME.ms[k] = +(sum[k] / cnt[k]).toFixed(2);
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
  /** Start the averages over (call when the camera reaches a new spot). */
  (window as unknown as { __gpuTimeReset: () => void }).__gpuTimeReset = () => { for (const k in sum) { delete sum[k]; delete cnt[k]; } GPU_TIME.ms = {}; };
}
