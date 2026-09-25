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
    atlasReady.then(() => drawPose(art.getContext('2d'), 'happy', 32, 58, big));
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
      walker.style.left = `${Math.round((x - 40) * dpr) / dpr}px`;
      if (last) {
        ctx.lineCap = 'round'; ctx.lineWidth = 9;
        ctx.strokeStyle = `hsl(${(t * 720) % 360},90%,60%)`;
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(x + 8, y); ctx.stroke();
      }
      last = { x: x + 8, y };
      bar.style.width = `${t * 100}%`;
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
