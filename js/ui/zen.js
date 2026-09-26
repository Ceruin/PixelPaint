import { h, icon, iconBtn } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';
import { local } from '../core/storage.js';
import { TOOL_META } from '../tools/index.js';
import { sizeToPos, posToSize } from './brushPanel.js';

// Focus (full screen), after SketchBook: the canvas fills the window. A bar along the top holds
// undo/redo and everything else a tap away (every tool, brushes, colour, layers and their actions,
// more); a slim strip on the left has size and opacity and your recent tools. While something is
// selected (or being transformed) a bar of selection actions sits at the bottom.
const LAYER_ACTS = [['layer.new', 'New', 'plus'], ['layer.dup', 'Duplicate', 'copy'], ['edit.copy', 'Copy', 'copy'], ['edit.cut', 'Cut', 'scissors'],
  ['edit.paste', 'Paste', 'paste'], ['edit.clear', 'Clear', 'eraser'], ['layer.mergeDown', 'Merge down', 'merge'], ['layer.flatten', 'Merge all', 'layers'],
  ['layer.alphaLock', 'Lock alpha', 'alpha'], ['layer.clip', 'Clip', 'clip'], ['layer.group', 'Group', 'folder'], ['layer.del', 'Delete', 'trash']];
const MORE_ACTS = [['sel.all', 'Select all', 'select'], ['sel.invert', 'Invert sel.', 'swap'], ['sel.none', 'Deselect', 'x'], ['view.fit', 'Fit view', 'fit'],
  ['view.resetRot', 'Reset turn', 'rotCW'], ['view.flip', 'Mirror view', 'mirror'], ['view.assist', 'Guides', 'ruler'], ['image.flipH', 'Flip canvas', 'flipH'],
  ['file.save', 'Save', 'save'], ['file.share', 'Share', 'upload'], ['file.exportPng', 'Export PNG', 'image'], ['edit.clearCanvas', 'Clear all', 'trash']];
const SEL_ACTS = [['edit.copy', 'Copy', 'copy'], ['edit.cut', 'Cut', 'scissors'], ['edit.paste', 'Paste', 'paste'], ['tool.transform', 'Move', 'transform'],
  ['edit.fill', 'Fill', 'fill'], ['edit.clear', 'Clear', 'eraser'], ['sel.invert', 'Invert', 'swap'], ['sel.none', 'Deselect', 'x']];
const XFORM_ACTS = [['tool.commit', 'Apply', 'check'], ['tool.cancel', 'Cancel', 'x']];

export function initZen(app, panels) {
  const root = document.getElementById('zen');
  const slot = h('div.mascot-slot');
  const run = id => { closePop(); actions.run(id); };
  const act = ([id, label, ic]) => h('button.zen-act', { type: 'button', 'data-action': id, onclick: () => run(id) }, icon(ic), h('span', {}, label));

  // one popover at a time, under the button that opened it
  let popEl = null;
  const closePop = () => { popEl?.remove(); popEl = null; };
  const pop = (anchor, ...content) => {
    const again = popEl?.anchor === anchor;
    closePop(); panels.closeFlyout();
    if (again) return;
    popEl = h('div.zen-pop.panel', {}, ...content);
    popEl.anchor = anchor;
    document.body.append(popEl);
    const r = anchor.getBoundingClientRect(), w = popEl.offsetWidth;
    Object.assign(popEl.style, { top: `${r.bottom + 8}px`, left: `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px` });
  };
  addEventListener('pointerdown', e => { if (popEl && !popEl.contains(e.target) && !popEl.anchor.contains(e.target)) closePop(); }, true);

  // ---- every tool, in a grid ----
  const toolGrid = () => h('div.zen-grid', {}, TOOL_META.filter(([id]) => app.tools[id]).map(([id, label]) =>
    h('button.zen-act', { type: 'button', className: app.tool.id === id ? 'on' : '', onclick: () => { closePop(); app.setTool(id); } }, icon(id === 'assist' ? 'ruler' : id), h('span', {}, label))));
  const toolsBtn = h('button.ibtn.zen-tools', { type: 'button', 'data-tip': 'All tools', onclick: e => pop(e.currentTarget, toolGrid()) });
  const chip = h('button.chip.zen-chip', { type: 'button', 'data-tip': 'Color', onclick: e => { closePop(); panels.flyout('color', e.currentTarget); } });
  const fly = (id, ic, tip) => iconBtn(ic, tip, e => { closePop(); panels.flyout(id, e.currentTarget); });

  const top = h('div.zen-top.panel', {},
    h('button.zen-exit', { type: 'button', 'data-tip': 'Leave Focus and bring the menus back (Tab)', onclick: () => actions.run('view.focus') }, icon('x'), h('span', {}, 'Exit')),
    iconBtn('undo', 'Undo', () => actions.run('edit.undo')), iconBtn('redo', 'Redo', () => actions.run('edit.redo')),
    h('span.zen-sep'),
    toolsBtn, fly('brushes', 'grid', 'Brushes'), fly('brushSettings', 'sliders', 'Brush settings'), chip, fly('layers', 'layers', 'Layers'),
    iconBtn('copy', 'Layer actions', e => pop(e.currentTarget, h('div.zen-title', {}, app.doc.activeLayer?.name ?? 'Layer'), h('div.zen-grid', {}, LAYER_ACTS.map(act)))),
    iconBtn('menu', 'More', e => pop(e.currentTarget, h('div.zen-grid', {}, MORE_ACTS.map(act)))));

  // ---- left strip: recent tools, size and opacity ----
  let recent = local.get('pp.zenRecent', ['brush', 'eraser', 'smudge', 'lasso']);
  const recentBox = h('div.zen-sec');
  const renderRecent = () => recentBox.replaceChildren(...recent.filter(id => app.tools[id]).slice(0, 5).map(id =>
    h('button.ibtn.tool', { type: 'button', className: app.tool.id === id ? 'on' : '', 'data-tip': TOOL_META.find(t => t[0] === id)?.[1], onclick: () => app.setTool(id) }, icon(id === 'assist' ? 'ruler' : id))));
  const vslider = (label, get, set, min) => {
    const i = h('input.vslider', { type: 'range', min, max: 100, step: 0.1, 'aria-label': label, oninput: () => set(+i.value) });
    const sync = () => { i.value = get(); i.style.setProperty('--p', `${(i.value - min) / (100 - min) * 100}%`); };
    i.addEventListener('input', sync);
    bus.on('brush', sync); bus.on('tool', sync); sync();
    return h('label.vs-wrap', { 'data-tip': label }, i, h('small', {}, label));
  };
  const strip = h('div.zen-strip.panel', {},
    recentBox,
    h('div.zen-sec', {},
      vslider('Size', () => sizeToPos(app.brush.size), v => { app.brush.size = posToSize(v); app.brushChanged(); }, 0),
      vslider('Opacity', () => app.brush.opacity * 100, v => { app.brush.opacity = v / 100; app.brushChanged(); }, 1)),
    slot);

  // ---- selection / transform actions along the bottom ----
  const selBar = h('div.sel-bar.panel', { hidden: true });
  const coarse = matchMedia('(pointer: coarse)');
  let selKey = '';
  const syncSel = () => {
    const xf = app.tool.id === 'transform' && !!app.tools.transform.s, sel = !!app.doc?.selection.active;
    const show = (xf || sel) && (!!app.focus || coarse.matches) && app.mode === 'paint';
    selBar.hidden = !show;
    const key = show ? (xf ? 'xf' : 'sel') : '';
    if (key && key !== selKey) selBar.replaceChildren(...(xf ? XFORM_ACTS : SEL_ACTS).map(act));
    selKey = key;
  };
  ['selection', 'tool', 'doc', 'history', 'mode'].forEach(ev => bus.on(ev, syncSel));
  addEventListener('pointerup', () => requestAnimationFrame(syncSel));

  root.append(top, strip);
  document.body.append(selBar);

  // Touch screens hide scrollbars: fade the strip's ends when there's more to scroll that way.
  const edges = () => {
    const t = strip.scrollTop, more = strip.scrollHeight - strip.clientHeight;
    strip.classList.toggle('more-up', t > 2); strip.classList.toggle('more-down', t < more - 2);
  };
  strip.addEventListener('scroll', edges, { passive: true });
  new ResizeObserver(edges).observe(strip);
  const sync = () => {
    const id = app.tool.id;
    if (recent[0] !== id) { recent = [id, ...recent.filter(t => t !== id)].slice(0, 5); local.set('pp.zenRecent', recent); }
    renderRecent();
    toolsBtn.replaceChildren(icon(id === 'assist' ? 'ruler' : id), icon('chevron'));
    chip.style.background = app.color.fg;
  };
  bus.on('tool', sync); bus.on('color', sync); sync();
  bus.on('mode', () => { panels.closeFlyout(); closePop(); });
  return { slot };
}
