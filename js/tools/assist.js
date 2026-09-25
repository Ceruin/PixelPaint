import { bus } from '../core/bus.js';
import { TAU } from '../core/util.js';

// Places rulers (drag) and vanishing points (click); drag a handle to move it, Alt-click to delete.
export class AssistTool {
  constructor(app) { Object.assign(this, { app, id: 'assist', cursor: 'crosshair', drag: null }); }
  get list() { return this.app.doc.assistants; }
  changed() { bus.emit('assist'); this.app.view.redraw(); }

  hit(p) {
    const v = this.app.view;
    for (const a of this.list) for (const key of a.type === 'ruler' ? ['a', 'b'] : ['a']) {
      const s = v.toScreen(a[key].x, a[key].y);
      if (Math.hypot(s.x - p.sx, s.y - p.sy) < 12) return { a, key };
    }
    return null;
  }

  down(p, e) {
    const pt = { x: p.x, y: p.y }, hit = this.hit(p);
    if (hit && e.altKey) { this.list.splice(this.list.indexOf(hit.a), 1); this.changed(); return false; }
    if (hit) { this.drag = hit; return true; }
    const a = this.app.opts.assistKind === 'vanish' ? { type: 'vanish', a: pt } : { type: 'ruler', a: pt, b: { ...pt } };
    this.list.push(a);
    this.drag = { a, key: a.type === 'ruler' ? 'b' : 'a' };
    this.app.setOpt('snapAssist', true);
    this.changed();
    return true;
  }

  move(pts) { const p = pts.at(-1); this.drag.a[this.drag.key] = { x: p.x, y: p.y }; this.app.view.redraw(); }

  up() {
    const a = this.drag?.a;
    if (a?.type === 'ruler' && Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y) < 3) this.list.splice(this.list.indexOf(a), 1);
    this.drag = null;
    this.changed();
  }
}

// Always-on overlay for placed assistants (hidden with View ▸ Show Assistants off).
export const assistOverlay = app => ({
  draw(ctx, view) {
    const list = app.doc?.assistants;
    if (!list?.length || !app.opts.showAssist) return;
    const lines = new Path2D(), R = Math.hypot(app.doc.w, app.doc.h);
    for (const a of list) {
      if (a.type === 'ruler') {
        const dx = a.b.x - a.a.x, dy = a.b.y - a.a.y, l = Math.hypot(dx, dy) || 1, ux = dx / l * R, uy = dy / l * R;
        lines.moveTo(a.a.x - ux, a.a.y - uy); lines.lineTo(a.b.x + ux, a.b.y + uy);
      } else for (let i = 0; i < 24; i++) { lines.moveTo(a.a.x, a.a.y); lines.lineTo(a.a.x + Math.cos(i / 24 * TAU) * R, a.a.y + Math.sin(i / 24 * TAU) * R); }
    }
    ctx.save(); ctx.globalAlpha = 0.45;
    view.strokeDoc(ctx, lines, 0, '#5b8cff', 'rgba(0,0,0,.3)');
    ctx.restore();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#5b8cff'; ctx.fillStyle = '#fff';
    for (const a of list) for (const q of a.type === 'ruler' ? [a.a, a.b] : [a.a]) {
      const s = view.toScreen(q.x, q.y);
      ctx.beginPath();
      if (a.type === 'ruler') ctx.rect(s.x - 5, s.y - 5, 10, 10); else ctx.arc(s.x, s.y, 6, 0, TAU);
      ctx.fill(); ctx.stroke();
    }
  },
});
