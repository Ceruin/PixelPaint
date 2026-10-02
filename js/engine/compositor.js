import { makeCanvas, drawRect } from '../core/util.js';
import { camAt, planeMatrix } from './camera.js';

// Scratch canvases reused across frames so compositing never allocates.
const pool = [];
export function acquire(w, h) {
  let c = pool.find(c => !c.busy && c.width === w && c.height === h);
  if (!c) {
    for (let i = pool.length; i--;) if (!pool[i].busy) pool.splice(i, 1);
    pool.push(c = makeCanvas(w, h));
  }
  c.busy = true;
  return c;
}
// `stale` is the only region the user may have left dirty (default: all of it), so the next user
// that needs a clear canvas can clear just that.
export const release = (c, stale) => { if (c) { c.busy = false; c.stale = stale ?? { x: 0, y: 0, w: c.width, h: c.height }; } };

// Makes n clean doc-sized scratch canvases ahead of time (idle), so a first stroke doesn't pay to
// allocate them.
export function prewarm(w, h, n = 2) {
  const cs = Array.from({ length: n }, () => acquire(w, h));
  const dot = makeCanvas(1, 1);
  cs.forEach(c => {
    const x = c.getContext('2d');
    if (c.stale) x.clearRect(0, 0, w, h);
    x.globalAlpha = 0; x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(dot, 0, 0); x.globalAlpha = 1;   // allocates the backing store now
    release(c, { x: 0, y: 0, w: 0, h: 0 });
  });
}

// A layer is clipped when it has `clip` and the chain below it bottoms out on a raster layer.
export function isClipped(kids, i) {
  if (kids[i].type !== 'layer' || !kids[i].clip) return false;
  let k = i - 1;
  while (k >= 0 && kids[k].type === 'layer' && kids[k].clip) k--;
  return k >= 0 && kids[k].type === 'layer';
}

function blit(ctx, src, r, alpha, op) {
  ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
  drawRect(ctx, src, r);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

// o.camera: 'all' (exports) draws camera folders through their camera; 'view' (the stage) only those
// with camera view on; otherwise they draw flat, like any folder.
function drawGroup(g, ctx, r, pv, f, o) {
  const kids = g.children, { width: W, height: H } = ctx.canvas;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (!n.visible || isClipped(kids, i)) continue;
    if (n.type === 'filter') {
      // Adjust what's beneath in place; source-atop keeps its alpha, opacity fades the effect.
      const t = acquire(W, H), tc = t.getContext('2d');
      tc.clearRect(r.x, r.y, r.w, r.h);
      tc.filter = n.css; drawRect(tc, ctx.canvas, r); tc.filter = 'none';
      blit(ctx, t, r, n.opacity, 'source-atop');
      release(t);
      continue;
    }
    if (n.type === 'group') {
      const cam = n.camera && (o?.camera === 'all' || (o?.camera === 'view' && n.camera.view));
      if (!cam && n.blend === 'pass' && n.opacity === 1) { drawGroup(n, ctx, r, pv, f, o); continue; }
      const t = acquire(W, H), tc = t.getContext('2d');
      tc.clearRect(r.x, r.y, r.w, r.h);
      if (cam) drawCamera(n, tc, r, pv, f, o); else drawGroup(n, tc, r, pv, f, o);
      blit(ctx, t, r, n.opacity, n.blend === 'pass' ? 'source-over' : n.blend);
      release(t);
      continue;
    }
    const src = pv?.get(n) ?? n.view(f);
    if (!src) continue;
    src.ensure?.(r);   // a lazily-filled stroke preview
    blit(ctx, src, r, n.opacity, n.blend);
    for (let j = i + 1; j < kids.length && kids[j].type === 'layer' && kids[j].clip; j++) {
      const c = kids[j];
      const cs = pv?.get(c) ?? c.view(f);
      if (!c.visible || !cs) continue;
      cs.ensure?.(r);
      const t = acquire(W, H), tc = t.getContext('2d');
      tc.clearRect(r.x, r.y, r.w, r.h);
      drawRect(tc, cs, r);
      tc.globalCompositeOperation = 'destination-in'; tc.globalAlpha = n.opacity;
      drawRect(tc, src, r);
      tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = 1;
      blit(ctx, t, r, c.opacity, c.blend);
      release(t);
    }
  }
}

// A camera folder: each direct child (with any clipping chain on it) is a plane, drawn through the
// camera's transform for its depth. Planes keep their opacity and blend against the planes below.
function drawCamera(g, ctx, r, pv, f, o) {
  const { width: W, height: H } = ctx.canvas, kids = g.children, all = { x: 0, y: 0, w: W, h: H }, at = camAt(g.camera, f);
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (!n.visible || n.type === 'filter' || isClipped(kids, i)) continue;
    let j = i + 1;
    while (n.type === 'layer' && j < kids.length && kids[j].type === 'layer' && kids[j].clip) j++;
    let src, alpha = n.opacity, op = n.blend === 'pass' ? 'source-over' : n.blend, t = null;
    if (n.type === 'layer' && j === i + 1) { src = pv?.get(n) ?? n.view(f); src?.ensure?.(all); }
    else {   // a folder or a clipping chain: flatten it first (untransformed), then place it
      t = acquire(W, H); const tc = t.getContext('2d'); tc.clearRect(0, 0, W, H);
      if (n.type === 'group') drawGroup(n, tc, all, pv, f, o);
      else { drawGroup({ children: kids.slice(i, j) }, tc, all, pv, f, o); alpha = 1; op = 'source-over'; }
      src = t;
    }
    if (src) {
      ctx.setTransform(...planeMatrix(W, H, g.camera, at, n.depth, f));
      ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    release(t);
  }
  ctx.restore();
}

export function renderDoc(doc, ctx, r, previews, frame = doc.frame, o = { camera: 'view' }) {
  ctx.clearRect(r.x, r.y, r.w, r.h);
  drawGroup(doc.root, ctx, r, previews, frame, o);
}

// The finished picture of a frame — through the camera, as it exports (camera: false for the flat drawing).
export function flatten(doc, frame = doc.frame, { camera = true } = {}) {
  const c = makeCanvas(doc.w, doc.h);
  renderDoc(doc, c.getContext('2d'), doc.bounds, null, frame, { camera: camera ? 'all' : false });
  return c;
}
