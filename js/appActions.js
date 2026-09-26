import { h, icon, iconBtn, slider } from './ui/dom.js';
import { modal, form } from './ui/dialogs.js';
import { actions, comboOf } from './core/actions.js';
import { local } from './core/storage.js';
import { clamp, download, pickFile, pickFiles, readJSON, toBlob } from './core/util.js';
import { Doc } from './engine/document.js';
import { FILTERS, LAYER_FILTERS, renderFilter } from './engine/filters.js';
import { encodePSD } from './engine/psd.js';
import { Layer } from './engine/document.js';
import { renderFrames, exportGIF, exportPNGSequence, exportSpriteSheet, exportVideo } from './engine/animation.js';
import { bus } from './core/bus.js';
import { acquire, release } from './engine/compositor.js';
import { TOOL_META } from './tools/index.js';
import { MODES, THEMES } from './ui/modes.js';
import { LAYOUTS, PAGES, layoutRects, addPanels } from './tools/comic.js';
import { hexToRgb } from './core/color.js';
import { tipFromImage, registerTip } from './engine/tips.js';
import { showWelcome } from './ui/welcome.js';
import { checkForUpdates, reloadFresh } from './ui/updates.js';
import { showGuide } from './ui/guide.js';
import { VERSION } from './version.js';

const SIZES = [['1920x1080', 'HD — 1920 × 1080'], ...PAGES, ['32x32', 'Pixel art — 32 × 32'], ['64x64', 'Pixel art — 64 × 64'], ['128x128', 'Pixel art — 128 × 128'], ['320x180', 'Pixel scene — 320 × 180'], ['3840x2160', '4K — 3840 × 2160'], ['2048x2048', 'Square — 2048'], ['2480x3508', 'A4 @ 300 dpi'], ['1080x1920', 'Phone — 1080 × 1920'], ['custom', 'Custom']];
const ANCHORS = [['0.5,0.5', 'Center'], ['0,0', 'Top left'], ['0.5,0', 'Top'], ['1,0', 'Top right'], ['0,0.5', 'Left'], ['1,0.5', 'Right'], ['0,1', 'Bottom left'], ['0.5,1', 'Bottom'], ['1,1', 'Bottom right']];
const PANELS = [['tools', 'Tools', 'brush'], ['color', 'Color', 'palette'], ['brushes', 'Brushes', 'grid'], ['brushSettings', 'Brush Settings', 'sliders'], ['layers', 'Layers', 'layers'], ['navigator', 'Navigator', 'navigator'], ['reference', 'Reference', 'image'], ['history', 'History', 'history']];
const dim = v => clamp(Math.round(v) || 1, 1, 8192);
const SCALES = [1, 2, 4, 8, 16, 32].map(k => [String(k), `×${k}`]);

export function defineActions(app, { panels, project, setMode, toggleFocus, setTheme, timeline }) {
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

  // ---- the browser library: every project saved here, with a thumbnail ----
  async function openLibrary() {
    const list = await project.library.list(), grid = h('div.lib-grid');
    let pick = null;
    const render = items => grid.replaceChildren(...(items.length ? items.map(it => h('div.lib-item', { className: it.id === doc().libId ? 'on' : '' },
      h('button.lib-open', { type: 'button', 'data-tip': 'Open', onclick: () => { pick = it.id; grid.closest('.modal-back')?.querySelector('.modal-foot .primary')?.click(); } },
        h('img', { src: it.thumb, alt: '' }), h('b', {}, it.name), h('small', {}, `${it.w} × ${it.h} · ${new Date(it.date).toLocaleString()}`)),
      h('div.lib-acts', {},
        iconBtn('text', 'Rename', async () => { const v = await form('Rename', [{ id: 'n', label: 'Name', type: 'text', value: it.name }], 'Rename'); if (v) { await project.library.rename(it.id, String(v.n).trim() || it.name); render(await project.library.list()); } }),
        iconBtn('trash', 'Delete', async () => { if (await modal('Delete project?', h('p', {}, `“${it.name}” will be removed from this browser.`), [['Cancel', null], ['Delete', 'ok', 'danger']])) { await project.library.remove(it.id); render(await project.library.list()); } }))))
      : [h('p.muted', {}, 'Nothing saved here yet — use File ▸ Save to Browser (Ctrl+S).')]));
    render(list);
    if (await modal('Open from Browser', grid, [['Cancel', null], ['Open', 'ok', true]], 'wide') && pick) project.library.open(pick);
  }

  // ---- share the finished picture (merged) or the whole project (all layers, .pp) ----
  async function shareDialog() {
    const title = doc().name && doc().name !== 'Untitled' ? doc().name : 'My painting';
    const tell = t => app.toast(t);
    const shareFile = async (get, what) => {
      const f = await get();
      if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], title }); } catch { /* cancelled */ } }
      else { download(f, f.name); tell(`${what} downloaded — attach it to your post`); }
    };
    const copyImage = async () => {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': (await project.imageFile()) })]); tell('Image copied — paste it into your post'); return true; }
      catch { tell('Copying images isn’t allowed here — use Share or Download'); return false; }
    };
    const site = url => async () => { await copyImage(); open(url, '_blank', 'noopener'); };
    const text = encodeURIComponent(`${title} — made in PixelPaint`);
    const row = (ic, label, sub, fn) => h('button.share-row', { type: 'button', onclick: fn }, icon(ic), h('span', {}, h('b', {}, label), h('small', {}, sub)));
    const body = h('div.share', {},
      h('div.sub-label', {}, 'Finished picture'),
      row('upload', 'Share image…', 'To any app on this device (one merged PNG)', () => shareFile(project.imageFile, 'Image')),
      row('copy', 'Copy image', 'Paste it into a post, chat or doc', copyImage),
      row('image', 'Download PNG', 'The full-size merged picture', async () => { const f = await project.imageFile(); download(f, f.name); }),
      h('div.share-sites', {},
        h('button.btn.sm', { type: 'button', onclick: site(`https://www.reddit.com/submit?title=${text}`) }, 'Reddit'),
        h('button.btn.sm', { type: 'button', onclick: site(`https://twitter.com/intent/tweet?text=${text}`) }, 'X / Twitter'),
        h('button.btn.sm', { type: 'button', onclick: site(`https://bsky.app/intent/compose?text=${text}`) }, 'Bluesky'),
        h('small.muted', {}, 'Copies the image, then opens the site — paste it into your post.')),
      h('div.sub-label', {}, 'Full painting file'),
      row('layers', 'Share project (.pp)…', 'Every layer and frame — opens in PixelPaint', () => shareFile(project.projectFile, 'Project')),
      row('download', 'Download OpenRaster (.ora)', 'Layers for Krita, GIMP and MyPaint', project.exportOra));
    await modal('Share', body, [['Done', null, true]]);
  }

  // ---- image dialogs ----
  const newDoc = async () => {
    const v = await form('New Canvas', [
      { id: 'preset', label: 'Preset', type: 'select', options: SIZES, value: '1920x1080', oninput: (i, f) => { if (i.value !== 'custom') [f.w.value, f.h.value] = i.value.split('x'); } },
      { id: 'w', label: 'Width (px)', value: 1920, min: 1, max: 8192 },
      { id: 'h', label: 'Height (px)', value: 1080, min: 1, max: 8192 },
      { id: 'bg', label: 'Background', type: 'select', options: [['white', 'White'], ['transparent', 'Transparent'], ['color', 'Background color']], value: 'white' },
      { id: 'panels', label: 'Comic panels', type: 'select', options: LAYOUTS, value: 'none' },
    ], 'Create');
    if (!v) return;
    const d = new Doc(dim(v.w), dim(v.h), { bg: { white: '#ffffff', transparent: null, color: app.color.bg }[v.bg] });
    if (v.panels !== 'none') { d.addLayer('Art', false); addPanels(d, layoutRects(d, v.panels)); }
    app.setDoc(d);
    if (d.pixelArt) app.setTool('pencil');   // a pixel canvas starts with the Pixel Pencil
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
    const vals = { ...Object.fromEntries(f.params.map(p => [p[0], p[4]])), ...(f.color && { color: app.color.fg }) };
    let raf = 0;
    const update = () => { raf = 0; renderFilter(layer.canvas, dst, f, vals, d.selection.clip); view.previews.set(layer, dst); view.invalidate(d.bounds); };
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

  // ---- animation ----
  const exportAnim = async () => {
    const d = doc();
    const v = await form('Export Animation', [
      { id: 'fmt', label: 'Format', type: 'select', value: 'gif', options: [['gif', 'Animated GIF'], ['sheet', 'Sprite sheet + JSON (.zip)'], ['seq', 'PNG sequence (.zip)'], ['video', 'Video (WebM)']] },
      { id: 'range', label: 'Frames', type: 'select', value: '-1', options: [['-1', `All (${d.frames.length})`], ...d.tags.map((t, i) => [String(i), `Tag: ${t.name}`])] },
      { id: 'scale', label: 'Scale', type: 'select', value: '1', options: [['0.25', '25%'], ['0.5', '50%'], ['1', '100%'], ['2', '200%'], ['4', '400%']] },
      { id: 'layout', label: 'Sheet layout', type: 'select', value: 'horizontal', options: [['horizontal', 'Horizontal strip'], ['vertical', 'Vertical strip'], ['grid', 'Grid']] },
      { id: 'loops', label: 'Video loops', value: 1, min: 1, max: 20 },
    ], 'Export');
    if (!v) return;
    const t = d.tags[+v.range], from = t?.from ?? 0, to = t?.to ?? d.frames.length - 1, name = d.name;
    app.toast('Rendering frames…');
    await new Promise(r => setTimeout(r, 30));
    const frames = renderFrames(d, from, to, +v.scale);
    try {
      if (v.fmt === 'gif') download(exportGIF(frames), `${name}.gif`);
      if (v.fmt === 'seq') download(await exportPNGSequence(frames, name), `${name}-frames.zip`);
      if (v.fmt === 'sheet') download(await exportSpriteSheet(frames, name, v.layout, d.tags, from), `${name}-sheet.zip`);
      if (v.fmt === 'video') { app.toast('Recording video in real time…'); download(await exportVideo(frames, v.loops), `${name}.webm`); }
    } catch (e) { app.toast(e.message); }
  };

  // Image sequence → a new layer whose cels are the images, one per frame (frames added as needed).
  const importFrames = async () => {
    const files = (await pickFiles('image/*')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!files.length) return;
    const d = doc(), imgs = await Promise.all(files.map(f => createImageBitmap(f))), l = new Layer(d, files[0].name.replace(/[_-]?\d*\.\w+$/, '') || 'Sequence');
    d.editTree('Import Frames', () => { d.insert(l); d.active = l; });
    d.editFrames('Import Frames', () => {
      const start = d.frames.length > 1 ? d.frame : 0;
      while (d.frames.length < start + imgs.length) d.frames.push({ duration: d.frames.at(-1).duration });
      imgs.forEach((img, i) => {
        const s = Math.min(1, d.w / img.width, d.h / img.height), w = img.width * s, ht = img.height * s;
        l.cel(start + i, true).getContext('2d').drawImage(img, (d.w - w) / 2, (d.h - ht) / 2, w, ht);
      });
    });
    timeline.expand();
  };

  // Replace Color (Aseprite): swaps foreground-coloured pixels for the background colour.
  const replaceColor = editable(async layer => {
    const v = await form('Replace Color', [{ id: 'tol', label: 'Tolerance %', value: 10, min: 0, max: 100 }], 'Replace');
    if (!v) return;
    const d = doc(), [fr, fg, fb] = hexToRgb(app.color.fg), [tr, tg, tb] = hexToRgb(app.color.bg), t = v.tol * 2.55;
    d.editPixels('Replace Color', layer, d.bounds, ctx => {
      const img = ctx.getImageData(0, 0, d.w, d.h), px = img.data;
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] && Math.abs(px[i] - fr) <= t && Math.abs(px[i + 1] - fg) <= t && Math.abs(px[i + 2] - fb) <= t) { px[i] = tr; px[i + 1] = tg; px[i + 2] = tb; }
      ctx.putImageData(img, 0, 0);
    });
  });

  // New brush tip from the selected pixels (Aseprite's Edit ▸ New Brush).
  const brushFromSelection = () => {
    const d = doc(), l = d.activeLayer;
    if (!l || !d.selection.active) return app.toast('Select part of a layer first');
    const { canvas } = d.extract(l), id = `custom-${Date.now().toString(36)}`, tip = tipFromImage(canvas, 256);
    registerTip(id, tip);
    local.set('pp.tips', { ...local.get('pp.tips', {}), [id]: tip.toDataURL() });
    Object.assign(app.brushes.brush, { tip: id, name: 'Selection brush', spacing: 0.25, size: Math.max(canvas.width, canvas.height), roundness: 1, angle: 0 });
    app.setTool('brush');
    app.brushChanged();
    app.toast('New brush made from the selection');
  };

  const nudgeSize = k => () => { const b = app.brush; b.size = clamp(Math.round(b.size * k + (k > 1 ? 1 : -1)), 1, 1000); app.brushChanged(); };
  const v = () => app.view;

  actions.define([
    { id: 'file.new', label: 'New Canvas…', key: 'Ctrl+Alt+N', run: newDoc },
    { id: 'file.open', label: 'Open…', key: 'Ctrl+O', run: project.open },
    { id: 'file.import', label: 'Import Image as Layer…', key: 'Ctrl+Shift+O', run: async () => { const f = await pickFile('image/*'); if (f) project.importLayer(f, f.name); } },
    { id: 'file.save', label: 'Save to Browser', key: 'Ctrl+S', run: async () => {
      let name = doc().name;
      if (!doc().libId) {   // first save: name it
        const v = await form('Save to Browser', [{ id: 'n', label: 'Name', type: 'text', value: name && name !== 'Untitled' ? name : 'My painting' }], 'Save');
        if (!v) return;
        name = String(v.n).trim() || 'My painting';
      }
      await project.library.save(name);
      app.toast(`Saved “${name}” in this browser — File ▸ Open from Browser`);
    } },
    { id: 'file.library', label: 'Open from Browser…', icon: 'folder', run: openLibrary },
    { id: 'file.exportProject', label: 'Download Project (.pp)', key: 'Ctrl+Shift+S', run: project.exportProject },
    { id: 'file.exportOra', label: 'Export OpenRaster (.ora, for Krita / GIMP)', run: project.exportOra },
    { id: 'file.share', label: 'Share…', icon: 'upload', run: shareDialog },
    { id: 'file.exportPng', label: 'Export PNG', key: 'Ctrl+Shift+E', run: () => project.exportImage('image/png') },
    { id: 'image.panels', label: 'Comic Panel Layout…', icon: 'crop', run: async () => {
      const v = await form('Comic Panel Layout', [{ id: 'k', label: 'Layout', type: 'select', options: LAYOUTS.slice(1), value: 'grid4' }], 'Add Panels');
      if (v) addPanels(doc(), layoutRects(doc(), v.k));
    } },
    { id: 'file.exportJpg', label: 'Export JPG', run: () => project.exportImage('image/jpeg') },
    // pixel art: crisp enlargements and sprite sheets
    { id: 'file.exportScaled', label: 'Export PNG at Size…', icon: 'pixel', run: async () => {
      const v = await form('Export PNG at Size', [{ id: 'k', label: 'Scale (hard pixels)', type: 'select', options: SCALES, value: doc().pixelArt ? '8' : '2' }], 'Export');
      if (v) project.exportImage('image/png', +v.k);
    } },
    { id: 'file.exportSheet', label: 'Export Sprite Sheet…', icon: 'film', run: async () => {
      const v = await form('Export Sprite Sheet', [
        { id: 'k', label: 'Scale', type: 'select', options: SCALES, value: '1' },
        { id: 'cols', label: 'Frames per row (0 = one row)', value: 0, min: 0, max: 256 }], 'Export');
      if (v) project.exportSheet(+v.k, Math.round(+v.cols) || 0);
    } },
    { id: 'file.importSheet', label: 'Import Sprite Sheet…', icon: 'film', run: async () => {
      const f = await pickFile('image/*');
      if (!f) return;
      const img = await createImageBitmap(f), n = Math.max(1, Math.round(img.width / img.height));
      const v = await form('Import Sprite Sheet', [
        { id: 'w', label: 'Frame width (px)', value: Math.round(img.width / n), min: 1, max: 2048 },
        { id: 'h', label: 'Frame height (px)', value: img.height, min: 1, max: 2048 }], 'Import');
      if (v) project.importSheet(f, dim(v.w), dim(v.h));
    } },
    { id: 'file.exportPsd', label: 'Export Photoshop (.psd)', icon: 'download', run: () => download(encodePSD(doc()), `${doc().name}.psd`) },

    { id: 'edit.undo', label: 'Undo', key: 'Ctrl+Z', run: () => app.undo() },
    { id: 'edit.redo', label: 'Redo', key: 'Ctrl+Shift+Z', run: () => app.redo() },
    { id: 'edit.cut', label: 'Cut', key: 'Ctrl+X', run: editable(l => { copy(l); doc().clearArea(l, 'Cut'); }) },
    { id: 'edit.copy', label: 'Copy', key: 'Ctrl+C', run: () => doc().activeLayer && copy(doc().activeLayer) },
    { id: 'edit.paste', label: 'Paste', key: 'Ctrl+V', run: paste },
    { id: 'edit.clear', label: 'Clear', key: 'Delete', run: editable(l => doc().clearArea(l)) },
    { id: 'edit.clearCanvas', label: 'Clear Canvas…', key: 'Ctrl+Shift+Delete', run: async () => {
      const ok = await modal('Clear the canvas?', h('p', {}, 'This wipes every layer on this frame. You can undo it with Ctrl+Z (or a two-finger tap).'), [['Cancel', null], ['Clear canvas', 'ok', 'danger']]);
      if (ok) { doc().clearCanvas(); app.toast('Canvas cleared — undo to bring it back'); }
    } },
    { id: 'edit.fill', label: 'Fill with Foreground', key: 'Alt+Backspace', run: editable(l => doc().fillArea(l, app.color.fg)) },
    { id: 'edit.replaceColor', label: 'Replace Color…', icon: 'swap', key: 'Shift+R', run: replaceColor },
    { id: 'brush.fromSelection', label: 'New Brush from Selection', icon: 'brush', key: 'Ctrl+B', run: brushFromSelection },
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
    ...LAYER_FILTERS.map(k => ({ id: `layer.filter.${k}`, label: `${FILTERS[k].label} Layer`, icon: 'sparkle', run: () => { const l = doc().addFilterLayer(k); if (FILTERS[k].params.length) bus.emit('filterLayer', l); } })),
    { id: 'layer.clip', label: 'Clipping Mask', key: 'Ctrl+Alt+G', checked: () => !!doc().active?.clip, run: () => { const n = doc().activeLayer; if (n) doc().editProps('Clipping Mask', n, { clip: !n.clip }); } },
    { id: 'layer.alphaLock', label: 'Alpha Lock', key: '/', checked: () => !!doc().active?.alphaLock, run: () => { const n = doc().activeLayer; if (n) doc().editProps('Alpha Lock', n, { alphaLock: !n.alphaLock }); } },

    { id: 'sel.all', label: 'Select All', key: 'Ctrl+A', run: () => doc().selection.all() },
    { id: 'sel.none', label: 'Deselect', key: 'Ctrl+D', run: () => doc().selection.none() },
    { id: 'sel.invert', label: 'Invert Selection', key: 'Ctrl+Shift+I', run: () => doc().selection.invert() },
    { id: 'sel.feather', label: 'Feather…', key: 'Shift+F6', run: async () => { const r = await form('Feather Selection', [{ id: 'r', label: 'Radius (px)', value: 8, min: 1, max: 250 }]); if (r) doc().selection.feather(r.r); } },

    ...Object.entries(FILTERS).map(([k, f]) => ({ id: `filter.${k}`, label: f.params.length ? `${f.label}…` : f.label, key: { hsl: 'Ctrl+U', invert: 'Ctrl+I', desaturate: 'Ctrl+Shift+U' }[k], run: filter(k) })),

    { id: 'anim.play', label: 'Play / Pause', icon: 'play', key: 'Enter', enabled: () => !app.tools.transform.s, run: () => app.player.toggle() },
    { id: 'anim.first', label: 'First Frame', icon: 'first', key: 'Home', run: () => { app.player.stop(); doc().setFrame(0); } },
    { id: 'anim.prev', label: 'Previous Frame', icon: 'chevronLeft', key: ',', run: () => app.player.step(-1) },
    { id: 'anim.next', label: 'Next Frame', icon: 'chevronRight', key: '.', run: () => app.player.step(1) },
    { id: 'anim.last', label: 'Last Frame', icon: 'last', key: 'End', run: () => { app.player.stop(); doc().setFrame(doc().frames.length - 1); } },
    { id: 'anim.newFrame', label: 'New Frame', icon: 'plus', key: 'Alt+N', run: () => { app.player.stop(); doc().addFrame(false); timeline.expand(); } },
    { id: 'anim.dupFrame', label: 'Duplicate Frame', icon: 'copy', key: 'Alt+D', run: () => { app.player.stop(); doc().addFrame(true); timeline.expand(); } },
    { id: 'anim.delFrame', label: 'Delete Frame', icon: 'trash', key: 'Alt+Delete', run: () => { app.player.stop(); doc().deleteFrame(); } },
    { id: 'anim.clearCel', label: 'Blank Cel', icon: 'eraser', run: () => doc().activeLayer && doc().clearCel(doc().activeLayer) },
    { id: 'anim.holdCel', label: 'Hold Previous Cel', icon: 'last', run: () => doc().activeLayer && doc().holdCel(doc().activeLayer) },
    { id: 'anim.onion', label: 'Onion Skin', icon: 'onion', key: 'F3', checked: () => app.opts.onion, run: () => app.setOpt('onion', !app.opts.onion) },
    { id: 'anim.tag', label: 'New Tag', icon: 'tag', key: 'F2', run: () => { const r = timeline.tagRange() ?? [doc().frame, doc().frame]; doc().addTag(...r); } },
    { id: 'anim.export', label: 'Export Animation…', icon: 'film', key: 'Ctrl+Alt+E', run: exportAnim },
    { id: 'anim.import', label: 'Import Frames (image sequence)…', icon: 'upload', run: importFrames },

    { id: 'view.in', label: 'Zoom In', key: 'Ctrl+=', run: () => v().zoomAt(1.25, v().cw / 2, v().ch / 2) },
    { id: 'view.out', label: 'Zoom Out', key: 'Ctrl+-', run: () => v().zoomAt(0.8, v().cw / 2, v().ch / 2) },
    { id: 'view.fit', label: 'Fit to Screen', key: 'Ctrl+0', run: () => v().fit() },
    { id: 'view.actual', label: 'Actual Pixels', key: 'Ctrl+1', run: () => v().set(1, v().rot) },
    { id: 'view.rotL', label: 'Rotate View Left', key: 'Shift+ArrowLeft', run: () => v().set(v().zoom, v().rot - 15) },
    { id: 'view.rotR', label: 'Rotate View Right', key: 'Shift+ArrowRight', run: () => v().set(v().zoom, v().rot + 15) },
    { id: 'view.resetRot', label: 'Reset View Rotation', key: 'Shift+ArrowUp', run: () => v().set(v().zoom, 0) },
    { id: 'view.grid', label: 'Show Grid', icon: 'wrap', key: "Ctrl+'", checked: () => app.opts.grid, run: () => app.setOpt('grid', !app.opts.grid) },
    { id: 'view.pixelGrid', label: 'Pixel Grid (when zoomed in)', icon: 'pixel', key: "Ctrl+Shift+'", checked: () => app.opts.pixelGrid, run: () => app.setOpt('pixelGrid', !app.opts.pixelGrid) },
    { id: 'view.gridSize', label: 'Grid Settings…', icon: 'sliders', run: async () => { const v = await form('Grid', [{ id: 's', label: 'Cell size (px)', value: app.opts.gridSize, min: 2, max: 1024 }]); if (v) { app.setOpt('gridSize', clamp(Math.round(v.s), 2, 1024)); app.setOpt('grid', true); } } },
    { id: 'view.flip', label: 'Mirror View', icon: 'mirror', key: 'Shift+M', checked: () => v().flip, run: () => v().toggleFlip() },
    { id: 'view.wrap', label: 'Wrap-Around Mode', icon: 'wrap', key: 'Shift+W', checked: () => app.opts.wrap, run: () => app.setOpt('wrap', !app.opts.wrap) },
    { id: 'view.assist', label: 'Show Assistants', icon: 'ruler', checked: () => app.opts.showAssist, run: () => app.setOpt('showAssist', !app.opts.showAssist) },
    { id: 'assist.clear', label: 'Clear Assistants', icon: 'trash', run: () => { doc().assistants.length = 0; bus.emit('assist'); v().redraw(); } },
    { id: 'app.welcome', label: 'Say Hi to Pyxl', icon: 'heart', run: () => showWelcome(true) },
    { id: 'help.guide', label: 'Getting Started', icon: 'info', key: 'F1', run: showGuide },
    { id: 'help.update', label: 'Check for Updates…', icon: 'download', run: () => checkForUpdates() },
    { id: 'help.reload', label: 'Reload App', icon: 'rotCW', run: reloadFresh },
    { id: 'help.about', label: 'About PixelPaint', icon: 'bubble', run: () => modal('About PixelPaint', h('p', {}, `PixelPaint ${VERSION} — a painting, pixel art, animation and notes app that runs in your browser and works offline. Your work autosaves on this device.`), [['OK', 'ok', true]]) },
    // Themes: Dark, Light and Paper (calm e-ink colours with a pencil-on-paper feel). view.theme cycles them.
    ...THEMES.map(([id, label, ic]) => ({ id: `theme.${id}`, label: `${label} Theme`, icon: ic, checked: () => app.settings.theme === id, run: () => setTheme(id) })),
    { id: 'view.theme', label: 'Next Theme', icon: 'sun', run: () => setTheme(THEMES[(THEMES.findIndex(t => t[0] === app.settings.theme) + 1) % THEMES.length][0]) },
    { id: 'view.einkSim', label: 'Simulate E-ink Display', icon: 'paper', checked: () => app.settings.einkSim !== false, run: () => { app.setSetting('einkSim', app.settings.einkSim === false); bus.emit('eink'); } },
    { id: 'view.focus', label: 'Focus (Full-Screen Canvas)', icon: 'expand', key: 'Tab', checked: () => !!app.focus, run: () => toggleFocus() },
    { id: 'view.fullscreen', label: 'Browser Full Screen', icon: 'fit', checked: () => !!document.fullscreenElement,
      run: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {}) },

    ...MODES.map(([id, label, ic, key]) => ({ id: `mode.${id}`, label: `${label} Workspace`, icon: ic, key, checked: () => app.mode === id, run: () => setMode(id) })),

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
    { id: 'layout.lock', label: 'Lock Panels', icon: 'lock', checked: () => !!panels.locked, run: () => panels.setLocked(!panels.locked) },
  ]);

  // Icons shown next to menu items (tools, modes and panels set their own).
  const ICON = {
    'file.new': 'file', 'file.open': 'folder', 'file.import': 'image', 'file.save': 'save', 'file.exportProject': 'download', 'file.exportPng': 'image', 'file.exportJpg': 'image',
    'edit.undo': 'undo', 'edit.redo': 'redo', 'edit.cut': 'scissors', 'edit.copy': 'copy', 'edit.paste': 'paste', 'edit.clear': 'eraser', 'edit.clearCanvas': 'trash', 'edit.fill': 'fill', 'edit.shortcuts': 'keyboard', 'edit.settings': 'settings',
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
      ['File', 'folder', ['file.new', 'file.open', 'file.library', 'file.import', 'file.importSheet', '-', 'file.save', 'file.exportProject', 'file.share', '-', 'file.exportPng', 'file.exportScaled', 'file.exportSheet', 'file.exportJpg', 'file.exportPsd', 'file.exportOra', '-', 'file.toPixel', 'mode.pixel']],
      ['Edit', 'undo', ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.clear', 'edit.clearCanvas', 'edit.fill', 'edit.replaceColor', '-', 'brush.fromSelection', '-', 'edit.shortcuts', 'edit.settings']],
      ['Image', 'image', ['image.size', 'image.canvas', '-', 'image.flipH', 'image.flipV', 'image.rotCW', 'image.rotCCW', '-', 'image.panels']],
      ['Layer', 'layers', ['layer.new', 'layer.newGroup', 'layer.group', 'layer.dup', 'layer.del', '-', ...LAYER_FILTERS.map(k => `layer.filter.${k}`), '-', 'layer.mergeDown', 'layer.flatten', '-', 'layer.clip', 'layer.alphaLock']],
      ['Frame', 'film', ['anim.play', 'anim.first', 'anim.prev', 'anim.next', 'anim.last', '-', 'anim.newFrame', 'anim.dupFrame', 'anim.delFrame', 'anim.clearCel', 'anim.holdCel', '-', 'anim.onion', 'anim.tag', '-', 'anim.import', 'anim.export']],
      ['Select', 'select', ['sel.all', 'sel.none', 'sel.invert', 'sel.feather']],
      ['Filter', 'sparkle', Object.keys(FILTERS).map(k => `filter.${k}`)],
      ['View', 'eye', ['view.in', 'view.out', 'view.fit', 'view.actual', '-', 'view.rotL', 'view.rotR', 'view.resetRot', 'view.flip', 'view.wrap', '-', 'view.grid', 'view.pixelGrid', 'view.gridSize', '-', 'view.assist', 'assist.clear', '-', 'view.focus', 'view.fullscreen', '-', ...THEMES.map(t => `theme.${t[0]}`), 'view.einkSim', '-', ...MODES.map(m => `mode.${m[0]}`)]],
      ['Window', 'window', [...PANELS.map(p => `panel.${p[0]}`), '-', 'layout.lock', 'layout.save', 'layout.manage', 'layout.export', 'layout.import', 'layout.reset']],
      ['Help', 'info', ['help.guide', 'edit.shortcuts', '-', 'help.update', 'help.reload', '-', 'help.about']],
    ],
  };
}
