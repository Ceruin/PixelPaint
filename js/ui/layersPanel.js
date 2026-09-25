import { h, icon, iconBtn, slider } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';
import { isClipped } from '../engine/compositor.js';
import { BLEND_MODES, GROUP_MODES } from '../engine/blend.js';
import { FILTERS, LAYER_FILTERS } from '../engine/filters.js';
import { modal } from './dialogs.js';
import { popMenu } from './menubar.js';

const BLEND_SHORT = Object.fromEntries(BLEND_MODES.map(([k, l]) => [k, l]));

export function layersPanel(app) {
  const doc = () => app.doc;
  const thumbs = new Map();
  const list = h('div.layer-list');
  const marker = h('div.drop-line');
  let lastTap = { id: 0, t: 0 };

  // ---- active-layer properties ----
  const blend = h('select', { onchange: () => doc().active && doc().editProps('Blend Mode', doc().active, { blend: blend.value }) });
  const opacity = slider({
    label: 'Opacity', value: 100, fmt: v => `${Math.round(v)}%`,
    onInput: v => { const n = doc().active; if (n) { n.opacity = v / 100; bus.emit('dirty', doc().bounds); } },
    onCommit: (v, v0) => { const n = doc().active; if (n) doc().editProps('Opacity', n, { opacity: v / 100 }, { opacity: v0 / 100 }); },
  });
  const flag = (k, ic, tip) => h('button.ibtn.sm.flag', { type: 'button', 'data-tip': tip, dataset: { flag: k }, onclick: () => { const n = doc().active; if (n && k in n) doc().editProps(tip, n, { [k]: !n[k] }); } }, icon(ic));
  const flags = [flag('alphaLock', 'alpha', 'Alpha lock'), flag('clip', 'clip', 'Clipping mask'), flag('locked', 'lock', 'Lock layer')];

  const syncProps = () => {
    const n = doc().active;
    blend.replaceChildren(...(n?.type === 'group' ? GROUP_MODES : BLEND_MODES).map(([v, l]) => h('option', { value: v }, l)));
    blend.value = n?.blend ?? 'source-over';
    blend.disabled = n?.type === 'filter';
    opacity.set(Math.round((n?.opacity ?? 1) * 100));
    flags.forEach(f => { const k = f.dataset.flag; f.classList.toggle('on', !!n?.[k]); f.disabled = !n || !(k in n); });
  };

  // ---- rows ----
  const thumb = n => {
    let t = thumbs.get(n);
    if (!t) thumbs.set(n, t = { c: h('canvas.thumb'), v: -1 });
    return t.c;
  };
  const updateThumbs = () => {
    for (const [n, t] of thumbs) {
      const src = n.view(), key = `${n.version}|${n.doc.frame}|${n.doc.w}x${n.doc.h}`;
      if (t.key === key) continue;
      const { w, h: ht } = n.doc, s = 40 / Math.max(w, ht);
      t.c.width = Math.max(1, Math.round(w * s)); t.c.height = Math.max(1, Math.round(ht * s));
      const c = t.c.getContext('2d');
      c.clearRect(0, 0, t.c.width, t.c.height);
      if (src) c.drawImage(src, 0, 0, t.c.width, t.c.height);
      t.key = key;
    }
  };
  let thumbTimer = 0;
  const scheduleThumbs = () => { thumbTimer ||= setTimeout(() => { thumbTimer = 0; updateThumbs(); }, 250); };

  const rows = () => {
    const out = [];
    const walk = (g, depth) => {
      for (let i = g.children.length - 1; i >= 0; i--) {
        const n = g.children[i];
        out.push({ n, depth, clipped: isClipped(g.children, i) });
        if (n.type === 'group' && !n.collapsed) walk(n, depth + 1);
      }
    };
    walk(doc().root, 0);
    return out;
  };

  const row = ({ n, depth, clipped }) => {
    const d = doc(), el = h('div.layer-row', {
      className: [n === d.active && 'on', !n.visible && 'hidden-layer', clipped && 'clipped'].filter(Boolean).join(' '),
      style: { paddingLeft: `${4 + depth * 14}px` },
    },
      h('button.ibtn.sm.vis', { type: 'button', 'data-tip': 'Visibility', onclick: () => d.editProps(n.visible ? 'Hide Layer' : 'Show Layer', n, { visible: !n.visible }) }, icon(n.visible ? 'eye' : 'eyeOff')),
      clipped && h('span.clip-mark', {}, '↳'),
      n.type === 'group'
        ? [h('button.ibtn.sm', { type: 'button', onclick: () => { n.collapsed = !n.collapsed; render(); } }, icon(n.collapsed ? 'chevronRight' : 'chevron')), h('span.folder', {}, icon('folder'))]
        : n.type === 'filter' ? h('span.thumb-wrap.fx', {}, icon('sparkle')) : h('span.thumb-wrap', {}, thumb(n)),
      h('span.layer-meta', {}, h('span.layer-name', {}, n.name), h('span.layer-sub', {}, `${Math.round(n.opacity * 100)}% · ${n.type === 'filter' ? 'Filter layer' : BLEND_SHORT[n.blend] ?? 'Pass Through'}`)),
      h('span.badges', {}, n.clip && icon('clip'), n.alphaLock && icon('alpha'), n.locked && icon('lock')));
    el.node = n;
    el.addEventListener('pointerdown', e => !e.target.closest('button') && startDrag(n, e));
    return el;
  };

  const render = () => {
    list.replaceChildren(...rows().map(row), marker);
    updateThumbs();
    syncProps();
  };

  const rename = n => {
    const el = [...list.children].find(r => r.node === n)?.querySelector('.layer-meta');
    if (!el) return;
    const input = h('input.rename', { value: n.name });
    const done = ok => { if (ok && input.value.trim() && input.value !== n.name) doc().editProps('Rename', n, { name: input.value.trim() }); else render(); };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.onblur = null; done(false); } });
    input.onblur = () => done(true);
    el.replaceWith(input);
    input.focus(); input.select();
  };

  // Live-edits a filter layer's parameters; one undo step on OK.
  const editFilter = async n => {
    const f = FILTERS[n.filter], old = { ...n.vals };
    const body = f.params.map(([id, label, min, max]) => slider({ label, min, max, value: n.vals[id], onInput: v => { n.vals[id] = v; bus.emit('dirty', doc().bounds); } }).el);
    const ok = !f.params.length || await modal(f.label, [body, h('p.muted', {}, 'Tip: double-click the layer later to adjust again.')], [['Cancel', null], ['Apply', 'ok', true]]);
    const vals = { ...n.vals };
    n.vals = old;
    if (ok) doc().editProps('Adjust Filter', n, { vals }, { vals: old });
    else bus.emit('dirty', doc().bounds);
  };

  // Pointer-based drag reorder (works for mouse, pen and touch). Drop into a group's middle band.
  const startDrag = (n, e) => {
    const d = doc(), now = e.timeStamp;
    if (lastTap.id === n.id && now - lastTap.t < 380) { lastTap = { id: 0, t: 0 }; return n.type === 'filter' ? editFilter(n) : rename(n); }
    lastTap = { id: n.id, t: now };
    if (d.active !== n) d.setActive(n);
    let target = null;
    const x0 = e.clientX, y0 = e.clientY;
    const move = ev => {
      if (!target && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      const el = [...list.querySelectorAll('.layer-row')].find(r => { const b = r.getBoundingClientRect(); return ev.clientY >= b.top && ev.clientY < b.bottom; });
      if (!el) return;
      const b = el.getBoundingClientRect(), rel = (ev.clientY - b.top) / b.height, tn = el.node;
      target = tn.type === 'group' && rel > 0.3 && rel < 0.7 ? { tn, into: true } : { tn, above: rel < 0.5 };
      list.querySelectorAll('.into').forEach(r => r.classList.remove('into'));
      if (target.into) { el.classList.add('into'); marker.style.display = 'none'; }
      else Object.assign(marker.style, { display: 'block', top: `${(target.above ? b.top : b.bottom) - list.getBoundingClientRect().top + list.scrollTop - 1}px` });
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      marker.style.display = 'none';
      if (!target || target.tn === n) return render();
      const { tn } = target;
      if (target.into) d.moveNode(n, tn, tn.children.length);
      else { const p = d.parentOf(tn); d.moveNode(n, p, p.children.indexOf(tn) + (target.above ? 1 : 0)); }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  bus.on('layers', render);
  bus.on('filterLayer', n => editFilter(n));
  bus.on('dirty', scheduleThumbs);
  bus.on('frame', scheduleThumbs);

  const foot = h('div.layer-foot', {},
    iconBtn('plus', 'New layer', () => actions.run('layer.new'), { 'data-action': 'layer.new' }),
    iconBtn('folderPlus', 'Group layer', () => actions.run('layer.group'), { 'data-action': 'layer.group' }),
    iconBtn('sparkle', 'New filter layer', e => popMenu(e.currentTarget, LAYER_FILTERS.map(k => `layer.filter.${k}`))),
    iconBtn('copy', 'Duplicate', () => actions.run('layer.dup'), { 'data-action': 'layer.dup' }),
    iconBtn('merge', 'Merge down', () => actions.run('layer.mergeDown'), { 'data-action': 'layer.mergeDown' }),
    iconBtn('trash', 'Delete layer', () => actions.run('layer.del'), { 'data-action': 'layer.del' }));

  return h('div.layers', {}, h('div.layer-props', {}, blend, h('div.flags', {}, flags), opacity.el), list, foot);
}
