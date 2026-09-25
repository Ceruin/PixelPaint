// Minimal ZIP writer (stored entries) and reader (stored + deflate), for OpenRaster files.
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = u8 => { let c = ~0; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
const enc = new TextEncoder();

export async function zip(files, type) {
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer()), name = enc.encode(f.name), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30)), ch = new DataView(new ArrayBuffer(46));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x800, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x800, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    parts.push(lh, name, data);
    central.push(ch, name);
    off += 30 + name.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end], { type });
}

export async function unzip(blob) {
  const buf = await blob.arrayBuffer(), v = new DataView(buf), dec = new TextDecoder(), out = new Map();
  let e = buf.byteLength - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a zip-based file');
  let p = v.getUint32(e + 16, true);
  for (let n = v.getUint16(e + 10, true); n--;) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nlen = v.getUint16(p + 28, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen)), lo = v.getUint32(p + 42, true);
    const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true), raw = blob.slice(start, start + size);
    out.set(name, method === 8 ? await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob() : raw);
    p += 46 + nlen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return out;
}
