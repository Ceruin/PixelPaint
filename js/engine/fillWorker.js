// The fill bucket's work, off the main thread: reading the pixels back, the flood, the soft edge
// ring, and the coloured result. The page only snapshots its canvases and draws what comes back,
// so a fill over a whole big canvas never freezes a frame.
import { floodMask, edgeRing } from './flood.js';

const pixels = (bmp, w, h) => {
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0); bmp.close();
  return x.getImageData(0, 0, w, h);
};
const bboxOf = (m, w, h) => {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) if (m[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};
// The mask painted in rgba, as a bitmap of just its box (clipped to the selection, if any).
const paint = (m, w, h, rgba, sel) => {
  const b = bboxOf(m, w, h);
  if (!b) return null;
  const c = new OffscreenCanvas(b.w, b.h), x = c.getContext('2d'), img = x.createImageData(b.w, b.h), d = new Uint32Array(img.data.buffer);
  for (let y = 0, j = 0; y < b.h; y++) for (let k = 0, i = (b.y + y) * w + b.x; k < b.w; k++, i++, j++) if (m[i]) d[j] = rgba;
  x.putImageData(img, 0, 0);
  if (sel) { x.globalCompositeOperation = 'destination-in'; x.drawImage(sel, -b.x, -b.y); }
  return { bmp: c.transferToImageBitmap(), bounds: b };
};

onmessage = ({ data: q }) => {
  try {
    const { w, h, x, y, rgba } = q, img = pixels(q.src, w, h);
    const core = floodMask(img, x, y, q.soft || q.wand ? q.tolerance : 0, q.contiguous, q.soft);   // the wand: its own tolerance, no gap closing
    const out = { id: q.id, fill: paint(core, w, h, rgba, q.sel), under: null, over: null };
    if (q.soft && !q.alphaLock) {
      const under = q.under ? pixels(q.under, w, h).data : null;
      const ring = edgeRing(core, img, y * w + x, under), opaque = new Uint8Array(ring.length);
      for (let i = 0; i < ring.length; i++) if (ring[i] && under?.[i * 4 + 3] === 255) { opaque[i] = 1; ring[i] = 0; }
      out.under = paint(ring, w, h, rgba, q.sel); out.over = paint(opaque, w, h, rgba, q.sel);
    } else q.under?.close();
    q.sel?.close();
    postMessage(out, [out.fill?.bmp, out.under?.bmp, out.over?.bmp].filter(Boolean));
  } catch (e) { postMessage({ id: q.id, error: String(e) }); }
};
