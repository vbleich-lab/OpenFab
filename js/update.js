// Updates from the releases on GitHub.
// The installed Windows app and the Linux AppImage load and install a new version themselves (through the
// desktop bridge, electron-updater). Everywhere else – portable Windows folder, macOS, the browser version –
// the program only says that a new version exists and opens the download page.
// The check is the only connection the program makes to the net by itself; it can be switched off in the
// preferences ("Nach Updates suchen").
import { getSettings } from './settings.js';

export const RELEASES_API = 'https://api.github.com/repos/vbleich-lab/WerkFab/releases?per_page=15';
export const RELEASES_PAGE = 'https://github.com/vbleich-lab/WerkFab/releases';

// "1.0.0-rc.4" → comparable parts; a version without a pre-release part is newer than one with it
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || '').trim());
  if (!m) return null;
  return { n: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.').map(x => (/^\d+$/.test(x) ? +x : x)) : null };
}
export function compareVersions(a, b) {
  const A = parseVersion(a), B = parseVersion(b);
  if (!A || !B) return 0;
  for (let i = 0; i < 3; i++) if (A.n[i] !== B.n[i]) return A.n[i] < B.n[i] ? -1 : 1;
  if (!A.pre && !B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    const x = A.pre[i], y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
// the newest published release for someone on `current`: pre-releases only count for users of a pre-release
export function newestRelease(releases, current) {
  const pre = !!parseVersion(current)?.pre;
  let best = null;
  for (const r of releases || []) {
    if (!r || r.draft || !parseVersion(r.tag_name) || (r.prerelease && !pre)) continue;
    if (!best || compareVersions(r.tag_name, best.tag_name) > 0) best = r;
  }
  return best && compareVersions(best.tag_name, current) > 0 ? { version: best.tag_name.replace(/^v/, ''), url: best.html_url || RELEASES_PAGE } : null;
}

// ---------- the note at the lower right ----------
let box = null;
function note(text, buttons = []) {
  if (!box) { box = document.createElement('div'); box.id = 'updateNote'; document.body.appendChild(box); }
  box.replaceChildren();
  const p = document.createElement('p');
  p.textContent = text;
  box.appendChild(p);
  const row = document.createElement('div');
  row.className = 'btns';
  for (const [label, fn, cls] of buttons) {
    const b = document.createElement('button');
    b.className = 'btn ' + (cls || '');
    b.textContent = label;
    b.onclick = fn;
    row.appendChild(b);
  }
  if (buttons.length) box.appendChild(row);
  box.hidden = false;
}
const hide = () => { if (box) box.hidden = true; };

async function ownVersion() {
  for (const f of ['version.json', 'package.json']) {
    try { const r = await fetch(f, { cache: 'no-store' }); if (r.ok) { const v = (await r.json()).version; if (v) return String(v).split('-20')[0]; } } catch { /* next */ }
  }
  return null;
}

let wired = false, manual = false, status = () => {};

function onState(s) {
  if (s.state === 'available') {
    note(`Version ${s.version} ist verfügbar.`, [
      ['Jetzt laden', () => { note('Update wird geladen …'); window.werkfabApp.download(); }, 'primary'],
      ['Später', hide],
    ]);
  } else if (s.state === 'progress') note(`Update wird geladen … ${s.percent} %`);
  else if (s.state === 'ready') {
    note(`Update ${s.version} ist geladen.`, [
      ['Neu starten und installieren', () => window.werkfabApp.install(), 'primary'],
      ['Beim Beenden installieren', hide],
    ]);
  } else if (s.state === 'none') { if (manual) status('WerkFab ist aktuell.'); }
  else if (s.state === 'error') { if (manual) status(`Update-Prüfung fehlgeschlagen: ${s.message}`); hide(); }
}

/** Looks for a new version now. `byHand`: also say so when there is none or the check fails. */
export async function checkForUpdates(byHand = false) {
  manual = byHand;
  const app = window.werkfabApp;
  let info = null;
  try { info = app ? await app.info() : null; } catch { /* old shell */ }
  if (info?.auto) {
    if (!wired) { wired = true; app.onState(onState); }
    app.check();
    return;
  }
  try {
    const current = info?.version || (await ownVersion());
    if (!current) throw new Error('Version unbekannt');
    const r = await fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('GitHub ' + r.status);
    const neu = newestRelease(await r.json(), current);
    if (neu) {
      note(`Version ${neu.version} ist verfügbar (installiert: ${current}).`, [
        ['Download-Seite öffnen', () => { window.open(neu.url, '_blank', 'noopener'); hide(); }, 'primary'],
        ['Später', hide],
      ]);
    } else if (byHand) status(`WerkFab ist aktuell (Version ${current}).`);
  } catch (e) {
    if (byHand) status(`Update-Prüfung fehlgeschlagen: ${e.message || e}`);
  }
}

/** Called once after the start: checks a little later, unless switched off or running as the online demo. */
export function initUpdates(statusFn) {
  status = statusFn || status;
  if (getSettings().updateCheck === false) return;
  if (/\.github\.io$/i.test(location.hostname)) return; // the online demo is always the current version
  setTimeout(() => checkForUpdates(false), 8000);
}
