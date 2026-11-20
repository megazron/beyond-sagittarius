import * as THREE from 'three';

/**
 * `?demo=city`: the game plays a short tour of Zenvora by itself and records it from the page (the game's canvas with
 * the minimap and the task line drawn over it, through MediaRecorder), then downloads the video. It exists so the
 * real thing can be filmed on a real GPU in a plain browser window, with no automation attached. Nothing here runs
 * otherwise.
 */
export interface DemoHooks {
  canvas: HTMLCanvasElement;
  minimap: HTMLCanvasElement;
  state(): { state: string; mode: string; away: boolean };
  skip(): void;
  /** The body you play on the away stage, and its camera yaw. */
  player(): { pos: THREE.Vector3; yaw: number; setYaw(y: number): void } | null;
  teleport(x: number, z: number, yaw: number): void;
  setWaypoint(p: { x: number; z: number } | null): void;
  /** The route the GPS shows now (x, z points from the player). */
  route(): [number, number][] | null;
  hold(code: string, on: boolean): void;
  task(): string;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runDemo(h: DemoHooks) {
  // a new game, straight through the cold open to the city
  await wait(1500);
  for (let i = 0; i < 600 && !(window as unknown as { __bs?: { ready?: boolean } }).__bs?.ready; i++) await wait(500);
  (document.getElementById('btn-new') as HTMLButtonElement | null)?.click();
  await wait(1200);
  (document.getElementById('nm-ok') as HTMLButtonElement | null)?.click();
  for (let i = 0; i < 600 && !h.state().away; i++) { if (h.state().state === 'narrator') h.skip(); await wait(500); }
  await wait(5000);

  // the recording: the game's frame, the minimap and the task line, composited at 30 fps
  const out = document.createElement('canvas'); out.width = 1280; out.height = 720;
  const g = out.getContext('2d')!;
  let on = true;
  const paint = () => {
    if (!on) return;
    g.drawImage(h.canvas, 0, 0, out.width, out.height);
    const m = h.minimap, s = 190;
    if (m.width) g.drawImage(m, out.width - s - 24, 22, s, s);
    g.font = '600 22px Barlow, sans-serif'; g.fillStyle = '#e8a33d'; g.shadowColor = '#000'; g.shadowBlur = 6;
    g.fillText(h.task(), 28, 46); g.shadowBlur = 0;
    requestAnimationFrame(paint);
  };
  requestAnimationFrame(paint);
  const rec = new MediaRecorder(out.captureStream(30), { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm', videoBitsPerSecond: 6e6 });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  rec.start(1000);

  // walk the GPS route for a while: face the next point of the route, hold forward
  const follow = async (secs: number, sprint = false) => {
    h.hold('KeyW', true); if (sprint) h.hold('ShiftLeft', true);
    const t0 = performance.now(); let last = new THREE.Vector3(), lastT = t0, side = 'KeyD';
    while (performance.now() - t0 < secs * 1000) {
      const p = h.player(), r = h.route();
      // caught on furniture or a door frame: side-step for a moment, the other way next time
      if (p && performance.now() - lastT > 900) {
        if (p.pos.distanceTo(last) < 0.4) { h.hold(side, true); await wait(550); h.hold(side, false); side = side === 'KeyD' ? 'KeyA' : 'KeyD'; }
        last.copy(p.pos); lastT = performance.now();
      }
      if (p && r && r.length > 1) {
        // the point a couple of metres along the route
        let [tx, tz] = r[1];
        for (let i = 1; i < r.length; i++) { [tx, tz] = r[i]; if (Math.hypot(tx - p.pos.x, tz - p.pos.z) > 2.5) break; }
        const want = -Math.atan2(tx - p.pos.x, -(tz - p.pos.z));
        const d = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw));
        p.setYaw(p.yaw + d * 0.12);
      }
      await wait(33);
    }
    h.hold('KeyW', false); h.hold('ShiftLeft', false);
  };
  // 1. a look round the flat, then out of its door and along the street by the GPS to the first side street
  h.setWaypoint({ x: 7, z: 30 });
  await wait(3000);
  h.teleport(8.2, 65.4, Math.PI / 2); await wait(800);
  await follow(24);
  // 2. down among the townsfolk: walk right up to them
  h.setWaypoint({ x: -6, z: -30 });
  h.teleport(-6, 14, Math.PI); await wait(800);
  await follow(14);
  // 3. the side street and its square
  h.setWaypoint({ x: 62, z: 30 });
  h.teleport(12, 30, 0); await wait(800);
  await follow(16, true);
  h.setWaypoint(null);
  await wait(2500);

  rec.stop(); on = false;
  await new Promise((r) => { rec.onstop = r; });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(parts, { type: 'video/webm' }));
  a.download = `bs_v1.1_city_gpu_${Date.now()}.webm`;
  document.body.appendChild(a); a.click();
  document.title = 'DEMO DONE';
}
