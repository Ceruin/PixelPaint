import { h, icon } from './dom.js';
import { drawPose, tinted } from './mascot.js';
import { pixelText } from './pixelFont.js';
import { LUCKY_NAMES } from './pyxlStats.js';
import { stageBox } from './pyxlGames.js';

// Pyxl races, Line Rider style: Pyxl draws a course of lines right over your drawing (it shows
// through as the backdrop; nothing is added to your document), then four racers ride it with real
// physics — running the slopes, jumping gaps, swimming the water, climbing walls. Each move runs on
// its skill: Line = running, Colour = swimming, Shape = jumping and gliding, Power = climbing, Luck =
// not tripping. A wide canvas area races left to right; a tall one zig-zags top to bottom. Turn the
// device mid-race and the course re-lays for the new shape while gravity keeps pointing down — so
// everyone drops onto it. Tap / Space cheers (a burst of speed that costs stamina).
export const RACES = [
  ['beginner', 'Beginner', [0, 90], 15],
  ['jewel', 'Jewel', [260, 900], 40],
  ['challenge', 'Challenge', [900, 1900], 90],
];
const MEDALS = ['Gold', 'Silver', 'Bronze'];
export const raceUnlocked = (stats, i) => i === 0 || (stats.medals?.[RACES[i - 1][0]] ?? 9) === 0;
export const medalName = i => MEDALS[i] ?? null;

const RIVAL_COLOURS = ['#ff5a7a', '#ffb02e', '#8b5cff', '#2fb36b', '#3b7bff', '#ff7a3b'];
const POOLS = {   // what each race's course is made of (cycled, shuffled per race)
  beginner: ['run', 'hill', 'water', 'run', 'gap', 'hill', 'run'],
  jewel: ['hill', 'gap', 'water', 'wall', 'run', 'platforms', 'hill', 'gap'],
  challenge: ['gap', 'wall', 'water', 'platforms', 'hill', 'gap', 'wall', 'platforms', 'water', 'hill'],
};
const WIDTH = { run: [50, 80], hill: [70, 100], water: [90, 120], gap: [80, 105], wall: [70, 95], platforms: [120, 150] };
const G = 640, R = 3, DT = 1 / 120, TIME_LIMIT = 90;
const sk01 = pts => Math.max(0, Math.min(1.6, pts / 1200));   // a skill as a 0..1.6 multiplier
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const seeded = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---------------------------------------------------------------- the course
// One strip of course, built along s (0 → len) in race direction `dir`, ground at `base`.
function buildStrip(C, rnd, pick, row, { start, finish, entry }) {
  const { x0, x1, base, dir } = row, len = x1 - x0;
  const X = s => (dir > 0 ? x0 + s : x1 - s), P = (s, hh) => [X(s), base + hh];
  const seg = (sa, ha, sb, hb) => C.segs.push({ a: P(sa, ha), b: P(sb, hb) });
  const cp = (s, hh) => C.cps.push({ u: row.off + s, x: X(s), y: base + hh });
  const take = (s, hh) => C.takes.push({ x: X(s), y: base + hh, dir, id: C.takes.length });
  let s = 0, hh = 0;
  const end = finish ? len - 40 : len - 26;   // a row that isn't last stays open at its far end: you drop to the next
  if (start || entry) { seg(0, 0, 44, 0); cp(6, 0); s = 44; }
  while (s < end - 30) {
    let type = pick(), [w0, w1] = WIDTH[type], w = Math.round(w0 + rnd() * (w1 - w0));
    if (s + w > end) { w = end - s; type = w < 60 ? 'run' : type === 'platforms' && w < 110 ? 'gap' : type; }
    cp(s + 4, hh);
    if (type === 'run') { const nh = clamp(hh + (rnd() - 0.5) * 16, -34, 6); seg(s, hh, s + w, nh); hh = nh; }
    else if (type === 'hill') { const pk = hh - 14 - rnd() * 12, m = s + w / 2; seg(s, hh, m - 7, pk); seg(m - 7, pk, m + 7, pk); seg(m + 7, pk, s + w, hh); }
    else if (type === 'water') {
      const d = 28, a = s + w * 0.16, b = s + w * 0.84;
      seg(s, hh, a, hh + d); seg(a, hh + d, b, hh + d); seg(b, hh + d, s + w, hh);
      C.water.push({ x0: Math.min(X(s + w * 0.07), X(s + w * 0.93)), x1: Math.max(X(s + w * 0.07), X(s + w * 0.93)), y0: base + hh + 3, y1: base + hh + d });
    } else if (type === 'gap') {
      const r1 = s + w * 0.3, l0 = s + w * 0.68;
      seg(s, hh, r1, hh - 9); take(r1 - 2, hh - 9); seg(l0, hh, s + w, hh);
    } else if (type === 'wall') {
      const at = s + w * 0.42;
      if (hh < -26) { seg(s, hh, at, hh); seg(at, hh, at, hh + 26); seg(at, hh + 26, s + w, hh + 26); hh += 26; }   // too high up: a drop instead
      else { seg(s, hh, at, hh); seg(at, hh, at, hh - 26); seg(at, hh - 26, s + w, hh - 26); hh -= 26; }
    } else if (type === 'platforms') {
      const a = s + w * 0.2, p0 = s + w * 0.4, p1 = s + w * 0.56, l0 = s + w * 0.76;
      seg(s, hh, a, hh); take(a - 2, hh); seg(p0, hh - 12, p1, hh - 12); take(p1 - 2, hh - 12); seg(l0, hh, s + w, hh);
    }
    s += w;
  }
  seg(s, hh, end, hh);
  if (finish) { seg(end, hh, len - 4, hh); C.finish = { x: X(end), y: base + hh, u: row.off + end }; }
  row.len = len; row.exit = !finish;
}

// Lay the course out for a W×H arena: one row left → right if it's wide, switchbacks if it's tall.
export function layoutCourse(W, H, level, seed) {
  const rnd = seeded(seed), pool = POOLS[RACES[level][0]] ?? POOLS.beginner;
  let deck = [], i = 0;
  const pick = () => { if (i >= deck.length) { deck = pool.slice().sort(() => rnd() - 0.5); i = 0; } return deck[i++]; };
  const vertical = H > W * 1.15, C = { W, H, vertical, segs: [], water: [], takes: [], cps: [], rows: [], finish: null };
  const n = vertical ? Math.max(2, Math.min(6, Math.floor(H / 190))) : 1, sh = H / n;
  let off = 0;
  for (let r = 0; r < n; r++) {
    const dir = r % 2 ? -1 : 1, row = { y0: r * sh, y1: (r + 1) * sh, base: Math.round(r * sh + sh * (vertical ? 0.74 : 0.66)), dir, x0: 6, x1: W - 6, off };
    C.rows.push(row);
    buildStrip(C, rnd, pick, row, { start: r === 0, finish: r === n - 1, entry: r > 0 });
    off += row.len;
  }
  C.total = off;
  C.start = { x: C.rows[0].x0 + 18, y: C.rows[0].base };
  // side walls keep everyone in the arena (and let a row's open end drop you onto the next one)
  C.segs.push({ a: [2, 0], b: [2, H], edge: true }, { a: [W - 2, 0], b: [W - 2, H], edge: true });
  C.cps.sort((a, b) => a.u - b.u);
  let acc = 0; C.drawn = C.segs.filter(sg => !sg.edge).map(sg => (acc += Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]), acc));
  C.inkLen = acc;
  return C;
}
const rowOf = (C, y) => C.rows[clamp(Math.floor(y / (C.H / C.rows.length)), 0, C.rows.length - 1)];
const progressOf = (C, x, y) => { const r = rowOf(C, y); return r.off + clamp(r.dir > 0 ? x - r.x0 : r.x1 - x, 0, r.len); };
// The ground under x on a row (the highest non-vertical line there), for placing racers.
function groundAt(C, row, x) {
  let best = null;
  for (const { a, b, edge } of C.segs) {
    if (edge || a[0] === b[0]) continue;
    const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]); if (x < lo || x > hi) continue;
    const y = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    if (y >= row.y0 && y <= row.y1 && (best == null || y < best)) best = y;
  }
  return best;
}
// Where a progress value u sits on the course (on the ground, or the nearest ground ahead).
function placeAt(C, u) {
  u = clamp(u, 0, C.total - 1);
  const row = C.rows.find(r => u < r.off + r.len) ?? C.rows.at(-1);
  for (let d = 0; d < 80; d += 4) {
    const s = clamp(u - row.off + d, 0, row.len), x = row.dir > 0 ? row.x0 + s : row.x1 - s, y = groundAt(C, row, x);
    if (y != null) return { x, y, row };
  }
  return { x: row.dir > 0 ? row.x0 + 20 : row.x1 - 20, y: row.base, row };
}

// ---------------------------------------------------------------- physics
function collide(r, C) {
  r.grounded = null; r.blocked = 0;
  for (let pass = 0; pass < 2; pass++) for (const sg of C.segs) {
    const [ax, ay] = sg.a, [bx, by] = sg.b, cx = r.x, cy = r.y - R;
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1, t = clamp(((cx - ax) * ex + (cy - ay) * ey) / l2, 0, 1);
    const px = ax + ex * t, py = ay + ey * t; let dx = cx - px, dy = cy - py, d = Math.hypot(dx, dy);
    if (d >= R) continue;
    if (d < 1e-6) { const L = Math.sqrt(l2); dx = -ey / L; dy = ex / L; d = 0; } else { dx /= d; dy /= d; }
    r.x += dx * (R - d); r.y += dy * (R - d);
    const vn = r.vx * dx + r.vy * dy;
    if (vn < 0) { r.vx -= dx * vn * 1.04; r.vy -= dy * vn * 1.04; }
    if (dy < -0.55) r.grounded = sg;
    else if (Math.abs(dx) > 0.75 && Math.abs(dy) < 0.5) r.blocked = dx < 0 ? 1 : -1;   // a wall ahead (+1: to the right)
  }
}

function stepRacer(r, C, dt, racing) {
  if (r.dead > 0) { if ((r.dead -= dt) <= 0) respawn(r, C); return; }
  const row = rowOf(C, r.y), dir = row.dir, boost = r.boost > 0 ? 1.45 : 1, tired = r.st <= 0 ? 0.65 : 1;
  const water = C.water.find(w => r.x > w.x0 && r.x < w.x1 && r.y > w.y0 - 2 && r.y < w.y1 + 3);
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
      for (const tk of C.takes) {   // a takeoff edge: jump the gap
        if (tk.dir !== dir || r.took === tk.id || Math.abs(r.y - tk.y) > 12) continue;
        if ((r.px - tk.x) * dir < 0 && (r.x - tk.x) * dir >= 0) {
          r.took = tk.id; r.vy = -(250 + 90 * sk01(r.sk.shape)); r.vx = dir * Math.max(Math.abs(r.vx), 74) * boost; r.grounded = null; break;
        }
      }
    } else r.pose = 'air';
  } else if (r.grounded) r.vx *= 1 - 6 * dt;   // standing still: friction
  if (water) { r.vx *= 1 - 1.4 * dt; r.vy *= 1 - 3.2 * dt; }
  r.px = r.x; r.py = r.y;
  const vy0 = r.vy;
  r.x += r.vx * dt; r.y += r.vy * dt;
  const was = r.grounded;
  collide(r, C);
  if (!was && r.grounded && vy0 > 380 && racing && Math.random() < 0.3 * (1 - sk01(r.sk.luck) / 1.7)) r.trip = 0.8;   // hard landing
  r.boost -= dt; r.trip -= dt; r.tumble -= dt; r.st = Math.min(r.max, r.st + (r.grounded || water ? 0 : 2 * dt));
  if (!racing) return;
  // fell into a pit (but dropping off a row's open end onto the next row is the way down)
  const now = rowOf(C, r.y), atExit = now.exit && (now.dir > 0 ? r.x > now.x1 - 40 : r.x < now.x0 + 40);
  if ((r.y > now.base + 46 && !water && !atExit) || r.y > C.H + 30) { r.dead = 0.6; return; }
  const u = progressOf(C, r.x, r.y);
  if (u > r.maxU && (r.grounded || water || u - r.maxU < 60)) r.maxU = u;
}
function respawn(r, C) {
  const cp = [...C.cps].reverse().find(c => c.u <= r.maxU + 1) ?? C.cps[0] ?? { x: C.start.x, y: C.start.y };
  Object.assign(r, { x: cp.x, y: cp.y - 6, vx: 0, vy: 0, dead: 0, tumble: 0.3, took: -1 });
}

// ---------------------------------------------------------------- drawing
function pixelLine(ctx, x0, y0, x1, y1, size) {   // crisp square-brush line, Bresenham
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, o = Math.floor(size / 2);
  let err = dx + dy;
  for (;;) { ctx.fillRect(x0 - o, y0 - o, size, size); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
}
function drawInk(ctx, C, upTo = Infinity) {
  const lines = C.segs.filter(sg => !sg.edge);
  let tip = null;
  for (const pass of [0, 1]) {   // a light halo under dark ink, so the course reads over any drawing
    ctx.fillStyle = pass ? '#221822' : 'rgba(255,255,255,.9)';
    let acc = 0;
    for (const sg of lines) {
      const L = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]);
      if (acc >= upTo) break;
      const k = Math.min(1, (upTo - acc) / L), ex = sg.a[0] + (sg.b[0] - sg.a[0]) * k, ey = sg.a[1] + (sg.b[1] - sg.a[1]) * k;
      pixelLine(ctx, sg.a[0], sg.a[1], ex, ey, pass ? 2 : 4);
      if (pass && k < 1) tip = [ex, ey];
      acc += L;
    }
  }
  return tip;
}
function flag(ctx, x, y, chequered) {
  ctx.fillStyle = '#221822'; ctx.fillRect(Math.round(x), Math.round(y) - 22, 2, 22);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) {
    ctx.fillStyle = chequered ? ((i + j) % 2 ? '#221822' : '#ffffff') : '#2fb36b';
    ctx.fillRect(Math.round(x) + 2 + i * 2, Math.round(y) - 22 + j * 2, 2, 2);
  }
}
const POSE = { run: ['walk', 'idle1'], air: ['raise'], climb: ['raise', 'point'], swim: ['floor'], trip: ['oops'], done: ['cheer', 'happy'], wait: ['idle0', 'idle1'] };

// ---------------------------------------------------------------- the race
export function startRace(pyxl, level = 0) {
  const s = pyxl.stats, [, title, [lo, hi], prize] = RACES[level];
  const skill = k => s.skills[k]?.pts ?? 0;
  const me = { name: s.name, me: true, sk: { line: skill('line'), colour: skill('colour'), shape: skill('shape'), power: skill('power'), luck: skill('luck') }, max: 80 + skill('stamina') / 10 };
  const names = LUCKY_NAMES.filter(n => n !== s.name).sort(() => Math.random() - 0.5);
  const rivals = [0, 1, 2].map(i => {
    const r = () => lo + Math.random() * (hi - lo);
    return { name: names[i], colour: RIVAL_COLOURS[(level * 2 + i) % RIVAL_COLOURS.length], sk: { line: r(), colour: r(), shape: r(), power: r(), luck: r() }, max: 80 + r() / 10 };
  });
  const racers = [rivals[0], me, rivals[1], rivals[2]];
  racers.forEach((r, i) => Object.assign(r, { st: r.max, x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, boost: 0, trip: 0, tumble: 0, dead: 0, took: -1, maxU: 0, done: 0, pose: 'wait', lag: i * 0.12 }));

  const cv = h('canvas.race-canvas'), ctx = cv.getContext('2d');
  const cheer = h('button.btn.primary', { type: 'button' }, icon('sparkle'), 'Cheer!');
  const close = h('button.ibtn.sm', { type: 'button', 'aria-label': 'Close' }, icon('x'));
  const board = h('ol.race-board');
  const layer = h('div.race-layer.course', {}, cv, board,
    h('div.race-head', {}, icon('film'), h('strong', {}, `${title} Race`), close),
    h('div.race-foot', {}, cheer, h('small', {}, 'Tap or Space to cheer — it costs stamina')));
  document.body.append(layer);
  document.body.dataset.game = '';

  const seed = 1 + Math.floor(Math.random() * 2e9);
  let C = null, W = 0, H = 0, n = 1;
  // Fit the scene to the canvas area: a whole number of device pixels per scene pixel, ~620 on the short side.
  const fit = () => {
    const b = stageBox(pyxl.app, { page: false }), dpr = devicePixelRatio || 1;
    const dw = Math.round(b.width * dpr), dh = Math.round(b.height * dpr);
    n = Math.max(1, Math.round(Math.min(dw, dh) / 620));
    const nw = Math.floor(dw / n), nh = Math.floor(dh / n);
    Object.assign(layer.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
    Object.assign(cv, { width: nw, height: nh }); Object.assign(cv.style, { width: `${nw * n / dpr}px`, height: `${nh * n / dpr}px` });
    if (nw === W && nh === H && C) return;
    const old = C; W = nw; H = nh; C = layoutCourse(W, H, level, seed);
    if (!old) return;
    // re-laid mid-race: everyone keeps their progress and drops onto the new course (a flip tumbles them)
    const flipped = old.vertical !== C.vertical;
    for (const r of racers) {
      const q = r.maxU / old.total, at = placeAt(C, q * C.total);
      Object.assign(r, { x: at.x, y: at.y - (flipped ? 44 : 4), vx: flipped ? (Math.random() - 0.5) * 80 : 0, vy: flipped ? -60 : 0, maxU: q * C.total, tumble: flipped ? 0.7 : 0, dead: 0, took: -1 });
    }
  };
  fit(); addEventListener('resize', fit);
  // the docks re-flow a moment after a rotate / resize: follow the canvas area itself as it settles
  const stageEl = document.getElementById('pxStage')?.offsetParent ? document.getElementById('pxStage') : document.getElementById('stage');
  const ro = stageEl ? new ResizeObserver(() => fit()) : null; ro?.observe(stageEl);

  const DRAW_T = 2.8, COUNT_T = 3;
  let phase = 'draw', t = 0, raf = 0, last = performance.now(), acc = 0, over = false, finished = [], resultsAt = 0, raceT = 0;
  const startLine = () => racers.forEach((r, i) => Object.assign(r, { x: C.start.x + i * 5, y: C.start.y - 2, vx: 0, vy: 0, maxU: 0, pose: 'wait' }));
  const boostMe = () => { if (phase === 'race' && me.st > 6 && !me.done) { me.boost = 0.6; me.st -= 7; } };
  cheer.onclick = boostMe;
  layer.addEventListener('pointerdown', e => { if (!e.target.closest('button')) boostMe(); });
  const key = e => { if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); boostMe(); } if (e.key === 'Escape') end(true); };
  addEventListener('keydown', key, true);
  close.onclick = () => end(true);

  const standing = () => racers.slice().sort((a, b) => (a.done && b.done ? a.done - b.done : a.done ? -1 : b.done ? 1 : b.maxU - a.maxU));
  const ordinal = i => `${i}${['th', 'st', 'nd', 'rd'][i % 10 < 4 && Math.floor(i / 10) !== 1 ? i % 10 : 0]}`;
  let boardAt = 0;
  const syncBoard = () => board.replaceChildren(...standing().map((r, i) => h('li', { className: r.me ? 'me' : '' }, h('i', { style: { background: r.me ? 'var(--accent)' : r.colour } }), `${ordinal(i + 1)} ${r.name}`)));

  const frame = now => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (phase === 'draw' && t > DRAW_T) { phase = 'count'; t = 0; startLine(); }
    else if (phase === 'count' && t > COUNT_T) { phase = 'race'; t = 0; }
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      const racing = phase === 'race';
      if (racing) raceT += DT;
      for (const r of racers) {
        if (phase === 'draw') continue;
        if (racing && !r.me && !r.done && r.st > r.max * 0.45 && Math.random() < DT * 0.5) { r.boost = 0.6; r.st -= 7; }   // rivals cheer themselves on
        stepRacer(r, C, DT, racing && raceT > r.lag);
        if (racing && !r.done && C.finish && r.maxU >= C.finish.u) { finished.push(r); r.done = finished.length; r.pose = 'done'; }
      }
    }
    if (phase === 'race' && !resultsAt && (finished.length === racers.length || me.done && finished.length >= 3 || raceT > TIME_LIMIT)) resultsAt = now;
    if (resultsAt && now - resultsAt > 2600) return end(false);
    if (now - boardAt > 250) { boardAt = now; syncBoard(); }
    draw(now);
  };

  const draw = now => {
    ctx.clearRect(0, 0, W, H);
    const wave = Math.floor(now / 160) % 4;
    for (const w of C.water) {
      ctx.fillStyle = 'rgba(70,140,255,.45)'; ctx.fillRect(Math.round(w.x0), Math.round(w.y0), Math.round(w.x1 - w.x0), Math.round(w.y1 - w.y0));
      ctx.fillStyle = 'rgba(225,242,255,.95)';
      for (let x = Math.round(w.x0); x < w.x1; x += 4) ctx.fillRect(x, Math.round(w.y0) + ((x / 4 + wave) % 4 < 2 ? 0 : 1), 2, 1);
    }
    const reveal = phase === 'draw' ? C.inkLen * Math.min(1, t / (DRAW_T - 0.3)) : Infinity, tip = drawInk(ctx, C, reveal);
    flag(ctx, C.start.x - 10, C.start.y, false);
    if (C.finish && (phase !== 'draw' || reveal >= C.inkLen)) flag(ctx, C.finish.x, C.finish.y, true);
    if (phase === 'draw') {   // Pyxl draws the course: she's at the pen tip
      if (tip) drawPose(ctx, 'brush', tip[0] - 14, tip[1] + 2, 1);
      return;
    }
    const frameNo = Math.floor(now / 140);
    for (const r of [...racers.filter(x => !x.me), me]) {
      if (r.dead > 0 && Math.floor(now / 90) % 2) continue;   // blinking while respawning
      const pose = r.trip > 0 ? 'trip' : r.tumble > 0 ? 'air' : r.done ? 'done' : phase === 'count' ? 'wait' : r.pose, list = POSE[pose] ?? POSE.wait;
      const name = list[frameNo % list.length], flip = rowOf(C, r.y).dir < 0;
      drawPose(ctx, name, r.x, r.y + (name === 'floor' ? 4 : 0), 1, flip, 0, r.me ? undefined : tinted(r.colour));
      if (r.me) { ctx.fillStyle = '#ffd23f'; const ty = Math.round(r.y - 60); ctx.fillRect(Math.round(r.x) - 2, ty, 5, 1); ctx.fillRect(Math.round(r.x) - 1, ty + 1, 3, 1); ctx.fillRect(Math.round(r.x), ty + 2, 1, 1); }   // a little "you" marker
      if (phase === 'race' && !r.done) { const bw = 14, fill = Math.round(bw * clamp(r.st / r.max, 0, 1)); ctx.fillStyle = 'rgba(34,24,34,.7)'; ctx.fillRect(Math.round(r.x) - 7, Math.round(r.y) + 3, bw, 2); ctx.fillStyle = r.st < r.max * 0.25 ? '#e0485a' : '#2fb36b'; ctx.fillRect(Math.round(r.x) - 7, Math.round(r.y) + 3, fill, 2); }
    }
    if (phase === 'count') {
      const c = Math.ceil(COUNT_T - t);
      pixelText(ctx, c > 0 ? String(c) : 'GO!', W / 2, H * 0.3, '#ffd23f', { size: 16, align: 'center', outline: '#221822' });
    } else if (phase === 'race' && t < 0.8) pixelText(ctx, 'GO!', W / 2, H * 0.3, '#ffd23f', { size: 16, align: 'center', outline: '#221822' });
    if (resultsAt) {
      const rows = standing(), bw = 150, bh = 22 + rows.length * 12, bx = Math.round(W / 2 - bw / 2), by = Math.round(H * 0.18);
      ctx.fillStyle = 'rgba(34,24,34,.88)'; ctx.fillRect(bx, by, bw, bh);
      pixelText(ctx, 'RESULTS', W / 2, by + 5, '#ffd23f', { align: 'center' });
      rows.forEach((r, i) => pixelText(ctx, `${ordinal(i + 1)}  ${r.name}${r.done ? '' : ' DNF'}`, bx + 10, by + 18 + i * 12, r.me ? '#ffd23f' : '#ffffff'));
    }
  };

  const end = quit => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    removeEventListener('keydown', key, true); removeEventListener('resize', fit); ro?.disconnect();
    layer.remove(); delete document.body.dataset.game;   // nothing was added to the drawing: it's just as it was
    if (quit) return pyxl.raceOver(-1, level);
    const place = me.done ? me.done - 1 : finished.length;
    pyxl.raceOver(place, level, place < 3 ? prize * (3 - place) : 2);
  };
  syncBoard();
  raf = requestAnimationFrame(frame);
}
