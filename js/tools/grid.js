// Grid overlays (after Aseprite): a user grid of N px, and a pixel grid that appears when
// zoomed in far enough to see individual pixels. Only the visible part is stroked.
export const gridOverlay = app => ({
  draw(ctx, view) {
    const { doc, opts } = app, pixel = opts.pixelGrid && view.zoom >= 8;
    if (!doc || (!opts.grid && !pixel)) return;
    const inv = view.matrix.inverse(), pts = [[0, 0], [view.cw, 0], [0, view.ch], [view.cw, view.ch]].map(([x, y]) => inv.transformPoint({ x, y }));
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.x)))), x1 = Math.min(doc.w, Math.ceil(Math.max(...pts.map(p => p.x))));
    const y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.y)))), y1 = Math.min(doc.h, Math.ceil(Math.max(...pts.map(p => p.y))));
    ctx.save();
    ctx.setTransform(new DOMMatrix().scale(view.dpr).multiply(view.matrix));
    ctx.lineWidth = 1 / view.zoom;
    const lines = (step, color) => {
      const p = new Path2D();
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { p.moveTo(x, y0); p.lineTo(x, y1); }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { p.moveTo(x0, y); p.lineTo(x1, y); }
      ctx.strokeStyle = color; ctx.stroke(p);
    };
    if (pixel) lines(1, 'rgba(128,128,128,.25)');
    if (opts.grid && opts.gridSize * view.zoom >= 4) lines(opts.gridSize, 'rgba(91,140,255,.55)');
    ctx.restore();
  },
});
