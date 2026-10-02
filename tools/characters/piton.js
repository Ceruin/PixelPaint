// Piton — a little mountain climber, built as a costume on the mannequin (Pyxl's base body and poses):
// a big fur-trimmed hood with a pompom and amber snow goggles, spiky ginger bangs, a tiny puffy parka,
// red mittens, fur-cuffed boots, an orange pack with a rope coil and a wooden ice mallet. See
// docs/CHARACTERS.md.
import { ellipse, circle, capsule, rect, box, and, minus } from './rig.js';
import { poses as dress, anchorOf, W, H, OX, FY, X, Y, D } from './mannequin.js';

export const NAME = 'Piton';
export { W, H, OX, FY, anchorOf };

// One ramp per material: [shadow, base, light]. The hood and parka use Pyxl's teal smock ramp, so they
// recolour with the outfit colour in the app; nothing else is in the teal hue band (150–205).
export const PAL = {
  parka: ['#3d6f80', '#559aa6', '#86c5c0'],
  fur: ['#c9c2c8', '#f1ece6', '#ffffff'],
  hair: ['#7a3a1c', '#b5602a', '#e08a44'],
  skin: ['#eab8a0', '#fbe4d3', '#fbe4d3'],
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

const tri = x => Math.abs(((x % 5) + 5) % 5 - 2);   // 2 1 0 1 2 … for zigzag bang tips
const hoodOf = g => ellipse(g.head.x, g.head.y, 15.6, 13.6);
const furOf = g => g.v === 'side' ? ellipse(g.face.x + 2.5, g.face.y - 0.5, 8.4, 9.6) : ellipse(g.face.x, g.face.y - 0.5, 11.6, 9.4);
const sideways = g => g.v === 'side';

export const COSTUME = {
  name: NAME,
  skin: PAL.skin, iris: '#8a4b2a',
  sleeve: PAL.parka, handMat: PAL.mitten, legs: PAL.pants,

  // the hood is the head's big shape (Pyxl's beret + hair volume)
  skull: g => [{ shape: hoodOf(g), mat: PAL.parka, shade: 'round', light: [g.head.x - 3, g.head.y - 3, 15, 13] },
    ...(g.v === 'back' ? [{ shape: and(hoodOf(g), rect(0, Math.round(g.head.y + 9), 999, 999)), mat: PAL.fur, shade: 'edge', outline: false }] : [])],
  // the fur ring framing the face
  faceFrame: g => [{ shape: and(furOf(g), ellipse(g.head.x, g.head.y, 16.6, 14.6)), mat: PAL.fur, shade: 'round', light: [g.face.x - 4, g.face.y - 6, 12, 10] }],
  faceOutlineColour: PAL.fur[0],
  faceClip: g => and(hoodOf(g), furOf(g)),   // keep the face inside the hood's fur ring
  // spiky bangs across the top of the face window, locks down its sides
  hair: g => {
    if (g.v === 'back') return [];
    const fx = g.face.x + (sideways(g) ? 2 : 0), fy = g.face.y;
    const bangs = (x, y) => {
      const dx = x + 0.5 - fx;
      return sideways(g) ? y < fy - 5 + tri(x) * 1.1 - (dx > 3 ? 1 : 0) || dx < -3.5 && y < fy + 2
        : y < fy - 5.5 + tri(x + 1) * 1.1 || Math.abs(dx) > 6.8 && y < fy + 2;
    };
    return [{
      shape: and(g.face.shape, bangs), mat: PAL.hair, shade: 'edge', outline: false,
      paint: (x, y, k) => (k === 0 ? PAL.hair[0] : (x * 7 + Math.floor(y / 3)) % 5 === 0 ? PAL.hair[0] : y <= fy - 6 && x < fx + 2 ? PAL.hair[2] : null),
    }];
  },
  // pompom + goggles on the hood
  hat: g => {
    const { x: hx, y: hy } = g.head, gY = hy - 7.5, hood = hoodOf(g), out = [];
    out.push({ shape: circle(hx + (sideways(g) ? -3 : 0), hy - 13.6, 2.5), mat: PAL.fur, shade: 'round' });
    out.push({ shape: and(hood, rect(0, Math.round(gY + (g.v === 'back' ? 1 : -1)), 999, Math.round(gY + (g.v === 'back' ? 3 : 1)))), mat: PAL.strap, shade: 'flat', outline: false });
    if (g.v !== 'back') for (const lx of sideways(g) ? [hx + 6] : [hx - 4.5, hx + 4.5])
      out.push({ shape: sideways(g) ? ellipse(lx, gY, 2, 2.6) : circle(lx, gY, 2.7), mat: PAL.lens, shade: 'round' });
    return out;
  },
  // a puffy parka with a fur hem; pack straps from the front, the pack itself from the back
  torso: g => {
    const { top, bot, shape } = g.torso, out = [{ shape, mat: PAL.parka, shade: 'round' }];
    out.push({ shape: ellipse(X(0), Y(bot - 1), sideways(g) ? 7.6 : 9.6, 1.6), mat: PAL.fur, shade: 'edge' });
    if (g.v === 'front') for (const s of [-1, 1]) out.push({ shape: and(shape, capsule(X(s * 3.6), Y(top), X(s * 4.4), Y(bot - 3), 0.7)), mat: PAL.pack, shade: 'flat', outline: false });
    if (g.v === 'back') out.push(...pack(g, 0));
    return out;
  },
  behind: g => (sideways(g) ? pack(g, -7) : []),
  foot: (g, [fx, lift], far) => {
    const fwd = sideways(g) ? 1 : 0, dk = m => (far ? [m[0], m[0], m[1]] : m);
    return [
      { shape: minus(ellipse(X(fx + fwd), Y(-2 + lift), 3.2 + fwd * 0.4, 2.6), rect(0, Y(0), 999, 999)), mat: dk(PAL.boot), shade: 'round' },
      { shape: ellipse(X(fx), Y(-4.6 + lift), 2.9, 1.3), mat: dk(PAL.fur), shade: 'edge' },
    ];
  },
  // the ice mallet: a wooden handle, a wooden head with a steel band
  tool: (hx, hy, angle) => {
    const a = angle * D, L = 11, ex = hx + Math.cos(a) * L, ey = hy + Math.sin(a) * L;
    return [
      { shape: capsule(hx, hy, ex, ey, 0.9), mat: PAL.wood, shade: 'edge' },
      { shape: box(ex, ey, 7, 4, a + Math.PI / 2), mat: PAL.wood, shade: 'edge' },
      { shape: and(box(ex, ey, 7, 4, a + Math.PI / 2), box(ex, ey, 1.4, 4, a)), mat: PAL.steel, shade: 'flat', outline: false },
    ];
  },
  // his effects: ice instead of paint
  fx: {
    splat: (x, y) => [[0, 0], [3, -3], [5, 1], [2, 4]].map(([dx, dy]) => ({ shape: rect(X(x + dx - 6), Y(y + dy), X(x + dx - 4), Y(y + dy + 2)), mat: PAL.ice, shade: 'flat' })),
    spray: (x, y) => [[0, 0, 2.4], [5, -3, 1.8], [6, 3, 1.5], [10, 0, 1.2]].map(([dx, dy, r]) => ({ shape: circle(X(x + dx - 6), Y(y + dy), r), mat: PAL.ice, shade: 'round' })),
  },
};

function pack(g, dx) {
  const { top } = g.torso, back = g.v === 'back';
  const body = back ? ellipse(X(0), Y(top + 6), 6, 6.5) : ellipse(X(dx), Y(top + 6), 3.6, 6);
  const rope = back ? minus(ellipse(X(0), Y(top + 1), 4.2, 2.2), ellipse(X(0), Y(top + 1), 2, 0.9)) : minus(ellipse(X(dx - 0.5), Y(top + 1), 2.8, 2), ellipse(X(dx - 0.5), Y(top + 1), 1.1, 0.7));
  return [{ shape: body, mat: PAL.pack, shade: 'round' }, { shape: rope, mat: PAL.rope, shade: 'edge' }];
}

export const poses = () => dress(COSTUME);
