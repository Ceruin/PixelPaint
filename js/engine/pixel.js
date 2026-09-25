import { Rect } from '../core/util.js';

// Pixel pencil: whole square pixels, no anti-aliasing. Lines between samples are Bresenham, and
// "pixel-perfect" removes the L-shaped corner pixels a freehand line leaves (as in Aseprite).
// Same interface as BrushEngine, so PaintTool handles preview, selection, alpha lock and undo.
export class PixelEngine {
  constructor({ target, color, size = 1, perfect = true, symmetry }) {
    Object.assign(this, { ctx: target, size: Math.max(1, Math.round(size)), perfect, sym: symmetry, dirty: null, path: [] });
    target.fillStyle = color;
  }
  cell(p) { const o = (this.size - 1) / 2; return [Math.floor(p.x - o), Math.floor(p.y - o)]; }

  begin(p) { this.path = []; this.add(this.cell(p)); }
  move(p) {
    const [x1, y1] = this.cell(p), last = this.path.at(-1);
    if (!last) return this.add([x1, y1]);
    let [x, y] = last;
    const dx = Math.abs(x1 - x), dy = -Math.abs(y1 - y), sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
    let err = dx + dy;
    while (x !== x1 || y !== y1) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      this.add([x, y]);
    }
  }
  end(p) { if (p) this.move(p); }

  add(c) {
    const path = this.path, n = path.length;
    if (n && path[n - 1][0] === c[0] && path[n - 1][1] === c[1]) return;
    // pixel-perfect: a, b, c where b is the elbow of an L — drop b
    if (this.perfect && n >= 2) {
      const a = path[n - 2], b = path[n - 1];
      if ((a[0] === b[0] || a[1] === b[1]) && (b[0] === c[0] || b[1] === c[1]) && a[0] !== c[0] && a[1] !== c[1]) { this.plot(b, true); path.pop(); }
    }
    path.push(c);
    if (path.length > 3) path.shift();
    this.plot(c);
  }
  plot([x, y], clear = false) {
    const s = this.size;
    for (const f of this.sym) {
      const [cx, cy] = f(x + s / 2, y + s / 2, 0), X = Math.round(cx - s / 2), Y = Math.round(cy - s / 2);
      clear ? this.ctx.clearRect(X, Y, s, s) : this.ctx.fillRect(X, Y, s, s);
      this.dirty = Rect.union(this.dirty, { x: X, y: Y, w: s, h: s });
    }
  }
  takeDirty() { const d = this.dirty; this.dirty = null; return d; }
}
