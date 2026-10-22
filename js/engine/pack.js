// Packing many files into one sheet (from Sprite Studio): sprites arrive as PNGs, PixelPaint /
// Aseprite / Sprite Studio projects or ready-made tilesheets. Files are read once into sources (a
// project keeps its frames and tags, a tilesheet its grid); the layout options then derive sprites
// from those without reading again, so the preview can redraw on every change.
import { makeCanvas } from '../core/util.js';
import { flatten } from './compositor.js';
import { decodeAseprite } from './aseprite.js';
import { decodePP } from './serializer.js';
import { decodeSpriteProject, isSpriteProject } from './spriteProject.js';
import { tileRect, tileName } from './tiles.js';

export const MAX_PACK = 400;
const base = f => (f.name || 'sprite').replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, ' ').replace(/\s+/g, ' ').trim() || 'sprite';
const framesOf = d => d.frames.map((_, f) => flatten(d, f, { camera: false }));

export async function readPackFile(f) {
  const name = base(f);
  let doc = null;
  if (/\.ase(prite)?$/i.test(f.name)) doc = (await decodeAseprite(await f.arrayBuffer())).doc;
  else if (/\.pp$/i.test(f.name)) doc = await decodePP(f);
  else if (isSpriteProject(f)) doc = await decodeSpriteProject(await f.text());
  if (doc) return { base: name, frames: framesOf(doc), w: doc.w, h: doc.h, tags: doc.tags, grid: doc.sheet ?? null };
  const img = await createImageBitmap(f).catch(() => { throw new Error('not an image this browser can read'); });
  const c = makeCanvas(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0);
  return { base: name, frames: [c], w: c.width, h: c.height, tags: [], grid: null };
}

function trimCanvas(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0, i = 3; y < c.height; y++) for (let x = 0; x < c.width; x++, i += 4) if (d[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  if (x1 < 0) return null;
  if (!x0 && !y0 && x1 === c.width - 1 && y1 === c.height - 1) return c;
  const o = makeCanvas(x1 - x0 + 1, y1 - y0 + 1); o.getContext('2d').drawImage(c, -x0, -y0);
  return o;
}

// sources → named sprites. A tag inside a project becomes its own group, so "one row per animation"
// gives idle and walk a row each; a tilesheet can be split into its tiles.
export function packSprites(sources, o) {
  const out = [], dropped = [];
  for (const s of sources) s.frames.forEach((fc, fi) => {
    if (s.grid && o.splitTiles) {
      s.grid.rows.forEach((_, r) => s.grid.cols.forEach((_, c) => {
        const t = tileRect(s.grid, r, c), cv = makeCanvas(t.w, t.h);
        cv.getContext('2d').drawImage(fc, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
        out.push({ name: `${s.base} ${tileName(s.grid, r, c)}${s.frames.length > 1 ? ` f${fi + 1}` : ''}`, canvas: cv, file: s.base, group: s.base });
      }));
    } else {
      const tag = s.tags.find(t => fi >= t.from && fi <= t.to);
      out.push({ name: s.base + (s.frames.length > 1 ? ` ${tag ? `${tag.name} ` : ''}${fi + 1}` : ''), canvas: fc, file: s.base, group: s.base + (tag ? ` ${tag.name}` : '') });
    }
  });
  const kept = [];
  let truncated = 0;
  for (const sp of out) {
    const t = trimCanvas(sp.canvas);   // an all-transparent sprite is a blank cell mid-sheet: never what you meant
    if (!t) { dropped.push(sp.name); continue; }
    if (kept.length >= MAX_PACK) { truncated++; continue; }
    kept.push({ ...sp, canvas: o.trim ? t : sp.canvas });
  }
  return { sprites: kept, dropped, truncated };
}

const cl = (v, a, b) => Math.max(a, Math.min(b, v));
export function packPlan(sprites, o) {
  const cw = cl(o.cw | 0 || Math.max(1, ...sprites.map(s => s.canvas.width)), 1, 2048);
  const ch = cl(o.ch | 0 || Math.max(1, ...sprites.map(s => s.canvas.height)), 1, 2048);
  let rows = [];
  if (o.layout === 'rowfile' || o.layout === 'rowper') {
    const key = o.layout === 'rowfile' ? s => s.file : s => s.group, by = new Map();
    sprites.forEach(s => { if (!by.has(key(s))) by.set(key(s), []); by.get(key(s)).push(s); });
    rows = [...by.values()];
  } else if (o.layout === 'row') rows = sprites.length ? [sprites.slice()] : [];
  else if (o.layout === 'col') rows = sprites.map(s => [s]);
  else { const n = o.cols | 0 || Math.max(1, Math.ceil(Math.sqrt(sprites.length))); for (let i = 0; i < sprites.length; i += n) rows.push(sprites.slice(i, i + n)); }
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0), gap = cl(o.gap | 0, 0, 64), pad = cl(o.pad | 0, 0, 64), scale = cl(o.scale | 0 || 1, 1, 8);
  const cells = rows.flatMap((r, ri) => r.map((s, ci) => ({ s, r: ri, c: ci, cx: pad + ci * (cw + gap), cy: pad + ri * (ch + gap) })));
  return { cells, cols, nrows: rows.length, cw, ch, gap, pad, scale, w: pad * 2 + cols * cw + gap * Math.max(0, cols - 1), h: pad * 2 + rows.length * ch + gap * Math.max(0, rows.length - 1) };
}

// each sprite sits in its cell (aligned) and is clipped to it, never bleeding into the next
export function drawPack(plan, o, S = plan.scale) {
  const out = makeCanvas(Math.max(1, plan.w * S), Math.max(1, plan.h * S)), x = out.getContext('2d');
  x.imageSmoothingEnabled = false;
  for (const cell of plan.cells) {
    const sw = cell.s.canvas.width, sh = cell.s.canvas.height;
    let dx = cell.cx, dy = cell.cy;
    if (o.align !== 'topleft') dx += Math.round((plan.cw - sw) / 2);
    if (o.align === 'center') dy += Math.round((plan.ch - sh) / 2);
    if (o.align === 'bottom') dy += plan.ch - sh;
    Object.assign(cell, { x: dx, y: dy, w: sw, h: sh });
    x.save(); x.beginPath(); x.rect(cell.cx * S, cell.cy * S, plan.cw * S, plan.ch * S); x.clip();
    x.drawImage(cell.s.canvas, dx * S, dy * S, sw * S, sh * S);
    x.restore();
  }
  return out;
}

export function packJSON(image, plan) {
  const S = plan.scale;
  return { app: 'PixelPaint', image, scale: S,
    sheet: { w: plan.w * S, h: plan.h * S, cellW: plan.cw * S, cellH: plan.ch * S, spacing: plan.gap * S, margin: plan.pad * S, columns: plan.cols, rows: plan.nrows },
    sprites: plan.cells.map((c, i) => ({ index: i, name: c.s.name, row: c.r, col: c.c, x: c.cx * S, y: c.cy * S, w: plan.cw * S, h: plan.ch * S, sprite: { x: c.x * S, y: c.y * S, w: c.w * S, h: c.h * S } })) };
}

// the packed sheet's tile grid, every cell named after the sprite it holds
export function packSheet(plan) {
  const cols = Array(plan.cols).fill(plan.cw), rows = Array(plan.nrows).fill(plan.ch);
  const tiles = rows.map(() => cols.map(() => ({ name: '' })));
  plan.cells.forEach(c => { tiles[c.r][c.c].name = c.s.name.slice(0, 64); });
  return { tw: plan.cw, th: plan.ch, gap: plan.gap, pad: plan.pad, cols, rows, tiles, spans: [] };
}
