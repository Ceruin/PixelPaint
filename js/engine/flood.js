import { makeCanvas } from '../core/util.js';

// Channel c of pixel byte-offset k as it looks over white paper.
const seen = (data, k, c) => data[k + c] * data[k + 3] / 255 + 255 - data[k + 3];

// Scanline flood fill → Uint8 mask. Tolerance is 0..100 (% per channel). Colours are compared as
// they look on white paper (so soft, half-transparent paint of the same colour doesn't wall the
// fill off), with a smaller say for transparency itself. Tolerance 0 matches exact pixels (pixel art).
// closeGaps: pixels touching a wall count as wall while flooding, so a line with a 1-2px break
// still holds the fill in; the fill then grows back one pixel to meet the line again.
export function floodMask({ data, width: w, height: h }, sx, sy, tolerance, contiguous = true, closeGaps = false) {
  const t = tolerance * 2.55, k0 = (sy * w + sx) * 4;
  const [r0, g0, b0, a0] = [seen(data, k0, 0), seen(data, k0, 1), seen(data, k0, 2), data[k0 + 3]];
  const exact = data[k0] | (data[k0 + 1] << 8) | (data[k0 + 2] << 16), ea = data[k0 + 3];
  const match = !t
    ? i => { const k = i * 4; return data[k + 3] === ea && (ea === 0 || (data[k] | (data[k + 1] << 8) | (data[k + 2] << 16)) === exact); }
    : i => { const k = i * 4; return Math.abs(seen(data, k, 0) - r0) <= t && Math.abs(seen(data, k, 1) - g0) <= t && Math.abs(seen(data, k, 2) - b0) <= t && Math.abs(data[k + 3] - a0) * 0.35 <= t; };
  if (!contiguous) {
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) if (match(i)) out[i] = 1;
    return out;
  }
  if (closeGaps) {
    const wall = new Uint8Array(w * h);
    for (let i = 0; i < wall.length; i++) wall[i] = match(i) ? 0 : 1;
    const open = new Uint8Array(w * h);
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      if (wall[i]) continue;
      let clear = 1;
      for (let dy = -1; dy <= 1 && clear; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X >= 0 && Y >= 0 && X < w && Y < h && wall[Y * w + X]) { clear = 0; break; }
      }
      open[i] = clear;
    }
    // a seed in a sliver too thin to survive the closing fills the normal way
    if (open[sy * w + sx]) {
      const m = scan(w, h, sx, sy, i => open[i] === 1), out = m.slice();
      for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++)
        if (!m[i] && !wall[i] && ((x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w]))) out[i] = 1;
      return out;
    }
  }
  return scan(w, h, sx, sy, match);
}

function scan(w, h, sx, sy, ok) {
  const out = new Uint8Array(w * h), stack = [sy * w + sx];
  while (stack.length) {
    let i = stack.pop();
    const y = (i / w) | 0;
    let x = i - y * w;
    while (x > 0 && !out[i - 1] && ok(i - 1)) { x--; i--; }
    let up = false, dn = false;
    for (; x < w && !out[i] && ok(i); x++, i++) {
      out[i] = 1;
      if (y > 0) { const u = i - w; if (!out[u] && ok(u)) { if (!up) { stack.push(u); up = true; } } else up = false; }
      if (y < h - 1) { const d = i + w; if (!out[d] && ok(d)) { if (!dn) { stack.push(d); dn = true; } } else dn = false; }
    }
  }
  return out;
}

// The pixels past a fill's edge that belong to the soft rim of the line art around it: without
// them a pale halo is left between fill and line. The ring only climbs - each step must look more
// like the line than the one before - so it stops at the line's core and never pokes out the far
// side. It is painted underneath existing paint (`under` = the target layer's pixels), which is safe
// all the way to the core; on pixels the layer hasn't painted it stops at half strength, so a fill
// on a layer of its own doesn't cover the line.
export function edgeRing(m, { data, width: w, height: h }, seed, under, rings = 8) {
  const k0 = seed * 4, c0 = [seen(data, k0, 0), seen(data, k0, 1), seen(data, k0, 2)];
  const d = i => { const k = i * 4; return Math.max(Math.abs(seen(data, k, 0) - c0[0]), Math.abs(seen(data, k, 1) - c0[1]), Math.abs(seen(data, k, 2) - c0[2])); };
  const ring = new Uint8Array(w * h);
  let front = [];
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++)
    if (m[i] && ((x > 0 && !m[i - 1]) || (x < w - 1 && !m[i + 1]) || (y > 0 && !m[i - w]) || (y < h - 1 && !m[i + w]))) front.push(i);
  for (let n = 0; n < rings && front.length; n++) {
    const next = [];
    for (const i of front) {
      const di = d(i), x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= ring.length || m[j] || ring[j]) continue;
        const dj = d(j);
        if (dj <= di || (dj > 128 && !(under && under[j * 4 + 3]))) continue;
        ring[j] = 1; next.push(j);
      }
    }
    front = next;
  }
  return ring;
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
