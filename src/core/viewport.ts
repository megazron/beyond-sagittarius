import type * as THREE from 'three';

/**
 * Scenes are framed for landscape. On a portrait phone the same vertical FOV
 * leaves a keyhole view, so widen it until the horizontal FOV is close to what
 * a 16:9 screen would show (capped so it doesn't turn into a fish-eye).
 */
export function fitFov(cam: THREE.PerspectiveCamera, maxFov = 92) {
  const aspect = cam.aspect;
  if (aspect >= 1.2) return;
  const design = (cam.fov * Math.PI) / 180;
  // horizontal FOV the scene was designed for, on a 16:9 screen, eased toward 1.2:1
  const hTarget = 2 * Math.atan(Math.tan(design / 2) * Math.min(16 / 9, 1.2 + (16 / 9 - 1.2) * 0.5));
  const v = 2 * Math.atan(Math.tan(hTarget / 2) / aspect);
  const fov = Math.min(maxFov, Math.max(cam.fov, (v * 180) / Math.PI));
  if (Math.abs(fov - cam.fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
}

/** Phones: no pinch-zoom, double-tap zoom or rubber-band scrolling. */
export function lockViewport() {
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', stop, { passive: false } as AddEventListenerOptions);
  document.addEventListener('gesturechange', stop, { passive: false } as AddEventListenerOptions);
  document.addEventListener('dblclick', stop, { passive: false });
  document.addEventListener('touchmove', (e) => {
    // allow scrolling inside menus only
    const t = e.target as HTMLElement | null;
    if (t?.closest('.modal-card, .scrollable')) return;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  const setVh = () => document.documentElement.style.setProperty('--vh', `${window.innerHeight / 100}px`);
  window.addEventListener('resize', setVh);
  setVh();
}

/** Fullscreen on phones when a game starts (ignored where unsupported, e.g. iPhone Safari). */
export function tryFullscreen() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement) return;
  try {
    const r = el.requestFullscreen?.({ navigationUI: 'hide' });
    r?.catch?.(() => {});
  } catch { /* ignore */ }
}
