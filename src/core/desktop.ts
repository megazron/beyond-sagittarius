/** Set by electron/preload.js when running inside the downloadable build. */
export interface BsDesktop {
  /** Base URL of the high-resolution assets shipped with the download. */
  assetBase: string;
  version: string;
  /** Preset used until the player picks one in Settings. */
  quality: string;
  quit(): void;
}

declare global {
  interface Window { bsDesktop?: BsDesktop }
}

export const desktop = window.bsDesktop;
