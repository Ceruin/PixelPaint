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
// `ready`: work to finish behind the splash first (given up on after 6 s).
export async function hideSplash(ready) {
  const el = splash();
  if (!el) return;
  await Promise.race([ready, new Promise(r => setTimeout(r, 6000))]);
  let updated = false;
  try { updated = !!sessionStorage.getItem('pp.updated'); sessionStorage.removeItem('pp.updated'); } catch (e) {}
  const wait = Math.max(0, MIN_SHOWN - performance.now());
  setTimeout(() => {
    el.querySelector('.sp-msg').textContent = updated ? 'All set — enjoy the new version!' : 'Ready!';
    fillTo(1, 0.45);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.hidden = true; }, 500); }, updated ? 1300 : 650);
  }, wait);
}

// Takes the bar over from its running fill animation (keeping where it is) and eases it to `f`.
// It only ever moves forward.
function fillTo(f, secs = 0.3) {
  const fill = splash()?.querySelector('.sp-bar i');
  if (!fill) return;
  const now = new DOMMatrix(getComputedStyle(fill).transform).a || 0;
  fill.style.animation = 'none';
  fill.style.transition = 'none';
  fill.style.transform = `scaleX(${now})`;
  fill.getBoundingClientRect();
  fill.style.transition = `transform ${secs}s ease-out`;
  fill.style.transform = `scaleX(${Math.max(now, f)})`;
}

function showSplash(msg) {
  const el = splash();
  el.hidden = false;
  el.style.transition = 'none';          // cover the whole app at once, no fade-in
  el.classList.remove('out');
  const fill = el.querySelector('.sp-bar i');
  Object.assign(fill.style, { animation: 'none', transition: 'none', transform: 'scaleX(0)' });
  el.querySelector('.sp-msg').textContent = msg;
  return {
    progress: f => fillTo(0.08 + f * 0.62),
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
  try { sessionStorage.setItem('pp.updated', '0.72'); } catch (e) {}   // the next page's bar picks up here
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

// mode 'quiet': a banner if newer; 'prompt': ask right away if newer (on opening / returning to
// the app), silent otherwise; default (Help → Check for Updates): tells you either way.
let asking = false;
export async function checkForUpdates(mode) {
  const v = await latest().catch(() => null);
  if (v && v !== VERSION) {
    if (mode === 'quiet') return offer(v);
    if (asking) return;
    asking = true;
    const ok = await modal('Update available', h('p', {}, `PixelPaint ${v} is ready (you have ${VERSION}). Your work is saved first — update now?`), [['Later', null], ['Update now', 'ok', true]]);
    asking = false;
    return ok ? reloadFresh() : offer(v);
  }
  if (!mode) toast(v ? `You're up to date (${VERSION})` : 'Couldn’t reach the server — try again when online');
}

// `save` runs before any update reload so no brush stroke is lost. Checks on opening (once the
// splash is gone), whenever you come back to the app after a while, and every half hour.
export function watchForUpdates(save) {
  beforeReload = save;
  registerSW();
  setTimeout(() => checkForUpdates('prompt'), 2600);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (Date.now() - hiddenAt > 10 * 60e3) checkForUpdates('prompt');
  });
  setInterval(() => !document.hidden && checkForUpdates('quiet'), 30 * 60000);
}
