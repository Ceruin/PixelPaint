// The world Pyxl and her toys live in: the window's edges, a floor (the top of the bottom bars)
// and the tops of panels as ledges to land on. Bodies are circles: { x, y, vx, vy, r } in CSS px.
const G = 2200;
let cache = null, cachedAt = 0;

function world() {
  const now = performance.now();
  if (cache && now - cachedAt < 250) return cache;   // panels move rarely; measure a few times a second at most
  const vv = window.visualViewport, L = vv?.offsetLeft ?? 0, T = vv?.offsetTop ?? 0, R = L + (vv?.width ?? innerWidth), B = T + (vv?.height ?? innerHeight);
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 4 && el.offsetParent ? r : null; };
  const floor = Math.min(B, ...[...document.querySelectorAll('#timeline, .statusbar')].map(vis).filter(Boolean).map(r => r.top));
  const ledges = [...document.querySelectorAll('.panel, .pyxl-card')].map(vis).filter(r => r && r.top > T + 40 && r.top < floor - 20).map(r => ({ l: r.left, r: r.right, y: r.top }));
  cachedAt = now;
  return (cache = { L, T, R, B: floor, ledges });
}
export const floorY = () => world().B;

// One step. `hit(speed, side)` fires on each real bounce. Returns true once the body rests on something.
export function stepBody(b, dt, hit = () => {}, { bounce = 0.5, spin = false } = {}) {
  const w = world(), py = b.y;
  b.vy += G * dt; b.x += b.vx * dt; b.y += b.vy * dt;
  if (spin) b.th += b.om * dt;
  if (b.x - b.r < w.L || b.x + b.r > w.R) {
    hit(Math.abs(b.vx), 'wall');
    b.x = b.x - b.r < w.L ? w.L + b.r : w.R - b.r; b.vx = -b.vx * (bounce + 0.05);
    if (spin) b.om = -b.om * 0.6 + b.vy / 600;
  }
  if (b.y - b.r < w.T) { hit(Math.abs(b.vy), 'ceiling'); b.y = w.T + b.r; b.vy = Math.abs(b.vy) * bounce; }
  // one-way ledges: only caught when falling onto them from above
  const ledge = b.vy > 0 && w.ledges.find(p => py + b.r <= p.y + 1 && b.y + b.r >= p.y && b.x > p.l && b.x < p.r);
  const ground = ledge ? ledge.y : b.y + b.r >= w.B ? w.B : null;
  if (ground == null) return false;
  b.y = ground - b.r;
  if (b.vy > 260) { hit(b.vy, 'floor'); b.vy = -b.vy * bounce; b.vx *= 0.8; if (spin) b.om = b.om * 0.5 + b.vx / 300; return false; }
  b.vy = 0; b.vx *= Math.max(0, 1 - 7 * dt);                // rolling to a stop
  if (spin) b.om = b.vx / (b.r * 1.2);
  b.ground = ground;
  return Math.abs(b.vx) < 40;
}

// Pointer velocity (px/s) over the last ~100 ms of a drag trail [{x, y, t}].
export function flick(trail, t) {
  const tr = trail.filter(p => t - p.t < 100), a = tr[0], b = tr.at(-1), dt = a && (b.t - a.t) / 1000;
  return dt > 0.012 ? [(b.x - a.x) / dt, (b.y - a.y) / dt] : [0, 0];
}
