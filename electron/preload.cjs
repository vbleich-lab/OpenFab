// Bridge between the page and the desktop app: only what the updater needs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('werkfabApp', {
  info: () => ipcRenderer.invoke('update:info'),
  check: () => ipcRenderer.invoke('update:check'),
  download: () => ipcRenderer.invoke('update:download'),
  install: () => ipcRenderer.invoke('update:install'),
  onState: fn => { ipcRenderer.on('update:state', (_e, s) => fn(s)); },
});
