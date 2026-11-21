import * as THREE from 'three';
import { Character, CHAR_BUDGET } from '../../characters/character';

/**
 * Far people as baked impostors. The painted crowd cards read as cardboard; these are pictures of the game's own
 * bodies: a handful of townsfolk are each drawn once, at load, into an atlas: six frames of their walk and one standing,
 * from eight sides round them. A card then shows the frame and the side that fit how its person is walking
 * and where the camera is, and is tinted by the light of the hour, so at twenty metres a card and a body are hard to
 * tell apart. One atlas, one draw for every far person in the city.
 *
 * The bake is spread over frames (one row of eight sides of one body a frame) while the player is still in the flat.
 */
export const IMP = { views: 8, walk: 6, frames: 7 }; // frame 6 is standing; eight sides, so a card turning with its walker steps 45 degrees, not 90

export function impostorBaker(renderer: THREE.WebGLRenderer, bodies: Character[], tile: [number, number], env: () => THREE.Texture | null) {
  const V = bodies.length, cols = V * IMP.views, rows = IMP.frames, [TW, TH] = tile;
  const rt = new THREE.WebGLRenderTarget(cols * TW, rows * TH, { depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const stage = new THREE.Scene();
  stage.add(new THREE.HemisphereLight(0xffffff, 0x9a8a80, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(0.4, 1, 0.6); stage.add(key);
  // 1.1 m by 2.0 m of world in each tile, the feet on its bottom edge
  const cam = new THREE.OrthographicCamera(-0.55, 0.55, 2.0, 0, 0.1, 20);
  let next = 0, cleared = false, ready = 0;
  const waits = bodies.map((b) => b.whenReady.then(() => { ready++; }));
  void waits;
  const old = new THREE.Color(), vp = new THREE.Vector4();
  // one row of one body a frame (its eight sides): a whole body at once was fifty renders of a skinned body in one frame,
  // a spike of several hundred draw calls while you are in the flat. The body stays on the bake stage until its rows are done.
  let row = 0, t = 100, ph = 0;
  let held: { root: THREE.Object3D; parent: THREE.Object3D | null; pos: THREE.Vector3; ry: number; vis: boolean } | null = null;
  const shootRow = (i: number) => {
    const fig = bodies[i], root = fig.root;
    const throttle = CHAR_BUDGET.throttle; CHAR_BUDGET.throttle = false;
    if (!held) {
      held = { root, parent: root.parent, pos: root.position.clone(), ry: root.rotation.y, vis: root.visible };
      stage.add(root); root.position.set(0, 0, 0); root.rotation.y = 0; root.visible = true; t = 100; ph = 0;
      // into the walk
      for (let k = 0; k < 14; k++) { t += 0.1; ph += 0.3; fig.animate('walk', ph, 0.35, t, 0.1); }
    }
    root.position.set(0, 0, 0); root.rotation.y = 0; root.visible = true; // the city may have touched it since the last row
    stage.environment = env();
    const oldRt = renderer.getRenderTarget(), oldAlpha = renderer.getClearAlpha(), auto = renderer.autoClear, shadows = renderer.shadowMap.enabled;
    renderer.getClearColor(old); renderer.getViewport(vp);
    renderer.shadowMap.enabled = false; renderer.autoClear = false; renderer.setRenderTarget(rt);
    if (!cleared) { renderer.setClearColor(0x4a3e3a, 0); renderer.clear(); cleared = true; }
    // six frames of one walk cycle, then standing
    if (row < IMP.walk) { t += 0.18; ph += 0.55; fig.animate('walk', ph, 0.35, t, 0.18); }
    else for (let k = 0; k < 12; k++) { t += 0.1; fig.animate('idle', ph, 0, t, 0.1); }
    for (let w = 0; w < IMP.views; w++) {
      const a = (w * Math.PI * 2) / IMP.views;
      cam.position.set(Math.sin(a) * 6, 0, Math.cos(a) * 6); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
      rt.viewport.set((i * IMP.views + w) * TW, row * TH, TW, TH); rt.scissor.copy(rt.viewport); rt.scissorTest = true;
      renderer.setRenderTarget(rt); renderer.clearDepth(); renderer.render(stage, cam);
    }
    rt.scissorTest = false;
    renderer.setRenderTarget(oldRt); renderer.setClearColor(old, oldAlpha); renderer.autoClear = auto; renderer.shadowMap.enabled = shadows; renderer.setViewport(vp);
    CHAR_BUDGET.throttle = throttle;
    if (++row >= IMP.frames) {
      const h = held!; stage.remove(h.root); h.parent?.add(h.root); h.root.position.copy(h.pos); h.root.rotation.y = h.ry; h.root.visible = h.vis;
      held = null; row = 0; return true;
    }
    return false;
  };
  return {
    texture: rt.texture, cols, rows, variants: V,
    get done() { return next >= V; },
    /** Call once a frame, outside the game's own render: bakes one body when they are all loaded. Returns true when it just finished. */
    step() {
      if (next >= V || ready < V) return false;
      if (shootRow(next)) next++;
      return next >= V;
    },
    dispose() { rt.dispose(); },
  };
}
