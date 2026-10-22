// Tilesheet geometry: a document can carry a grid of tiles (doc.sheet) — column widths, row heights,
// a gap between cells and a margin around them, a name per tile, and joined blocks of cells (spans)
// that act as one bigger tile. Pure functions over the plain sheet object; the Tiles panel and tool
// (ui/tilesPanel.js, tools/tile.js) edit it.
export function makeSheet(w, h, tw, th, gap = 0, pad = 0) {
  const fit = (size, t) => Math.max(1, Math.floor((size - 2 * pad + gap) / (t + gap)));
  const cols = Array(fit(w, tw)).fill(tw), rows = Array(fit(h, th)).fill(th);
  return { tw, th, gap, pad, cols, rows, tiles: rows.map(() => cols.map(() => ({ name: '' }))), spans: [] };
}
export function tileRect(s, r, c) {
  if (!s || s.rows[r] == null || s.cols[c] == null) return null;
  let x = s.pad, y = s.pad;
  for (let i = 0; i < c; i++) x += s.cols[i] + s.gap;
  for (let i = 0; i < r; i++) y += s.rows[i] + s.gap;
  return { x, y, w: s.cols[c], h: s.rows[r] };
}
export function blockRect(s, r0, c0, r1, c1) {
  const a = tileRect(s, r0, c0), b = tileRect(s, r1, c1);
  return a && b ? { x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y } : null;
}
export const spanAt = (s, r, c) => s?.spans?.find(p => r >= p.r && r < p.r + p.rs && c >= p.c && c < p.c + p.cs) ?? null;
// a cell range grown until every joined tile it touches is whole
export function expandRange(s, r0, c0, r1, c1) {
  for (let changed = true; changed;) {
    changed = false;
    for (const p of s.spans ?? []) {
      if (p.r + p.rs - 1 < r0 || p.r > r1 || p.c + p.cs - 1 < c0 || p.c > c1) continue;
      const n = [Math.min(r0, p.r), Math.min(c0, p.c), Math.max(r1, p.r + p.rs - 1), Math.max(c1, p.c + p.cs - 1)];
      if (n[0] !== r0 || n[1] !== c0 || n[2] !== r1 || n[3] !== c1) { [r0, c0, r1, c1] = n; changed = true; }
    }
  }
  return { r0, c0, r1, c1 };
}
// the cell under a document point, or null in a gap / outside
export function cellAt(s, x, y) {
  if (!s) return null;
  let r = -1, c = -1;
  for (let i = 0, yy = s.pad; i < s.rows.length; yy += s.rows[i] + s.gap, i++) if (y >= yy && y < yy + s.rows[i]) { r = i; break; }
  for (let i = 0, xx = s.pad; i < s.cols.length; xx += s.cols[i] + s.gap, i++) if (x >= xx && x < xx + s.cols[i]) { c = i; break; }
  return r < 0 || c < 0 ? null : { r, c };
}
export const sheetSize = s => ({ w: 2 * s.pad + s.cols.reduce((a, b) => a + b, 0) + s.gap * (s.cols.length - 1), h: 2 * s.pad + s.rows.reduce((a, b) => a + b, 0) + s.gap * (s.rows.length - 1) });
export const tileName = (s, r, c) => s?.tiles?.[r]?.[c]?.name || `Tile ${r + 1}·${c + 1}`;
