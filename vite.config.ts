import { defineConfig } from 'vite';

// base './' keeps every asset path relative so the build works from
// https://<user>.github.io/<repo>/ as well as from any local static server.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  server: { host: true },
});
