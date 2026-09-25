import { toBlob } from '../core/util.js';
import { Doc, Layer, Group } from './document.js';

// Project format (.ppaint): "PPNT" | u32 json length | JSON manifest | concatenated PNG layer blobs.
const MAGIC = 'PPNT', VERSION = 1;
const PROPS = ['name', 'visible', 'opacity', 'blend', 'locked', 'alphaLock', 'clip', 'collapsed'];

// Encodes changed layers only; `cache` (WeakMap) remembers each layer's last PNG by version.
export async function packDoc(doc, cache = new WeakMap()) {
  const blobs = [];
  const node = async n => {
    const o = Object.fromEntries(PROPS.filter(k => k in n).map(k => [k, n[k]]));
    o.type = n.type;
    if (n.type === 'group') { o.children = await Promise.all(n.children.map(node)); return o; }
    let hit = cache.get(n);
    if (hit?.v !== n.version) cache.set(n, hit = { v: n.version, blob: await toBlob(n.canvas) });
    o.blob = blobs.push(hit.blob) - 1;
    o.active = n === doc.active;
    return o;
  };
  const meta = { version: VERSION, w: doc.w, h: doc.h, name: doc.name, tree: await node(doc.root) };
  return { meta, blobs };
}

export async function unpackDoc({ meta, blobs }) {
  const doc = new Doc(meta.w, meta.h, { empty: true });
  doc.name = meta.name;
  const build = async o => {
    const n = o.type === 'group' ? new Group(o.name) : new Layer(meta.w, meta.h, o.name);
    PROPS.forEach(k => { if (k in o) n[k] = o[k]; });
    if (o.type === 'group') n.children = await Promise.all(o.children.map(build));
    else {
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

export async function encodeFile(doc) {
  const { meta, blobs } = await packDoc(doc);
  meta.sizes = blobs.map(b => b.size);
  const json = new TextEncoder().encode(JSON.stringify(meta)), head = new Uint8Array(8);
  head.set([...MAGIC].map(c => c.charCodeAt(0)));
  new DataView(head.buffer).setUint32(4, json.length, true);
  return new Blob([head, json, ...blobs], { type: 'application/x-pixelpaint' });
}

export async function decodeFile(blob) {
  const buf = await blob.arrayBuffer();
  if (new TextDecoder().decode(buf.slice(0, 4)) !== MAGIC) throw new Error('Not a PixelPaint project');
  const len = new DataView(buf).getUint32(4, true), meta = JSON.parse(new TextDecoder().decode(buf.slice(8, 8 + len)));
  let off = 8 + len;
  const blobs = meta.sizes.map(s => blob.slice(off, off += s, 'image/png'));
  return unpackDoc({ meta, blobs });
}
