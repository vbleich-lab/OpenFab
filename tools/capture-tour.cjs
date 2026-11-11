// Records the picture sequences of the introduction video: a tour from the sketch to the NC program.
// Run: npx electron tools/capture-tour.cjs <frameDir>
// Frames go to <frameDir>/<segment>/f####.png (1920 × 1080 on a display scaled to 150 %).
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
const LANG = process.argv[5] || 'en';
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
  const win = new BrowserWindow({ width: 1280, height: 720, useContentSize: true, show: true, backgroundColor: '#1c2025', autoHideMenuBar: true,
    webPreferences: { session: session.fromPartition('capture' + Date.now()), contextIsolation: true, backgroundThrottling: false } });
  const wc = win.webContents;
  const js = code => wc.executeJavaScript(`(async()=>{${code}})()`, true);
  const shot = async file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, (await wc.capturePage()).toPNG()); };
  const still = name => shot(path.join(OUT, name + '.png')).then(() => console.log('still', name));
  let fno = 0, segName = 'x';
  const seg = name => { segName = name; fno = 0; console.log('segment', name); };
  const frame = () => shot(path.join(FRAMES, segName, 'f' + String(fno++).padStart(4, '0') + '.png'));
  const hold = async n => { for (let i = 0; i < n; i++) await frame(); };
  const click = sel => js(`const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('missing '+${JSON.stringify(sel)}); e.click();`);
  const clickText = (sel, text) => js(`const {deText:D}=await import('/js/i18n.js'); const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>D(x).trim()===${JSON.stringify(text)}); if(!e) throw new Error('missing text '+${JSON.stringify(text)}); e.click();`);
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
    const c = await js(`const {deText:D}=await import('/js/i18n.js'); const e=[...document.querySelectorAll('#tree *')].find(x=>!x.children.length && D(x).trim()===${JSON.stringify(text)}); if(!e) throw new Error('row'); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};`);
    for (const n of [1, 2]) { wc.sendInputEvent({ type: 'mouseDown', ...c, button: 'left', clickCount: n }); wc.sendInputEvent({ type: 'mouseUp', ...c, button: 'left', clickCount: n }); await sleep(80); }
  };
  const timeline = dir => click(`[data-tl=${dir}]`);

  wc.on('console-message', (_e, level, msg) => { if (level >= 3) console.log('page error:', msg); });
  await win.loadURL(url);
  // the pictures show the interface in this language (texts are still found by their German originals)
  await js(`localStorage.setItem('openfab.lang', ${JSON.stringify(LANG)});`);
  await win.loadURL(url);
  await sleep(6000);

  const loadExample = async turning => { await click(turning ? '[data-act=example-turn]' : '[data-act=example]'); await sleep(5000); await click('[data-view=iso]'); await sleep(700); await click('[data-nav=fit]'); await sleep(700); await zoom(ZOOM); };

  const WANT = (process.argv[6] || '').split(',').filter(Boolean);
  const step = async (name, fn) => { if (WANT.length && !WANT.includes(name)) return; fs.rmSync(path.join(FRAMES, name), { recursive: true, force: true }); seg(name); try { await fn(); } catch (err) { console.log('ERROR in', name, err.message); } console.log('  frames', fno); };
  if (!WANT.length) fs.rmSync(FRAMES, { recursive: true, force: true });
  if (WANT.length) await loadExample(false);

  await step('a-design', async () => {
    await loadExample(false);
    await timeline('start');
    await sleep(1200);
    const n = await js(`return document.querySelectorAll('#tlItems .tl').length;`);
    await hold(3);
    for (let i = 0; i < n; i++) { await timeline('fwd'); await sleep(1200); await orbit(12, 0, 6, frame); }
    await hold(4);
  });
  await step('b-sketch', async () => {
    await dblRow('Skizze1');
    await sleep(2500);
    await hold(3);
    await clickText('#tools button', 'Skizze fertig');
    await sleep(2000);
  });
  await step('c-drawing', async () => {
    await clickText('button', 'Zeichnung');
    // the sheet takes a moment; ask again when it stays empty
    for (let i = 0; i < 6 && !(await js(`return !!document.querySelector('#drawingView svg')`)); i++) { await sleep(3000); if (i === 2) await js(`document.querySelector('#winDrawing .fw-close')?.click();`).then(() => sleep(500)).then(() => clickText('button', 'Zeichnung')); }
    // the drawing window as large as the program window
    await js(`const w=document.querySelector('#winDrawing'); Object.assign(w.style,{left:'8px',top:'96px',width:(innerWidth-16)+'px',height:(innerHeight-140)+'px'});`);
    await sleep(1500);
    await hold(3);
    await js(`document.querySelector('#winDrawing .fw-close')?.click();`);
    await sleep(800);
  });
  await step('d-cam', async () => {
    await click('[data-view=iso]');
    await sleep(700);
    await workspace('cam');
    await sleep(6000);
    await hold(2);
    await orbit(48, 0, 24, frame);
  });
  await step('e-sim', async () => {
    await click('[data-view=iso]');
    await sleep(700);
    await clickText('#tools button', 'Simulieren');
    await sleep(2500);
    await zoom(ZOOM + 3);
    const N = 110;
    for (let i = 0; i <= N; i++) { await seekSim(Math.round((1000 * i) / N)); await sleep(260); await frame(); }
    await hold(5);
    await click('#simClose').catch(() => {});
    await sleep(800);
  });
  await step('f-nc', async () => {
    await workspace('cam');
    await sleep(5000);
    await clickText('#tools button', 'NC-Programm');
    await sleep(3000);
    await hold(2);
    // the post dialog comes first: its main button writes the program and opens it
    await js(`const b=[...document.querySelectorAll('.post-back button')].find(x=>/primary/.test(x.className)); if (b) b.click();`);
    await sleep(6000);
    await hold(3);
    // close whatever is open
    for (let i = 0; i < 4; i++) { await js(`const m=[...document.querySelectorAll('.modal-back')].pop(); if (m) { const x=m.querySelector('.modal-head button') || [...m.querySelectorAll('button')].pop(); x && x.click(); }`); await sleep(500); }
    await js(`document.querySelectorAll('.modal-back').forEach(m => m.remove());`);
    await sleep(500);
  });
  await step('g-turn', async () => {
    await loadExample(true);
    await workspace('cam');
    await sleep(6000);
    await hold(2);
    await orbit(40, 0, 20, frame);
    await clickText('#tools button', 'Simulieren');
    await sleep(2500);
    const N = 60;
    for (let i = 0; i <= N; i++) { await seekSim(Math.round((1000 * i) / N)); await sleep(260); await frame(); }
    await hold(4);
    await click('#simClose').catch(() => {});
    await sleep(800);
  });
  await step('h-render', async () => {
    await loadExample(false);
    await workspace('render');
    await sleep(5000);
    await js(`document.querySelector('#winProps .fw-collapse')?.click();`);
    await sleep(800);
    await hold(2);
    await orbit(60, 0, 30, frame);
    await workspace('design');
    await sleep(1000);
  });
  server.close();
  app.quit();
});
