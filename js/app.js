import { bus } from './core/bus.js';
import { local } from './core/storage.js';
import { rgbToHex } from './core/color.js';
import { Viewport } from './engine/viewport.js';
import { symmetryFns } from './engine/symmetry.js';
import { preset } from './engine/presets.js';
import { createTools } from './tools/index.js';
import { CanvasInput } from './input/pointer.js';
import { haptics } from './input/haptics.js';
import { assistOverlay } from './tools/assist.js';

// Application state + controller. UI modules read from it and call its methods; the engine
// never touches the DOM outside the view canvas.
export class App {
  constructor(canvas) {
    this.color = local.get('pp.color', { fg: '#1b1d23', bg: '#ffffff' });
    this.opts = {
      selMode: 'replace', tolerance: 24, contiguous: true, sampleAll: true, transformMode: 'free', uniform: true,
      symmetry: 'none', radial: 6, wrap: false, snapAssist: false, showAssist: true, assistKind: 'ruler',
      shape: 'rect', shapeWidth: 4, shapeFill: false, shapeStroke: true, font: "'Pixelify Sans'", fontSize: 48, bold: false,
      ...local.get('pp.opts', {}),
    };
    this.brushes = { brush: preset('Round'), eraser: preset('Soft Eraser'), smudge: preset('Smudge'), ...local.get('pp.brushes', {}) };
    this.settings = { haptics: true, fingerDraw: true, ...local.get('pp.settings', {}) };
    haptics.enabled = this.settings.haptics;
    this.profile = {};
    this.keys = {};
    this.mode = 'paint';
    this.view = new Viewport(canvas);
    this.tools = createTools(this);
    this.tool = this.tools.brush;
    this.input = new CanvasInput(this, canvas);
    this.tool.activate();
    this.view.overlays.add(assistOverlay(this));
    this.view.wrap = this.opts.wrap;
    bus.on('brush', () => local.set('pp.brushes', this.brushes));
  }

  setDoc(doc) {
    this.tool.interrupt?.();
    this.doc = doc;
    if (this.settings.historyMB) doc.history.maxBytes = this.settings.historyMB * 2 ** 20;
    this.view.setDoc(doc);
    bus.emit('doc', doc);
    bus.emit('layers');
    bus.emit('selection');
    bus.emit('history', doc.history);
  }

  setTool(id) {
    if (this.tool.id === id || !this.tools[id]) return;
    this.tool.deactivate?.();
    this.tool = this.tools[id];
    this.tool.activate?.();
    haptics.pulse(5);
    bus.emit('tool', this.tool);
    this.view.redraw();
  }

  // The brush settings the UI edits: the current paint tool's, else the main brush.
  get brush() { return this.brushes[this.tool.id] ?? this.brushes.brush; }
  brushChanged() { bus.emit('brush', this.brush); this.view.redraw(); }

  setColor(hex, which = 'fg') {
    if (this.color[which] === hex) return;
    this.color[which] = hex;
    local.set('pp.color', this.color);
    bus.emit('color', this.color);
  }
  swapColors() { const { fg, bg } = this.color; this.setColor(bg, 'fg'); this.setColor(fg, 'bg'); }

  setOpt(k, v) { this.opts[k] = v; local.set('pp.opts', this.opts); if (k === 'wrap') this.view.setWrap(v); bus.emit('opts', this.opts); this.view.redraw(); }
  setSetting(k, v) { this.settings[k] = v; local.set('pp.settings', this.settings); haptics.enabled = this.settings.haptics; }

  symmetry() { return symmetryFns(this.opts.symmetry, this.doc.w / 2, this.doc.h / 2, this.opts.radial); }

  pickColor(x, y) {
    if (x < 0 || y < 0 || x >= this.doc.w || y >= this.doc.h) return;
    this.view.compose();
    const d = this.view.comp.getContext('2d').getImageData(x | 0, y | 0, 1, 1).data;
    if (d[3]) this.setColor(rgbToHex(d[0], d[1], d[2]));
  }

  undo() { this.tool.interrupt?.(); if (this.doc.history.undo()) haptics.pulse(10); }
  redo() { this.tool.interrupt?.(); if (this.doc.history.redo()) haptics.pulse(10); }

  toast(msg) { bus.emit('toast', msg); }
}
