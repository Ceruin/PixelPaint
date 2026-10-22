// File > Pack Files into a Sheet: pick images or projects, arrange them with a live preview, then
// download the sheet (PNG + a JSON map of what went where) or open it as a new tilesheet canvas
// where every cell is already a named tile.
import { h } from './dom.js';
import { modal } from './dialogs.js';
import { pickFiles, download, toBlob } from '../core/util.js';
import { zip } from '../engine/zip.js';
import { Doc } from '../engine/document.js';
import { readPackFile, packSprites, packPlan, drawPack, packJSON, packSheet } from '../engine/pack.js';

const LAYOUTS = [['grid', 'Grid'], ['row', 'One row'], ['col', 'One column'], ['rowfile', 'A row per file'], ['rowper', 'A row per animation']];
const ALIGN = [['center', 'Centred'], ['bottom', 'Bottom (feet on the floor)'], ['topleft', 'Top left']];

export async function packFiles(app) {
  const files = await pickFiles('image/*,.pp,.aseprite,.ase,.pxpaint');
  if (!files?.length) return;
  const sources = [], failed = [];
  for (const f of files) { try { sources.push(await readPackFile(f)); } catch (e) { failed.push(`${f.name}: ${e.message}`); } }
  if (!sources.length) return app.toast(failed[0] ?? 'Nothing to pack');
  const o = { layout: sources.some(s => s.frames.length > 1) ? 'rowper' : 'grid', cols: 0, cw: 0, ch: 0, gap: 0, pad: 0, align: 'center', trim: true, splitTiles: true, scale: 1 };
  const preview = h('canvas.pack-prev'), info = h('p.muted.pack-info');
  const field = (label, el) => h('label.field', {}, h('span', {}, label), el);
  const num = (k, max) => { const i = h('input', { type: 'number', min: 0, max, value: o[k], oninput: () => { o[k] = +i.value; draw(); } }); return i; };
  const sel = (k, opts) => { const s = h('select', { onchange: () => { o[k] = s.value; draw(); } }, opts.map(([v, l]) => h('option', { value: v }, l))); s.value = o[k]; return s; };
  const check = (k, label) => { const i = h('input', { type: 'checkbox', checked: o[k], onchange: () => { o[k] = i.checked; draw(); } }); return h('label.field.check', {}, h('span', {}, label), i); };
  let plan = null;
  const draw = () => {
    const { sprites, dropped, truncated } = packSprites(sources, o);
    plan = packPlan(sprites, o);
    const sheet = drawPack(plan, o, 1), k = Math.min(4, 520 / sheet.width, 300 / sheet.height);   // fit the box; small sheets shown up to 4×
    Object.assign(preview, { width: sheet.width, height: sheet.height });
    preview.style.width = `${Math.max(1, Math.round(sheet.width * k))}px`;
    preview.getContext('2d').drawImage(sheet, 0, 0);
    info.textContent = [`${sprites.length} sprites, ${plan.cols} × ${plan.nrows} cells of ${plan.cw} × ${plan.ch}px, sheet ${plan.w * plan.scale} × ${plan.h * plan.scale}px`,
      dropped.length && `${dropped.length} empty skipped`, truncated && `${truncated} over the 400 limit left out`, failed.length && `${failed.length} file(s) couldn’t be read`].filter(Boolean).join(' · ');
  };
  const grids = sources.some(s => s.grid);
  const body = h('div.pack', {},
    h('div.pack-box', {}, preview), info,
    h('div.pack-opts', {},
      field('Layout', sel('layout', LAYOUTS)), field('Columns (0 = auto)', num('cols', 256)),
      field('Cell width (0 = fit)', num('cw', 2048)), field('Cell height (0 = fit)', num('ch', 2048)),
      field('Gap', num('gap', 64)), field('Margin', num('pad', 64)), field('Align in cell', sel('align', ALIGN)), field('Scale', num('scale', 8)),
      check('trim', 'Trim empty space around each sprite'), grids && check('splitTiles', 'Split tilesheets into their tiles')));
  draw();
  const how = await modal('Pack Files into a Sheet', body, [['Cancel', null], ['Open as a canvas', 'open'], ['Download PNG + JSON', 'dl', true]], 'wide');
  if (!how || !plan.cells.length) return;
  const name = sources.length === 1 ? sources[0].base : 'sheet';
  if (how === 'dl') {
    const png = drawPack(plan, o);
    download(await zip([{ name: `${name}.png`, data: await toBlob(png) }, { name: `${name}.json`, data: JSON.stringify(packJSON(`${name}.png`, plan), null, 1) }], 'application/zip'), `${name}.zip`);
  } else {
    const d = new Doc(plan.w, plan.h, { bg: null });
    d.layers[0].name = 'Sheet';
    d.layers[0].ctx.drawImage(drawPack(plan, o, 1), 0, 0);
    Object.assign(d, { name, sheet: packSheet(plan) });
    d.pixelArt = true;
    app.setDoc(d);
    app.setTool('pencil');
  }
}
