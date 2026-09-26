import { clamp, makeCanvas, Rect, TAU, DEG } from '../core/util.js';
import { tipMask, tint } from './tips.js';

// Stroke smoothing methods (after Krita): none, basic (weighted average), stabilizer (pulled
// string / dead zone) and dynamic (mass + drag physics).
export const SMOOTHING = [['none', 'None'], ['basic', 'Basic'], ['stabilizer', 'Stabilizer'], ['dynamic', 'Dynamic']];

export const DEFAULT_BRUSH = {
  name: 'Round', cat: 'Paint', tip: 'round', size: 24, minSize: 0.15, opacity: 1, flow: 1, spacing: 0.1,
  hardness: 0.85, roundness: 1, angle: 0, smoothing: 0.3, smoothMode: 'basic', scatter: 0, sizeJitter: 0, angleJitter: 0,
  followDir: false, pressureSize: true, pressureOpacity: false, tilt: true, buildup: false, blend: 'source-over',
};

const HALF_PI = Math.PI / 2;
// sRGB ⇄ linear light, for clean colour mixing
const LIN = Float32Array.from({ length: 256 }, (_, v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const toSRGB = l => { const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); };
const grain = (x, y) => { const s = Math.sin((x | 0) * 12.9898 + (y | 0) * 78.233) * 43758.5453; return s - Math.floor(s); };
const mix = (a, b, t) => ({ ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t });

// Dab-based stroke engine. Input points {x, y, p, alt, az} in doc space; output dabs on `target`.
// Pure rendering: no knowledge of layers, UI or history.
export class BrushEngine {
  constructor(brush, { target, color, symmetry, profile = {}, alphaMul = 1, smudge = false, wrap = null, scale = 1 }) {
    Object.assign(this, { b: brush, ctx: target, sym: symmetry, profile, alphaMul, smudge, wrap, scale, dirty: null });
    this.res = clamp(2 ** Math.ceil(Math.log2(Math.max(1, brush.size * 2))), 16, 512);
    this.mask = tipMask(brush.tip, brush.hardness, this.res);
    this.tip = smudge ? null : tint(this.mask, color);
    this.prev = [];
  }

  sizeAt(p) { const b = this.b; return b.size * (b.pressureSize ? b.minSize + (1 - b.minSize) * p : 1); }
  step(p) { return Math.max(0.5, this.sizeAt(p) * this.b.spacing); }

  begin(p) {
    this.s = { ...p };
    this.last = { ...p };
    this.dir = 0;
    this.dab(p);
    this.next = this.step(p.p);
  }

  get smoothing() { return Math.min(1, this.b.smoothing + (this.profile.smoothing ?? 0)); }
  get mode() { return this.smoothing ? this.b.smoothMode ?? 'basic' : 'none'; }

  // Smoothing, each mode clearly its own (strength 0–100%):
  //  basic      — the line trails behind the pen (a distance-weighted average of the path, up to
  //               ~50 screen px behind), so wobbles melt away whatever rate the pen reports at
  //  stabilizer — a rope up to ~120 screen px: the line only moves once you pull it taut (dead-straight)
  //  dynamic    — the pen tip has weight and drag: swoopy, brush-like curves
  // `step` (basic only) feeds a point as if the pen had moved that far — the stroke's end uses it to
  // let the trailing line glide in to where you lifted the pen.
  move(p, step) {
    const s = this.s, amt = this.smoothing;
    switch (this.mode) {
      case 'none': Object.assign(s, p); break;
      case 'stabilizer': {
        const r = amt * 120 * (this.scale ?? 1), dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy);
        if (d <= r) return;
        const k = 1 - r / d;
        s.x += dx * k; s.y += dy * k; s.p += (p.p - s.p) * k;
        break;
      }
      case 'dynamic': {
        const v = this.v ??= { x: 0, y: 0 }, mass = 1 + amt * 18, drag = 0.55 + amt * 0.38;
        v.x = (v.x + (p.x - s.x) / mass) * drag; v.y = (v.y + (p.y - s.y) / mass) * drag;
        s.x += v.x; s.y += v.y; s.p += (p.p - s.p) * 0.5;
        break;
      }
      default: {   // Gaussian weights by distance along the path, not by point count
        const sig = Math.max(0.3, amt * amt * 50 + amt * 4) * (this.scale ?? 1), q = this.win ??= [], last = q.at(-1);
        const D = last ? last.D + (step ?? Math.hypot(p.x - last.x, p.y - last.y)) : 0;
        q.push({ x: p.x, y: p.y, p: p.p, D });
        while (q.length > 2 && D - q[0].D > 3 * sig) q.shift();
        let W = 0, x = 0, y = 0, pr = 0;
        for (const o of q) { const w = Math.exp(-((D - o.D) ** 2) / (2 * sig * sig)); W += w; x += o.x * w; y += o.y * w; pr += o.p * w; }
        s.x = x / W; s.y = y / W; s.p = pr / W;
        this.sig = sig;
      }
    }
    s.alt = p.alt; s.az = p.az;
    this.line(s);
  }

  end(p) {
    if (!p) return;
    if (this.mode === 'stabilizer' || this.mode === 'none') this.line({ ...this.s, ...p });
    else if (this.mode === 'dynamic') for (let i = 0; i < 16; i++) this.move(p);
    else for (let i = 0; i < 24; i++) this.move(p, (this.sig ?? 1) / 6);   // the trailing line glides in
  }

  line(to) {
    const a = this.last, d = Math.hypot(to.x - a.x, to.y - a.y);
    if (d < 0.01) return;
    this.dir = Math.atan2(to.y - a.y, to.x - a.x);
    let pos = this.next;
    while (pos <= d) { const q = mix(a, to, pos / d); this.dab(q); pos += this.step(q.p); }
    this.next = pos - d;
    this.last = { ...to };
  }

  dab(q) {
    const b = this.b;
    let size = this.sizeAt(q.p), x = q.x, y = q.y, squash = b.roundness;
    let alpha = b.flow * (b.pressureOpacity ? q.p : 1) * this.alphaMul;
    let ang = b.angle * DEG + (b.followDir ? this.dir : 0);
    if (b.sizeJitter) size *= 1 - Math.random() * b.sizeJitter;
    if (b.angleJitter) ang += (Math.random() - 0.5) * TAU * b.angleJitter;
    if (b.scatter) { const r = Math.random() * b.scatter * size, t = Math.random() * TAU; x += Math.cos(t) * r; y += Math.sin(t) * r; }
    if (this.profile.grain) alpha *= 1 - this.profile.grain * grain(x, y);
    if (b.tilt && q.alt != null && q.alt < HALF_PI - 0.1) {
      const t = 1 - q.alt / HALF_PI;
      squash *= 1 - 0.6 * t; size *= 1 + t; ang = q.az;
    }
    this.sym.forEach((f, i) => {
      const [sx, sy, sa, m] = f(x, y, ang);
      this.stamp(i, sx, sy, size, sa, m ? -squash : squash, alpha);
    });
  }

  // Wrap-around mode: dabs land on the tile and repeat across whichever edges they cross.
  stamp(i, x, y, size, ang, squash, alpha) {
    if (!this.wrap) return this.stamp1(i, x, y, size, ang, squash, alpha);
    const { w, h } = this.wrap, r = size * 0.75, bx = ((x % w) + w) % w, by = ((y % h) + h) % h;
    for (const ox of [0, -w, w]) for (const oy of [0, -h, h]) {
      const X = bx + ox, Y = by + oy;
      if (X + r >= 0 && X - r <= w && Y + r >= 0 && Y - r <= h) this.stamp1(i, X, Y, size, ang, squash, alpha);
    }
  }

  stamp1(i, x, y, size, ang, squash, alpha) {
    if (size < 0.3 || alpha <= 0) return;
    const c = this.ctx;
    c.globalAlpha = Math.min(1, alpha);
    if (this.smudge) this.smear(i, x, y, size);
    else {
      const s = size / this.res, cs = Math.cos(ang) * s, sn = Math.sin(ang) * s;
      c.setTransform(cs, sn, -sn * squash, cs * squash, x, y);
      c.drawImage(this.tip, -this.res / 2, -this.res / 2);
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    c.globalAlpha = 1;
    this.dirty = Rect.union(this.dirty, Rect.around(x, y, size * 0.75 + 2));
  }

  // Smudge: pick up pixels at the previous dab and lay them down at this one through the tip.
  // Pulls the paint under the previous dab into this one, mixed in linear light with premultiplied
  // alpha: blends between colours stay clean (no muddy dark band between red and green, as plain
  // sRGB mixing gives).
  smear(i, x, y, size) {
    const n = Math.max(2, Math.ceil(size)), p = this.prev[i] ?? { x, y }, c = this.ctx, W = c.canvas.width, H = c.canvas.height;
    this.prev[i] = { x, y };
    const sx = Math.round(p.x - n / 2), sy = Math.round(p.y - n / 2), dx = Math.round(x - n / 2), dy = Math.round(y - n / 2);
    if (dx >= W || dy >= H || dx + n <= 0 || dy + n <= 0) return;
    if (this.maskN !== n) {   // the tip's coverage at this size, read once
      const m = makeCanvas(n, n), mc = m.getContext('2d', { willReadFrequently: true }); mc.drawImage(this.mask, 0, 0, n, n);
      const md = mc.getImageData(0, 0, n, n).data; this.maskA = new Float32Array(n * n); for (let k = 0; k < n * n; k++) this.maskA[k] = md[k * 4 + 3] / 255;
      this.maskN = n;
    }
    const src = c.getImageData(sx, sy, n, n).data, dst = c.getImageData(dx, dy, n, n), d = dst.data, k0 = Math.min(1, c.globalAlpha), mA = this.maskA;
    for (let k = 0, j = 0; k < n * n; k++, j += 4) {
      const m = mA[k] * k0;
      if (m <= 0.002) continue;
      const sa = src[j + 3] / 255, da = d[j + 3] / 255, oa = da + (sa - da) * m;
      if (oa <= 0.001) { d[j + 3] = 0; continue; }
      for (let ch = 0; ch < 3; ch++) {
        const sl = LIN[src[j + ch]] * sa, dl = LIN[d[j + ch]] * da;
        d[j + ch] = toSRGB((dl + (sl - dl) * m) / oa);
      }
      d[j + 3] = Math.round(oa * 255);
    }
    c.putImageData(dst, dx, dy);
  }

  takeDirty() { const d = this.dirty; this.dirty = null; return d; }
}

// Screentone patterns (dots, lines, cross-hatch) on a grid fixed to the page, so tone stays aligned
// across strokes like a real screentone sheet.
const tones = new Map();
export function tonePattern(ctx, kind, s) {
  const key = `${kind}|${s}`;
  if (!tones.has(key)) {
    const c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d'); x.fillStyle = '#000';
    if (kind === 'dots') { x.beginPath(); x.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2); x.fill(); }
    else {
      x.lineWidth = Math.max(1, s * 0.22); x.strokeStyle = '#000'; x.beginPath();
      for (const o of [-s, 0, s]) { x.moveTo(o, s); x.lineTo(o + s, 0); }
      if (kind === 'cross') for (const o of [-s, 0, s]) { x.moveTo(o, 0); x.lineTo(o + s, s); }
      x.stroke();
    }
    tones.set(key, c);
  }
  return ctx.createPattern(tones.get(key), 'repeat');
}

// Offline stroke render for the brush library thumbnails.
export function strokePreview(brush, canvas, color) {
  const c = canvas.getContext('2d'), { width: w, height: h } = canvas;
  const buf = makeCanvas(w, h), bctx = buf.getContext('2d');
  const smudge = brush.cat === 'Blend';
  if (smudge) {
    ['#e0556a', '#ffd23f', '#3b7bff'].forEach((col, i) => { bctx.fillStyle = col; bctx.fillRect(0, h * (0.2 + i * 0.2), w, h * 0.2); });
  }
  const b = { ...brush, size: Math.min(brush.size, h * 0.45), smoothing: 0, scatter: Math.min(brush.scatter, 1) };
  const e = new BrushEngine(b, { target: bctx, color, symmetry: [(x, y, a) => [x, y, a, false]], alphaMul: b.buildup ? b.opacity : 1, smudge });
  for (let i = 0, N = 48; i <= N; i++) {
    const t = i / N, pt = { x: w * 0.08 + t * w * 0.84, y: h / 2 + Math.sin(t * TAU) * h * 0.2, p: 0.15 + 0.85 * Math.sin(t * Math.PI), alt: HALF_PI };
    i ? e.line(pt) : e.begin(pt);
  }
  if (b.pattern) { bctx.globalCompositeOperation = 'destination-in'; bctx.fillStyle = tonePattern(bctx, b.pattern, b.patternSize ?? 8); bctx.fillRect(0, 0, w, h); bctx.globalCompositeOperation = 'source-over'; }
  c.clearRect(0, 0, w, h);
  c.globalAlpha = b.buildup || smudge ? 1 : b.opacity;
  c.drawImage(buf, 0, 0);
  c.globalAlpha = 1;
}
