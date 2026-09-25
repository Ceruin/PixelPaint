import { makeCanvas, drawRect } from '../core/util.js';

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
export const release = c => { if (c) c.busy = false; };

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

function drawGroup(g, ctx, r, pv, f) {
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
      if (n.blend === 'pass' && n.opacity === 1) { drawGroup(n, ctx, r, pv, f); continue; }
      const t = acquire(W, H), tc = t.getContext('2d');
      tc.clearRect(r.x, r.y, r.w, r.h);
      drawGroup(n, tc, r, pv, f);
      blit(ctx, t, r, n.opacity, n.blend === 'pass' ? 'source-over' : n.blend);
      release(t);
      continue;
    }
    const src = pv?.get(n) ?? n.view(f);
    if (!src) continue;
    blit(ctx, src, r, n.opacity, n.blend);
    for (let j = i + 1; j < kids.length && kids[j].type === 'layer' && kids[j].clip; j++) {
      const c = kids[j];
      const cs = pv?.get(c) ?? c.view(f);
      if (!c.visible || !cs) continue;
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

export function renderDoc(doc, ctx, r, previews, frame = doc.frame) {
  ctx.clearRect(r.x, r.y, r.w, r.h);
  drawGroup(doc.root, ctx, r, previews, frame);
}

export function flatten(doc, frame = doc.frame) {
  const c = makeCanvas(doc.w, doc.h);
  renderDoc(doc, c.getContext('2d'), doc.bounds, null, frame);
  return c;
}
