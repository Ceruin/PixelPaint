import { makeCanvas, TAU } from '../core/util.js';

// Brush tips are white alpha masks, generated per (tip, hardness, resolution) and cached.
export const TIPS = [['round', 'Round'], ['pencil', 'Pencil grain'], ['chalk', 'Chalk'], ['bristle', 'Bristle'], ['splatter', 'Splatter'], ['square', 'Square']];

const custom = new Map();
const cache = new Map();

const seeded = s => () => ((s = Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
const dot = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); };

const GEN = {
  round(c, n, hard) {
    const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, '#fff'); g.addColorStop(Math.min(hard, 0.99), '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, n, n);
  },
  square(c, n) { c.fillRect(n * 0.1, n * 0.1, n * 0.8, n * 0.8); },
  pencil(c, n, hard, rnd) {
    GEN.round(c, n, hard);
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < n * n * 0.35; i++) { c.globalAlpha = rnd() * 0.8; c.fillRect(rnd() * n | 0, rnd() * n | 0, 1, 1); }
  },
  chalk(c, n, hard, rnd) {
    for (let i = 0; i < n * 6; i++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * n * 0.45;
      c.globalAlpha = 0.3 + rnd() * 0.7;
      dot(c, n / 2 + Math.cos(a) * r, n / 2 + Math.sin(a) * r, n * (0.01 + rnd() * 0.03));
    }
  },
  splatter(c, n, hard, rnd) {
    for (let i = 0; i < 14; i++) {
      const a = rnd() * TAU, r = rnd() * n * 0.36;
      dot(c, n / 2 + Math.cos(a) * r, n / 2 + Math.sin(a) * r, n * (0.02 + rnd() * 0.08));
    }
  },
  bristle(c, n, hard, rnd) {
    for (let i = 0; i < 18; i++) {
      c.globalAlpha = 0.5 + rnd() * 0.5;
      dot(c, n * (0.12 + 0.76 * rnd()), n / 2 + (rnd() - 0.5) * n * 0.2, n * (0.025 + 0.03 * rnd()));
    }
  },
};

export function tipMask(id, hardness, res) {
  const key = `${id}|${hardness}|${res}`;
  if (cache.has(key)) return cache.get(key);
  if (cache.size > 64) cache.clear();
  const c = makeCanvas(res, res), ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  if (custom.has(id)) ctx.drawImage(custom.get(id), 0, 0, res, res);
  else (GEN[id] ?? GEN.round)(ctx, res, hardness, seeded(res * 31 + id.length));
  cache.set(key, c);
  return c;
}

export function tint(mask, color) {
  const c = makeCanvas(mask.width, mask.height), ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  return c;
}

// Custom tips: dark = opaque (like a stamp), respecting source alpha.
export function tipFromImage(img, size = 256) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d', { willReadFrequently: true });
  const s = Math.min(size / img.width, size / img.height);
  ctx.drawImage(img, (size - img.width * s) / 2, (size - img.height * s) / 2, img.width * s, img.height * s);
  const d = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < d.data.length; i += 4) {
    const lum = (d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11);
    d.data[i + 3] = (255 - lum) * d.data[i + 3] / 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

export function registerTip(id, canvas) { custom.set(id, canvas); cache.clear(); }
export const customTips = () => [...custom.keys()];
