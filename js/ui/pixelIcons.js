// Tiny pixel-art icons (one char per pixel, '.' = clear) drawn at integer scale, so Pyxl's
// particles, snacks and need-bubbles match her sprite style.
const C = {
  k: '#221822', w: '#ffffff', r: '#e0485a', p: '#ff8fa3', y: '#ffd23f', o: '#ff9f2b', g: '#2fb36b', G: '#1a7a45',
  b: '#3b7bff', c: '#84cee0', n: '#8a5a3c', t: '#f2cf99', s: '#9aa1b1', m: '#c9b8ff', l: '#dfe6f0',
};

export const ICONS = {
  heart: ['.rr.rr.', 'rpprrrr', 'rprrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'],
  star: ['...y...', '..yyy..', 'yyyyyyy', '.yyyyy.', '..yyy..', '.yy.yy.', '.y...y.'],
  sparkle: ['..w..', '.wyw.', 'wyyyw', '.wyw.', '..w..'],
  plus: ['..g..', '..g..', 'ggggg', '..g..', '..g..'],
  drop: ['..c..', '.ccc.', 'ccwcc', 'ccccc', '.ccc.'],
  bang: ['rr', 'rr', 'rr', 'rr', '..', 'rr'],
  what: ['.kkk.', 'k...k', '...k.', '..k..', '.....', '..k..'],
  dots: ['.......', '.......', 'k..k..k'],
  note: ['...kk', '...kw', '...k.', '.kkk.', 'kkkk.', '.kk..'],
  moon: ['..mmm', '.mm..', 'mm...', 'mm...', 'mm...', '.mm..', '..mmm'],
  ball: ['.bbb.', 'bwbbb', 'bbbbb', 'bbwbb', '.bbb.'],
  onigiri: ['...kk...', '..kwwk..', '.kwwwwk.', '.kwwwwk.', 'kwwwwwwk', 'kwkkkkwk', 'kwkkkkwk', '.kkkkkk.'],
  strawberry: ['..gGg..', '.rrgrr.', 'rryrryr', 'rrrrrrr', 'ryrrryr', '.rrrrr.', '..ryr..', '...r...'],
  dango: ['..pp..', '.pppp.', '..pp..', '..ww..', '.wwww.', '..ww..', '..gg..', '.gggg.', '..gg..', '...n..'],
  tea: ['.l.l...', '..l.l..', 'kkkkkk.', 'kccccckk', 'kccccck.k', 'kcccccckk', '.kccck..', '..kkk...'],
};

export function drawIcon(ctx, name, x, y, k = 1, color) {
  const rows = ICONS[name];
  if (!rows) return;
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === '.') return;
    ctx.fillStyle = color && ch !== 'w' && ch !== 'k' ? color : C[ch];
    ctx.fillRect(Math.round(x) * k + i * k, Math.round(y) * k + j * k, k, k);
  }));
}

export const iconSize = name => [Math.max(...ICONS[name].map(r => r.length)), ICONS[name].length];

// A crisp <canvas> of one icon at scale k (for buttons and bars).
export function iconCanvas(name, k = 3) {
  const [w, h] = iconSize(name), c = document.createElement('canvas');
  c.width = w * k; c.height = h * k; c.className = 'pxicon';
  drawIcon(c.getContext('2d'), name, 0, 0, k);
  return c;
}
