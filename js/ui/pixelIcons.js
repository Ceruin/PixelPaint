// Tiny pixel-art icons (one char per pixel, '.' = clear) drawn at integer scale, so Pyxl's
// particles, snacks and need-bubbles match her sprite style.
const C = {
  k: '#221822', w: '#ffffff', r: '#e0485a', p: '#ff8fa3', y: '#ffd23f', o: '#ff9f2b', g: '#2fb36b', G: '#1a7a45',
  b: '#3b7bff', c: '#84cee0', n: '#8a5a3c', t: '#f2cf99', s: '#9aa1b1', m: '#c9b8ff', l: '#dfe6f0',
  v: '#a445ff', d: '#4a4f5c', Y: '#d99a14',
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
  pencilPx: ['.....kk', '....kyk', '...kyk.', '..kyk..', '.kyk...', 'kpk....', 'kk.....'],
  // emote balls & expressions (after the Chao emote ball)
  emDot: ['.yy.', 'yyyy', 'yyyy', '.yy.'], emHalo: ['.ccccc.', 'c.....c', '.ccccc.'], emSpike: ['..v..', '.vvv.', 'vvvvv', '.vvv.', '..v..'],
  swirl: ['sssssss', '.sssss.', '..sss..', '.sss...', '..ss...', '...s...'], flame: ['..o..', '.oyo.', 'oyyyo', '.oyo.'],
  // shop fruit
  heartFruit: ['...g...', '.pp.pp.', 'ppppppp', 'ppppppp', '.ppppp.', '..ppp..', '...p...'],
  brightFruit: ['...g...', '..yyy..', '.ywyyy.', '.yyyyy.', '.yyyyy.', '..yyy..'],
  moodyFruit: ['...G...', '..vvv..', '.vmvvv.', '.vvvvv.', '.vvvvv.', '..vvv..'],
  chaoFruit: ['...g...', '..rrr..', '.ooooo.', 'yyyyyyy', '.ggggg.', '..bbb..'],
  mushroom: ['..rrr..', '.rwrwr.', 'rrrrrrr', '..ttt..', '..ttt..'],
  // kindergarten instruments
  bell: ['..y..', '.yyy.', '.yyy.', 'yyyyy', '..k..'], castanets: ['.nn.nn.', 'nnnnnnn', '.nn.nn.'],
  cymbals: ['yyyyy', '.yyy.', '..s..', '.yyy.', 'yyyyy'], drum: ['.lllll.', 'rlllllr', 'rrrrrrr', 'ryryryr', '.rrrrr.'],
  flute: ['ssssssss', 'sksksks.'], maracas: ['.o...o.', 'ooo.ooo', '.o...o.', '..n.n..', '..n.n..'],
  tambourine: ['.nynyn.', 'y.....y', 'n.....n', 'y.....y', '.nynyn.'], trumpet: ['......y', 'yyyyyyy', '.k.k..y'],
  // toys
  box: ['nnnnnnn', 'ntttttn', 'ntttttn', 'ntttttn', 'nnnnnnn'], radio: ['.....k.', '....k..', 'sssssss', 'skksbbs', 'skksbbs', 'sssssss'],
  tv: ['.k...k.', '..k.k..', 'ddddddd', 'dcccccd', 'dcbcccd', 'dcccccd', 'ddddddd', '.d...d.'], crayons: ['r.y.b', 'r.y.b', 'r.y.b', 'k.k.k'],
  // her drawings, by drawing level
  sun: ['y..y..y', '.yyyyy.', '.yyyyy.', 'yyyyyyy', '.yyyyy.', '.yyyyy.', 'y..y..y'], flower: ['..p.p..', '.ppypp.', '..p.p..', '...g...', '.g.g...', '..gg...'],
  cake: ['..r.r..', '..y.y..', '.ppppp.', '.wwwww.', 'nnnnnnn', 'ttttttt'], car: ['..bbb....', '.bcbcbb..', 'bbbbbbbbb', '.k....k..'],
  house: ['...r...', '..rrr..', '.rrrrr.', '.twtnt.', '.tttnt.'],
  // bits and bobs
  medal: ['r...r', '.r.r.', '..y..', '.yyy.', '.yYy.', '..y..'], ring: ['.yyy.', 'y...y', 'y...y', '.yyy.'],
  pill: ['.rrww.', 'rrrwww', '.rrww.'], bag: ['.nnn.', 'n...n', 'bbbbb', 'bbybb', 'bbbbb'], bloom: ['.p.', 'pyp', '.p.'],
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
