import { TAU } from '../core/util.js';
import { regionMask } from './misc.js';

const modeOf = (app, e) => (e.shiftKey ? 'add' : e.altKey ? 'sub' : app.opts.selMode);

class DragSelect {
  constructor(app, id) { Object.assign(this, { app, id, cursor: 'crosshair' }); }
  down(p, e) { this.mode = modeOf(this.app, e); this.start(p); this.app.view.overlays.add(this); return true; }
  move(pts) { pts.forEach(p => this.add(p)); this.app.view.redraw(); }
  up() {
    const { doc, view } = this.app;
    view.overlays.delete(this);
    if (this.tiny()) { if (this.mode === 'replace') doc.selection.none(); }
    else doc.selection.apply(this.label, this.mode, c => { c.beginPath(); this.shape(c); c.fill(); });
    view.redraw();
  }
  cancel() { this.app.view.overlays.delete(this); }
  draw(ctx, view) { const p = new Path2D(); this.shape(p); view.strokeDoc(ctx, p); }
}

export class MarqueeTool extends DragSelect {
  constructor(app, id, ellipse) { super(app, id); this.ellipse = ellipse; this.label = ellipse ? 'Ellipse Select' : 'Rectangle Select'; }
  start(p) { this.a = this.b = p; }
  add(p) { this.b = p; }
  rect() {
    const { a, b } = this, x = Math.round(Math.min(a.x, b.x)), y = Math.round(Math.min(a.y, b.y));
    return { x, y, w: Math.round(Math.max(a.x, b.x)) - x, h: Math.round(Math.max(a.y, b.y)) - y };
  }
  tiny() { const r = this.rect(); return r.w < 2 && r.h < 2; }
  shape(c) {
    const r = this.rect();
    if (this.ellipse) c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, TAU);
    else c.rect(r.x, r.y, r.w, r.h);
  }
}

export class LassoTool extends DragSelect {
  constructor(app) { super(app, 'lasso'); this.label = 'Lasso Select'; }
  start(p) { this.pts = [p]; }
  add(p) { const l = this.pts.at(-1); if (Math.hypot(p.x - l.x, p.y - l.y) > 0.75) this.pts.push(p); }
  tiny() { return this.pts.length < 3; }
  shape(c) { this.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); }
}

export class WandTool {
  constructor(app) { Object.assign(this, { app, id: 'wand', cursor: 'crosshair' }); }
  down(p, e) {
    const m = regionMask(this.app, p);
    if (m) this.app.doc.selection.apply('Magic Wand', modeOf(this.app, e), c => c.drawImage(m, 0, 0));
    return false;
  }
}
