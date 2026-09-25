import { acquire, release } from './compositor.js';

// Filters are CSS filter chains run on the GPU through ctx.filter.
export const FILTERS = {
  blur: { label: 'Gaussian Blur', params: [['radius', 'Radius', 0, 100, 4]], css: p => `blur(${p.radius}px)` },
  hsl: {
    label: 'Hue / Saturation',
    params: [['hue', 'Hue', -180, 180, 0], ['sat', 'Saturation', 0, 300, 100], ['light', 'Lightness', 0, 200, 100]],
    css: p => `hue-rotate(${p.hue}deg) saturate(${p.sat}%) brightness(${p.light}%)`,
  },
  bc: { label: 'Brightness / Contrast', params: [['b', 'Brightness', 0, 200, 100], ['c', 'Contrast', 0, 300, 100]], css: p => `brightness(${p.b}%) contrast(${p.c}%)` },
  invert: { label: 'Invert', params: [], css: () => 'invert(1)' },
  desaturate: { label: 'Desaturate', params: [], css: () => 'grayscale(1)' },
};

// Writes the filtered layer into `dst` (doc-sized), limited to the selection mask when given.
export function renderFilter(src, dst, css, mask) {
  const { width: w, height: h } = src, d = dst.getContext('2d');
  const t = acquire(w, h), tc = t.getContext('2d');
  tc.clearRect(0, 0, w, h);
  tc.filter = css; tc.drawImage(src, 0, 0); tc.filter = 'none';
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
