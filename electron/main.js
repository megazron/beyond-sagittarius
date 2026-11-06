'use strict';
/**
 * Desktop shell for BEYOND SAGITTARIUS.
 *
 * The built game (dist/) is served from app://game/ and optional high-resolution
 * assets from app://assets/. A custom scheme rather than file:// gives the page
 * a stable secure origin: WebGPU needs a secure context, and localStorage (the
 * save slot) stays put whichever folder the game is installed to.
 */
const { app, BrowserWindow, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'app';
const ENTRY = `${SCHEME}://game/index.html`;
const ASSET_BASE = `${SCHEME}://assets/`;
const DEFAULT_QUALITY = 'cinematic';

const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const ROOTS = {
  game: path.join(base, app.isPackaged ? 'game' : 'dist'),
  // Installed with the game, or unzipped next to the .exe if shipped separately.
  assets: [
    path.join(base, app.isPackaged ? 'assets' : 'desktop-assets'),
    path.join(path.dirname(app.getPath('exe')), 'assets'),
  ].find((d) => fs.existsSync(d)) ?? path.join(base, 'assets'),
};

// Set explicitly: on Windows the type of a file:// response comes from the
// registry, and a machine mapping .js to text/plain would stop the game booting.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ktx2': 'image/ktx2',
  '.exr': 'image/x-exr',
  '.hdr': 'image/vnd.radiance',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

// WebGPU is on by default on Windows; these keep it available on GPUs and
// drivers Chromium's blocklist would turn away, and ask for the discrete GPU.
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('force_high_performance_gpu');

async function serve(request) {
  const url = new URL(request.url);
  const root = ROOTS[url.hostname];
  if (!root) return new Response('Not found', { status: 404 });
  const file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
  let res;
  try {
    res = await net.fetch(pathToFileURL(file).href, { headers: request.headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const headers = new Headers(res.headers);
  headers.set('content-type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
  headers.set('access-control-allow-origin', '*'); // game and assets are separate origins
  return new Response(res.body, { status: res.status, headers });
}

function createWindow() {
  const windowed = process.env.BS_WINDOWED === '1'; // for tests
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: !windowed,
    backgroundColor: '#05070d',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      additionalArguments: [
        `--bs-version=${app.getVersion()}`,
        `--bs-asset-base=${ASSET_BASE}`,
        `--bs-quality=${DEFAULT_QUALITY}`,
      ],
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && !input.isAutoRepeat) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  // The game stays on app://; the download or credit links open in the browser.
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(`${SCHEME}://game/`)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(ENTRY);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit(); // two copies would fight over the save slot
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    protocol.handle(SCHEME, serve);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => {
      done(permission === 'pointerLock' || permission === 'fullscreen');
    });
    ipcMain.on('bs-quit', () => app.quit());
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
