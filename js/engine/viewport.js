import { makeCanvas, Rect, clamp } from '../core/util.js';
import { bus } from '../core/bus.js';
import { renderDoc } from './compositor.js';

// Screen presentation: doc composite (dirty-rect cached) → transformed blit → overlays.
// The view canvas uses a desynchronized (low-latency) context to cut pen-to-pixel delay.
export class Viewport {
  constructor(canvas) {
    Object.assign(this, { el: canvas, zoom: 1, rot: 0, x: 0, y: 0, dirty: null, raf: 0, dpr: 1, cw: 1, ch: 1 });
    this.ctx = canvas.getContext('2d', { desynchronized: true });
    this.overlays = new Set();
    this.previews = new Map();
    const t = makeCanvas(16, 16), tc = t.getContext('2d');
    tc.fillStyle = '#fff'; tc.fillRect(0, 0, 16, 16);
    tc.fillStyle = '#e4e6eb'; tc.fillRect(0, 0, 8, 8); tc.fillRect(8, 8, 8, 8);
    this.checker = this.ctx.createPattern(t, 'repeat');
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    bus.on('dirty', r => this.invalidate(r));
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

  get matrix() { return new DOMMatrix().translate(this.x, this.y).rotate(this.rot).scale(this.zoom); }
  toDoc(sx, sy) { return this.matrix.inverse().transformPoint({ x: sx, y: sy }); }
  toScreen(x, y) { return this.matrix.transformPoint({ x, y }); }

  fit() {
    const { doc, cw, ch } = this, pad = cw < 600 ? 16 : 48;
    this.rot = 0;
    this.zoom = Math.min((cw - pad) / doc.w, (ch - pad) / doc.h, 4);
    this.x = (cw - doc.w * this.zoom) / 2;
    this.y = (ch - doc.h * this.zoom) / 2;
    this.changed();
  }

  // Sets zoom/rotation while keeping doc point under screen point (sx, sy).
  set(zoom, rot, sx = this.cw / 2, sy = this.ch / 2, anchor = this.toDoc(sx, sy)) {
    this.zoom = clamp(zoom, 0.02, 64);
    this.rot = rot;
    const q = new DOMMatrix().rotate(this.rot).scale(this.zoom).transformPoint(anchor);
    this.x = sx - q.x; this.y = sy - q.y;
    this.changed();
  }
  zoomAt(f, sx, sy) { this.set(this.zoom * f, this.rot, sx, sy); }
  pan(dx, dy) { this.x += dx; this.y += dy; this.changed(); }

  changed() { bus.emit('view', this); this.redraw(); }
  invalidate(r) {
    if (!this.doc) return;
    this.dirty = Rect.union(this.dirty, Rect.clip(r, this.doc.w, this.doc.h));
    this.redraw();
  }
  redraw() { if (!this.raf) this.raf = requestAnimationFrame(() => this.frame()); }

  // Brings the composite up to date now (for sampling it outside a frame).
  compose() {
    if (this.dirty) { renderDoc(this.doc, this.comp.getContext('2d'), this.dirty, this.previews); this.dirty = null; }
  }

  frame() {
    this.raf = 0;
    const { ctx, doc, el, dpr } = this;
    if (!doc) return;
    this.compose();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.setTransform(new DOMMatrix().scale(dpr).multiply(this.matrix));
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 24 * dpr;
    ctx.fillStyle = this.checker; ctx.fillRect(0, 0, doc.w, doc.h);
    ctx.shadowColor = 'transparent';
    ctx.imageSmoothingEnabled = this.zoom < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.comp, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.overlays.forEach(o => o.draw(ctx, this));
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
