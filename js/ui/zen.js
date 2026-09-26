import { h, icon, iconBtn } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';
import { sizeToPos, posToSize } from './brushPanel.js';

// Focus (full screen, once Zen mode): the canvas fills the window; one floating strip (styled like every other
// panel) holds the essential tools, Procreate-style size/opacity sliders and panel flyouts.
export function initZen(app, panels) {
  const root = document.getElementById('zen');
  const slot = h('div.mascot-slot');
  const toolBtn = (id, tip) => h('button.ibtn.tool', { type: 'button', 'data-tip': tip, 'data-action': `tool.${id}`, dataset: { tool: id }, onclick: () => app.setTool(id) }, icon(id));
  // painting tools, or on a pixel canvas the pixel tools
  const paintTools = [toolBtn('brush', 'Brush'), toolBtn('smudge', 'Smudge'), toolBtn('eraser', 'Eraser')];
  const pixelTools = [toolBtn('pencil', 'Pencil'), toolBtn('pxshape', 'Shapes'), toolBtn('fill', 'Fill')];
  const tools = [...paintTools, ...pixelTools, toolBtn('lasso', 'Lasso'), toolBtn('transform', 'Transform')];
  const kind = () => { const px = !!app.doc?.pixelArt; paintTools.forEach(b => { b.hidden = px; }); pixelTools.forEach(b => { b.hidden = !px; }); };
  bus.on('doc', kind);
  const chip = h('button.chip.zen-chip', { type: 'button', 'data-tip': 'Color', onclick: e => panels.flyout('color', e.currentTarget) });
  const fly = (id, ic, tip) => iconBtn(ic, tip, e => panels.flyout(id, e.currentTarget));

  const vslider = (label, get, set, min) => {
    const i = h('input.vslider', { type: 'range', min, max: 100, step: 0.1, 'aria-label': label, oninput: () => set(+i.value) });
    const sync = () => { i.value = get(); i.style.setProperty('--p', `${(i.value - min) / (100 - min) * 100}%`); };
    i.addEventListener('input', sync);
    bus.on('brush', sync); bus.on('tool', sync); sync();
    return h('label.vs-wrap', { 'data-tip': label }, i, h('small', {}, label));
  };

  root.append(h('div.zen-strip.panel', {},
    h('div.zen-sec', {}, h('button.zen-exit', { type: 'button', 'data-tip': 'Leave Focus and bring the menus back (Tab)', onclick: () => actions.run('view.focus') }, icon('x'), h('span', {}, 'Exit')), iconBtn('undo', 'Undo', () => actions.run('edit.undo')), iconBtn('redo', 'Redo', () => actions.run('edit.redo'))),
    h('div.zen-sec', {}, tools),
    h('div.zen-sec', {},
      vslider('Size', () => sizeToPos(app.brush.size), v => { app.brush.size = posToSize(v); app.brushChanged(); }, 0),
      vslider('Opacity', () => app.brush.opacity * 100, v => { app.brush.opacity = v / 100; app.brushChanged(); }, 1)),
    h('div.zen-sec', {}, chip, fly('brushes', 'grid', 'Brushes'), fly('brushSettings', 'sliders', 'Brush settings'), fly('layers', 'layers', 'Layers'), iconBtn('trash', 'Clear canvas…', () => actions.run('edit.clearCanvas'))),
    slot));

  // Touch screens hide scrollbars: fade the strip's ends when there's more to scroll that way.
  const strip = root.querySelector('.zen-strip');
  const edges = () => {
    const t = strip.scrollTop, more = strip.scrollHeight - strip.clientHeight;
    strip.classList.toggle('more-up', t > 2); strip.classList.toggle('more-down', t < more - 2);
  };
  strip.addEventListener('scroll', edges, { passive: true });
  new ResizeObserver(edges).observe(strip);
  const sync = () => {
    tools.forEach(b => b.classList.toggle('on', b.dataset.tool === app.tool.id));
    chip.style.background = app.color.fg;
  };
  bus.on('tool', sync); bus.on('color', sync); sync(); kind();
  bus.on('mode', () => panels.closeFlyout());
  return { slot };
}
