import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// The version players see on the title screen: the one store/release.sh gives the Android app.
const version = /versionName=(.+)/.exec(readFileSync(new URL('./android/app/version.properties', import.meta.url), 'utf8'))?.[1].trim() ?? '0';

// base './' keeps every asset path relative so the build works from
// https://<user>.github.io/<repo>/ as well as from any local static server.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  server: { host: true },
});
