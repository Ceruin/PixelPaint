import { makeCanvas, Rect, clamp } from '../core/util.js';
import { bus } from '../core/bus.js';
import { renderDoc } from './compositor.js';

// Screen presentation: doc composite (dirty-rect cached) → transformed blit → overlays.
// The view canvas is a normal double-buffered one (the browser shows each frame whole, so it
// can't flicker), and only the screen region that changed is repainted: a brush stroke costs
// its own area, not the whole screen — which also keeps e-ink panels calm.
export class Viewport {
  constructor(canvas) {
    Object.assign(this, { el: canvas, zoom: 1, rot: 0, x: 0, y: 0, flip: false, wrap: false, dirty: null, raf: 0, dpr: 0, cw: 1, ch: 1, vw: 1, vh: 1 });
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
    const { doc, cw, ch } = this, pad = cw < 600 ? 16 : 48, z = Math.min((cw - pad) / doc.w, (ch - pad) / doc.h);
    // pixel canvases fit at a whole-number zoom so every pixel is the same size on screen
    this.set(doc.pixelArt && z >= 1 ? Math.min(64, Math.floor(z)) : Math.min(z, 4), 0, cw / 2, ch / 2, { x: doc.w / 2, y: doc.h / 2 });
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

  changed() { this.m = this.inv = null; this.bound(); bus.emit('view', this); this.redraw(); }
  // The page can't be pushed out of sight: at least a strip of it (up to 160px) always stays on
  // screen, so panning never gets you lost in empty space.
  bound() {
    if (!this.doc || !this.cw) return;
    const pts = [[0, 0], [this.doc.w, 0], [0, this.doc.h], [this.doc.w, this.doc.h]].map(([x, y]) => this.matrix.transformPoint({ x, y }));
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y), l = Math.min(...xs), r = Math.max(...xs), t = Math.min(...ys), b = Math.max(...ys);
    const mx = Math.min(160, (r - l) / 2, this.cw / 2), my = Math.min(160, (b - t) / 2, this.ch / 2);
    const dx = r < mx ? mx - r : l > this.cw - mx ? this.cw - mx - l : 0, dy = b < my ? my - b : t > this.ch - my ? this.ch - my - t : 0;
    if (dx || dy) { this.x += dx; this.y += dy; this.m = this.inv = null; }
  }
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
  // minFrame (ms) caps the refresh rate (the e-ink simulation's slow panel); 0 = every display frame.
  schedule() {
    if (this.raf) return;
    const wait = (this.minFrame || 0) - (performance.now() - (this.lastFrame || 0));
    this.raf = wait > 1 ? setTimeout(() => requestAnimationFrame(() => this.frame()), wait) : requestAnimationFrame(() => this.frame());
  }

  // Brings the composite up to date now (for sampling it outside a frame).
  compose() {
    if (this.dirty) { renderDoc(this.doc, this.comp.getContext('2d'), this.dirty, this.previews); this.dirty = null; }
  }

  frame() {
    this.raf = 0; this.lastFrame = performance.now();
    const { doc, el } = this;
    if (!doc) return;
    this.compose();
    const all = { x: 0, y: 0, w: this.vw, h: this.vh };
    const r = this.full || this.wrap ? all : Rect.clip(Rect.union(this.toScreenRect(this.pending), this.overlayBox()), this.vw, this.vh);
    const strips = this.exposed;
    this.full = false; this.pending = null; this.moved.clear(); this.exposed = null;
    const c = this.ctx;
    for (const q of r === all ? [all] : [r, ...(strips ?? [])]) {
      if (!q?.w || !q.h) continue;
      c.save();
      if (q !== all) { c.beginPath(); c.rect(q.x, q.y, q.w, q.h); c.clip(); }
      this.paint(c, q === all || !this.insideDoc(q));
      c.restore();
    }
  }

  // One frame (the caller clips it to the region being repainted).
  paint(ctx, shadow) {
    const { doc, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    const base = new DOMMatrix().scale(dpr).multiply(this.matrix);
    if (shadow && !this.wrap && !this.flat) this.drawShadow(ctx);   // flat: the E-ink theme has no shadows
    for (const [i, j] of this.tiles()) {
      ctx.setTransform(base.translate(i * doc.w, j * doc.h));
      this.checker.setTransform(new DOMMatrix().scale(1 / this.zoom));   // same size squares on screen at any zoom
      ctx.fillStyle = this.checker; ctx.fillRect(0, 0, doc.w, doc.h);
      ctx.imageSmoothingEnabled = this.zoom < 2 && !doc.pixelArt;
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
    const cx = this.cw / 2, cy = this.ch / 2, ow = this.vw, oh = this.vh;
    // The backing store grows at once but only shrinks back to the stage after 20 quiet seconds: a mode
    // switch then just shifts and repaints, while strokes don't pay per frame for a canvas bigger
    // than the stage.
    const dpr = devicePixelRatio || 1, el = this.el;
    let fresh = false;
    this.vw = Math.round(r.width * dpr); this.vh = Math.round(r.height * dpr);
    const alloc = (w, h) => { el.width = w; el.height = h; Object.assign(el.style, { width: `${w / dpr}px`, height: `${h / dpr}px` }); };
    if (dpr !== this.dpr || this.vw > el.width || this.vh > el.height) {
      this.dpr = dpr; fresh = true;
      alloc(Math.max(this.vw, el.width), Math.max(this.vh, el.height));
    }
    clearTimeout(this.shrink);
    if (el.width > this.vw || el.height > this.vh) this.shrink = setTimeout(() => {
      if (this.busy?.()) return this.resize();   // not mid-stroke: try again later
      alloc(this.vw, this.vh); this.redraw();
    }, 20000);
    // Keep the page centred, but move it by whole device pixels: the picture already on screen is
    // then shifted with one copy and only the newly exposed strips are repainted (a mode switch
    // that resizes the stage no longer repaints the whole screen).
    const dx = Math.round((r.width / 2 - cx) * dpr), dy = Math.round((r.height / 2 - cy) * dpr);
    this.x += dx / dpr; this.y += dy / dpr;
    this.cw = r.width; this.ch = r.height;
    this.m = this.inv = null;
    bus.emit('view', this);
    if (fresh || this.full || this.wrap || !this.doc) return this.redraw();
    if (dx || dy) {
      const c = this.ctx;
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'copy';
      c.drawImage(this.el, 0, 0, ow, oh, dx, dy, ow, oh);   // 'copy' also clears everything outside it
      c.restore();
      for (const o of this.overlays) { const b = this.boxes.get(o); if (b) this.boxes.set(o, { ...b, x: b.x + dx, y: b.y + dy }); }   // their pixels moved too
    }
    // what the shifted old picture doesn't cover
    const L = Math.max(0, dx), T = Math.max(0, dy), R = Math.min(this.vw, dx + ow), B = Math.min(this.vh, dy + oh);
    this.exposed = [{ x: 0, y: 0, w: this.vw, h: T }, { x: 0, y: B, w: this.vw, h: this.vh - B }, { x: 0, y: T, w: L, h: B - T }, { x: R, y: T, w: this.vw - R, h: B - T }]
      .filter(q => q.w > 0 && q.h > 0);
    this.schedule();
  }
}
