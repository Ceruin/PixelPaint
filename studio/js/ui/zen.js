import { h, icon, iconBtn } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';
import { popMenu, closeMenus } from './menubar.js';
import { sizeToPos, posToSize } from './brushPanel.js';

// Zen / touch mode: floating pill bar, Procreate-style side sliders, panels as popovers.
export function initZen(app, panels) {
  const root = document.getElementById('zen');
  const slot = h('div.mascot-slot.zen-slot');
  let open = null;
  const pop = id => {
    const was = open;
    closePopovers();
    if (was === id) return;
    open = id;
    panels.map.get(id).el.classList.add('zen-open');
  };
  const closePopovers = () => { document.querySelectorAll('.zen-open').forEach(p => p.classList.remove('zen-open')); open = null; closeMenus(); };

  const toolBtn = (id, ic, tip) => h('button.ibtn.ztool', { type: 'button', 'data-tip': tip, 'data-action': `tool.${id}`, dataset: { tool: id }, onclick: () => app.setTool(id) }, icon(ic));
  const tools = [toolBtn('brush', 'brush', 'Brush'), toolBtn('smudge', 'smudge', 'Smudge'), toolBtn('eraser', 'eraser', 'Eraser'), toolBtn('lasso', 'lasso', 'Select'), toolBtn('transform', 'transform', 'Transform')];
  const chip = h('button.chip.zen-chip', { type: 'button', 'data-tip': 'Color', onclick: () => pop('color') });
  const menuBtn = iconBtn('menu', 'Menu', () => popMenu(menuBtn, ['file.new', 'file.open', 'file.save', 'file.exportProject', 'file.exportPng', '-', 'edit.shortcuts', 'edit.settings', '-', 'mode.studio', 'mode.notes', 'mode.paper']).classList.add('zen-menu'));

  const bar = h('div.zen-bar', {},
    menuBtn,
    iconBtn('undo', 'Undo (two-finger tap)', () => app.undo(), { 'data-action': 'edit.undo' }),
    iconBtn('redo', 'Redo (three-finger tap)', () => app.redo(), { 'data-action': 'edit.redo' }),
    h('span.zsep'), tools, h('span.zsep'),
    iconBtn('grid', 'Brushes', () => pop('brushes')),
    iconBtn('sliders', 'Brush settings', () => pop('brushSettings')),
    iconBtn('layers', 'Layers', () => pop('layers')),
    chip,
    h('span.zsep'),
    iconBtn('expand', 'Fullscreen', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())),
    iconBtn('studio', 'Studio mode (Tab)', () => actions.run('mode.studio'), { 'data-action': 'mode.studio' }),
    slot);

  const vslider = (label, get, set, min, max) => {
    const i = h('input.vslider', { type: 'range', min, max, step: 0.1, 'aria-label': label, oninput: () => set(+i.value) });
    const sync = () => { i.value = get(); };
    bus.on('brush', sync); bus.on('tool', sync); sync();
    return h('div.vs-wrap', { 'data-tip': label }, i, h('small', {}, label));
  };
  const side = h('div.zen-side', {},
    vslider('Size', () => sizeToPos(app.brush.size), v => { app.brush.size = posToSize(v); app.brushChanged(); }, 0, 100),
    vslider('Opacity', () => app.brush.opacity * 100, v => { app.brush.opacity = v / 100; app.brushChanged(); }, 1, 100));

  root.append(bar, side);
  const sync = () => {
    tools.forEach(b => b.classList.toggle('on', b.dataset.tool === app.tool.id));
    chip.style.background = app.color.fg;
  };
  bus.on('tool', sync); bus.on('color', sync); sync();
  bus.on('mode', closePopovers);
  document.getElementById('stage').addEventListener('pointerdown', () => open && closePopovers());
  return { slot, pop, closePopovers };
}
