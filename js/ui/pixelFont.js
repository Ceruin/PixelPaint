// A 5×7 bitmap font drawn in whole scene pixels, so canvas text is real pixel art (no anti-aliased
// font smoothing). Big text is the same glyphs enlarged with EPX (Scale2x) — new, smoothed 1px
// pixel art rather than chunky scaled pixels.
const G = {
  A: '0E1111 1F111111', B: '1E11111E11111E', C: '0E111010 10110E', D: '1C121111 11121C', E: '1F10101E10101F', F: '1F10101E101010',
  G: '0E111017 11110F', H: '1111111F111111', I: '0E040404 04040E', J: '07020202 02120C', K: '11121418 141211', L: '10101010 10101F',
  M: '111B1515 111111', N: '11111915 131111', O: '0E111111 11110E', P: '1E11111E101010', Q: '0E111111 15120D', R: '1E11111E141211',
  S: '0F10100E 01011E', T: '1F040404 040404', U: '11111111 11110E', V: '11111111 110A04', W: '11111115 15150A', X: '11110A04 0A1111',
  Y: '1111110A 040404', Z: '1F010204 08101F', 0: '0E111315 19110E', 1: '040C0404 04040E', 2: '0E110102 04081F', 3: '1F020402 01110E',
  4: '02060A12 1F0202', 5: '1F101E01 01110E', 6: '0608101E 11110E', 7: '1F010204 080808', 8: '0E11110E 11110E', 9: '0E11110F 01020C',
  '!': '04040404 040004', '?': '0E110102 040004', '.': '00000000 000C0C', '-': '0000001F 000000', "'": '0C040800 000000', ':': '000C0C00 0C0C00',
};
const bits = s => { const hx = s.replace(/ /g, ''); return Array.from({ length: 7 }, (_, j) => Array.from({ length: 5 }, (_, i) => (parseInt(hx.slice(j * 2, j * 2 + 2), 16) >> (4 - i)) & 1)); };
const epx = g => {   // Scale2x on a 0/1 bitmap
  const H = g.length, W = g[0].length, at = (x, y) => (g[y]?.[x] ?? 0), out = Array.from({ length: H * 2 }, () => new Array(W * 2).fill(0));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const P = at(x, y), A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
    out[y * 2][x * 2] = C === A && C !== D && A !== B ? A : P;
    out[y * 2][x * 2 + 1] = A === B && A !== C && B !== D ? B : P;
    out[y * 2 + 1][x * 2] = D === C && D !== B && C !== A ? C : P;
    out[y * 2 + 1][x * 2 + 1] = B === D && B !== A && D !== C ? D : P;
  }
  return out;
};
const cache = new Map();
const glyph = (ch, big) => {
  const key = ch + big;
  if (!cache.has(key)) { let g = G[ch] && bits(G[ch]); if (g && big) g = epx(epx(g)); cache.set(key, g); }
  return cache.get(key);
};

// Text at (x, y) top-left/centre/right, in scene pixels. size ≥ 16 → 4× EPX glyphs. outline: 1px ring.
export const textWidth = (str, size = 8) => { const n = [...String(str)].length; return size >= 16 ? n * 22 - 2 : n * 6 - 1; };
export function pixelText(ctx, str, x, y, col, { size = 8, align = 'left', outline = null } = {}) {
  const big = size >= 16, adv = big ? 22 : 6, chars = [...String(str).toUpperCase()], w = textWidth(str, size);
  let cx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  const plot = (g, ox, oy) => g.forEach((row, j) => row.forEach((on, i) => on && ctx.fillRect(ox + i, oy + j, 1, 1)));
  for (const ch of chars) {
    const g = glyph(ch, big);
    if (g) {
      if (outline) { ctx.fillStyle = outline; for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) plot(g, cx + dx, Math.round(y) + dy); }
      ctx.fillStyle = col; plot(g, cx, Math.round(y));
    }
    cx += adv;
  }
}
