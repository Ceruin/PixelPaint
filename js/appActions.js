import { h, iconBtn, slider } from './ui/dom.js';
import { modal, form } from './ui/dialogs.js';
import { actions, comboOf } from './core/actions.js';
import { local } from './core/storage.js';
import { clamp, download, pickFile, readJSON, toBlob } from './core/util.js';
import { Doc } from './engine/document.js';
import { FILTERS, renderFilter } from './engine/filters.js';
import { acquire, release } from './engine/compositor.js';
import { TOOL_META } from './tools/index.js';
import { MODES } from './ui/modes.js';

const SIZES = [['1920x1080', 'HD — 1920 × 1080'], ['3840x2160', '4K — 3840 × 2160'], ['2048x2048', 'Square — 2048'], ['2480x3508', 'A4 @ 300 dpi'], ['1080x1920', 'Phone — 1080 × 1920'], ['custom', 'Custom']];
const ANCHORS = [['0.5,0.5', 'Center'], ['0,0', 'Top left'], ['0.5,0', 'Top'], ['1,0', 'Top right'], ['0,0.5', 'Left'], ['1,0.5', 'Right'], ['0,1', 'Bottom left'], ['0.5,1', 'Bottom'], ['1,1', 'Bottom right']];
const PANELS = [['tools', 'Tools', 'brush'], ['color', 'Color', 'palette'], ['brushes', 'Brushes', 'grid'], ['brushSettings', 'Brush Settings', 'sliders'], ['layers', 'Layers', 'layers'], ['history', 'History', 'history']];
const dim = v => clamp(Math.round(v) || 1, 1, 8192);

export function defineActions(app, { panels, project, setMode }) {
  const doc = () => app.doc;
  const editable = fn => () => {
    const l = doc().activeLayer;
    if (!l) return app.toast('Select a layer first');
    if (l.locked) return app.toast('Layer is locked');
    fn(l);
  };

  // ---- clipboard (internal + system image clipboard) ----
  const copy = l => {
    app.clipboard = doc().extract(l);
    toBlob(app.clipboard.canvas).then(b => navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': b })])).catch(() => {});
  };
  const paste = async () => {
    doc().selection.none();
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type), cb = app.clipboard;
        if (cb && blob.size) {
          const img = await createImageBitmap(blob);
          if (img.width === cb.canvas.width && img.height === cb.canvas.height) break;
        }
        await project.importLayer(blob, 'Pasted');
        return startTransform();
      }
    } catch { /* no permission or no image: fall back to the internal clipboard */ }
    const cb = app.clipboard;
    if (!cb) return app.toast('Clipboard is empty');
    const l = doc().addLayer('Pasted');
    l.ctx.drawImage(cb.canvas, cb.x, cb.y);
    doc().touch(l);
    startTransform();
  };
  const startTransform = () => { const t = app.tools.transform; t.commit(); app.setTool('transform'); t.begin(); };

  // ---- image dialogs ----
  const newDoc = async () => {
    const v = await form('New Canvas', [
      { id: 'preset', label: 'Preset', type: 'select', options: SIZES, value: '1920x1080', oninput: (i, f) => { if (i.value !== 'custom') [f.w.value, f.h.value] = i.value.split('x'); } },
      { id: 'w', label: 'Width (px)', value: 1920, min: 1, max: 8192 },
      { id: 'h', label: 'Height (px)', value: 1080, min: 1, max: 8192 },
      { id: 'bg', label: 'Background', type: 'select', options: [['white', 'White'], ['transparent', 'Transparent'], ['color', 'Background color']], value: 'white' },
    ], 'Create');
    if (!v) return;
    app.setDoc(new Doc(dim(v.w), dim(v.h), { bg: { white: '#ffffff', transparent: null, color: app.color.bg }[v.bg] }));
  };

  const imageSize = async () => {
    const d = doc(), r = d.w / d.h;
    const v = await form('Image Size', [
      { id: 'w', label: 'Width (px)', value: d.w, oninput: (i, f) => f.keep.checked && (f.h.value = Math.round(i.value / r)) },
      { id: 'h', label: 'Height (px)', value: d.h, oninput: (i, f) => f.keep.checked && (f.w.value = Math.round(i.value * r)) },
      { id: 'keep', label: 'Keep proportions', type: 'checkbox', value: true },
    ], 'Resize');
    if (!v) return;
    const w = dim(v.w), ht = dim(v.h);
    app.tool.interrupt?.();
    d.remap('Image Size', w, ht, (ctx, c) => { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(c, 0, 0, w, ht); });
  };

  const canvasSize = async () => {
    const d = doc();
    const v = await form('Canvas Size', [
      { id: 'w', label: 'Width (px)', value: d.w }, { id: 'h', label: 'Height (px)', value: d.h },
      { id: 'anchor', label: 'Anchor', type: 'select', options: ANCHORS, value: '0.5,0.5' },
    ], 'Apply');
    if (!v) return;
    const w = dim(v.w), ht = dim(v.h), [ax, ay] = v.anchor.split(',').map(Number);
    app.tool.interrupt?.();
    d.remap('Canvas Size', w, ht, (ctx, c) => ctx.drawImage(c, Math.round((w - d.w) * ax), Math.round((ht - d.h) * ay)));
  };

  const reorient = (label, swap, setup) => () => {
    const d = doc(), w = swap ? d.h : d.w, ht = swap ? d.w : d.h;
    app.tool.interrupt?.();
    d.remap(label, w, ht, (ctx, c) => { setup(ctx, d); ctx.drawImage(c, 0, 0); });
  };

  // ---- filters with live preview ----
  const filter = key => editable(async layer => {
    const d = doc(), f = FILTERS[key], dst = acquire(d.w, d.h), view = app.view;
    const vals = Object.fromEntries(f.params.map(p => [p[0], p[4]]));
    let raf = 0;
    const update = () => { raf = 0; renderFilter(layer.canvas, dst, f.css(vals), d.selection.clip); view.previews.set(layer, dst); view.invalidate(d.bounds); };
    update();
    const body = f.params.map(([id, label, min, max, value]) => slider({ label, min, max, value, onInput: v => { vals[id] = v; raf ||= requestAnimationFrame(update); } }).el);
    const ok = !f.params.length || await modal(f.label, body, [['Cancel', null], ['Apply', 'ok', true]]);
    cancelAnimationFrame(raf);
    if (ok) { update(); d.editPixels(f.label, layer, d.bounds, ctx => { ctx.clearRect(0, 0, d.w, d.h); ctx.drawImage(dst, 0, 0); }); }
    view.previews.delete(layer);
    release(dst);
    view.invalidate(d.bounds);
  });

  // ---- shortcuts / settings / layouts ----
  const shortcuts = () => {
    const list = h('div.keys-list');
    const render = () => list.replaceChildren(...actions.all().filter(a => !a.hidden).map(a => h('div.key-row', {},
      h('span', {}, a.label),
      h('button.kbd-btn', { type: 'button', onclick: e => capture(e.currentTarget, a) }, actions.key(a.id) || '—'),
      iconBtn('x', 'Clear shortcut', () => { actions.setKey(a.id, ''); render(); }))));
    const capture = (btn, a) => {
      btn.textContent = 'Press keys…'; btn.classList.add('capturing');
      const onKey = ev => {
        ev.preventDefault(); ev.stopPropagation();
        const c = ev.key === 'Escape' ? null : comboOf(ev);
        if (c === '') return;
        removeEventListener('keydown', onKey, true);
        if (c) actions.setKey(a.id, c);
        render();
      };
      addEventListener('keydown', onKey, true);
    };
    render();
    const tools = h('div.row', {},
      h('button.btn', { type: 'button', onclick: () => download(new Blob([JSON.stringify({ type: 'pixelpaint-keys', keys: actions.keymap() }, null, 1)]), 'pixelpaint-shortcuts.json') }, 'Export'),
      h('button.btn', { type: 'button', onclick: async () => { const f = await pickFile('.json'); if (f) { actions.loadKeymap((await readJSON(f)).keys); render(); } } }, 'Import'),
      h('button.btn', { type: 'button', onclick: () => { actions.loadKeymap({}); render(); } }, 'Reset defaults'));
    modal('Keyboard Shortcuts', [tools, list], [['Done', 'ok', true]], 'wide');
  };

  const settings = async () => {
    const v = await form('Settings', [
      { id: 'haptics', label: 'Haptic feedback (supported devices)', type: 'checkbox', value: app.settings.haptics },
      { id: 'fingerDraw', label: 'Draw with finger (off = touch only navigates)', type: 'checkbox', value: app.settings.fingerDraw },
      { id: 'mem', label: 'Undo memory budget (MB)', value: Math.round(doc().history.maxBytes / 2 ** 20), min: 64, max: 4096 },
    ]);
    if (!v) return;
    app.setSetting('haptics', v.haptics);
    app.setSetting('fingerDraw', v.fingerDraw);
    app.setSetting('historyMB', clamp(v.mem, 64, 4096));
    doc().history.maxBytes = app.settings.historyMB * 2 ** 20;
  };

  const layouts = () => local.get('pp.layouts', {});
  const saveLayout = () => {
    const name = prompt('Layout name', `Layout ${Object.keys(layouts()).length + 1}`);
    if (name) { local.set('pp.layouts', { ...layouts(), [name]: panels.layout() }); app.toast(`Layout “${name}” saved`); }
  };
  const manageLayouts = () => {
    const list = h('div.keys-list');
    const render = () => list.replaceChildren(...Object.entries(layouts()).map(([name, l]) => h('div.key-row', {},
      h('span', {}, name),
      h('button.btn.sm', { type: 'button', onclick: () => panels.apply(l) }, 'Load'),
      iconBtn('trash', 'Delete', () => { const all = layouts(); delete all[name]; local.set('pp.layouts', all); render(); }))),
    Object.keys(layouts()).length ? '' : h('p.muted', {}, 'No saved layouts yet.'));
    render();
    modal('Workspace Layouts', [h('div.row', {},
      h('button.btn', { type: 'button', onclick: () => { saveLayout(); render(); } }, 'Save current…'),
      h('button.btn', { type: 'button', onclick: exportLayout }, 'Export'),
      h('button.btn', { type: 'button', onclick: importLayout }, 'Import'),
      h('button.btn', { type: 'button', onclick: () => panels.reset() }, 'Reset')), list], [['Done', 'ok', true]]);
  };
  const exportLayout = () => download(new Blob([JSON.stringify({ type: 'pixelpaint-layout', layout: panels.layout(), keys: actions.keymap() }, null, 1)]), 'pixelpaint-layout.json');
  const importLayout = async () => {
    const f = await pickFile('.json');
    if (!f) return;
    const j = await readJSON(f);
    if (j.layout) panels.apply(j.layout);
    if (j.keys) actions.loadKeymap(j.keys);
  };

  const nudgeSize = k => () => { const b = app.brush; b.size = clamp(Math.round(b.size * k + (k > 1 ? 1 : -1)), 1, 1000); app.brushChanged(); };
  const v = () => app.view;

  actions.define([
    { id: 'file.new', label: 'New Canvas…', key: 'Alt+N', run: newDoc },
    { id: 'file.open', label: 'Open…', key: 'Ctrl+O', run: project.open },
    { id: 'file.import', label: 'Import Image as Layer…', key: 'Ctrl+Shift+O', run: async () => { const f = await pickFile('image/*'); if (f) project.importLayer(f, f.name); } },
    { id: 'file.save', label: 'Save to Browser', key: 'Ctrl+S', run: () => project.saveLocal(false) },
    { id: 'file.exportProject', label: 'Download Project (.ora)', key: 'Ctrl+Shift+S', run: project.exportProject },
    { id: 'file.exportPng', label: 'Export PNG', key: 'Ctrl+Shift+E', run: () => project.exportImage('image/png') },
    { id: 'file.exportJpg', label: 'Export JPG', run: () => project.exportImage('image/jpeg') },

    { id: 'edit.undo', label: 'Undo', key: 'Ctrl+Z', run: () => app.undo() },
    { id: 'edit.redo', label: 'Redo', key: 'Ctrl+Shift+Z', run: () => app.redo() },
    { id: 'edit.cut', label: 'Cut', key: 'Ctrl+X', run: editable(l => { copy(l); doc().clearArea(l, 'Cut'); }) },
    { id: 'edit.copy', label: 'Copy', key: 'Ctrl+C', run: () => doc().activeLayer && copy(doc().activeLayer) },
    { id: 'edit.paste', label: 'Paste', key: 'Ctrl+V', run: paste },
    { id: 'edit.clear', label: 'Clear', key: 'Delete', run: editable(l => doc().clearArea(l)) },
    { id: 'edit.fill', label: 'Fill with Foreground', key: 'Alt+Backspace', run: editable(l => doc().fillArea(l, app.color.fg)) },
    { id: 'edit.shortcuts', label: 'Keyboard Shortcuts…', key: 'Ctrl+/', run: shortcuts },
    { id: 'edit.settings', label: 'Settings…', key: 'Ctrl+,', run: settings },

    { id: 'image.size', label: 'Image Size…', key: 'Ctrl+Alt+I', run: imageSize },
    { id: 'image.canvas', label: 'Canvas Size…', key: 'Ctrl+Alt+C', run: canvasSize },
    { id: 'image.flipH', label: 'Flip Horizontal', run: reorient('Flip Horizontal', false, (c, d) => { c.translate(d.w, 0); c.scale(-1, 1); }) },
    { id: 'image.flipV', label: 'Flip Vertical', run: reorient('Flip Vertical', false, (c, d) => { c.translate(0, d.h); c.scale(1, -1); }) },
    { id: 'image.rotCW', label: 'Rotate 90° CW', run: reorient('Rotate 90°', true, (c, d) => { c.translate(d.h, 0); c.rotate(Math.PI / 2); }) },
    { id: 'image.rotCCW', label: 'Rotate 90° CCW', run: reorient('Rotate -90°', true, (c, d) => { c.translate(0, d.w); c.rotate(-Math.PI / 2); }) },

    { id: 'layer.new', label: 'New Layer', key: 'Ctrl+Shift+L', run: () => doc().addLayer() },
    { id: 'layer.newGroup', label: 'New Group', run: () => doc().addGroup(false) },
    { id: 'layer.group', label: 'Group Layer', key: 'Ctrl+G', run: () => doc().addGroup(true) },
    { id: 'layer.dup', label: 'Duplicate Layer', key: 'Ctrl+J', run: () => doc().duplicate() },
    { id: 'layer.del', label: 'Delete Layer', key: 'Ctrl+Backspace', run: () => doc().remove() },
    { id: 'layer.mergeDown', label: 'Merge Down', key: 'Ctrl+E', run: () => doc().mergeDown() },
    { id: 'layer.flatten', label: 'Flatten Image', run: () => doc().flatten() },
    { id: 'layer.clip', label: 'Clipping Mask', key: 'Ctrl+Alt+G', checked: () => !!doc().active?.clip, run: () => { const n = doc().activeLayer; if (n) doc().editProps('Clipping Mask', n, { clip: !n.clip }); } },
    { id: 'layer.alphaLock', label: 'Alpha Lock', key: '/', checked: () => !!doc().active?.alphaLock, run: () => { const n = doc().activeLayer; if (n) doc().editProps('Alpha Lock', n, { alphaLock: !n.alphaLock }); } },

    { id: 'sel.all', label: 'Select All', key: 'Ctrl+A', run: () => doc().selection.all() },
    { id: 'sel.none', label: 'Deselect', key: 'Ctrl+D', run: () => doc().selection.none() },
    { id: 'sel.invert', label: 'Invert Selection', key: 'Ctrl+Shift+I', run: () => doc().selection.invert() },
    { id: 'sel.feather', label: 'Feather…', key: 'Shift+F6', run: async () => { const r = await form('Feather Selection', [{ id: 'r', label: 'Radius (px)', value: 8, min: 1, max: 250 }]); if (r) doc().selection.feather(r.r); } },

    ...Object.entries(FILTERS).map(([k, f]) => ({ id: `filter.${k}`, label: f.params.length ? `${f.label}…` : f.label, key: { hsl: 'Ctrl+U', invert: 'Ctrl+I', desaturate: 'Ctrl+Shift+U' }[k], run: filter(k) })),

    { id: 'view.in', label: 'Zoom In', key: 'Ctrl+=', run: () => v().zoomAt(1.25, v().cw / 2, v().ch / 2) },
    { id: 'view.out', label: 'Zoom Out', key: 'Ctrl+-', run: () => v().zoomAt(0.8, v().cw / 2, v().ch / 2) },
    { id: 'view.fit', label: 'Fit to Screen', key: 'Ctrl+0', run: () => v().fit() },
    { id: 'view.actual', label: 'Actual Pixels', key: 'Ctrl+1', run: () => v().set(1, v().rot) },
    { id: 'view.rotL', label: 'Rotate View Left', key: 'Shift+ArrowLeft', run: () => v().set(v().zoom, v().rot - 15) },
    { id: 'view.rotR', label: 'Rotate View Right', key: 'Shift+ArrowRight', run: () => v().set(v().zoom, v().rot + 15) },
    { id: 'view.resetRot', label: 'Reset View Rotation', key: 'Shift+ArrowUp', run: () => v().set(v().zoom, 0) },

    ...MODES.map(([id, label, ic, key]) => ({ id: `mode.${id}`, label: `${label} Mode`, icon: ic, key, checked: () => app.mode === id, run: () => setMode(id) })),
    { id: 'mode.toggleZen', label: 'Toggle Zen Mode', icon: 'zen', key: 'Tab', run: () => setMode(app.mode === 'zen' ? 'paint' : 'zen') },

    ...TOOL_META.map(([id, label, key]) => ({ id: `tool.${id}`, label: `${label} Tool`, key, run: () => app.setTool(id) })),
    { id: 'tool.commit', label: 'Apply Transform', key: 'Enter', enabled: () => !!app.tools.transform.s, run: () => app.tools.transform.commit() },
    { id: 'tool.cancel', label: 'Cancel Transform', key: 'Escape', enabled: () => !!app.tools.transform.s, run: () => app.tools.transform.cancel() },
    { id: 'brush.smaller', label: 'Brush Smaller', key: '[', run: nudgeSize(0.85) },
    { id: 'brush.bigger', label: 'Brush Bigger', key: ']', run: nudgeSize(1.18) },
    { id: 'color.swap', label: 'Swap Colors', key: 'X', run: () => app.swapColors() },
    { id: 'color.reset', label: 'Default Colors', key: 'D', run: () => { app.setColor('#1b1d23'); app.setColor('#ffffff', 'bg'); } },

    ...PANELS.map(([id, label, ic]) => ({ id: `panel.${id}`, label, icon: ic, checked: () => panels.isOpen(id), run: () => panels.toggle(id) })),
    { id: 'layout.save', label: 'Save Layout…', run: saveLayout },
    { id: 'layout.manage', label: 'Manage Layouts…', run: manageLayouts },
    { id: 'layout.export', label: 'Export Layout…', run: exportLayout },
    { id: 'layout.import', label: 'Import Layout…', run: importLayout },
    { id: 'layout.reset', label: 'Reset Layout', run: () => panels.reset() },
  ]);

  // Icons shown next to menu items (tools, modes and panels set their own).
  const ICON = {
    'file.new': 'file', 'file.open': 'folder', 'file.import': 'image', 'file.save': 'save', 'file.exportProject': 'download', 'file.exportPng': 'image', 'file.exportJpg': 'image',
    'edit.undo': 'undo', 'edit.redo': 'redo', 'edit.cut': 'scissors', 'edit.copy': 'copy', 'edit.paste': 'paste', 'edit.clear': 'eraser', 'edit.fill': 'fill', 'edit.shortcuts': 'keyboard', 'edit.settings': 'settings',
    'image.size': 'image', 'image.canvas': 'crop', 'image.flipH': 'flipH', 'image.flipV': 'flipV', 'image.rotCW': 'rotCW', 'image.rotCCW': 'rotCCW',
    'layer.new': 'plus', 'layer.newGroup': 'folderPlus', 'layer.group': 'folder', 'layer.dup': 'copy', 'layer.del': 'trash', 'layer.mergeDown': 'merge', 'layer.flatten': 'layers', 'layer.clip': 'clip', 'layer.alphaLock': 'alpha',
    'sel.all': 'select', 'sel.none': 'x', 'sel.invert': 'swap', 'sel.feather': 'sparkle',
    'view.in': 'zoom', 'view.out': 'zoomOut', 'view.fit': 'fit', 'view.actual': 'expand', 'view.rotL': 'rotCCW', 'view.rotR': 'rotCW', 'view.resetRot': 'undo',
    'brush.smaller': 'minus', 'brush.bigger': 'plus', 'color.swap': 'swap', 'color.reset': 'palette', 'tool.commit': 'check', 'tool.cancel': 'x',
    'layout.save': 'save', 'layout.manage': 'window', 'layout.export': 'download', 'layout.import': 'upload', 'layout.reset': 'undo',
  };
  for (const a of actions.all()) a.icon ??= ICON[a.id] ?? (a.id.startsWith('filter.') ? 'sparkle' : a.id.startsWith('tool.') ? a.id.slice(5) : undefined);

  return {
    menus: [
      ['File', 'folder', ['file.new', 'file.open', 'file.import', '-', 'file.save', 'file.exportProject', '-', 'file.exportPng', 'file.exportJpg']],
      ['Edit', 'undo', ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.clear', 'edit.fill', '-', 'edit.shortcuts', 'edit.settings']],
      ['Image', 'image', ['image.size', 'image.canvas', '-', 'image.flipH', 'image.flipV', 'image.rotCW', 'image.rotCCW']],
      ['Layer', 'layers', ['layer.new', 'layer.newGroup', 'layer.group', 'layer.dup', 'layer.del', '-', 'layer.mergeDown', 'layer.flatten', '-', 'layer.clip', 'layer.alphaLock']],
      ['Select', 'select', ['sel.all', 'sel.none', 'sel.invert', 'sel.feather']],
      ['Filter', 'sparkle', Object.keys(FILTERS).map(k => `filter.${k}`)],
      ['View', 'eye', ['view.in', 'view.out', 'view.fit', 'view.actual', '-', 'view.rotL', 'view.rotR', 'view.resetRot', '-', ...MODES.map(m => `mode.${m[0]}`)]],
      ['Window', 'window', [...PANELS.map(p => `panel.${p[0]}`), '-', 'layout.save', 'layout.manage', 'layout.export', 'layout.import', 'layout.reset']],
    ],
  };
}
