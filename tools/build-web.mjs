// Builds the browser version of OpenFab into dist/OpenFab-Browser:
// the app files, a service worker for offline use (installable web app),
// and a start script with a small PowerShell web server (no Python or Node needed).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'OpenFab-Browser');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const COPY = ['index.html', 'manifest.webmanifest', 'css', 'js', 'vendor', 'icons', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
// large and only needed for IGES: cached when first used instead of on install
const LAZY = ['vendor/opencascade-full/'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const item of COPY) fs.cpSync(path.join(ROOT, item), path.join(OUT, item), { recursive: true });

function walk(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const rel = base ? `${base}/${d.name}` : d.name;
    return d.isDirectory() ? walk(path.join(dir, d.name), rel) : [rel];
  });
}
const files = walk(OUT).filter(f => !LAZY.some(l => f.startsWith(l)) && !['LICENSE', 'THIRD_PARTY_NOTICES.md'].includes(f));
const version = `${pkg.version}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`;

fs.writeFileSync(path.join(OUT, 'sw.js'), `// OpenFab service worker: keeps the app available offline.
const CACHE = 'openfab-${version}';
const CORE = ${JSON.stringify(['./', ...files.map(f => './' + f)], null, 0)};

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('openfab-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// cache first; files that are not cached yet (e.g. the IGES converter) are stored on first use
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
`);

fs.writeFileSync(path.join(OUT, 'serve.ps1'), `# Small local web server for OpenFab (Windows PowerShell, no installation needed).
# Serves this folder on http://localhost and opens the default browser.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'
  '.wasm' = 'application/wasm'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
  '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.ttf' = 'font/ttf'; '.txt' = 'text/plain; charset=utf-8'
}
$listener = $null
foreach ($port in 8765..8785) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$port/")
    $l.Start()
    $listener = $l
    break
  } catch { }
}
if (-not $listener) { Write-Host 'Kein freier Port zwischen 8765 und 8785 gefunden.'; Read-Host 'Enter zum Beenden'; exit 1 }
$url = $listener.Prefixes | Select-Object -First 1
Write-Host ''
Write-Host "  OpenFab laeuft auf $url"
Write-Host '  Dieses Fenster offen lassen, solange du OpenFab benutzt. Schliessen beendet den Server.'
Write-Host ''
Start-Process $url
$rootFull = [System.IO.Path]::GetFullPath($root)
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $file = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))
    if (-not $file.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
      $res.StatusCode = 404
    } else {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $res.AddHeader('Cache-Control', 'no-cache')
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $res.ContentLength64 = $bytes.Length
      if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    }
  } catch { try { $res.StatusCode = 500 } catch { } }
  finally { try { $res.Close() } catch { } }
}
`);

fs.writeFileSync(path.join(OUT, 'OpenFab starten.bat'), `@echo off\r
rem Startet OpenFab im Browser (lokaler Webserver ueber PowerShell).\r
cd /d "%~dp0"\r
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"\r
`);

fs.writeFileSync(path.join(OUT, 'LIESMICH.txt'), `OpenFab CAD/CAM - Browser-Version ${pkg.version}\r
\r
Starten auf diesem PC\r
  Doppelklick auf "OpenFab starten.bat". Der Browser oeffnet sich mit OpenFab.\r
  Das schwarze Fenster offen lassen, solange du arbeitest.\r
\r
Als App installieren (Chrome / Edge)\r
  Nach dem Start in der Adressleiste auf das Installieren-Symbol klicken\r
  (oder Menue > "App installieren"). Danach startet OpenFab wie ein Programm\r
  und funktioniert auch ohne Internet.\r
\r
Auf einen Webserver hochladen\r
  Den ganzen Ordner (ohne die .bat/.ps1-Dateien) auf einen beliebigen Webspace\r
  kopieren, z. B. GitHub Pages oder Netlify. Wichtig: per https ausliefern,\r
  sonst funktioniert der Offline-Modus nicht.\r
\r
Hinweis\r
  Direkt per Doppelklick auf index.html geht es nicht: Browser erlauben\r
  Module und WebAssembly nur ueber einen Webserver.\r
  Projekte werden im Browser gespeichert. Zum Weitergeben: Datei > Speichern (.ofab).\r
`);

const size = files.reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`Browser-Version: ${OUT}`);
console.log(`${files.length} Dateien im Offline-Cache (${(size / 1e6).toFixed(1)} MB), Version ${version}`);
