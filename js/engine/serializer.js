import { toBlob, makeCanvas } from '../core/util.js';
import { flatten } from './compositor.js';
import { zip, unzip } from './zip.js';
import { Doc, Layer, Group, FilterLayer, BLANK } from './document.js';

// Autosave snapshot: JSON tree + PNG blob per layer (kept in IndexedDB).
const VERSION = 1;
const PROPS = ['name', 'visible', 'opacity', 'blend', 'locked', 'alphaLock', 'clip', 'collapsed'];

// Encodes changed cels only; `cache` (WeakMap) remembers each cel canvas's last PNG by version.
export async function packDoc(doc, cache = new WeakMap()) {
  const blobs = [];
  const encode = async c => {
    if (c === BLANK) return -1;
    if (!c) return null;
    let hit = cache.get(c);
    if (!hit || hit.v !== c.v) cache.set(c, hit = { v: c.v, blob: await toBlob(c) });
    return blobs.push(hit.blob) - 1;
  };
  const node = async n => {
    const o = Object.fromEntries(PROPS.filter(k => k in n).map(k => [k, n[k]]));
    o.type = n.type;
    if (n.type === 'group') { o.children = await Promise.all(n.children.map(node)); return o; }
    if (n.type === 'filter') return Object.assign(o, { filter: n.filter, vals: n.vals });
    o.cels = [];
    for (let f = 0; f < doc.frames.length; f++) o.cels.push(await encode(n.cels[f]));
    o.active = n === doc.active;
    return o;
  };
  const meta = { version: VERSION, w: doc.w, h: doc.h, name: doc.name, assistants: doc.assistants, frames: doc.frames, tags: doc.tags, frame: doc.frame, tree: await node(doc.root) };
  return { meta, blobs };
}

export async function unpackDoc({ meta, blobs }) {
  const doc = new Doc(meta.w, meta.h, { empty: true });
  doc.name = meta.name;
  doc.assistants = meta.assistants ?? [];
  if (meta.frames) Object.assign(doc, { frames: meta.frames, tags: meta.tags ?? [], frame: Math.min(meta.frame ?? 0, meta.frames.length - 1) });
  const build = async o => {
    const n = o.type === 'group' ? new Group(o.name) : o.type === 'filter' ? new FilterLayer(o.filter, o.vals) : new Layer(doc, o.name);
    PROPS.forEach(k => { if (k in o) n[k] = o[k]; });
    if (o.type === 'group') n.children = await Promise.all(o.children.map(build));
    else if (o.type === 'layer') {
      const cels = o.cels ?? [o.blob];
      for (let f = 0; f < cels.length; f++) {
        if (cels[f] === -1) n.cels[f] = BLANK;
        else if (cels[f] != null) n.cel(f, true).getContext('2d').drawImage(await createImageBitmap(blobs[cels[f]]), 0, 0);
      }
      if (o.active) doc.active = n;
      doc.count++;
    }
    return n;
  };
  doc.root = await build(meta.tree);
  doc.active ??= doc.layers.at(-1) ?? null;
  return doc;
}

// ---- OpenRaster (.ora): the open layered format read by Krita, GIMP and MyPaint ----
const NS = 'https://pixelpaint.net/ora';
const toOp = (b, group) => (group && b === 'pass' ? 'svg:src-over' : b === 'source-over' ? 'svg:src-over' : b === 'lighter' ? 'svg:plus' : `svg:${b}`);
const fromOp = op => { const b = (op ?? 'svg:src-over').replace(/^svg:/, ''); return b === 'src-over' ? 'source-over' : b === 'plus' ? 'lighter' : b; };
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

export async function encodeORA(doc) {
  const files = [{ name: 'mimetype', data: 'image/openraster' }];
  let n = 0;
  const node = async (x, pad) => {
    const common = `name="${esc(x.name)}" visibility="${x.visible ? 'visible' : 'hidden'}" opacity="${x.opacity}"`;
    if (x.type === 'group') {
      const kids = [];
      for (const k of [...x.children].reverse()) kids.push(await node(k, pad + ' '));
      return `${pad}<stack ${common} composite-op="${toOp(x.blend, true)}" isolation="${x.blend === 'pass' ? 'auto' : 'isolate'}">\n${kids.join('')}${pad}</stack>\n`;
    }
    if (x.type === 'filter') {
      if (!files.some(f => f.name === 'data/empty.png')) files.push({ name: 'data/empty.png', data: await toBlob(makeCanvas(1, 1)) });
      return `${pad}<layer ${common} src="data/empty.png" x="0" y="0" composite-op="svg:src-over" pp:filter="${x.filter}" pp:vals="${esc(JSON.stringify(x.vals))}"/>\n`;
    }
    // Frame 0 is the standard layer image; further frames ride along in pp:cels for PixelPaint.
    const id = n++, srcs = doc.frames.map((_, f) => (x.cels[f] ? `data/layer${id}${f ? `_f${f}` : ''}.png` : x.cels[f] === BLANK ? '' : null));
    for (let f = 0; f < srcs.length; f++) if (srcs[f]) files.push({ name: srcs[f], data: await toBlob(x.cels[f]) });
    const src = srcs[0] ?? `data/layer${id}.png`;
    if (!srcs[0]) files.push({ name: src, data: await toBlob(makeCanvas(doc.w, doc.h)) });
    const cels = doc.frames.length > 1 ? ` pp:cels="${esc(JSON.stringify(srcs))}"` : '';
    return `${pad}<layer ${common} src="${src}" x="0" y="0" composite-op="${toOp(x.blend)}"${x.locked ? ' edit-locked="true"' : ''}${x.alphaLock ? ' alpha-preserve="true"' : ''}${x.clip ? ' pp:clip="true"' : ''}${x === doc.active ? ' selected="true"' : ''}${cels}/>\n`;
  };
  let body = '';
  for (const k of [...doc.root.children].reverse()) body += await node(k, '  ');
  const merged = flatten(doc, 0), s = Math.min(1, 256 / Math.max(doc.w, doc.h)), thumb = makeCanvas(Math.max(1, Math.round(doc.w * s)), Math.max(1, Math.round(doc.h * s)));
  thumb.getContext('2d').drawImage(merged, 0, 0, thumb.width, thumb.height);
  files.push(
    { name: 'stack.xml', data: `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.5" w="${doc.w}" h="${doc.h}" xres="72" yres="72" xmlns:pp="${NS}" pp:frames="${esc(JSON.stringify(doc.frames))}" pp:tags="${esc(JSON.stringify(doc.tags))}">\n <stack>\n${body} </stack>\n</image>\n` },
    { name: 'mergedimage.png', data: await toBlob(merged) },
    { name: 'Thumbnails/thumbnail.png', data: await toBlob(thumb) });
  return zip(files, 'image/openraster');
}

export async function decodeORA(blob) {
  const files = await unzip(blob), xml = files.get('stack.xml');
  if (!xml) throw new Error('Not an OpenRaster file');
  const img = new DOMParser().parseFromString(await xml.text(), 'application/xml').documentElement;
  const w = +img.getAttribute('width') || +img.getAttribute('w'), h = +img.getAttribute('h');
  const doc = new Doc(w, h, { empty: true });
  const frames = img.getAttributeNS(NS, 'frames');
  if (frames) Object.assign(doc, { frames: JSON.parse(frames), tags: JSON.parse(img.getAttributeNS(NS, 'tags') || '[]') });
  const props = (el, n) => {
    n.visible = el.getAttribute('visibility') !== 'hidden';
    n.opacity = +(el.getAttribute('opacity') ?? 1);
  };
  const build = async el => {
    const kids = [];
    for (const c of [...el.children].reverse()) {
      if (c.tagName === 'stack') {
        const g = new Group(c.getAttribute('name') || `Group ${++doc.groups}`);
        props(c, g);
        g.blend = c.getAttribute('isolation') === 'isolate' ? fromOp(c.getAttribute('composite-op')) : 'pass';
        g.children = await build(c);
        kids.push(g);
      } else if (c.tagName === 'layer' && c.getAttributeNS(NS, 'filter')) {
        const f = new FilterLayer(c.getAttributeNS(NS, 'filter'), JSON.parse(c.getAttributeNS(NS, 'vals') || '{}'));
        props(c, f);
        kids.push(f);
      } else if (c.tagName === 'layer' && files.has(c.getAttribute('src'))) {
        const l = new Layer(doc, c.getAttribute('name') || `Layer ${doc.count + 1}`);
        props(c, l);
        Object.assign(l, { blend: fromOp(c.getAttribute('composite-op')), locked: c.getAttribute('edit-locked') === 'true', alphaLock: c.getAttribute('alpha-preserve') === 'true', clip: c.getAttributeNS(NS, 'clip') === 'true' });
        const srcs = JSON.parse(c.getAttributeNS(NS, 'cels') || 'null') ?? [c.getAttribute('src')];
        for (let f = 0; f < srcs.length; f++) if (srcs[f] === '') l.cels[f] = BLANK; else if (srcs[f] && files.has(srcs[f])) l.cel(f, true).getContext('2d').drawImage(await createImageBitmap(files.get(srcs[f])), +c.getAttribute('x') || 0, +c.getAttribute('y') || 0);
        if (c.getAttribute('selected') === 'true') doc.active = l;
        doc.count++;
        kids.push(l);
      }
    }
    return kids;
  };
  const top = img.querySelector('stack');
  doc.root.children = top ? await build(top) : [];
  doc.active ??= doc.layers.at(-1) ?? null;
  return doc;
}
