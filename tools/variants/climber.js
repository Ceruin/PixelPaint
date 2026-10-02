// "Peak", a mountain-climber variant of Pyxl: a puffy hooded parka with a fur-trimmed face opening
// and a fur pompom, red mittens and boots, and an ice mallet in place of her brush.
// Made from Pyxl's sheet by rules, pose by pose (docs/PYXL.md §8).
//
// The hood and the parka use the teal smock ramp, so the whole parka recolours with the outfit
// colour just like Pyxl's smock. Fur, mallet and ice stay outside the teal band on purpose.
export const NAME = 'Peak';

const OUT = '#221822';
const BERET = ['#8b303b', '#dc4749', '#f47a5e'];   // shadow, base, light
const HAIR = ['#402d3b', '#5c3f4c', '#7d5566'];
const SKIN = ['#a86655', '#eab8a0', '#fbe4d3'];
const TEAL = ['#3d6f80', '#559aa6', '#86c5c0'];
const YELLOW = ['#c98f2e', '#f0c840', '#d6ad6e'];
const BLUE = ['#2a4fb8', '#427ede'];
const FUR = ['#b7c1d0', '#e8edf4', '#ffffff'];      // cool shadow, base, highlight (never recoloured)
const STEEL = ['#6f7a8a', '#aab4c2', '#dfe5ec'];
const WOOD = ['#6b4a31', '#9a6a43', '#c49261'];
const ICE = ['#8fb2ea', '#dbe8ff'];

const has = (list, c) => list.includes(c);
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

// A tiny mask type over a pose's box.
const mask = (w, h) => ({ w, h, a: new Uint8Array(w * h),
  has(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && !!this.a[y * this.w + x]; },
  add(x, y) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.a[y * this.w + x] = 1; },
  each(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.a[y * this.w + x]) fn(x, y); },
  count() { let n = 0; this.a.forEach(v => (n += v)); return n; } });
const grow = (m, within) => { const o = mask(m.w, m.h); m.each((x, y) => { o.add(x, y); N8.forEach(([dx, dy]) => (!within || within(x + dx, y + dy)) && o.add(x + dx, y + dy)); }); return o; };
const shrink = m => { const o = mask(m.w, m.h); m.each((x, y) => { if (N8.every(([dx, dy]) => m.has(x + dx, y + dy))) o.add(x, y); }); return o; };

// Poses whose loose paint is a decoration (music note, doze swirl, Z's, oops drops), not a brush.
const DECOR = new Set(['happy', 'oops', 'drowsy', 'sleep']);

export function climber(p) {
  const opaque = (x, y) => !!p.get(x, y);
  // decorations floating beside her (not touching her body) are put back exactly as drawn at the end
  const before = []; p.each((x, y, c) => before.push(c));
  const islands = [], done = mask(p.w, p.h);
  if (DECOR.has(p.name)) p.each((sx, sy, c) => {
    if (!c || done.has(sx, sy)) return;
    const isl = [], stack = [[sx, sy]]; done.add(sx, sy);
    while (stack.length) { const [x, y] = stack.pop(); isl.push([x, y]); N8.forEach(([dx, dy]) => { if (opaque(x + dx, y + dy) && !done.has(x + dx, y + dy)) { done.add(x + dx, y + dy); stack.push([x + dx, y + dy]); } }); }
    islands.push(isl);
  });
  const body = islands.reduce((a, b) => (b.length > (a?.length ?? 0) ? b : a), null);
  const restore = () => islands.filter(i => i !== body).forEach(i => i.forEach(([x, y]) => p.set(x, y, before[y * p.w + x])));
  // ---- 1. paint clusters (reds and blues). The biggest red one is the beret (with its splats);
  //         the others are the brush's painted tip or a splash on the ground ----
  const isPaint = (x, y) => { const c = p.get(x, y); return has(BERET, c) || has(BLUE, c); }, seen = mask(p.w, p.h), blobs = [];
  p.each((sx, sy) => {
    if (!isPaint(sx, sy) || seen.has(sx, sy)) return;
    const blob = [], stack = [[sx, sy]]; seen.add(sx, sy);
    while (stack.length) { const [x, y] = stack.pop(); blob.push([x, y]); N8.forEach(([dx, dy]) => { if (isPaint(x + dx, y + dy) && !seen.has(x + dx, y + dy)) { seen.add(x + dx, y + dy); stack.push([x + dx, y + dy]); } }); }
    blobs.push(blob);
  });
  const reds = b => b.filter(([x, y]) => has(BERET, p.get(x, y))).length;
  const beret = blobs.reduce((a, b) => (reds(b) > reds(a ?? []) ? b : a), null);
  if (!beret) return;
  const others = DECOR.has(p.name) ? [] : blobs.filter(b => b !== beret);   // decorations keep their colours
  // the brush tip: its paint plus the bristles and ferrule around it (2px), never hair, parka or outline
  const tool = mask(p.w, p.h), soft = (x, y) => { const c = p.get(x, y); return c && c !== OUT && !has(TEAL, c) && !has(HAIR, c) && !has(BERET, c); };
  for (const b of others.filter(b => b.length <= 40)) { const m = mask(p.w, p.h); b.forEach(([x, y]) => m.add(x, y)); grow(grow(m, soft), soft).each((x, y) => tool.add(x, y)); }
  // ---- 2. the head: the beret's box, grown down over the face (minus the brush) ----
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  beret.forEach(([x, y]) => { if (has(BERET, p.get(x, y))) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } });
  const head = (x, y) => !tool.has(x, y) && x >= x0 - 4 && x <= x1 + 4 && y >= y0 - 1 && y <= y1 + 15;

  // ---- 2. masks: face (skin + the eyes and mouth inside it), and the hood (beret + hair + paint splats) ----
  const face = mask(p.w, p.h);
  p.each((x, y, c) => { if (head(x, y) && has(SKIN, c)) face.add(x, y); });
  // eyes/mouth: dark pixels with skin on both sides (left/right or above/below) belong to the face
  // eyes and mouth (outline or hair-dark pixels) sit between skin pixels: they belong to the face
  const R4 = [1, 2, 3, 4], between = (x, y) => R4.some(a => face.has(x - a, y)) && R4.some(a => face.has(x + a, y)) || R4.some(a => face.has(x, y - a)) && R4.some(a => face.has(x, y + a));
  for (let pass = 0; pass < 3; pass++) p.each((x, y, c) => { if (head(x, y) && (c === OUT || c === HAIR[0] || c === BLUE[0] || c === BLUE[1]) && !face.has(x, y) && between(x, y)) face.add(x, y); });
  p.each((x, y, c) => { if (head(x, y) && (c === OUT || c === HAIR[0]) && face.has(x, y + 1) && face.has(x, y + 2)) face.add(x, y); });   // eyelashes
  const raw = mask(p.w, p.h);
  const onBeret = mask(p.w, p.h); beret.forEach(([x, y]) => onBeret.add(x, y));
  p.each((x, y, c) => { if (head(x, y) && c && !face.has(x, y) && (onBeret.has(x, y) || has(HAIR, c) || (has(YELLOW, c) && N8.some(([dx, dy]) => onBeret.has(x + dx, y + dy))))) raw.add(x, y); });
  // dark strands between hair locks join the hood; the outer outline is redrawn later
  p.each((x, y, c) => { if (head(x, y) && c === OUT && !face.has(x, y) && N8.filter(([dx, dy]) => raw.has(x + dx, y + dy)).length >= 5) raw.add(x, y); });
  // round the silhouette: close small gaps, then drop 1px strands (a hood, not hair)
  let hood = shrink(grow(raw, opaque));
  hood = grow(grow(shrink(shrink(hood)), (x, y) => raw.has(x, y) || hood.has(x, y)), (x, y) => raw.has(x, y) || hood.has(x, y));
  face.each((x, y) => { hood.a[y * hood.w + x] = 0; });
  raw.each((x, y) => { if (!hood.has(x, y) && !face.has(x, y)) { if (N4.some(([dx, dy]) => !opaque(x + dx, y + dy))) p.set(x, y, OUT); else hood.add(x, y); } });
  const nub = mask(p.w, p.h);   // the beret's little top nub → pompom
  for (let y = y0; y < y0 + 3; y++) { let n = 0; for (let x = x0; x <= x1; x++) if (has(BERET, p.get(x, y))) n++; if (n && n <= 5) for (let x = x0; x <= x1; x++) if (has(BERET, p.get(x, y))) nub.add(x, y); }

  // ---- 3. the face opening's fur rim: hood pixels within 2px of the face ----
  const near1 = grow(face), near2 = grow(near1);
  const fur = mask(p.w, p.h);
  hood.each((x, y) => { if (near1.has(x, y) || (near2.has(x, y) && y < (face.count() ? faceTop(face) + 3 : 0))) fur.add(x, y); });

  // ---- 4. paint: hood shaded as one rounded form (light top-left), outlined; fur; pompom ----
  let hx0 = 1e9, hy0 = 1e9, hx1 = -1, hy1 = -1;
  hood.each((x, y) => { hx0 = Math.min(hx0, x); hy0 = Math.min(hy0, y); hx1 = Math.max(hx1, x); hy1 = Math.max(hy1, y); });
  const cx = (hx0 + hx1) / 2, cy = (hy0 + hy1) / 2, rx = Math.max(1, (hx1 - hx0) / 2), ry = Math.max(1, (hy1 - hy0) / 2);
  hood.each((x, y) => {
    if (fur.has(x, y) || nub.has(x, y)) return;
    // the outline: hood edge against nothing, or against the body below (separates hood from parka)
    const edge = N4.some(([dx, dy]) => !opaque(x + dx, y + dy) || (!hood.has(x + dx, y + dy) && !face.has(x + dx, y + dy) && !head(x + dx, y + dy)));
    const onBody = dy => !hood.has(x, y + dy) && !face.has(x, y + dy) && opaque(x, y + dy) && !head(x, y + dy);
    if (edge || onBody(1)) return p.set(x, y, OUT);
    const t = (x - cx) / rx + (y - cy) / ry;   // -2 (top-left) … 2 (bottom-right)
    const rim = N4.some(([dx, dy]) => !hood.has(x + dx, y + dy) && !fur.has(x + dx, y + dy));
    p.set(x, y, t < -0.9 ? TEAL[2] : t > 0.75 || (rim && t > 0.2) ? TEAL[0] : TEAL[1]);
  });
  let fx = 0, fy = 0; face.each((x, y) => { fx += x; fy += y; }); fx /= Math.max(1, face.count()); fy /= Math.max(1, face.count());
  fur.each((x, y) => { const t = (x - fx) + (y - fy); p.set(x, y, t > 4 ? FUR[0] : !fur.has(x, y - 1) && t < 0 ? FUR[2] : FUR[1]); });
  nub.each((x, y) => p.set(x, y, y === y0 ? FUR[2] : (x + y) % 3 ? FUR[1] : FUR[0]));

  // ---- 5. below the head: brush → ice mallet (ferrule → steel, painted tip → wood), paint → ice,
  //         hands → red mittens, shoes → red boots ----
  for (const b of others.filter(b => b.length > 40))   // a paint splash on the ground → ice and snow
    b.forEach(([x, y]) => { const c = p.get(x, y); p.set(x, y, has(BLUE, c) ? ICE[BLUE.indexOf(c)] : FUR[c === BERET[0] ? 0 : 1]); });
  // the brush tip → a wooden mallet head, lit from the top-left
  let mx = 0, my = 0, n = 0; tool.each((x, y) => { mx += x; my += y; n++; }); mx /= Math.max(1, n); my /= Math.max(1, n);
  tool.each((x, y) => { const c = p.get(x, y); if (has(YELLOW, c)) return; const t = (x - mx) + (y - my); p.set(x, y, t < -1.5 ? WOOD[2] : t > 1.5 ? WOOD[0] : WOOD[1]); });
  p.each((x, y, c) => { if (c && !head(x, y) && has(YELLOW, c)) p.set(x, y, STEEL[[1, 2, 0][YELLOW.indexOf(c)]]); });   // the ferrule → a steel band
  p.each((x, y, c) => { if (c && !head(x, y) && has(SKIN, c)) p.set(x, y, BERET[SKIN.indexOf(c)]); });
  restore();
}
function faceTop(face) { let t = 1e9; face.each((x, y) => { t = Math.min(t, y); }); return t; }
