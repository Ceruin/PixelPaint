// Animated GIF encoder: shared median-cut palette (255 colours + transparency), LZW, looping.
function medianCut(samples, n) {
  let boxes = [samples];
  while (boxes.length < n) {
    let bi = -1, best = 0, ch = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const p of b) { const v = p[c]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > best) { best = hi - lo; bi = i; ch = c; }
      }
    });
    if (bi < 0) break;
    const b = boxes[bi].sort((p, q) => p[ch] - q[ch]), m = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, m), b.slice(m));
  }
  return boxes.map(b => [0, 1, 2].map(c => Math.round(b.reduce((s, p) => s + p[c], 0) / b.length)));
}

function lzw(ix, minCode = 8) {
  const out = [], clear = 1 << minCode, eoi = clear + 1, dict = new Map();
  let cur = 0, bits = 0, size = minCode + 1, next = eoi + 1;
  const emit = c => { cur |= c << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  emit(clear);
  let prefix = ix[0];
  for (let i = 1; i < ix.length; i++) {
    const k = ix[i], key = (prefix << 8) | k, hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { emit(clear); dict.clear(); size = minCode + 1; next = eoi + 1; }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (bits) out.push(cur & 255);
  return out;
}

// frames: ImageData[] of equal size; delays in ms.
export function encodeGIF(frames, delays) {
  const { width: w, height: h } = frames[0], samples = [];
  let transparent = false;
  const step = Math.max(1, Math.floor(frames.length * w * h / 60000));
  frames.forEach(f => { for (let i = 0; i < w * h; i += step) { const k = i * 4; if (f.data[k + 3] < 128) transparent = true; else samples.push([f.data[k], f.data[k + 1], f.data[k + 2]]); } });
  const pal = medianCut(samples.length ? samples : [[0, 0, 0]], 255), base = 1;
  const lut = new Int16Array(32768).fill(-1);
  const nearest = (r, g, b) => {
    const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    if (lut[key] >= 0) return lut[key];
    let bi = 0, bd = Infinity;
    pal.forEach(([pr, pg, pb], i) => { const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2; if (d < bd) { bd = d; bi = i; } });
    return (lut[key] = bi + base);
  };
  const bytes = [];
  const put = (...b) => bytes.push(...b), u16 = v => put(v & 255, v >> 8), str = s => put(...[...s].map(c => c.charCodeAt(0)));
  str('GIF89a'); u16(w); u16(h); put(0xf7, 0, 0);
  put(0, 0, 0); pal.forEach(c => put(...c));
  for (let i = pal.length + 1; i < 256; i++) put(0, 0, 0);
  put(0x21, 0xff, 11); str('NETSCAPE2.0'); put(3, 1, 0, 0, 0);
  frames.forEach((f, n) => {
    put(0x21, 0xf9, 4, transparent ? 0x09 : 0x04); u16(Math.max(2, Math.round(delays[n] / 10))); put(0, 0);
    put(0x2c); u16(0); u16(0); u16(w); u16(h); put(0);
    const ix = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) { const k = i * 4; ix[i] = f.data[k + 3] < 128 ? 0 : nearest(f.data[k], f.data[k + 1], f.data[k + 2]); }
    put(8);
    const data = lzw(ix);
    for (let i = 0; i < data.length; i += 255) { const chunk = data.slice(i, i + 255); put(chunk.length, ...chunk); }
    put(0);
  });
  put(0x3b);
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}
