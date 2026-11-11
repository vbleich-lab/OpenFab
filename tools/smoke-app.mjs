// Starts a packaged desktop app and checks that the program really comes up: page loaded, toolbar built,
// 3D view there, no script error. Used after packaging (release workflow) on Windows, Linux and macOS.
// Run: node tools/smoke-app.mjs <path to the executable>
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = process.argv[2];
if (!exe) { console.error('Aufruf: node tools/smoke-app.mjs <Programmdatei>'); process.exit(2); }
const port = 9300 + Math.floor(Math.random() * 500);
const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'werkfab-smoke-'))}`];
if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu');
const child = spawn(exe, args, { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = { exe, started: false };
let ok = false;
try {
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (!target) throw new Error('Das Programm hat kein Fenster geöffnet');
  out.started = true;
  out.url = target.url;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('keine Verbindung zur Seite')); });
  let seq = 0;
  const errors = [];
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0] || m.params.exceptionDetails?.text);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  const call = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  await call('Runtime.enable');
  const expr = `JSON.stringify({ title: document.title, buttons: document.querySelectorAll('.tbtn').length, canvas: !!document.querySelector('#viewport canvas'), bridge: typeof window.werkfabApp, info: window.werkfabApp ? await window.werkfabApp.info() : null })`;
  // wait until the toolbar is there (the geometry kernel loads for a few seconds on a slow machine)
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    const r = await call('Runtime.evaluate', { expression: `(async () => ${expr})()`, awaitPromise: true, returnByValue: true });
    out.page = JSON.parse(r?.result?.value || '{}');
    if (out.page.buttons > 10 && out.page.canvas) break;
  }
  out.errors = errors;
  ok = out.page.buttons > 10 && out.page.canvas && out.page.bridge === 'object' && !errors.length;
  ws.close();
} catch (e) { out.error = String(e.message || e); }
child.kill();
console.log((ok ? 'OK   ' : 'FEHL ') + 'Programm startet und zeigt die Oberfläche  ' + JSON.stringify(out));
process.exit(ok ? 0 : 1);
