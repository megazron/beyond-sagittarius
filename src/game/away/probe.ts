import * as THREE from 'three';

/**
 * A reflection probe that follows the camera. The city's image-based light was its sky alone, so wet paving, puddles,
 * glass and car paint mirrored a clean sky in the middle of a neon street. The probe draws the street itself into a
 * small cube map, one face every few frames (so no frame pays for more than a sixth of it), filters it (PMREM) and
 * hands it to the scene as its environment: puddles hold the signs above them, shop glass holds the street.
 *
 * Bodies are left out (the player's own would smear across every reflection), shadows are not redrawn for it, and the
 * cube is drawn from head height at the camera, so it is right where you are looking from.
 */
export function cityProbe(renderer: THREE.WebGLRenderer, scene: THREE.Scene, opts: { size: number; every: number; hide: () => THREE.Object3D[] }) {
  const rt = new THREE.WebGLCubeRenderTarget(opts.size, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const cube = new THREE.CubeCamera(0.4, 2400, rt); // far enough for the sky dome
  const pmrem = new THREE.PMREMGenerator(renderer);
  let face = 0, wait = 0, env: THREE.WebGLRenderTarget | null = null, inited = false;
  const at = new THREE.Vector3();
  return {
    get ready() { return !!env; },
    /** Call once a frame outside the game's own render. Returns a new environment texture when a round is finished. */
    step(camPos: THREE.Vector3): THREE.Texture | null {
      if (wait-- > 0) return null;
      wait = opts.every;
      if (face === 0) { at.set(camPos.x, Math.max(1.6, Math.min(camPos.y, 6)), camPos.z); cube.position.copy(at); cube.updateMatrixWorld(true); }
      if (!inited) { (cube as unknown as { coordinateSystem: number }).coordinateSystem = renderer.coordinateSystem; cube.updateCoordinateSystem(); cube.updateMatrixWorld(true); inited = true; }
      const hidden = opts.hide().filter((o) => o.visible);
      for (const o of hidden) o.visible = false;
      const prev = renderer.getRenderTarget(), sAuto = renderer.shadowMap.autoUpdate, sNeed = renderer.shadowMap.needsUpdate, old = scene.environment;
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
      // the probe sees the street lit by the last probe: each bounce must lose light, or mirrors (puddles, glass) feed
      // themselves and the whole city whites out
      const ei = scene.environmentIntensity; scene.environmentIntensity = Math.min(ei, 1) * 0.4;
      renderer.setRenderTarget(rt, face);
      renderer.render(scene, cube.children[face] as THREE.Camera);
      renderer.setRenderTarget(prev);
      renderer.shadowMap.autoUpdate = sAuto; renderer.shadowMap.needsUpdate = sNeed; scene.environment = old; scene.environmentIntensity = ei;
      for (const o of hidden) o.visible = true;
      if (++face < 6) return null;
      face = 0;
      const next = pmrem.fromCubemap(rt.texture);
      renderer.setRenderTarget(prev);
      env?.dispose(); env = next;
      return next.texture;
    },
    /** Test hook: the brightest and the mean value of each face of the cube (and of the filtered map), to catch a probe that feeds itself. */
    debug() {
      const n = opts.size, buf = new Uint16Array(n * n * 4), out: { max: number; mean: number; bad: number }[] = [];
      const read = (target: THREE.WebGLRenderTarget, face: number | undefined, w: number, h: number) => {
        const b = w * h * 4 > buf.length ? new Uint16Array(w * h * 4) : buf;
        renderer.readRenderTargetPixels(target, 0, 0, w, h, b, face);
        let mx = 0, sum = 0, bad = 0;
        for (let i = 0; i < w * h * 4; i += 4) for (let c = 0; c < 3; c++) { const v = THREE.DataUtils.fromHalfFloat(b[i + c]); if (!Number.isFinite(v)) { bad++; continue; } mx = Math.max(mx, v); sum += v; }
        out.push({ max: +mx.toFixed(2), mean: +(sum / (w * h * 3)).toFixed(3), bad });
      };
      for (let f = 0; f < 6; f++) read(rt, f, n, n);
      if (env) read(env, undefined, Math.min(env.width, 256), Math.min(env.height, 256));
      return out;
    },
    dispose() { rt.dispose(); env?.dispose(); pmrem.dispose(); },
  };
}
