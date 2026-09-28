import { Rect, DEG } from '../core/util.js';

// Pixel pencil: whole square pixels, no anti-aliasing. Lines between samples are Bresenham, and
// "pixel-perfect" removes the L-shaped corner pixels a freehand line leaves (as in Aseprite).
// Same interface as BrushEngine, so PaintTool handles preview, selection, alpha lock and undo.
// On a turned view (`turn` degrees, `flip` mirrored) the square stays upright on screen.
export class PixelEngine {
  constructor({ target, color, size = 1, perfect = true, symmetry, dither = false, turn = 0, flip = false }) {
    Object.assign(this, { ctx: target, size: Math.max(1, Math.round(size)), perfect, sym: symmetry, dither, dirty: null, path: [] });
    this.rows = stampRows(this.size, turn % 90 ? turn * DEG : 0, flip);
    const top = this.rows[0][0], left = Math.min(...this.rows.map(r => r[1])), right = Math.max(...this.rows.map(r => r[2]));
    this.box = { x: left, y: top, w: right - left + 1, h: this.rows.length };
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
    // pixel-perfect: a, b, c where b is the elbow of an L — drop b (1px only: a wider elbow overlaps a and c)
    if (this.perfect && this.size === 1 && n >= 2) {
      const a = path[n - 2], b = path[n - 1];
      if ((a[0] === b[0] || a[1] === b[1]) && (b[0] === c[0] || b[1] === c[1]) && a[0] !== c[0] && a[1] !== c[1]) { this.plot(b, true); path.pop(); }
    }
    path.push(c);
    if (path.length > 3) path.shift();
    this.plot(c);
  }
  plot([x, y], clear = false) {
    const s = this.size, b = this.box;
    for (const f of this.sym) {
      const [cx, cy] = f(x + s / 2, y + s / 2, 0), X = Math.round(cx - s / 2), Y = Math.round(cy - s / 2);
      for (const [j, i0, i1] of this.rows) {
        if (clear) this.ctx.clearRect(X + i0, Y + j, i1 - i0 + 1, 1);
        else if (this.dither) { for (let i = i0; i <= i1; i++) if (!((X + i + Y + j) & 1)) this.ctx.fillRect(X + i, Y + j, 1, 1); }   // checkerboard, fixed to the canvas grid
        else this.ctx.fillRect(X + i0, Y + j, i1 - i0 + 1, 1);
      }
      this.dirtyLast = { x: X + b.x, y: Y + b.y, w: b.w, h: b.h };
      this.dirty = Rect.union(this.dirty, this.dirtyLast);
      if (this.drawn && !clear) this.drawn.push(this.dirtyLast);
    }
  }
  takeDirty() { const d = this.dirty; this.dirty = null; return d; }
}

// The pencil's square as row spans [row, first, last] (offsets from the stamp's corner): the canvas
// pixels whose centres fall inside a size-wide square turned by `a` radians against the canvas.
function stampRows(s, a, flip) {
  const c = Math.cos(a), sn = Math.sin(a), h = s / 2, m = Math.ceil(s * 0.21) + 1, rows = [];
  for (let j = -m; j < s + m; j++) {
    let i0 = null, i1 = null;
    for (let i = -m; i < s + m; i++) {
      const dx = (i + 0.5 - h) * (flip ? -1 : 1), dy = j + 0.5 - h;
      if (Math.abs(dx * c - dy * sn) <= h && Math.abs(dx * sn + dy * c) <= h) { i0 ??= i; i1 = i; }
    }
    if (i0 !== null) rows.push([j, i0, i1]);
  }
  return rows;
}

// Pixel line / rectangle / ellipse from the press point to the pointer, redrawn as it moves (the
// last outline is cleared from the stroke buffer first). Filled or outline, at the pencil's size.
export class PixelShapeEngine extends PixelEngine {
  constructor(o) { super(o); Object.assign(this, { kind: ['line', 'rect', 'ellipse'].includes(o.kind) ? o.kind : 'rect', filled: !!o.filled, perfect: false, drawn: [] }); }
  begin(p) { this.a = this.cell(p); this.draw(this.a); }
  move(p) { this.draw(this.cell(p)); }
  end(p) { if (p) this.move(p); }
  draw(b) {
    for (const r of this.drawn) { this.ctx.clearRect(r.x, r.y, r.w, r.h); this.dirty = Rect.union(this.dirty, r); }
    this.drawn = [];
    const [ax, ay] = this.a, [bx, by] = b, x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    if (this.kind === 'line') { this.path = []; this.add([ax, ay]); PixelEngine.prototype.move.call(this, { x: bx + (this.size - 1) / 2, y: by + (this.size - 1) / 2 }); return; }
    if (this.kind === 'rect') {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.filled || x === x0 || x === x1 || y === y0 || y === y1) this.plot([x, y]);
      return;
    }
    // ellipse: a span per row, and for the outline the parts of each span its neighbours don't cover
    const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, rx = (x1 - x0 + 1) / 2, ry = (y1 - y0 + 1) / 2, spans = [];
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) / ry, dx = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
      let a = Math.ceil(cx - dx - 0.5), z = Math.floor(cx + dx - 0.5);
      if (a > z) a = z = Math.round(cx - 0.5);
      spans.push([a, z]);
    }
    spans.forEach(([a, z], i) => {
      const y = y0 + i, up = spans[i - 1], dn = spans[i + 1];
      if (this.filled || !up || !dn) { for (let x = a; x <= z; x++) this.plot([x, y]); return; }
      // reach over to the more inset neighbour so the outline never breaks on the diagonals
      const l = Math.min(z, Math.max(a, Math.max(up[0], dn[0]) - 1)), r = Math.max(a, Math.min(z, Math.min(up[1], dn[1]) + 1));
      for (let x = a; x <= l; x++) this.plot([x, y]);
      for (let x = Math.max(r, l + 1); x <= z; x++) this.plot([x, y]);
    });
  }
}
