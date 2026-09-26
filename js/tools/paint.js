import { CROSS } from '../ui/cursors.js';
import { bus } from '../core/bus.js';
import { acquire, release } from '../engine/compositor.js';
import { BrushEngine, tonePattern } from '../engine/brush.js';
import { PixelEngine, PixelShapeEngine } from '../engine/pixel.js';
import { Rect, drawRect, clipTo, TAU } from '../core/util.js';
import { haptics } from '../input/haptics.js';
import { pickLock, project } from '../engine/assistants.js';

// A stroke's preview is a lazy copy of its layer: 64px tiles are copied in the first time a flush or
// the compositor touches them (copying the whole layer at pen-down cost a frame on big canvases).
let smudgeCv = null;
const smudgeCanvas = (w, h) => {
  if (smudgeCv?.width !== w || smudgeCv.height !== h) { smudgeCv = document.createElement('canvas'); smudgeCv.width = w; smudgeCv.height = h; smudgeCv.getContext('2d', { willReadFrequently: true }); }
  return smudgeCv;
};
function lazyCopy(pv, src) {
  const T = 64, cols = Math.ceil(pv.width / T), rows = Math.ceil(pv.height / T), done = new Uint8Array(cols * rows), pc = pv.getContext('2d');
  pv.ensure = r => {
    if (!r) return;
    for (let ty = Math.max(0, Math.floor(r.y / T)); ty < rows && ty * T < r.y + r.h; ty++) for (let tx = Math.max(0, Math.floor(r.x / T)); tx < cols && tx * T < r.x + r.w; tx++) {
      if (done[ty * cols + tx]) continue;
      done[ty * cols + tx] = 1;
      const t = { x: tx * T, y: ty * T, w: Math.min(T, pv.width - tx * T), h: Math.min(T, pv.height - ty * T) };
      pc.clearRect(t.x, t.y, t.w, t.h); drawRect(pc, src, t);
    }
  };
}

const LABEL = { brush: 'Brush', eraser: 'Eraser', smudge: 'Smudge', pencil: 'Pencil', pxshape: 'Pixel Shape' };

// Brush / Eraser / Smudge. Dabs go to a stroke buffer, which is composited over a copy of the
// layer (the preview) inside the dirty rect only; the layer itself is written once, on pen-up.
export class PaintTool {
  constructor(app, id) {
    Object.assign(this, { app, id, cursor: CROSS, hoverPt: null, engine: null });
    // while the size changes, the brush's outline shows on the canvas (at the pen, else the middle)
    let last = null;
    bus.on('brush', () => {
      if (app.tool !== this) return;
      const size = this.brush.size;
      if (last != null && size !== last && !this.engine) {
        this.sizeShow = performance.now() + 900;
        app.view.redrawOverlays(this);
        clearTimeout(this.sizeTimer); this.sizeTimer = setTimeout(() => { this.sizeShow = 0; app.view.redrawOverlays(this); }, 950);
      }
      last = size;
    });
  }
  // where the cursor ring goes: the pen, or the canvas middle while previewing a new size
  ringAt() {
    if (this.hoverPt) return this.hoverPt;
    if (this.sizeShow > performance.now()) { const v = this.app.view; return v.toDoc(v.cw / 2, v.ch / 2); }
    return null;
  }
  get brush() { return this.app.brushes[this.id]; }
  activate() { this.app.view.overlays.add(this); }
  deactivate() { this.cancel(); this.app.view.overlays.delete(this); }
  interrupt() { this.cancel(); }
  hover(p) { this.hoverPt = p; this.app.view.redrawOverlays(this); }
  // Screen rect of the brush ring, so moving it repaints only around it.
  bounds(view) {
    const p = this.ringAt(), r = p && this.brush.size / 2 * view.zoom;
    if (!p || r < 2) return null;
    const s = view.toScreen(p.x, p.y);
    return { x: s.x - r - 2, y: s.y - r - 2, w: 2 * r + 4, h: 2 * r + 4 };
  }

  down(p, e) {
    const { app } = this, doc = app.doc, layer = doc.activeLayer;
    if (e.altKey && (this.id === 'brush' || this.id === 'pencil')) { this.picking = true; app.pickColor(p.x, p.y); return true; }
    if (!layer || layer.locked || !layer.visible) { app.toast(layer ? 'Layer is locked or hidden' : 'Select a layer to paint on'); return false; }
    const { w, h } = doc, b = this.brush, smudge = this.id === 'smudge';
    Object.assign(this, { layer, total: null, travel: 0 });
    // smudge reads pixels back every dab: it gets its own CPU-side canvas; brushes use the pool
    this.preview = smudge ? smudgeCanvas(w, h) : acquire(w, h);
    if (smudge) { const pc = this.preview.getContext('2d'); pc.clearRect(0, 0, w, h); pc.drawImage(layer.canvas, 0, 0); }   // smudge samples it anywhere
    else lazyCopy(this.preview, layer.canvas);
    if (!smudge) { this.buf = acquire(w, h); if (this.buf.stale?.w) { const s = this.buf.stale; this.buf.getContext('2d').clearRect(s.x, s.y, s.w, s.h); this.buf.stale = null; } }   // only what the last stroke left
    this.opacity = b.buildup ? 1 : b.opacity;
    this.mode = this.erasing(e) ? 'destination-out' : layer.alphaLock ? 'source-atop' : b.blend;
    this.engine = this.makeEngine((smudge ? this.preview : this.buf).getContext('2d'), b, smudge);
    this.start = p;
    this.lock = null; this.decided = false;
    this.snap = app.opts.snapAssist && doc.assistants.length > 0;
    app.view.previews.set(layer, this.preview);
    this.engine.begin(p);
    this.flush();
    return true;
  }

  erasing() { return this.id === 'eraser'; }
  makeEngine(target, b, smudge) {
    const { app } = this, { w, h } = app.doc;
    return new BrushEngine(b, {
      target, color: app.color.fg, symmetry: app.symmetry(), scale: 1 / app.view.zoom,
      profile: app.profile, alphaMul: b.buildup ? b.opacity : 1, smudge, wrap: app.opts.wrap ? { w, h } : null,
    });
  }

  move(pts) {
    const last = pts.at(-1);
    if (this.picking) return this.app.pickColor(last.x, last.y);
    if (!this.engine) return;
    this.travel += Math.hypot(last.x - (this.hoverPt?.x ?? last.x), last.y - (this.hoverPt?.y ?? last.y)) * this.app.view.zoom;
    if (this.travel > 40) { this.travel = 0; haptics.tick(); }
    this.hoverPt = last;
    this.app.view.redrawOverlays(this);
    // snapping decides once the stroke has a direction: locked to a guide it heads along, or free
    if (this.snap && !this.decided && Math.hypot(last.x - this.start.x, last.y - this.start.y) > 4 / this.app.view.zoom) { this.lock = pickLock(this.app.doc.assistants, this.start, last); this.decided = true; }
    if (this.snap && !this.decided) return;
    pts.forEach(p => this.engine.move(this.lock ? project(this.lock, p) : p));
    this.flush();
  }

  up(p) {
    if (this.picking) { this.picking = false; return; }
    if (!this.engine) return;
    this.engine.end(this.lock ? project(this.lock, p) : p);
    this.flush();
    const r = this.total, pv = this.preview;
    if (r) pv.ensure?.(r);   // the stroke's bounding box can span tiles no dab touched: fill them from the layer first
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
    if (this.preview) this.preview.ensure = null;
    release(this.preview); release(this.buf, this.total ?? undefined);
    this.engine = this.preview = this.buf = null;
  }

  flush() {
    const { doc, view } = this.app, r = Rect.clip(this.engine.takeDirty(), doc.w, doc.h);
    if (!r) return;
    this.total = Rect.union(this.total, r);
    const mask = doc.selection.clip, pc = this.preview.getContext('2d');
    this.preview.ensure?.(r);
    if (this.buf) {
      pc.clearRect(r.x, r.y, r.w, r.h);
      drawRect(pc, this.layer.canvas, r);
      let src = this.buf, t = null;
      const tone = this.brush.pattern && tonePattern(pc, this.brush.pattern, this.brush.patternSize ?? 8);
      if (mask || tone) {
        t = acquire(doc.w, doc.h);
        const tc = t.getContext('2d');
        tc.clearRect(r.x, r.y, r.w, r.h);
        drawRect(tc, this.buf, r);
        tc.globalCompositeOperation = 'destination-in';
        if (mask) drawRect(tc, mask, r);
        if (tone) { tc.fillStyle = tone; tc.fillRect(r.x, r.y, r.w, r.h); }   // screentone: the stroke keeps only the page-aligned dots / lines
        tc.globalCompositeOperation = 'source-over';
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
    this.drawCursor(ctx, view);
  }
  drawCursor(ctx, view) {
    const p = this.ringAt(), r = p && this.brush.size / 2 * view.zoom;
    if (!p || r < 2) return;
    const s = view.toScreen(p.x, p.y);
    ctx.lineWidth = 1;
    [['rgba(0,0,0,.55)', r + 0.5], ['rgba(255,255,255,.9)', r - 0.5]].forEach(([c, rr]) => {
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(1, rr), 0, TAU); ctx.strokeStyle = c; ctx.stroke();
    });
  }
}

// Pixel Pencil / Pixel Shape: Draw's pixel-art tools. Whole pixels (size 1–16), pixel-perfect
// lines, line / rectangle / ellipse, symmetry, selection masks and alpha lock like any brush;
// right-click or the Erase toggle clears pixels.
export class PixelTool extends PaintTool {
  constructor(app, id = 'pencil') { super(app, id); }
  get brush() { return { size: this.app.opts.pixelSize, opacity: 1, blend: 'source-over', buildup: false }; }
  erasing(e) { return this.app.opts.pixelErase || e?.button === 2; }
  makeEngine(target) {
    const { app } = this;
    const o = app.opts, base = { target, color: app.color.fg, size: o.pixelSize, symmetry: app.symmetry(), dither: o.pixelDither };
    return this.id === 'pxshape' ? new PixelShapeEngine({ ...base, kind: o.shape, filled: o.pixelFill }) : new PixelEngine({ ...base, perfect: o.pixelPerfect });
  }
  // The cursor is the square of pixels the pencil will fill.
  cellRect(view) {
    const p = this.hoverPt;
    if (!p) return null;
    const n = this.app.opts.pixelSize, o = (n - 1) / 2, x = Math.floor(p.x - o), y = Math.floor(p.y - o);
    const pts = [[x, y], [x + n, y], [x, y + n], [x + n, y + n]].map(([a, b]) => view.toScreen(a, b));
    const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), pts };
  }
  bounds(view) { const r = this.cellRect(view); return r && { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 }; }
  drawCursor(ctx, view) {
    const r = this.cellRect(view);
    if (!r) return;
    const [a, b, c, d] = r.pts;
    ctx.lineWidth = 1;
    for (const [col, off] of [['rgba(0,0,0,.6)', 0], ['rgba(255,255,255,.9)', 1]]) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(d.x, d.y); ctx.lineTo(c.x, c.y); ctx.closePath();
      ctx.setLineDash(off ? [3, 3] : []); ctx.strokeStyle = col; ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}
