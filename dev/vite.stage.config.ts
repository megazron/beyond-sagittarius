// Frozen build of the film stage: editing the repo can't disturb a running dump. Dev only.
import { defineConfig } from 'vite';
export default defineConfig({ base: '/', build: { outDir: process.env.STAGE_OUT, emptyOutDir: true, rollupOptions: { input: ['dev/entry.html', 'dev/rig.html', 'dev/chars.html', 'dev/vault.html'] } } });
