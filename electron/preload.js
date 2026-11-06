'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const arg = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? '';
};

contextBridge.exposeInMainWorld('bsDesktop', {
  assetBase: arg('bs-asset-base'),
  version: arg('bs-version'),
  quality: arg('bs-quality'),
  quit: () => ipcRenderer.send('bs-quit'),
});
