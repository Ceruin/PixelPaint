import { h, icon, iconBtn } from './dom.js';
import { actions } from '../core/actions.js';

export const menuItem = (id, after) => {
  const a = actions.get(id);
  if (id === '-' || !a) return h('hr');
  const on = a.checked?.();
  return h('button.menu-item', { type: 'button', className: on ? 'checked' : '', disabled: a.enabled?.() === false, onclick: () => { after?.(); actions.run(id); } },
    a.icon ? icon(a.icon) : h('span.ic'), h('span.mi-label', {}, a.label), h('span.kbd', {}, on ? '✓' : actions.key(id)));
};

let current = null;
export const closeMenus = () => { current?.remove(); current = null; document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open')); };

// Floating action list anchored under `anchor` (menubar dropdowns and small popup menus).
export function popMenu(anchor, ids) {
  closeMenus();
  const r = anchor.getBoundingClientRect();
  current = h('div.menu-drop', { style: { left: `${Math.min(r.left, innerWidth - 270)}px`, top: `${r.bottom + 2}px` } },
    (typeof ids === 'function' ? ids() : ids).map(id => menuItem(id, closeMenus)));
  document.body.append(current);
  return current;
}

// The same rainbow wordmark the Pixel editor uses: handle blues for "Pixel", bristle rainbow for "Paint".
export const wordmark = () => h('div.brand', { 'aria-label': 'PixelPaint' },
  [...'Pixel'].map(c => h('em', {}, c)), h('b', {}, [...'Paint'].map(c => h('i', {}, c))));

export function menubar(el, menus, right) {
  const open = (m, btn) => { popMenu(btn, m.items); m.classList.add('open'); };
  // Phones: one button lists the menus; picking one shows its items in the same spot.
  const burger = h('button.ibtn.menu-burger', { type: 'button', 'aria-label': 'Menu', onclick: () => {
    const drop = popMenu(burger, []);
    drop.append(...menus.map(([title, ic, items]) => h('button.menu-item', { type: 'button', onclick: () => popMenu(burger, items) }, icon(ic), h('span.mi-label', {}, title), h('span.kbd', {}, '›'))));
  } }, icon('menu'));
  el.append(
    wordmark(), burger,
    h('nav.menus', {}, menus.map(([title, ic, items]) => {
      const m = h('div.menu');
      m.items = items;
      const btn = h('button.menu-title', {
        type: 'button',
        onclick: () => (m.classList.contains('open') ? closeMenus() : open(m, btn)),
        onpointerenter: () => document.querySelector('.menu.open') && !m.classList.contains('open') && open(m, btn),
      }, icon(ic), h('span', {}, title));
      m.append(btn);
      return m;
    })),
    h('div.spacer'), right,
    h('div.group', {},
      iconBtn('undo', 'Undo', () => actions.run('edit.undo'), { 'data-action': 'edit.undo' }),
      iconBtn('redo', 'Redo', () => actions.run('edit.redo'), { 'data-action': 'edit.redo' })));
  addEventListener('pointerdown', e => !e.target.closest('.menu, .menu-drop') && closeMenus());
  addEventListener('keydown', e => e.key === 'Escape' && closeMenus());
}
