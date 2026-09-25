import { h, icon, slider, select, segmented, toggle } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';
import { TOOL_META } from '../tools/index.js';
import { SYMMETRY } from '../engine/symmetry.js';
import { sizeToPos, posToSize } from './brushPanel.js';

const PAINT = ['brush', 'eraser', 'smudge'], SELECT = ['marquee', 'ellipse', 'lasso', 'wand'];
const btn = (label, id) => h('button.btn.sm', { type: 'button', 'data-action': id, 'data-tip': label, onclick: () => actions.run(id) }, label);

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
      h('button.brush-name', { type: 'button', 'data-tip': 'Brush library', onclick: openBrushes }, b.name, icon('chevron')),
      mini({ label: 'Size', value: sizeToPos(b.size), step: 0.1, fmt: () => `${app.brush.size}px`, onInput: v => setBrush('size')(posToSize(v)) }),
      mini({ label: 'Opacity', value: b.opacity * 100, fmt: v => `${Math.round(v)}%`, onInput: v => setBrush('opacity')(v / 100) }),
      mini({ label: 'Flow', value: b.flow * 100, fmt: v => `${Math.round(v)}%`, onInput: v => setBrush('flow')(v / 100) }),
      mini({ label: 'Stabilizer', max: 94, value: b.smoothing * 100, fmt: v => `${Math.round(v)}%`, onInput: v => setBrush('smoothing')(v / 100) }),
      h('label.inline', { 'data-tip': 'Symmetry' }, icon('symmetry'), select(SYMMETRY, o.symmetry, v => { app.setOpt('symmetry', v); render(); })),
      o.symmetry === 'radial' && mini({ label: 'Axes', min: 2, max: 16, value: o.radial, onInput: setOpt('radial') }));
    if (SELECT.includes(t)) parts.push(
      segmented([['replace', 'New'], ['add', 'Add'], ['sub', 'Subtract']], o.selMode, v => app.setOpt('selMode', v)),
      btn('Select all', 'sel.all'), btn('Deselect', 'sel.none'), btn('Invert', 'sel.invert'), btn('Feather…', 'sel.feather'));
    if (t === 'wand' || t === 'fill') parts.push(
      mini({ label: 'Tolerance', value: o.tolerance, fmt: v => `${v}%`, onInput: setOpt('tolerance') }),
      toggle('Contiguous', o.contiguous, v => app.setOpt('contiguous', v)),
      toggle('Sample all layers', o.sampleAll, v => app.setOpt('sampleAll', v)));
    if (t === 'transform') parts.push(
      segmented([['free', 'Free'], ['warp', 'Warp']], o.transformMode, v => { app.setOpt('transformMode', v); app.tools.transform.setWarp(v === 'warp'); }),
      toggle('Proportional corners', o.uniform, v => app.setOpt('uniform', v)),
      btn('Apply', 'tool.commit'), btn('Cancel', 'tool.cancel'));
    if (t === 'hand' || t === 'zoom') parts.push(btn('Fit', 'view.fit'), btn('100%', 'view.actual'), btn('Reset rotation', 'view.resetRot'));
    el.replaceChildren(...parts.filter(Boolean));
  };
  bus.on('tool', render);
  bus.on('brush', () => !busy && render());
  render();
}
