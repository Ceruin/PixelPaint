import { makeCanvas, Rect, grab, drawRect } from '../core/util.js';
import { bus } from '../core/bus.js';
import { History } from '../core/history.js';
import { StateCommand, Compound } from './commands.js';
import { Selection } from './selection.js';
import { flatten } from './compositor.js';

let uid = 1;
class Node {
  constructor(name) { Object.assign(this, { id: uid++, name, visible: true, opacity: 1 }); }
}

export class Layer extends Node {
  constructor(w, h, name) {
    super(name);
    Object.assign(this, { type: 'layer', blend: 'source-over', locked: false, alphaLock: false, clip: false, version: 0 });
    this.setCanvas(makeCanvas(w, h));
  }
  setCanvas(c) { this.canvas = c; this.ctx = c.getContext('2d'); this.version++; }
}

export class Group extends Node {
  constructor(name) {
    super(name);
    Object.assign(this, { type: 'group', blend: 'pass', collapsed: false, children: [] });
  }
}

export class Doc {
  constructor(w, h, { bg = '#ffffff', empty = false } = {}) {
    Object.assign(this, { w, h, name: 'Untitled', root: new Group('root'), active: null, count: 0, groups: 0 });
    this.history = new History();
    this.selection = new Selection(this);
    if (empty) return;
    const l = this.addLayer(bg ? 'Background' : null, false);
    if (bg) { l.ctx.fillStyle = bg; l.ctx.fillRect(0, 0, w, h); }
  }

  get bounds() { return { x: 0, y: 0, w: this.w, h: this.h }; }
  *nodes(g = this.root) { for (const n of g.children) { yield n; if (n.type === 'group') yield* this.nodes(n); } }
  get layers() { return [...this.nodes()].filter(n => n.type === 'layer'); }
  get activeLayer() { return this.active?.type === 'layer' ? this.active : null; }
  parentOf(node, g = this.root) {
    for (const n of g.children) {
      if (n === node) return g;
      const p = n.type === 'group' && this.parentOf(node, n);
      if (p) return p;
    }
    return null;
  }

  setActive(n) { this.active = n; bus.emit('layers'); }
  touch(layer, rect = this.bounds) { if (layer) layer.version++; bus.emit('dirty', rect); }
  changed() { bus.emit('layers'); bus.emit('dirty', this.bounds); }

  // ---- undoable primitives ----
  snapshot() {
    const tree = new Map();
    const visit = g => { tree.set(g, [...g.children]); g.children.forEach(n => n.type === 'group' && visit(n)); };
    visit(this.root);
    return { tree, active: this.active };
  }
  restore(s) { for (const [g, kids] of s.tree) g.children = [...kids]; this.active = s.active; this.changed(); }

  treeCmd(label, fn) {
    const before = this.snapshot();
    fn();
    this.changed();
    return new StateCommand(label, s => this.restore(s), before, this.snapshot());
  }
  editTree(label, fn) { this.history.push(this.treeCmd(label, fn)); }

  editProps(label, node, props, before = Object.fromEntries(Object.keys(props).map(k => [k, node[k]]))) {
    Object.assign(node, props);
    this.changed();
    this.history.push(new StateCommand(label, s => { Object.assign(node, s); this.changed(); }, before, { ...props }));
  }

  pixelCmd(label, layer, r, before, after) {
    return new StateCommand(label, c => {
      layer.ctx.clearRect(r.x, r.y, r.w, r.h);
      layer.ctx.drawImage(c, r.x, r.y);
      this.touch(layer, r);
    }, before, after, r.w * r.h * 8);
  }
  pixelEdit(label, layer, rect, fn) {
    const r = Rect.clip(rect, this.w, this.h);
    if (!r) return null;
    const before = grab(layer.canvas, r);
    fn(layer.ctx, r);
    this.touch(layer, r);
    return this.pixelCmd(label, layer, r, before, grab(layer.canvas, r));
  }
  editPixels(label, layer, rect, fn) { this.history.push(this.pixelEdit(label, layer, rect, fn)); }

  // Replaces every layer canvas (resize, crop, flip, rotate) as one undoable step.
  remap(label, w, h, draw) {
    const state = () => ({ w: this.w, h: this.h, canvases: this.layers.map(l => [l, l.canvas]) });
    const apply = s => {
      this.w = s.w; this.h = s.h;
      s.canvases.forEach(([l, c]) => l.setCanvas(c));
      this.selection.reset();
      bus.emit('resize', this);
      this.changed();
    };
    const before = state();
    const after = { w, h, canvases: before.canvases.map(([l, c]) => { const n = makeCanvas(w, h); draw(n.getContext('2d'), c); return [l, n]; }) };
    apply(after);
    this.history.push(new StateCommand(label, apply, before, after, w * h * 4 * before.canvases.length));
  }

  // ---- layer operations ----
  insert(node, ref = this.active) {
    const p = (ref && this.parentOf(ref)) || this.root;
    const i = ref ? p.children.indexOf(ref) + 1 : p.children.length;
    p.children.splice(i, 0, node);
  }

  addLayer(name, record = true) {
    const l = new Layer(this.w, this.h, name ?? `Layer ${++this.count}`);
    const add = () => { this.insert(l); this.active = l; };
    record ? this.editTree('New Layer', add) : add();
    return l;
  }

  addGroup(wrap = false) {
    const g = new Group(`Group ${++this.groups}`), n = this.active;
    this.editTree(wrap ? 'Group Layer' : 'New Group', () => {
      if (wrap && n) { const p = this.parentOf(n); p.children.splice(p.children.indexOf(n), 1, g); g.children.push(n); }
      else this.insert(g);
      this.active = g;
    });
  }

  clone(n) {
    const c = n.type === 'group' ? new Group(n.name) : new Layer(this.w, this.h, n.name);
    for (const k of ['visible', 'opacity', 'blend', 'locked', 'alphaLock', 'clip', 'collapsed']) if (k in n) c[k] = n[k];
    if (n.type === 'group') c.children = n.children.map(k => this.clone(k));
    else c.ctx.drawImage(n.canvas, 0, 0);
    return c;
  }

  duplicate() {
    const n = this.active;
    if (!n) return;
    const c = this.clone(n);
    c.name = `${n.name} copy`;
    this.editTree('Duplicate', () => { this.insert(c, n); this.active = c; });
  }

  remove(n = this.active) {
    const p = n && this.parentOf(n);
    if (!p || (p === this.root && p.children.length === 1)) return;
    this.editTree('Delete Layer', () => {
      const i = p.children.indexOf(n);
      p.children.splice(i, 1);
      this.active = p.children[Math.max(0, i - 1)] ?? (p === this.root ? null : p);
    });
  }

  contains(g, n) { for (const k of this.nodes(g)) if (k === n) return true; return false; }

  moveNode(node, parent, index) {
    if (node === parent || (node.type === 'group' && this.contains(node, parent))) return;
    this.editTree('Move Layer', () => {
      const p = this.parentOf(node), i = p.children.indexOf(node);
      p.children.splice(i, 1);
      if (p === parent && i < index) index--;
      parent.children.splice(index, 0, node);
    });
  }

  mergeDown(layer = this.activeLayer) {
    const p = layer && this.parentOf(layer), i = p?.children.indexOf(layer), below = p?.children[i - 1];
    if (!below || below.type !== 'layer') return;
    const px = this.pixelEdit('Merge', below, this.bounds, ctx => {
      let src = layer.canvas;
      if (layer.clip) {
        src = makeCanvas(this.w, this.h);
        const c = src.getContext('2d');
        c.drawImage(layer.canvas, 0, 0);
        c.globalCompositeOperation = 'destination-in';
        c.drawImage(below.canvas, 0, 0);
      }
      ctx.globalAlpha = layer.opacity; ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(src, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    });
    const tree = this.treeCmd('', () => { p.children.splice(i, 1); this.active = below; });
    this.history.push(new Compound('Merge Down', [px, tree]));
  }

  flatten() {
    const img = flatten(this);
    this.editTree('Flatten', () => {
      const l = new Layer(this.w, this.h, 'Background');
      l.ctx.drawImage(img, 0, 0);
      this.root.children = [l];
      this.active = l;
    });
  }

  // Region of the active layer (masked by the selection), for copy / cut / transform.
  extract(layer, sel = this.selection) {
    const r = sel.active ? sel.bounds : this.bounds;
    const c = makeCanvas(r.w, r.h), ctx = c.getContext('2d');
    ctx.drawImage(layer.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    if (sel.active) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(sel.mask, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); }
    return { canvas: c, x: r.x, y: r.y };
  }

  clearArea(layer, label = 'Clear') {
    const sel = this.selection;
    this.editPixels(label, layer, sel.bounds ?? this.bounds, (ctx, r) => {
      if (!sel.active) return ctx.clearRect(r.x, r.y, r.w, r.h);
      ctx.globalCompositeOperation = 'destination-out';
      drawRect(ctx, sel.mask, r);
      ctx.globalCompositeOperation = 'source-over';
    });
  }

  fillArea(layer, color) {
    const sel = this.selection;
    this.editPixels('Fill', layer, sel.bounds ?? this.bounds, (ctx, r) => {
      const t = makeCanvas(this.w, this.h), tc = t.getContext('2d');
      tc.fillStyle = color; tc.fillRect(r.x, r.y, r.w, r.h);
      if (sel.active) { tc.globalCompositeOperation = 'destination-in'; drawRect(tc, sel.mask, r); }
      ctx.globalCompositeOperation = layer.alphaLock ? 'source-atop' : 'source-over';
      drawRect(ctx, t, r);
      ctx.globalCompositeOperation = 'source-over';
    });
  }
}
