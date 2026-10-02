// Race courses as plain, portable data — Pyxl's generated ones, ones you draw in the course
// builder, and shared ones all look the same:
//   { v: 1, name, w, h, segs: [[ax, ay, bx, by]], water: [[x0, y0, x1, y1]], hazards: [[x0, y0, x1, y1]] (lava: it
//     burns while you're in it), pits: [[x0, y0, x1, y1]] (fall in and you're back at your last spot),
//     takes: [[x, y]], start: [x, y], finish: [x, y] }
// in "scene" pixels of the arena it was made for (w × h). A track is a course prepared for the arena
// it's raced in: fitted (stretched a little if the canvas shape differs), with a distance field
// from the finish so racers on any course know which way to go and who's ahead.
export const COURSE_VERSION = 1;
const CELL = 6;   // distance-field grid (scene px)
export const G = 640, R = 4, BODY = 20;   // racers are capsules: radius R, BODY tall (feet at the bottom)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sk01 = pts => Math.max(0, Math.min(1.6, pts / 1200));   // a skill as a 0..1.6 multiplier
const seeded = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---------------------------------------------------------------- Pyxl's generated courses
const POOLS = {   // what each race level's course is made of (cycled, shuffled per race)
  beginner: ['run', 'hill', 'water', 'run', 'gap', 'hill', 'run'],
  jewel: ['hill', 'gap', 'water', 'wall', 'run', 'platforms', 'hill', 'gap'],
  challenge: ['gap', 'wall', 'water', 'platforms', 'hill', 'gap', 'wall', 'platforms', 'water', 'hill'],
};
const WIDTH = { run: [50, 80], hill: [70, 100], water: [90, 120], gap: [80, 105], wall: [70, 95], platforms: [120, 150] };

function buildStrip(c, rnd, pick, row, { start, finish, entry }) {
  const { x0, x1, base, dir } = row, len = x1 - x0;
  const X = s => (dir > 0 ? x0 + s : x1 - s);
  const seg = (sa, ha, sb, hb) => c.segs.push([X(sa), base + ha, X(sb), base + hb].map(Math.round));
  const take = (s, hh) => c.takes.push([Math.round(X(s)), Math.round(base + hh)]);
  const pit = (sa, sb, h0) => c.pits.push([Math.min(X(sa), X(sb)) - 12, base + h0 + 30, Math.max(X(sa), X(sb)) + 12, base + h0 + 62].map(Math.round));   // under the ground there, whatever its height   // falling in a gap = back to your last spot
  let s = 0, hh = 0;
  const end = finish ? len - 40 : len - 26;   // a row that isn't last stays open at its far end: you drop to the next
  if (start || entry) { seg(0, 0, 44, 0); s = 44; }
  while (s < end - 30) {
    let type = pick(), [w0, w1] = WIDTH[type], w = Math.round(w0 + rnd() * (w1 - w0));
    if (s + w > end) { w = end - s; type = w < 60 ? 'run' : type === 'platforms' && w < 110 ? 'gap' : type; }
    if (type === 'run') { const nh = clamp(hh + (rnd() - 0.5) * 16, -34, 6); seg(s, hh, s + w, nh); hh = nh; }
    else if (type === 'hill') { const pk = hh - 14 - rnd() * 12, m = s + w / 2; seg(s, hh, m - 7, pk); seg(m - 7, pk, m + 7, pk); seg(m + 7, pk, s + w, hh); }
    else if (type === 'water') {
      const d = 28, a = s + w * 0.26, b = s + w * 0.74;   // banks gentle enough to run out of
      seg(s, hh, a, hh + d); seg(a, hh + d, b, hh + d); seg(b, hh + d, s + w, hh);
      c.water.push([Math.min(X(s + w * 0.07), X(s + w * 0.93)), base + hh + 3, Math.max(X(s + w * 0.07), X(s + w * 0.93)), base + hh + d].map(Math.round));
    } else if (type === 'gap') {
      const r1 = s + w * 0.3, l0 = s + w * 0.68;
      seg(s, hh, r1, hh - 9); take(r1 - 2, hh - 9); seg(l0, hh, s + w, hh); pit(r1, l0, hh);
    } else if (type === 'wall') {
      const at = s + w * 0.42;
      if (hh < -26) { seg(s, hh, at, hh); seg(at, hh, at, hh + 26); seg(at, hh + 26, s + w, hh + 26); hh += 26; }   // too high up: a drop instead
      else { seg(s, hh, at, hh); seg(at, hh, at, hh - 26); seg(at, hh - 26, s + w, hh - 26); hh -= 26; }
    } else if (type === 'platforms') {
      // the far ledge starts within a normal jump's reach; the platform under the arc catches short ones
      const a = s + w * 0.15, p0 = a + 16, p1 = a + 44, l0 = a + 54;
      seg(s, hh, a, hh); take(a - 2, hh); seg(p0, hh - 12, p1, hh - 12); take(p1 - 2, hh - 12); seg(l0, hh, s + w, hh); pit(a, l0, hh);
    }
    s += w;
  }
  seg(s, hh, end, hh);
  if (finish) { seg(end, hh, len - 4, hh); c.finish = [Math.round(X(end)), Math.round(base + hh)]; }
}

// A course for a W×H arena: one row left → right if it's wide, switchbacks top → bottom if it's tall.
export function generateCourse(W, H, levelId = 'beginner', seed = 1 + Math.floor(Math.random() * 2e9)) {
  const rnd = seeded(seed), pool = POOLS[levelId] ?? POOLS.beginner;
  let deck = [], i = 0;
  const pick = () => { if (i >= deck.length) { deck = pool.slice().sort(() => rnd() - 0.5); i = 0; } return deck[i++]; };
  const vertical = H > W * 1.15, c = { v: COURSE_VERSION, name: 'Pyxl’s course', w: W, h: H, segs: [], water: [], hazards: [], pits: [], takes: [], start: null, finish: null };
  const n = vertical ? Math.max(2, Math.min(6, Math.floor(H / 190))) : 1, sh = H / n;
  for (let r = 0; r < n; r++) {
    const row = { base: Math.round(r * sh + sh * (vertical ? 0.74 : 0.66)), dir: r % 2 ? -1 : 1, x0: 6, x1: W - 6 };
    if (r === 0) c.start = [row.x0 + 18, row.base];
    buildStrip(c, rnd, pick, row, { start: r === 0, finish: r === n - 1, entry: r > 0 });
  }
  return c;
}
// A course from anywhere (a file, a link, storage) made safe to use: numbers only, sane sizes and
// counts, everything rounded. Returns null if it isn't a course at all.
export const LIMITS = { segs: 3000, water: 60, hazards: 60, pits: 60, takes: 120 };
export function normalizeCourse(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.segs)) return null;
  const w = Math.round(clamp(+c.w || 0, 120, 4000)), h = Math.round(clamp(+c.h || 0, 120, 4000));
  if (!(+c.w > 0 && +c.h > 0)) return null;
  const num = (v, hi) => (Number.isFinite(+v) ? Math.round(clamp(+v, -hi * 0.25, hi * 1.25)) : null);
  const pt = p => { if (!Array.isArray(p)) return null; const x = num(p[0], w), y = num(p[1], h); return x == null || y == null ? null : [x, y]; };
  const quad = q => { if (!Array.isArray(q) || q.length < 4) return null; const a = pt(q.slice(0, 2)), b = pt(q.slice(2, 4)); return a && b ? [...a, ...b] : null; };
  const list = (arr, f, n) => (Array.isArray(arr) ? arr.slice(0, n).map(f).filter(Boolean) : []);
  const box = q => { const r = quad(q); return r && [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]; };
  return {
    v: COURSE_VERSION, name: String(c.name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || 'Untitled course', w, h,
    segs: list(c.segs, quad, LIMITS.segs).filter(([ax, ay, bx, by]) => ax !== bx || ay !== by),
    water: list(c.water, box, LIMITS.water), hazards: list(c.hazards, box, LIMITS.hazards), pits: list(c.pits, box, LIMITS.pits), takes: list(c.takes, pt, LIMITS.takes),
    start: pt(c.start), finish: pt(c.finish),
  };
}
export const isVertical = c => c.h > c.w * 1.15;

// ---------------------------------------------------------------- a course fitted to an arena
export function prepareTrack(course, W, H, { stretch = true } = {}) {
  const c = course, cw = c.w, ch = c.h;
  // made on a canvas of another shape: fitted, then stretched up to 1.5× along the arena's longer
  // side so it still fills most of the page (hills get steeper or flatter; ground stays ground —
  // turning it 90° would make its ground into walls)
  const k = Math.min(W / cw, H / ch), kx = stretch ? Math.min(W / cw, k * 1.5) : k, ky = stretch ? Math.min(H / ch, k * 1.5) : k;
  const ox = (W - cw * kx) / 2, oy = (H - ch * ky) / 2;
  const P = (x, y) => [ox + x * kx, oy + y * ky];
  const rect = ([x0, y0, x1, y1]) => { const [a, b] = P(x0, y0), [d, e] = P(x1, y1); return { x0: Math.min(a, d), y0: Math.min(b, e), x1: Math.max(a, d), y1: Math.max(b, e) }; };
  const t = {
    course, W, H, k, kx, ky,
    segs: c.segs.map(([ax, ay, bx, by]) => ({ a: P(ax, ay), b: P(bx, by) })),
    water: (c.water ?? []).map(rect), hazards: (c.hazards ?? []).map(rect), pits: (c.pits ?? []).map(rect),
    takes: (c.takes ?? []).map(([x, y], id) => { const [a, b] = P(x, y); return { x: a, y: b, id }; }),
    start: c.start ? P(...c.start) : [W * 0.1, H * 0.5], finish: c.finish ? P(...c.finish) : null,
  };
  t.segs.push({ a: [2, 0], b: [2, H], edge: true }, { a: [W - 2, 0], b: [W - 2, H], edge: true });   // the arena's sides
  // lava and water have a floor of their own (unseen): you wade a few pixels deep through lava and swim
  // above a pool's bottom, even where one's drawn over a gap with no ground under it
  for (const z of t.hazards) t.segs.push({ a: [z.x0, Math.min(z.y1, z.y0 + 6)], b: [z.x1, Math.min(z.y1, z.y0 + 6)], floor: true });
  for (const z of t.water) t.segs.push({ a: [z.x0, z.y1], b: [z.x1, z.y1], floor: true });
  let acc = 0; for (const sg of t.segs) if (!sg.edge && !sg.floor) acc += Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]);
  t.inkLen = acc;
  return t;
}

// Distance (over open air, around the lines) from every spot to the finish. Built once per race.
export function buildField(t) {
  const cols = Math.ceil(t.W / CELL), rows = Math.ceil(t.H / CELL), n = cols * rows, wall = new Uint8Array(n), dist = new Float64Array(n).fill(Infinity), next = new Int32Array(n).fill(-1);
  for (const { a, b } of t.segs) {   // lines block
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2)));
    for (let i = 0; i <= steps; i++) {
      const x = a[0] + (b[0] - a[0]) * i / steps, y = a[1] + (b[1] - a[1]) * i / steps, cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) wall[cy * cols + cx] = 1;
    }
  }
  // spikes block too: the way on never runs through them (so a gap with a pit under it isn't a shortcut)
  const cellsOf = list => { for (const z of list) for (let y = Math.max(0, Math.floor(z.y0 / CELL)); y <= Math.min(rows - 1, Math.floor(z.y1 / CELL)); y++) for (let x = Math.max(0, Math.floor(z.x0 / CELL)); x <= Math.min(cols - 1, Math.floor(z.x1 / CELL)); x++) wall[y * cols + x] = 1; };
  const solid = wall.slice();   // the lines alone (for "is there ground under / a ceiling over this spot")
  cellsOf(t.pits);
  const wet = new Uint8Array(n), hot = new Uint8Array(n);   // water slows; lava hurts (the way on goes round it if it can)
  for (const z of t.hazards) for (let y = Math.max(0, Math.floor(z.y0 / CELL)); y <= Math.min(rows - 1, Math.floor(z.y1 / CELL)); y++) for (let x = Math.max(0, Math.floor(z.x0 / CELL)); x <= Math.min(cols - 1, Math.floor(z.x1 / CELL)); x++) hot[y * cols + x] = 1;
  for (const z of t.water) for (let y = Math.max(0, Math.floor(z.y0 / CELL)); y <= Math.min(rows - 1, Math.floor(z.y1 / CELL)); y++) for (let x = Math.max(0, Math.floor(z.x0 / CELL)); x <= Math.min(cols - 1, Math.floor(z.x1 / CELL)); x++) wet[y * cols + x] = 1;
  // Dijkstra out from the finish. Racers can't fly: going up costs far more than falling or running,
  // so "the way on" follows the ground and drops, not a straight line through the air.
  const heap = [], push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  if (t.finish) {
    const fx = Math.floor(t.finish[0] / CELL), fy = Math.floor((t.finish[1] - 8) / CELL);
    for (let dy = -3; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = fx + dx, y = fy + dy; if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const i = y * cols + x; if (!wall[i] && dist[i] === Infinity) { dist[i] = 0; push(0, i); }
    }
  }
  // ground under a spot (within two cells: her body sits a little above her feet), or a ceiling over it
  const ground = i => wet[i] || (i + cols < n && solid[i + cols]) || (i + 2 * cols < n && solid[i + 2 * cols]);
  const ceiling = i => { for (let k = 1, j = i - cols; k <= 12 && j >= 0; k++, j -= cols) if (solid[j]) return true; return false; };   // a floor within ~70px overhead
  // a racer at `to` moves to `from`: up is a climb or a jump, sideways in mid-air is only a jump's
  // momentum (and never under a floor — that's falling, not flying)
  const relax = (from, to, kind, d0) => {
    if (wall[to]) return;
    let cost = kind === 'up' ? 4 : 1;
    if (kind === 'side' && !ground(to)) { if (ceiling(to)) return; cost = 3; }
    const d = d0 + cost * (wet[to] ? 1.6 : 1) * (hot[to] ? 5 : 1);
    if (d < dist[to]) { dist[to] = d; next[to] = from; push(d, to); }
  };
  while (heap.length) {
    const [d0, i] = pop(); if (d0 > dist[i]) continue;
    const x = i % cols, y = (i / cols) | 0;
    // (searching backwards: a racer at the neighbour comes here — from below means climbing up)
    if (x > 0) relax(i, i - 1, 'side', d0);
    if (x < cols - 1) relax(i, i + 1, 'side', d0);
    if (y > 0) relax(i, i - cols, 'down', d0);         // neighbour above: they drop down to here
    if (y < rows - 1) relax(i, i + cols, 'up', d0);    // neighbour below: they have to get up here
  }
  let max = 0; for (let i = 0; i < n; i++) if (dist[i] < Infinity && dist[i] > max) max = dist[i];
  // from the start, if it's reachable; otherwise the field's far end
  const sd = sample(t, cols, rows, dist, t.start[0], t.start[1]);
  t.field = { cols, rows, dist, next, max: Number.isFinite(sd) ? sd : max };
  return t.field;
}
// The lines near a spot (a coarse grid of them, built once per track), for sight checks.
const BUCKET = 48;
function linesNear(t, x, y) {
  if (!t.buckets) {
    t.buckets = new Map();
    for (const sg of t.segs) {
      const x0 = Math.floor(Math.min(sg.a[0], sg.b[0]) / BUCKET), x1 = Math.floor(Math.max(sg.a[0], sg.b[0]) / BUCKET), y0 = Math.floor(Math.min(sg.a[1], sg.b[1]) / BUCKET), y1 = Math.floor(Math.max(sg.a[1], sg.b[1]) / BUCKET);
      for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) { const k = by * 4096 + bx; if (!t.buckets.has(k)) t.buckets.set(k, []); t.buckets.get(k).push(sg); }
    }
  }
  const bx = Math.floor(x / BUCKET), by = Math.floor(y / BUCKET), out = new Set();
  for (let j = by - 1; j <= by + 1; j++) for (let i = bx - 1; i <= bx + 1; i++) for (const sg of t.buckets.get(j * 4096 + i) ?? []) out.add(sg);
  return out;
}
const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
const blocks = (px, py, qx, qy, { a, b }) => {
  const d1 = cross(a[0], a[1], b[0], b[1], px, py), d2 = cross(a[0], a[1], b[0], b[1], qx, qy), d3 = cross(px, py, qx, qy, a[0], a[1]), d4 = cross(px, py, qx, qy, b[0], b[1]);
  return d1 * d2 < 0 && d3 * d4 < 0;
};
// The field cell at a racer's body (mid-capsule): the nearest open one she can see from there —
// never one across a line (the cells are coarser than she is: right by a wall her own cell can
// hold the wall, and the cell beyond it belongs to the other side).
function cellAt(t, cols, rows, dist, x, y) {
  const by = y - BODY / 2, cx = Math.floor(x / CELL), cy = Math.floor(by / CELL), near = linesNear(t, x, by);
  const seen = (xx, yy) => { const tx = (xx + 0.5) * CELL, ty = (yy + 0.5) * CELL; for (const sg of near) if (blocks(x, by, tx, ty, sg)) return false; return true; };
  for (let r = 0; r <= 3; r++) {
    let above = -1, below = -1;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
      const i = yy * cols + xx; if (!Number.isFinite(dist[i])) continue;
      if (dy <= 0) { if ((above < 0 || dist[i] < dist[above]) && seen(xx, yy)) above = i; } else if ((below < 0 || dist[i] < dist[below]) && seen(xx, yy)) below = i;
    }
    if (above >= 0) return above;   // never read through the ground she stands on
    if (below >= 0) return below;
  }
  return -1;
}
function sample(t, cols, rows, dist, x, y) { const i = cellAt(t, cols, rows, dist, x, y); return i < 0 ? Infinity : dist[i]; }
// Which way the best path from here heads: follow it a few cells and see whether it goes left or
// right (0 while it goes straight up or down; `down` says it drops).
export function headingAt(t, x, y, out) {
  const f = t.field; let i = cellAt(t, f.cols, f.rows, f.dist, x, y);
  if (out) out.down = false;
  if (i < 0) return 0;
  const x0 = i % f.cols, y0 = (i / f.cols) | 0;
  for (let k = 0; k < 6 && f.next[i] >= 0; k++) i = f.next[i];
  const dx = Math.sign((i % f.cols) - x0);
  if (out) out.down = !dx && ((i / f.cols) | 0) > y0;
  return dx;
}
const way = { down: false };
export const distTo = (t, x, y) => { const f = t.field; return sample(t, f.cols, f.rows, f.dist, x, y); };
export const progressOf = (t, x, y) => { const d = distTo(t, x, y); return Number.isFinite(d) ? Math.max(0, t.field.max - d) : null; };
export const fractionOf = (t, x, y) => { const p = progressOf(t, x, y); return p == null ? null : clamp(p / (t.field.max || 1), 0, 1); };

// A standing spot about `q` (0..1) of the way along the course: for re-placing racers on a new track.
export function placeAtFraction(t, q) {
  let best = null, bd = Infinity;
  for (const { a, b, edge, floor } of t.segs) {
    if (edge || floor) continue;   // (never re-placed into lava or a pool)
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!L || Math.abs(b[1] - a[1]) > L * 0.8) continue;   // standable lines only
    for (let s = 0; s <= L; s += 8) {
      const x = a[0] + (b[0] - a[0]) * s / L, y = a[1] + (b[1] - a[1]) * s / L, f = fractionOf(t, x, y - 2);
      if (f == null) continue; const d = Math.abs(f - q); if (d < bd) { bd = d; best = [x, y]; }
    }
  }
  return best ?? t.start;
}

// ---------------------------------------------------------------- physics
export function makeRacer(o) {
  return Object.assign({ st: o.max, x: 0, y: 0, vx: 0, vy: 0, px: 0, boost: 0, trip: 0, tumble: 0, dead: 0, took: -1, hop: 0, hp: 100, hpMax: 100, burn: -1, prog: 0, best: 0, done: 0, pose: 'wait', dir: 1, safe: null, safeAt: 0, lag: 0 }, o);
}
// Closest points between segments p1–q1 and p2–q2 (Ericson, Real-Time Collision Detection 5.1.9).
function closest(p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d2x = q2x - p2x, d2y = q2y - p2y, rx = p1x - p2x, ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
  let s1, s2;
  if (e < 1e-9) { s2 = 0; s1 = a < 1e-9 ? 0 : clamp(-(d1x * rx + d1y * ry) / a, 0, 1); }
  else {
    const c = d1x * rx + d1y * ry, b = d1x * d2x + d1y * d2y, den = a * e - b * b;
    s1 = a < 1e-9 ? 0 : den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
    s2 = (b * s1 + f) / e;
    if (s2 < 0) { s2 = 0; s1 = a < 1e-9 ? 0 : clamp(-c / a, 0, 1); } else if (s2 > 1) { s2 = 1; s1 = a < 1e-9 ? 0 : clamp((b - c) / a, 0, 1); }
  }
  return [p1x + d1x * s1, p1y + d1y * s1, p2x + d2x * s2, p2y + d2y * s2];
}
// A racer is a capsule (a vertical stroke with round ends): pushed out of every line it overlaps,
// it rolls off corners and slides along edges instead of snagging on them.
function collide(r, t) {
  r.grounded = null; r.blocked = 0; r.touching = false;
  for (let pass = 0; pass < 2; pass++) for (const sg of t.segs) {
    const [ax, ay] = sg.a, [bx, by] = sg.b;
    if (sg.floor && r.y0 > ay + 1) continue;   // lava / pool floors only catch you from above (walking in at ground level, you stay on the ground)
    const [cx, cy, px, py] = closest(r.x, r.y - R, r.x, r.y - BODY + R, ax, ay, bx, by);
    let dx = cx - px, dy = cy - py, d = Math.hypot(dx, dy);
    if (d >= R) continue;
    if (d < 1e-6) { const L = Math.hypot(bx - ax, by - ay) || 1; dx = -(by - ay) / L; dy = (bx - ax) / L; if (dy > 0) { dx = -dx; dy = -dy; } d = 0; } else { dx /= d; dy /= d; }
    r.x += dx * (R - d); r.y += dy * (R - d); r.touching = true;
    const vn = r.vx * dx + r.vy * dy;
    if (vn < 0) { r.vx -= dx * vn * 1.04; r.vy -= dy * vn * 1.04; }
    if (dy < -0.55) r.grounded = sg;
    else if (!sg.edge && Math.abs(dx) > 0.75 && Math.abs(dy) < 0.5) r.blocked = dx < 0 ? 1 : -1;   // a wall ahead (+1: to the right; the arena's sides aren't for climbing)
  }
}
const inside = (list, x, y) => list.find(w => x > w.x0 && x < w.x1 && y > w.y0 - 2 && y < w.y1 + 3);

export function stepRacer(r, t, dt, racing) {
  if (r.dead > 0) { if ((r.dead -= dt) <= 0) respawn(r, t); return; }
  // which way is the finish from here? (the field falls toward it)
  // which way on: decided with her feet on something (mid-jump the air always looks like a detour)
  const wet = inside(t.water, r.x, r.y), hd = headingAt(t, r.x, r.y, way);
  if (hd && (r.grounded || r.blocked || wet || r.dead)) r.dir = hd;
  r.drop = way.down && !r.grounded;   // the way on is straight down: let go and fall
  const dir = r.dir, boost = r.boost > 0 ? 1.45 : 1, tired = r.st <= 0 ? 0.65 : 1, water = inside(t.water, r.x, r.y);
  const drive = racing && !r.done && r.trip <= 0 && r.tumble <= 0;
  let g = G;
  if (water) g = G * 0.15;
  else if (!r.grounded && r.vy > 0) g = G * (1 - 0.12 * sk01(r.sk.shape));   // Shape: a floatier glide down
  r.vy += g * dt;
  if (drive) {
    if (water) {
      const target = (30 + 38 * sk01(r.sk.colour)) * boost * tired;
      r.vx += clamp(dir * target - r.vx, -320 * dt, 320 * dt);
      if (r.y > water.y0 + 5) r.vy -= 340 * dt;   // bob up to swim along the surface
      r.st -= 3 * dt; r.pose = 'swim';
    } else if (r.blocked === dir && !r.drop) {
      r.vy = -(24 + 32 * sk01(r.sk.power)) * boost * tired; r.vx = dir * 14;
      r.st -= 4 * dt; r.pose = 'climb';
    } else if (r.grounded) {
      const { a, b } = r.grounded; let tx = b[0] - a[0], ty = b[1] - a[1]; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      if (tx * dir < 0) { tx = -tx; ty = -ty; }
      const target = (58 + 66 * sk01(r.sk.line)) * boost * tired * (r.burn > 0 ? 0.6 : 1), vt = r.vx * tx + r.vy * ty;   // wading through lava is slow
      if (vt < target) { const dv = Math.min(460 * dt, target - vt); r.vx += tx * dv; r.vy += ty * dv; }
      r.st -= 1.6 * dt; r.pose = 'run';
      if (Math.random() < dt * 0.02 * (1 - sk01(r.sk.luck) / 1.7)) r.trip = 0.7;   // Luck: fewer stumbles
      // the ground ends just ahead (a drawn gap with no pad): hop off the ledge rather than drop
      const end = (b[0] - a[0]) * dir > 0 ? b : a;
      if (r.hop <= 0 && Math.abs(end[0] - r.x) < 5 && (end[0] - r.x) * dir >= -1 && !t.segs.some(o => o !== r.grounded && !o.edge && (Math.hypot(o.a[0] - end[0], o.a[1] - end[1]) < 5 || Math.hypot(o.b[0] - end[0], o.b[1] - end[1]) < 5))) {
        r.hop = 0.5; r.vy = -(190 + 30 * sk01(r.sk.shape)); r.vx = dir * clamp(Math.abs(r.vx), 70, 110); r.grounded = null;
      }
      for (const tk of t.takes) {   // a jump pad / takeoff edge
        if (r.took === tk.id || Math.abs(r.y - tk.y) > 12 || Math.abs(r.x - tk.x) > 7) continue;
        r.took = tk.id; r.vy = -(250 + 30 * sk01(r.sk.shape)); r.vx = dir * 80; r.grounded = null; break;   // a pad's jump is always about the same length, so its landing is always in reach
      }
    } else {
      r.pose = 'air';
      // a little steering in the air (enough to get over the top of a wall after a jump beside it)
      if (!r.drop && Math.abs(r.vx) < 50) r.vx += dir * 220 * dt;
    }
  } else if (r.grounded) r.vx *= 1 - 6 * dt;   // standing still: friction
  if (water) { r.vx *= 1 - 1.4 * dt; r.vy *= 1 - 3.2 * dt; }
  r.px = r.x;
  const vy0 = r.vy, was = r.grounded;
  r.y0 = r.y;
  r.x += r.vx * dt; r.y += r.vy * dt;
  collide(r, t);
  if (!was && r.grounded && vy0 > 380 && racing && Math.random() < 0.3 * (1 - sk01(r.sk.luck) / 1.7)) r.trip = 0.8;   // hard landing
  r.boost -= dt; r.trip -= dt; r.tumble -= dt; r.hop -= dt; if (!r.grounded && !water) r.st = Math.min(r.max, r.st + 2 * dt);
  if (!racing) return;
  if (inside(t.pits, r.x, r.y) || r.y > t.H + 30 || r.y < -200) { r.dead = 0.6; return; }   // down a pit / off the arena
  // lava burns while she's in it (Luck: it singes less), with a yelp and a hop as she steps in;
  // only when she's out of health is she sent back to her last safe spot
  if (inside(t.hazards, r.x, r.y)) {
    if (r.burn <= -1) { r.vy = Math.min(r.vy, -160); r.grounded = null; r.trip = 0.25; }   // a yelp and a hop stepping in (not every step: she has to wade through)
    r.burn = 0.3;
    r.hp -= 38 * (1 - 0.4 * Math.min(1, sk01(r.sk.luck))) * dt;
    if (r.hp <= 0) { r.dead = 0.6; return; }
  } else { r.burn = Math.max(-1, r.burn - dt); r.hp = Math.min(r.hpMax, r.hp + 6 * dt); }
  const p = progressOf(t, r.x, r.y);
  if (p != null) { r.prog = p; if (p > r.best) r.best = p; }
  // stuck (wedged, or running into something it can't climb): jump, then try the other way, then
  // give up and go back to the last safe spot
  if (drive && !water) {
    if (r.best > (r.stuckAt ?? -1) + 3) { r.stuckAt = r.best; r.stuckT = 0; r.tries = 0; }
    else if ((r.grounded || r.touching) && (r.stuckT = (r.stuckT ?? 0) + dt) > 0.8) {   // (time in the air isn't being stuck)
      r.tries = (r.tries ?? 0) + 1; r.stuckT = 0.35;
      const back = r.tries % 3 === 0 ? -1 : 1;   // every third try, hop back the other way to get unwedged
      r.vy = -(240 + 30 * sk01(r.sk.shape) + 20 * Math.min(4, r.tries)); r.vx = r.dir * back * 40; r.grounded = null; r.pose = 'air';   // mostly up: a hop, not a leap into the next pit
      if (r.tries > 7) { r.dead = 0.5; r.tries = 0; r.stuckT = 0; return; }
    }
  }
  r.safeAt -= dt;
  if (r.grounded && !water && r.burn <= 0 && r.safeAt <= 0 && p != null && p >= r.best - 30) {   // (never in lava)   // a safe spot to come back to: well in from the ledge's ends
    const { a, b } = r.grounded, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L >= 16) { const u = clamp(((r.x - a[0]) * (b[0] - a[0]) + (r.y - a[1]) * (b[1] - a[1])) / (L * L), 10 / L, 1 - 10 / L); r.safe = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; }
    r.safeAt = 0.3;
  }
}
function respawn(r, t) {
  const [x, y] = r.safe ?? t.start;
  Object.assign(r, { x, y: y - 6, vx: 0, vy: 0, dead: 0, tumble: 0.3, took: -1, stuckT: 0, tries: 0, hp: r.hpMax, burn: -1 });
}
export const atFinish = (t, r) => !!t.finish && (Math.hypot(r.x - t.finish[0], r.y - t.finish[1]) < 16 || distTo(t, r.x, r.y) <= 2);

// ---------------------------------------------------------------- drawing
export function pixelLine(ctx, x0, y0, x1, y1, size) {   // crisp square-brush line, Bresenham
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, o = Math.floor(size / 2);
  let err = dx + dy;
  for (;;) { ctx.fillRect(x0 - o, y0 - o, size, size); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
}
export function flag(ctx, x, y, chequered) {
  ctx.fillStyle = '#221822'; ctx.fillRect(Math.round(x), Math.round(y) - 22, 2, 22);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) {
    ctx.fillStyle = chequered ? ((i + j) % 2 ? '#221822' : '#ffffff') : '#2fb36b';
    ctx.fillRect(Math.round(x) + 2 + i * 2, Math.round(y) - 22 + j * 2, 2, 2);
  }
}
// Water, hazards, the lines (up to `reveal` of their length: Pyxl drawing it), pads and flags.
export function drawTrack(ctx, t, { now = performance.now(), reveal = Infinity, flags = true } = {}) {
  const wave = Math.floor(now / 160) % 4;
  for (const w of t.water) {
    ctx.fillStyle = 'rgba(70,140,255,.45)'; ctx.fillRect(Math.round(w.x0), Math.round(w.y0), Math.round(w.x1 - w.x0), Math.round(w.y1 - w.y0));
    ctx.fillStyle = 'rgba(225,242,255,.95)';
    for (let x = Math.round(w.x0); x < w.x1; x += 4) ctx.fillRect(x, Math.round(w.y0) + ((x / 4 + wave) % 4 < 2 ? 0 : 1), 2, 1);
  }
  const bub = Math.floor(now / 120);
  for (const z of t.hazards) {   // lava: glowing, with bubbles popping along its top
    const x0 = Math.round(z.x0), y0 = Math.round(z.y0), w = Math.round(z.x1 - z.x0), hh = Math.round(z.y1 - z.y0);
    ctx.fillStyle = 'rgba(255,106,43,.82)'; ctx.fillRect(x0, y0, w, hh);
    ctx.fillStyle = 'rgba(200,40,30,.55)'; ctx.fillRect(x0, y0 + Math.ceil(hh / 2), w, Math.floor(hh / 2));
    ctx.fillStyle = '#ffd23f'; ctx.fillRect(x0, y0, w, 1);
    for (let x = x0 + 2; x < x0 + w - 2; x += 7) { const ph = (x * 7 + bub) % 9; if (ph < 3) ctx.fillRect(x, y0 - ph, 2, 2); }
  }
  let tip = null;
  const lines = t.segs.filter(sg => !sg.edge && !sg.floor);
  for (const pass of [0, 1]) {   // a light halo under dark ink, so the course reads over any drawing
    ctx.fillStyle = pass ? '#221822' : 'rgba(255,255,255,.9)';
    let acc = 0;
    for (const sg of lines) {
      const L = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]);
      if (acc >= reveal) break;
      const f = Math.min(1, (reveal - acc) / (L || 1)), ex = sg.a[0] + (sg.b[0] - sg.a[0]) * f, ey = sg.a[1] + (sg.b[1] - sg.a[1]) * f;
      pixelLine(ctx, sg.a[0], sg.a[1], ex, ey, pass ? 2 : 4);
      if (pass && f < 1) tip = [ex, ey];
      acc += L;
    }
  }
  const all = reveal >= t.inkLen;
  if (all) for (const tk of t.takes) {   // jump pads: a yellow spring
    const x = Math.round(tk.x), y = Math.round(tk.y);
    ctx.fillStyle = '#221822'; ctx.fillRect(x - 4, y - 4, 9, 4);
    ctx.fillStyle = '#ffd23f'; ctx.fillRect(x - 3, y - 3, 7, 2);
  }
  if (flags) { flag(ctx, t.start[0] - 10, t.start[1], false); if (t.finish && all) flag(ctx, t.finish[0], t.finish[1], true); }
  return tip;
}
