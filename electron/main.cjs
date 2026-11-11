// Toolbahn desktop app: serves the app files from disk through a private
// "app://" scheme (ES modules, WebAssembly and fetch work like on a web server),
// so everything runs offline.
const { app, BrowserWindow, protocol, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

// one window only; a second start brings the first one to the front
if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1000, minHeight: 640,
    title: 'Toolbahn', backgroundColor: '#1c2025', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  // SpaceMouse (WebHID): Electron has no device chooser, so 3Dconnexion devices are
  // picked and allowed automatically; other HID devices stay blocked.
  const ses = win.webContents.session;
  const isSpaceMouse = d => d.vendorId === 0x256f || (d.vendorId === 0x046d && /space|3dconnexion/i.test(d.name || d.productName || ''));
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const d = details.deviceList.find(isSpaceMouse) || details.deviceList[0];
    callback(d ? d.deviceId : '');
  });
  ses.setPermissionCheckHandler(() => true); // same as Electron's default, needed so WebHID is allowed
  ses.setDevicePermissionHandler(details => details.deviceType === 'hid' && isSpaceMouse(details.device));
  // print / setup sheet windows (about:blank) are allowed, web links open in the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url || url === 'about:blank') return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: path.join(__dirname, 'icon.ico') } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.loadURL('app://openfab/index.html');
  return win;
}

app.on('second-instance', () => {
  const [w] = BrowserWindow.getAllWindows();
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
});

app.whenReady().then(() => {
  protocol.handle('app', async req => {
    let rel = decodeURIComponent(new URL(req.url).pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
