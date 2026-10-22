// The Palette panel: the working palette as a big grid (Aseprite's / Krita's palette docker). Click a
// colour to paint with it, right-click to remove it; the colour you're painting with is outlined.
import { h, icon, iconBtn, select } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';
import { palette, allPalettes } from './paletteStore.js';

export function palettePanel(app) {
  const grid = h('div.pal-grid'), count = h('span.muted.pal-count'), pick = h('span.pal-sel');
  const render = () => {
    const fg = app.color.fg.toLowerCase();
    pick.replaceChildren(select([['', 'Load palette...'], ...Object.keys(allPalettes()).map(n => [n, n])], '', v => v && palette.load(allPalettes()[v])));
    grid.replaceChildren(...palette.colors.map(c => h('button.pal-sw', {
      type: 'button', className: c.toLowerCase() === fg ? 'on' : '', style: { background: c }, 'data-tip': `${c}: right-click to remove`,
      onclick: () => app.setColor(c), oncontextmenu: e => { e.preventDefault(); palette.remove(c); },
    })));
    count.textContent = `${palette.colors.length} colours`;
  };
  const mark = () => { const fg = app.color.fg.toLowerCase(); grid.querySelectorAll('.pal-sw').forEach((b, i) => b.classList.toggle('on', palette.colors[i]?.toLowerCase() === fg)); };
  bus.on('palette', render); bus.on('color', mark);
  render();
  return h('div.pal-panel', {},
    h('div.picker-row', {}, pick,
      iconBtn('plus', 'Add the current colour', () => palette.add(app.color.fg)),
      iconBtn('upload', 'Import palette (.gpl, .pal, .hex)', palette.import),
      iconBtn('download', 'Export palette (.gpl)', () => palette.export())),
    grid,
    h('div.pal-foot', {}, count,
      h('button.btn.sm', { type: 'button', 'data-action': 'layer.snapPalette', 'data-tip': 'Change every colour on this layer to its nearest palette colour', onclick: () => actions.run('layer.snapPalette') }, icon('palette'), 'Snap layer to palette')));
}
