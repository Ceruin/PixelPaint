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

function drawGroup(g, ctx, r, pv) {
  const kids = g.children, { width: W, height: H } = ctx.canvas;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (!n.visible || isClipped(kids, i)) continue;
    if (n.type === 'group') {
      if (n.blend === 'pass' && n.opacity === 1) { drawGroup(n, ctx, r, pv); continue; }
      const t = acquire(W, H), tc = t.getContext('2d');
      tc.clearRect(r.x, r.y, r.w, r.h);
      drawGroup(n, tc, r, pv);
      blit(ctx, t, r, n.opacity, n.blend === 'pass' ? 'source-over' : n.blend);
      release(t);
      continue;
    }
    const src = pv?.get(n) ?? n.canvas;
    blit(ctx, src, r, n.opacity, n.blend);
    for (let j = i + 1; j < kids.length && kids[j].type === 'layer' && kids[j].clip; j++) {
      const c = kids[j];
      if (!c.visible) continue;
      const t = acquire(W, H), tc = t.getContext('2d');
      tc.clearRect(r.x, r.y, r.w, r.h);
      drawRect(tc, pv?.get(c) ?? c.canvas, r);
      tc.globalCompositeOperation = 'destination-in'; tc.globalAlpha = n.opacity;
      drawRect(tc, src, r);
      tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = 1;
      blit(ctx, t, r, c.opacity, c.blend);
      release(t);
    }
  }
}

export function renderDoc(doc, ctx, r, previews) {
  ctx.clearRect(r.x, r.y, r.w, r.h);
  drawGroup(doc.root, ctx, r, previews);
}

export function flatten(doc) {
  const c = makeCanvas(doc.w, doc.h);
  renderDoc(doc, c.getContext('2d'), doc.bounds);
  return c;
}
