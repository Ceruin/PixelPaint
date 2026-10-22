// Sprite Studio projects (.pxpaint): JSON with frames, each carrying its own layer list as PNG data
// URLs, plus tags and an optional tile grid. Opened as a Draw document: layers are matched by their
// place in the stack (frames built by duplicating share it), a frame with fewer layers leaves the
// rest empty there, and the tile grid comes along as the document's tilesheet.
import { Doc, Layer, BLANK } from './document.js';

const MAX = 4096;
export const isSpriteProject = f => /\.(pxpaint|json)$/i.test(f.name);

export function sanitizeSheet(s, w, h) {
  if (!s || !Array.isArray(s.cols) || !Array.isArray(s.rows) || !s.cols.length || !s.rows.length) return null;
  const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }, cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const g = { tw: cl(int(s.tw, 16), 1, MAX), th: cl(int(s.th, 16), 1, MAX), gap: cl(int(s.gap, 0), 0, 64), pad: cl(int(s.pad, 0), 0, 64),
    cols: s.cols.map(v => cl(int(v, 1), 1, MAX)), rows: s.rows.map(v => cl(int(v, 1), 1, MAX)) };
  g.tiles = g.rows.map((_, r) => g.cols.map((_, c) => ({ name: typeof s.tiles?.[r]?.[c]?.name === 'string' ? s.tiles[r][c].name.slice(0, 64) : '' })));
  g.spans = (Array.isArray(s.spans) ? s.spans : []).map(p => ({ r: p.r | 0, c: p.c | 0, rs: p.rs | 0, cs: p.cs | 0 }))
    .filter(p => p.rs >= 1 && p.cs >= 1 && p.rs * p.cs > 1 && p.r + p.rs <= g.rows.length && p.c + p.cs <= g.cols.length);
  return g;
}

const image = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad layer image')); i.src = src; });

export async function decodeSpriteProject(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file isn’t readable'); }
  if (Array.isArray(data) || Array.isArray(data?.colors)) throw new Error('That’s a palette: load it from the Palette panel');
  if (!data?.w || !(data.frames || data.layers)) throw new Error('That file isn’t a Sprite Studio project');
  const w = Math.min(MAX, data.w | 0), h = Math.min(MAX, data.h | 0);
  const frames = data.frames ?? [{ dur: 100, layers: data.layers ?? [] }];
  const doc = new Doc(w, h, { empty: true });
  doc.frames = frames.map(f => ({ duration: f.dur || 100 }));
  const n = Math.max(1, ...frames.map(f => f.layers?.length ?? 0)), first = frames.find(f => f.layers?.length)?.layers ?? [];
  const layers = Array.from({ length: n }, (_, i) => {
    const l = new Layer(doc, first[i]?.name || `Layer ${i + 1}`);
    Object.assign(l, { visible: first[i]?.visible !== false, opacity: first[i]?.opacity ?? 1 });
    doc.root.children.push(l); doc.count++;
    return l;
  });
  for (let f = 0; f < frames.length; f++) for (let i = 0; i < n; i++) {
    const src = frames[f].layers?.[i]?.data;
    if (!src) { layers[i].cels[f] = BLANK; continue; }
    try { layers[i].cel(f, true).getContext('2d').drawImage(await image(src), 0, 0); } catch { layers[i].cels[f] = BLANK; }
  }
  doc.tags = (data.tags ?? []).filter(t => t?.name).map(t => ({ name: t.name, from: t.from | 0, to: t.to | 0, color: t.color || '#5b8cff', dir: 'forward' }));
  doc.active = layers[Math.min(n - 1, data.active ?? n - 1)] ?? layers.at(-1);
  doc.frame = Math.min(data.frameIndex | 0, frames.length - 1);
  doc.pixelArt = true;
  doc.sheet = sanitizeSheet(data.sheet, w, h);
  return doc;
}
