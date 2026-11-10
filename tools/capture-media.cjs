// Records the README screenshots and the frames of the demo GIF.
// Run: npx electron tools/capture-media.cjs <frameDir>   (then tools/make-gif.py builds the GIF)
// Stills go to docs/media/*.png, GIF frames to <frameDir>/f####.png.
const { app, BrowserWindow, session } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'media');
const FRAMES = process.argv[2] || path.join(ROOT, 'dist', 'frames');
const ONLY = process.argv[3] || 'all'; // 'stills' | 'gif' | 'all'
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };
const ZOOM = +(process.argv[4] || 3);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

app.whenReady().then(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const win = new BrowserWindow({ width: 1280, height: 760, useContentSize: true, show: true, backgroundColor: '#1c2025', autoHideMenuBar: true,
    webPreferences: { session: session.fromPartition('capture' + Date.now()), contextIsolation: true, backgroundThrottling: false } });
  const wc = win.webContents;
  const js = code => wc.executeJavaScript(`(async()=>{${code}})()`, true);
  const shot = async file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, (await wc.capturePage()).toPNG()); };
  const still = name => shot(path.join(OUT, name + '.png')).then(() => console.log('still', name));
  let fno = 0;
  const frame = () => shot(path.join(FRAMES, 'f' + String(fno++).padStart(4, '0') + '.png'));
  const click = sel => js(`const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('missing '+${JSON.stringify(sel)}); e.click();`);
  const clickText = (sel, text) => js(`const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.trim()===${JSON.stringify(text)}); if(!e) throw new Error('missing text '+${JSON.stringify(text)}); e.click();`);
  const workspace = ws => js(`const s=document.querySelector('#workspace'); s.value=${JSON.stringify(ws)}; s.dispatchEvent(new Event('change'));`);
  const viewRect = () => js(`const r=document.querySelector('#viewport').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};`);
  // orbit by dragging with the left button over the free middle of the view
  const orbit = async (dx, dy, steps = 1, each) => {
    const r = await viewRect(), x0 = Math.round(r.x + r.w * 0.62), y0 = Math.round(r.y + r.h * 0.55);
    wc.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x0 + (dx * i) / steps), y: Math.round(y0 + (dy * i) / steps), button: 'left', buttons: 1 });
      await sleep(40);
      if (each) await each();
    }
    wc.sendInputEvent({ type: 'mouseUp', x: x0 + dx, y: y0 + dy, button: 'left', clickCount: 1 });
    await sleep(60);
  };
  const seekSim = v => js(`const p=document.querySelector('#simProgress'); p.value=${v}; p.dispatchEvent(new Event('input'));`);
  // zoom with the wheel over the middle of the view (positive = closer)
  const zoom = async n => {
    const r = await viewRect(), x = Math.round(r.x + r.w * 0.5), y = Math.round(r.y + r.h * 0.5);
    for (let i = 0; i < Math.abs(n); i++) { await js(`const c=document.querySelector('#viewport canvas'); c.dispatchEvent(new WheelEvent('wheel',{deltaY:${-100 * Math.sign(n)},clientX:${x},clientY:${y},bubbles:true,cancelable:true}));`); await sleep(60); }
    await sleep(400);
  };
  // real double click on the browser row with this label
  const dblRow = async text => {
    const c = await js(`const e=[...document.querySelectorAll('#tree *')].find(x=>!x.children.length && x.textContent.trim()===${JSON.stringify(text)}); if(!e) throw new Error('row'); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};`);
    for (const n of [1, 2]) { wc.sendInputEvent({ type: 'mouseDown', ...c, button: 'left', clickCount: n }); wc.sendInputEvent({ type: 'mouseUp', ...c, button: 'left', clickCount: n }); await sleep(80); }
  };
  const timeline = dir => click(`[data-tl=${dir}]`);

  wc.on('console-message', (_e, level, msg) => { if (level >= 3) console.log('page error:', msg); });
  await win.loadURL(url);
  await sleep(6000);

  const loadExample = async turning => { await click(turning ? '[data-act=example-turn]' : '[data-act=example]'); await sleep(5000); await click('[data-view=iso]'); await sleep(700); await click('[data-nav=fit]'); await sleep(700); await zoom(ZOOM); };

  try {
    if (ONLY !== 'gif') {
      // 1 design
      await loadExample(false);
      await still('01-konstruktion');
      // 2 sketch
      await dblRow('Skizze1');
      await sleep(2500);
      await still('02-skizze');
      await clickText('#tools button', 'Skizze fertig');
      await sleep(2000);
      // 3 CAM toolpaths
      await workspace('cam');
      await sleep(6000);
      await still('03-fertigung');
      // 4 simulation
      await clickText('#tools button', 'Simulieren').catch(async () => { console.log(await js(`return [...document.querySelectorAll('#tools button')].map(x=>x.textContent.trim()).join('|')`)); });
      await sleep(2500);
      await zoom(ZOOM + 3);
      await seekSim(620);
      await sleep(1500);
      await still('04-simulation');
      await click('#simClose').catch(() => {});
      await sleep(800);
      // 5 turning
      await loadExample(true);
      await workspace('cam');
      await sleep(6000);
      await still('05-drehen');
      // 6 render
      await loadExample(false);
      await workspace('render');
      await sleep(5000);
      // the scene settings would cover the picture
      await js(`document.querySelector('#winProps .fw-collapse')?.click();`);
      await sleep(800);
      await still('06-rendern');
      await workspace('design');
      await sleep(1500);
    }
    if (ONLY !== 'stills') {
      fs.rmSync(FRAMES, { recursive: true, force: true });
      await loadExample(false);
      // design: play the timeline feature by feature while the view turns
      await timeline('start');
      await sleep(1200);
      const n = await js(`return document.querySelectorAll('#tlItems .tl').length;`);
      for (let i = 0; i < 3; i++) await frame();
      for (let i = 0; i < n; i++) {
        await timeline('fwd');
        await sleep(1300);
        await orbit(10, 0, 4, frame);
      }
      for (let i = 0; i < 4; i++) await frame();
      // manufacturing: toolpaths, then the simulation with material removal
      await click('[data-view=iso]');
      await sleep(700);
      await workspace('cam');
      await sleep(6000);
      for (let i = 0; i < 5; i++) await frame();
      await clickText('#tools button', 'Simulieren');
      await sleep(2500);
      await zoom(ZOOM + 3);
      const N = 46;
      for (let i = 0; i <= N; i++) { await seekSim(Math.round((1000 * i) / N)); await sleep(350); await frame(); }
      for (let i = 0; i < 8; i++) await frame();
      console.log('frames', fno);
    }
  } catch (err) { console.log('ERROR', err.message); }
  server.close();
  app.quit();
});
