import { makeCanvas, alphaBounds, Rect, drawRect, DEG } from '../core/util.js';
import { acquire, release } from '../engine/compositor.js';
import { Compound } from '../engine/commands.js';
import { bus } from '../core/bus.js';

const HANDLES = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
const N = 3, SUB = 4;

// Maps source triangle s onto destination triangle d (affine), clipped to d.
function tri(ctx, img, s, d) {
  const [[x0, y0], [x1, y1], [x2, y2]] = s, [[u0, v0], [u1, v1], [u2, v2]] = d;
  const den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (!den) return;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / den, c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / den;
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / den, e = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / den;
  const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3;
  ctx.save();
  ctx.beginPath();
  d.forEach(([x, y], i) => { const l = Math.hypot(x - cx, y - cy) || 1, gx = x + (x - cx) / l * 0.7, gy = y + (y - cy) / l * 0.7; i ? ctx.lineTo(gx, gy) : ctx.moveTo(gx, gy); });
  ctx.clip();
  ctx.transform(a, b, c, e, u0 - a * x0 - c * y0, v0 - b * x0 - e * y0);
  const sx = Math.max(0, Math.floor(Math.min(x0, x1, x2)) - 1), sy = Math.max(0, Math.floor(Math.min(y0, y1, y2)) - 1);
  const ex = Math.min(img.width, Math.ceil(Math.max(x0, x1, x2)) + 1), ey = Math.min(img.height, Math.ceil(Math.max(y0, y1, y2)) + 1);
  if (ex > sx && ey > sy) ctx.drawImage(img, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);
  ctx.restore();
}

function warpDraw(ctx, img, mesh) {
  const w = img.width, h = img.height, M = N * SUB;
  const P = (u, v) => {
    const fx = Math.min(u * N, N - 1e-9), fy = Math.min(v * N, N - 1e-9), i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j;
    const a = mesh[j * (N + 1) + i], b = mesh[j * (N + 1) + i + 1], c = mesh[(j + 1) * (N + 1) + i], d = mesh[(j + 1) * (N + 1) + i + 1];
    const k = key => (a[key] * (1 - tx) + b[key] * tx) * (1 - ty) + (c[key] * (1 - tx) + d[key] * tx) * ty;
    return [k('x'), k('y')];
  };
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const u0 = i / M, u1 = (i + 1) / M, v0 = j / M, v1 = (j + 1) / M;
    const s00 = [u0 * w, v0 * h], s10 = [u1 * w, v0 * h], s01 = [u0 * w, v1 * h], s11 = [u1 * w, v1 * h];
    const d00 = P(u0, v0), d10 = P(u1, v0), d01 = P(u0, v1), d11 = P(u1, v1);
    tri(ctx, img, [s00, s10, s11], [d00, d10, d11]);
    tri(ctx, img, [s00, s11, s01], [d00, d11, d01]);
  }
}

// Move / scale / rotate / warp of the active layer or the selected part of it.
export class TransformTool {
  constructor(app) { Object.assign(this, { app, id: 'transform', cursor: 'move', s: null, drag: null }); }
  activate() { this.begin(); }
  deactivate() { this.commit(); }
  interrupt() { this.cancel(); }

  begin() {
    const { doc, view } = this.app, layer = doc.activeLayer;
    if (this.s || !layer || layer.locked) return false;
    const sel = doc.selection, box = sel.active ? sel.bounds : alphaBounds(layer.canvas);
    if (!box) return false;
    const float = makeCanvas(box.w, box.h), fc = float.getContext('2d');
    fc.drawImage(layer.canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    const base = acquire(doc.w, doc.h), bc = base.getContext('2d');
    bc.clearRect(0, 0, doc.w, doc.h);
    bc.drawImage(layer.canvas, 0, 0);
    if (sel.active) {
      fc.globalCompositeOperation = 'destination-in';
      fc.drawImage(sel.mask, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      bc.globalCompositeOperation = 'destination-out'; bc.drawImage(sel.mask, 0, 0); bc.globalCompositeOperation = 'source-over';
    } else bc.clearRect(box.x, box.y, box.w, box.h);
    this.s = { layer, box, float, base, preview: acquire(doc.w, doc.h), m: { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0 }, mesh: null, changed: false, hadSel: sel.active };
    view.previews.set(layer, this.s.preview);
    view.overlays.add(this);
    if (this.app.opts.transformMode === 'warp') this.setWarp(true);
    this.render();
    bus.emit('transform', true);
    return true;
  }

  matrix(m = this.s.m) {
    const { box } = this.s;
    return new DOMMatrix().translate(box.x + box.w / 2 + m.tx, box.y + box.h / 2 + m.ty).rotate(m.rot).scale(m.sx, m.sy).translate(-box.w / 2, -box.h / 2);
  }
  corners() { const M = this.matrix(), { w, h } = this.s.box; return [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => M.transformPoint({ x, y })); }

  setWarp(on) {
    const s = this.s;
    if (!s || !on || s.mesh) return;
    const M = this.matrix(), { w, h } = s.box;
    s.mesh = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) s.mesh.push(M.transformPoint({ x: i / N * w, y: j / N * h }));
    this.render();
  }

  paint(ctx) {
    const s = this.s;
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    if (s.mesh) warpDraw(ctx, s.float, s.mesh);
    else { ctx.setTransform(this.matrix()); ctx.drawImage(s.float, 0, 0); }
    ctx.restore();
  }

  render() {
    const { doc, view } = this.app, pc = this.s.preview.getContext('2d');
    pc.clearRect(0, 0, doc.w, doc.h);
    pc.drawImage(this.s.base, 0, 0);
    this.paint(pc);
    view.invalidate(doc.bounds);
  }

  hit(p) {
    const s = this.s, { view } = this.app, near = (x, y, r) => { const t = view.toScreen(x, y); return Math.hypot(t.x - p.sx, t.y - p.sy) < r; };
    if (s.mesh) {
      const i = s.mesh.findIndex(q => near(q.x, q.y, 16));
      return i >= 0 ? { kind: 'mesh', i } : { kind: 'move' };
    }
    const M = this.matrix(), { w, h } = s.box;
    const k = HANDLES.findIndex(([fx, fy]) => { const d = M.transformPoint({ x: fx * w, y: fy * h }); return near(d.x, d.y, 14); });
    if (k >= 0) return { kind: 'scale', fx: HANDLES[k][0], fy: HANDLES[k][1] };
    const L = M.inverse().transformPoint({ x: p.x, y: p.y });
    return L.x >= 0 && L.y >= 0 && L.x <= w && L.y <= h ? { kind: 'move' } : { kind: 'rotate' };
  }

  down(p) {
    if (!this.s && !this.begin()) { this.app.toast('Nothing to transform on this layer'); return false; }
    const s = this.s;
    this.drag = { ...this.hit(p), p0: p, m0: { ...s.m }, M0: this.matrix(), mesh0: s.mesh?.map(q => ({ x: q.x, y: q.y })) };
    return true;
  }

  move(pts, e) {
    const p = pts.at(-1), d = this.drag, s = this.s;
    if (!d || !s) return;
    const m = s.m, dx = p.x - d.p0.x, dy = p.y - d.p0.y;
    if (d.kind === 'move') {
      if (s.mesh) s.mesh = d.mesh0.map(q => ({ x: q.x + dx, y: q.y + dy }));
      else { m.tx = d.m0.tx + dx; m.ty = d.m0.ty + dy; }
    } else if (d.kind === 'mesh') s.mesh[d.i] = { x: d.mesh0[d.i].x + dx, y: d.mesh0[d.i].y + dy };
    else if (d.kind === 'rotate') {
      const c = d.M0.transformPoint({ x: s.box.w / 2, y: s.box.h / 2 });
      m.rot = d.m0.rot + (Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(d.p0.y - c.y, d.p0.x - c.x)) / DEG;
      if (e.shiftKey) m.rot = Math.round(m.rot / 15) * 15;
    } else {
      const { w, h } = s.box, L = d.M0.inverse().transformPoint({ x: p.x, y: p.y }), ax = w * (1 - d.fx), ay = h * (1 - d.fy);
      let kx = d.fx === 0.5 ? 1 : (L.x - ax) / (w * d.fx - ax), ky = d.fy === 0.5 ? 1 : (L.y - ay) / (h * d.fy - ay);
      const corner = d.fx !== 0.5 && d.fy !== 0.5;
      if (corner && e.shiftKey !== this.app.opts.uniform) kx = ky = Math.abs(kx) > Math.abs(ky) ? kx : ky;
      Object.assign(m, { tx: d.m0.tx, ty: d.m0.ty, sx: d.m0.sx * kx, sy: d.m0.sy * ky });
      const a0 = d.M0.transformPoint({ x: ax, y: ay }), a1 = this.matrix().transformPoint({ x: ax, y: ay });
      m.tx += a0.x - a1.x; m.ty += a0.y - a1.y;
    }
    s.changed = true;
    this.render();
  }

  up() { this.drag = null; }

  commit() {
    const s = this.s;
    if (!s) return;
    if (!s.changed) return this.cancel();
    const { doc } = this.app;
    const out = Rect.fromPoints(s.mesh ?? this.corners());
    const R = Rect.union(s.box, { x: out.x - 2, y: out.y - 2, w: out.w + 4, h: out.h + 4 });
    const px = doc.pixelEdit('Transform', s.layer, R, (ctx, r) => { ctx.clearRect(r.x, r.y, r.w, r.h); drawRect(ctx, s.preview, r); });
    const sc = s.hadSel ? doc.selection.edit('', c => { c.clearRect(0, 0, doc.w, doc.h); this.paint(c); }, false) : null;
    doc.history.push(new Compound('Transform', [px, sc]));
    this.cleanup();
  }

  cancel() {
    if (!this.s) return;
    this.cleanup();
    this.app.view.invalidate(this.app.doc.bounds);
  }

  cleanup() {
    const { view } = this.app, s = this.s;
    view.previews.delete(s.layer);
    release(s.base); release(s.preview);
    view.overlays.delete(this);
    this.s = this.drag = null;
    bus.emit('transform', false);
  }

  draw(ctx, view) {
    const s = this.s;
    if (!s) return;
    const scr = pts => pts.map(q => view.toScreen(q.x, q.y));
    ctx.save();
    ctx.strokeStyle = '#84cee0'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5;
    const handle = (q, r = 4.5) => { ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
    if (s.mesh) {
      const P = scr(s.mesh), at = (i, j) => P[j * (N + 1) + i];
      ctx.beginPath();
      for (let k = 0; k <= N; k++) for (let t = 0; t < N; t++) {
        ctx.moveTo(at(t, k).x, at(t, k).y); ctx.lineTo(at(t + 1, k).x, at(t + 1, k).y);
        ctx.moveTo(at(k, t).x, at(k, t).y); ctx.lineTo(at(k, t + 1).x, at(k, t + 1).y);
      }
      ctx.stroke();
      P.forEach(q => handle(q));
    } else {
      const C = scr(this.corners()), M = this.matrix(), { w, h } = s.box;
      ctx.beginPath(); C.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke();
      HANDLES.forEach(([fx, fy]) => { const d = M.transformPoint({ x: fx * w, y: fy * h }); handle(view.toScreen(d.x, d.y)); });
    }
    ctx.restore();
  }
}
