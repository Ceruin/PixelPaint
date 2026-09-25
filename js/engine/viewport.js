import { makeCanvas, Rect, clamp } from '../core/util.js';
import { bus } from '../core/bus.js';
import { renderDoc } from './compositor.js';

// Screen presentation: doc composite (dirty-rect cached) → transformed blit → overlays.
// The view canvas is a normal double-buffered one (the browser shows each frame whole, so it
// can't flicker), and only the screen region that changed is repainted: a brush stroke costs
// its own area, not the whole screen — which also keeps e-ink panels calm.
export class Viewport {
  constructor(canvas) {
    Object.assign(this, { el: canvas, zoom: 1, rot: 0, x: 0, y: 0, flip: false, wrap: false, dirty: null, raf: 0, dpr: 1, cw: 1, ch: 1 });
    Object.assign(this, { full: true, pending: null, moved: new Set(), boxes: new WeakMap() });
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.overlays = new Set();
    this.previews = new Map();
    const t = makeCanvas(16, 16), tc = t.getContext('2d');
    tc.fillStyle = '#fff'; tc.fillRect(0, 0, 16, 16);
    tc.fillStyle = '#e4e6eb'; tc.fillRect(0, 0, 8, 8); tc.fillRect(8, 8, 8, 8);
    this.checker = this.ctx.createPattern(t, 'repeat');
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    bus.on('dirty', r => this.invalidate(r));
    this.onion = null;
    this.onionCache = new Map();
    ['history', 'frames', 'resize', 'doc', 'layers'].forEach(ev => bus.on(ev, () => this.onionCache.clear()));
    bus.on('resize', () => this.setDoc(this.doc));
  }

  setDoc(doc) {
    this.doc = doc;
    this.comp = makeCanvas(doc.w, doc.h);
    this.previews.clear();
    this.resize();
    this.fit();
    this.invalidate(doc.bounds);
  }

  // Cached until the view changes (every input point maps through the inverse).
  get matrix() { return this.m ??= new DOMMatrix().translate(this.x, this.y).rotate(this.rot).scale(this.zoom * (this.flip ? -1 : 1), this.zoom); }
  get inverse() { return this.inv ??= this.matrix.inverse(); }
  toDoc(sx, sy) { return this.inverse.transformPoint({ x: sx, y: sy }); }
  toScreen(x, y) { return this.matrix.transformPoint({ x, y }); }

  fit() {
    const { doc, cw, ch } = this, pad = cw < 600 ? 16 : 48;
    this.set(Math.min((cw - pad) / doc.w, (ch - pad) / doc.h, 4), 0, cw / 2, ch / 2, { x: doc.w / 2, y: doc.h / 2 });
  }

  // Sets zoom/rotation while keeping doc point under screen point (sx, sy).
  set(zoom, rot, sx = this.cw / 2, sy = this.ch / 2, anchor = this.toDoc(sx, sy)) {
    this.zoom = clamp(zoom, 0.02, 64);
    this.rot = rot;
    const q = new DOMMatrix().rotate(this.rot).scale(this.zoom * (this.flip ? -1 : 1), this.zoom).transformPoint(anchor);
    this.x = sx - q.x; this.y = sy - q.y;
    this.changed();
  }
  // Mirror the view (not the image) around the screen centre — a classic check for drawing errors.
  toggleFlip() { const a = this.toDoc(this.cw / 2, this.ch / 2); this.flip = !this.flip; this.set(this.zoom, this.rot, this.cw / 2, this.ch / 2, a); }
  setWrap(on) { this.wrap = on; this.redraw(); }

  // Tile offsets covering the screen in wrap-around mode.
  tiles() {
    if (!this.wrap) return [[0, 0]];
    const { w, h } = this.doc, inv = this.inverse;
    const pts = [[0, 0], [this.cw, 0], [0, this.ch], [this.cw, this.ch]].map(([x, y]) => inv.transformPoint({ x, y }));
    const xs = pts.map(p => Math.floor(p.x / w)), ys = pts.map(p => Math.floor(p.y / h)), out = [];
    for (let i = Math.max(Math.min(...xs), -4); i <= Math.min(Math.max(...xs), 4); i++)
      for (let j = Math.max(Math.min(...ys), -4); j <= Math.min(Math.max(...ys), 4); j++) out.push([i, j]);
    return out;
  }

  zoomAt(f, sx, sy) { this.set(this.zoom * f, this.rot, sx, sy); }
  pan(dx, dy) { this.x += dx; this.y += dy; this.changed(); }

  changed() { this.m = this.inv = null; bus.emit('view', this); this.redraw(); }
  invalidate(r) {
    if (!this.doc) return;
    r = Rect.clip(r, this.doc.w, this.doc.h);
    this.dirty = Rect.union(this.dirty, r);
    this.pending = Rect.union(this.pending, r);
    this.schedule();
  }
  // Repaints everything (view moved, settings changed…).
  redraw() { this.full = true; this.schedule(); }
  // Repaints only where overlay `o` (one with `bounds(view)`: brush ring, marching ants) was and now is.
  redrawOverlays(o) { if (o?.bounds) this.moved.add(o); else this.full = true; this.schedule(); }
  schedule() { if (!this.raf) this.raf = requestAnimationFrame(() => this.frame()); }

  // Brings the composite up to date now (for sampling it outside a frame).
  compose() {
    if (this.dirty) { renderDoc(this.doc, this.comp.getContext('2d'), this.dirty, this.previews); this.dirty = null; }
  }

  frame() {
    this.raf = 0;
    const { doc, el } = this;
    if (!doc) return;
    this.compose();
    const all = { x: 0, y: 0, w: el.width, h: el.height };
    const r = this.full || this.wrap ? all : Rect.clip(Rect.union(this.toScreenRect(this.pending), this.overlayBox()), el.width, el.height);
    this.full = false; this.pending = null; this.moved.clear();
    if (!r) return;
    const c = this.ctx;
    c.save();
    if (r !== all) { c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip(); }
    this.paint(c, r === all || !this.insideDoc(r));
    c.restore();
  }

  // One frame (the caller clips it to the region being repainted).
  paint(ctx, shadow) {
    const { doc, el, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    const base = new DOMMatrix().scale(dpr).multiply(this.matrix);
    if (shadow && !this.wrap) this.drawShadow(ctx);
    for (const [i, j] of this.tiles()) {
      ctx.setTransform(base.translate(i * doc.w, j * doc.h));
      ctx.fillStyle = this.checker; ctx.fillRect(0, 0, doc.w, doc.h);
      ctx.imageSmoothingEnabled = this.zoom < 2;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.comp, 0, 0);
      this.drawOnion(ctx);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.overlays.forEach(o => o.draw(ctx, this));
  }

  // The page's drop shadow, 9-sliced from one pre-blurred rect (same Gaussian as canvas
  // shadowBlur): a few image copies instead of blurring the whole page every frame.
  drawShadow(ctx) {
    const b = 24 * this.dpr, m = Math.ceil(b * 1.5) + 2, W = this.doc.w * this.zoom * this.dpr, H = this.doc.h * this.zoom * this.dpr;
    if (W < 2 * m || H < 2 * m) {   // tiny page: blur it directly
      ctx.setTransform(new DOMMatrix().scale(this.dpr).multiply(this.matrix));
      Object.assign(ctx, { shadowColor: 'rgba(0,0,0,.35)', shadowBlur: b, fillStyle: '#fff' });
      ctx.fillRect(0, 0, this.doc.w, this.doc.h);
      ctx.shadowColor = 'transparent';
      return;
    }
    if (this.shadowTile?.m !== m) {
      const t = makeCanvas(4 * m, 4 * m), tc = t.getContext('2d');
      Object.assign(tc, { shadowColor: 'rgba(0,0,0,.35)', shadowBlur: b, fillStyle: '#000' });
      tc.shadowOffsetX = 8 * m;   // draw the rect off-canvas so only its shadow lands here
      tc.fillRect(m - 8 * m, m, 2 * m, 2 * m);
      this.shadowTile = Object.assign(t, { m });
    }
    const t = this.shadowTile, o = this.toScreen(0, 0), d = this.dpr;
    ctx.setTransform(new DOMMatrix().translate(o.x * d, o.y * d).rotate(this.rot).scale(this.flip ? -1 : 1, 1));
    ctx.imageSmoothingEnabled = true;
    const M = 2 * m;
    ctx.drawImage(t, 0, 0, M, M, -m, -m, M, M);                       // corners
    ctx.drawImage(t, M, 0, M, M, W - m, -m, M, M);
    ctx.drawImage(t, 0, M, M, M, -m, H - m, M, M);
    ctx.drawImage(t, M, M, M, M, W - m, H - m, M, M);
    ctx.drawImage(t, M - 1, 0, 2, M, m, -m, W - M, M);                // edges
    ctx.drawImage(t, M - 1, M, 2, M, m, H - m, W - M, M);
    ctx.drawImage(t, 0, M - 1, M, 2, -m, m, M, H - M);
    ctx.drawImage(t, M, M - 1, M, 2, W - m, m, M, H - M);
  }

  // Doc rect → device-pixel screen rect (padded for smoothing).
  toScreenRect(r) {
    if (!r) return null;
    const m = new DOMMatrix().scale(this.dpr).multiply(this.matrix);
    return Rect.fromPoints([[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => m.transformPoint({ x, y })), 2);
  }
  // Device-pixel area the moved overlays covered last frame and cover now; remembers where every
  // bounded overlay is drawn, so the next move knows what to wipe.
  overlayBox() {
    let u = null;
    for (const o of this.overlays) {
      if (!o.bounds) continue;
      const r = o.bounds(this), box = r && Rect.fromPoints([{ x: r.x * this.dpr, y: r.y * this.dpr }, { x: (r.x + r.w) * this.dpr, y: (r.y + r.h) * this.dpr }], 2);
      if (this.moved.has(o)) u = Rect.union(u, Rect.union(this.boxes.get(o), box));
      this.boxes.set(o, box);
    }
    return u;
  }
  // True when a device-pixel rect lies wholly on the doc (so its drop shadow can't show there).
  insideDoc(r) {
    const inv = new DOMMatrix().scale(this.dpr).multiply(this.matrix).inverse();
    return [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].every(([x, y]) => {
      const p = inv.transformPoint({ x, y });
      return p.x >= 0 && p.y >= 0 && p.x <= this.doc.w && p.y <= this.doc.h;
    });
  }

  // Onion skin: the active layer's neighbouring cels, tinted red (before) / blue (after).
  drawOnion(ctx) {
    const o = this.onion, d = this.doc, l = d.activeLayer;
    if (!o || !l || d.frames.length < 2) return;
    for (const [dir, n, color] of [[-1, o.prev, '#ff3b47'], [1, o.next, '#3b7bff']]) for (let k = n; k >= 1; k--) {
      const f = d.frame + dir * k, src = l.view(f);
      if (f < 0 || f >= d.frames.length || !src) continue;
      const key = `${l.id}|${f}|${color}`;
      let t = this.onionCache.get(key);
      if (!t) {
        t = makeCanvas(d.w, d.h);
        const tc = t.getContext('2d');
        tc.drawImage(src, 0, 0);
        tc.globalCompositeOperation = 'source-atop'; tc.globalAlpha = 0.55; tc.fillStyle = color; tc.fillRect(0, 0, d.w, d.h);
        this.onionCache.set(key, t);
      }
      ctx.globalAlpha = o.alpha / k;
      ctx.drawImage(t, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  // Strokes a doc-space path with a constant 1-css-px screen width.
  strokeDoc(ctx, path, dash = 0, color = '#fff', under = '#000') {
    ctx.save();
    ctx.setTransform(new DOMMatrix().scale(this.dpr).multiply(this.matrix));
    ctx.lineWidth = 1 / this.zoom;
    ctx.strokeStyle = under; ctx.stroke(path);
    ctx.setLineDash([4 / this.zoom, 4 / this.zoom]);
    ctx.lineDashOffset = dash / this.zoom;
    ctx.strokeStyle = color; ctx.stroke(path);
    ctx.restore();
  }

  resize() {
    const r = this.el.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cx = this.cw / 2, cy = this.ch / 2;
    this.dpr = devicePixelRatio || 1;
    this.el.width = Math.round(r.width * this.dpr);
    this.el.height = Math.round(r.height * this.dpr);
    this.x += r.width / 2 - cx; this.y += r.height / 2 - cy;
    this.cw = r.width; this.ch = r.height;
    this.changed();
  }
}
