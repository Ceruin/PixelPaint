import { flatten } from './compositor.js';

// Photoshop (.psd) export: raster layers with names, opacity, blend mode, visibility, clipping,
// and groups (section dividers). Channels are stored raw (uncompressed); filter layers are
// baked into the merged image only.
const KEYS = {
  'source-over': 'norm', multiply: 'mul ', screen: 'scrn', overlay: 'over', darken: 'dark', lighten: 'lite',
  'color-dodge': 'div ', 'color-burn': 'idiv', 'hard-light': 'hLit', 'soft-light': 'sLit', difference: 'diff',
  exclusion: 'smud', hue: 'hue ', saturation: 'sat ', color: 'colr', luminosity: 'lum ', lighter: 'lddg', pass: 'pass',
};

class Writer {
  constructor() { this.parts = []; }
  u8(v) { this.parts.push(new Uint8Array([v])); }
  u16(v) { const b = new DataView(new ArrayBuffer(2)); b.setUint16(0, v); this.parts.push(b); }
  i16(v) { const b = new DataView(new ArrayBuffer(2)); b.setInt16(0, v); this.parts.push(b); }
  u32(v) { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, v); this.parts.push(b); }
  i32(v) { const b = new DataView(new ArrayBuffer(4)); b.setInt32(0, v); this.parts.push(b); }
  str(s) { this.parts.push(new TextEncoder().encode(s)); }
  bytes(b) { this.parts.push(b); }
  get size() { return this.parts.reduce((s, p) => s + p.byteLength, 0); }
}

const pascal = (w, name, pad = 4) => {
  const b = new TextEncoder().encode(name).slice(0, 255);
  w.u8(b.length); w.bytes(b);
  for (let n = (1 + b.length) % pad; n && n < pad; n++) w.u8(0);
};

// Splits an RGBA region into planar channels [A, R, G, B].
function planes(canvas, r) {
  const d = canvas && r.w && r.h ? canvas.getContext('2d').getImageData(r.x, r.y, r.w, r.h).data : new Uint8ClampedArray(0);
  const n = r.w * r.h, out = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  for (let i = 0; i < n; i++) { out[0][i] = d[i * 4 + 3]; out[1][i] = d[i * 4]; out[2][i] = d[i * 4 + 1]; out[3][i] = d[i * 4 + 2]; }
  return out;
}

function tightBounds(c) {
  const { width: w, height: h } = c, d = c.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 3; y < h; y++) for (let x = 0; x < w; x++, i += 4) if (d[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function encodePSD(doc) {
  // Records run bottom → top; a group is: divider, children, then the group's own record.
  const recs = [];
  const walk = g => g.children.forEach(n => {
    if (n.type === 'group') {
      recs.push({ name: '</Layer group>', section: 3, r: { x: 0, y: 0, w: 0, h: 0 }, ch: planes(null, { w: 0, h: 0 }) });
      walk(n);
      recs.push({ name: n.name, section: n.collapsed ? 2 : 1, node: n, r: { x: 0, y: 0, w: 0, h: 0 }, ch: planes(null, { w: 0, h: 0 }) });
    } else if (n.type === 'layer') {
      const cel = n.view(doc.frame), r = cel ? tightBounds(cel) : { x: 0, y: 0, w: 0, h: 0 };
      recs.push({ name: n.name, node: n, r, ch: planes(cel, r) });
    }
  });
  walk(doc.root);

  const li = new Writer();
  li.i16(recs.length);
  for (const rec of recs) {
    const { r, node } = rec, len = r.w * r.h;
    li.i32(r.y); li.i32(r.x); li.i32(r.y + r.h); li.i32(r.x + r.w);
    li.u16(4);
    [-1, 0, 1, 2].forEach(id => { li.i16(id); li.u32(2 + len); });
    li.str('8BIM');
    li.str(KEYS[node?.blend ?? 'source-over'] ?? 'norm');
    li.u8(Math.round((node?.opacity ?? 1) * 255));
    li.u8(node?.clip ? 1 : 0);
    li.u8((node && !node.visible ? 2 : 0) | 8);
    li.u8(0);
    const extra = new Writer();
    extra.u32(0); extra.u32(0);
    pascal(extra, rec.name);
    const name16 = [...rec.name].map(c => c.charCodeAt(0) > 0xffff ? '?' : c);
    extra.str('8BIMluni'); extra.u32(4 + name16.length * 2 + (name16.length % 2 ? 2 : 0)); extra.u32(name16.length);
    name16.forEach(c => extra.u16(c.charCodeAt(0)));
    if (name16.length % 2) extra.u16(0);
    if (rec.section) { extra.str('8BIMlsct'); extra.u32(4); extra.u32(rec.section); }
    li.u32(extra.size); li.parts.push(...extra.parts);
  }
  for (const rec of recs) rec.ch.forEach(p => { li.u16(0); li.bytes(p); });
  if (li.size % 2) li.u8(0);

  const out = new Writer();
  out.str('8BPS'); out.u16(1); out.bytes(new Uint8Array(6)); out.u16(4); out.u32(doc.h); out.u32(doc.w); out.u16(8); out.u16(3);
  out.u32(0);
  out.u32(0);
  out.u32(4 + li.size + 4);
  out.u32(li.size); out.parts.push(...li.parts);
  out.u32(0);
  const merged = planes(flatten(doc), { x: 0, y: 0, w: doc.w, h: doc.h });
  out.u16(0);
  [merged[1], merged[2], merged[3], merged[0]].forEach(p => out.bytes(p));
  return new Blob(out.parts, { type: 'image/vnd.adobe.photoshop' });
}
