import { h, icon, slider, select, segmented, toggle } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';
import { TOOL_META } from '../tools/index.js';
import { SYMMETRY } from '../engine/symmetry.js';
import { SMOOTHING } from '../engine/brush.js';
import { SHAPES } from '../tools/shape.js';
import { FONTS } from '../tools/text.js';
import { sizeToPos, posToSize } from './brushPanel.js';
import { strokePreview } from '../engine/brush.js';

const preview = b => { const c = h('canvas', { width: 140, height: 40 }); requestAnimationFrame(() => strokePreview(b, c, getComputedStyle(document.body).getPropertyValue('--text').trim())); return c; };

const PAINT = ['brush', 'eraser', 'smudge'], SELECT = ['marquee', 'ellipse', 'lasso', 'wand'];
const btn = (label, id) => h('button.btn.sm', { type: 'button', 'data-action': id, 'data-tip': label, onclick: () => actions.run(id) }, actions.get(id)?.icon && icon(actions.get(id).icon), label);

// Context-sensitive tool options. Own edits are guarded so a drag isn't rebuilt mid-gesture.
export function optionsBar(app, el, openBrushes) {
  let busy = false;
  const guard = fn => v => { busy = true; fn(v); busy = false; };
  const setBrush = k => guard(v => { app.brush[k] = v; app.brushChanged(); });
  const setOpt = k => guard(v => app.setOpt(k, v));
  const mini = o => { const s = slider(o); s.el.classList.add('mini'); return s.el; };

  const render = () => {
    const t = app.tool.id, o = app.opts, b = app.brush;
    const parts = [h('span.opt-tool', {}, icon(t), TOOL_META.find(m => m[0] === t)[1])];
    if (PAINT.includes(t)) parts.push(
      h('button.brush-name', { type: 'button', 'data-tip': 'Brush library', onclick: openBrushes }, preview(b), b.name, icon('chevron')),
      mini({ label: 'Size', value: sizeToPos(b.size), step: 0.1, fmt: () => `${app.brush.size}px`, onInput: v => setBrush('size')(posToSize(v)) }),
      mini({ label: 'Opacity', value: b.opacity * 100, fmt: v => `${Math.round(v)}%`, onInput: v => setBrush('opacity')(v / 100) }),
      mini({ label: 'Flow', value: b.flow * 100, fmt: v => `${Math.round(v)}%`, onInput: v => setBrush('flow')(v / 100) }),
      h('label.inline', { 'data-tip': 'Smoothing method' }, icon('pen'), select(SMOOTHING, b.smoothMode ?? 'basic', v => { app.brush.smoothMode = v; app.brushChanged(); })),
      mini({ label: 'Smoothing', max: 94, value: b.smoothing * 100, fmt: v => `${Math.round(v)}%`, onInput: v => setBrush('smoothing')(v / 100) }),
      h('label.inline', { 'data-tip': 'Symmetry' }, icon('symmetry'), select(SYMMETRY, o.symmetry, v => { app.setOpt('symmetry', v); render(); })),
      o.symmetry === 'radial' && mini({ label: 'Axes', min: 2, max: 16, value: o.radial, onInput: setOpt('radial') }),
      app.doc?.assistants.length > 0 && toggle('Snap to assistants', o.snapAssist, v => app.setOpt('snapAssist', v)),
      toggle('Wrap-around', o.wrap, v => app.setOpt('wrap', v)));
    if (t === 'shape') parts.push(
      segmented(SHAPES.map(([id, label, ic]) => [id, label, ic]), o.shape, v => app.setOpt('shape', v)),
      mini({ label: 'Line width', min: 1, max: 60, value: o.shapeWidth, fmt: v => `${v}px`, onInput: setOpt('shapeWidth') }),
      toggle('Outline', o.shapeStroke, v => app.setOpt('shapeStroke', v)),
      toggle('Fill (background color)', o.shapeFill, v => app.setOpt('shapeFill', v)));
    if (t === 'text') parts.push(
      h('label.inline', {}, icon('text'), select(FONTS, o.font, v => app.setOpt('font', v))),
      mini({ label: 'Size', min: 8, max: 400, value: o.fontSize, fmt: v => `${v}px`, onInput: setOpt('fontSize') }),
      toggle('Bold', o.bold, v => app.setOpt('bold', v)),
      h('span.muted', {}, 'Click the canvas to type · Ctrl+Enter to place'));
    if (t === 'assist') parts.push(
      segmented([['ruler', 'Ruler', 'ruler'], ['vanish', 'Vanishing point', 'navigator']], o.assistKind, v => app.setOpt('assistKind', v), true),
      toggle('Snap strokes', o.snapAssist, v => app.setOpt('snapAssist', v)),
      toggle('Show', o.showAssist, v => app.setOpt('showAssist', v)),
      btn('Clear all', 'assist.clear'),
      h('span.muted', {}, 'Drag to add · drag handles to move · Alt-click to delete'));
    if (SELECT.includes(t)) parts.push(
      segmented([['replace', 'New', 'select'], ['add', 'Add', 'plus'], ['sub', 'Subtract', 'minus']], o.selMode, v => app.setOpt('selMode', v), true),
      btn('Select all', 'sel.all'), btn('Deselect', 'sel.none'), btn('Invert', 'sel.invert'), btn('Feather…', 'sel.feather'));
    if (t === 'wand' || t === 'fill') parts.push(
      mini({ label: 'Tolerance', value: o.tolerance, fmt: v => `${v}%`, onInput: setOpt('tolerance') }),
      toggle('Contiguous', o.contiguous, v => app.setOpt('contiguous', v)),
      toggle('Sample all layers', o.sampleAll, v => app.setOpt('sampleAll', v)));
    if (t === 'transform') parts.push(
      segmented([['free', 'Free', 'transform'], ['warp', 'Warp', 'wrap']], o.transformMode, v => { app.setOpt('transformMode', v); app.tools.transform.setWarp(v === 'warp'); }, true),
      toggle('Proportional corners', o.uniform, v => app.setOpt('uniform', v)),
      btn('Apply', 'tool.commit'), btn('Cancel', 'tool.cancel'));
    if (t === 'hand' || t === 'zoom') parts.push(btn('Fit', 'view.fit'), btn('100%', 'view.actual'), btn('Reset rotation', 'view.resetRot'));
    el.replaceChildren(...parts.filter(Boolean));
  };
  bus.on('tool', render);
  bus.on('mode', render);
  bus.on('brush', () => !busy && render());
  render();
}
