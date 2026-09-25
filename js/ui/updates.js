import { h, icon } from './dom.js';
import { VERSION } from '../version.js';
import { modal, toast } from './dialogs.js';

// Installed-app updates: registers the service worker, compares our VERSION with the live one,
// and offers a one-click reload (clearing cached files) when a newer version is out.
export const registerSW = () => navigator.serviceWorker?.register('sw.js').catch(() => {});

async function latest() {
  const src = await fetch(`js/version.js?${Date.now()}`, { cache: 'no-store' }).then(r => r.text());
  return src.match(/VERSION = '([^']+)'/)?.[1];
}

let beforeReload = () => {};

// The splash (inline in index.html): hidden once the app has booted, shown again while updating.
const splash = () => document.getElementById('splash');
// The splash is always up while the app starts. Once it's ready the splash finishes: the bar
// fills, a last word, a short beat (never less than a moment on screen) — then it fades.
const MIN_SHOWN = 1200;
export function hideSplash() {
  const el = splash();
  if (!el) return;
  let updated = false;
  try { updated = !!sessionStorage.getItem('pp.updated'); sessionStorage.removeItem('pp.updated'); } catch (e) {}
  el.querySelector('.sp-bar').classList.add('done');
  el.querySelector('.sp-msg').textContent = updated ? 'All set — enjoy the new version!' : 'Ready!';
  const wait = Math.max(0, MIN_SHOWN - performance.now()) + (updated ? 1300 : 500);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.hidden = true; }, 500); }, wait);
}
function showSplash(msg) {
  const el = splash();
  el.hidden = false;
  el.style.transition = 'none';          // cover the whole app at once, no fade-in
  el.classList.remove('out');
  const bar = el.querySelector('.sp-bar'), fill = bar.firstElementChild;
  el.querySelector('.sp-msg').textContent = msg;
  return {
    progress: f => { bar.classList.add('done'); fill.style.transform = `scaleX(${f})`; },
    say: m => { el.querySelector('.sp-msg').textContent = m; },
  };
}

// Updating: Pyxl's splash covers the app while your work is saved and every file the app uses is
// fetched fresh in the background (the service worker keeps the new copies); then one reload,
// served from that warm cache.
export async function reloadFresh() {
  const sp = showSplash('Saving your work…');
  await Promise.resolve(beforeReload()).catch(() => {});
  sp.say('Downloading the new version…');
  const here = location.href.split('#')[0].split('?')[0];
  const urls = [...new Set([here, ...performance.getEntriesByType('resource').map(e => e.name.split('#')[0])])]
    .filter(u => new URL(u).origin === location.origin && !u.includes('version.js?'));
  let done = 0;
  await Promise.all(urls.map(u => fetch(u, { cache: 'reload' }).catch(() => {}).finally(() => sp.progress(++done / urls.length))));
  await navigator.serviceWorker?.getRegistration().then(r => r?.update()).catch(() => {});
  sp.say('Starting…');
  try { sessionStorage.setItem('pp.updated', '1'); } catch (e) {}
  location.reload();
}

let banner = null;
const offer = v => {
  if (banner) return;
  banner = h('div.update-bar', {}, icon('sparkle'), h('span', {}, `PixelPaint ${v} is available.`),
    h('button.btn.sm.primary', { type: 'button', onclick: reloadFresh }, 'Update now'),
    h('button.ibtn.sm', { type: 'button', 'aria-label': 'Later', onclick: () => { banner.remove(); banner = null; } }, icon('x')));
  document.body.append(banner);
};

// quiet: background check (banner only if newer); otherwise tells you either way.
export async function checkForUpdates(quiet = false) {
  const v = await latest().catch(() => null);
  if (v && v !== VERSION) return quiet ? offer(v) : (await modal('Update available', h('p', {}, `Version ${v} is out (you have ${VERSION}). Your work is autosaved — update now?`), [['Later', null], ['Update', 'ok', true]])) && reloadFresh();
  if (!quiet) toast(v ? `You're up to date (${VERSION})` : 'Couldn’t reach the server — try again when online');
}

// `save` runs before any update reload so no brush stroke is lost.
export function watchForUpdates(save) {
  beforeReload = save;
  registerSW();
  setTimeout(() => checkForUpdates(true), 5000);
  setInterval(() => !document.hidden && checkForUpdates(true), 30 * 60000);
}
