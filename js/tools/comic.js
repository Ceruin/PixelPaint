import { StateCommand, Compound } from '../engine/commands.js';

// Comic panels (after Krita's comic templates and Clip Studio's frame borders): a "Panels" layer on
// top is the white page gutter; each panel is a window cut into it with a border, so art on the
// layers below only shows inside the panels.
export const LAYOUTS = [
  ['none', 'No panels'], ['grid4', '2 × 2 grid'], ['rows3', 'Three rows'], ['grid6', '2 × 3 grid'],
  ['manga5', 'Manga (5 panels)'], ['splash', 'Splash + strip'], ['koma4', '4-koma strip'],
];
export const PAGES = [
  ['1988x3056', 'Comic page — US (6.6 × 10.2 in @ 300 dpi)'], ['2150x3035', 'Manga page — B5 @ 300 dpi'],
  ['2480x3508', 'Comic page — European A4 @ 300 dpi'], ['900x3200', '4-koma strip'],
];

export const panelBorder = doc => Math.max(3, Math.round(Math.min(doc.w, doc.h) / 300));
const gutter = doc => Math.round(Math.min(doc.w, doc.h) * 0.022);

// Panel rectangles for a layout, inside page margins.
export function layoutRects(doc, kind) {
  const m = Math.round(Math.min(doc.w, doc.h) * 0.06), g = gutter(doc), W = doc.w - 2 * m, H = doc.h - 2 * m;
  const grid = (cols, rows) => { const out = [], cw = (W - g * (cols - 1)) / cols, ch = (H - g * (rows - 1)) / rows; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([m + c * (cw + g), m + r * (ch + g), cw, ch]); return out; };
  switch (kind) {
    case 'grid4': return grid(2, 2);
    case 'grid6': return grid(2, 3);
    case 'rows3': return grid(1, 3);
    case 'koma4': return grid(1, 4);
    case 'splash': { const top = H * 0.62; return [[m, m, W, top], ...grid(3, 1).map(([x, , w]) => [x, m + top + g, w, H - top - g])]; }
    case 'manga5': {
      const r1 = H * 0.3, r2 = H * 0.36, r3 = H - r1 - r2 - 2 * g, y2 = m + r1 + g, y3 = y2 + r2 + g, a = W * 0.58;
      return [[m, m, W, r1], [m, y2, a - g / 2, r2], [m + a + g / 2, y2, W - a - g / 2, r2], [m, y3, W * 0.4 - g / 2, r3], [m + W * 0.4 + g / 2, y3, W * 0.6 - g / 2, r3]];
    }
    default: return [];
  }
}

// The Panels layer (made on top, filled with gutter white, the first time it's needed).
function panelsLayer(doc, cmds) {
  let l = doc.layers.find(x => x.name === 'Panels');
  if (l) return l;
  const before = doc.snapshot();
  l = doc.addLayer('Panels', false);
  const parent = doc.parentOf(l); parent.children.splice(parent.children.indexOf(l), 1); doc.root.children.push(l);   // always on top
  const ctx = l.canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, doc.w, doc.h);
  doc.touch(l);
  cmds.push(new StateCommand('Panels layer', s => doc.restore(s), before, doc.snapshot()));
  return l;
}

// Cuts panel windows (x, y, w, h in doc px) into the Panels layer and draws their borders — one undo step.
export function addPanels(doc, rects, border = panelBorder(doc), color = '#000000') {
  if (!rects.length) return;
  const cmds = [], l = panelsLayer(doc, cmds), keepActive = doc.active;
  const pad = border + 2, box = rects.reduce((u, [x, y, w, h]) => {
    const r = { x: Math.floor(x - pad), y: Math.floor(y - pad), w: Math.ceil(w + 2 * pad), h: Math.ceil(h + 2 * pad) };
    return u ? { x: Math.min(u.x, r.x), y: Math.min(u.y, r.y), w: Math.max(u.x + u.w, r.x + r.w) - Math.min(u.x, r.x), h: Math.max(u.y + u.h, r.y + r.h) - Math.min(u.y, r.y) } : r;
  }, null);
  cmds.push(doc.pixelEdit('Comic Panel', l, box, ctx => {
    for (const [x, y, w, h] of rects) ctx.clearRect(x, y, w, h);
    ctx.strokeStyle = color; ctx.lineWidth = border; ctx.lineJoin = 'miter';
    for (const [x, y, w, h] of rects) ctx.strokeRect(x + border / 2, y + border / 2, w - border, h - border);
  }));
  if (keepActive && keepActive !== l) doc.active = keepActive;   // keep drawing on the art layer
  doc.history.push(new Compound(rects.length > 1 ? 'Comic Panels' : 'Comic Panel', cmds));
  doc.changed?.();
}
