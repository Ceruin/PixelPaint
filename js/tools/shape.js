import { Rect, makeCanvas, TAU } from '../core/util.js';

// Vector-style shapes, rasterised onto the active layer on release. Bubbles and panels cover
// the comic-making basics (Krita's word-bubble library / CSP frame borders).
export const SHAPES = [['rect', 'Rectangle', 'marquee'], ['ellipse', 'Ellipse', 'ellipse'], ['line', 'Line', 'minus'], ['bubble', 'Speech bubble', 'bubble'], ['thought', 'Thought bubble', 'sparkle'], ['panel', 'Comic panel', 'crop']];

function shapePath(kind, a, b) {
  const p = new Path2D(), x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2, on = t => [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry];
  switch (kind) {
    case 'line': p.moveTo(a.x, a.y); p.lineTo(b.x, b.y); break;
    case 'ellipse': p.ellipse(cx, cy, rx, ry, 0, 0, TAU); break;
    case 'bubble': {
      const t1 = 1.75, t2 = 2.2;
      p.moveTo(x + w * 0.12, y + h * 1.3);
      p.lineTo(...on(t1));
      p.ellipse(cx, cy, rx, ry, 0, t1, t2, true);
      p.closePath();
      break;
    }
    case 'thought': {
      const n = 11;
      for (let i = 0; i <= n; i++) {
        const t = i / n * TAU, [px, py] = on(t);
        if (!i) { p.moveTo(px, py); continue; }
        const m = (i - 0.5) / n * TAU;
        p.quadraticCurveTo(cx + Math.cos(m) * rx * 1.22, cy + Math.sin(m) * ry * 1.22, px, py);
      }
      p.closePath();
      [[0.18, 1.14, 0.09], [0.08, 1.3, 0.055]].forEach(([fx, fy, fr]) => {
        const r = Math.min(w, h) * fr;
        p.moveTo(x + w * fx + r, y + h * fy);
        p.arc(x + w * fx, y + h * fy, r, 0, TAU);
      });
      break;
    }
    default: p.rect(x, y, w, h);
  }
  return p;
}

export class ShapeTool {
  constructor(app) { Object.assign(this, { app, id: 'shape', cursor: 'crosshair' }); }

  down(p, e) {
    const layer = this.app.doc.activeLayer;
    if (!layer || layer.locked) { this.app.toast('Select an unlocked layer'); return false; }
    Object.assign(this, { a: p, b: p, layer });
    this.app.view.overlays.add(this);
    return true;
  }

  move(pts, e) {
    let b = pts.at(-1);
    if (e.shiftKey) {
      const dx = b.x - this.a.x, dy = b.y - this.a.y;
      if (this.app.opts.shape === 'line') {
        const t = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(dx, dy);
        b = { x: this.a.x + Math.cos(t) * l, y: this.a.y + Math.sin(t) * l };
      } else { const s = Math.max(Math.abs(dx), Math.abs(dy)); b = { x: this.a.x + Math.sign(dx || 1) * s, y: this.a.y + Math.sign(dy || 1) * s }; }
    }
    this.b = b;
    this.app.view.redraw();
  }

  paint(ctx) {
    const { opts, color } = this.app, kind = opts.shape, path = shapePath(kind, this.a, this.b);
    const comic = ['bubble', 'thought', 'panel'].includes(kind);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.lineWidth = kind === 'panel' ? Math.max(6, opts.shapeWidth) : opts.shapeWidth;
    if ((opts.shapeFill || comic) && kind !== 'line' && kind !== 'panel') { ctx.fillStyle = comic ? '#ffffff' : color.bg; ctx.fill(path); }
    if (opts.shapeStroke || comic || kind === 'line') { ctx.strokeStyle = color.fg; ctx.stroke(path); }
  }

  up() {
    const { doc, view, opts } = this.app;
    view.overlays.delete(this);
    view.redraw();
    if (Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y) < 2) return;
    const pad = opts.shapeWidth + 8, r = Rect.fromPoints([this.a, this.b]), h = r.h;
    const box = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: h * 1.4 + pad * 2 };
    const t = makeCanvas(doc.w, doc.h), tc = t.getContext('2d');
    this.paint(tc);
    if (doc.selection.active) { tc.globalCompositeOperation = 'destination-in'; tc.drawImage(doc.selection.mask, 0, 0); }
    doc.editPixels('Shape', this.layer, box, ctx => {
      ctx.globalCompositeOperation = this.layer.alphaLock ? 'source-atop' : 'source-over';
      ctx.drawImage(t, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    });
  }

  cancel() { this.app.view.overlays.delete(this); }

  draw(ctx, view) {
    ctx.save();
    ctx.setTransform(new DOMMatrix().scale(view.dpr).multiply(view.matrix));
    ctx.globalAlpha = 0.85;
    this.paint(ctx);
    ctx.restore();
  }
}
