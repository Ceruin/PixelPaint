import { h } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';

export function statusbar(app, el, canvas) {
  const zoom = h('button.st-btn', { type: 'button', 'data-tip': 'Fit to screen', 'data-action': 'view.fit', onclick: () => actions.run('view.fit') });
  const size = h('span'), pos = h('span.st-pos'), mem = h('span'), saved = h('span.st-saved');
  el.append(zoom, size, pos, h('div.spacer'), mem, saved);
  bus.on('view', v => { zoom.textContent = `${(v.zoom * 100).toFixed(v.zoom < 0.1 ? 1 : 0)}%${v.rot ? ` · ${Math.round(v.rot)}°` : ''}`; });
  bus.on('doc', d => { size.textContent = `${d.w} × ${d.h} px`; });
  bus.on('resize', d => { size.textContent = `${d.w} × ${d.h} px`; });
  bus.on('history', hist => { mem.textContent = `History ${(hist.bytes / 2 ** 20).toFixed(0)} MB`; });
  bus.on('saved', e => { saved.textContent = `${e?.auto ? 'Auto-saved' : 'Saved'} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; });
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect(), p = app.view.toDoc(e.clientX - r.left, e.clientY - r.top);
    pos.textContent = `${Math.floor(p.x)}, ${Math.floor(p.y)}`;
  });
}
