// Lite physics for Pyxl: grabbed, she hangs from her paintbrush wherever you hold it and swings
// like a pendulum; let go, she drops, bounces and wobbles upright.
// Rotating pixel art normally smears it into mixels, so poses are rotated RotSprite-style: the
// sprite is enlarged 4× with Scale2x (new 1px detail, not blocks), rotated with nearest-neighbour,
// then sampled back at 1× — a turned Pyxl is still clean single-size pixel art.

const caches = new WeakMap();   // sheet → Map of rotated frames
const pixelsOf = new WeakMap();  // sheet → { key: Uint32Array }

function spritePixels(src, [sx, sy, w, h]) {
  let m = pixelsOf.get(src);
  if (!m) pixelsOf.set(src, m = new Map());
  const key = `${sx},${sy}`;
  if (!m.has(key)) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, sx, sy, w, h, 0, 0, w, h);
    m.set(key, new Uint32Array(x.getImageData(0, 0, w, h).data.buffer));
  }
  return m.get(key);
}

function scale2x(p, w, h) {
  const o = new Uint32Array(w * h * 4), W = w * 2, at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : p[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const P = p[y * w + x], A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1), i = y * 2 * W + x * 2;
    o[i] = C === A && C !== D && A !== B ? A : P;
    o[i + 1] = A === B && A !== C && B !== D ? B : P;
    o[i + W] = D === C && D !== B && C !== A ? C : P;
    o[i + W + 1] = B === D && B !== A && D !== C ? D : P;
  }
  return o;
}

// Centre of mass (opaque pixels) of a sprite, in sprite pixels.
const coms = new Map();
export function centreOfMass(src, rect) {
  const key = rect.join();
  if (!coms.has(key)) {
    const p = spritePixels(src, rect), w = rect[2];
    let n = 0, sx = 0, sy = 0;
    p.forEach((v, i) => { if (v >>> 24) { n++; sx += i % w; sy += (i / w) | 0; } });
    coms.set(key, [sx / n, sy / n]);
  }
  return coms.get(key);
}

// The sprite turned `deg` about `pivot` (sprite pixels). `kick` swings the legs 1px (hanging kicks).
// Returns { canvas, ox, oy, r }: the frame is trimmed to the sprite, the pivot sits at pixel
// (ox, oy) of it, and r is the reach from the pivot (the untrimmed frame is 2r+1 square).
const bigs = new Map();
export function rotated(src, rect, pivot, deg, kick = 0) {
  let cache = caches.get(src);
  if (!cache) caches.set(src, cache = new Map());
  deg = ((deg % 360) + 360) % 360;
  const key = `${rect.join()}|${pivot}|${deg}|${kick}`;
  if (cache.has(key)) return cache.get(key);
  const [, , w, h, , by] = rect, [gx, gy] = pivot, bkey = `${rect.join()}|${kick}`;
  let big = bigs.get(bkey);
  if (!big || big.src !== src) {   // the 4× Scale2x source, made once per pose (and outfit)
    let p = spritePixels(src, rect);
    if (kick) {   // legs below the hem shift sideways
      p = p.slice();
      for (let y = Math.max(0, by - 11); y < h; y++) { const row = p.slice(y * w, y * w + w); for (let x = 0; x < w; x++) p[y * w + x] = row[x - kick] ?? 0; }
    }
    bigs.set(bkey, big = { src, px: scale2x(scale2x(p, w, h), w * 2, h * 2) });
  }
  const W4 = w * 4, H4 = h * 4, px = big.px;
  const r = Math.ceil(Math.max(...[[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => Math.hypot(x - gx, y - gy)))) + 1, S = r * 2 + 1;
  const out = new Uint32Array(S * S), a = -deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  let x0 = S, y0 = S, x1 = 0, y1 = 0;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = i - r, dy = j - r, X = Math.floor((gx + 0.5 + dx * cs - dy * sn) * 4), Y = Math.floor((gy + 0.5 + dx * sn + dy * cs) * 4);
    if (X < 0 || Y < 0 || X >= W4 || Y >= H4) continue;
    const v = px[Y * W4 + X];
    if (!(v >>> 24)) continue;
    out[j * S + i] = v;
    if (i < x0) x0 = i; if (i >= x1) x1 = i + 1; if (j < y0) y0 = j; if (j >= y1) y1 = j + 1;
  }
  const c = document.createElement('canvas'), cw = Math.max(1, x1 - x0), ch = Math.max(1, y1 - y0);
  c.width = cw; c.height = ch;
  const img = new ImageData(cw, ch), o = new Uint32Array(img.data.buffer);
  for (let j = 0; j < ch; j++) o.set(out.subarray((y0 + j) * S + x0, (y0 + j) * S + x0 + cw), j * cw);
  c.getContext('2d').putImageData(img, 0, 0);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  const res = { canvas: c, ox: r - x0, oy: r - y0, r };
  cache.set(key, res);
  return res;
}

// A damped pendulum hanging from a moving pivot (px, px/s²): swinging the pointer swings her.
// th > 0 turns her clockwise (her body swings left), as rotated() does. Unbounded: circle the
// pointer and she loops all the way round it.
export class Pendulum {
  th = 0; om = 0;
  step(dt, ax, ay, len) {
    const al = (-(1800 - ay) * Math.sin(this.th) + ax * Math.cos(this.th)) / Math.max(20, len) - 1.3 * this.om;
    this.om = Math.max(-40, Math.min(40, this.om + al * dt)); this.th += this.om * dt;
  }
}

// Landing: she falls the last few pixels, bounces, and wobbles upright on her feet like a weeble.
export class Settle {
  constructor(th, om, y) { Object.assign(this, { th, om, y, vy: 0 }); }
  step(dt) {
    this.om += (-170 * this.th - 7 * this.om) * dt; this.th += this.om * dt;
    this.vy += 1500 * dt; this.y += this.vy * dt;
    if (this.y > 0) { this.y = 0; this.vy = Math.abs(this.vy) > 70 ? -this.vy * 0.35 : 0; }
    return Math.abs(this.th) > 0.012 || Math.abs(this.om) > 0.05 || this.y < 0 || this.vy !== 0;
  }
}
