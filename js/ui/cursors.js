import { ICONS } from './icons.js';

// Canvas cursors drawn from each tool's own icon (the same everywhere, unlike OS cursors).
// Tools with a working tip (brush, pencil, eraser, fill, picker…) put the hotspot on the tip;
// the others get a fine crosshair with their icon beside it. Dark lines on a white halo, so
// the cursor shows on any colour.
const TIP = { brush: [2.2, 20.3], pencil: [4.2, 19.8], eraser: [6.4, 19.6], smudge: [12, 14.5], fill: [20, 19.6], picker: [2.4, 21.6] };
const ICON_OF = { pxshape: 'shape', assist: 'ruler' };
const cache = new Map();
const svg = s => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
const lines = (d, w, c) => `<g fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</g>`;

export function toolCursor(id) {
  if (cache.has(id)) return cache.get(id);
  const paths = ICONS[ICON_OF[id] ?? id] ?? '', tip = TIP[id];
  let body, hx, hy;
  if (tip) {   // the icon itself, its tip on the hotspot
    const g = `<g transform="translate(4 4)">${lines(paths, 4.4, '#fff')}${lines(paths, 1.8, '#1b1d23')}</g>`;
    body = g; [hx, hy] = [Math.round(tip[0] + 4), Math.round(tip[1] + 4)];
  } else {     // a crosshair, with a small copy of the icon at its lower right
    const x = 'M8 1v4.5M8 10.5V15M1 8h4.5M10.5 8H15';
    const ic = `<g transform="translate(14 14) scale(.68)">${lines(paths, 5.5, '#fff')}${lines(paths, 2.4, '#1b1d23')}</g>`;
    body = `${lines(`<path d="${x}"/>`, 3.4, '#fff')}${lines(`<path d="${x}"/>`, 1.3, '#1b1d23')}${ic}`;
    [hx, hy] = [8, 8];
  }
  const cur = `${svg(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`)} ${hx} ${hy}, crosshair`;
  cache.set(id, cur);
  return cur;
}
