// Dev only: how long character building takes on the main thread.
import { createCharacter, preloadCrew } from '../src/characters/character';
import { defaultLook } from '../src/characters/custom';
const W = window as unknown as Record<string, unknown>;
(async () => {
  const t0 = performance.now();
  await preloadCrew(['scientist', 'strong', 'custom_m_scientist'], 1);
  const load = performance.now() - t0;
  const out: Record<string, number> = { load };
  for (const [n, f] of [
    ['scientist', () => createCharacter('scientist', 1)],
    ['scientist2', () => createCharacter('scientist', 1)],
    ['strong', () => createCharacter('strong', 1)],
    ['custom', () => createCharacter('scientist', 1, defaultLook())],
  ] as [string, () => unknown][]) {
    const t = performance.now(); f(); out[n] = Math.round(performance.now() - t);
    await new Promise((r) => setTimeout(r, 200));
  }
  W.result = out;
})();
