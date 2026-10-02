// Bluebird — a colour variant of Pyxl (docs/PYXL.md §6A): a blue beret instead of a red one.
// A recipe is just a function over each pose; this one swaps exact colours.
export const NAME = 'Bluebird — blue beret';
const SWAP = { '#8b303b': '#2c3f8a', '#dc4749': '#4a6fe0', '#f47a5e': '#8fb0ff' };
export function bluebird(p) {
  p.each((x, y, c) => { if (c && SWAP[c]) p.set(x, y, SWAP[c]); });
}
