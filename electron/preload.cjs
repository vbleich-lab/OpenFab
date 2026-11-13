// Bridge between the page and the desktop app: only what the updater needs.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('werkfabApp', {
  info: () => ipcRenderer.invoke('update:info'),
  check: () => ipcRenderer.invoke('update:check'),
  download: () => ipcRenderer.invoke('update:download'),
  install: () => ipcRenderer.invoke('update:install'),
  onState: fn => { ipcRenderer.on('update:state', (_e, s) => fn(s)); },
  // size of the whole interface (Einstellungen → Benutzeroberfläche)
  zoom: f => { try { webFrame.setZoomFactor(Math.max(0.5, Math.min(3, +f || 1))); } catch { /* keeps the size */ } },
});
