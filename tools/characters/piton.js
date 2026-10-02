// Piton — a little mountain climber, drawn in Pyxl's chibi style: a huge head (about 3/5 of his height)
// in a big fur-trimmed hood with a pompom and amber snow goggles, spiky ginger bangs and side locks
// spilling out of it, wide anime eyes low in a small face, and a tiny puffy parka, red mittens, fur-cuffed
// boots, an orange pack with a rope coil and a wooden ice mallet. Built from shapes plus a few hand-drawn
// pixels (tools/characters/rig.js) in the same 18 poses as Pyxl, so the app's states work for him
// unchanged. See docs/CHARACTERS.md.
import { OUT, ellipse, circle, capsule, rect, poly, box, and, minus, drawPose, stamp, rotate } from './rig.js';

export const NAME = 'Piton';
export const W = 84, H = 68, OX = 42, FY = 62;   // canvas per pose; origin = between the feet, on the floor

// One ramp per material: [shadow, base, light]. The parka and hood use Pyxl's teal smock ramp, so they
// recolour with the outfit colour in the app; nothing else is in the teal hue band (150–205).
export const PAL = {
  parka: ['#3d6f80', '#559aa6', '#86c5c0'],
  fur: ['#c9c2c8', '#f1ece6', '#ffffff'],
  hair: ['#7a3a1c', '#b5602a', '#e08a44'],
  skin: ['#eab8a0', '#fbe4d3', '#fbe4d3'],
  eye: '#402d3b', iris: '#8a4b2a', glint: '#ffffff', blush: '#f2a0a4', mouth: '#a8475a',
  mitten: ['#8b303b', '#dc4749', '#f47a5e'],
  pants: ['#2c2842', '#3e3a5c', '#544f7c'],
  boot: ['#55372a', '#7a5038', '#a2704c'],
  pack: ['#9c4a1e', '#d9732f', '#f2a25c'],
  rope: ['#a58226', '#dcbd55', '#f4e08e'],
  wood: ['#6b4a31', '#9a6a43', '#c49261'],
  steel: ['#6f7a8a', '#aab4c2', '#dfe5ec'],
  lens: ['#b8641c', '#f2b134', '#ffe48c'],
  strap: ['#2c2842', '#3e3a5c', '#544f7c'],
  ice: ['#8fb2ea', '#dbe8ff', '#ffffff'],
};

const X = dx => OX + dx, Y = dy => FY + dy;
const D = Math.PI / 180;
const BELOW_FLOOR = rect(0, Y(0), 999, 999);

// ---- eyes: Pyxl-style — a dark lash line on top, then iris rows with a glint (5 × 4, left eye) ----
const EYES = {
  open: ['.aaaa', 'aewee', '.eeie', '.eiii', '..ii.'],
  wide: ['.aaa.', 'a...a', '.wei.', '.eii.', '.....'],
  half: ['.....', '.....', 'aaaaa', '.eeii', '..ii.'],
  closed: ['.....', '.....', 'a....', '.aaaa', '.....'],
  happy: ['.....', '.....', '.aaa.', 'a...a', '.....'],
};
const EYE_KEY = { a: OUT, e: PAL.eye, i: PAL.iris, w: PAL.glint };
const MOUTHS = { smile: ['mm'], open: ['aa', 'mm'], o: ['aa', 'aa'], none: [] };
const MOUTH_KEY = { a: OUT, m: PAL.mouth };
function face(fx, fy, eyes, mouth, side) {
  const e = EYES[eyes] ?? EYES.open, m = MOUTHS[mouth] ?? MOUTHS.smile, p = [];
  if (side) {   // profile: one eye near the front of the face
    p.push(...stamp(fx - 1, fy - 3, e, EYE_KEY, true));
    p.push(...stamp(fx + 3, fy + 2, ['bb'], { b: PAL.blush }));
    p.push(...stamp(fx + 4, fy + 3, m.map(r => r.slice(0, 1)), MOUTH_KEY));
  } else {
    p.push(...stamp(fx - 7, fy - 3, e, EYE_KEY), ...stamp(fx + 2, fy - 3, e, EYE_KEY, true));
    p.push(...stamp(fx - 7, fy + 2, ['bb'], { b: PAL.blush }), ...stamp(fx + 5, fy + 2, ['bb'], { b: PAL.blush }));
    p.push(...stamp(fx - 1, fy + 3, m, MOUTH_KEY));
  }
  return p;
}

// ---- hair: spiky bangs across the top of the face opening, side locks down its edges ----
// zigzag bang tips; strands every few columns in the darker tone, a light band near the top
const tri = x => Math.abs(((x % 5) + 5) % 5 - 2);      // 2 1 0 1 2 …
function hairPart(open, fx, fy, side) {
  const bangs = (x, y) => {
    const dx = x + 0.5 - fx;
    if (side) return y < fy - 4 + tri(x) * 1.2 - (dx > 3 ? 1 : 0) || dx < -3.5 && y < fy + 3;   // a lock at the back of the cheek
    return y < fy - 5 + tri(x + 1) * 1.1 || Math.abs(dx) > 7.8 && y < fy + 4;
  };
  return {
    shape: and(open, bangs), mat: PAL.hair, shade: 'edge', outline: false,
    paint: (x, y, k) => (k === 0 ? PAL.hair[0] : ((x * 7 + Math.floor(y / 3)) % 5 === 0 && y > fy - 9) ? PAL.hair[0] : y <= fy - 8 && x < fx + 2 ? PAL.hair[2] : null),
  };
}

// ---- the mallet: a wooden handle from the hand, a wooden head with a steel band ----
function mallet(hx, hy, angle) {
  const a = angle * D, L = 11, ex = hx + Math.cos(a) * L, ey = hy + Math.sin(a) * L;
  return [
    { shape: capsule(hx, hy, ex, ey, 0.9), mat: PAL.wood, shade: 'edge' },
    { shape: box(ex, ey, 7, 4, a + Math.PI / 2), mat: PAL.wood, shade: 'edge' },
    { shape: and(box(ex, ey, 7, 4, a + Math.PI / 2), box(ex, ey, 1.4, 4, a)), mat: PAL.steel, shade: 'flat', outline: false },
  ];
}

// ---- one pose from a few settings ----
// view: front | side (facing right) | back. hands: [x, y] mitten positions (from the origin). legs: stand |
// stepA | stepB | sit. eyes / mouth: see face(). tool: { hand: 'front' | 'back' | 'left' | 'right', angle }.
function pose(o) {
  const v = o.view ?? 'front', by = o.bob ?? 0, sit = o.legs === 'sit', sy = sit ? 6 : 0;
  const parts = [];
  const limb = (x1, y1, x2, y2, r, mat) => ({ shape: capsule(X(x1), Y(y1), X(x2), Y(y2), r), mat, shade: 'edge' });
  const hand = ([x, y]) => ({ shape: circle(X(x), Y(y), 2.1), mat: PAL.mitten, shade: 'round' });
  const toolParts = (h, ang) => mallet(X(h[0]), Y(h[1]), ang);

  // legs: short trousers, boots with a fur cuff
  const legs = [];
  const boot = (fx, lift, mat = PAL.boot, fwd = 0) => [
    { shape: minus(ellipse(X(fx + fwd), Y(-2 + lift), 3.2 + Math.abs(fwd) * 0.4, 2.6), BELOW_FLOOR), mat, shade: 'round' },
    { shape: ellipse(X(fx), Y(-4.6 + lift), 2.9, 1.3), mat: PAL.fur, shade: 'edge' },
  ];
  if (sit) {
    for (const s of [-1, 1]) legs.push(limb(s * 3, -6, s * 5, -2.5, 2, PAL.pants), ...boot(s * 5.5, 0.6));
  } else if (v === 'side') {
    const step = { stand: [[-1.5, 0], [1.5, 0]], stepA: [[-4, -1], [3.5, 0]], stepB: [[3.5, 0], [-4, -1]] }[o.legs ?? 'stand'];
    step.forEach(([fx, lift], i) => {   // the far leg first, a shade darker
      const dark = i === 0, pants = dark ? [PAL.pants[0], PAL.pants[0], PAL.pants[1]] : PAL.pants, bt = dark ? [PAL.boot[0], PAL.boot[0], PAL.boot[1]] : PAL.boot;
      legs.push(limb(fx * 0.4, -10, fx, -5 + lift, 2, pants), ...boot(fx, lift, bt, 1));
    });
  } else {
    for (const s of [-1, 1]) legs.push(limb(s * 2.8, -10, s * 3, -5, 2, PAL.pants), ...boot(s * 3.2, 0));
  }

  // body: a small puffy parka, wider at the fur hem
  const bTop = -23 + by + sy, bBot = -10 + by + sy;
  const body = v === 'side'
    ? poly([[X(-5), Y(bTop)], [X(5), Y(bTop)], [X(7), Y(bBot)], [X(-7), Y(bBot)]])
    : poly([[X(-6), Y(bTop)], [X(6), Y(bTop)], [X(9), Y(bBot)], [X(-9), Y(bBot)]]);
  const hem = ellipse(X(0), Y(bBot - 1), v === 'side' ? 7.6 : 9.6, 1.6);
  const packS = v === 'back' ? ellipse(X(0), Y(bTop + 6), 6, 6.5) : ellipse(X(-7), Y(bTop + 6), 3.6, 6);
  const rope = v === 'back' ? minus(ellipse(X(0), Y(bTop + 1), 4.2, 2.2), ellipse(X(0), Y(bTop + 1), 2, 0.9)) : minus(ellipse(X(-7.5), Y(bTop + 1), 2.8, 2), ellipse(X(-7.5), Y(bTop + 1), 1.1, 0.7));

  const sh = v === 'side' ? [[-1.5, bTop + 3], [1.5, bTop + 3]] : [[-5.5, bTop + 3], [5.5, bTop + 3]];
  const backHand = o.hands?.back ?? (v === 'side' ? [-3, bTop + 11] : [-8, bTop + 11]);
  const frontHand = o.hands?.front ?? (v === 'side' ? [3, bTop + 11] : [8, bTop + 11]);
  const tool = o.tool;

  if (v === 'side') {   // facing right: pack and far arm behind
    parts.push({ shape: packS, mat: PAL.pack, shade: 'round' }, { shape: rope, mat: PAL.rope, shade: 'edge' });
    if (tool?.hand === 'back') parts.push(...toolParts(backHand, tool.angle));
    parts.push(limb(sh[0][0], sh[0][1], backHand[0], backHand[1], 1.9, [PAL.parka[0], PAL.parka[0], PAL.parka[1]]), hand(backHand));
  }
  parts.push(...legs);
  parts.push({ shape: body, mat: PAL.parka, shade: 'round' }, { shape: hem, mat: PAL.fur, shade: 'edge' });
  if (v === 'front') for (const s of [-1, 1]) parts.push({ shape: and(body, capsule(X(s * 3.6), Y(bTop), X(s * 4.4), Y(bBot - 3), 0.7)), mat: PAL.pack, shade: 'flat', outline: false });
  if (v === 'back') parts.push({ shape: packS, mat: PAL.pack, shade: 'round' }, { shape: rope, mat: PAL.rope, shade: 'edge' });
  if (v !== 'side') {
    if (tool?.hand === 'left') parts.push(...toolParts(backHand, tool.angle));
    parts.push(limb(sh[0][0], sh[0][1], backHand[0], backHand[1], 2, PAL.parka), hand(backHand));
  }

  // the head: a big hood (Pyxl's beret-sized), pompom, goggles, the fur ring, hair and face inside it
  const hx = X((o.headDx ?? 0) + (v === 'side' ? 0.5 : 0)), hy = Y(-38 + by + sy + (o.headDy ?? 0));
  const hood = ellipse(hx, hy, 15.6, 13.6);
  parts.push({ shape: hood, mat: PAL.parka, shade: 'round', light: [hx - 3, hy - 3, 15, 13] });
  parts.push({ shape: circle(hx + (v === 'side' ? -3 : 0), hy - 13.6, 2.5), mat: PAL.fur, shade: 'round' });
  const gY = hy - 7.5;
  if (v === 'back') {
    parts.push({ shape: and(hood, rect(0, Math.round(gY + 1), 999, Math.round(gY + 3))), mat: PAL.strap, shade: 'flat', outline: false });
    parts.push({ shape: and(hood, rect(0, Math.round(hy + 9), 999, 999)), mat: PAL.fur, shade: 'edge', outline: false });   // fur rim peeking under the hood
  } else {
    const fx = v === 'side' ? hx + 5 : hx, fy = hy + 5;
    const furS = v === 'side' ? ellipse(fx + 1, fy - 1, 8, 10.5) : ellipse(fx, fy - 1, 12.6, 10.6);
    const open = v === 'side' ? ellipse(fx + 2, fy, 6.6, 8.6) : ellipse(fx, fy, 10, 8.6);
    const grow = ellipse(hx, hy, 16.6, 14.6);
    parts.push({ shape: and(furS, grow), mat: PAL.fur, shade: 'round', light: [fx - 4, fy - 6, 12, 10] });
    parts.push({ shape: and(open, grow), mat: PAL.skin, shade: 'edge', outline: false, pixels: face(Math.round(fx + (v === 'side' ? 2 : 0)), Math.round(fy), o.eyes ?? 'open', o.mouth ?? 'smile', v === 'side') });
    parts.push(hairPart(and(open, grow), fx + (v === 'side' ? 2 : 0), fy, v === 'side'));
    // goggles on the hood above the fur
    parts.push({ shape: and(hood, rect(0, Math.round(gY - 1), 999, Math.round(gY + 1))), mat: PAL.strap, shade: 'flat', outline: false });
    for (const lx of v === 'side' ? [hx + 6] : [hx - 4.5, hx + 4.5]) parts.push({ shape: v === 'side' ? ellipse(lx, gY, 2, 2.6) : circle(lx, gY, 2.7), mat: PAL.lens, shade: 'round' });
  }

  // near arm (and the tool in it) in front of the body
  if (v === 'side') {
    parts.push(limb(sh[1][0], sh[1][1], frontHand[0], frontHand[1], 1.9, PAL.parka), hand(frontHand));
    if (tool?.hand === 'front') parts.push(...toolParts(frontHand, tool.angle));
  } else {
    parts.push(limb(sh[1][0], sh[1][1], frontHand[0], frontHand[1], 2, PAL.parka), hand(frontHand));
    if (tool?.hand === 'right') parts.push(...toolParts(frontHand, tool.angle));
  }
  for (const e of o.extras ?? []) parts.push(e);
  return drawPose(W, H, parts);
}

// a sweat drop / ice chips flying
const sweat = (x, y) => ({ shape: ellipse(X(x), Y(y), 1.5, 2), mat: PAL.ice, shade: 'round' });
const chips = (x, y) => [[0, 0], [3, -3], [5, 1], [2, 4]].map(([dx, dy]) => ({ shape: rect(X(x + dx), Y(y + dy), X(x + dx + 2), Y(y + dy + 2)), mat: PAL.ice, shade: 'flat' }));

// sleeping: the standing pose with closed eyes, laid down on his back (head to the left)
function sleeping() {
  const p = rotate(pose({ view: 'front', eyes: 'closed', mouth: 'smile', hands: { back: [-6, -12], front: [6, -12] } }), -1);
  let low = 0, left = W;   // drop him onto the floor, head at the left
  for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) if (p.px[y * p.W + x]) { low = Math.max(low, y); left = Math.min(left, x); }
  const px = new Array(W * H).fill(null), dy = FY - 1 - low, dx = X(-26) - left;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = p.px[y * W + x]; if (c && y + dy < H && x + dx >= 0 && x + dx < W) px[(y + dy) * W + x + dx] = c; }
  return { ...p, px };
}

// ---- the 18 poses (same names as Pyxl's, so every state in the app finds one) ----
const mirror = p => { const px = p.px.slice(); for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) px[y * p.W + x] = p.px[y * p.W + (p.W - 1 - x)]; return { ...p, px }; };
export function poses() {
  return [
    ['front', pose({ view: 'front' })],
    ['frontBlink', pose({ view: 'front', eyes: 'closed' })],
    ['side', mirror(pose({ view: 'side' }))],                                          // Pyxl's 'side' faces left
    ['back', pose({ view: 'back' })],
    ['idle0', pose({ view: 'side' })],
    ['idle1', pose({ view: 'side', legs: 'stepA', bob: -1, hands: { back: [-1, -13], front: [1, -13] } })],
    ['walk', pose({ view: 'side', legs: 'stepB', bob: -1, hands: { back: [-5, -13], front: [5, -13] } })],
    ['brush', pose({ view: 'side', hands: { front: [8, -16] }, tool: { hand: 'front', angle: -40 } })],
    ['paint', pose({ view: 'side', hands: { front: [8, -13] }, tool: { hand: 'front', angle: 20 }, eyes: 'happy', extras: chips(19, -8) })],
    ['raise', pose({ view: 'front', hands: { front: [10, -27] }, tool: { hand: 'right', angle: -88 }, mouth: 'open' })],
    ['point', pose({ view: 'side', hands: { front: [10, -18] } })],
    ['floor', pose({ view: 'front', legs: 'sit', hands: { back: [-9, -6], front: [9, -6] }, eyes: 'half' })],
    ['cheer', pose({ view: 'front', hands: { back: [-10, -26], front: [10, -26] }, tool: { hand: 'right', angle: -100 }, eyes: 'happy', mouth: 'open', bob: -1 })],
    ['spray', pose({ view: 'side', hands: { front: [9, -16] }, tool: { hand: 'front', angle: -4 }, extras: chips(22, -20) })],
    ['happy', pose({ view: 'front', hands: { back: [-11, -19], front: [11, -19] }, eyes: 'happy', mouth: 'open', bob: -1 })],
    ['oops', pose({ view: 'front', hands: { back: [-12, -15], front: [12, -15] }, eyes: 'wide', mouth: 'o', extras: [sweat(-14, -44)] })],
    ['drowsy', pose({ view: 'front', headDy: 1, eyes: 'half', mouth: 'none' })],
    ['sleep', sleeping()],
  ];
}
// the anchor of each pose: the centre of his hood (where Pyxl's beret centre is)
const SIDE = ['idle0', 'idle1', 'walk', 'brush', 'paint', 'point', 'spray'];
export const anchorOf = name => (name === 'sleep' ? [X(-26) + 14] : name === 'side' ? [W - 1 - X(0.5)] : SIDE.includes(name) ? [X(0.5)] : [X(0)]);
