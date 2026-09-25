// Each fn maps a dab (x, y, angle) to [x, y, angle, mirrored].
export const SYMMETRY = [['none', 'Off'], ['vertical', 'Vertical'], ['horizontal', 'Horizontal'], ['quad', 'Quadrant'], ['radial', 'Radial']];

export function symmetryFns(mode, cx, cy, n = 6) {
  const id = (x, y, a) => [x, y, a, false];
  const mx = (x, y, a) => [2 * cx - x, y, Math.PI - a, true];
  const my = (x, y, a) => [x, 2 * cy - y, -a, true];
  const mxy = (x, y, a) => [2 * cx - x, 2 * cy - y, a + Math.PI, false];
  switch (mode) {
    case 'vertical': return [id, mx];
    case 'horizontal': return [id, my];
    case 'quad': return [id, mx, my, mxy];
    case 'radial': return Array.from({ length: n }, (_, i) => {
      const t = i * 2 * Math.PI / n, c = Math.cos(t), s = Math.sin(t);
      return (x, y, a) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c, a + t, false];
    });
    default: return [id];
  }
}
