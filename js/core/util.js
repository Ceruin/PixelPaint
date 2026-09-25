export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Integer doc-space rectangles {x, y, w, h}.
export const Rect = {
  around(x, y, r) {
    const x0 = Math.floor(x - r), y0 = Math.floor(y - r);
    return { x: x0, y: y0, w: Math.ceil(x + r) - x0 + 1, h: Math.ceil(y + r) - y0 + 1 };
  },
  union(a, b) {
    if (!a) return b; if (!b) return a;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  },
  clip(r, W, H) {
    if (!r) return null;
    const x = Math.max(0, r.x), y = Math.max(0, r.y), x2 = Math.min(W, r.x + r.w), y2 = Math.min(H, r.y + r.h);
    return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
  },
  fromPoints(pts, pad = 0) {
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const x = Math.floor(Math.min(...xs) - pad), y = Math.floor(Math.min(...ys) - pad);
    return { x, y, w: Math.ceil(Math.max(...xs) + pad) - x + 1, h: Math.ceil(Math.max(...ys) + pad) - y + 1 };
  },
};

// Same-position blit of a sub-rect: the workhorse of dirty-rect compositing.
export const drawRect = (ctx, src, r) => ctx.drawImage(src, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);

// Runs fn with ctx clipped to r (needed for unbounded composite ops like destination-in).
export function clipTo(ctx, r, fn) {
  ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip(); fn(ctx); ctx.restore();
}

// Copies a region into a new canvas owned by the history (freed when the command is dropped).
export function grab(src, r) {
  const c = makeCanvas(r.w, r.h);
  c.getContext('2d').drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  c.owned = true;
  return c;
}

export function alphaBounds(canvas) {
  const { width: w, height: h } = canvas, d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 3; y < h; y++) for (let x = 0; x < w; x++, i += 4)
    if (d[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
}

export const pickFile = accept => new Promise(res => {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = accept;
  i.onchange = () => res(i.files[0] ?? null);
  i.click();
});

export const pickFiles = accept => new Promise(res => {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = accept; i.multiple = true;
  i.onchange = () => res([...i.files]);
  i.click();
});

export const toBlob = (c, type = 'image/png', q) => new Promise(r => c.toBlob(r, type, q));
export const readJSON = async file => JSON.parse(await file.text());
export const isTouchDevice = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
