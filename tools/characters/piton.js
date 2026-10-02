// Piton — a little mountain climber. A big round hood with a fur-ringed face opening, a pompom and
// amber snow goggles pushed up on it,
// a puffy parka with a fur hem, red mittens, brown boots, an orange pack with a coil of rope, and a
// wooden ice mallet. Drawn entirely from shapes (tools/characters/rig.js) in the same poses as Pyxl,
// so the app's states and animations work for him unchanged. See docs/CHARACTERS.md.
import { OUT, ellipse, circle, capsule, rect, box, and, minus, drawPose } from './rig.js';

export const NAME = 'Piton';
export const W = 73, H = 64, OX = 36, FY = 59;   // canvas per pose; origin = between the feet, on the floor

// One ramp per material: [shadow, base, light]. The parka uses Pyxl's teal smock ramp, so it
// recolours with the outfit colour in the app; nothing else is in the teal hue band.
export const PAL = {
  parka: ['#3d6f80', '#559aa6', '#86c5c0'],
  fur: ['#b7c1d0', '#e8edf4', '#ffffff'],
  skin: ['#e3a98f', '#f7cdb4', '#fde8da'],
  mitten: ['#8b303b', '#dc4749', '#f47a5e'],
  pants: ['#2c2842', '#3e3a5c', '#544f7c'],
  boot: ['#55372a', '#7a5038', '#a2704c'],
  pack: ['#9c4a1e', '#d9732f', '#f2a25c'],
  rope: ['#a58226', '#dcbd55', '#f4e08e'],
  wood: ['#6b4a31', '#9a6a43', '#c49261'],
  steel: ['#6f7a8a', '#aab4c2', '#dfe5ec'],
  ice: ['#8fb2ea', '#dbe8ff'],
  lens: ['#b8641c', '#f2b134', '#ffe48c'],   // amber snow goggles
  strap: ['#2c2842', '#3e3a5c', '#544f7c'],
  blush: '#f2a0a4', mouth: '#8b303b', white: '#ffffff',
};

const X = dx => OX + dx, Y = dy => FY + dy;
const D = Math.PI / 180;

// ---- the face: eyes, blush, mouth as hand-placed pixels around the face centre (fx, fy) ----
function face(fx, fy, eyes, mouth, side = false) {
  const p = [], put = (x, y, c) => p.push([Math.round(x), Math.round(y), c]);
  const eyeXs = side ? [fx + 2] : [fx - 4, fx + 2];
  for (const ex of eyeXs) {
    const ey = fy - 2;
    if (eyes === 'open' || eyes === 'wide') {
      for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) put(ex + i, ey + j, OUT);
      put(ex, ey, PAL.white);                                   // a glint, top-left
      if (eyes === 'wide') { put(ex - 1, ey + 1, OUT); put(ex + 2, ey + 1, OUT); put(ex + 1, ey + 1, PAL.white); }
    } else if (eyes === 'closed') { put(ex - (side ? 0 : 0), ey + 2, OUT); put(ex + 1, ey + 2, OUT); put(ex + 2, ey + 1, side ? OUT : null); }
    else if (eyes === 'happy') { put(ex, ey + 2, OUT); put(ex + 1, ey + 1, OUT); put(ex + 2, ey + 2, OUT); }
    else if (eyes === 'half') { put(ex, ey + 1, OUT); put(ex + 1, ey + 1, OUT); put(ex, ey + 2, OUT); put(ex + 1, ey + 2, OUT); }
  }
  const bl = side ? [fx + 3] : [fx - 6, fx + 4];
  for (const bx of bl) { put(bx, fy + 2, PAL.blush); put(bx + 1, fy + 2, PAL.blush); }
  const mx = side ? fx + 4 : fx - 1, my = fy + 3;
  if (mouth === 'smile') { put(mx, my, PAL.mouth); put(mx + 1, my, PAL.mouth); }
  else if (mouth === 'open') { put(mx, my, OUT); put(mx + 1, my, OUT); put(mx, my + 1, PAL.mouth); put(mx + 1, my + 1, PAL.mouth); }
  else if (mouth === 'o') { put(mx, my, OUT); put(mx + 1, my, OUT); put(mx, my + 1, OUT); put(mx + 1, my + 1, OUT); }
  return p.filter(([, , c]) => c);
}

// ---- the mallet: a wooden handle from the hand, a wooden head with steel bands across it ----
function mallet(hx, hy, angle) {
  const a = angle * D, L = 13, ex = hx + Math.cos(a) * L, ey = hy + Math.sin(a) * L;
  return [
    { shape: capsule(hx, hy, ex, ey, 1.1), mat: PAL.wood, shade: 'edge' },
    { shape: box(ex, ey, 9, 5, a + Math.PI / 2), mat: PAL.wood, shade: 'edge' },
    { shape: and(box(ex, ey, 9, 5, a + Math.PI / 2), box(ex, ey, 1.6, 5, a + Math.PI / 2 + Math.PI / 2)), mat: PAL.steel, shade: 'flat', outline: false },
  ];
}
// where the mallet head ends up (the app hangs him from it when he's carried)
export const malletHead = (hx, hy, angle) => [hx + Math.cos(angle * D) * 13, hy + Math.sin(angle * D) * 13];

// ---- one pose from a few settings ----
// view: front | side (facing right) | back. hands: [x, y] offsets from the shoulder area; legs: stand |
// stepA | stepB | sit. eyes/mouth: see face(). tool: { hand: 'front' | 'back' | 'left' | 'right', angle }.
function pose(o) {
  const v = o.view ?? 'front', by = o.bob ?? 0, sit = o.legs === 'sit';
  const bodyY = -15 + by + (sit ? 7 : 0), headY = -32 + by + (o.headDy ?? 0) + (sit ? 7 : 0), headX = (o.headDx ?? 0) + (v === 'side' ? 1 : 0);
  const parts = [];
  const limb = (x1, y1, x2, y2, r, mat) => ({ shape: capsule(X(x1), Y(y1), X(x2), Y(y2), r), mat, shade: 'edge' });
  const hand = ([x, y]) => ({ shape: circle(X(x), Y(y), 2.6), mat: PAL.mitten, shade: 'round' });
  const toolParts = (h, ang) => mallet(X(h[0]), Y(h[1]), ang);

  // legs + boots
  const legs = [];
  if (sit) {
    legs.push(limb(-4, -6, -5, -1, 2.4, PAL.pants), limb(4, -6, 5, -1, 2.4, PAL.pants));
    legs.push({ shape: ellipse(X(-5.5), Y(-1.5), 3.4, 2.6), mat: PAL.boot, shade: 'round' }, { shape: ellipse(X(5.5), Y(-1.5), 3.4, 2.6), mat: PAL.boot, shade: 'round' });
  } else if (v === 'side') {
    // [foot x, lift] for the far leg, then the near one; the far one is a shade darker
    const step = { stand: [[-2, 0], [1.5, 0]], stepA: [[-4.5, -1], [4, 0]], stepB: [[4, 0], [-4, -1]] }[o.legs ?? 'stand'];
    step.forEach(([fx, lift], i) => {
      const dark = i === 0, pants = dark ? [PAL.pants[0], PAL.pants[0], PAL.pants[1]] : PAL.pants, boot = dark ? [PAL.boot[0], PAL.boot[0], PAL.boot[1]] : PAL.boot;
      legs.push(limb(fx * 0.4, -9, fx, -3 + lift, 2.3, pants));
      legs.push({ shape: minus(ellipse(X(fx + 1.2), Y(-1.8 + lift), 3.4, 2.4), rect(0, Y(0), 999, 999)), mat: boot, shade: 'round' });
    });
  } else {
    for (const s of [-1, 1]) {
      legs.push(limb(s * 3.5, -9, s * 3.6, -3, 2.4, PAL.pants));
      legs.push({ shape: minus(ellipse(X(s * 4), Y(-2), 3.5, 2.6), rect(0, Y(0), 999, 999)), mat: PAL.boot, shade: 'round' });
    }
  }

  // body: a puffy parka with a fur hem
  const bodyShape = v === 'side' ? ellipse(X(0), Y(bodyY), 7.8, 8.4) : ellipse(X(0), Y(bodyY), 9, 8.4);
  const hem = and(bodyShape, rect(0, Y(bodyY + 5.6), 999, 999));
  const pack = v === 'back' ? ellipse(X(0), Y(bodyY - 2), 6.2, 6.6) : ellipse(X(-7), Y(bodyY - 2), 4.2, 6.4);
  const rope = v === 'back' ? minus(ellipse(X(0), Y(bodyY - 5), 4.4, 2.4), ellipse(X(0), Y(bodyY - 5), 2.2, 1)) : minus(ellipse(X(-7.5), Y(bodyY - 7), 3, 2.2), ellipse(X(-7.5), Y(bodyY - 7), 1.2, 0.8));

  const backHand = o.hands?.back ?? (v === 'front' || v === 'back' ? [-9.5, -10 + by] : [-3, -10 + by]);
  const frontHand = o.hands?.front ?? (v === 'front' || v === 'back' ? [9.5, -10 + by] : [2.5, -10 + by]);
  const shL = [v === 'side' ? -2 : -7.5, bodyY - 4], shR = [v === 'side' ? 1.5 : 7.5, bodyY - 4];
  const tool = o.tool;

  // back to front
  if (v === 'side') {   // facing right: the pack and the far arm sit behind the body
    parts.push({ shape: pack, mat: PAL.pack, shade: 'round' }, { shape: rope, mat: PAL.rope, shade: 'edge' });
    if (tool?.hand === 'back') parts.push(...toolParts(backHand, tool.angle));
    parts.push(limb(shL[0], shL[1], backHand[0], backHand[1], 2.4, PAL.parka), hand(backHand));
  }
  parts.push(...legs);
  parts.push({ shape: bodyShape, mat: PAL.parka, shade: 'round' }, { shape: hem, mat: PAL.fur, shade: 'edge', outline: false });
  if (v === 'back') parts.push({ shape: pack, mat: PAL.pack, shade: 'round' }, { shape: rope, mat: PAL.rope, shade: 'edge' }, { shape: rect(X(-1), Y(bodyY - 9), X(1), Y(bodyY + 3)), mat: PAL.pack, shade: 'flat', outline: false });
  if (v !== 'side') {
    if (tool?.hand === 'left') parts.push(...toolParts(backHand, tool.angle));
    parts.push(limb(shL[0], shL[1], backHand[0], backHand[1], 2.5, PAL.parka), hand(backHand));
  }
  // the head: hood, pompom, the fur ring and the face inside it
  const hx = X(headX), hy = Y(headY);
  parts.push({ shape: ellipse(hx, hy, 12.4, 11.6), mat: PAL.parka, shade: 'round' });
  parts.push({ shape: circle(hx - (v === 'side' ? 2 : 0), hy - 12.6, 2.7), mat: PAL.fur, shade: 'round' });
  if (v !== 'back') {
    const fx = v === 'side' ? hx + 5.5 : hx, fy = hy + 1.6;
    const furS = v === 'side' ? ellipse(fx, fy, 6, 8) : ellipse(fx, fy, 9.6, 8.6), faceS = v === 'side' ? ellipse(fx + 1, fy, 4.2, 6.2) : ellipse(fx, fy, 7.4, 6.5);
    const inHood = ellipse(hx, hy, 13.2, 12.4);
    parts.push({ shape: and(furS, inHood), mat: PAL.fur, shade: 'round', outline: true });
    parts.push({ shape: and(faceS, inHood), mat: PAL.skin, shade: 'flat', outline: true, outlineColour: PAL.fur[0], pixels: face(Math.round(fx - (v === 'side' ? 1 : 0)), Math.round(fy), o.eyes ?? 'open', o.mouth ?? 'smile', v === 'side') });
  }
  // snow goggles pushed up on the hood: a strap round it and amber lenses on the brow
  const strapY = hy - 6.5;
  if (v === 'back') parts.push({ shape: and(ellipse(hx, hy, 12.4, 11.6), rect(0, Math.round(strapY), 999, Math.round(strapY + 2))), mat: PAL.strap, shade: 'flat', outline: false });
  else {
    parts.push({ shape: and(ellipse(hx, hy, 12.4, 11.6), rect(0, Math.round(strapY - 1), 999, Math.round(strapY + 1))), mat: PAL.strap, shade: 'flat', outline: false });
    const lenses = v === 'side' ? [hx + 5.5] : [hx - 4.5, hx + 4.5];
    for (const lx of lenses) parts.push({ shape: v === 'side' ? ellipse(lx, strapY, 1.8, 2.3) : circle(lx, strapY, 2.3), mat: PAL.lens, shade: 'round' });
  }
  // pack straps over the shoulders (front view)
  if (v === 'front') for (const s of [-1, 1]) parts.push({ shape: and(ellipse(X(0), Y(bodyY), 9, 8.4), capsule(X(s * 5), Y(bodyY - 8), X(s * 4.4), Y(bodyY + 3), 0.8)), mat: PAL.pack, shade: 'flat', outline: false });
  // near arm (and the tool in it) in front of the body
  if (v === 'side') {
    parts.push(limb(shR[0], shR[1], frontHand[0], frontHand[1], 2.4, PAL.parka), hand(frontHand));
    if (tool?.hand === 'front') parts.push(...toolParts(frontHand, tool.angle));
  } else {
    parts.push(limb(shR[0], shR[1], frontHand[0], frontHand[1], 2.5, PAL.parka), hand(frontHand));
    if (tool?.hand === 'right') parts.push(...toolParts(frontHand, tool.angle));
  }
  for (const e of o.extras ?? []) parts.push(e);
  return drawPose(W, H, parts);
}

// a little teardrop of sweat / ice chips flying
const sweat = (x, y) => ({ shape: ellipse(X(x), Y(y), 1.6, 2.2), mat: PAL.ice, shade: 'flat' });
const chips = (x, y) => [[0, 0], [3, -3], [5, 1], [2, 4]].map(([dx, dy]) => ({ shape: rect(X(x + dx), Y(y + dy), X(x + dx + 2), Y(y + dy + 2)), mat: PAL.ice, shade: 'flat' }));

// ---- sleeping: lying on his side, hood on the ground ----
function sleeping() {
  const parts = [];
  parts.push({ shape: ellipse(X(-8), Y(-6), 4.2, 5.6), mat: PAL.pack, shade: 'round' });                   // pack under him
  parts.push({ shape: capsule(X(6), Y(-5), X(15), Y(-4), 2.4), mat: PAL.pants, shade: 'edge' }, { shape: capsule(X(6), Y(-3), X(14), Y(-2), 2.4), mat: PAL.pants, shade: 'edge' });
  parts.push({ shape: minus(ellipse(X(17), Y(-4), 2.6, 3.4), rect(0, Y(0), 999, 999)), mat: PAL.boot, shade: 'round' }, { shape: minus(ellipse(X(16), Y(-1.8), 2.6, 3.2), rect(0, Y(0), 999, 999)), mat: PAL.boot, shade: 'round' });
  parts.push({ shape: minus(ellipse(X(2), Y(-6.5), 9.4, 6.6), rect(0, Y(0), 999, 999)), mat: PAL.parka, shade: 'round' });
  parts.push({ shape: and(ellipse(X(2), Y(-6.5), 9.4, 6.6), rect(X(8.6), 0, 999, 999)), mat: PAL.fur, shade: 'edge', outline: false });
  const hx = X(-12), hy = Y(-10.6);
  parts.push({ shape: minus(ellipse(hx, hy, 11.6, 10.8), rect(0, Y(0), 999, 999)), mat: PAL.parka, shade: 'round' });
  parts.push({ shape: circle(hx - 11.2, hy - 4, 2.6), mat: PAL.fur, shade: 'round' });
  const fx = hx + 2, fy = hy - 1;
  parts.push({ shape: ellipse(fx, fy, 8.4, 7.4), mat: PAL.fur, shade: 'round' });
  parts.push({ shape: ellipse(fx, fy, 6.4, 5.4), mat: PAL.skin, shade: 'flat', outlineColour: PAL.fur[0], pixels: face(fx, fy, 'closed', 'smile') });
  parts.push({ shape: capsule(X(-2), Y(-9), X(4), Y(-8), 2.4), mat: PAL.parka, shade: 'edge' }, { shape: circle(X(5), Y(-8), 2.5), mat: PAL.mitten, shade: 'round' });
  return drawPose(W, H, parts);
}

// ---- the 18 poses (same names as Pyxl's, so every state in the app finds one) ----
const mirror = p => { const px = p.px.slice(); for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) px[y * p.W + x] = p.px[y * p.W + (p.W - 1 - x)]; return { ...p, px }; };
export function poses() {
  return [
    ['front', pose({ view: 'front' })],
    ['frontBlink', pose({ view: 'front', eyes: 'closed' })],
    ['side', mirror(pose({ view: 'side' }))],                                         // Pyxl's 'side' faces left
    ['back', pose({ view: 'back' })],
    ['idle0', pose({ view: 'side', legs: 'stand', hands: { back: [-3, -10], front: [2.5, -10] } })],
    ['idle1', pose({ view: 'side', legs: 'stepA', bob: -1, hands: { back: [0, -11], front: [-1, -11] } })],
    ['walk', pose({ view: 'side', legs: 'stepB', bob: -1, hands: { back: [-6, -11], front: [5, -11] } })],
    ['brush', pose({ view: 'side', hands: { front: [9, -14] }, tool: { hand: 'front', angle: -35 } })],
    ['paint', pose({ view: 'side', hands: { front: [9, -12] }, tool: { hand: 'front', angle: 18 }, eyes: 'happy', extras: chips(22, -6) })],
    ['raise', pose({ view: 'front', hands: { front: [11, -27] }, tool: { hand: 'right', angle: -88 }, mouth: 'open' })],
    ['point', pose({ view: 'side', hands: { front: [12, -17] } })],
    ['floor', pose({ view: 'front', legs: 'sit', hands: { back: [-10, -5], front: [10, -5] }, eyes: 'half' })],
    ['cheer', pose({ view: 'front', hands: { back: [-11, -27], front: [11, -27] }, tool: { hand: 'right', angle: -100 }, eyes: 'happy', mouth: 'open', bob: -1 })],
    ['spray', pose({ view: 'side', hands: { front: [10, -15] }, tool: { hand: 'front', angle: -4 }, extras: chips(26, -20) })],
    ['happy', pose({ view: 'front', hands: { back: [-12, -18], front: [12, -18] }, eyes: 'happy', mouth: 'open', bob: -1 })],
    ['oops', pose({ view: 'front', hands: { back: [-13, -14], front: [13, -14] }, eyes: 'wide', mouth: 'o', extras: [sweat(-13, -38)] })],
    ['drowsy', pose({ view: 'front', headDy: 1, eyes: 'half', mouth: 'none' })],
    ['sleep', sleeping()],
  ];
}
// the anchor of each pose: the centre of his hood (where Pyxl's beret centre is)
export const anchorOf = name => (name === 'sleep' ? [X(-12)] : name === 'side' ? [W - 1 - X(1)] : ['idle0', 'idle1', 'walk', 'brush', 'paint', 'point', 'spray'].includes(name) ? [X(1)] : [X(0)]);
