// Aseprite files (.aseprite / .ase), both ways. Spec: github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
// Export: 32-bit RGBA, one layer chunk per raster layer (groups become nested group layers), a cel
// per layer per keyframe (zlib through CompressionStream), held frames as linked cels, the palette
// and the frame tags. Import: RGBA, grayscale and indexed sprites; raw, compressed and linked cels;
// groups (as folders), tags and per-frame durations. Tilemap cels are skipped.
import { Doc, Layer, Group, BLANK } from './document.js';
import { makeCanvas } from '../core/util.js';
const copyOf = c => { const k = makeCanvas(c.width, c.height); k.getContext('2d').drawImage(c, 0, 0); return k; };

const zip = async (bytes, mode) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(mode === 'in' ? new DecompressionStream('deflate') : new CompressionStream('deflate'))).arrayBuffer());
const hexRGB = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));

class Out {
  constructor() { this.b = new Uint8Array(1 << 16); this.p = 0; }
  room(n) { if (this.p + n > this.b.length) { const nb = new Uint8Array(Math.max(this.b.length * 2, this.p + n)); nb.set(this.b); this.b = nb; } }
  u8(v) { this.room(1); this.b[this.p++] = v & 255; }
  u16(v) { this.u8(v); this.u8(v >>> 8); }
  i16(v) { this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v) { this.u16(v & 0xffff); this.u16(v >>> 16); }
  bytes(a) { this.room(a.length); this.b.set(a, this.p); this.p += a.length; }
  str(s) { const e = new TextEncoder().encode(s); this.u16(e.length); this.bytes(e); }
  skip(n) { this.room(n); this.p += n; }
  at(pos, v) { for (let i = 0; i < 4; i++) this.b[pos + i] = (v >>> (8 * i)) & 255; }
}

// The bounding box of a canvas's painted pixels and those pixels (RGBA), or null when empty.
function celPixels(c) {
  const { width: w, height: h } = c, d = c.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 3; y < h; y++) for (let x = 0; x < w; x++, i += 4) if (d[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, out = new Uint8Array(bw * bh * 4);
  for (let y = 0; y < bh; y++) out.set(d.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + bw) * 4), y * bw * 4);
  return { x: x0, y: y0, w: bw, h: bh, px: out };
}

export async function encodeAseprite(doc, palette = []) {
  // the layer tree, bottom to top, groups before their children (Aseprite's order)
  const rows = [];
  const walk = (g, level) => g.children.forEach(n => {
    if (n.type === 'group') { rows.push({ n, level, group: true }); walk(n, level + 1); }
    else if (n.type === 'layer') rows.push({ n, level });
  });
  walk(doc.root, 0);
  const pal = palette.slice(0, 256).map(hexRGB);
  if (!pal.length) pal.push([0, 0, 0], [255, 255, 255]);
  const o = new Out(), N = doc.frames.length;
  o.u32(0); o.u16(0xA5E0); o.u16(N); o.u16(doc.w); o.u16(doc.h); o.u16(32); o.u32(1); o.u16(doc.frames[0]?.duration ?? 100);
  o.u32(0); o.u32(0); o.u8(0); o.skip(3); o.u16(pal.length); o.u8(1); o.u8(1); o.i16(0); o.i16(0); o.u16(16); o.u16(16); o.skip(84);
  for (let f = 0; f < N; f++) {
    const start = o.p; o.u32(0); o.u16(0xF1FA); o.u16(0xFFFF); o.u16(doc.frames[f].duration ?? 100); o.skip(2);
    const countAt = o.p; o.u32(0);
    let chunks = 0;
    const chunk = (type, write) => { const s = o.p; o.u32(0); o.u16(type); write(); o.at(s, o.p - s); chunks++; };
    if (f === 0) {
      rows.forEach(({ n, level, group }) => chunk(0x2004, () => {
        o.u16((n.visible ? 1 : 0) | 2 | (n.locked ? 0 : 0)); o.u16(group ? 1 : 0); o.u16(level); o.u16(0); o.u16(0); o.u16(0);
        o.u8(Math.round((n.opacity ?? 1) * 255)); o.skip(3); o.str(n.name || (group ? 'Group' : 'Layer'));
      }));
      chunk(0x2019, () => { o.u32(pal.length); o.u32(0); o.u32(pal.length - 1); o.skip(8); pal.forEach(([r, g, b]) => { o.u16(0); o.u8(r); o.u8(g); o.u8(b); o.u8(255); }); });
      if (doc.tags.length) chunk(0x2018, () => {
        o.u16(doc.tags.length); o.skip(8);
        doc.tags.forEach(t => {
          const [r, g, b] = hexRGB(t.color || '#5b8cff');
          o.u16(Math.min(t.from, N - 1)); o.u16(Math.min(t.to, N - 1)); o.u8({ reverse: 1, pingpong: 2 }[t.dir] ?? 0); o.u16(0); o.skip(6); o.u8(r); o.u8(g); o.u8(b); o.u8(0); o.str(t.name || 'Tag');
        });
      });
    }
    for (let i = 0; i < rows.length; i++) {
      const { n, group } = rows[i];
      if (group) continue;
      const k = n.cels[f];
      if (k === undefined && f > 0) {   // a held frame: link to the keyframe it repeats
        let src = f - 1; while (src > 0 && n.cels[src] === undefined) src--;
        if (n.cels[src] && n.cels[src] !== BLANK) chunk(0x2005, () => { o.u16(i); o.i16(0); o.i16(0); o.u8(255); o.u16(1); o.i16(0); o.skip(5); o.u16(src); });
        continue;
      }
      const c = k && k !== BLANK ? celPixels(k) : null;
      if (!c) continue;
      const data = await zip(c.px, 'out');
      chunk(0x2005, () => { o.u16(i); o.i16(c.x); o.i16(c.y); o.u8(255); o.u16(2); o.i16(0); o.skip(5); o.u16(c.w); o.u16(c.h); o.bytes(data); });
    }
    o.at(start, o.p - start); o.at(countAt, chunks);
  }
  o.at(0, o.p);
  return new Blob([o.b.subarray(0, o.p)], { type: 'application/octet-stream' });
}

export async function decodeAseprite(buffer) {
  const v = new DataView(buffer), u8 = new Uint8Array(buffer);
  let p = 0;
  const r8 = () => v.getUint8(p++), r16 = () => { const x = v.getUint16(p, true); p += 2; return x; }, s16 = () => { const x = v.getInt16(p, true); p += 2; return x; };
  const r32 = () => { const x = v.getUint32(p, true); p += 4; return x; }, str = () => { const n = r16(), s = new TextDecoder().decode(u8.subarray(p, p + n)); p += n; return s; };
  r32(); if (r16() !== 0xA5E0) throw new Error('Not an Aseprite file');
  const N = r16(), W = r16(), H = r16(), depth = r16(); r32(); const speed = r16(); r32(); r32();
  const transparent = r8(); p += 3; r16(); p = 128;
  const doc = new Doc(W, H, { empty: true }), defs = [], palette = [];
  let gray = null;
  doc.frames = []; doc.tags = [];
  // pixels (any colour depth) → an RGBA canvas placed at x, y
  const toCanvas = (raw, w, h, x, y, alpha) => {
    const img = new ImageData(w, h), d = img.data;
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      if (depth === 32) { d[j] = raw[i * 4]; d[j + 1] = raw[i * 4 + 1]; d[j + 2] = raw[i * 4 + 2]; d[j + 3] = raw[i * 4 + 3]; }
      else if (depth === 16) { d[j] = d[j + 1] = d[j + 2] = raw[i * 2]; d[j + 3] = raw[i * 2 + 1]; }
      else { const k = raw[i]; if (k === transparent && !gray) continue; const c = palette[k] ?? [0, 0, 0, 255]; d[j] = c[0]; d[j + 1] = c[1]; d[j + 2] = c[2]; d[j + 3] = c[3]; }
    }
    const t = makeCanvas(w, h); t.getContext('2d').putImageData(img, 0, 0);
    const c = makeCanvas(W, H), ctx = c.getContext('2d'); ctx.globalAlpha = alpha; ctx.drawImage(t, x, y);
    return c;
  };
  const cels = [];
  for (let f = 0; f < N; f++) {
    const start = p, size = r32(); r16(); const old = r16(), dur = r16(); p += 2; const count = r32() || old;
    doc.frames.push({ duration: dur || speed || 100 });
    for (let c = 0; c < count; c++) {
      const cs = p, len = r32(), type = r16();
      if (type === 0x2004) {
        const flags = r16(), kind = r16(), level = r16(); r16(); r16(); r16(); const opacity = r8(); p += 3;
        defs.push({ name: str(), kind, level, visible: !!(flags & 1), opacity: opacity / 255 });
      } else if (type === 0x2005) {
        const li = r16(), x = s16(), y = s16(), op = r8(), ct = r16(); s16(); p += 5;
        if (ct === 1) cels.push({ f, li, link: r16() });
        else if (ct === 0 || ct === 2) {
          const w = r16(), h = r16(), raw = ct === 0 ? u8.subarray(p, cs + len) : await zip(u8.subarray(p, cs + len), 'in');
          cels.push({ f, li, w, h, x, y, op, raw });
        }
      } else if (type === 0x2019) {
        const n = r32(), from = r32(), to = r32(); p += 8;
        for (let i = from; i <= to && i < from + n; i++) { const fl = r16(); palette[i] = [r8(), r8(), r8(), r8()]; if (fl & 1) str(); }
      } else if (type === 0x0004 || type === 0x0011) {   // old palettes
        const packets = r16();
        for (let k = 0, i = 0; k < packets; k++) { i += r8(); let n = r8() || 256; while (n--) { const s = type === 0x0011 ? 4 : 1; palette[i++] = [r8() * s, r8() * s, r8() * s, 255].map(x => Math.min(255, x)); } }
      } else if (type === 0x2018) {
        const n = r16(); p += 8;
        for (let i = 0; i < n; i++) { const from = r16(), to = r16(), dir = r8(); r16(); p += 6; const rgb = [r8(), r8(), r8()]; p++; doc.tags.push({ name: str(), from, to, dir: ['forward', 'reverse', 'pingpong'][dir] ?? 'forward', color: `#${rgb.map(x => x.toString(16).padStart(2, '0')).join('')}` }); }
      }
      p = cs + len;
    }
    p = start + size;
  }
  gray = depth === 16;
  // rebuild the tree from child levels: each layer goes into the last group one level up
  const stack = [doc.root], made = defs.map(d => {
    const n = d.kind === 1 ? new Group(d.name) : new Layer(doc, d.name);
    Object.assign(n, { visible: d.visible, opacity: d.opacity });
    stack.length = Math.min(stack.length, d.level + 1);
    (stack.at(-1) ?? doc.root).children.push(n);
    if (d.kind === 1) stack.push(n); else doc.count++;
    return n;
  });
  // per layer and frame: a drawing, a link to another frame's drawing, or nothing (an empty frame)
  const at = new Map(cels.map(c => [`${c.li}:${c.f}`, c]));
  made.forEach((l, li) => {
    if (l.type !== 'layer') return;
    for (let f = 0; f < N; f++) {
      const c = at.get(`${li}:${f}`);
      if (!c) l.cels[f] = BLANK;
      else if (c.raw) l.cels[f] = toCanvas(c.raw, c.w, c.h, c.x, c.y, c.op / 255);
      else {   // linked: a hold when it repeats the frame just before (or that frame's own hold), else its own copy
        const src = l.view(c.link);
        const run = [...Array(f - c.link - 1)].every((_, i) => at.get(`${li}:${c.link + 1 + i}`)?.link === c.link);
        l.cels[f] = run && c.link < f ? undefined : src ? copyOf(src) : BLANK;
      }
    }
  });
  doc.active = doc.layers.at(-1) ?? null;
  doc.pixelArt = true;
  return { doc, palette: palette.filter(Boolean).filter(c => c[3]).map(c => `#${c.slice(0, 3).map(x => x.toString(16).padStart(2, '0')).join('')}`) };
}
