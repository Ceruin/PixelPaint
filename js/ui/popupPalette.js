import { h, icon } from './dom.js';
import { bus } from '../core/bus.js';
import { local } from '../core/storage.js';
import { TAU } from '../core/util.js';
import { hexToRgb, rgbToHex, hsvToRgb, rgbToHsv } from '../core/color.js';
import { PRESETS } from '../engine/presets.js';
import { strokePreview } from '../engine/brush.js';
import { applyPreset, userBrushes, favs as favorites } from './brushPanel.js';

// Krita-style pop-up palette on right-click / pen barrel button: favourite brushes around a
// hue ring, recent colours inside, current colour in the middle (click it to swap).
export function initPopupPalette(app) {
  let el = null;
  const close = () => { el?.remove(); el = null; };
  const S = 300, C = S / 2;

  const open = ({ x, y }) => {
    close();
    const all = [...PRESETS, ...userBrushes()];
    const favs = favorites().map(n => all.find(p => p.name === n)).filter(Boolean);
    const ring = h('canvas.pp-hue', { width: 180, height: 180 });
    const rc = ring.getContext('2d'), g = rc.createConicGradient(0, 90, 90);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
    rc.fillStyle = g; rc.beginPath(); rc.arc(90, 90, 90, 0, TAU); rc.arc(90, 90, 66, 0, TAU, true); rc.fill();
    ring.addEventListener('pointerdown', e => {
      const r = ring.getBoundingClientRect(), dx = e.clientX - r.left - 90, dy = e.clientY - r.top - 90, d = Math.hypot(dx, dy);
      if (d < 66 || d > 90) return;
      let [, s, v] = rgbToHsv(...hexToRgb(app.color.fg));
      if (s < 0.15) { s = 0.8; v = Math.max(v, 0.85); }
      app.setColor(rgbToHex(...hsvToRgb((Math.atan2(dy, dx) / TAU * 360 + 360) % 360, s, v)));
      paintCenter();
    });
    const center = h('button.pp-center', { type: 'button', 'data-tip': 'Swap colors', onclick: () => { app.swapColors(); paintCenter(); } });
    const paintCenter = () => { center.style.background = app.color.fg; center.style.boxShadow = `0 0 0 5px var(--panel), 0 0 0 9px ${app.color.bg}`; };
    paintCenter();
    const recent = local.get('pp.recent', []).slice(0, 8).map((c, i, arr) => {
      const t = i / arr.length * TAU - Math.PI / 2;
      return h('button.pp-dot', { type: 'button', style: { background: c, left: `${C + Math.cos(t) * 46 - 8}px`, top: `${C + Math.sin(t) * 46 - 8}px` }, onclick: () => { app.setColor(c); paintCenter(); } });
    });
    const brushes = favs.map((p, i) => {
      const t = i / favs.length * TAU - Math.PI / 2, cv = h('canvas', { width: 96, height: 40 });
      requestAnimationFrame(() => strokePreview(p, cv, getComputedStyle(document.body).getPropertyValue('--text').trim()));
      return h('button.pp-brush', {
        type: 'button', 'data-tip': p.name, className: app.brush.name === p.name ? 'on' : '',
        style: { left: `${C + Math.cos(t) * 122 - 26}px`, top: `${C + Math.sin(t) * 122 - 26}px` },
        onclick: () => { applyPreset(app, p); close(); },
      }, cv);
    });
    el = h('div.popup-palette', { style: { left: `${Math.min(Math.max(x - C, 8), innerWidth - S - 8)}px`, top: `${Math.min(Math.max(y - C, 8), innerHeight - S - 8)}px` } },
      h('div.pp-disc'), ring, ...recent, center, ...brushes,
      favs.length ? null : h('div.pp-hint', {}, icon('star'), 'Star brushes in the library to pin them here'));
    document.body.append(el);
  };

  bus.on('popup', open);
  addEventListener('pointerdown', e => el && !el.contains(e.target) && close(), true);
  addEventListener('keydown', e => e.key === 'Escape' && close());
}
