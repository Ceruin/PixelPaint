// Race courses as plain, portable data — Pyxl's generated ones, ones you draw in the course
// builder, and shared ones all look the same:
//   { v: 1, name, w, h, segs: [[ax, ay, bx, by]], water: [[x0, y0, x1, y1]], hazards: [[x0, y0, x1, y1]],
//     takes: [[x, y]], start: [x, y], finish: [x, y] }
// in "scene" pixels of the arena it was made for (w × h). A track is a course prepared for the arena
// it's raced in: fitted (and turned 90° if the arena's orientation differs), with a distance field
// from the finish so racers on any course know which way to go and who's ahead.
export const COURSE_VERSION = 1;
const CELL = 6;   // distance-field grid (scene px)
export const G = 640, R = 3;
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
  const pit = (sa, sb) => c.hazards.push([Math.min(X(sa), X(sb)), base + 34, Math.max(X(sa), X(sb)), base + 58].map(Math.round));   // falling in a gap = back to your last spot
  let s = 0, hh = 0;
  const end = finish ? len - 40 : len - 26;   // a row that isn't last stays open at its far end: you drop to the next
  if (start || entry) { seg(0, 0, 44, 0); s = 44; }
  while (s < end - 30) {
    let type = pick(), [w0, w1] = WIDTH[type], w = Math.round(w0 + rnd() * (w1 - w0));
    if (s + w > end) { w = end - s; type = w < 60 ? 'run' : type === 'platforms' && w < 110 ? 'gap' : type; }
    if (type === 'run') { const nh = clamp(hh + (rnd() - 0.5) * 16, -34, 6); seg(s, hh, s + w, nh); hh = nh; }
    else if (type === 'hill') { const pk = hh - 14 - rnd() * 12, m = s + w / 2; seg(s, hh, m - 7, pk); seg(m - 7, pk, m + 7, pk); seg(m + 7, pk, s + w, hh); }
    else if (type === 'water') {
      const d = 28, a = s + w * 0.16, b = s + w * 0.84;
      seg(s, hh, a, hh + d); seg(a, hh + d, b, hh + d); seg(b, hh + d, s + w, hh);
      c.water.push([Math.min(X(s + w * 0.07), X(s + w * 0.93)), base + hh + 3, Math.max(X(s + w * 0.07), X(s + w * 0.93)), base + hh + d].map(Math.round));
    } else if (type === 'gap') {
      const r1 = s + w * 0.3, l0 = s + w * 0.68;
      seg(s, hh, r1, hh - 9); take(r1 - 2, hh - 9); seg(l0, hh, s + w, hh); pit(r1, l0);
    } else if (type === 'wall') {
      const at = s + w * 0.42;
      if (hh < -26) { seg(s, hh, at, hh); seg(at, hh, at, hh + 26); seg(at, hh + 26, s + w, hh + 26); hh += 26; }   // too high up: a drop instead
      else { seg(s, hh, at, hh); seg(at, hh, at, hh - 26); seg(at, hh - 26, s + w, hh - 26); hh -= 26; }
    } else if (type === 'platforms') {
      const a = s + w * 0.2, p0 = s + w * 0.4, p1 = s + w * 0.56, l0 = s + w * 0.76;
      seg(s, hh, a, hh); take(a - 2, hh); seg(p0, hh - 12, p1, hh - 12); take(p1 - 2, hh - 12); seg(l0, hh, s + w, hh); pit(a, l0);
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
  const vertical = H > W * 1.15, c = { v: COURSE_VERSION, name: 'Pyxl’s course', w: W, h: H, segs: [], water: [], hazards: [], takes: [], start: null, finish: null };
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
export const LIMITS = { segs: 3000, water: 60, hazards: 60, takes: 120 };
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
    water: list(c.water, box, LIMITS.water), hazards: list(c.hazards, box, LIMITS.hazards), takes: list(c.takes, pt, LIMITS.takes),
    start: pt(c.start), finish: pt(c.finish),
  };
}
export const isVertical = c => c.h > c.w * 1.15;

// ---------------------------------------------------------------- a course fitted to an arena
export function prepareTrack(course, W, H, { turn = true } = {}) {
  let c = course;
  // raced in an arena of the other orientation: turn it 90° so it still fills the space (gravity
  // stays down, so the run changes — part of the fun when the device is turned mid-race)
  const turned = turn && isVertical(c) !== (H > W * 1.15) && Math.max(c.w, c.h) > 1.3 * Math.min(c.w, c.h);
  const tp = turned ? (x, y) => [c.h - y, x] : (x, y) => [x, y], cw = turned ? c.h : c.w, ch = turned ? c.w : c.h;
  const k = Math.min(W / cw, H / ch), ox = (W - cw * k) / 2, oy = (H - ch * k) / 2;
  const P = (x, y) => { const [a, b] = tp(x, y); return [ox + a * k, oy + b * k]; };
  const rect = ([x0, y0, x1, y1]) => { const [a, b] = P(x0, y0), [d, e] = P(x1, y1); return { x0: Math.min(a, d), y0: Math.min(b, e), x1: Math.max(a, d), y1: Math.max(b, e) }; };
  const t = {
    course, W, H, k, turned,
    segs: c.segs.map(([ax, ay, bx, by]) => ({ a: P(ax, ay), b: P(bx, by) })),
    water: (c.water ?? []).map(rect), hazards: (c.hazards ?? []).map(rect),
    takes: (c.takes ?? []).map(([x, y], id) => { const [a, b] = P(x, y); return { x: a, y: b, id }; }),
    start: c.start ? P(...c.start) : [W * 0.1, H * 0.5], finish: c.finish ? P(...c.finish) : null,
  };
  t.segs.push({ a: [2, 0], b: [2, H], edge: true }, { a: [W - 2, 0], b: [W - 2, H], edge: true });   // the arena's sides
  let acc = 0; for (const sg of t.segs) if (!sg.edge) acc += Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]);
  t.inkLen = acc;
  return t;
}

// Distance (over open air, around the lines) from every spot to the finish. Built once per race.
export function buildField(t) {
  const cols = Math.ceil(t.W / CELL), rows = Math.ceil(t.H / CELL), n = cols * rows, wall = new Uint8Array(n), dist = new Float32Array(n).fill(Infinity);
  for (const { a, b } of t.segs) {   // lines block
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2)));
    for (let i = 0; i <= steps; i++) {
      const x = a[0] + (b[0] - a[0]) * i / steps, y = a[1] + (b[1] - a[1]) * i / steps, cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) wall[cy * cols + cx] = 1;
    }
  }
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  if (t.finish) {
    const fx = Math.floor(t.finish[0] / CELL), fy = Math.floor((t.finish[1] - 8) / CELL);
    for (let dy = -3; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = fx + dx, y = fy + dy; if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const i = y * cols + x; if (!wall[i] && dist[i] === Infinity) { dist[i] = 0; q[tail++] = i; }
    }
  }
  while (head < tail) {
    const i = q[head++], x = i % cols, y = (i / cols) | 0, d = dist[i] + 1;
    if (x > 0 && !wall[i - 1] && dist[i - 1] > d) { dist[i - 1] = d; q[tail++] = i - 1; }
    if (x < cols - 1 && !wall[i + 1] && dist[i + 1] > d) { dist[i + 1] = d; q[tail++] = i + 1; }
    if (y > 0 && !wall[i - cols] && dist[i - cols] > d) { dist[i - cols] = d; q[tail++] = i - cols; }
    if (y < rows - 1 && !wall[i + cols] && dist[i + cols] > d) { dist[i + cols] = d; q[tail++] = i + cols; }
  }
  let max = 0; for (let i = 0; i < n; i++) if (dist[i] < Infinity && dist[i] > max) max = dist[i];
  // from the start, if it's reachable; otherwise the field's far end
  const sd = sample(t, cols, rows, dist, t.start[0], t.start[1]);
  t.field = { cols, rows, dist, max: Number.isFinite(sd) ? sd : max };
  return t.field;
}
function sample(t, cols, rows, dist, x, y) {   // field at a racer's body (a little above the feet), nearest open cell
  const cx = Math.floor(x / CELL), cy = Math.floor((y - 8) / CELL);
  let best = Infinity;
  for (let r = 0; r <= 2 && best === Infinity; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
    const d = dist[yy * cols + xx]; if (d < best) best = d;
  }
  return best;
}
export const distTo = (t, x, y) => { const f = t.field; return sample(t, f.cols, f.rows, f.dist, x, y); };
export const progressOf = (t, x, y) => { const d = distTo(t, x, y); return Number.isFinite(d) ? Math.max(0, t.field.max - d) : null; };
export const fractionOf = (t, x, y) => { const p = progressOf(t, x, y); return p == null ? null : clamp(p / (t.field.max || 1), 0, 1); };

// A standing spot about `q` (0..1) of the way along the course: for re-placing racers on a new track.
export function placeAtFraction(t, q) {
  let best = null, bd = Infinity;
  for (const { a, b, edge } of t.segs) {
    if (edge) continue;
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
  return Object.assign({ st: o.max, x: 0, y: 0, vx: 0, vy: 0, px: 0, boost: 0, trip: 0, tumble: 0, dead: 0, took: -1, hop: 0, prog: 0, best: 0, done: 0, pose: 'wait', dir: 1, safe: null, safeAt: 0, lag: 0 }, o);
}
function collide(r, t) {
  r.grounded = null; r.blocked = 0;
  for (let pass = 0; pass < 2; pass++) for (const sg of t.segs) {
    const [ax, ay] = sg.a, [bx, by] = sg.b, cx = r.x, cy = r.y - R;
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1, u = clamp(((cx - ax) * ex + (cy - ay) * ey) / l2, 0, 1);
    let dx = cx - (ax + ex * u), dy = cy - (ay + ey * u), d = Math.hypot(dx, dy);
    if (d >= R) continue;
    if (d < 1e-6) { const L = Math.sqrt(l2); dx = -ey / L; dy = ex / L; d = 0; } else { dx /= d; dy /= d; }
    r.x += dx * (R - d); r.y += dy * (R - d);
    const vn = r.vx * dx + r.vy * dy;
    if (vn < 0) { r.vx -= dx * vn * 1.04; r.vy -= dy * vn * 1.04; }
    if (dy < -0.55) r.grounded = sg;
    else if (Math.abs(dx) > 0.75 && Math.abs(dy) < 0.5) r.blocked = dx < 0 ? 1 : -1;   // a wall ahead (+1: to the right)
  }
}
const inside = (list, x, y) => list.find(w => x > w.x0 && x < w.x1 && y > w.y0 - 2 && y < w.y1 + 3);

export function stepRacer(r, t, dt, racing) {
  if (r.dead > 0) { if ((r.dead -= dt) <= 0) respawn(r, t); return; }
  // which way is the finish from here? (the field falls toward it)
  const dl = distTo(t, r.x - 12, r.y), dr = distTo(t, r.x + 12, r.y);
  if (dl < dr - 0.5) r.dir = -1; else if (dr < dl - 0.5) r.dir = 1;
  const dir = r.dir, boost = r.boost > 0 ? 1.45 : 1, tired = r.st <= 0 ? 0.65 : 1, water = inside(t.water, r.x, r.y);
  const drive = racing && !r.done && r.trip <= 0 && r.tumble <= 0;
  let g = G;
  if (water) g = G * 0.15;
  else if (!r.grounded && r.vy > 0) g = G * (1 - 0.25 * sk01(r.sk.shape));   // Shape: a floaty glide down
  r.vy += g * dt;
  if (drive) {
    if (water) {
      const target = (30 + 38 * sk01(r.sk.colour)) * boost * tired;
      r.vx += clamp(dir * target - r.vx, -320 * dt, 320 * dt);
      if (r.y > water.y0 + 5) r.vy -= 340 * dt;   // bob up to swim along the surface
      r.st -= 3 * dt; r.pose = 'swim';
    } else if (r.blocked === dir) {
      r.vy = -(24 + 32 * sk01(r.sk.power)) * boost * tired; r.vx = dir * 14;
      r.st -= 4 * dt; r.pose = 'climb';
    } else if (r.grounded) {
      const { a, b } = r.grounded; let tx = b[0] - a[0], ty = b[1] - a[1]; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      if (tx * dir < 0) { tx = -tx; ty = -ty; }
      const target = (58 + 66 * sk01(r.sk.line)) * boost * tired, vt = r.vx * tx + r.vy * ty;
      if (vt < target) { const dv = Math.min(460 * dt, target - vt); r.vx += tx * dv; r.vy += ty * dv; }
      r.st -= 1.6 * dt; r.pose = 'run';
      if (Math.random() < dt * 0.02 * (1 - sk01(r.sk.luck) / 1.7)) r.trip = 0.7;   // Luck: fewer stumbles
      // the ground ends just ahead (a drawn gap with no pad): hop off the ledge rather than drop
      const end = (b[0] - a[0]) * dir > 0 ? b : a;
      if (r.hop <= 0 && Math.abs(end[0] - r.x) < 5 && (end[0] - r.x) * dir >= -1 && !t.segs.some(o => o !== r.grounded && !o.edge && (Math.hypot(o.a[0] - end[0], o.a[1] - end[1]) < 5 || Math.hypot(o.b[0] - end[0], o.b[1] - end[1]) < 5))) {
        r.hop = 0.5; r.vy = -(190 + 70 * sk01(r.sk.shape)); r.vx = dir * Math.max(Math.abs(r.vx), 70) * boost; r.grounded = null;
      }
      for (const tk of t.takes) {   // a jump pad / takeoff edge
        if (r.took === tk.id || Math.abs(r.y - tk.y) > 12 || Math.abs(r.x - tk.x) > 7) continue;
        r.took = tk.id; r.vy = -(250 + 90 * sk01(r.sk.shape)); r.vx = dir * Math.max(Math.abs(r.vx), 74) * boost; r.grounded = null; break;
      }
    } else r.pose = 'air';
  } else if (r.grounded) r.vx *= 1 - 6 * dt;   // standing still: friction
  if (water) { r.vx *= 1 - 1.4 * dt; r.vy *= 1 - 3.2 * dt; }
  r.px = r.x;
  const vy0 = r.vy, was = r.grounded;
  r.x += r.vx * dt; r.y += r.vy * dt;
  collide(r, t);
  if (!was && r.grounded && vy0 > 380 && racing && Math.random() < 0.3 * (1 - sk01(r.sk.luck) / 1.7)) r.trip = 0.8;   // hard landing
  r.boost -= dt; r.trip -= dt; r.tumble -= dt; r.hop -= dt; if (!r.grounded && !water) r.st = Math.min(r.max, r.st + 2 * dt);
  if (!racing) return;
  if (inside(t.hazards, r.x, r.y) || r.y > t.H + 30 || r.y < -200) { r.dead = 0.6; return; }   // a pit / off the arena
  const p = progressOf(t, r.x, r.y);
  if (p != null) { r.prog = p; if (p > r.best) r.best = p; }
  r.safeAt -= dt;
  if (r.grounded && !water && r.safeAt <= 0 && p != null && p >= r.best - 30) { r.safe = [r.x, r.y]; r.safeAt = 0.3; }
}
function respawn(r, t) {
  const [x, y] = r.safe ?? t.start;
  Object.assign(r, { x, y: y - 6, vx: 0, vy: 0, dead: 0, tumble: 0.3, took: -1 });
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
  for (const z of t.hazards) {   // spikes along the top of a hazard zone
    ctx.fillStyle = 'rgba(224,72,90,.28)'; ctx.fillRect(Math.round(z.x0), Math.round(z.y0), Math.round(z.x1 - z.x0), Math.round(z.y1 - z.y0));
    ctx.fillStyle = '#e0485a';
    for (let x = Math.round(z.x0); x < z.x1 - 3; x += 6) { ctx.fillRect(x + 2, Math.round(z.y0), 2, 1); ctx.fillRect(x + 1, Math.round(z.y0) + 1, 4, 1); ctx.fillRect(x, Math.round(z.y0) + 2, 6, 1); }
  }
  let tip = null;
  const lines = t.segs.filter(sg => !sg.edge);
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
