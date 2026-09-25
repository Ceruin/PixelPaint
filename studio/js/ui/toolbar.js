import { h, icon } from './dom.js';
import { bus } from '../core/bus.js';
import { TOOL_META } from '../tools/index.js';

export function toolbar(app, openColor) {
  const btns = TOOL_META.map(([id, label]) =>
    h('button.tool', { type: 'button', 'data-tip': label, 'data-action': `tool.${id}`, dataset: { tool: id }, onclick: () => app.setTool(id) }, icon(id)));
  const fg = h('button.chip.fg', { type: 'button', 'data-tip': 'Foreground color', onclick: openColor });
  const bg = h('button.chip.bg', { type: 'button', 'data-tip': 'Background color (click to swap)', 'data-action': 'color.swap', onclick: () => app.swapColors() });
  const sync = () => {
    btns.forEach(b => b.classList.toggle('on', b.dataset.tool === app.tool.id));
    fg.style.background = app.color.fg; bg.style.background = app.color.bg;
  };
  bus.on('tool', sync); bus.on('color', sync); sync();
  return h('div.toolbar', {}, btns, h('div.chips', {}, bg, fg));
}
