// Program icon: icons/icon.svg → icons/icon-512.png, icons/icon-192.png, electron/icon.png, electron/icon.ico.
// Run: npx electron tools/make-icon.cjs [preview.png]   (with a file name: only that picture, 1024 px)
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'icons', 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style>${svg}`));
  await new Promise(r => setTimeout(r, 800));
  let img = await win.webContents.capturePage();
  if (img.getSize().width !== 1024) img = img.resize({ width: 1024, height: 1024, quality: 'best' });
  const png = n => (n === 1024 ? img : img.resize({ width: n, height: n, quality: 'best' })).toPNG();
  const only = process.argv[2];
  if (only) { fs.writeFileSync(only, png(1024)); app.quit(); return; }
  fs.writeFileSync(path.join(root, 'icons', 'icon-512.png'), png(512));
  fs.writeFileSync(path.join(root, 'icons', 'icon-192.png'), png(192));
  fs.writeFileSync(path.join(root, 'electron', 'icon.png'), png(512));
  // ICO: a directory of PNG pictures
  const sizes = [16, 24, 32, 48, 64, 128, 256], pics = sizes.map(png);
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = head.length;
  sizes.forEach((n, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(n === 256 ? 0 : n, e); head.writeUInt8(n === 256 ? 0 : n, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(pics[i].length, e + 8); head.writeUInt32LE(off, e + 12);
    off += pics[i].length;
  });
  fs.writeFileSync(path.join(root, 'electron', 'icon.ico'), Buffer.concat([head, ...pics]));
  console.log('icon written:', sizes.join(', '), '+ 192, 512');
  app.quit();
});
