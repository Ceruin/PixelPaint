import { makeCanvas, Rect, grab, drawRect } from '../core/util.js';
import { bus } from '../core/bus.js';
import { History } from '../core/history.js';
import { StateCommand, Compound } from './commands.js';
import { Selection } from './selection.js';
import { flatten } from './compositor.js';
import { FILTERS } from './filters.js';

let uid = 1;
class Node {
  constructor(name) { Object.assign(this, { id: uid++, name, visible: true, opacity: 1 }); }
}

const copyOf = src => { const c = makeCanvas(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; };

// Cels per animation frame (Krita / CSP style exposure):
//   canvas    → keyframe drawing
//   BLANK (0) → blank keyframe (shows nothing)
//   undefined → hold: keeps showing the previous keyframe
export const BLANK = 0;

// A raster layer's `canvas` / `ctx` address the current frame's cel, so every tool works per
// frame unchanged; drawing on a held frame turns it into its own keyframe (a copy of the hold).
export class Layer extends Node {
  constructor(doc, name) {
    super(name);
    Object.assign(this, { type: 'layer', blend: 'source-over', locked: false, alphaLock: false, clip: false, version: 0, doc, cels: [] });
  }
  // The drawing visible at frame f (resolving holds), or null.
  view(f = this.doc.frame) {
    for (let i = Math.min(f, this.cels.length - 1); i >= 0; i--) if (this.cels[i] !== undefined) return this.cels[i] || null;
    return null;
  }
  // The keyframe canvas at f; with `create`, makes one (from the held drawing, if any).
  cel(f = this.doc.frame, create = false) {
    const k = this.cels[f];
    if (k || !create) return k || null;
    const held = k === undefined ? this.view(f) : null;
    return (this.cels[f] = held ? copyOf(held) : makeCanvas(this.doc.w, this.doc.h));
  }
  get canvas() { return this.cel(undefined, true); }
  get ctx() { return this.canvas.getContext('2d'); }
}

export class Group extends Node {
  constructor(name) {
    super(name);
    Object.assign(this, { type: 'group', blend: 'pass', collapsed: false, children: [] });
  }
}

// Non-destructive adjustment: re-colours everything composited beneath it (Krita filter layer).
export class FilterLayer extends Node {
  constructor(filter, vals) {
    super(FILTERS[filter].label);
    Object.assign(this, { type: 'filter', filter, vals: { ...vals }, blend: 'source-over' });
  }
  get css() { return FILTERS[this.filter].css(this.vals); }
}

export class Doc {
  constructor(w, h, { bg = '#ffffff', empty = false } = {}) {
    Object.assign(this, { w, h, name: 'Untitled', root: new Group('root'), active: null, count: 0, groups: 0, assistants: [] });
    Object.assign(this, { frames: [{ duration: 100 }], frame: 0, tags: [] });
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
  touch(layer, rect = this.bounds) {
    if (layer) { layer.version++; const c = layer.cels[this.frame]; if (c) c.v = (c.v ?? 0) + 1; }
    bus.emit('dirty', rect);
  }
  setFrame(f) {
    f = Math.max(0, Math.min(this.frames.length - 1, f));
    if (f === this.frame) return;
    this.frame = f;
    bus.emit('frame', f);
    bus.emit('dirty', this.bounds);
  }
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

  // Pixel edits remember their frame; undo/redo jumps there so the change is visible.
  pixelCmd(label, layer, r, before, after, f = this.frame) {
    return new StateCommand(label, c => {
      this.setFrame(f);
      const ctx = layer.cel(f, true).getContext('2d');
      ctx.clearRect(r.x, r.y, r.w, r.h);
      ctx.drawImage(c, r.x, r.y);
      this.touch(layer, r);
    }, before, after, r.w * r.h * 8);
  }
  pixelEdit(label, layer, rect, fn, f = this.frame) {
    const r = Rect.clip(rect, this.w, this.h);
    if (!r) return null;
    const cel = layer.cel(f, true), before = grab(cel, r);
    fn(cel.getContext('2d'), r);
    this.touch(layer, r);
    return this.pixelCmd(label, layer, r, before, grab(cel, r), f);
  }
  editPixels(label, layer, rect, fn) { this.history.push(this.pixelEdit(label, layer, rect, fn)); }

  // Wipes every layer on this frame in one undoable step; a layer named "Background" goes back to
  // plain white rather than transparent.
  clearCanvas() {
    const cmds = this.layers.filter(l => l.view(this.frame)).map(l => this.pixelEdit('Clear Canvas', l, this.bounds, ctx => {
      ctx.clearRect(0, 0, this.w, this.h);
      if (/^background$/i.test(l.name)) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.w, this.h); }
    }));
    if (cmds.some(Boolean)) this.history.push(new Compound('Clear Canvas', cmds));
  }

  // Replaces every cel of every layer (resize, crop, flip, rotate) as one undoable step.
  remap(label, w, h, draw) {
    const state = () => ({ w: this.w, h: this.h, cels: this.layers.map(l => [l, [...l.cels]]) });
    const apply = s => {
      this.w = s.w; this.h = s.h;
      s.cels.forEach(([l, c]) => { l.cels = [...c]; l.version++; });
      this.selection.reset();
      bus.emit('resize', this);
      this.changed();
    };
    const before = state();
    let n = 0;
    const after = { w, h, cels: before.cels.map(([l, cels]) => [l, cels.map(c => { if (!c) return c; n++; const k = makeCanvas(w, h); draw(k.getContext('2d'), c); return k; })]) };
    apply(after);
    this.history.push(new StateCommand(label, apply, before, after, w * h * 4 * n));
  }

  // ---- animation: frames, durations, tags (all undoable) ----
  frameState() {
    return { frames: this.frames.map(f => ({ ...f })), tags: this.tags.map(t => ({ ...t })), frame: this.frame, cels: this.layers.map(l => [l, [...l.cels]]) };
  }
  applyFrames(s) {
    this.frames = s.frames.map(f => ({ ...f }));
    this.tags = s.tags.map(t => ({ ...t }));
    s.cels.forEach(([l, c]) => { l.cels = [...c]; l.version++; });
    this.frame = Math.min(s.frame, this.frames.length - 1);
    bus.emit('frames', this);
    bus.emit('frame', this.frame);
    this.changed();
  }
  editFrames(label, fn) {
    const before = this.frameState();
    this.layers.forEach(l => { l.cels.length = Math.max(l.cels.length, this.frames.length); });
    fn();
    const after = this.frameState();
    this.history.push(new StateCommand(label, s => this.applyFrames(s), before, after));
    this.applyFrames(after);
  }
  addFrame(dup = false) {
    this.editFrames(dup ? 'Duplicate Frame' : 'New Frame', () => {
      const i = this.frame + 1, active = this.activeLayer;
      this.frames.splice(i, 0, { duration: this.frames[this.frame].duration });
      for (const l of this.layers) {
        const src = l.cels[i - 1];
        l.cels.splice(i, 0, dup ? (src ? copyOf(src) : undefined) : l === active ? BLANK : undefined);
      }
      for (const t of this.tags) { if (t.from >= i) { t.from++; t.to++; } else if (t.to >= i - 1) t.to++; }
      this.frame = i;
    });
  }
  deleteFrame(i = this.frame) {
    if (this.frames.length < 2) return;
    this.editFrames('Delete Frame', () => {
      this.frames.splice(i, 1);
      for (const l of this.layers) l.cels.splice(i, 1);
      this.tags = this.tags.filter(t => !(t.from === i && t.to === i)).map(t => ({ ...t, from: t.from > i ? t.from - 1 : t.from, to: t.to >= i ? t.to - 1 : t.to }));
      this.frame = Math.min(i, this.frames.length - 1);
    });
  }
  moveFrame(from, to) {
    if (from === to) return;
    this.editFrames('Move Frame', () => {
      this.frames.splice(to, 0, ...this.frames.splice(from, 1));
      for (const l of this.layers) l.cels.splice(to, 0, ...l.cels.splice(from, 1));
      this.frame = to;
    });
  }
  setDuration(ms, all = false) {
    this.editFrames('Frame Duration', () => this.frames.forEach((f, i) => { if (all || i === this.frame) f.duration = ms; }));
  }
  clearCel(layer) { this.editFrames('Clear Cel', () => { layer.cels[this.frame] = BLANK; }); }
  holdCel(layer) { if (this.frame) this.editFrames('Hold Previous', () => { layer.cels[this.frame] = undefined; }); }
  addTag(from, to) {
    const colors = ['#5b8cff', '#ff3b47', '#17c06b', '#ffd23f', '#a445ff', '#ff8a3d'];
    this.editFrames('New Tag', () => this.tags.push({ name: `Tag ${this.tags.length + 1}`, from, to, color: colors[this.tags.length % colors.length], dir: 'forward' }));
  }
  editTag(i, props) { this.editFrames('Edit Tag', () => Object.assign(this.tags[i], props)); }
  removeTag(i) { this.editFrames('Delete Tag', () => this.tags.splice(i, 1)); }

  // ---- layer operations ----
  insert(node, ref = this.active) {
    const p = (ref && this.parentOf(ref)) || this.root;
    const i = ref ? p.children.indexOf(ref) + 1 : p.children.length;
    p.children.splice(i, 0, node);
  }

  addLayer(name, record = true) {
    const l = new Layer(this, name ?? `Layer ${++this.count}`);
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

  addFilterLayer(filter) {
    const f = FILTERS[filter], l = new FilterLayer(filter, Object.fromEntries(f.params.map(p => [p[0], p[4]])));
    this.editTree('New Filter Layer', () => { this.insert(l); this.active = l; });
    return l;
  }

  clone(n) {
    if (n.type === 'filter') return Object.assign(new FilterLayer(n.filter, n.vals), { visible: n.visible, opacity: n.opacity });
    const c = n.type === 'group' ? new Group(n.name) : new Layer(this, n.name);
    for (const k of ['visible', 'opacity', 'blend', 'locked', 'alphaLock', 'clip', 'collapsed']) if (k in n) c[k] = n[k];
    if (n.type === 'group') c.children = n.children.map(k => this.clone(k));
    else c.cels = n.cels.map(k => (k ? copyOf(k) : k));
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
    const cur = this.frame, px = this.frames.map((_, f) => (f === 0 || layer.cels[f] !== undefined || below.cels[f] !== undefined) && layer.view(f) && this.pixelEdit('Merge', below, this.bounds, ctx => {
      let src = layer.view(f);
      if (layer.clip) {
        src = copyOf(src);
        const c = src.getContext('2d');
        c.globalCompositeOperation = 'destination-in';
        c.drawImage(below.view(f) ?? makeCanvas(1, 1), 0, 0);
      }
      ctx.globalAlpha = layer.opacity; ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(src, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }, f));
    this.frame = cur;
    const tree = this.treeCmd('', () => { p.children.splice(i, 1); this.active = below; });
    this.history.push(new Compound('Merge Down', [...px, tree]));
  }

  flatten() {
    const cels = this.frames.map((_, f) => flatten(this, f));
    this.editTree('Flatten', () => {
      const l = new Layer(this, 'Background');
      l.cels = cels;
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
