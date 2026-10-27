// Document tabs over the canvas (Krita's): one per open drawing, shown once there are two or more.
// Click to switch, middle-click or × to close, + for a new canvas; Alt+PageUp / PageDown steps through them.
import { h, icon } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';

export function docTabs(app, el, blank) {
  const render = () => {
    const docs = app.docs;
    el.hidden = docs.length < 2;
    if (el.hidden) return el.replaceChildren();
    el.replaceChildren(...docs.map(d => {
      const on = d === app.doc;
      return h('div.doc-tab', { className: on ? 'on' : '', role: 'tab', 'aria-selected': String(on), title: `${d.name || 'Untitled'} · ${d.w} × ${d.h}${d.fileHandle ? ` · ${d.fileHandle.name}` : ''}`,
        onclick: e => !e.target.closest('.doc-tab-x') && app.setDoc(d),
        onauxclick: e => { if (e.button === 1) { e.preventDefault(); app.closeDoc(d, blank); } } },
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
