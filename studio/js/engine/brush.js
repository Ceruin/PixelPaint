import { clamp, makeCanvas, Rect, TAU, DEG } from '../core/util.js';
import { tipMask, tint } from './tips.js';

export const DEFAULT_BRUSH = {
  name: 'Round', cat: 'Paint', tip: 'round', size: 24, minSize: 0.15, opacity: 1, flow: 1, spacing: 0.1,
  hardness: 0.85, roundness: 1, angle: 0, smoothing: 0.3, scatter: 0, sizeJitter: 0, angleJitter: 0,
  followDir: false, pressureSize: true, pressureOpacity: false, tilt: true, buildup: false, blend: 'source-over',
};

const HALF_PI = Math.PI / 2;
const grain = (x, y) => { const s = Math.sin((x | 0) * 12.9898 + (y | 0) * 78.233) * 43758.5453; return s - Math.floor(s); };
const mix = (a, b, t) => ({ ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t });

// Dab-based stroke engine. Input points {x, y, p, alt, az} in doc space; output dabs on `target`.
// Pure rendering: no knowledge of layers, UI or history.
export class BrushEngine {
  constructor(brush, { target, color, symmetry, profile = {}, alphaMul = 1, smudge = false }) {
    Object.assign(this, { b: brush, ctx: target, sym: symmetry, profile, alphaMul, smudge, dirty: null });
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

  // Exponential stabilizer: higher smoothing = more lag, steadier line.
  move(p) {
    const k = 1 - Math.min(0.94, this.b.smoothing + (this.profile.smoothing ?? 0)), s = this.s;
    s.x += (p.x - s.x) * k; s.y += (p.y - s.y) * k; s.p += (p.p - s.p) * k;
    s.alt = p.alt; s.az = p.az;
    this.line(s);
  }

  end(p) { if (p) for (let i = 0; i < 12; i++) this.move(p); }

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

  stamp(i, x, y, size, ang, squash, alpha) {
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
  smear(i, x, y, size) {
    const n = Math.max(2, Math.ceil(size)), p = this.prev[i] ?? { x, y };
    if (!this.buf || this.buf.width !== n) this.buf = makeCanvas(n, n);
    const bc = this.buf.getContext('2d');
    bc.globalCompositeOperation = 'copy';
    bc.drawImage(this.ctx.canvas, p.x - n / 2, p.y - n / 2, n, n, 0, 0, n, n);
    bc.globalCompositeOperation = 'destination-in';
    bc.drawImage(this.mask, 0, 0, n, n);
    this.ctx.drawImage(this.buf, x - n / 2, y - n / 2);
    this.prev[i] = { x, y };
  }

  takeDirty() { const d = this.dirty; this.dirty = null; return d; }
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
  c.clearRect(0, 0, w, h);
  c.globalAlpha = b.buildup || smudge ? 1 : b.opacity;
  c.drawImage(buf, 0, 0);
  c.globalAlpha = 1;
}
