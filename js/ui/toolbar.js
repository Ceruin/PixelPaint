import { h, icon } from './dom.js';
import { bus } from '../core/bus.js';
import { local } from '../core/storage.js';
import { TOOL_META, TOOL_GROUPS, groupOf } from '../tools/index.js';

const label = id => TOOL_META.find(m => m[0] === id)?.[1] ?? id;
const key = id => TOOL_META.find(m => m[0] === id)?.[2];

// One button per tool group, showing the group's last-used tool. A group with more than one tool
// has a corner mark: long-press, right-click, or click it again while active to pick another.
export function toolbar(app, openColor) {
  const last = local.get('pp.toolGroups', {});
  const pick = (g, id) => { last[g] = id; local.set('pp.toolGroups', last); app.setTool(id); };
  const current = ([g, , ids]) => {
    if (g === 'shape') return app.doc?.pixelArt ? 'pxshape' : 'shape';
    return ids.includes(app.tool.id) ? app.tool.id : ids.includes(last[g]) ? last[g] : ids[0];
  };
  let menu = null;
  const closeMenu = () => { menu?.remove(); menu = null; };
  const openMenu = (grp, btn) => {
    closeMenu();
    const r = btn.getBoundingClientRect();
    menu = h('div.tool-menu', { style: { left: `${r.right + 6}px`, top: `${r.top}px` } }, grp[2].map(id =>
      h('button.tool-menu-item', { type: 'button', className: app.tool.id === id ? 'on' : '', onclick: () => { pick(grp[0], id); closeMenu(); } },
        icon(id), h('span', {}, label(id)), key(id) && h('kbd', {}, key(id)))));
    document.body.append(menu);
  };
  addEventListener('pointerdown', e => menu && !menu.contains(e.target) && !e.target.closest('.tool.grouped') && closeMenu(), true);
  const btns = TOOL_GROUPS.map(grp => {
    const [g, name, ids] = grp, many = ids.length > 1 && g !== 'shape';
    const b = h(`button.tool${many ? '.grouped' : ''}`, { type: 'button', 'data-tip': name, dataset: { group: g } });
    let timer = 0, long = false;
    b.addEventListener('pointerdown', () => { long = false; if (many) timer = setTimeout(() => { long = true; openMenu(grp, b); }, 420); });
    b.addEventListener('pointerup', () => clearTimeout(timer));
    b.addEventListener('pointerleave', () => clearTimeout(timer));
    b.addEventListener('contextmenu', e => { if (many) { e.preventDefault(); openMenu(grp, b); } });
    b.addEventListener('click', () => {
      if (long) return;
      const id = current(grp);
      if (many && ids.includes(app.tool.id)) return openMenu(grp, b);   // already in this group: show the others
      pick(g, id);
    });
    return b;
  });
  const fg = h('button.chip.fg', { type: 'button', 'data-tip': 'Foreground color', onclick: openColor });
  const bg = h('button.chip.bg', { type: 'button', 'data-tip': 'Background color (click to swap)', 'data-action': 'color.swap', onclick: () => app.swapColors() });
  const sync = () => {
    btns.forEach((b, i) => {
      const grp = TOOL_GROUPS[i], id = current(grp), on = grp[2].includes(app.tool.id);
      if (b.dataset.tool !== id) { b.dataset.tool = id; b.replaceChildren(icon(id)); b.dataset.action = `tool.${id}`; }
      b.classList.toggle('on', on);
      b.dataset.tip = grp[2].length > 1 && grp[0] !== 'shape' ? `${label(id)} — hold for ${grp[1]}` : label(id);
    });
    if (groupOf(app.tool.id)) last[groupOf(app.tool.id)[0]] = app.tool.id;
    fg.style.background = app.color.fg; bg.style.background = app.color.bg;
  };
  bus.on('tool', sync); bus.on('color', sync); bus.on('doc', sync); sync();
  return h('div.toolbar', {}, btns, h('div.chips', {}, bg, fg));
}
