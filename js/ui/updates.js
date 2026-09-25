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

export async function reloadFresh() {
  await Promise.resolve(beforeReload()).catch(() => {});
  await caches?.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).catch(() => {});
  await navigator.serviceWorker?.getRegistration().then(r => r?.update()).catch(() => {});
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
