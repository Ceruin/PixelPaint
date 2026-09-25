import { makeCanvas, grab } from '../core/util.js';
import { bus } from '../core/bus.js';
import { StateCommand } from './commands.js';

// Selection = doc-sized alpha mask. Bounds and the marching-ants outline are derived on change.
export class Selection {
  constructor(doc) { this.doc = doc; this.reset(); }

  reset() {
    this.mask = makeCanvas(this.doc.w, this.doc.h);
    this.ctx = this.mask.getContext('2d', { willReadFrequently: true });
    Object.assign(this, { active: false, bounds: null, path: null });
    bus.emit('selection');
  }

  get clip() { return this.active ? this.mask : null; }
  state() { return { mask: this.active ? grab(this.mask, this.doc.bounds) : null }; }
  restore(s) {
    this.ctx.clearRect(0, 0, this.doc.w, this.doc.h);
    if (s.mask) this.ctx.drawImage(s.mask, 0, 0);
    this.update();
  }

  edit(label, fn, push = true) {
    const was = this.active, before = this.state();
    fn(this.ctx);
    this.update();
    if (!was && !this.active) return null;
    const { w, h } = this.doc, cmd = new StateCommand(label, s => this.restore(s), before, this.state(), w * h * 8);
    if (push) this.doc.history.push(cmd);
    return cmd;
  }

  apply(label, mode, draw) {
    this.edit(label, c => {
      if (mode === 'replace' || !this.active) c.clearRect(0, 0, this.doc.w, this.doc.h);
      c.globalCompositeOperation = mode === 'sub' ? 'destination-out' : 'source-over';
      c.fillStyle = '#fff';
      draw(c);
      c.globalCompositeOperation = 'source-over';
    });
  }

  all() { this.apply('Select All', 'replace', c => c.fillRect(0, 0, this.doc.w, this.doc.h)); }
  none() { if (this.active) this.edit('Deselect', c => c.clearRect(0, 0, this.doc.w, this.doc.h)); }
  invert() {
    this.edit('Invert Selection', c => {
      c.globalCompositeOperation = 'xor'; c.fillStyle = '#fff';
      c.fillRect(0, 0, this.doc.w, this.doc.h);
      c.globalCompositeOperation = 'source-over';
    });
  }
  feather(radius) {
    if (!this.active) return;
    this.edit('Feather', c => {
      const t = grab(this.mask, this.doc.bounds);
      c.clearRect(0, 0, this.doc.w, this.doc.h);
      c.filter = `blur(${radius}px)`; c.drawImage(t, 0, 0); c.filter = 'none';
    });
  }

  update() {
    const { w, h } = this.doc, d = this.ctx.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0, y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      const v = d[i * 4 + 3];
      if (!v) continue;
      if (v >= 128) a[i] = 1;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y;
    }
    this.active = x1 >= 0;
    this.bounds = this.active ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
    this.path = this.active ? traceEdges(a, w, this.bounds) : null;
    bus.emit('selection');
  }
}

// Pixel-boundary outline of the mask as merged horizontal/vertical runs.
function traceEdges(a, w, b) {
  const p = new Path2D(), X0 = b.x, X1 = b.x + b.w, Y0 = b.y, Y1 = b.y + b.h;
  const at = (x, y) => (x >= X0 && x < X1 && y >= Y0 && y < Y1 ? a[y * w + x] : 0);
  for (let y = Y0; y <= Y1; y++) {
    let s = -1;
    for (let x = X0; x <= X1; x++) {
      if (x < X1 && at(x, y - 1) !== at(x, y)) { if (s < 0) s = x; }
      else if (s >= 0) { p.moveTo(s, y); p.lineTo(x, y); s = -1; }
    }
  }
  for (let x = X0; x <= X1; x++) {
    let s = -1;
    for (let y = Y0; y <= Y1; y++) {
      if (y < Y1 && at(x - 1, y) !== at(x, y)) { if (s < 0) s = y; }
      else if (s >= 0) { p.moveTo(x, s); p.lineTo(x, y); s = -1; }
    }
  }
  return p;
}
