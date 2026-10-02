// A tiny pixel-art rig: a character is a list of parts (simple shapes) drawn back to front, each with
// a 1px outline and a 3-step material ramp lit from the top-left. A pose is just where the parts go.
// Renders every pose at 1×, crops it, and packs the poses into one sheet with an anchor table
// (the same shape as Pyxl's SPRITES table), so a new character can drop into the app.
// See docs/CHARACTERS.md.

export const OUT = '#221822';

// ---- shapes: each is a test "is pixel (x, y) inside?" (pixel centres) ----
export const ellipse = (cx, cy, rx, ry) => (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
export const circle = (cx, cy, r) => ellipse(cx, cy, r, r);
export function capsule(x1, y1, x2, y2, r) {
  return (x, y) => {
    const px = x + 0.5, py = y + 0.5, ex = x2 - x1, ey = y2 - y1, l2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((px - x1) * ex + (py - y1) * ey) / l2));
    return Math.hypot(px - x1 - ex * t, py - y1 - ey * t) <= r;
  };
}
export const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
export function poly(pts) {   // even-odd fill
  return (x, y) => {
    const px = x + 0.5, py = y + 0.5; let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}
// A box of size w × h centred on (cx, cy), turned by angle a (radians).
export function box(cx, cy, w, h, a) {
  const c = Math.cos(a), s = Math.sin(a), pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  return poly(pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]));
}
export const and = (a, b) => (x, y) => a(x, y) && b(x, y);
export const minus = (a, b) => (x, y) => a(x, y) && !b(x, y);

// ---- drawing a pose ----
// part: { shape, mat: [shadow, base, light] | '#hex', shade: 'round' | 'edge' | 'flat', outline: true, light: [cx, cy, rx, ry],
//         paint(x, y, k) → colour (optional override per pixel; k = 0 shadow, 1 base, 2 light), pixels: [[x, y, colour]] }
export function drawPose(W, H, parts) {
  const px = new Array(W * H).fill(null);
  const get = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? px[y * W + x] : null);
  for (const part of parts) {
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (part.shape(x, y)) m[y * W + x] = 1;
    const inM = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x];
    // outline: a 1px ring outside the part (4-neighbours: rounder corners), drawn over what's behind
    if (part.outline !== false) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (m[y * W + x]) continue;
      if (inM(x + 1, y) || inM(x - 1, y) || inM(x, y + 1) || inM(x, y - 1)) px[y * W + x] = part.outlineColour ?? OUT;
    }
    const mat = part.mat, ramp = Array.isArray(mat) ? mat : [mat, mat, mat];
    // shading: a round form uses its own bounds (or `light`) for a top-left gradient; every part
    // gets a light top-left rim and a 1–2px shadow on its bottom-right edge
    let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
    const [cx, cy, rx, ry] = part.light ?? [(bx0 + bx1 + 1) / 2, (by0 + by1 + 1) / 2, Math.max(1, (bx1 - bx0 + 1) / 2), Math.max(1, (by1 - by0 + 1) / 2)];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      let k = 1;
      if (part.shade !== 'flat') {
        const rimL = !inM(x - 1, y) && !inM(x, y - 1) || !inM(x - 1, y - 1) && (!inM(x - 1, y) || !inM(x, y - 1));
        const rimD = !inM(x + 1, y + 1) || (part.shade === 'round' && !inM(x + 2, y + 2));
        if (part.shade === 'round') { const t = (x + 0.5 - cx) / rx + (y + 0.5 - cy) / ry; k = t < -0.95 ? 2 : t > 0.7 ? 0 : 1; }
        if (rimD) k = Math.min(k, 0);
        if (rimL && k === 1) k = 2;
      }
      px[y * W + x] = part.paint ? part.paint(x, y, k) ?? ramp[k] : ramp[k];   // paint: per-pixel colour (hair strands…)
    }
    for (const [x, y, c] of part.pixels ?? []) if (x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = c;   // hand-placed details (eyes…)
  }
  return { W, H, px, get };
}

// Crop to what's drawn, and pack every pose into one row (1px apart), recording each pose's box and
// anchor: [x, y, w, h, anchorX, feetY] like Pyxl's SPRITES.
export function pack(poses, { originX, floorY, anchorOf }) {
  const boxes = [];
  for (const [name, p] of poses) {
    let x0 = p.W, y0 = p.H, x1 = -1, y1 = -1;
    for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) if (p.px[y * p.W + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    boxes.push({ name, p, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  const H = Math.max(...boxes.map(b => b.y0 + b.h)) - Math.min(...boxes.map(b => b.y0)), top = Math.min(...boxes.map(b => b.y0));
  const W = boxes.reduce((s, b) => s + b.w + 1, 0);
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H }), ctx = c.getContext('2d');
  const sprites = {};
  let ox = 0;
  for (const b of boxes) {
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const col = b.p.px[(b.y0 + y) * b.p.W + b.x0 + x];
      if (col) { ctx.fillStyle = col; ctx.fillRect(ox + x, b.y0 - top + y, 1, 1); }
    }
    const [ax] = anchorOf?.(b.name) ?? [originX];
    sprites[b.name] = [ox, b.y0 - top, b.w, b.h, Math.round(ax - b.x0), floorY - b.y0];
    ox += b.w + 1;
  }
  return { canvas: c, sprites };
}

// Hand-drawn pixels from text rows: stamp(x0, y0, ['.aa.', 'abba'], { a: '#221822', b: '#fff' }) → pixels for a part.
// '.' and spaces are left alone; flip mirrors the rows.
export function stamp(x0, y0, rows, legend, flip = false) {
  const out = [];
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    const c = legend[ch];
    if (c) out.push([Math.round(x0) + (flip ? row.length - 1 - i : i), Math.round(y0) + j, c]);
  }));
  return out;
}

// Turn a drawn pose a quarter turn (pixel art stays crisp): dir -1 = anticlockwise (head goes left).
export function rotate(p, dir = -1, dx = 0, dy = 0) {
  const { W, H } = p, px = new Array(W * H).fill(null), cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = p.px[y * W + x]; if (!c) continue;
    const rx = x + 0.5 - cx, ry = y + 0.5 - cy, nx = Math.floor(cx + (dir < 0 ? ry : -ry) + dx), ny = Math.floor(cy + (dir < 0 ? -rx : rx) + dy);
    if (nx >= 0 && ny >= 0 && nx < W && ny < H) px[ny * W + nx] = c;
  }
  return { ...p, px };
}
