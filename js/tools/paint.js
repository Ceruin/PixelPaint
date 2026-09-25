import { acquire, release } from '../engine/compositor.js';
import { BrushEngine } from '../engine/brush.js';
import { Rect, drawRect, clipTo, TAU } from '../core/util.js';
import { haptics } from '../input/haptics.js';
import { pickLock, project } from '../engine/assistants.js';

const LABEL = { brush: 'Brush', eraser: 'Eraser', smudge: 'Smudge' };

// Brush / Eraser / Smudge. Dabs go to a stroke buffer, which is composited over a copy of the
// layer (the preview) inside the dirty rect only; the layer itself is written once, on pen-up.
export class PaintTool {
  constructor(app, id) { Object.assign(this, { app, id, cursor: 'crosshair', hoverPt: null, engine: null }); }
  get brush() { return this.app.brushes[this.id]; }
  activate() { this.app.view.overlays.add(this); }
  deactivate() { this.cancel(); this.app.view.overlays.delete(this); }
  interrupt() { this.cancel(); }
  hover(p) { this.hoverPt = p; this.app.view.redrawOverlays(this); }
  // Screen rect of the brush ring, so moving it repaints only around it.
  bounds(view) {
    const p = this.hoverPt, r = p && this.brush.size / 2 * view.zoom;
    if (!p || r < 2) return null;
    const s = view.toScreen(p.x, p.y);
    return { x: s.x - r - 2, y: s.y - r - 2, w: 2 * r + 4, h: 2 * r + 4 };
  }

  down(p, e) {
    const { app } = this, doc = app.doc, layer = doc.activeLayer;
    if (e.altKey && this.id === 'brush') { this.picking = true; app.pickColor(p.x, p.y); return true; }
    if (!layer || layer.locked || !layer.visible) { app.toast(layer ? 'Layer is locked or hidden' : 'Select a layer to paint on'); return false; }
    const { w, h } = doc, b = this.brush, smudge = this.id === 'smudge';
    Object.assign(this, { layer, total: null, travel: 0 });
    this.preview = acquire(w, h);
    const pc = this.preview.getContext('2d');
    pc.clearRect(0, 0, w, h); pc.drawImage(layer.canvas, 0, 0);
    if (!smudge) { this.buf = acquire(w, h); this.buf.getContext('2d').clearRect(0, 0, w, h); }
    this.opacity = b.buildup ? 1 : b.opacity;
    this.mode = this.id === 'eraser' ? 'destination-out' : layer.alphaLock ? 'source-atop' : b.blend;
    this.engine = new BrushEngine(b, {
      target: (smudge ? this.preview : this.buf).getContext('2d'), color: app.color.fg, symmetry: app.symmetry(),
      profile: app.profile, alphaMul: b.buildup ? b.opacity : 1, smudge, wrap: app.opts.wrap ? { w, h } : null,
    });
    this.start = p;
    this.lock = null;
    this.snap = app.opts.snapAssist && doc.assistants.length > 0;
    app.view.previews.set(layer, this.preview);
    this.engine.begin(p);
    this.flush();
    return true;
  }

  move(pts) {
    const last = pts.at(-1);
    if (this.picking) return this.app.pickColor(last.x, last.y);
    if (!this.engine) return;
    this.travel += Math.hypot(last.x - (this.hoverPt?.x ?? last.x), last.y - (this.hoverPt?.y ?? last.y)) * this.app.view.zoom;
    if (this.travel > 40) { this.travel = 0; haptics.tick(); }
    this.hoverPt = last;
    this.app.view.redrawOverlays(this);
    if (this.snap && !this.lock && Math.hypot(last.x - this.start.x, last.y - this.start.y) > 4 / this.app.view.zoom) this.lock = pickLock(this.app.doc.assistants, this.start, last);
    if (this.snap && !this.lock) return;
    pts.forEach(p => this.engine.move(this.lock ? project(this.lock, p) : p));
    this.flush();
  }

  up(p) {
    if (this.picking) { this.picking = false; return; }
    if (!this.engine) return;
    this.engine.end(this.lock ? project(this.lock, p) : p);
    this.flush();
    const r = this.total, pv = this.preview;
    if (r) this.app.doc.editPixels(LABEL[this.id], this.layer, r, ctx => { ctx.clearRect(r.x, r.y, r.w, r.h); drawRect(ctx, pv, r); });
    this.cleanup();
  }

  cancel() {
    if (!this.engine) return;
    const r = this.total;
    this.cleanup();
    if (r) this.app.view.invalidate(r);
  }

  cleanup() {
    this.app.view.previews.delete(this.layer);
    release(this.preview); release(this.buf);
    this.engine = this.preview = this.buf = null;
  }

  flush() {
    const { doc, view } = this.app, r = Rect.clip(this.engine.takeDirty(), doc.w, doc.h);
    if (!r) return;
    this.total = Rect.union(this.total, r);
    const mask = doc.selection.clip, pc = this.preview.getContext('2d');
    if (this.buf) {
      pc.clearRect(r.x, r.y, r.w, r.h);
      drawRect(pc, this.layer.canvas, r);
      let src = this.buf, t = null;
      if (mask) {
        t = acquire(doc.w, doc.h);
        const tc = t.getContext('2d');
        tc.clearRect(r.x, r.y, r.w, r.h);
        drawRect(tc, this.buf, r);
        tc.globalCompositeOperation = 'destination-in'; drawRect(tc, mask, r); tc.globalCompositeOperation = 'source-over';
        src = t;
      }
      pc.globalAlpha = this.opacity; pc.globalCompositeOperation = this.mode;
      drawRect(pc, src, r);
      pc.globalAlpha = 1; pc.globalCompositeOperation = 'source-over';
      release(t);
    } else if (mask) {
      // Smudge paints the preview directly: restore everything outside the selection.
      const t = acquire(doc.w, doc.h), tc = t.getContext('2d');
      tc.clearRect(r.x, r.y, r.w, r.h);
      drawRect(tc, this.layer.canvas, r);
      tc.globalCompositeOperation = 'destination-out'; drawRect(tc, mask, r); tc.globalCompositeOperation = 'source-over';
      clipTo(pc, r, c => {
        c.globalCompositeOperation = 'destination-in'; drawRect(c, mask, r);
        c.globalCompositeOperation = 'source-over'; drawRect(c, t, r);
      });
      release(t);
    }
    view.invalidate(r);
  }

  draw(ctx, view) {
    const { app } = this, { doc, opts } = app;
    if (opts.symmetry !== 'none') {
      const g = new Path2D(), cx = doc.w / 2, cy = doc.h / 2, R = Math.hypot(doc.w, doc.h);
      const ray = a => { g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); };
      if (opts.symmetry === 'radial') for (let i = 0; i < opts.radial; i++) ray(-Math.PI / 2 + i * TAU / opts.radial);
      if (['vertical', 'quad'].includes(opts.symmetry)) { g.moveTo(cx, 0); g.lineTo(cx, doc.h); }
      if (['horizontal', 'quad'].includes(opts.symmetry)) { g.moveTo(0, cy); g.lineTo(doc.w, cy); }
      view.strokeDoc(ctx, g, 0, 'rgba(132,206,224,.9)', 'rgba(0,0,0,.35)');
    }
    const p = this.hoverPt, r = p && this.brush.size / 2 * view.zoom;
    if (!p || r < 2) return;
    const s = view.toScreen(p.x, p.y);
    ctx.lineWidth = 1;
    [['rgba(0,0,0,.55)', r + 0.5], ['rgba(255,255,255,.9)', r - 0.5]].forEach(([c, rr]) => {
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(1, rr), 0, TAU); ctx.strokeStyle = c; ctx.stroke();
    });
  }
}
