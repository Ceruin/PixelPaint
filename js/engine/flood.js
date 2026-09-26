import { makeCanvas } from '../core/util.js';

// Scanline flood fill → Uint8 mask. Tolerance is 0..100 (% per channel).
export function floodMask({ data, width: w, height: h }, sx, sy, tolerance, contiguous = true) {
  const out = new Uint8Array(w * h), t = tolerance * 2.55, k0 = (sy * w + sx) * 4;
  const [r0, g0, b0, a0] = [data[k0], data[k0 + 1], data[k0 + 2], data[k0 + 3]];
  const match = i => {
    const k = i * 4;
    return Math.abs(data[k] - r0) <= t && Math.abs(data[k + 1] - g0) <= t && Math.abs(data[k + 2] - b0) <= t && Math.abs(data[k + 3] - a0) <= t;
  };
  if (!contiguous) {
    for (let i = 0; i < out.length; i++) if (match(i)) out[i] = 1;
    return out;
  }
  const stack = [sy * w + sx];
  while (stack.length) {
    let i = stack.pop();
    const y = (i / w) | 0;
    let x = i - y * w;
    while (x > 0 && !out[i - 1] && match(i - 1)) { x--; i--; }
    let up = false, dn = false;
    for (; x < w && !out[i] && match(i); x++, i++) {
      out[i] = 1;
      if (y > 0) { const u = i - w; if (!out[u] && match(u)) { if (!up) { stack.push(u); up = true; } } else up = false; }
      if (y < h - 1) { const d = i + w; if (!out[d] && match(d)) { if (!dn) { stack.push(d); dn = true; } } else dn = false; }
    }
  }
  return out;
}

// Grows the mask by one pixel so fills tuck under anti-aliased line art — but only into soft edge
// pixels (closer to the filled colour than to the line). A hard 1px line is never painted over.
export function dilate(m, w, h, img, seed) {
  const o = m.slice(), d = img?.data, k0 = seed * 4, lim = 0.5 * 255;
  const soft = i => {
    if (!d) return true;
    const k = i * 4;
    return Math.max(Math.abs(d[k] - d[k0]), Math.abs(d[k + 1] - d[k0 + 1]), Math.abs(d[k + 2] - d[k0 + 2]), Math.abs(d[k + 3] - d[k0 + 3])) <= lim;
  };
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++)
    if (!m[i] && ((x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w])) && soft(i)) o[i] = 1;
  return o;
}

// Returns a canvas painted with `rgba` where the mask is set; `.bounds` holds the mask's bbox.
export function maskToCanvas(mask, w, h, rgba = 0xffffffff) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = new Uint32Array(img.data.buffer);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    if (!mask[i]) continue;
    d[i] = rgba;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y;
  }
  ctx.putImageData(img, 0, 0);
  c.bounds = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  return c;
}
