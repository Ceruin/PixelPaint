// Pyxl-style item art at 16×16: each item is a few shapes (signed-distance functions), lit like a
// tiny 3D object into a 3-tone ramp with a highlight, then outlined in Pyxl's own outline colour —
// so every item shares her soft, cute, shaded look.
const OUT = '#221822';
// Ramps: [shadow, base, light, highlight]
const R = {
  red: ['#9c2338', '#e0485a', '#ff7a86', '#ffd0d6'], pink: ['#b8487a', '#ff7fb0', '#ffaccb', '#ffe3ef'],
  orange: ['#b8561c', '#ff9f2b', '#ffc15e', '#ffe7b8'], yellow: ['#c08a12', '#ffd23f', '#ffe88a', '#fff8d6'],
  green: ['#1f7a45', '#2fb36b', '#6bd691', '#c8f5d6'], teal: ['#1d7f86', '#2fb3a4', '#6fd9cc', '#d2fbf5'],
  blue: ['#2a4fb8', '#3b7bff', '#79a8ff', '#d5e4ff'], purple: ['#5b2aa8', '#8b5cff', '#b393ff', '#e7ddff'],
  lav: ['#6a58b8', '#9d86ff', '#c4b6ff', '#efe9ff'], white: ['#b9b3c4', '#eeeaf2', '#ffffff', '#ffffff'],
  cream: ['#c9a57a', '#f2dcb4', '#fbeed5', '#ffffff'], brown: ['#6b4a31', '#9a6b45', '#c08b5c', '#e6c29a'],
  tan: ['#b98b5a', '#e0b47e', '#f2cf99', '#fff0d6'], grey: ['#5d6270', '#8a90a0', '#b8bdc9', '#eef0f4'],
  gold: ['#a8740e', '#e8b523', '#ffd65c', '#fff4c2'], dark: ['#221822', '#2e2a3a', '#3d3a4d', '#5d5a70'],
  sky: ['#3d8fd6', '#6fc1ff', '#a9dcff', '#e6f5ff'],
};
// shapes → signed distance (negative inside)
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const ellipse = (cx, cy, rx, ry) => (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
const box = (cx, cy, hw, hh, r = 0) => (x, y) => { const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
const seg = (ax, ay, bx, by, r) => (x, y) => { const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy))); return Math.hypot(px - dx * t, py - dy * t) - r; };
const poly = pts => (x, y) => {   // convex or concave polygon (even-odd), distance to edges
  let d = Infinity, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i];
    d = Math.min(d, seg(ax, ay, bx, by, 0)(x, y));
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside ? -d : d;
};
const union = (...f) => (x, y) => Math.min(...f.map(g => g(x, y)));
const cut = (a, b) => (x, y) => Math.max(a(x, y), -b(x, y));
const heart = (cx, cy, s) => union(circle(cx - s * 0.5, cy - s * 0.2, s * 0.58), circle(cx + s * 0.5, cy - s * 0.2, s * 0.58), poly([[cx - s * 1.05, cy], [cx + s * 1.05, cy], [cx, cy + s * 1.15]]));
const star = (cx, cy, ro, ri) => poly(Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? ri : ro; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }));

// Render layers [{ sd, ramp, flat?, tone?(x,y)->ramp }] into a 16×16 canvas.
function render(layers, { size = 16, glint = true } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), grid = [];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const px = i + 0.5, py = j + 0.5;
    let hit = null;
    for (const L of layers) if (L.sd(px, py) < 0) hit = L;              // later layers draw on top
    grid.push(hit);
    if (!hit) continue;
    const ramp = hit.tone?.(px, py) ?? hit.ramp;
    // cel shading: a light rim on edges facing the upper left, shade on the lower right
    let t = 1;
    if (!hit.flat) {
      if (hit.sd(px + 1.3, py + 1.3) > 0) t = 0;
      else if (hit.sd(px - 1.1, py - 1.1) > 0) t = 2;
    }
    x.fillStyle = ramp[t]; x.fillRect(i, j, 1, 1);
  }
  // outline around the whole object
  x.fillStyle = OUT;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    if (grid[j * size + i]) continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const a = i + dx, b = j + dy; return a >= 0 && b >= 0 && a < size && b < size && grid[b * size + a]; });
    if (near) x.fillRect(i, j, 1, 1);
  }
  // one bright glint just inside the lit edge of the first shaded shape
  const main = layers.find(L => !L.flat && !L.noGlint);
  if (glint && main) {
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const px = i + 0.5, py = j + 0.5;
      if (grid[j * size + i] === main && main.sd(px, py) < -1.2 && main.sd(px - 2, py - 2) > 0) { x.fillStyle = (main.tone?.(px, py) ?? main.ramp)[3]; x.fillRect(i, j, 1, 1); if (grid[j * size + i + 1] === main) x.fillRect(i + 1, j, 1, 1); return c; }
    }
  }
  return c;
}
const L = (sd, ramp, o = {}) => ({ sd, ramp: R[ramp] ?? ramp, ...o });
const dots = (pts, ramp) => L((x, y) => Math.min(...pts.map(([a, b]) => Math.hypot(x - a, y - b) - 0.55)), ramp, { flat: true });

export const ART = {
  heart: () => render([L(heart(8, 8, 4.6), 'red')]),
  onigiri: () => render([L(poly([[8, 2], [14.2, 13.6], [1.8, 13.6]]), 'white'), L(box(8, 12.3, 2.1, 1.8, 0.4), 'dark', { flat: true })]),
  strawberry: () => render([L(poly([[2.5, 6], [13.5, 6], [8, 14.5]]), 'red'), L(union(circle(5, 6.4, 3), circle(11, 6.4, 3)), 'red'), dots([[6, 8], [10, 8], [8, 10.5], [5.5, 10.4], [10.5, 10.4]], 'yellow'), L(union(ellipse(6, 3.4, 2.4, 1.2), ellipse(10, 3.4, 2.4, 1.2), box(8, 2.4, 0.6, 1.6)), 'green')]),
  dango: () => render([L(seg(3, 14, 13.5, 2, 0.6), 'brown', { flat: true }), L(circle(5.2, 11.2, 2.9), 'green'), L(circle(8.2, 7.8, 2.9), 'white'), L(circle(11.2, 4.5, 2.9), 'pink')]),
  tea: () => render([L(cut(circle(12.6, 9.6, 2.6), circle(12.6, 9.6, 1.2)), 'white'), L(box(7.5, 10, 5, 4, 1.4), 'teal'), L(box(7.5, 6.6, 5, 0.7), 'cream', { flat: true }), L(union(seg(5.5, 1.5, 6.5, 4, 0.45), seg(9, 1, 9.5, 4, 0.45)), 'white', { flat: true })]),
  heartFruit: () => render([L(heart(8, 9, 4.3), 'pink'), L(ellipse(10.5, 3, 2.3, 1.1), 'green'), L(box(8, 3.5, 0.5, 1.3), 'brown', { flat: true })]),
  brightFruit: () => render([L(circle(8, 9, 5.3), 'yellow'), L(star(8, 9.4, 2.8, 1.2), 'orange', { flat: true }), L(ellipse(10.5, 2.8, 2.3, 1.1), 'green'), L(box(8, 3.4, 0.5, 1.3), 'brown', { flat: true })]),
  moodyFruit: () => render([L(ellipse(8, 9.2, 5, 5.3), 'purple'), L(ellipse(6, 7.6, 1.2, 1.8), 'lav', { flat: true }), L(ellipse(10.5, 2.8, 2.3, 1.1), 'green'), L(box(8, 3.4, 0.5, 1.3), 'brown', { flat: true })]),
  chaoFruit: () => render([L(circle(8, 9, 5.3), 'red', { tone: (x, y) => [R.red, R.orange, R.yellow, R.green, R.blue][Math.max(0, Math.min(4, Math.floor((y - 3.8) / 2.1)))] }), L(ellipse(10.5, 2.8, 2.3, 1.1), 'green'), L(box(8, 3.4, 0.5, 1.3), 'brown', { flat: true })]),
  mushroom: () => render([L(box(8, 11.6, 2.4, 3, 1), 'cream'), L(cut(ellipse(8, 8, 6.4, 5.4), box(8, 13, 8, 4)), 'red'), dots([[5, 5.5], [10.5, 5], [8, 3.4], [12, 7.2], [3.9, 7.6]], 'white')]),
  ball: () => render([L(circle(8, 8, 6), 'blue'), L((x, y) => Math.max(circle(8, 8, 6)(x, y), Math.abs(y - x * 0.35 - 5.3) - 1.1), 'white'), L((x, y) => Math.max(circle(8, 8, 6)(x, y), Math.abs(x - 8) - 0.6), 'yellow', { flat: true })]),
  bubble: () => render([L(cut(circle(8, 8, 6.6), circle(8, 8, 5.3)), 'sky', { flat: true }), dots([[5.4, 5.4], [6.4, 4.6]], 'white')]),
  bubbles: () => render([L(seg(2.5, 14.5, 6.5, 9.5, 0.7), 'pink', { flat: true }), L(cut(circle(8.4, 7.6, 3.6), circle(8.4, 7.6, 2.4)), 'pink', { flat: true }), L(cut(circle(12.6, 3.6, 2.4), circle(12.6, 3.6, 1.3)), 'sky', { flat: true }), L(cut(circle(4, 4, 1.8), circle(4, 4, 0.8)), 'sky', { flat: true })]),
  box: () => render([L(box(8, 9.4, 6, 4.8, 0.6), 'tan'), L(box(8, 4.6, 6.4, 1.2, 0.3), 'brown'), L(box(8, 8.5, 1, 5.6), 'cream', { flat: true })]),
  radio: () => render([L(seg(11, 1.5, 13, 5, 0.45), 'grey', { flat: true }), L(box(8, 9.4, 6.4, 4.6, 1.6), 'red'), L(circle(5.2, 9.6, 2.4), 'dark'), L(box(11.2, 8.2, 1.9, 1.1, 0.4), 'yellow', { flat: true }), dots([[10.4, 11], [12, 11]], 'white')]),
  tv: () => render([L(union(seg(5, 1.5, 7.5, 4.5, 0.4), seg(11, 1.5, 8.5, 4.5, 0.4)), 'grey', { flat: true }), L(box(8, 9.6, 6.6, 4.8, 1.6), 'purple'), L(box(7.2, 9.6, 4.4, 3.4, 1.2), 'sky'), dots([[13, 8.2], [13, 11]], 'yellow')]),
  crayons: () => render([
    L(union(box(4.3, 9.6, 1.6, 4.6, 0.4), poly([[2.7, 5.2], [5.9, 5.2], [4.3, 1.8]])), 'red'), L(union(box(8, 9.6, 1.6, 4.6, 0.4), poly([[6.4, 5.2], [9.6, 5.2], [8, 1.8]])), 'yellow'),
    L(union(box(11.7, 9.6, 1.6, 4.6, 0.4), poly([[10.1, 5.2], [13.3, 5.2], [11.7, 1.8]])), 'blue'), L(box(8, 10.6, 5.6, 0.7), 'white', { flat: true })]),
  pill: () => render([L((x, y) => Math.max(seg(4.8, 11.2, 11.2, 4.8, 2.9)(x, y), x - y), 'red'), L((x, y) => Math.max(seg(4.8, 11.2, 11.2, 4.8, 2.9)(x, y), y - x), 'white')]),
  bag: () => render([L(cut(box(8, 4.4, 3.2, 2.8, 2.2), box(8, 4.8, 1.8, 1.6, 1)), 'brown'), L(box(8, 9.6, 6.2, 5.2, 1.8), 'blue'), L(box(8, 7.4, 6.2, 1.9, 1.4), 'sky'), L(box(8, 9.2, 1.1, 1.1, 0.3), 'yellow', { flat: true })]),
  star: () => render([L(star(8, 8.6, 7.2, 3.2), 'yellow')]),
  ring: () => render([L(cut(circle(8, 8, 6.2), circle(8, 8, 3.2)), 'gold')]),
  moon: () => render([L(cut(circle(8, 8, 6), circle(11, 5.6, 5)), 'lav'), dots([[12.5, 11.5], [13.5, 9]], 'yellow')]),
  medal: () => render([L(union(poly([[3, 1], [6.5, 1], [9, 7], [5.5, 7]]), poly([[13, 1], [9.5, 1], [7, 7], [10.5, 7]])), 'red', { flat: true }), L(circle(8, 10.6, 4.6), 'gold'), L(star(8, 10.8, 2.4, 1.1), 'orange', { flat: true })]),
  pencilPx: () => render([L(seg(3.5, 12.5, 12, 4, 2.3), 'yellow', { noGlint: true }), L(poly([[1.3, 14.7], [2.2, 10.2], [5.8, 13.8]]), 'tan', { flat: true }), L(circle(1.9, 14.1, 1), 'dark', { flat: true }), L(seg(11.2, 4.8, 13, 3, 2.3), 'pink')]),
  drop: () => render([L(union(circle(8, 10, 4.6), poly([[4.1, 8.4], [11.9, 8.4], [8, 1.2]])), 'sky')]),
  bolt: () => render([L(poly([[9.5, 1], [3, 9], [7.5, 9], [5.5, 15], [13, 6.5], [8.5, 6.5]]), 'orange')]),
  bell: () => render([L(union(cut(ellipse(8, 9, 5.6, 6.4), box(8, 15, 8, 2.6)), box(8, 12.2, 6.4, 1)), 'gold'), L(circle(8, 13.6, 1.4), 'brown'), L(circle(8, 2.6, 1.2), 'gold')]),
  drum: () => render([L(box(8, 10, 6.4, 3.6, 1.2), 'red'), L(ellipse(8, 6.4, 6.4, 2), 'white'), L((x, y) => Math.max(box(8, 10.4, 6.4, 3.2, 1.2)(x, y), Math.min(Math.abs(x - 5), Math.abs(x - 11)) - 0.6), 'gold', { flat: true }), L(union(seg(3, 1.5, 7, 5.5, 0.5), seg(13, 1.5, 9, 5.5, 0.5)), 'tan', { flat: true })]),
  note: () => render([L(union(ellipse(5, 12, 2.8, 2.2), ellipse(11.5, 10.5, 2.8, 2.2)), 'purple'), L(union(box(7.3, 7, 0.7, 5), box(13.8, 5.5, 0.7, 5)), 'purple', { flat: true }), L(poly([[6.6, 2], [14.5, 0.8], [14.5, 3.2], [6.6, 4.4]]), 'purple', { flat: true })]),
  castanets: () => render([L(ellipse(5.4, 8.4, 4, 4.8), 'brown'), L(ellipse(10.8, 8.4, 4, 4.8), 'red'), L(seg(5.4, 3.6, 10.8, 3.6, 0.6), 'dark', { flat: true })]),
  cymbals: () => render([L(ellipse(8, 5.6, 6.6, 2.4), 'gold'), L(ellipse(8, 11.4, 6.6, 2.4), 'gold'), L(union(box(8, 3.4, 0.9, 1), box(8, 13.6, 0.9, 1)), 'brown', { flat: true })]),
  flute: () => render([L(seg(2, 13.5, 14, 2.5, 1.7), 'grey'), dots([[6, 10], [8, 8.2], [10, 6.4]], 'dark')]),
  maracas: () => render([L(seg(3.5, 14, 6, 9, 0.8), 'brown', { flat: true }), L(seg(12.5, 14, 10, 9, 0.8), 'brown', { flat: true }), L(ellipse(6, 6, 3.4, 4), 'orange'), L(ellipse(11, 6.6, 3.4, 4), 'green')]),
  tambourine: () => render([L(cut(circle(8, 8, 6.6), circle(8, 8, 3.8)), 'tan'), dots([[8, 1.9], [13.3, 5.2], [13.3, 10.8], [8, 14.1], [2.7, 10.8], [2.7, 5.2]], 'gold')]),
  trumpet: () => render([L(box(6.4, 8, 5, 1.3, 0.6), 'gold'), L(poly([[10.5, 6.6], [15, 3], [15, 13], [10.5, 9.4]]), 'gold'), dots([[4.5, 6], [6.5, 6], [8.5, 6]], 'orange'), L(box(1.6, 8, 1, 1.6, 0.4), 'brown', { flat: true })]),
};
const cache = new Map();
export const hasArt = name => name in ART;
// The canvas for an item, scaled ×s (cached).
export function artCanvas(name, s = 1) {
  const key = `${name}|${s}`;
  if (cache.has(key)) return cache.get(key);
  const base = ART[name](), c = document.createElement('canvas');
  c.width = c.height = 16 * s;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(base, 0, 0, 16 * s, 16 * s);
  cache.set(key, c);
  return c;
}
