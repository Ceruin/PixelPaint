// Variant builder: makes a new character sheet from Pyxl's by rules applied pixel by pixel, pose by
// pose (see docs/PYXL.md). A recipe gets every pose's pixels plus helpers, and changes them in place.
// The result has the same layout, poses and anchors as Pyxl's sheet, so it drops into the app.
import { SPRITES } from '../../js/ui/mascot.js';

export const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

export async function loadSheet(url = '../../assets/pyxl-pixel.webp') {
  const img = new Image(); img.src = url; await img.decode();
  const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  return { canvas: c, ctx: x, data: x.getImageData(0, 0, c.width, c.height) };
}

// One pose as a little pixel grid you can read and paint: get(x, y) → '#rrggbb' | null, set(x, y, '#rrggbb' | null).
export function pose(sheet, name) {
  const [sx, sy, w, h, ax, by] = SPRITES[name], { data } = sheet, W = data.width, d = data.data;
  const at = (x, y) => ((sy + y) * W + sx + x) * 4;
  const inBox = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  return {
    name, w, h, ax, by,
    get(x, y) { if (!inBox(x, y)) return null; const i = at(x, y); return d[i + 3] ? hex(d[i], d[i + 1], d[i + 2]) : null; },
    set(x, y, c) { if (!inBox(x, y)) return; const i = at(x, y); if (!c) { d[i + 3] = 0; return; } const [r, g, b] = rgb(c); d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; },
    each(fn) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(x, y, this.get(x, y)); },
  };
}

// Runs a recipe over every pose and returns the finished canvas.
export function build(sheet, recipe) {
  for (const name of Object.keys(SPRITES)) recipe(pose(sheet, name));
  sheet.ctx.putImageData(sheet.data, 0, 0);
  return sheet.canvas;
}

// Checks a finished sheet against docs/PYXL.md: colour count, semi-transparent pixels, teal-band colours.
export function check(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, colours = new Map();
  let semi = 0;
  for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; if (d[i + 3] < 255) semi++; const k = hex(d[i], d[i + 1], d[i + 2]); colours.set(k, (colours.get(k) ?? 0) + 1); }
  const teal = [...colours.keys()].filter(k => { const [r, g, b] = rgb(k), v = Math.max(r, g, b), dd = v - Math.min(r, g, b); const hh = dd === 0 ? 0 : v === r ? ((g - b) / dd + 6) % 6 * 60 : v === g ? ((b - r) / dd + 2) * 60 : ((r - g) / dd + 4) * 60; return hh > 150 && hh < 205 && dd / v > 0.25 && v / 255 > 0.2; });
  return { size: `${canvas.width}×${canvas.height}`, colours: colours.size, semi, recolours: teal };
}
