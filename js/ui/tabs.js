// Document tabs over the canvas (Krita's): one per open drawing, shown once there are two or more.
// Click to switch, middle-click or × to close, right-click for Close Others / to the Left / to the Right / All,
// + for a new canvas; Alt+PageUp / PageDown steps through them.
import { h, icon } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';
import { popMenu, closeMenus } from './menubar.js';

const MENU_WIDTH = 270;   // matches popMenu's own clamp so the menu stays on screen

export function docTabs(app, el, blank) {
  // The current drawing closes last, so closing the others never makes a different tab current in between.
  const closeAll = list => [...list.filter(d => d !== app.doc), ...list.filter(d => d === app.doc)].forEach(d => app.closeDoc(d, blank));

  const menu = (d, ev) => {
    const docs = app.docs, i = docs.indexOf(d);
    const item = (label, list) => h('button.menu-item', { type: 'button', disabled: !list.length, onclick: () => { closeMenus(); closeAll(list); } },
      h('span.ic'), h('span.mi-label', {}, label), h('span.kbd'));
    const m = popMenu(ev.currentTarget, []);
    m.append(item('Close', [d]), item('Close Others', docs.filter(o => o !== d)), h('hr'),
      item('Close Tabs to the Left', docs.slice(0, i)), item('Close Tabs to the Right', docs.slice(i + 1)), h('hr'),
      item('Close All', docs));
    Object.assign(m.style, { left: `${Math.min(ev.clientX, innerWidth - MENU_WIDTH)}px`, top: `${ev.clientY}px` });
  };

  const render = () => {
    const docs = app.docs;
    el.hidden = docs.length < 2;
    if (el.hidden) return el.replaceChildren();
    el.replaceChildren(...docs.map(d => {
      const on = d === app.doc;
      return h('div.doc-tab', { className: on ? 'on' : '', role: 'tab', 'aria-selected': String(on), title: `${d.name || 'Untitled'} · ${d.w} × ${d.h}${d.fileHandle ? ` · ${d.fileHandle.name}` : ''}`,
        onclick: e => !e.target.closest('.doc-tab-x') && app.setDoc(d),
        onauxclick: e => { if (e.button === 1) { e.preventDefault(); app.closeDoc(d, blank); } },
        oncontextmenu: e => { e.preventDefault(); e.stopPropagation(); menu(d, e); } },
        h('span.doc-tab-name', {}, d.name || 'Untitled'), app.files?.unsaved(d) ? h('span.doc-tab-dirty', { title: `Not saved to ${d.fileHandle.name} yet` }, '•') : '', d.pixelArt ? h('span.doc-tab-px', {}, 'px') : '',
        h('button.doc-tab-x', { type: 'button', 'aria-label': `Close ${d.name || 'Untitled'}`, 'data-tip': 'Close (kept in My Art)', onclick: () => app.closeDoc(d, blank) }, icon('x')));
    }), h('button.ibtn.sm.doc-tab-new', { type: 'button', 'data-tip': 'New canvas', 'aria-label': 'New canvas', onclick: () => actions.run('file.new') }, icon('plus')));
    el.querySelector('.doc-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  ['tabs', 'doc', 'saved', 'resize', 'history'].forEach(ev => bus.on(ev, render));
  render();
  return {
    step(dir) { const n = app.docs.length; if (n > 1) app.setDoc(app.docs[(app.docs.indexOf(app.doc) + dir + n) % n]); },
    render,
  };
}
