// Drawing assistants (after Krita): rulers and vanishing points that steer strokes.
// A stroke picks the assistant whose direction best matches its first movement, then every
// point is projected onto the line through the stroke's start in that direction.
export function pickLock(assistants, start, next) {
  const mx = next.x - start.x, my = next.y - start.y, ml = Math.hypot(mx, my);
  if (!assistants?.length || ml < 1e-6) return null;
  let best = null, score = -1;
  for (const a of assistants) {
    let dx, dy;
    if (a.type === 'ruler') { dx = a.b.x - a.a.x; dy = a.b.y - a.a.y; }
    else { dx = start.x - a.a.x; dy = start.y - a.a.y; }
    const l = Math.hypot(dx, dy);
    if (!l) continue;
    const s = Math.abs((dx * mx + dy * my) / (l * ml));
    if (s > score) { score = s; best = { x: dx / l, y: dy / l }; }
  }
  return best && { o: { x: start.x, y: start.y }, u: best };
}

export function project(lock, p) {
  const { o, u } = lock, t = (p.x - o.x) * u.x + (p.y - o.y) * u.y;
  return { ...p, x: o.x + u.x * t, y: o.y + u.y * t };
}
