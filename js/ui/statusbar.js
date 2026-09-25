import { h, icon } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';

export function statusbar(app, el, canvas) {
  const zoom = h('button.st-btn', { type: 'button', 'data-tip': 'Fit to screen', 'data-action': 'view.fit', onclick: () => actions.run('view.fit') });
  const t = () => h('b', { style: { fontWeight: 400 } });
  const [zt, st, pt, mt, svt, tt] = [t(), t(), t(), t(), t(), t()];
  zoom.append(icon('zoom'), zt);
  el.append(zoom, h('span', {}, icon('image'), st), h('span.st-pos', {}, icon('transform'), pt), h('div.spacer'), h('span', {}, icon('brush'), tt), h('span', {}, icon('history'), mt), h('span', {}, icon('save'), svt));
  svt.textContent = 'Not saved yet';
  bus.on('view', v => { zt.textContent = `${(v.zoom * 100).toFixed(v.zoom < 0.1 ? 1 : 0)}%${v.rot ? ` · ${Math.round(v.rot)}°` : ''}`; });
  bus.on('doc', d => { st.textContent = `${d.w} × ${d.h}`; });
  bus.on('resize', d => { st.textContent = `${d.w} × ${d.h}`; });
  bus.on('history', hist => { mt.textContent = `${(hist.bytes / 2 ** 20).toFixed(0)} MB undo`; });
  const brushInfo = () => { tt.textContent = `${app.brush.name} · ${app.brush.size}px`; };
  bus.on('brush', brushInfo); bus.on('tool', brushInfo); brushInfo();
  bus.on('saved', e => { svt.textContent = `${e?.auto ? 'Auto-saved' : 'Saved'} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; });
  // Cursor position: at most once per frame, from the input's cached canvas rect (no layout reads).
  let last = null, raf = 0;
  canvas.addEventListener('pointermove', e => {
    last = e;
    raf ||= requestAnimationFrame(() => {
      raf = 0;
      const r = app.input.rect, p = app.view.toDoc(last.clientX - r.left, last.clientY - r.top), s = `${Math.floor(p.x)}, ${Math.floor(p.y)}`;
      if (pt.textContent !== s) pt.textContent = s;
    });
  }, { passive: true });
}
