import { h } from './dom.js';
import { actions } from '../core/actions.js';

export const menuItem = (id, after) => {
  const a = actions.get(id);
  if (id === '-' || !a) return h('hr');
  return h('button.menu-item', { type: 'button', disabled: a.enabled?.() === false, onclick: () => { after?.(); actions.run(id); } },
    h('span.check', {}, a.checked?.() ? '✓' : ''), h('span.mi-label', {}, a.label), h('span.kbd', {}, actions.key(id)));
};

let current = null;
export const closeMenus = () => { current?.remove(); current = null; document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open')); };

// Floating action list anchored under `anchor` (used by the menubar and the Zen menu).
export function popMenu(anchor, ids) {
  closeMenus();
  const r = anchor.getBoundingClientRect();
  current = h('div.menu-drop.pop', { style: { left: `${Math.min(r.left, innerWidth - 250)}px`, top: `${r.bottom + 4}px` } },
    (typeof ids === 'function' ? ids() : ids).map(id => menuItem(id, closeMenus)));
  document.body.append(current);
  return current;
}

export function menubar(el, menus, right) {
  const open = (m, btn) => { popMenu(btn, m.items); m.classList.add('open'); };
  el.append(
    h('div.brand', {}, h('b', {}, 'Pixel'), 'Paint', h('small', {}, 'studio')),
    h('nav.menus', {}, menus.map(([title, items]) => {
      const m = h('div.menu');
      m.items = items;
      const btn = h('button.menu-title', {
        type: 'button',
        onclick: () => (m.classList.contains('open') ? closeMenus() : open(m, btn)),
        onpointerenter: () => document.querySelector('.menu.open') && !m.classList.contains('open') && open(m, btn),
      }, title);
      m.append(btn);
      return m;
    })),
    h('div.spacer'), right);
  addEventListener('pointerdown', e => !e.target.closest('.menu, .menu-drop, .zen-menu') && closeMenus());
  addEventListener('keydown', e => e.key === 'Escape' && closeMenus());
}
