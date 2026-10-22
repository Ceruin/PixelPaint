// Tilesheets in Draw (from Sprite Studio): a canvas cut into a grid of named tiles (doc.sheet,
// engine/tiles.js). Picking a tile selects it, so every tool already draws inside it; with tile
// clipping on, a stroke that starts in another tile picks that one first, so strokes never spill
// into a neighbour. The overlay draws the grid, the joined tiles and the picked tile's name.
import { h, icon } from './dom.js';
import { modal, form } from './dialogs.js';
import { bus } from '../core/bus.js';
import { download, toBlob, makeCanvas } from '../core/util.js';
import { zip } from '../engine/zip.js';
import { flatten } from '../engine/compositor.js';
import { makeSheet, cloneSheet, tileRect, blockRect, expandRange, cellAt, sheetSize, tileName, tileBlocks } from '../engine/tiles.js';

const MAX = 4096;
const cl = (v, a, b) => Math.max(a, Math.min(b, v));
const safe = s => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'tile';

export function initTiles(app) {
  let pick = null;   // { r, c, r2, c2 }: the picked cell, or a block of them (the current drawing's)
  const doc = () => app.doc, sheet = () => app.doc?.sheet;
  const range = () => {
    const s = sheet();
    if (!s || !pick) return null;
    const lim = (v, n) => cl(v, 0, n - 1);
    return expandRange(s, lim(Math.min(pick.r, pick.r2), s.rows.length), lim(Math.min(pick.c, pick.c2), s.cols.length), lim(Math.max(pick.r, pick.r2), s.rows.length), lim(Math.max(pick.c, pick.c2), s.cols.length));
  };
  const pickedRect = () => { const g = range(); return g && blockRect(sheet(), g.r0, g.c0, g.r1, g.c1); };
  // the picked tile becomes the selection (not an undo step: picking isn't an edit)
  const selectPicked = () => {
    const r = pickedRect(), d = doc();
    if (!r || !app.opts.tileClip) return;
    d.selection.edit('Pick Tile', c => { c.clearRect(0, 0, d.w, d.h); c.fillStyle = '#fff'; c.fillRect(r.x, r.y, r.w, r.h); }, false);
  };
  const changed = () => { app.view.redraw(); bus.emit('tile', range()); };
  const api = {
    get pick() { return range(); },
    pickedRect,
    select(r, c, extend = false) {
      const s = sheet();
      if (!s || r < 0 || c < 0 || r >= s.rows.length || c >= s.cols.length) return;
      pick = extend && pick ? { ...pick, r2: r, c2: c } : { r, c, r2: r, c2: c };
      selectPicked(); changed();
    },
    cellAt: p => cellAt(sheet(), Math.floor(p.x), Math.floor(p.y)),
    // before a stroke: in a gutter nothing is drawn; in another tile, that tile is picked first
    beforeStroke(p) {
      const s = sheet();
      if (!s || !app.opts.tileClip) return true;
      const t = api.cellAt(p);
      if (!t) return false;
      const g = range();
      if (!g || t.r < g.r0 || t.r > g.r1 || t.c < g.c0 || t.c > g.c1) api.select(t.r, t.c);
      return true;
    },

    async setup() {
      const d = doc(), s = d.sheet;
      const v = await form(s ? 'Tilesheet Settings' : 'Make a Tilesheet', [
        { id: 'tw', label: 'Tile width (px)', value: s?.tw ?? Math.min(d.w, 16), min: 1, max: MAX },
        { id: 'th', label: 'Tile height (px)', value: s?.th ?? Math.min(d.h, 16), min: 1, max: MAX },
        { id: 'cols', label: 'Columns', value: s?.cols.length ?? Math.max(1, Math.floor(d.w / Math.min(d.w, 16))), min: 1, max: 64 },
        { id: 'rows', label: 'Rows', value: s?.rows.length ?? Math.max(1, Math.floor(d.h / Math.min(d.h, 16))), min: 1, max: 64 },
        { id: 'gap', label: 'Spacing between tiles', value: s?.gap ?? 0, min: 0, max: 32 },
        { id: 'pad', label: 'Margin around the sheet', value: s?.pad ?? 0, min: 0, max: 32 },
        ...(s ? [{ id: 'all', label: 'Resize every tile to the tile size', type: 'checkbox', value: false }] : []),
      ], s ? 'Apply' : 'Make tilesheet');
      if (!v) return;
      const tw = cl(v.tw | 0, 1, MAX), th = cl(v.th | 0, 1, MAX), cols = cl(v.cols | 0, 1, 64), rows = cl(v.rows | 0, 1, 64);
      const g = makeSheet(1, 1, tw, th, cl(v.gap | 0, 0, 32), cl(v.pad | 0, 0, 32));
      g.cols = Array(cols).fill(tw); g.rows = Array(rows).fill(th);
      g.tiles = g.rows.map(() => g.cols.map(() => ({ name: '' })));
      if (s) {   // names stay with their tile; rows and columns keep their own sizes unless asked
        g.tiles.forEach((row, r) => row.forEach((t, c) => { t.name = s.tiles[r]?.[c]?.name ?? ''; }));
        if (!v.all) { g.cols = g.cols.map((w, c) => s.cols[c] ?? w); g.rows = g.rows.map((h, r) => s.rows[r] ?? h); }
        g.spans = s.spans;
      }
      const size = sheetSize(g);
      if (size.w > MAX || size.h > MAX) return app.toast(`That sheet would be ${size.w} × ${size.h}px: the canvas stops at ${MAX}`);
      app.tool.interrupt?.();
      d.reshapeSheet(s ? 'Tilesheet Settings' : 'Make Tilesheet', g, s ? s.rows.map((_, i) => (i < rows ? i : -1)) : null, s ? s.cols.map((_, i) => (i < cols ? i : -1)) : null);
      d.pixelArt = true;
      if (!s) { app.setOpt('tileClip', app.opts.tileClip ?? true); api.select(0, 0); app.setTool('tile'); app.view.fit(); app.toast('Tilesheet made: click a tile to work in it; the Tiles panel adds rows and columns'); }
    },
    off() {
      const d = doc();
      if (!d.sheet) return;
      d.setSheet('Remove Tile Grid', null);
      pick = null; d.selection.edit('Pick Tile', c => c.clearRect(0, 0, d.w, d.h), false);
      if (app.tool.id === 'tile') app.setTool('pencil');
      changed();
      app.toast('Tile grid removed: the artwork is untouched');
    },
    async rename() {
      const g = range(); if (!g) return app.toast('Pick a tile first');
      const s = sheet(), v = await form('Rename Tile', [{ id: 'name', label: 'Name (used as its file name when you export tiles)', type: 'text', value: s.tiles[g.r0][g.c0].name }], 'Rename');
      if (v == null) return;
      const n = cloneSheet(s); n.tiles[g.r0][g.c0].name = v.name.trim().slice(0, 64);
      doc().setSheet('Rename Tile', n);
    },
    clear() {
      const r = pickedRect(), d = doc(), l = d.activeLayer;
      if (!r) return app.toast('Pick a tile first');
      if (!l || l.locked || l.type !== 'layer') return app.toast('Select an unlocked layer');
      d.editPixels('Clear Tile', l, r, ctx => ctx.clearRect(r.x, r.y, r.w, r.h));
    },
    join() {
      const g = range(), s = sheet();
      if (!g || (g.r0 === g.r1 && g.c0 === g.c1)) return app.toast('Shift-click a second tile first: Join merges everything between the two');
      const n = cloneSheet(s);
      n.spans = n.spans.filter(p => p.r + p.rs - 1 < g.r0 || p.r > g.r1 || p.c + p.cs - 1 < g.c0 || p.c > g.c1);
      let name = '';
      for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) { name ||= n.tiles[r][c].name; n.tiles[r][c].name = ''; }
      n.tiles[g.r0][g.c0].name = name;
      n.spans.push({ r: g.r0, c: g.c0, rs: g.r1 - g.r0 + 1, cs: g.c1 - g.c0 + 1 });
      doc().setSheet('Join Tiles', n);
      pick = { r: g.r0, c: g.c0, r2: g.r0, c2: g.c0 }; selectPicked(); changed();
    },
    split() {
      const g = range(), s = sheet();
      const hit = g && s.spans.filter(p => !(p.r + p.rs - 1 < g.r0 || p.r > g.r1 || p.c + p.cs - 1 < g.c0 || p.c > g.c1));
      if (!hit?.length) return app.toast('That isn’t a joined tile: nothing to split');
      const n = cloneSheet(s); n.spans = n.spans.filter(p => !hit.some(q => q.r === p.r && q.c === p.c));
      doc().setSheet('Split Tile', n);
      pick = { r: g.r0, c: g.c0, r2: g.r0, c2: g.c0 }; selectPicked(); changed();
    },
    // a new row or column takes the size of the one beside it; the new tile is picked
    insert(dir) {
      const g = range(), s = sheet();
      if (!g) return app.toast('Pick a tile first: the new one goes next to it');
      const n = cloneSheet(s), rowWise = dir === 'up' || dir === 'down', at = { up: g.r0, down: g.r1 + 1, left: g.c0, right: g.c1 + 1 }[dir];
      if (rowWise) { n.rows.splice(at, 0, s.rows[dir === 'up' ? g.r0 : g.r1]); n.tiles.splice(at, 0, n.cols.map(() => ({ name: '' }))); }
      else { n.cols.splice(at, 0, s.cols[dir === 'left' ? g.c0 : g.c1]); n.tiles.forEach(row => row.splice(at, 0, { name: '' })); }
      const size = sheetSize(n);
      if (size.w > MAX || size.h > MAX) return app.toast(`The canvas stops at ${MAX}px`);
      const shift = i => (i < at ? i : i + 1);
      doc().reshapeSheet(rowWise ? 'Add Tile Row' : 'Add Tile Column', n, rowWise ? s.rows.map((_, i) => shift(i)) : null, rowWise ? null : s.cols.map((_, i) => shift(i)));
      api.select(rowWise ? at : g.r0, rowWise ? g.c0 : at);
    },
    remove(what) {
      const g = range(), s = sheet();
      if (!g) return app.toast('Pick a tile first');
      const rowWise = what === 'row', at = rowWise ? g.r0 : g.c0;
      if ((rowWise ? s.rows : s.cols).length < 2) return app.toast(`A tilesheet needs at least one ${what}`);
      const n = cloneSheet(s);
      if (rowWise) { n.rows.splice(at, 1); n.tiles.splice(at, 1); } else { n.cols.splice(at, 1); n.tiles.forEach(row => row.splice(at, 1)); }
      const map = i => (i === at ? -1 : i < at ? i : i - 1);
      doc().reshapeSheet(rowWise ? 'Delete Tile Row' : 'Delete Tile Column', n, rowWise ? s.rows.map((_, i) => map(i)) : null, rowWise ? null : s.cols.map((_, i) => map(i)));
      api.select(cl(g.r0, 0, n.rows.length - 1), cl(g.c0, 0, n.cols.length - 1));
    },
    setClip(on) {
      app.setOpt('tileClip', on);
      const d = doc();
      if (on) selectPicked(); else if (pick) d.selection.edit('Pick Tile', c => c.clearRect(0, 0, d.w, d.h), false);
      changed();
    },
    async export() {
      const s = sheet(); if (!s) return app.toast('This drawing isn’t a tilesheet yet');
      const list = tileBlocks(s), d = doc();
      const v = await form('Export Tiles', [
        { id: 'scale', label: 'Scale', type: 'select', options: [['1', '1× (true pixels)'], ['2', '2×'], ['4', '4×'], ['8', '8×']], value: '1' },
        { id: 'mode', label: 'Output', type: 'select', options: [['sheet', 'The whole sheet: one PNG'], ['files', `One PNG per tile (${list.length})`]], value: 'sheet' },
        { id: 'json', label: 'Include a JSON map of the tiles', type: 'checkbox', value: true },
      ], 'Export');
      if (!v) return;
      const k = +v.scale, base = d.name || 'tiles', flat = flatten(d, d.frame, { camera: false });
      const scaled = (r = { x: 0, y: 0, w: d.w, h: d.h }) => { const c = makeCanvas(r.w * k, r.h * k), x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(flat, r.x, r.y, r.w, r.h, 0, 0, r.w * k, r.h * k); return c; };
      const files = v.mode === 'files' ? list.map(t => ({ t, file: `${safe(t.name)}.png` })) : null;
      const json = { app: 'PixelPaint', image: files ? undefined : `${base}.png`, scale: k,
        sheet: { w: d.w * k, h: d.h * k, tileW: s.tw * k, tileH: s.th * k, spacing: s.gap * k, margin: s.pad * k, columns: s.cols.length, rows: s.rows.length },
        tiles: list.map((t, i) => ({ index: i, name: t.name, row: t.r, col: t.c, x: t.rect.x * k, y: t.rect.y * k, w: t.rect.w * k, h: t.rect.h * k, file: files?.[i].file })) };
      const out = files ? await Promise.all(files.map(async ({ t, file }) => ({ name: file, data: await toBlob(scaled(t.rect)) }))) : [{ name: `${base}.png`, data: await toBlob(scaled()) }];
      if (v.json) out.push({ name: `${base}_tiles.json`, data: JSON.stringify(json, null, 1) });
      if (out.length === 1) download(out[0].data, out[0].name);
      else download(await zip(out, 'application/zip'), `${base}_tiles.zip`);
    },
  };

  // the overlay: dim the gutters, draw tile edges (per block when tiles are joined), the picked tile
  app.view.overlays.add({
    draw(ctx, view) {
      const s = sheet();
      if (!s || app.opts.showTiles === false) return;
      const d = doc(), z = view.zoom;
      ctx.save();
      ctx.setTransform(new DOMMatrix().scale(view.dpr).multiply(view.matrix));
      if (s.gap || s.pad) {
        const p = new Path2D(); p.rect(0, 0, d.w, d.h);
        s.rows.forEach((_, r) => s.cols.forEach((_, c) => { const t = tileRect(s, r, c); p.rect(t.x, t.y, t.w, t.h); }));
        ctx.fillStyle = 'rgba(8,10,16,.4)'; ctx.fill(p, 'evenodd');
      }
      const edges = new Path2D();
      for (const b of tileBlocks(s)) edges.rect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
      ctx.lineWidth = 1 / z;
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke(edges);
      ctx.setLineDash([4 / z, 4 / z]); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.stroke(edges); ctx.setLineDash([]);
      const r = pickedRect();
      if (r) {
        if (app.tool.id === 'tile') { ctx.fillStyle = 'rgba(44,232,245,.10)'; ctx.fillRect(r.x, r.y, r.w, r.h); }
        ctx.lineWidth = 2 / z; ctx.strokeStyle = '#2ce8f5'; ctx.strokeRect(r.x + 1 / z, r.y + 1 / z, r.w - 2 / z, r.h - 2 / z);
      }
      ctx.restore();
      // the picked tile's name, upright on screen whatever the view's turn
      const g = range();
      if (r && g && app.tool.id === 'tile') {
        const label = tileName(s, g.r0, g.c0), p = view.toScreen(r.x, r.y);
        ctx.save(); ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        ctx.font = '600 11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
        const w = ctx.measureText(label).width + 10, y = Math.max(10, p.y - 11);
        ctx.fillStyle = 'rgba(18,21,28,.92)'; ctx.fillRect(p.x, y - 8, w, 16);
        ctx.fillStyle = '#2ce8f5'; ctx.fillText(label, p.x + 5, y + 0.5);
        ctx.restore();
      }
    },
  });
  bus.on('sheet', () => { if (pick && !range()) pick = null; changed(); });
  bus.on('doc', () => { pick = null; bus.emit('tile', null); });
  return api;
}

// The Tiles panel: set a grid up, then everything you do to the picked tile.
export function tilesPanel(app, tiles) {
  const body = h('div.tiles-panel');
  const b = (ic, label, tip, fn, extra = '') => h(`button.btn.sm${extra}`, { type: 'button', 'data-tip': tip, onclick: fn }, icon(ic), label);
  const render = () => {
    const s = app.doc?.sheet, g = tiles.pick;
    if (!s) return body.replaceChildren(h('p.muted', {}, 'Cut this canvas into a grid of named tiles: a tileset you can draw across, then export tile by tile.'), b('grid', 'Make a tilesheet…', 'Set up a tile grid on this canvas', () => tiles.setup(), '.primary'));
    const r = tiles.pickedRect(), clip = h('input', { type: 'checkbox', checked: app.opts.tileClip !== false, onchange: () => tiles.setClip(clip.checked) });
    const show = h('input', { type: 'checkbox', checked: app.opts.showTiles !== false, onchange: () => { app.setOpt('showTiles', show.checked); app.view.redraw(); } });
    body.replaceChildren(
      h('div.tiles-head', {}, h('b', {}, g ? tileName(s, g.r0, g.c0) : 'No tile picked'), h('span.muted', {}, r ? `${r.w} × ${r.h}px` : `${s.cols.length} × ${s.rows.length} tiles`)),
      h('div.tiles-row', {}, b('text', 'Rename', 'Rename the picked tile', () => tiles.rename()), b('eraser', 'Clear', 'Clear the picked tile on this layer', () => tiles.clear()),
        b('merge', 'Join', 'Join the picked tiles into one (Shift-click a second tile first)', () => tiles.join()), b('copy', 'Split', 'Split a joined tile back into its cells', () => tiles.split())),
      h('div.tiles-pad', {},
        h('span'), b('plus', 'Row', 'Add a row above', () => tiles.insert('up')), h('span'),
        b('plus', 'Col', 'Add a column to the left', () => tiles.insert('left')), b('trash', 'Row', 'Delete this row', () => tiles.remove('row')), b('plus', 'Col', 'Add a column to the right', () => tiles.insert('right')),
        h('span'), b('plus', 'Row', 'Add a row below', () => tiles.insert('down')), b('trash', 'Col', 'Delete this column', () => tiles.remove('col'))),
      h('label.toggle', {}, clip, h('span.tg'), h('span', {}, 'Keep strokes inside one tile')),
      h('label.toggle', {}, show, h('span.tg'), h('span', {}, 'Show the tile grid')),
      h('div.tiles-row', {}, b('settings', 'Settings…', 'Tile size, grid, spacing and margin', () => tiles.setup()), b('download', 'Export…', 'Export the sheet or each tile, with a JSON map', () => tiles.export())),
      b('x', 'Remove the tile grid', 'Keep the artwork, drop the grid and tile names', () => tiles.off()));
  };
  ['tile', 'sheet', 'doc', 'opts'].forEach(ev => bus.on(ev, render));
  render();
  return body;
}
