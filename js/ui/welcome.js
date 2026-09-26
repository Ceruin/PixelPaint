import { h } from './dom.js';
import { local } from '../core/storage.js';
import { wordmark } from './menubar.js';
import { drawPose, atlasReady } from './mascot.js';
import { devPx } from './pixelIcons.js';

// First-visit welcome: a big Pyxl (her own sprite at a whole-device-pixel scale, so it stays true pixel art), the wordmark, and little Pyxl walking across the bottom
// leaving a rainbow brush trail while the app warms up. Click / key / 4.5 s to continue.
export function showWelcome(force = false) {
  if (!force && local.get('pp.welcomed', false)) return Promise.resolve();
  local.set('pp.welcomed', true);
  return new Promise(done => {
    const dpr = devicePixelRatio || 1, wk = devPx(2), big = devPx(Math.min(8, Math.max(3, Math.floor(Math.min(innerHeight * 0.5, 460) / 64))));
    const sized = (c, w, hh, k) => Object.assign(c, { width: w * k, height: hh * k, style: `width:${w * k / dpr}px;height:${hh * k / dpr}px` });
    const art = sized(h('canvas.wl-art', { 'aria-label': 'Pyxl the painter' }), 76, 64, big), trail = h('canvas.wl-trail'), walker = sized(h('canvas.wl-walker'), 96, 64, wk), bar = h('i');
    atlasReady.then(() => {   // drawn at 1×, tidied, then enlarged by whole pixels
      const one = Object.assign(document.createElement('canvas'), { width: 76, height: 64 }), x = art.getContext('2d');
      drawPose(one.getContext('2d'), 'happy', 32, 58, 1);
      tidy(one);
      x.imageSmoothingEnabled = false; x.drawImage(one, 0, 0, 76 * big, 64 * big);
    });
    art.style.setProperty('--px', `${big / dpr}px`);
    const root = h('div.welcome', {},
      h('div.wl-card', {},
        art,
        h('div.wl-text', {}, wordmark(), h('p', {}, 'Paint · sketch · take notes · pixel art · animate'), h('div.wl-bar', {}, bar), h('small.muted', {}, 'Click anywhere to start'))),
      trail, walker);
    document.body.append(root);
    const W = innerWidth, T0 = performance.now(), DUR = 3800, ctx = trail.getContext('2d');
    trail.width = W; trail.height = 60;
    const poses = ['idle0', 'walk', 'idle1', 'walk'];
    let last = null, raf = 0, closed = false;
    const tick = now => {
      const t = Math.min(1, (now - T0) / DUR), x = -80 + t * (W + 40), y = 34 + Math.sin(t * 18) * 5;
      const wc = walker.getContext('2d');
      wc.clearRect(0, 0, walker.width, walker.height);
      drawPose(wc, t > 0.97 ? 'cheer' : poses[Math.floor(now / 160) % 4], 40, 62, wk);
      walker.style.transform = `translateX(${Math.round((x - 40) * dpr) / dpr}px)`;   // compositor-only
      if (last) {
        ctx.lineCap = 'round'; ctx.lineWidth = 9;
        ctx.strokeStyle = `hsl(${(t * 720) % 360},90%,60%)`;
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(x + 8, y); ctx.stroke();
      }
      last = { x: x + 8, y };
      bar.style.transform = `scaleX(${t})`;
      if (t < 1) raf = requestAnimationFrame(tick);
      else setTimeout(close, 700);
    };
    const close = () => {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(raf);
      root.classList.add('out');
      setTimeout(() => { root.remove(); done(); }, 450);
    };
    root.addEventListener('pointerdown', close);
    addEventListener('keydown', close, { once: true });
    raf = requestAnimationFrame(tick);
  });
}

// Tidies small pixel art in place: drops stray lone pixels and single-pixel speckles (a pixel whose
// four neighbours all share one other colour takes that colour), so a big splash reads clean.
function tidy(c) {
  const x = c.getContext('2d'), img = x.getImageData(0, 0, c.width, c.height), p = new Uint32Array(img.data.buffer), w = c.width, hh = c.height, o = p.slice();
  const at = (i, j) => (i < 0 || j < 0 || i >= w || j >= hh ? 0 : p[j * w + i]);
  for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) {
    const v = p[j * w + i];
    if (!(v >>> 24)) continue;
    let n8 = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && at(i + di, j + dj) >>> 24) n8++;
    if (n8 <= 1) { o[j * w + i] = 0; continue; }
    const q = [at(i - 1, j), at(i + 1, j), at(i, j - 1), at(i, j + 1)];
    if (q[0] >>> 24 && q.every(c2 => c2 === q[0]) && q[0] !== v) o[j * w + i] = q[0];
  }
  p.set(o); x.putImageData(img, 0, 0);
}
