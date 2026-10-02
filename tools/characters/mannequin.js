// The mannequin: Pyxl's body as plain parts — head, face window, torso, arms, hands, legs, feet — posed like
// her in all 18 poses, with her chibi proportions measured from her sheet. A character is a *costume*:
// it fills slots (hair, hat, torso, sleeves, hands, legs, feet, things behind, a held tool, effects)
// and the mannequin poses it. Every character built this way moves and reads like Pyxl. See
// docs/CHARACTERS.md.
import { OUT, ellipse, circle, capsule, rect, poly, and, minus, drawPose, stamp, rotate } from './rig.js';

export const W = 96, H = 72, OX = 48, FY = 66;   // canvas per pose; origin = between the feet, on the floor
const X = dx => OX + dx, Y = dy => FY + dy;
const D = Math.PI / 180;

// ---- Pyxl's proportions (px, from the floor between her feet; up is negative) ----
export const BODY = {
  head: { y: -33, rx: 14, ry: 12.5 },        // the skull / hair volume: about 3/5 of her height, as wide as the sprite
  face: { dy: 6, rx: 8.5, ry: 6.5, sideDx: 5, sideRx: 6 },   // the skin window, low in the head
  torso: { top: -21, bot: -9, topW: 12, botW: 18, sideTopW: 10, sideBotW: 14 },
  arm: 1.9, hand: 2.1, leg: 2, hip: 3,
};

// ---- the 18 poses as skeletons (Pyxl's names). Hands / feet are [x, y] from the origin. ----
// view: front | side (facing right) | back. legs: stand | sit | sitSide. tool: which hand holds the prop,
// at what angle (degrees, 0 = pointing right, -90 = up). fx: effects drawn with the pose.
export const SKELETONS = {
  front: { view: 'front' },
  frontBlink: { view: 'front', eyes: 'closed' },
  side: { view: 'side', mirror: true },                                   // Pyxl's 'side' faces left
  back: { view: 'back' },
  idle0: { view: 'side', feet: [[-4, 0], [4, 0]], hands: [[-4, -11], [5, -11]] },
  idle1: { view: 'side', bob: -1, feet: [[-5, -1], [5, 0]], hands: [[-5, -12], [6, -12]] },
  walk: { view: 'side', bob: -1, feet: [[4, 0], [-4, -1]], hands: [[-6, -12], [7, -13]] },
  brush: { view: 'side', feet: [[-6, 0], [5, 0]], hands: [[-5, -11], [16, -21]], tool: { hand: 1, angle: -50 } },
  paint: { view: 'side', headDx: -1, feet: [[-9, 0], [-1, 0]], hands: [[-7, -12], [19, -20]], tool: { hand: 1, angle: -8 }, eyes: 'happy', fx: [['splat', 34, -22]] },
  raise: { view: 'side', feet: [[-4, 0], [6, 0]], hands: [[-8, -13], [21, -36]], tool: { hand: 1, angle: -70 }, mouth: 'open' },
  point: { view: 'side', feet: [[-4, 0], [4, 0]], hands: [[-5, -11], [18, -19]], tool: { hand: 1, angle: -25 } },
  floor: { view: 'front', legs: 'sit', hands: [[-9, -6], [9, -6]], eyes: 'half', fx: [['splat', 16, -2]] },
  cheer: { view: 'side', bob: -4, feet: [[-3, -1], [4, -2]], hands: [[-8, -16], [20, -34]], tool: { hand: 1, angle: -65 }, eyes: 'happy', mouth: 'open' },
  spray: { view: 'side', feet: [[-6, 0], [4, 0]], hands: [[-5, -11], [12, -19]], tool: { hand: 1, angle: -12 }, fx: [['spray', 28, -24]] },
  happy: { view: 'front', bob: -1, hands: [[-10, -16], [10, -16]], eyes: 'happy', mouth: 'open', fx: [['note', 24, -46]] },
  oops: { view: 'front', hands: [[-6, -14], [6, -14]], eyes: 'wide', mouth: 'o', fx: [['sweat', 18, -44]] },
  drowsy: { view: 'side', legs: 'sitSide', headDy: 1, eyes: 'closed', mouth: 'none', hands: [[-3, -6], [4, -6]], fx: [['doze', 22, -30]] },
  sleep: { view: 'front', lie: true, eyes: 'closed', hands: [[-6, -12], [6, -12]] },
};
export const POSES = Object.keys(SKELETONS);

// ---- the face: Pyxl-style anime eyes (lash row, iris rows, glint), blush, a tiny mouth ----
export const EYES = {
  open: ['.aaaa', 'aewee', '.eeie', '.eiii', '..ii.'],
  wide: ['.aaa.', 'a...a', '.wei.', '.eii.', '.....'],
  half: ['.....', '.....', 'aaaaa', '.eeii', '..ii.'],
  closed: ['.....', '.....', 'a....', '.aaaa', '.....'],
  happy: ['.....', '.....', '.aaa.', 'a...a', '.....'],
};
const MOUTHS = { smile: ['mm'], open: ['aa', 'mm'], o: ['aa', 'aa'], none: [] };
function face(c, fx, fy, eyes, mouth, side) {
  const e = EYES[eyes] ?? EYES.open, m = MOUTHS[mouth] ?? MOUTHS.smile, p = [];
  const ek = { a: OUT, e: c.eye ?? '#402d3b', i: c.iris ?? '#6b4a5a', w: '#ffffff' }, mk = { a: OUT, m: c.mouth ?? '#a8475a' }, bk = { b: c.blush ?? '#f2a0a4' };
  if (side) {
    p.push(...stamp(fx - 1, fy - 3, e, ek, true), ...stamp(fx + 3, fy + 2, ['bb'], bk), ...stamp(fx + 4, fy + 3, m.map(r => r.slice(0, 1)), mk));
  } else {
    p.push(...stamp(fx - 7, fy - 3, e, ek), ...stamp(fx + 2, fy - 3, e, ek, true));
    p.push(...stamp(fx - 7, fy + 2, ['bb'], bk), ...stamp(fx + 5, fy + 2, ['bb'], bk), ...stamp(fx - 1, fy + 3, m, mk));
  }
  return p;
}

// ---- effects every character can use (a costume can replace any of them) ----
const FX = {
  sweat: (x, y) => [{ shape: ellipse(X(x), Y(y), 1.5, 2.1), mat: ['#8fb2ea', '#dbe8ff', '#ffffff'], shade: 'round' }],
  note: (x, y) => [{ shape: circle(X(x), Y(y + 6), 2), mat: ['#2c5bb8', '#427ede', '#8fb5ff'], shade: 'round' }, { shape: rect(X(x + 1), Y(y - 2), X(x + 2.2), Y(y + 6)), mat: '#427ede', shade: 'flat' }, { shape: rect(X(x + 1), Y(y - 2), X(x + 4), Y(y - 0.8)), mat: '#427ede', shade: 'flat' }],
  doze: (x, y) => [{ shape: minus(circle(X(x), Y(y), 3.6), circle(X(x + 0.6), Y(y - 0.4), 1.6)), mat: ['#8a8698', '#c9c2c8', '#ecebf0'], shade: 'round' }],
  splat: (x, y) => [[0, 0, 2.6], [5, -3, 2], [3, 4, 1.6]].map(([dx, dy, r]) => ({ shape: circle(X(x + dx), Y(y + dy), r), mat: ['#2c5bb8', '#427ede', '#8fb5ff'], shade: 'round' })),
  spray: (x, y) => [{ shape: ellipse(X(x), Y(y), 6, 3.6), mat: ['#2c5bb8', '#427ede', '#8fb5ff'], shade: 'round' }],
};

// ---- the plain mannequin: what you get with no costume (grey, so the forms read) ----
export const BASE = {
  name: 'Mannequin',
  skin: ['#b9b3c4', '#d8d3e0', '#ece9f1'], body: ['#8a8698', '#a9a5b8', '#c9c5d6'],
  iris: '#6b6680',
};

// ---- build one pose: skeleton + costume → a drawn pose ----
export function figure(name, cos = BASE, over = {}) {
  const sk = { ...SKELETONS[name], ...over };
  if (sk.lie) return lieDown(cos, sk);
  const v = sk.view, by = sk.bob ?? 0, B = BODY;
  const sit = sk.legs === 'sit', sitSide = sk.legs === 'sitSide', sy = sit ? 6 : sitSide ? 5 : 0;
  const skin = cos.skin ?? BASE.skin, bodyMat = cos.body ?? BASE.body;
  const tTop = B.torso.top + by + sy, tBot = B.torso.bot + by + sy;
  const hx = X((sk.headDx ?? 0) + (v === 'side' ? 0.5 : 0)), hy = Y(B.head.y + by + sy + (sk.headDy ?? 0));
  const fcx = v === 'side' ? hx + B.face.sideDx : hx, fcy = hy + B.face.dy;
  const tw = v === 'side' ? [B.torso.sideTopW, B.torso.sideBotW] : [B.torso.topW, B.torso.botW];
  const torso = poly([[X(-tw[0] / 2), Y(tTop)], [X(tw[0] / 2), Y(tTop)], [X(tw[1] / 2), Y(tBot)], [X(-tw[1] / 2), Y(tBot)]]);
  const shoulders = v === 'side' ? [[-1.5, tTop + 3], [3, tTop + 3]] : [[-tw[0] / 2 + 0.5, tTop + 3], [tw[0] / 2 - 0.5, tTop + 3]];
  const hands = sk.hands ?? (v === 'side' ? [[-3, tTop + 11], [3, tTop + 11]] : [[-8, tTop + 11], [8, tTop + 11]]);
  let feet = sk.feet ?? (v === 'side' ? [[-1.5, 0], [1.5, 0]] : [[-3.2, 0], [3.2, 0]]);
  if (sit) feet = [[-5.5, 0.6], [5.5, 0.6]];
  if (sitSide) feet = [[8, 0], [11, 0]];
  const hips = sit ? [[-3, tBot + 3], [3, tBot + 3]] : sitSide ? [[0, tBot + 2], [2, tBot + 2]] : v === 'side' ? [[feet[0][0] * 0.4, tBot], [feet[1][0] * 0.4, tBot]] : [[-2.8, tBot], [2.8, tBot]];
  const g = {   // everything a costume needs to dress this pose
    name, sk, v, X, Y, by, sy,
    head: { x: hx, y: hy, rx: B.head.rx, ry: B.head.ry, shape: ellipse(hx, hy, B.head.rx, B.head.ry) },
    face: { x: fcx, y: fcy, shape: v === 'side' ? ellipse(fcx + 2, fcy, B.face.sideRx, B.face.ry + 1) : ellipse(fcx, fcy, B.face.rx, B.face.ry) },
    torso: { top: tTop, bot: tBot, shape: torso, w: tw }, hands, feet, hips, shoulders,
  };
  const dark = m => (Array.isArray(m) ? [m[0], m[0], m[1]] : m);
  const limb = (a, b, r, mat) => ({ shape: capsule(X(a[0]), Y(a[1]), X(b[0]), Y(b[1]), r), mat, shade: 'edge' });
  const handPart = (i, far) => cos.hand ? cos.hand(g, i, far) : [{ shape: circle(X(hands[i][0]), Y(hands[i][1]), B.hand), mat: far ? dark(cos.handMat ?? skin) : cos.handMat ?? skin, shade: 'round' }];
  const arm = (i, far) => [limb(shoulders[i], hands[i], B.arm, far ? dark(cos.sleeve ?? bodyMat) : cos.sleeve ?? bodyMat), ...handPart(i, far)];
  const tool = i => (sk.tool?.hand === i && cos.tool ? cos.tool(X(hands[i][0]), Y(hands[i][1]), sk.tool.angle, g) : []);
  const leg = i => {
    const far = v === 'side' && i === 0, f = feet[i];
    return [limb(hips[i], [f[0], f[1] - 4.5], B.leg, far ? dark(cos.legs ?? bodyMat) : cos.legs ?? bodyMat),
      ...(cos.foot ? cos.foot(g, f, far) : [{ shape: minus(ellipse(X(f[0] + (v === 'side' ? 1 : 0)), Y(f[1] - 2), 3, 2.4), rect(0, Y(0), 999, 999)), mat: far ? dark(cos.feetMat ?? bodyMat) : cos.feetMat ?? bodyMat, shade: 'round' }])];
  };

  const parts = [];
  parts.push(...(cos.behind?.(g) ?? []));
  if (v === 'side') parts.push(...tool(0), ...arm(0, true));
  parts.push(...leg(0), ...leg(1));
  parts.push(...(cos.torso ? cos.torso(g) : [{ shape: torso, mat: bodyMat, shade: 'round' }]));
  if (v !== 'side') parts.push(...tool(0), ...arm(0, false));
  // a hand raised above the shoulders (side view) goes behind the head, so the arm never crosses the face
  const raised = v === 'side' && hands[1][1] < tTop - 6;
  if (raised) parts.push(...arm(1, false), ...tool(1));
  // head: the skull (hair mass / hood), then the face window, hair over it, then the hat
  parts.push(...(cos.skull ? cos.skull(g) : [{ shape: g.head.shape, mat: cos.hairMat ?? bodyMat, shade: 'round', light: [hx - 3, hy - 3, 14, 12] }]));
  if (v !== 'back') {
    parts.push(...(cos.faceFrame?.(g) ?? []));
    parts.push({ shape: and(g.face.shape, cos.faceClip?.(g) ?? (() => true)), mat: [skin[0], skin[1], skin[1]], shade: 'edge', outline: cos.faceOutline ?? true, outlineColour: cos.faceOutlineColour, pixels: face(cos, Math.round(fcx + (v === 'side' ? 2 : 0)), Math.round(fcy), sk.eyes ?? 'open', sk.mouth ?? 'smile', v === 'side') });
  }
  parts.push(...(cos.hair?.(g) ?? []), ...(cos.hat?.(g) ?? []));
  if (!raised) parts.push(...arm(1, false), ...tool(1));
  for (const [kind, x, y] of sk.fx ?? []) parts.push(...((cos.fx?.[kind] ?? FX[kind])?.(x, y, g) ?? []));
  parts.push(...(cos.front?.(g) ?? []));
  return drawPose(W, H, parts);
}

// lying down: the standing front pose turned a quarter turn (head to the left) and set on the floor
function lieDown(cos, sk) {
  const p = rotate(figure('front', cos, { ...sk, lie: false }), -1);
  let low = 0, left = W;
  for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) if (p.px[y * p.W + x]) { low = Math.max(low, y); left = Math.min(left, x); }
  const px = new Array(W * H).fill(null), dy = FY - 1 - low, dx = X(-28) - left;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = p.px[y * W + x]; if (c && y + dy >= 0 && y + dy < H && x + dx >= 0 && x + dx < W) px[(y + dy) * W + x + dx] = c; }
  return { ...p, px };
}

const mirror = p => { const px = p.px.slice(); for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) px[y * p.W + x] = p.px[y * p.W + (p.W - 1 - x)]; return { ...p, px }; };

// All 18 poses for a costume, ready for pack().
export function poses(cos = BASE) {
  return POSES.map(n => [n, SKELETONS[n].mirror ? mirror(figure(n, cos)) : figure(n, cos)]);
}
// Anchor of each pose: the head centre (where Pyxl's beret centre is).
export function anchorOf(name) {
  const sk = SKELETONS[name];
  if (sk.lie) return [X(-28) + 15];
  const x = X((sk.headDx ?? 0) + (sk.view === 'side' ? 0.5 : 0));
  return [sk.mirror ? W - 1 - x : x];
}
export { X, Y, D };
