import { acquire, release } from './compositor.js';
import { makeCanvas, TAU } from '../core/util.js';

// Filters are CSS filter chains run on the GPU through ctx.filter.
export const FILTERS = {
  blur: { label: 'Gaussian Blur', local: false, params: [['radius', 'Radius', 0, 100, 4]], css: p => `blur(${p.radius}px)` },
  hsl: {
    label: 'Hue / Saturation',
    params: [['hue', 'Hue', -180, 180, 0], ['sat', 'Saturation', 0, 300, 100], ['light', 'Lightness', 0, 200, 100]],
    css: p => `hue-rotate(${p.hue}deg) saturate(${p.sat}%) brightness(${p.light}%)`,
  },
  bc: { label: 'Brightness / Contrast', params: [['b', 'Brightness', 0, 200, 100], ['c', 'Contrast', 0, 300, 100]], css: p => `brightness(${p.b}%) contrast(${p.c}%)` },
  invert: { label: 'Invert', params: [], css: () => 'invert(1)' },
  desaturate: { label: 'Desaturate', params: [], css: () => 'grayscale(1)' },
  outline: {
    label: 'Outline', local: false, color: true, params: [['width', 'Width', 1, 40, 3]],
    // Stamps a colour-filled copy of the layer in rings around itself, then the layer on top.
    render(src, t, p) {
      const tc = t.getContext('2d'), tint = makeCanvas(src.width, src.height), k = tint.getContext('2d');
      k.drawImage(src, 0, 0); k.globalCompositeOperation = 'source-in'; k.fillStyle = p.color; k.fillRect(0, 0, tint.width, tint.height);
      for (let r = 1; r <= p.width; r++) for (let i = 0, n = Math.max(8, Math.round(r * 5)); i < n; i++) tc.drawImage(tint, Math.cos(i / n * TAU) * r, Math.sin(i / n * TAU) * r);
      tc.drawImage(src, 0, 0);
    },
  },
};

// Writes the filtered layer into `dst` (doc-sized), limited to the selection mask when given.
// Filters usable as filter layers: per-pixel only (no neighbourhood), so dirty rects stay exact.
export const LAYER_FILTERS = Object.keys(FILTERS).filter(k => FILTERS[k].local !== false);

export function renderFilter(src, dst, f, vals, mask) {
  const { width: w, height: h } = src, d = dst.getContext('2d');
  const t = acquire(w, h), tc = t.getContext('2d');
  tc.clearRect(0, 0, w, h);
  if (f.render) f.render(src, t, vals);
  else { tc.filter = f.css(vals); tc.drawImage(src, 0, 0); tc.filter = 'none'; }
  d.clearRect(0, 0, w, h);
  d.drawImage(src, 0, 0);
  if (mask) {
    tc.globalCompositeOperation = 'destination-in'; tc.drawImage(mask, 0, 0); tc.globalCompositeOperation = 'source-over';
    d.globalCompositeOperation = 'destination-out'; d.drawImage(mask, 0, 0);
  } else d.clearRect(0, 0, w, h);
  d.globalCompositeOperation = 'source-over';
  d.drawImage(t, 0, 0);
  release(t);
}
