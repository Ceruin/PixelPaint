import { makeCanvas } from '../core/util.js';

// Scanline flood fill → Uint8 mask. Tolerance is 0..100 (% per channel). Colours are compared as
// they look on white paper (so soft, half-transparent paint of the same colour doesn't wall the
// fill off), with a smaller say for transparency itself. Tolerance 0 matches exact pixels (pixel art).
export function floodMask({ data, width: w, height: h }, sx, sy, tolerance, contiguous = true) {
  const out = new Uint8Array(w * h), t = tolerance * 2.55, k0 = (sy * w + sx) * 4;
  const seen = (k, c) => data[k + c] * data[k + 3] / 255 + 255 - data[k + 3];   // channel c over white
  const [r0, g0, b0, a0] = [seen(k0, 0), seen(k0, 1), seen(k0, 2), data[k0 + 3]];
  const exact = data[k0] | (data[k0 + 1] << 8) | (data[k0 + 2] << 16), ea = data[k0 + 3];
  const match = !t
    ? i => { const k = i * 4; return data[k + 3] === ea && (ea === 0 || (data[k] | (data[k + 1] << 8) | (data[k + 2] << 16)) === exact); }
    : i => { const k = i * 4; return Math.abs(seen(k, 0) - r0) <= t && Math.abs(seen(k, 1) - g0) <= t && Math.abs(seen(k, 2) - b0) <= t && Math.abs(data[k + 3] - a0) * 0.35 <= t; };
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

// Grows the mask by two pixels so fills tuck under anti-aliased line art — but only into soft edge
// pixels (closer to the filled colour than to the line). A hard line is never painted over.
export function dilate(m, w, h, img, seed, rings = 2) {
  const d = img?.data, k0 = seed * 4, lim = 0.5 * 255;
  const soft = i => {
    if (!d) return true;
    const k = i * 4;
    return Math.max(Math.abs(d[k] - d[k0]), Math.abs(d[k + 1] - d[k0 + 1]), Math.abs(d[k + 2] - d[k0 + 2]), Math.abs(d[k + 3] - d[k0 + 3])) <= lim;
  };
  for (let n = 0; n < rings; n++) {
    const o = m.slice();
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++)
      if (!m[i] && ((x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w])) && soft(i)) o[i] = 1;
    m = o;
  }
  return m;
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
