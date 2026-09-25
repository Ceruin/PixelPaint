import { toBlob, makeCanvas } from '../core/util.js';
import { flatten } from './compositor.js';
import { zip, unzip } from './zip.js';
import { Doc, Layer, Group, FilterLayer } from './document.js';

// Autosave snapshot: JSON tree + PNG blob per layer (kept in IndexedDB).
const VERSION = 1;
const PROPS = ['name', 'visible', 'opacity', 'blend', 'locked', 'alphaLock', 'clip', 'collapsed'];

// Encodes changed layers only; `cache` (WeakMap) remembers each layer's last PNG by version.
export async function packDoc(doc, cache = new WeakMap()) {
  const blobs = [];
  const node = async n => {
    const o = Object.fromEntries(PROPS.filter(k => k in n).map(k => [k, n[k]]));
    o.type = n.type;
    if (n.type === 'group') { o.children = await Promise.all(n.children.map(node)); return o; }
    if (n.type === 'filter') return Object.assign(o, { filter: n.filter, vals: n.vals });
    let hit = cache.get(n);
    if (hit?.v !== n.version) cache.set(n, hit = { v: n.version, blob: await toBlob(n.canvas) });
    o.blob = blobs.push(hit.blob) - 1;
    o.active = n === doc.active;
    return o;
  };
  const meta = { version: VERSION, w: doc.w, h: doc.h, name: doc.name, assistants: doc.assistants, tree: await node(doc.root) };
  return { meta, blobs };
}

export async function unpackDoc({ meta, blobs }) {
  const doc = new Doc(meta.w, meta.h, { empty: true });
  doc.name = meta.name;
  doc.assistants = meta.assistants ?? [];
  const build = async o => {
    const n = o.type === 'group' ? new Group(o.name) : o.type === 'filter' ? new FilterLayer(o.filter, o.vals) : new Layer(meta.w, meta.h, o.name);
    PROPS.forEach(k => { if (k in o) n[k] = o[k]; });
    if (o.type === 'group') n.children = await Promise.all(o.children.map(build));
    else if (o.type === 'layer') {
      n.ctx.drawImage(await createImageBitmap(blobs[o.blob]), 0, 0);
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
    const src = `data/layer${n++}.png`;
    files.push({ name: src, data: await toBlob(x.canvas) });
    return `${pad}<layer ${common} src="${src}" x="0" y="0" composite-op="${toOp(x.blend)}"${x.locked ? ' edit-locked="true"' : ''}${x.alphaLock ? ' alpha-preserve="true"' : ''}${x.clip ? ' pp:clip="true"' : ''}${x === doc.active ? ' selected="true"' : ''}/>\n`;
  };
  let body = '';
  for (const k of [...doc.root.children].reverse()) body += await node(k, '  ');
  const merged = flatten(doc), s = Math.min(1, 256 / Math.max(doc.w, doc.h)), thumb = makeCanvas(Math.max(1, Math.round(doc.w * s)), Math.max(1, Math.round(doc.h * s)));
  thumb.getContext('2d').drawImage(merged, 0, 0, thumb.width, thumb.height);
  files.push(
    { name: 'stack.xml', data: `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.5" w="${doc.w}" h="${doc.h}" xres="72" yres="72" xmlns:pp="${NS}">\n <stack>\n${body} </stack>\n</image>\n` },
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
        const l = new Layer(w, h, c.getAttribute('name') || `Layer ${doc.count + 1}`);
        props(c, l);
        Object.assign(l, { blend: fromOp(c.getAttribute('composite-op')), locked: c.getAttribute('edit-locked') === 'true', alphaLock: c.getAttribute('alpha-preserve') === 'true', clip: c.getAttributeNS(NS, 'clip') === 'true' });
        l.ctx.drawImage(await createImageBitmap(files.get(c.getAttribute('src'))), +c.getAttribute('x') || 0, +c.getAttribute('y') || 0);
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
